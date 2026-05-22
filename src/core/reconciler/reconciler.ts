import type { StateStore } from '../foundation/state-store.js';
import type { ArtifactStore } from '../foundation/artifact-store.js';
import { buildDepGraph, propagateStale } from './stale-propagator.js';
import { detectMissingArtifacts, detectPhantomRunning } from './drift-detector.js';

export class Reconciler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtyArtifactIds = new Set<string>();

  constructor(
    private readonly stateStore: StateStore,
    private readonly artifactStore: ArtifactStore,
    private readonly db: import('better-sqlite3').Database,
    private readonly periodMs = 300_000,
    private readonly debounceMs = 500,
    private readonly maxDepth = 10,
  ) {}

  start(): void {
    this.intervalHandle = setInterval(() => void this.runFullScan(), this.periodMs);
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  /** Called by engine when ARTIFACT_PRODUCED fires */
  markDirty(artifactId: string): void {
    this.dirtyArtifactIds.add(artifactId);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.propagateDirty(), this.debounceMs);
  }

  private async propagateDirty(): Promise<void> {
    if (this.dirtyArtifactIds.size === 0) return;
    const ids = [...this.dirtyArtifactIds];
    this.dirtyArtifactIds.clear();

    const allArtifacts = this.db.prepare('SELECT id, upstream_ids FROM artifacts').all() as any[];
    const graph = buildDepGraph(allArtifacts);
    const now = new Date().toISOString();

    for (const id of ids) {
      const staleIds = propagateStale(id, graph, this.maxDepth);
      for (const staleId of staleIds) {
        this.db.prepare("UPDATE artifacts SET status='stale', updated_at=? WHERE id=? AND status NOT IN ('orphaned')")
          .run(now, staleId);
        await this.stateStore.appendEvent({
          run_id: 'reconciler', type: 'ARTIFACT_STALE',
          payload_json: JSON.stringify({ artifactId: staleId, cause: id }),
          idempotency_key: `stale:${staleId}:${Date.now()}`,
          created_at: now,
        });
      }
    }
  }

  async runFullScan(): Promise<void> {
    const now = new Date().toISOString();

    // 1. Missing artifacts
    const artifacts = this.db.prepare('SELECT id, status FROM artifacts').all() as any[];
    const missing = await detectMissingArtifacts(artifacts, this.artifactStore);
    for (const id of missing) {
      this.db.prepare("UPDATE artifacts SET status='invalid', updated_at=? WHERE id=?").run(now, id);
      await this.stateStore.appendEvent({
        run_id: 'reconciler', type: 'DRIFT_MISSING_ARTIFACT',
        payload_json: JSON.stringify({ artifactId: id }),
        idempotency_key: `drift:missing:${id}:${now}`,
        created_at: now,
      });
    }

    // 2. Phantom running nodes
    const procs = this.db.prepare("SELECT session_id, pid FROM executor_procs WHERE killed_at IS NULL").all() as any[];
    const phantoms = detectPhantomRunning(procs);
    for (const execId of phantoms) {
      this.db.prepare("UPDATE node_executions SET status='failed', error='phantom: process dead' WHERE id=?").run(execId);
      this.db.prepare("UPDATE executor_procs SET killed_at=? WHERE session_id=?").run(now, execId);
      await this.stateStore.appendEvent({
        run_id: 'reconciler', type: 'DRIFT_PHANTOM_RUNNING',
        payload_json: JSON.stringify({ execId }),
        idempotency_key: `drift:phantom:${execId}:${now}`,
        created_at: now,
      });
    }
  }
}
