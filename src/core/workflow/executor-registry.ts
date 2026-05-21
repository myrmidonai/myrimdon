import type Database from 'better-sqlite3';
import type { NodeDef, NodeType } from './schema.js';
import type { MyrmidonConfig } from '../config/schema.js';
import type { RuntimeAdapter } from './runtime-adapter.js';
import type { NotificationBus } from './notifications.js';

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting_human';

export interface NodeContext {
  node: NodeDef;
  workflowId: string;
  runId: string;
  executionId: string;
  db: Database.Database;
  config: MyrmidonConfig;
  runtimeAdapter: RuntimeAdapter;
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
