import type { NodeDef, NodeType } from './schema.js';
import type { MyrmidonConfig } from '../config/schema.js';
import type { StateStore } from '../foundation/state-store.js';
import type { ArtifactStore } from '../foundation/artifact-store.js';
import type { ExecutionBackend } from '../foundation/execution-backend.js';
import type { NotificationBus } from './notifications.js';

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting_human'
  | 'stale_blocked';

export interface NodeContext {
  node: NodeDef;
  workflowId: string;
  runId: string;
  executionId: string;
  stateStore: StateStore;
  artifactStore: ArtifactStore;
  backend: ExecutionBackend;
  config: MyrmidonConfig;
  notificationBus: NotificationBus;
  projectRoot: string;
}

export interface NodeResult {
  status: 'completed' | 'failed' | 'waiting_human' | 'running';
  outputJson?: Record<string, unknown>;
  error?: string;
}

export interface NodeExecutor {
  readonly type: NodeType;
  execute(ctx: NodeContext): Promise<NodeResult>;
}

export class ExecutorRegistry {
  private readonly map = new Map<string, NodeExecutor>();

  register(executor: NodeExecutor): void {
    this.map.set(executor.type, executor);
  }

  get(type: string): NodeExecutor {
    const executor = this.map.get(type);
    if (!executor) throw new Error(`No executor registered for node type: ${type}`);
    return executor;
  }

  has(type: string): boolean {
    return this.map.has(type);
  }
}
