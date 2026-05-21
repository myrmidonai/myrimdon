# Sub-2d: Engine Runtime + CLI Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TimerManager, AgentMonitor, WorkflowEngine core, the software-dev-agile built-in template, and all CLI commands (`start / stop / status / workflow`). This is the final sub-plan for Sub-2 — after it completes, `myrmidon start` runs a workflow end-to-end.

**Architecture:**
- `TimerManager` wraps `setInterval` with overlap protection; each timer callback skips execution if still running
- `AgentMonitor` uses TimerManager (T2/T4) to kill dead PIDs and emit `agent_stuck` events
- `WorkflowEngine.tick()` (called by T1) queries `node_executions` for `pending` rows, checks upstream completion, dispatches via ExecutorRegistry, then polls `running` rows against `executor_procs`
- CLI commands are thin Commander wrappers around the engine; no TUI in Sub-2 (console output only)

**Prerequisite:** Sub-2a, Sub-2b, Sub-2c all merged.

**Naming rule:** Generic internal names — no "myrmidon" prefix.

---

## File Map

- Create: `src/core/workflow/timers.ts`
- Create: `src/core/workflow/monitor.ts`
- Create: `src/core/workflow/engine.ts`
- Create: `src/core/templates/software-dev-agile.ts`
- Create: `src/cli/commands/start.ts`
- Create: `src/cli/commands/stop.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/workflow.ts`
- Modify: `src/cli/index.ts`
- Create: `tests/core/workflow/timers.test.ts`
- Create: `tests/core/workflow/monitor.test.ts`
- Create: `tests/core/workflow/engine.test.ts`
- Create: `tests/core/templates/software-dev-agile.test.ts`
- Create: `tests/integration/workflow-engine.test.ts`

---

### Task 1: TimerManager

**Files:**
- Create: `src/core/workflow/timers.ts`
- Create: `tests/core/workflow/timers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/timers.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TimerManager } from '../../../src/core/workflow/timers.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('TimerManager', () => {
  it('fires callback after interval', async () => {
    vi.useFakeTimers();
    const mgr = new TimerManager();
    const calls: number[] = [];
    mgr.start('workflow-poll', { intervalMs: 100, callback: async () => { calls.push(Date.now()); } });
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    mgr.stopAll();
  });

  it('isRunning() returns true after start, false after stop', () => {
    vi.useFakeTimers();
    const mgr = new TimerManager();
    mgr.start('agent-heartbeat', { intervalMs: 1000, callback: async () => undefined });
    expect(mgr.isRunning('agent-heartbeat')).toBe(true);
    mgr.stop('agent-heartbeat');
    expect(mgr.isRunning('agent-heartbeat')).toBe(false);
  });

  it('stopAll() clears all timers', () => {
    vi.useFakeTimers();
    const mgr = new TimerManager();
    mgr.start('workflow-poll', { intervalMs: 1000, callback: async () => undefined });
    mgr.start('agent-heartbeat', { intervalMs: 1000, callback: async () => undefined });
    mgr.stopAll();
    expect(mgr.isRunning('workflow-poll')).toBe(false);
    expect(mgr.isRunning('agent-heartbeat')).toBe(false);
  });

  it('overlap protection: does not fire again while previous callback is still running', async () => {
    vi.useFakeTimers();
    const mgr = new TimerManager();
    let concurrent = 0;
    let maxConcurrent = 0;
    mgr.start('workflow-poll', {
      intervalMs: 50,
      callback: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        concurrent--;
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(maxConcurrent).toBe(1);
    mgr.stopAll();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/timers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/timers.ts`**

```typescript
export type TimerId =
  | 'workflow-poll'
  | 'agent-heartbeat'
  | 'client-timeout'
  | 'stuck-detection'
  | 'state-consistency'
  | 'external-dep-watch';

export interface TimerConfig {
  intervalMs: number;
  callback: () => Promise<void>;
}

export class TimerManager {
  private readonly handles = new Map<TimerId, ReturnType<typeof setInterval>>();
  private readonly active = new Set<TimerId>();

  start(id: TimerId, config: TimerConfig): void {
    this.stop(id);
    const handle = setInterval(() => {
      if (this.active.has(id)) return; // overlap protection
      this.active.add(id);
      config.callback().finally(() => this.active.delete(id));
    }, config.intervalMs);
    this.handles.set(id, handle);
  }

  stop(id: TimerId): void {
    const handle = this.handles.get(id);
    if (handle !== undefined) {
      clearInterval(handle);
      this.handles.delete(id);
    }
  }

  stopAll(): void {
    for (const id of [...this.handles.keys()]) this.stop(id);
  }

  isRunning(id: TimerId): boolean {
    return this.handles.has(id);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/timers.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/timers.ts tests/core/workflow/timers.test.ts
git commit -m "feat(workflow): add TimerManager with overlap protection"
```

---

### Task 2: AgentMonitor

