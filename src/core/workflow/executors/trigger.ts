import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class TriggerExecutor implements NodeExecutor {
  readonly type = 'trigger' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    return { status: 'completed' };
  }
}
