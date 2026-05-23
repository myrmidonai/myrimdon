import { randomUUID } from 'node:crypto';
import type { StateStore, EventInput } from '../foundation/state-store.js';
import type { ArtifactStore } from '../foundation/artifact-store.js';
import type { ExecutionBackend, WorkerHandle } from '../foundation/execution-backend.js';
import type { Scheduler, Lease } from '../foundation/scheduler.js';
import type { WorkflowDef } from '../workflow/schema.js';
import type { ExecutorRegistry } from '../workflow/executor-registry.js';
import type { NotificationBus } from '../workflow/notifications.js';
import { isUpstreamComplete, inputArtifactIds, outputArtifactIds } from './dag.js';

interface ActiveRun {
  runId: string;
  def: WorkflowDef;
  lease: Lease;
  handles: Map<string, WorkerHandle>; // execId → handle
}

interface NodeExecRow { id: string; run_id: string; node_id: string; status: string; attempt: number }
interface ArtifactRow { id: string; status: string }

export class WorkflowEngine {
  private activeRun: ActiveRun | null = null;
  private readonly workflowDefs = new Map<string, WorkflowDef>();

  constructor(
    private readonly stateStore: StateStore,
    private readonly artifactStore: ArtifactStore,
    private readonly backend: ExecutionBackend,
    private readonly scheduler: Scheduler,
    private readonly registry: ExecutorRegistry,
    private readonly projectRoot: string,
    private readonly notificationBus?: NotificationBus,
  ) {}

  register(def: WorkflowDef): void {
    this.workflowDefs.set(def.id, def);
  }

  async start(workflowId: string, contextJson?: Record<string, unknown>): Promise<string> {
    const def = this.workflowDefs.get(workflowId);
    if (!def) throw new Error(`Workflow '${workflowId}' not registered`);

    const lease = (await this.scheduler.claim(workflowId))!;
    const runId = randomUUID();
    const now = new Date().toISOString();

    await this.stateStore.appendEvent(ev(runId, 'WORKFLOW_STARTED', { workflowId, contextJson }, `${runId}:wf:start`));

    // Write projection rows directly (v1 shortcut)
    this.writeWorkflowRunRow(runId, workflowId, 'running', now, contextJson);

    for (const node of def.nodes) {
      const execId = randomUUID();
      await this.stateStore.appendEvent(ev(runId, 'NODE_CREATED', { nodeId: node.id, execId }, `${runId}:${node.id}:create`));
      this.writeNodeExecRow(execId, runId, node.id, 'pending', 1);

      for (const artifact of node.artifacts?.produces ?? []) {
        this.writeArtifactRow(artifact.id, def.id, runId, node.id, artifact.path, 'pending', now);
        (this.artifactStore as any).register?.(artifact.id, artifact.path);
      }
    }

    this.activeRun = { runId, def, lease, handles: new Map() };
    return runId;
  }

  async tick(): Promise<void> {
    if (!this.activeRun) return;
    const { runId, def } = this.activeRun;

    const allExecs = await this.stateStore.projection<NodeExecRow>('node_executions', { where: { run_id: runId } });
    const statusMap = new Map(allExecs.map((e) => [e.node_id, e.status]));

    // Dispatch pending nodes whose upstreams are complete and input artifacts are ready
    for (const exec of allExecs.filter((e) => e.status === 'pending')) {
      const node = def.nodes.find((n) => n.id === exec.node_id);
      if (!node) continue;
      if (!isUpstreamComplete(def, node.id, statusMap)) continue;
      if (!await this.inputArtifactsReady(runId, node.id, def)) continue;
      await this.dispatchNode(exec, node, def);
      // Update status map so downstream nodes can be dispatched in the same tick
      statusMap.set(node.id, node.type === 'trigger' ? 'completed' : 'running');
    }

    // Poll running nodes via heartbeat
    for (const exec of allExecs.filter((e) => e.status === 'running')) {
      const handle = this.activeRun.handles.get(exec.id);
      if (!handle) continue;
      const hb = await this.backend.heartbeat(handle);
      if (!hb.alive) {
        await this.onNodeProcessExited(exec, def);
      }
    }

    await this.updateWorkflowStatus(runId, allExecs);
  }

  async recover(): Promise<void> {
    const runs = await this.stateStore.projection<{ id: string; workflow_id: string }>(
      'workflow_runs', { where: { status: 'running' }, orderBy: 'started_at DESC', limit: 1 }
    );
    if (runs.length === 0) return;
    const run = runs[0]!;
    const def = this.workflowDefs.get(run.workflow_id);
    if (!def) return;
    const lease = (await this.scheduler.claim(run.id))!;

    // Mark crashed running nodes back to pending
    const runningExecs = await this.stateStore.projection<NodeExecRow>(
      'node_executions', { where: { run_id: run.id, status: 'running' } }
    );
    for (const exec of runningExecs) {
      this.writeNodeExecRowStatus(exec.id, 'pending');
    }

    this.activeRun = { runId: run.id, def, lease, handles: new Map() };
  }

  // --- private helpers ---

