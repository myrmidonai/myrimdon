import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';
import { buildDispatchContent } from '../../engine/dispatch-builder.js';
import { createWorktree } from '../../foundation/impl/local-execution-backend.js';

export class AgentExecutor implements NodeExecutor {
  readonly type = 'agent' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const { node, workflowId, runId, executionId, stateStore, artifactStore, backend, projectRoot } = ctx;

    // Build DISPATCH.md content
    const dispatchContent = await buildDispatchContent({
      workflowName: workflowId,
      node,
      runId,
      projectRoot,
      artifactStore,
    });

    // Create worktree for this node
    const worktreePath = createWorktree(projectRoot, runId, node.id);

    // Write DISPATCH.md to worktree
    const dispatchFilePath = resolve(worktreePath, 'DISPATCH.md');
    mkdirSync(dirname(dispatchFilePath), { recursive: true });
    writeFileSync(dispatchFilePath, dispatchContent, 'utf8');

    // Spawn agent via backend
    try {
      const handle = await backend.spawn({
        execId: executionId,
        worktreePath,
        dispatchFilePath,
      });

      // Record process in DB for drift detection
      const now = new Date().toISOString();
      (stateStore as any).db?.prepare(
        'INSERT INTO executor_procs (session_id, agent_id, task_id, pid, proc_type, started_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(executionId, node.id, node.id, handle.pid, 'agent', now);

      return { status: 'running', outputJson: { handle, worktreePath, dispatchFilePath } };
    } catch (err) {
      return { status: 'failed', error: String(err) };
    }
  }
}
