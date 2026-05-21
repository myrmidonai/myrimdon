# Sub-2b: Execution Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the execution infrastructure: NotificationBus, RuntimeAdapter, NodeExecutor registry, and the 6 simple node executors (condition / parallel_fork / join / transform / trigger / loop).

**Architecture:** All components are pure interfaces + implementations with no cross-dependencies at this layer. Executors receive a `NodeContext` and return a `NodeResult`. The registry maps node type strings to executor instances.

**Tech Stack:** vitest, TypeScript strict+NodeNext ESM, better-sqlite3 (type-only in NodeContext)

**Prerequisite:** Sub-2a must be merged (WorkflowDef schema + DB migration).

**Naming rule:** New class/type names are generic — no "myrmidon" prefix.

---

## File Map

- Create: `src/core/workflow/notifications.ts`
- Create: `src/core/workflow/runtime-adapter.ts`
- Create: `src/core/workflow/executor-registry.ts`
- Create: `src/core/workflow/executors/condition.ts`
- Create: `src/core/workflow/executors/parallel.ts`
- Create: `src/core/workflow/executors/transform.ts`
- Create: `src/core/workflow/executors/trigger.ts`
- Create: `src/core/workflow/executors/loop.ts`
- Create: `tests/core/workflow/notifications.test.ts`
- Create: `tests/core/workflow/runtime-adapter.test.ts`
- Create: `tests/core/workflow/executor-registry.test.ts`
- Create: `tests/core/workflow/executors/simple.test.ts`

---

### Task 1: NotificationBus + ConsoleBus

**Files:**
- Create: `src/core/workflow/notifications.ts`
- Create: `tests/core/workflow/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/notifications.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ConsoleBus } from '../../../src/core/workflow/notifications.js';

describe('ConsoleBus', () => {
  it('calls notify without throwing', async () => {
    const bus = new ConsoleBus();
    await expect(bus.notify('node_completed', { nodeId: 'x' })).resolves.toBeUndefined();
  });

  it('logs to console', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const bus = new ConsoleBus();
    await bus.notify('node_failed', { nodeId: 'y', error: 'boom' });
    expect(spy).toHaveBeenCalledOnce();
    const logged = spy.mock.calls[0]?.[0] as string;
    expect(logged).toContain('node_failed');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/notifications.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/notifications.ts`**

```typescript
export type NotifyEvent =
  | 'human_intervention'
  | 'node_completed'
  | 'node_failed'
  | 'workflow_completed'
  | 'agent_stuck'
  | 'phase_changed'
  | 'error';

export interface NotificationBus {
  notify(event: NotifyEvent, payload: unknown): Promise<void>;
}

export class ConsoleBus implements NotificationBus {
  async notify(event: NotifyEvent, payload: unknown): Promise<void> {
    console.log(`[${new Date().toISOString()}] [${event}]`, JSON.stringify(payload));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/notifications.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/notifications.ts tests/core/workflow/notifications.test.ts
git commit -m "feat(workflow): add NotificationBus interface and ConsoleBus"
```

---

### Task 2: RuntimeAdapter

**Files:**
- Create: `src/core/workflow/runtime-adapter.ts`
- Create: `tests/core/workflow/runtime-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/runtime-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createRuntimeAdapter, ClaudeCodeAdapter, OpenCodeAdapter } from '../../../src/core/workflow/runtime-adapter.js';

describe('createRuntimeAdapter', () => {
  it('returns ClaudeCodeAdapter for claude-code', () => {
    const adapter = createRuntimeAdapter('claude-code');
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(adapter.runtimeId).toBe('claude-code');
  });

  it('returns OpenCodeAdapter for opencode', () => {
    const adapter = createRuntimeAdapter('opencode');
    expect(adapter).toBeInstanceOf(OpenCodeAdapter);
    expect(adapter.runtimeId).toBe('opencode');
  });

  it('throws for unsupported runtime', () => {
    // @ts-expect-error — testing runtime boundary
    expect(() => createRuntimeAdapter('unknown')).toThrow();
  });
});

describe('OpenCodeAdapter.spawn', () => {
  it('throws not-implemented error', async () => {
    const adapter = new OpenCodeAdapter();
    await expect(
      adapter.spawn({ promptFile: 'x.json', cwd: '/tmp', dbPath: '/tmp/db', env: {} }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/runtime-adapter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/runtime-adapter.ts`**

