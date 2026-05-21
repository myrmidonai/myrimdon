import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class ConditionExecutor implements NodeExecutor {
  readonly type = 'condition' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    // Edge routing is handled by WorkflowEngine.tick() based on edge conditions.
    // The condition node itself just signals completion.
    return { status: 'completed' };
  }
}
