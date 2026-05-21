import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { WorkflowDef, NodeDef } from './schema.js';
import type { ExecutorRegistry, NodeStatus } from './executor-registry.js';
import type { RuntimeAdapter } from './runtime-adapter.js';
import type { NotificationBus } from './notifications.js';
import type { MyrmidonConfig } from '../config/schema.js';

interface NodeExecution {
  id: string;
  run_id: string;
  node_id: string;
  status: NodeStatus;
  attempt: number;
}

export class WorkflowEngine {
  private currentDef: WorkflowDef | null = null;
  private currentRunId: string | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly registry: ExecutorRegistry,
    private readonly runtimeAdapter: RuntimeAdapter,
    private readonly notificationBus: NotificationBus,
    private readonly config: MyrmidonConfig,
    private readonly projectRoot: string,
  ) {}

  register(def: WorkflowDef): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT OR REPLACE INTO workflows (id, version, name, def_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(def.id, def.version, def.name, JSON.stringify(def), now, now);

    const filePath = resolve(this.projectRoot, '.myrmidon', 'workflows', `${def.id}.json`);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf8');
  }

  load(workflowId: string): WorkflowDef {
    const row = this.db
      .prepare('SELECT def_json FROM workflows WHERE id = ?')
      .get(workflowId) as { def_json: string } | undefined;
    if (!row) throw new Error(`Workflow '${workflowId}' not found`);
    this.currentDef = JSON.parse(row.def_json) as WorkflowDef;
    return this.currentDef;
  }

  async start(workflowId: string, contextJson?: Record<string, unknown>): Promise<string> {
    this.currentDef = this.load(workflowId);
    this.currentRunId = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        "INSERT INTO workflow_runs (id, workflow_id, status, started_at, context_json) VALUES (?, ?, 'running', ?, ?)",
      )
      .run(this.currentRunId, workflowId, now, contextJson ? JSON.stringify(contextJson) : null);

    for (const node of this.currentDef.nodes) {
      const execId = randomUUID();
      this.db
        .prepare(
          "INSERT INTO node_executions (id, run_id, node_id, status, attempt) VALUES (?, ?, ?, 'pending', 1)",
        )
        .run(execId, this.currentRunId, node.id);

      for (const artifact of node.artifacts?.produces ?? []) {
        this.db
          .prepare(
            'INSERT OR IGNORE INTO artifacts (id, workflow_id, run_id, node_id, file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(artifact.id, workflowId, this.currentRunId, node.id, artifact.path, 'pending', now);
      }
    }

    return this.currentRunId;
  }

  async tick(): Promise<void> {
    if (!this.currentDef || !this.currentRunId) return;
    const runId = this.currentRunId;
    const def = this.currentDef;

    // Dispatch pending nodes whose upstreams are all done
    const pending = this.db
      .prepare("SELECT * FROM node_executions WHERE run_id = ? AND status = 'pending'")
      .all(runId) as NodeExecution[];

    for (const exec of pending) {
      const node = def.nodes.find((n) => n.id === exec.node_id);
      if (!node) continue;
      if (!this.upstreamsComplete(def, runId, node.id)) continue;
      if (!this.inputArtifactsReady(node, runId)) continue;
      await this.dispatchNode(node, exec, runId);
    }

    // Poll running nodes for async completion
    await this.pollRunningNodes(runId, def);

    // Check overall completion
    this.updateWorkflowStatus(runId, def);
  }

  async recover(): Promise<void> {
    const run = this.db
      .prepare("SELECT id, workflow_id FROM workflow_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1")
      .get() as { id: string; workflow_id: string } | undefined;
    if (!run) return;

    this.currentDef = this.load(run.workflow_id);
    this.currentRunId = run.id;

    // Reset running nodes whose process is dead back to pending
    const running = this.db
      .prepare("SELECT id FROM node_executions WHERE run_id = ? AND status = 'running'")
      .all(this.currentRunId) as Array<{ id: string }>;

    for (const exec of running) {
      const proc = this.db
        .prepare("SELECT pid FROM executor_procs WHERE session_id = ? AND killed_at IS NULL")
        .get(exec.id) as { pid: number } | undefined;

      if (!proc || !isPidAlive(proc.pid)) {
        this.db
          .prepare("UPDATE node_executions SET status = 'pending', started_at = NULL WHERE id = ?")
          .run(exec.id);
      }
    }
  }

  private async dispatchNode(node: NodeDef, exec: NodeExecution, runId: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE node_executions SET status = 'running', started_at = ? WHERE id = ?")
      .run(now, exec.id);

    let result: { status: string; outputJson?: Record<string, unknown>; error?: string };
    try {
      const executor = this.registry.get(node.type);
      result = await executor.execute({
        node,
        workflowId: this.currentDef!.id,
        runId,
        executionId: exec.id,
        db: this.db,
        config: this.config,
        runtimeAdapter: this.runtimeAdapter,
        notificationBus: this.notificationBus,
        projectRoot: this.projectRoot,
      });
    } catch (err) {
      result = { status: 'failed', error: String(err) };
    }

    if (result.status === 'running' || result.status === 'waiting_human') return;

    const completedAt = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE node_executions SET status = ?, completed_at = ?, output_json = ?, error = ? WHERE id = ?',
      )
      .run(
        result.status,
        completedAt,
        result.outputJson ? JSON.stringify(result.outputJson) : null,
        result.error ?? null,
        exec.id,
      );

    if (result.status === 'completed') {
      for (const artifact of node.artifacts?.produces ?? []) {
        this.db
          .prepare("UPDATE artifacts SET status = 'ready' WHERE id = ? AND run_id = ?")
          .run(artifact.id, runId);
      }
      await this.notificationBus.notify('node_completed', { nodeId: node.id, runId });
    } else {
      await this.notificationBus.notify('node_failed', { nodeId: node.id, runId, error: result.error });
    }
  }

  private async pollRunningNodes(runId: string, def: WorkflowDef): Promise<void> {
    const running = this.db
      .prepare("SELECT * FROM node_executions WHERE run_id = ? AND status = 'running'")
      .all(runId) as NodeExecution[];

    for (const exec of running) {
      const node = def.nodes.find((n) => n.id === exec.node_id);
      if (!node) continue;

      // Check agents table: agent sets status='completed' when done
      const agent = this.db
        .prepare("SELECT status FROM agents WHERE current_task = ?")
        .get(node.id) as { status: string } | undefined;

      if (agent?.status === 'completed') {
        const now = new Date().toISOString();
        this.db
          .prepare("UPDATE node_executions SET status = 'completed', completed_at = ? WHERE id = ?")
          .run(now, exec.id);
        for (const artifact of node.artifacts?.produces ?? []) {
          this.db
            .prepare("UPDATE artifacts SET status = 'ready' WHERE id = ? AND run_id = ?")
            .run(artifact.id, runId);
        }
        await this.notificationBus.notify('node_completed', { nodeId: node.id, runId });
      }
    }
  }

  private upstreamsComplete(def: WorkflowDef, runId: string, nodeId: string): boolean {
    const inEdges = def.edges.filter((e) => e.to === nodeId);
    if (inEdges.length === 0) return true;

    const node = def.nodes.find((n) => n.id === nodeId);
    if (node?.type === 'join') {
      return inEdges.every((edge) => {
        const exec = this.db
          .prepare("SELECT status FROM node_executions WHERE run_id = ? AND node_id = ?")
          .get(runId, edge.from) as { status: string } | undefined;
        return exec?.status === 'completed';
      });
    }

    return inEdges.some((edge) => {
      const exec = this.db
        .prepare("SELECT status FROM node_executions WHERE run_id = ? AND node_id = ?")
        .get(runId, edge.from) as { status: string } | undefined;
      return exec?.status === 'completed';
    });
  }

  private inputArtifactsReady(node: NodeDef, runId: string): boolean {
    for (const ref of node.artifacts?.consumes ?? []) {
      const artifact = this.db
        .prepare("SELECT status FROM artifacts WHERE id = ? AND run_id = ?")
        .get(ref.id, runId) as { status: string } | undefined;
      if (!artifact || artifact.status !== 'ready') return false;
    }
    return true;
  }

  private updateWorkflowStatus(runId: string, _def: WorkflowDef): void {
    const execs = this.db
      .prepare("SELECT status FROM node_executions WHERE run_id = ?")
      .all(runId) as Array<{ status: string }>;

    const allSettled = execs.every((e) =>
      ['completed', 'failed', 'skipped'].includes(e.status),
    );
    if (!allSettled) return;

    const anyFailed = execs.some((e) => e.status === 'failed');
    const finalStatus = anyFailed ? 'failed' : 'completed';
    this.db
      .prepare('UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?')
      .run(finalStatus, new Date().toISOString(), runId);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
