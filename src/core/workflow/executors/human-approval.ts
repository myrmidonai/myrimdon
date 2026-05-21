import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class HumanApprovalExecutor implements NodeExecutor {
  readonly type = 'human_approval' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const approval = ctx.node.humanApproval;
    if (!approval) {
      return { status: 'failed', error: 'human_approval node is missing humanApproval config' };
    }

    const now = new Date().toISOString();
    const confirmation = JSON.stringify({
      nodeId: ctx.node.id,
      message: approval.message,
      runId: ctx.runId,
      allowedActions: approval.allowedActions,
      onTimeout: approval.onTimeout,
      timeoutMs: approval.timeoutMs ?? 600_000,
      requestedAt: now,
    });

    ctx.db
      .prepare(
        'UPDATE workflow SET pending_confirmation = ?, confirmation_requested_at = ? WHERE id = 1',
      )
      .run(confirmation, now);

    ctx.db
      .prepare(
        "UPDATE node_executions SET status = 'waiting_human', started_at = ? WHERE id = ?",
      )
      .run(now, ctx.executionId);

    await ctx.notificationBus.notify('human_intervention', {
      nodeId: ctx.node.id,
      message: approval.message,
      runId: ctx.runId,
    });

    return { status: 'waiting_human' };
  }
}