**Files:**
- Create: `src/core/workflow/monitor.ts`
- Create: `tests/core/workflow/monitor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/monitor.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../src/core/database/client.js';
import { AgentMonitor } from '../../../src/core/workflow/monitor.js';
import { ConsoleBus } from '../../../src/core/workflow/notifications.js';

let tmpDir: string;
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('AgentMonitor.checkHeartbeats', () => {
  it('marks node_execution as failed when PID is not alive', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'monitor-test-'));
    const db = openDatabase(tmpDir);
    const now = new Date().toISOString();

    // Insert a running node_execution
    db.prepare(
      "INSERT INTO node_executions (id, run_id, node_id, status, attempt, started_at) VALUES (?, ?, ?, 'running', 1, ?)",
    ).run('exec-1', 'run-1', 'node-1', now);

    // Insert executor_proc with a PID we know is dead (PID 1 will throw EPERM not ESRCH on macOS,
    // so use PID 0 which is always invalid as a kill target)
    db.prepare(
      'INSERT INTO executor_procs (session_id, agent_id, task_id, pid, proc_type, started_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('exec-1', 'node-1', 'node-1', 99999999, 'agent', now);

    const bus = new ConsoleBus();
    const monitor = new AgentMonitor(db, bus, { stuckThresholdMs: 60_000, heartbeatIntervalMs: 15_000 });
    await monitor.checkHeartbeats();

    const exec = db
      .prepare('SELECT status FROM node_executions WHERE id = ?')
      .get('exec-1') as { status: string } | undefined;
    expect(exec?.status).toBe('failed');
    db.close();
  });
});

describe('AgentMonitor.checkStuckAgents', () => {
  it('emits agent_stuck for nodes running past threshold', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'monitor-test-'));
    const db = openDatabase(tmpDir);
    const staleTime = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago

    db.prepare(
      "INSERT INTO node_executions (id, run_id, node_id, status, attempt, started_at) VALUES (?, ?, ?, 'running', 1, ?)",
    ).run('exec-2', 'run-1', 'node-2', staleTime);

    const events: string[] = [];
    const bus = {
      async notify(event: string) { events.push(event); },
    };
    const monitor = new AgentMonitor(db, bus as never, { stuckThresholdMs: 60_000, heartbeatIntervalMs: 15_000 });
    await monitor.checkStuckAgents();

    expect(events).toContain('agent_stuck');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/monitor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/monitor.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { NotificationBus } from './notifications.js';

export interface MonitorConfig {
  stuckThresholdMs: number;
  heartbeatIntervalMs: number;
}

interface ExecProc {
  id: number;
  session_id: string;
  agent_id: string;
  pid: number;
}

interface NodeExec {
  status: string;
}

export class AgentMonitor {
  constructor(
    private readonly db: Database.Database,
    private readonly bus: NotificationBus,
    private readonly config: MonitorConfig,
  ) {}

  async checkHeartbeats(): Promise<void> {
    const procs = this.db
      .prepare("SELECT id, session_id, agent_id, pid FROM executor_procs WHERE killed_at IS NULL")
      .all() as ExecProc[];

    for (const proc of procs) {
      if (isPidAlive(proc.pid)) continue;

      const now = new Date().toISOString();
      this.db.prepare('UPDATE executor_procs SET killed_at = ? WHERE id = ?').run(now, proc.id);

      const exec = this.db
        .prepare("SELECT status FROM node_executions WHERE id = ?")
        .get(proc.session_id) as NodeExec | undefined;

      if (exec?.status === 'running') {
        this.db
          .prepare(
            "UPDATE node_executions SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
          )
          .run('Process died unexpectedly', now, proc.session_id);
        await this.bus.notify('node_failed', { sessionId: proc.session_id, agentId: proc.agent_id });
      }
    }
  }

  async checkStuckAgents(): Promise<void> {
    const threshold = new Date(Date.now() - this.config.stuckThresholdMs).toISOString();
    const stuck = this.db
      .prepare(
        "SELECT id, node_id FROM node_executions WHERE status = 'running' AND started_at < ?",
      )
      .all(threshold) as Array<{ id: string; node_id: string }>;

    for (const exec of stuck) {
      await this.bus.notify('agent_stuck', { executionId: exec.id, nodeId: exec.node_id });
    }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/monitor.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/monitor.ts tests/core/workflow/monitor.test.ts
git commit -m "feat(workflow): add AgentMonitor for heartbeat and stuck detection"
```

---

### Task 3: WorkflowEngine