```typescript
import { spawn } from 'node:child_process';
import type { RuntimeId } from '../config/schema.js';

export interface SpawnOpts {
  promptFile: string;
  cwd: string;
  dbPath: string;
  env: Record<string, string>;
}

export interface SpawnedProcess {
  pid: number;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface RuntimeAdapter {
  readonly runtimeId: RuntimeId;
  spawn(opts: SpawnOpts): Promise<SpawnedProcess>;
}

export class ClaudeCodeAdapter implements RuntimeAdapter {
  readonly runtimeId: RuntimeId = 'claude-code';

  async spawn(opts: SpawnOpts): Promise<SpawnedProcess> {
    const child = spawn('claude', ['--print', `--prompt-file=${opts.promptFile}`], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      detached: true,
      stdio: 'ignore',
    });
    if (child.pid === undefined) throw new Error('Failed to spawn claude process — pid undefined');
    child.unref();
    const pid = child.pid;
    return {
      pid,
      kill: (signal) => process.kill(pid, signal),
    };
  }
}

export class OpenCodeAdapter implements RuntimeAdapter {
  readonly runtimeId: RuntimeId = 'opencode';

  async spawn(_opts: SpawnOpts): Promise<SpawnedProcess> {
    throw new Error('OpenCode runtime is not yet implemented');
  }
}

export function createRuntimeAdapter(runtimeId: RuntimeId): RuntimeAdapter {
  if (runtimeId === 'claude-code') return new ClaudeCodeAdapter();
  if (runtimeId === 'opencode') return new OpenCodeAdapter();
  throw new Error(`Unsupported runtime: ${runtimeId}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/runtime-adapter.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/runtime-adapter.ts tests/core/workflow/runtime-adapter.test.ts
git commit -m "feat(workflow): add RuntimeAdapter interface with ClaudeCode and OpenCode adapters"
```

---

### Task 3: NodeExecutor registry

**Files:**
- Create: `src/core/workflow/executor-registry.ts`
- Create: `tests/core/workflow/executor-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/executor-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ExecutorRegistry } from '../../../src/core/workflow/executor-registry.js';
import type { NodeExecutor, NodeContext, NodeResult } from '../../../src/core/workflow/executor-registry.js';

const mockExecutor: NodeExecutor = {
  type: 'trigger',
  async execute(_ctx: NodeContext): Promise<NodeResult> {
    return { status: 'completed' };
  },
};

