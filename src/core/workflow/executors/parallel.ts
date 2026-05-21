import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class ParallelForkExecutor implements NodeExecutor {
  readonly type = 'parallel_fork' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    // Fan-out is handled by WorkflowEngine advancing all outgoing edges.
    return { status: 'completed' };
  }
}

export class JoinExecutor implements NodeExecutor {
  readonly type = 'join' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    // WorkflowEngine.tick() only dispatches join when all upstream nodes are complete.
    return { status: 'completed' };
  }
}