**Files:**
- Create: `src/core/workflow/engine.ts`
- Create: `tests/core/workflow/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/engine.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../src/core/database/client.js';
import { WorkflowEngine } from '../../../src/core/workflow/engine.js';
import { ExecutorRegistry } from '../../../src/core/workflow/executor-registry.js';
import { TriggerExecutor } from '../../../src/core/workflow/executors/trigger.js';
import { ConditionExecutor } from '../../../src/core/workflow/executors/condition.js';
import { ConsoleBus } from '../../../src/core/workflow/notifications.js';
import { ClaudeCodeAdapter } from '../../../src/core/workflow/runtime-adapter.js';
import { defineWorkflow } from '../../../src/core/workflow/schema.js';
import type { MyrmidonConfig } from '../../../src/core/config/schema.js';

let tmpDir: string;
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const testConfig: MyrmidonConfig = {
  project: { name: 'test', lang: 'zh', description: '' },
  tui: { lang: 'zh' },
  audit: { retention: '30d' },
  basePort: 31000,
  executors: { sonnet: { model: 'claude-sonnet-4-6', maxContextTokens: 200_000 } },
  agentRoles: {},
  agents: {},
  externalDependencies: [],
  runtime: { maxRetries: 3 },
  dispatch: {
    contextPressureThreshold: 0.7,
    wrapUpSignalMessage: 'wrap up',
    maxDispatchPromptTokens: 8000,
    toolResultMaxChars: 800,
    tokenProfile: 'balanced',
    contextEstimateThresholds: { small: 8000, medium: 32000, large: 100000 },
  },
  notifications: { channels: [] },
};

const simpleTwoNodeWorkflow = defineWorkflow({
  id: 'test-flow',
  version: '1.0.0',
  name: 'Test Two-Node Flow',
  nodes: [
    { id: 'start', type: 'trigger', name: 'Start' },
    { id: 'end', type: 'condition', name: 'End' },
  ],
  edges: [{ from: 'start', to: 'end', condition: 'success' }],
});

function makeEngine(db: ReturnType<typeof openDatabase>, projectRoot: string) {
  const registry = new ExecutorRegistry();
  registry.register(new TriggerExecutor());
  registry.register(new ConditionExecutor());
  return new WorkflowEngine(db, registry, new ClaudeCodeAdapter(), new ConsoleBus(), testConfig, projectRoot);
}

describe('WorkflowEngine.register + load', () => {
  it('registers a workflow and loads it back', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    const engine = makeEngine(db, tmpDir);
    engine.register(simpleTwoNodeWorkflow);
    const loaded = engine.load('test-flow');
    expect(loaded.id).toBe('test-flow');
    expect(loaded.nodes).toHaveLength(2);
    db.close();
  });

  it('throws when loading a workflow that does not exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    const engine = makeEngine(db, tmpDir);
    expect(() => engine.load('nonexistent')).toThrow("Workflow 'nonexistent' not found");
    db.close();
  });
});

describe('WorkflowEngine.start', () => {
  it('creates a workflow_runs row and node_executions for all nodes', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    const engine = makeEngine(db, tmpDir);
    engine.register(simpleTwoNodeWorkflow);
    const runId = await engine.start('test-flow');

    const run = db
      .prepare('SELECT status FROM workflow_runs WHERE id = ?')
      .get(runId) as { status: string } | undefined;
    expect(run?.status).toBe('running');

    const execs = db
      .prepare('SELECT node_id, status FROM node_executions WHERE run_id = ?')
      .all(runId) as Array<{ node_id: string; status: string }>;
    expect(execs).toHaveLength(2);
    expect(execs.map((e) => e.node_id).sort()).toEqual(['end', 'start']);
    db.close();
  });
});

describe('WorkflowEngine.tick', () => {
  it('advances pending entry nodes to completed on first tick (trigger + condition)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    const engine = makeEngine(db, tmpDir);
    engine.register(simpleTwoNodeWorkflow);
    const runId = await engine.start('test-flow');

    // First tick: executes 'start' (trigger)
    await engine.tick();
    // Second tick: executes 'end' (condition, now unblocked)
    await engine.tick();

    const statuses = db
      .prepare('SELECT node_id, status FROM node_executions WHERE run_id = ?')
      .all(runId) as Array<{ node_id: string; status: string }>;
    const byId = Object.fromEntries(statuses.map((s) => [s.node_id, s.status]));
    expect(byId['start']).toBe('completed');
    expect(byId['end']).toBe('completed');
    db.close();
  });

  it('marks workflow_run as completed when all nodes complete', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    const engine = makeEngine(db, tmpDir);
    engine.register(simpleTwoNodeWorkflow);
    const runId = await engine.start('test-flow');
    await engine.tick();
    await engine.tick();

    const run = db
      .prepare('SELECT status FROM workflow_runs WHERE id = ?')
      .get(runId) as { status: string } | undefined;
    expect(run?.status).toBe('completed');
    db.close();
  });
});

describe('WorkflowEngine.recover', () => {
  it('finds the most recent running workflow run and sets runId', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    const engine = makeEngine(db, tmpDir);
    engine.register(simpleTwoNodeWorkflow);
    const runId = await engine.start('test-flow');

    const engine2 = makeEngine(db, tmpDir);
    await engine2.recover();
    // After recover, engine2 should be able to tick and complete the workflow
    await engine2.tick();
    await engine2.tick();

    const run = db
      .prepare('SELECT status FROM workflow_runs WHERE id = ?')
      .get(runId) as { status: string } | undefined;
    expect(run?.status).toBe('completed');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/engine.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/engine.ts`**

