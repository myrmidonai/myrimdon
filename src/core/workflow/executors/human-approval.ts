import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class HumanApprovalExecutor implements NodeExecutor {
  readonly type = 'human_approval' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const approval = ctx.node.humanApproval;
    if (!approval) {
      return { status: 'failed', error: 'human_approval node is missing humanApproval config' };
    }

    const now = new Date().toISOString();

    // Emit waiting_human event
    await ctx.stateStore.appendEvent({
      run_id: ctx.runId,
      type: 'WAITING_HUMAN',
      payload_json: JSON.stringify({
        nodeId: ctx.node.id,
        message: approval.message,
        allowedActions: approval.allowedActions,
        onTimeout: approval.onTimeout,
        timeoutMs: approval.timeoutMs ?? 600_000,
        requestedAt: now,
      }),
      idempotency_key: `${ctx.executionId}:waiting_human`,
      created_at: now,
    });

    await ctx.notificationBus.notify('human_intervention', {
      nodeId: ctx.node.id,
      message: approval.message,
      runId: ctx.runId,
    });

    return { status: 'waiting_human' };
  }
}