  private async dispatchNode(exec: NodeExecRow, node: any, def: WorkflowDef): Promise<void> {
    const now = new Date().toISOString();
    await this.stateStore.appendEvent(ev(exec.run_id, 'NODE_STARTED', { nodeId: node.id, execId: exec.id }, `${exec.id}:start`));
    this.writeNodeExecRowStatus(exec.id, 'running', now);

    // For trigger nodes — complete immediately
    if (node.type === 'trigger') {
      await this.stateStore.appendEvent(ev(exec.run_id, 'NODE_COMPLETED', { nodeId: node.id }, `${exec.id}:complete`));
      this.writeNodeExecRowStatus(exec.id, 'completed', now, now);
      return;
    }

    // For agent and other async nodes — hand off to executor
    if (this.registry.has(node.type)) {
      const executor = this.registry.get(node.type);
      try {
        const result = await executor.execute({
          node, workflowId: def.id, runId: exec.run_id, executionId: exec.id,
          stateStore: this.stateStore, artifactStore: this.artifactStore, backend: this.backend,
          config: {} as any, notificationBus: this.notificationBus as any, projectRoot: this.projectRoot,
        });
        if (result.status === 'running' && result.outputJson?.handle) {
          this.activeRun!.handles.set(exec.id, result.outputJson.handle as WorkerHandle);
        }
        if (result.status !== 'running' && result.status !== 'waiting_human') {
          this.writeNodeExecRowStatus(exec.id, result.status, now, now, result.error);
        }
      } catch (err) {
        this.writeNodeExecRowStatus(exec.id, 'failed', now, now, String(err));
      }
    }
  }

  private async onNodeProcessExited(exec: NodeExecRow, def: WorkflowDef): Promise<void> {
    const node = def.nodes.find((n) => n.id === exec.node_id);
    if (!node) return;
    const runId = exec.run_id;
    const now = new Date().toISOString();

    const artifactIds = outputArtifactIds(def, node.id);
    const allExist = await Promise.all(artifactIds.map((id) => this.artifactStore.exists(id)));

    if (allExist.every(Boolean)) {
      for (const id of artifactIds) {
        this.writeArtifactStatus(id, runId, 'valid', now);
        await this.stateStore.appendEvent(ev(runId, 'ARTIFACT_PRODUCED', { artifactId: id }, `${exec.id}:${id}:produced`));
      }
      await this.stateStore.appendEvent(ev(runId, 'NODE_COMPLETED', { nodeId: node.id }, `${exec.id}:complete`));
      this.writeNodeExecRowStatus(exec.id, 'completed', undefined, now);
    } else {
      await this.stateStore.appendEvent(ev(runId, 'NODE_FAILED', { nodeId: node.id, reason: 'missing artifacts' }, `${exec.id}:failed`));
      this.writeNodeExecRowStatus(exec.id, 'failed', undefined, now, 'missing artifacts');
    }
    this.activeRun?.handles.delete(exec.id);
  }

  private async inputArtifactsReady(runId: string, nodeId: string, def: WorkflowDef): Promise<boolean> {
    const ids = inputArtifactIds(def, nodeId);
    if (ids.length === 0) return true;
    const rows = await this.stateStore.projection<ArtifactRow>('artifacts', { where: { run_id: runId } });
    const statusMap = new Map(rows.map((r) => [r.id, r.status]));
    return ids.every((id) => statusMap.get(id) === 'valid');
  }

  private async updateWorkflowStatus(runId: string, execs: NodeExecRow[]): Promise<void> {
    const terminal = ['completed', 'failed', 'skipped'];
    const allDone = execs.every((e) => terminal.includes(e.status));
    if (!allDone) return;
    const anyFailed = execs.some((e) => e.status === 'failed');
    const status = anyFailed ? 'failed' : 'completed';
    const now = new Date().toISOString();
    await this.stateStore.appendEvent(ev(runId, 'WORKFLOW_COMPLETED', { status }, `${runId}:wf:complete`));
    (this.stateStore as any).db?.prepare('UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, now, runId);
  }

  // Direct projection writes (v1 shortcut)
  private get db() { return (this.stateStore as any).db as import('better-sqlite3').Database; }

  private writeWorkflowRunRow(id: string, workflowId: string, status: string, now: string, ctx?: Record<string, unknown>) {
    this.db.prepare('INSERT OR REPLACE INTO workflow_runs (id,workflow_id,status,started_at,context_json,lease_token) VALUES (?,?,?,?,?,1)')
      .run(id, workflowId, status, now, ctx ? JSON.stringify(ctx) : null);
  }
  private writeNodeExecRow(id: string, runId: string, nodeId: string, status: string, attempt: number) {
    this.db.prepare('INSERT OR REPLACE INTO node_executions (id,run_id,node_id,status,attempt) VALUES (?,?,?,?,?)')
      .run(id, runId, nodeId, status, attempt);
  }
  private writeNodeExecRowStatus(id: string, status: string, startedAt?: string, completedAt?: string, error?: string) {
    this.db.prepare('UPDATE node_executions SET status=?, started_at=COALESCE(?,started_at), completed_at=?, error=? WHERE id=?')
      .run(status, startedAt ?? null, completedAt ?? null, error ?? null, id);
  }
  private writeArtifactRow(id: string, workflowId: string, runId: string, nodeId: string, filePath: string, status: string, now: string) {
    // Use REPLACE so each new run overwrites the projection (events table is the source of truth)
    this.db.prepare('INSERT OR REPLACE INTO artifacts (id,workflow_id,run_id,node_id,file_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, workflowId, runId, nodeId, filePath, status, now, now);
  }
  private writeArtifactStatus(id: string, runId: string, status: string, now: string) {
    this.db.prepare('UPDATE artifacts SET status=?, updated_at=? WHERE id=? AND run_id=?')
      .run(status, now, id, runId);
  }
}

function ev(runId: string, type: string, payload: Record<string, unknown>, key: string): EventInput {
  return { run_id: runId, type, payload_json: JSON.stringify(payload), idempotency_key: key, created_at: new Date().toISOString() };
}