```typescript
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { WorkflowDef, NodeDef } from './schema.js';
import type { ExecutorRegistry, NodeStatus } from './executor-registry.js';
import type { RuntimeAdapter } from './runtime-adapter.js';
import type { NotificationBus } from './notifications.js';
import type { MyrmidonConfig } from '../config/schema.js';

interface NodeExecution {
  id: string;
  run_id: string;
  node_id: string;
  status: NodeStatus;
  attempt: number;
}

export class WorkflowEngine {
  private currentDef: WorkflowDef | null = null;
  private currentRunId: string | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly registry: ExecutorRegistry,
    private readonly runtimeAdapter: RuntimeAdapter,
    private readonly notificationBus: NotificationBus,
    private readonly config: MyrmidonConfig,
    private readonly projectRoot: string,
  ) {}

  register(def: WorkflowDef): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT OR REPLACE INTO workflows (id, version, name, def_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(def.id, def.version, def.name, JSON.stringify(def), now, now);

    const filePath = resolve(this.projectRoot, '.myrmidon', 'workflows', `${def.id}.json`);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf8');
  }

  load(workflowId: string): WorkflowDef {
    const row = this.db
      .prepare('SELECT def_json FROM workflows WHERE id = ?')
      .get(workflowId) as { def_json: string } | undefined;
    if (!row) throw new Error(`Workflow '${workflowId}' not found`);
    this.currentDef = JSON.parse(row.def_json) as WorkflowDef;
    return this.currentDef;
  }

  async start(workflowId: string, contextJson?: Record<string, unknown>): Promise<string> {
    this.currentDef = this.load(workflowId);
    this.currentRunId = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        "INSERT INTO workflow_runs (id, workflow_id, status, started_at, context_json) VALUES (?, ?, 'running', ?, ?)",
      )
      .run(this.currentRunId, workflowId, now, contextJson ? JSON.stringify(contextJson) : null);

    for (const node of this.currentDef.nodes) {
      const execId = randomUUID();
      this.db
        .prepare(
          "INSERT INTO node_executions (id, run_id, node_id, status, attempt) VALUES (?, ?, ?, 'pending', 1)",
        )
        .run(execId, this.currentRunId, node.id);

      for (const artifact of node.artifacts?.produces ?? []) {
        this.db
          .prepare(
            'INSERT OR IGNORE INTO artifacts (id, workflow_id, run_id, node_id, file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(artifact.id, workflowId, this.currentRunId, node.id, artifact.path, 'pending', now);
      }
    }

    return this.currentRunId;
  }

  async tick(): Promise<void> {
    if (!this.currentDef || !this.currentRunId) return;
    const runId = this.currentRunId;
    const def = this.currentDef;

    // Dispatch pending nodes whose upstreams are all done
    const pending = this.db
      .prepare("SELECT * FROM node_executions WHERE run_id = ? AND status = 'pending'")
      .all(runId) as NodeExecution[];

    for (const exec of pending) {
      const node = def.nodes.find((n) => n.id === exec.node_id);
      if (!node) continue;
      if (!this.upstreamsComplete(def, runId, node.id)) continue;
      if (!this.inputArtifactsReady(node, runId)) continue;
      await this.dispatchNode(node, exec, runId);
    }

    // Poll running nodes for async completion
    await this.pollRunningNodes(runId, def);

    // Check overall completion
    this.updateWorkflowStatus(runId, def);
  }

  async recover(): Promise<void> {
    const run = this.db
      .prepare("SELECT id, workflow_id FROM workflow_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1")
      .get() as { id: string; workflow_id: string } | undefined;
    if (!run) return;

    this.currentDef = this.load(run.workflow_id);
    this.currentRunId = run.id;

    // Reset running nodes whose process is dead back to pending
    const running = this.db
      .prepare("SELECT id FROM node_executions WHERE run_id = ? AND status = 'running'")
      .all(this.currentRunId) as Array<{ id: string }>;

    for (const exec of running) {
      const proc = this.db
        .prepare("SELECT pid FROM executor_procs WHERE session_id = ? AND killed_at IS NULL")
        .get(exec.id) as { pid: number } | undefined;

      if (!proc || !isPidAlive(proc.pid)) {
        this.db
          .prepare("UPDATE node_executions SET status = 'pending', started_at = NULL WHERE id = ?")
          .run(exec.id);
      }
    }
  }

  private async dispatchNode(node: NodeDef, exec: NodeExecution, runId: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE node_executions SET status = 'running', started_at = ? WHERE id = ?")
      .run(now, exec.id);

    let result: { status: string; outputJson?: Record<string, unknown>; error?: string };
    try {
      const executor = this.registry.get(node.type);
      result = await executor.execute({
        node,
        workflowId: this.currentDef!.id,
        runId,
        executionId: exec.id,
        db: this.db,
        config: this.config,
        runtimeAdapter: this.runtimeAdapter,
        notificationBus: this.notificationBus,
        projectRoot: this.projectRoot,
      });
    } catch (err) {
      result = { status: 'failed', error: String(err) };
    }

    if (result.status === 'running' || result.status === 'waiting_human') return;

    const completedAt = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE node_executions SET status = ?, completed_at = ?, output_json = ?, error = ? WHERE id = ?',
      )
      .run(
        result.status,
        completedAt,
        result.outputJson ? JSON.stringify(result.outputJson) : null,
        result.error ?? null,
        exec.id,
      );

    if (result.status === 'completed') {
      for (const artifact of node.artifacts?.produces ?? []) {
        this.db
          .prepare("UPDATE artifacts SET status = 'ready' WHERE id = ? AND run_id = ?")
          .run(artifact.id, runId);
      }
      await this.notificationBus.notify('node_completed', { nodeId: node.id, runId });
    } else {
      await this.notificationBus.notify('node_failed', { nodeId: node.id, runId, error: result.error });
    }
  }

  private async pollRunningNodes(runId: string, def: WorkflowDef): Promise<void> {
    const running = this.db
      .prepare("SELECT * FROM node_executions WHERE run_id = ? AND status = 'running'")
      .all(runId) as NodeExecution[];

    for (const exec of running) {
      const node = def.nodes.find((n) => n.id === exec.node_id);
      if (!node) continue;

      // Check agents table: agent sets status='completed' when done
      const agent = this.db
        .prepare("SELECT status FROM agents WHERE current_task = ?")
        .get(node.id) as { status: string } | undefined;

      if (agent?.status === 'completed') {
        const now = new Date().toISOString();
        this.db
          .prepare("UPDATE node_executions SET status = 'completed', completed_at = ? WHERE id = ?")
          .run(now, exec.id);
        for (const artifact of node.artifacts?.produces ?? []) {
          this.db
            .prepare("UPDATE artifacts SET status = 'ready' WHERE id = ? AND run_id = ?")
            .run(artifact.id, runId);
        }
        await this.notificationBus.notify('node_completed', { nodeId: node.id, runId });
      }
    }
  }

  private upstreamsComplete(def: WorkflowDef, runId: string, nodeId: string): boolean {
    const inEdges = def.edges.filter((e) => e.to === nodeId);
    if (inEdges.length === 0) return true;

    const node = def.nodes.find((n) => n.id === nodeId);
    if (node?.type === 'join') {
      return inEdges.every((edge) => {
        const exec = this.db
          .prepare("SELECT status FROM node_executions WHERE run_id = ? AND node_id = ?")
          .get(runId, edge.from) as { status: string } | undefined;
        return exec?.status === 'completed';
      });
    }

    return inEdges.some((edge) => {
      const exec = this.db
        .prepare("SELECT status FROM node_executions WHERE run_id = ? AND node_id = ?")
        .get(runId, edge.from) as { status: string } | undefined;
      return exec?.status === 'completed';
    });
  }

  private inputArtifactsReady(node: NodeDef, runId: string): boolean {
    for (const ref of node.artifacts?.consumes ?? []) {
      const artifact = this.db
        .prepare("SELECT status FROM artifacts WHERE id = ? AND run_id = ?")
        .get(ref.id, runId) as { status: string } | undefined;
      if (!artifact || artifact.status !== 'ready') return false;
    }
    return true;
  }

  private updateWorkflowStatus(runId: string, _def: WorkflowDef): void {
    const execs = this.db
      .prepare("SELECT status FROM node_executions WHERE run_id = ?")
      .all(runId) as Array<{ status: string }>;

    const allSettled = execs.every((e) =>
      ['completed', 'failed', 'skipped'].includes(e.status),
    );
    if (!allSettled) return;

    const anyFailed = execs.some((e) => e.status === 'failed');
    const finalStatus = anyFailed ? 'failed' : 'completed';
    this.db
      .prepare('UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?')
      .run(finalStatus, new Date().toISOString(), runId);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/engine.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/engine.ts tests/core/workflow/engine.test.ts
git commit -m "feat(workflow): add WorkflowEngine (load/start/tick/recover)"
```

