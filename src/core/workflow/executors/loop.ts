import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class LoopExecutor implements NodeExecutor {
  readonly type = 'loop' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    // Iteration logic is managed by the engine via condition edges.
    return { status: 'completed', outputJson: { iteration: 1 } };
  }
}
