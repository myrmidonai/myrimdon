import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class TransformExecutor implements NodeExecutor {
  readonly type = 'transform' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    return { status: 'completed' };
  }
}