---

### Task 4: software-dev-agile template

**Files:**
- Create: `src/core/templates/software-dev-agile.ts`
- Create: `tests/core/templates/software-dev-agile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/templates/software-dev-agile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { softwareDevAgileWorkflow } from '../../../src/core/templates/software-dev-agile.js';

describe('softwareDevAgileWorkflow', () => {
  it('has the expected id', () => {
    expect(softwareDevAgileWorkflow.id).toBe('software-dev-agile');
  });

  it('has at least 8 nodes', () => {
    expect(softwareDevAgileWorkflow.nodes.length).toBeGreaterThanOrEqual(8);
  });

  it('every edge references existing node ids', () => {
    const nodeIds = new Set(softwareDevAgileWorkflow.nodes.map((n) => n.id));
    for (const edge of softwareDevAgileWorkflow.edges) {
      expect(nodeIds.has(edge.from), `Edge from="${edge.from}" not in nodes`).toBe(true);
      expect(nodeIds.has(edge.to), `Edge to="${edge.to}" not in nodes`).toBe(true);
    }
  });

  it('has exactly one trigger node', () => {
    const triggers = softwareDevAgileWorkflow.nodes.filter((n) => n.type === 'trigger');
    expect(triggers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/templates/software-dev-agile.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/templates/software-dev-agile.ts`**

```typescript
import { defineWorkflow } from '../workflow/schema.js';

export const softwareDevAgileWorkflow = defineWorkflow({
  id: 'software-dev-agile',
  version: '1.0.0',
  name: '软件开发（敏捷）',
  description: 'Built-in agile software development workflow: requirements → PRD → design → sprint → parallel coding → QA → delivery',
  nodes: [
    {
      id: 'start',
      type: 'trigger',
      name: '启动',
    },
    {
      id: 'requirements',
      type: 'agent',
      name: '需求收集',
      agentRole: 'pm',
      executor: 'sonnet',
      artifacts: {
        consumes: [],
        produces: [
          { id: 'requirements-raw', path: 'docs/requirements/raw/requirements-raw.md' },
          { id: 'modules', path: 'docs/requirements/modules.md' },
        ],
      },
      outputValidator: { required: ['requirements-raw', 'modules'] },
      humanApproval: {
        message: '需求摘要已生成，请确认后继续',
        timeoutMs: 600_000,
        onTimeout: 'auto_approve',
        allowedActions: ['approve', 'reject', 'defer'],
        onReject: 'requirements',
      },
    },
    {
      id: 'prd',
      type: 'agent',
      name: 'PRD 编写',
      agentRole: 'pm',
      executor: 'sonnet',
      artifacts: {
        consumes: [{ id: 'requirements-raw' }, { id: 'modules' }],
        produces: [{ id: 'prd-doc', path: 'docs/design/prd/prd-v1.md' }],
      },
      outputValidator: { required: ['prd-doc'] },
      humanApproval: {
        message: 'PRD 已完成，请审核',
        timeoutMs: 1_800_000,
        onTimeout: 'auto_approve',
        allowedActions: ['approve', 'reject'],
        onReject: 'prd',
      },
    },
    {
      id: 'design',
      type: 'agent',
      name: '技术设计',
      agentRole: 'arch',
      executor: 'sonnet',
      artifacts: {
        consumes: [{ id: 'prd-doc' }],
        produces: [{ id: 'design-doc', path: 'docs/design/architecture/design-v1.md' }],
      },
      outputValidator: { required: ['design-doc'] },
    },
    {
      id: 'sprint-plan',
      type: 'agent',
      name: 'Sprint 规划',
      agentRole: 'pm',
      executor: 'sonnet',
      artifacts: {
        consumes: [{ id: 'design-doc' }],
        produces: [{ id: 'sprint-plan', path: 'docs/sprints/sprint-1/plan.md' }],
      },
    },
    {
      id: 'coding-fork',
      type: 'parallel_fork',
      name: '并行开发分叉',
    },
    {
      id: 'coding',
      type: 'agent',
      name: '编码',
      agentRole: 'coder',
      executor: 'sonnet',
      artifacts: {
        consumes: [{ id: 'sprint-plan' }, { id: 'design-doc' }],
        produces: [{ id: 'impl', path: 'src/implementation-complete.md' }],
      },
    },
    {
      id: 'coding-join',
      type: 'join',
      name: '等待编码完成',
    },
    {
      id: 'qa',
      type: 'agent',
      name: 'QA 测试',
      agentRole: 'qa',
      executor: 'sonnet',
      artifacts: {
        consumes: [{ id: 'impl' }],
        produces: [{ id: 'qa-report', path: 'docs/qa/report-v1.md' }],
      },
    },
    {
      id: 'qa-gate',
      type: 'condition',
      name: 'QA 通过判断',
    },
    {
      id: 'bug-fix',
      type: 'agent',
      name: '缺陷修复',
      agentRole: 'coder',
      executor: 'sonnet',
      artifacts: {
        consumes: [{ id: 'qa-report' }],
        produces: [{ id: 'impl' }],
      },
    },
    {
      id: 'delivery',
      type: 'human_approval',
      name: 'Sprint 交付确认',
      humanApproval: {
        message: 'QA 通过，Sprint 已完成，请确认交付',
        timeoutMs: 600_000,
        onTimeout: 'auto_approve',
        allowedActions: ['approve', 'reject'],
        onReject: 'qa',
      },
    },
  ],
  edges: [
    { from: 'start', to: 'requirements', condition: 'success' },
    { from: 'requirements', to: 'prd', condition: 'approved' },
    { from: 'requirements', to: 'requirements', condition: 'rejected' },
    { from: 'prd', to: 'design', condition: 'approved' },
    { from: 'prd', to: 'prd', condition: 'rejected' },
    { from: 'design', to: 'sprint-plan', condition: 'success' },
    { from: 'sprint-plan', to: 'coding-fork', condition: 'success' },
    { from: 'coding-fork', to: 'coding', condition: 'success' },
    { from: 'coding', to: 'coding-join', condition: 'success' },
    { from: 'coding-join', to: 'qa', condition: 'success' },
    { from: 'qa', to: 'qa-gate', condition: 'success' },
    { from: 'qa-gate', to: 'delivery', condition: 'passed' },
    { from: 'qa-gate', to: 'bug-fix', condition: 'failed' },
    { from: 'bug-fix', to: 'qa', condition: 'success' },
  ],
});
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/templates/software-dev-agile.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/templates/software-dev-agile.ts tests/core/templates/software-dev-agile.test.ts
git commit -m "feat(templates): add software-dev-agile built-in workflow template"
```