describe('ExecutorRegistry', () => {
  it('registers and retrieves an executor by type', () => {
    const registry = new ExecutorRegistry();
    registry.register(mockExecutor);
    expect(registry.get('trigger')).toBe(mockExecutor);
  });

  it('has() returns true for registered type', () => {
    const registry = new ExecutorRegistry();
    registry.register(mockExecutor);
    expect(registry.has('trigger')).toBe(true);
  });

  it('has() returns false for unregistered type', () => {
    const registry = new ExecutorRegistry();
    expect(registry.has('agent')).toBe(false);
  });

  it('get() throws for unregistered type', () => {
    const registry = new ExecutorRegistry();
    expect(() => registry.get('agent')).toThrow('No executor registered for node type: agent');
  });

  it('later registration overwrites earlier one', () => {
    const registry = new ExecutorRegistry();
    const first: NodeExecutor = { type: 'trigger', execute: async () => ({ status: 'completed' }) };
    const second: NodeExecutor = { type: 'trigger', execute: async () => ({ status: 'failed' }) };
    registry.register(first);
    registry.register(second);
    expect(registry.get('trigger')).toBe(second);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/executor-registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/executor-registry.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/executor-registry.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/executor-registry.ts tests/core/workflow/executor-registry.test.ts
git commit -m "feat(workflow): add NodeExecutor interface and ExecutorRegistry"
```

---

### Task 4: Simple node executors

**Files:**
- Create: `src/core/workflow/executors/condition.ts`
- Create: `src/core/workflow/executors/parallel.ts`
- Create: `src/core/workflow/executors/transform.ts`
- Create: `src/core/workflow/executors/trigger.ts`
- Create: `src/core/workflow/executors/loop.ts`
- Create: `tests/core/workflow/executors/simple.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/executors/simple.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ConditionExecutor } from '../../../../src/core/workflow/executors/condition.js';
import { ParallelForkExecutor, JoinExecutor } from '../../../../src/core/workflow/executors/parallel.js';
import { TransformExecutor } from '../../../../src/core/workflow/executors/transform.js';
import { TriggerExecutor } from '../../../../src/core/workflow/executors/trigger.js';
import { LoopExecutor } from '../../../../src/core/workflow/executors/loop.js';
import type { NodeContext } from '../../../../src/core/workflow/executor-registry.js';

// A minimal stub — we only need the fields each executor actually reads
const ctx = {} as NodeContext;

describe('Simple executors', () => {
  it('ConditionExecutor returns completed', async () => {
    const result = await new ConditionExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('ParallelForkExecutor returns completed', async () => {
    const result = await new ParallelForkExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('JoinExecutor returns completed', async () => {
    const result = await new JoinExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('TransformExecutor returns completed', async () => {
    const result = await new TransformExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('TriggerExecutor returns completed', async () => {
    const result = await new TriggerExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('LoopExecutor returns completed', async () => {
    const result = await new LoopExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('each executor has the correct type property', () => {
    expect(new ConditionExecutor().type).toBe('condition');
    expect(new ParallelForkExecutor().type).toBe('parallel_fork');
    expect(new JoinExecutor().type).toBe('join');
    expect(new TransformExecutor().type).toBe('transform');
    expect(new TriggerExecutor().type).toBe('trigger');
    expect(new LoopExecutor().type).toBe('loop');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/executors/simple.test.ts
```

Expected: FAIL — all modules not found.

- [ ] **Step 3: Create all 5 executor files**

`src/core/workflow/executors/condition.ts`:
```typescript
import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class ConditionExecutor implements NodeExecutor {
  readonly type = 'condition' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    // Edge routing is handled by WorkflowEngine.tick() based on edge conditions.
    // The condition node itself just signals completion.
    return { status: 'completed' };
  }
}
```

`src/core/workflow/executors/parallel.ts`:
```typescript
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
```

`src/core/workflow/executors/transform.ts`:
```typescript
import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class TransformExecutor implements NodeExecutor {
  readonly type = 'transform' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    return { status: 'completed' };
  }
}
```

`src/core/workflow/executors/trigger.ts`:
```typescript
import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class TriggerExecutor implements NodeExecutor {
  readonly type = 'trigger' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    return { status: 'completed' };
  }
}
```

`src/core/workflow/executors/loop.ts`:
```typescript
import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class LoopExecutor implements NodeExecutor {
  readonly type = 'loop' as const;

  async execute(_ctx: NodeContext): Promise<NodeResult> {
    // Iteration logic is managed by the engine via condition edges.
    return { status: 'completed', outputJson: { iteration: 1 } };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/executors/simple.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f \
  src/core/workflow/executors/condition.ts \
  src/core/workflow/executors/parallel.ts \
  src/core/workflow/executors/transform.ts \
  src/core/workflow/executors/trigger.ts \
  src/core/workflow/executors/loop.ts \
  tests/core/workflow/executors/simple.test.ts
git commit -m "feat(workflow): add simple node executors (condition/parallel/join/transform/trigger/loop)"
```

- [ ] **Step 6: Run full test suite**

```
npx vitest run
```

Expected: all tests PASS.