---

### Task 5: CLI commands + index.ts update

**Files:**
- Create: `src/cli/commands/start.ts`
- Create: `src/cli/commands/stop.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/workflow.ts`
- Modify: `src/cli/index.ts`
- Create: `tests/integration/workflow-engine.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/workflow-engine.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase } from '../../src/core/database/client.js';
import { WorkflowEngine } from '../../src/core/workflow/engine.js';
import { ExecutorRegistry } from '../../src/core/workflow/executor-registry.js';
import { TriggerExecutor } from '../../src/core/workflow/executors/trigger.js';
import { ConditionExecutor } from '../../src/core/workflow/executors/condition.js';
import { ConsoleBus } from '../../src/core/workflow/notifications.js';
import { ClaudeCodeAdapter } from '../../src/core/workflow/runtime-adapter.js';
import { defineWorkflow } from '../../src/core/workflow/schema.js';
import type { MyrmidonConfig } from '../../src/core/config/schema.js';

let tmpDir: string;
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const config: MyrmidonConfig = {
  project: { name: 'integration-test', lang: 'zh', description: '' },
  tui: { lang: 'zh' },
  audit: { retention: '30d' },
  basePort: 31000,
  executors: { sonnet: { model: 'claude-sonnet-4-6', maxContextTokens: 200_000 } },
  agentRoles: {},
  agents: {},
  externalDependencies: [],
  runtime: { maxRetries: 3 },
  dispatch: {
    contextPressureThreshold: 0.7,
    wrapUpSignalMessage: 'wrap up',
    maxDispatchPromptTokens: 8000,
    toolResultMaxChars: 800,
    tokenProfile: 'balanced',
    contextEstimateThresholds: { small: 8000, medium: 32000, large: 100000 },
  },
  notifications: { channels: [] },
};

describe('Workflow engine integration', () => {
  it('runs a 3-node linear workflow to completion', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'integration-'));
    const db = openDatabase(tmpDir);

    const registry = new ExecutorRegistry();
    registry.register(new TriggerExecutor());
    registry.register(new ConditionExecutor());

    const engine = new WorkflowEngine(db, registry, new ClaudeCodeAdapter(), new ConsoleBus(), config, tmpDir);

    const wf = defineWorkflow({
      id: 'linear-test',
      version: '1.0.0',
      name: 'Linear Test',
      nodes: [
        { id: 'a', type: 'trigger', name: 'A' },
        { id: 'b', type: 'condition', name: 'B' },
        { id: 'c', type: 'condition', name: 'C' },
      ],
      edges: [
        { from: 'a', to: 'b', condition: 'success' },
        { from: 'b', to: 'c', condition: 'success' },
      ],
    });

    engine.register(wf);
    const runId = await engine.start('linear-test');

    // Tick until completion (max 10 ticks)
    for (let i = 0; i < 10; i++) {
      await engine.tick();
      const run = db
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(runId) as { status: string } | undefined;
      if (run?.status === 'completed') break;
    }

    const run = db
      .prepare('SELECT status FROM workflow_runs WHERE id = ?')
      .get(runId) as { status: string } | undefined;
    expect(run?.status).toBe('completed');

    const execs = db
      .prepare('SELECT node_id, status FROM node_executions WHERE run_id = ?')
      .all(runId) as Array<{ node_id: string; status: string }>;
    expect(execs.every((e) => e.status === 'completed')).toBe(true);
    db.close();
  });
});
```

- [ ] **Step 2: Run integration test to verify it fails**

```
npx vitest run tests/integration/workflow-engine.test.ts
```

Expected: FAIL — module not found (CLI commands not yet created).

- [ ] **Step 3: Create `src/cli/commands/start.ts`**

```typescript
import { Command } from 'commander';
import { loadConfig } from '../../core/config/loader.js';
import { openDatabase } from '../../core/database/client.js';
import { WorkflowEngine } from '../../core/workflow/engine.js';
import { ExecutorRegistry } from '../../core/workflow/executor-registry.js';
import { TriggerExecutor } from '../../core/workflow/executors/trigger.js';
import { ConditionExecutor } from '../../core/workflow/executors/condition.js';
import { ParallelForkExecutor, JoinExecutor } from '../../core/workflow/executors/parallel.js';
import { TransformExecutor } from '../../core/workflow/executors/transform.js';
import { LoopExecutor } from '../../core/workflow/executors/loop.js';
import { HumanApprovalExecutor } from '../../core/workflow/executors/human-approval.js';
import { AgentExecutor } from '../../core/workflow/executors/agent.js';
import { TimerManager } from '../../core/workflow/timers.js';
import { AgentMonitor } from '../../core/workflow/monitor.js';
import { ConsoleBus } from '../../core/workflow/notifications.js';
import { createRuntimeAdapter } from '../../core/workflow/runtime-adapter.js';
import { resolve } from 'node:path';

export function makeStartCommand(): Command {
  const cmd = new Command('start')
    .description('Start a workflow run')
    .option('--workflow <id>', 'workflow ID to run')
    .option('--resume', 'resume the most recent interrupted run')
    .option('--no-tui', 'headless mode (console output only)')
    .action(async (opts: { workflow?: string; resume?: boolean }) => {
      const cwd = process.cwd();
      const config = await loadConfig(cwd);
      const db = openDatabase(cwd);

      const defaultRuntime = Object.values(config.executors)[0]?.runtime ?? 'claude-code';
      const adapter = createRuntimeAdapter(defaultRuntime ?? 'claude-code');

      const registry = new ExecutorRegistry();
      registry.register(new TriggerExecutor());
      registry.register(new ConditionExecutor());
      registry.register(new ParallelForkExecutor());
      registry.register(new JoinExecutor());
      registry.register(new TransformExecutor());
      registry.register(new LoopExecutor());
      registry.register(new HumanApprovalExecutor());
      registry.register(new AgentExecutor());

      const bus = new ConsoleBus();
      const engine = new WorkflowEngine(db, registry, adapter, bus, config, cwd);

      if (opts.resume) {
        await engine.recover();
        console.log('[engine] Recovered from previous run');
      } else {
        const workflowId = opts.workflow ?? config.workflows?.[0];
        if (!workflowId) {
          console.error('No workflow specified. Use --workflow <id> or add workflows to config.');
          process.exit(1);
        }
        const runId = await engine.start(workflowId);
        console.log(`[engine] Started workflow "${workflowId}" run=${runId}`);
      }

      const timerConfig = {};
      const stuckMs = 60_000;
      const monitor = new AgentMonitor(db, bus, { stuckThresholdMs: stuckMs, heartbeatIntervalMs: 15_000 });

      const timers = new TimerManager();

      const pollMs = 30_000;
      timers.start('workflow-poll', {
        intervalMs: pollMs,
        callback: async () => engine.tick(),
      });
      timers.start('agent-heartbeat', {
        intervalMs: 15_000,
        callback: async () => monitor.checkHeartbeats(),
      });
      timers.start('stuck-detection', {
        intervalMs: stuckMs,
        callback: async () => monitor.checkStuckAgents(),
      });

      const shutdown = () => {
        console.log('\n[engine] Shutting down...');
        timers.stopAll();
        db.close();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      console.log('[engine] Running. Press Ctrl+C to stop.');

      // Initial tick immediately
      await engine.tick();
    });

  return cmd;
}
```

- [ ] **Step 4: Create `src/cli/commands/stop.ts`**

```typescript
import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function makeStopCommand(): Command {
  return new Command('stop')
    .description('Send SIGTERM to the running engine process')
    .action(() => {
      const pidFile = resolve(process.cwd(), '.myrmidon', 'runtime', 'engine.pid');
      if (!existsSync(pidFile)) {
        console.error('No engine.pid found — is the engine running?');
        process.exit(1);
      }
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[engine] Sent SIGTERM to PID ${pid}`);
      } catch {
        console.error(`[engine] Could not signal PID ${pid} — process may already be stopped`);
      }
    });
}
```

- [ ] **Step 5: Create `src/cli/commands/status.ts`**

```typescript
import { Command } from 'commander';
import { openDatabase } from '../../core/database/client.js';

export function makeStatusCommand(): Command {
  return new Command('status')
    .description('Show the current workflow run status')
    .option('--json', 'output as JSON')
    .action((opts: { json?: boolean }) => {
      const db = openDatabase(process.cwd());

      const run = db
        .prepare(
          "SELECT id, workflow_id, status, started_at, completed_at FROM workflow_runs ORDER BY started_at DESC LIMIT 1",
        )
        .get() as { id: string; workflow_id: string; status: string; started_at: string; completed_at: string | null } | undefined;

      if (!run) {
        console.log('No workflow runs found.');
        db.close();
        return;
      }

      const execs = db
        .prepare('SELECT node_id, status, started_at, completed_at FROM node_executions WHERE run_id = ?')
        .all(run.id) as Array<{ node_id: string; status: string; started_at: string | null; completed_at: string | null }>;

      if (opts.json) {
        console.log(JSON.stringify({ run, nodes: execs }, null, 2));
      } else {
        console.log(`Workflow:  ${run.workflow_id}`);
        console.log(`Run ID:    ${run.id}`);
        console.log(`Status:    ${run.status}`);
        console.log(`Started:   ${run.started_at}`);
        if (run.completed_at) console.log(`Completed: ${run.completed_at}`);
        console.log('\nNodes:');
        for (const exec of execs) {
          console.log(`  ${exec.node_id.padEnd(24)} ${exec.status}`);
        }
      }

      db.close();
    });
}
```

- [ ] **Step 6: Create `src/cli/commands/workflow.ts`**

```typescript
import { Command } from 'commander';
import { openDatabase } from '../../core/database/client.js';
import { WorkflowDefSchema } from '../../core/workflow/schema.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function makeWorkflowCommand(): Command {
  const cmd = new Command('workflow').description('Manage workflow definitions');

  cmd
    .command('list')
    .description('List registered workflows')
    .action(() => {
      const db = openDatabase(process.cwd());
      const rows = db
        .prepare('SELECT id, version, name, updated_at FROM workflows ORDER BY id')
        .all() as Array<{ id: string; version: string; name: string; updated_at: string }>;
      if (rows.length === 0) {
        console.log('No workflows registered. Use `workflow load <path>` to add one.');
      } else {
        for (const row of rows) {
          console.log(`  ${row.id.padEnd(32)} v${row.version}  ${row.name}`);
        }
      }
      db.close();
    });

  cmd
    .command('load <path>')
    .description('Load a workflow DSL file into the database')
    .action(async (filePath: string) => {
      const absPath = resolve(process.cwd(), filePath);
      if (!existsSync(absPath)) {
        console.error(`File not found: ${absPath}`);
        process.exit(1);
      }
      // Dynamic import for TypeScript/ESM DSL files
      const mod = await import(absPath) as Record<string, unknown>;
      const exported = Object.values(mod).find((v) => v && typeof v === 'object' && 'nodes' in (v as object));
      if (!exported) {
        console.error('Could not find a WorkflowDef export in', filePath);
        process.exit(1);
      }
      const result = WorkflowDefSchema.safeParse(exported);
      if (!result.success) {
        console.error('Invalid workflow definition:', result.error.message);
        process.exit(1);
      }
      const db = openDatabase(process.cwd());
      const now = new Date().toISOString();
      db.prepare(
        'INSERT OR REPLACE INTO workflows (id, version, name, def_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(result.data.id, result.data.version, result.data.name, JSON.stringify(result.data), now, now);
      console.log(`[workflow] Loaded "${result.data.id}" v${result.data.version}`);
      db.close();
    });

  cmd
    .command('validate <id>')
    .description('Validate a registered workflow definition')
    .action((id: string) => {
      const db = openDatabase(process.cwd());
      const row = db
        .prepare('SELECT def_json FROM workflows WHERE id = ?')
        .get(id) as { def_json: string } | undefined;
      if (!row) {
        console.error(`Workflow "${id}" not found`);
        process.exit(1);
      }
      const def = JSON.parse(row.def_json) as unknown;
      const result = WorkflowDefSchema.safeParse(def);
      if (result.success) {
        console.log(`✓ Workflow "${id}" is valid (${result.data.nodes.length} nodes, ${result.data.edges.length} edges)`);
      } else {
        console.error(`✗ Workflow "${id}" is invalid:`);
        console.error(result.error.message);
        process.exit(1);
      }
      db.close();
    });

  cmd
    .command('show <id>')
    .description('Show workflow definition details')
    .action((id: string) => {
      const db = openDatabase(process.cwd());
      const row = db
        .prepare('SELECT def_json FROM workflows WHERE id = ?')
        .get(id) as { def_json: string } | undefined;
      if (!row) {
        console.error(`Workflow "${id}" not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(JSON.parse(row.def_json), null, 2));
      db.close();
    });

  cmd
    .command('runs [id]')
    .description('List workflow run history')
    .action((id?: string) => {
      const db = openDatabase(process.cwd());
      const rows = id
        ? (db
            .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20')
            .all(id) as Array<Record<string, unknown>>)
        : (db
            .prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT 20')
            .all() as Array<Record<string, unknown>>);
      if (rows.length === 0) {
        console.log('No runs found.');
      } else {
        for (const row of rows) {
          console.log(
            `  ${String(row['id']).slice(0, 8)}  ${String(row['workflow_id']).padEnd(24)}  ${String(row['status']).padEnd(12)}  ${String(row['started_at'])}`,
          );
        }
      }
      db.close();
    });

  return cmd;
}
```

- [ ] **Step 7: Update `src/cli/index.ts`**

```typescript
import { program } from 'commander';
import { createRequire } from 'node:module';
import { makeInitCommand } from './commands/init.js';
import { makeConfigCommand } from './commands/config.js';
import { makeStartCommand } from './commands/start.js';
import { makeStopCommand } from './commands/stop.js';
import { makeStatusCommand } from './commands/status.js';
import { makeWorkflowCommand } from './commands/workflow.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

program
  .name('myrmidon')
  .description('AI workflow engine')
  .version(pkg.version, '-v, --version');

program.addCommand(makeInitCommand());
program.addCommand(makeConfigCommand());
program.addCommand(makeStartCommand());
program.addCommand(makeStopCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeWorkflowCommand());

await program.parseAsync(process.argv);
```

- [ ] **Step 8: Run integration test**

```
npx vitest run tests/integration/workflow-engine.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run full test suite**

```
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 10: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add -f \
  src/cli/commands/start.ts \
  src/cli/commands/stop.ts \
  src/cli/commands/status.ts \
  src/cli/commands/workflow.ts \
  src/cli/index.ts \
  tests/integration/workflow-engine.test.ts
git commit -m "feat(cli): add start/stop/status/workflow commands — Sub-2 complete"
```
