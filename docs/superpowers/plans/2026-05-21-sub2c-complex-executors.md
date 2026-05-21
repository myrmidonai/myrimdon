# Sub-2c: Complex Executors + Dispatcher + WorktreeManager

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three stateful executors (human_approval, agent) plus the Dispatcher that builds agent prompts, and WorktreeManager for git worktree lifecycle.

**Architecture:**
- `human_approval` executor writes to the `workflow` table (`pending_confirmation`) and returns `waiting_human` — the engine polls this state
- `agent` executor calls `buildDispatchPrompt()` + `writeDispatchPrompt()` then spawns a subprocess via `RuntimeAdapter`, returning `running`; the engine polls `executor_procs` for completion
- `WorktreeManager` wraps `git worktree add/remove` with port allocation (basePort + hash % 1000, +500 fallback)

**Prerequisite:** Sub-2b merged.

**Naming rule:** Generic internal names — no "myrmidon" prefix.

---

## File Map

- Create: `src/core/workflow/executors/human-approval.ts`
- Create: `src/core/workflow/dispatcher.ts`
- Create: `src/core/workflow/executors/agent.ts`
- Create: `src/core/workflow/worktree.ts`
- Create: `tests/core/workflow/executors/human-approval.test.ts`
- Create: `tests/core/workflow/dispatcher.test.ts`
- Create: `tests/core/workflow/worktree.test.ts`

---

### Task 1: human_approval executor

**Files:**
- Create: `src/core/workflow/executors/human-approval.ts`
- Create: `tests/core/workflow/executors/human-approval.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/executors/human-approval.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../../src/core/database/client.js';
import { HumanApprovalExecutor } from '../../../../src/core/workflow/executors/human-approval.js';
import { ConsoleBus } from '../../../../src/core/workflow/notifications.js';
import type { NodeContext } from '../../../../src/core/workflow/executor-registry.js';
import type { NodeDef } from '../../../../src/core/workflow/schema.js';

let tmpDir: string;
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function makeCtx(node: NodeDef, tmpD: string): NodeContext {
  const db = openDatabase(tmpD);
  // Insert the required workflow row (inserted by openDatabase via CREATE_TABLES)
  return {
    node,
    workflowId: 'wf-1',
    runId: 'run-1',
    executionId: 'exec-1',
    db,
    config: {} as never,
    runtimeAdapter: {} as never,
    notificationBus: new ConsoleBus(),
    projectRoot: tmpD,
  };
}

describe('HumanApprovalExecutor', () => {
  it('returns waiting_human status', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ha-test-'));
    const node: NodeDef = {
      id: 'approval-node',
      type: 'human_approval',
      name: 'Approve',
      humanApproval: {
        message: 'Please review',
        onTimeout: 'auto_approve',
        allowedActions: ['approve', 'reject'],
      },
    };
    const ctx = makeCtx(node, tmpDir);
    // Insert a node_execution row so UPDATE can find it
    ctx.db
      .prepare(
        "INSERT INTO node_executions (id, run_id, node_id, status, attempt) VALUES (?, ?, ?, 'running', 1)",
      )
      .run('exec-1', 'run-1', 'approval-node');

    const result = await new HumanApprovalExecutor().execute(ctx);
    expect(result.status).toBe('waiting_human');
  });

  it('writes pending_confirmation to workflow table', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ha-test-'));
    const node: NodeDef = {
      id: 'approval-node',
      type: 'human_approval',
      name: 'Approve',
      humanApproval: {
        message: 'Please review',
        onTimeout: 'auto_approve',
        allowedActions: ['approve'],
      },
    };
    const ctx = makeCtx(node, tmpDir);
    ctx.db
      .prepare(
        "INSERT INTO node_executions (id, run_id, node_id, status, attempt) VALUES (?, ?, ?, 'running', 1)",
      )
      .run('exec-1', 'run-1', 'approval-node');

    await new HumanApprovalExecutor().execute(ctx);

    const row = ctx.db
      .prepare('SELECT pending_confirmation FROM workflow WHERE id = 1')
      .get() as { pending_confirmation: string | null } | undefined;
    expect(row?.pending_confirmation).not.toBeNull();

    const parsed = JSON.parse(row?.pending_confirmation ?? '{}') as Record<string, unknown>;
    expect(parsed['nodeId']).toBe('approval-node');
    expect(parsed['message']).toBe('Please review');
  });

  it('returns failed if humanApproval config is missing', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ha-test-'));
    const node: NodeDef = { id: 'x', type: 'human_approval', name: 'X' };
    const ctx = makeCtx(node, tmpDir);
    const result = await new HumanApprovalExecutor().execute(ctx);
    expect(result.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/executors/human-approval.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/executors/human-approval.ts`**

```typescript
import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';

export class HumanApprovalExecutor implements NodeExecutor {
  readonly type = 'human_approval' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const approval = ctx.node.humanApproval;
    if (!approval) {
      return { status: 'failed', error: 'human_approval node is missing humanApproval config' };
    }

    const now = new Date().toISOString();
    const confirmation = JSON.stringify({
      nodeId: ctx.node.id,
      message: approval.message,
      runId: ctx.runId,
      allowedActions: approval.allowedActions,
      onTimeout: approval.onTimeout,
      timeoutMs: approval.timeoutMs ?? 600_000,
      requestedAt: now,
    });

    ctx.db
      .prepare(
        'UPDATE workflow SET pending_confirmation = ?, confirmation_requested_at = ? WHERE id = 1',
      )
      .run(confirmation, now);

    ctx.db
      .prepare(
        "UPDATE node_executions SET status = 'waiting_human', started_at = ? WHERE id = ?",
      )
      .run(now, ctx.executionId);

    await ctx.notificationBus.notify('human_intervention', {
      nodeId: ctx.node.id,
      message: approval.message,
      runId: ctx.runId,
    });

    return { status: 'waiting_human' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/executors/human-approval.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/executors/human-approval.ts tests/core/workflow/executors/human-approval.test.ts
git commit -m "feat(workflow): add HumanApprovalExecutor"
```

---

### Task 2: Dispatcher

**Files:**
- Create: `src/core/workflow/dispatcher.ts`
- Create: `tests/core/workflow/dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/dispatcher.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../src/core/database/client.js';
import { buildDispatchPrompt, writeDispatchPrompt } from '../../../src/core/workflow/dispatcher.js';
import type { NodeDef } from '../../../src/core/workflow/schema.js';
import type { MyrmidonConfig } from '../../../src/core/config/schema.js';

let tmpDir: string;
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const minimalConfig: MyrmidonConfig = {
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

describe('buildDispatchPrompt', () => {
  it('includes node id and name', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'disp-test-'));
    const db = openDatabase(tmpDir);
    const node: NodeDef = { id: 'writer', type: 'agent', name: 'Writer', agentRole: 'pm' };
    const prompt = buildDispatchPrompt({ node, workflowId: 'wf-1', runId: 'run-1', db, config: minimalConfig, projectRoot: tmpDir });
    expect(prompt.node.id).toBe('writer');
    expect(prompt.node.name).toBe('Writer');
    db.close();
  });

  it('resolves consumed artifacts from DB', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'disp-test-'));
    const db = openDatabase(tmpDir);
    db.prepare(
      "INSERT INTO artifacts (id, workflow_id, run_id, node_id, file_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('doc-1', 'wf-1', 'run-1', 'prev-node', 'docs/doc.md', 'ready', new Date().toISOString());

    const node: NodeDef = {
      id: 'writer',
      type: 'agent',
      name: 'Writer',
      artifacts: { consumes: [{ id: 'doc-1' }], produces: [] },
    };
    const prompt = buildDispatchPrompt({ node, workflowId: 'wf-1', runId: 'run-1', db, config: minimalConfig, projectRoot: tmpDir });
    const consumed = prompt.artifacts.consumes[0];
    expect(consumed?.id).toBe('doc-1');
    expect(consumed?.path).toBe('docs/doc.md');
    expect(consumed?.status).toBe('ready');
    db.close();
  });

  it('marks missing artifacts as missing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'disp-test-'));
    const db = openDatabase(tmpDir);
    const node: NodeDef = {
      id: 'writer',
      type: 'agent',
      name: 'Writer',
      artifacts: { consumes: [{ id: 'nonexistent' }], produces: [] },
    };
    const prompt = buildDispatchPrompt({ node, workflowId: 'wf-1', runId: 'run-1', db, config: minimalConfig, projectRoot: tmpDir });
    expect(prompt.artifacts.consumes[0]?.status).toBe('missing');
    db.close();
  });
});

describe('writeDispatchPrompt', () => {
  it('writes a JSON file and returns the path', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'disp-test-'));
    const db = openDatabase(tmpDir);
    const node: NodeDef = { id: 'writer', type: 'agent', name: 'Writer' };
    const prompt = buildDispatchPrompt({ node, workflowId: 'wf-1', runId: 'run-1', db, config: minimalConfig, projectRoot: tmpDir });
    const filePath = writeDispatchPrompt({ prompt, projectRoot: tmpDir });
    expect(existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as typeof prompt;
    expect(parsed.runId).toBe('run-1');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/dispatcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/dispatcher.ts`**

```typescript
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type Database from 'better-sqlite3';
import type { NodeDef, ArtifactDef } from './schema.js';
import type { MyrmidonConfig } from '../config/schema.js';

export interface ResolvedArtifact {
  id: string;
  path: string;
  status: string;
}

export interface DispatchPrompt {
  runId: string;
  node: { id: string; name: string; description: string };
  artifacts: {
    consumes: ResolvedArtifact[];
    produces: ArtifactDef[];
  };
  constitution: {
    role: string;
    allowedTools: string[];
    forbiddenTools: string[];
    skills: string[];
    mcpTools: string[];
    contextRecoveryInstructions: string;
    outputLanguage: string;
  };
  dbPath: string;
  continueFile: string;
  maxTokenBudget: number;
}

export function buildDispatchPrompt(opts: {
  node: NodeDef;
  workflowId: string;
  runId: string;
  db: Database.Database;
  config: MyrmidonConfig;
  projectRoot: string;
}): DispatchPrompt {
  const { node, runId, db, config, projectRoot } = opts;

  const consumes: ResolvedArtifact[] = (node.artifacts?.consumes ?? []).map((ref) => {
    const row = db
      .prepare('SELECT id, file_path, status FROM artifacts WHERE id = ? AND run_id = ?')
      .get(ref.id, runId) as { id: string; file_path: string; status: string } | undefined;
    return row
      ? { id: row.id, path: row.file_path, status: row.status }
      : { id: ref.id, path: '', status: 'missing' };
  });

  const agentRole = node.agentRole ? config.agentRoles[node.agentRole] : undefined;
  const constitution = {
    role: node.agentRole ?? 'general',
    allowedTools: agentRole?.allowedTools ?? [],
    forbiddenTools: agentRole?.forbiddenTools ?? [],
    skills: [...(agentRole?.skills ?? []), ...(node.skills ?? [])],
    mcpTools: [...(agentRole?.mcpTools ?? []), ...(node.mcpTools ?? [])],
    contextRecoveryInstructions: agentRole?.contextRecoveryInstructions ?? '',
    outputLanguage: agentRole?.outputLanguage ?? 'zh',
  };

  const dbPath = resolve(projectRoot, '.myrmidon', 'runtime', 'myrmidon.db');
  const continueFile = resolve(
    projectRoot,
    '.myrmidon',
    'runtime',
    'continue',
    `${runId}-${node.id}.md`,
  );

  return {
    runId,
    node: { id: node.id, name: node.name, description: node.description ?? '' },
    artifacts: { consumes, produces: node.artifacts?.produces ?? [] },
    constitution,
    dbPath,
    continueFile,
    maxTokenBudget: config.dispatch.maxDispatchPromptTokens,
  };
}

export function writeDispatchPrompt(opts: {
  prompt: DispatchPrompt;
  projectRoot: string;
}): string {
  const { prompt, projectRoot } = opts;
  const filePath = resolve(
    projectRoot,
    '.myrmidon',
    'runtime',
    'dispatch',
    `${prompt.runId}-${prompt.node.id}.json`,
  );
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(prompt, null, 2), 'utf8');
  return filePath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/dispatcher.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/dispatcher.ts tests/core/workflow/dispatcher.test.ts
git commit -m "feat(workflow): add Dispatcher — buildDispatchPrompt and writeDispatchPrompt"
```

---

### Task 3: agent executor

**Files:**
- Create: `src/core/workflow/executors/agent.ts`

The agent executor is integration-heavy (spawns a real process). Test the error path (missing executor config) with a unit test; skip the spawn path since it requires a real `claude` binary.

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/executors/agent.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../../src/core/database/client.js';
import { AgentExecutor } from '../../../../src/core/workflow/executors/agent.js';
import { ConsoleBus } from '../../../../src/core/workflow/notifications.js';
import { ClaudeCodeAdapter } from '../../../../src/core/workflow/runtime-adapter.js';
import type { NodeContext } from '../../../../src/core/workflow/executor-registry.js';
import type { MyrmidonConfig } from '../../../../src/core/config/schema.js';

let tmpDir: string;
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

const configWithoutSonnet: MyrmidonConfig = {
  project: { name: 'test', lang: 'zh', description: '' },
  tui: { lang: 'zh' },
  audit: { retention: '30d' },
  basePort: 31000,
  executors: {},
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

describe('AgentExecutor', () => {
  it('has type "agent"', () => {
    expect(new AgentExecutor().type).toBe('agent');
  });

  it('returns failed when executor key is not in config', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agent-test-'));
    const db = openDatabase(tmpDir);
    const ctx: NodeContext = {
      node: { id: 'node-1', type: 'agent', name: 'Writer', executor: 'sonnet' },
      workflowId: 'wf-1',
      runId: 'run-1',
      executionId: 'exec-1',
      db,
      config: configWithoutSonnet,
      runtimeAdapter: new ClaudeCodeAdapter(),
      notificationBus: new ConsoleBus(),
      projectRoot: tmpDir,
    };
    const result = await new AgentExecutor().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toContain("'sonnet'");
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/executors/agent.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/executors/agent.ts`**

```typescript
import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';
import { buildDispatchPrompt, writeDispatchPrompt } from '../dispatcher.js';

export class AgentExecutor implements NodeExecutor {
  readonly type = 'agent' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const { node, workflowId, runId, db, config, runtimeAdapter, projectRoot } = ctx;

    const executorKey = node.executor ?? 'sonnet';
    const executorConfig = config.executors[executorKey];
    if (!executorConfig) {
      return { status: 'failed', error: `Executor '${executorKey}' not found in config` };
    }

    const prompt = buildDispatchPrompt({ node, workflowId, runId, db, config, projectRoot });
    const promptFile = writeDispatchPrompt({ prompt, projectRoot });

    let spawnedProc: { pid: number; kill: (s: 'SIGTERM' | 'SIGKILL') => void };
    try {
      spawnedProc = await runtimeAdapter.spawn({
        promptFile,
        cwd: projectRoot,
        dbPath: prompt.dbPath,
        env: {},
      });
    } catch (err) {
      return { status: 'failed', error: String(err) };
    }

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO executor_procs (session_id, agent_id, task_id, pid, proc_type, started_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ctx.executionId, node.id, node.id, spawnedProc.pid, 'agent', now);

    return { status: 'running', outputJson: { pid: spawnedProc.pid, promptFile } };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/executors/agent.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/executors/agent.ts tests/core/workflow/executors/agent.test.ts
git commit -m "feat(workflow): add AgentExecutor"
```

---

### Task 4: WorktreeManager

**Files:**
- Create: `src/core/workflow/worktree.ts`
- Create: `tests/core/workflow/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/worktree.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../src/core/database/client.js';
import { WorktreeManager } from '../../../src/core/workflow/worktree.js';

let tmpDir: string;
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('WorktreeManager.allocatePort', () => {
  it('returns a port in the expected range', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const db = openDatabase(tmpDir);
    const mgr = new WorktreeManager(tmpDir, db, 31000);
    const port = mgr.allocatePort('task-abc123');
    expect(port).toBeGreaterThanOrEqual(31000);
    expect(port).toBeLessThan(32000);
    db.close();
  });

  it('returns a different port for the same task when the first is occupied', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const db = openDatabase(tmpDir);
    const mgr = new WorktreeManager(tmpDir, db, 31000);
    const port1 = mgr.allocatePort('task-abc123');
    // Simulate occupation by inserting into worktrees
    db.prepare(
      "INSERT INTO worktrees (branch, path, task_id, port, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('branch-x', '/tmp/x', 'task-abc123', port1, new Date().toISOString(), 'active');
    const port2 = mgr.allocatePort('task-abc123');
    expect(port2).not.toBe(port1);
    db.close();
  });

  it('throws when both candidate ports are occupied', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const db = openDatabase(tmpDir);
    const mgr = new WorktreeManager(tmpDir, db, 31000);
    const port1 = mgr.allocatePort('task-abc123');
    const port2tmp = new WorktreeManager(tmpDir, db, 31000);
    // Occupy both ports
    db.prepare(
      "INSERT INTO worktrees (branch, path, task_id, port, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('branch-a', '/tmp/a', 'task-abc123', port1, new Date().toISOString(), 'active');
    const port2 = port2tmp.allocatePort('task-abc123');
    db.prepare(
      "INSERT INTO worktrees (branch, path, task_id, port, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('branch-b', '/tmp/b', 'task-abc123', port2, new Date().toISOString(), 'active');
    expect(() => new WorktreeManager(tmpDir, db, 31000).allocatePort('task-abc123')).toThrow();
    db.close();
  });

  it('list() returns rows from the worktrees table', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const db = openDatabase(tmpDir);
    db.prepare(
      "INSERT INTO worktrees (branch, path, task_id, port, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('my-branch', '/tmp/my', 'task-1', 31001, new Date().toISOString(), 'active');
    const mgr = new WorktreeManager(tmpDir, db, 31000);
    const list = mgr.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.branch).toBe('my-branch');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/worktree.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/worktree.ts`**

```typescript
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

export interface WorktreeEntry {
  branch: string;
  path: string;
  port: number;
  agent: string | null;
  status: string;
}

export class WorktreeManager {
  constructor(
    private readonly projectRoot: string,
    private readonly db: Database.Database,
    private readonly basePort: number,
  ) {}

  allocatePort(taskId: string): number {
    const offset = Math.abs(hashString(taskId)) % 1000;
    const primary = this.basePort + offset;

    const occupied = (port: number) =>
      !!this.db
        .prepare("SELECT 1 FROM worktrees WHERE port = ? AND status = 'active'")
        .get(port);

    if (!occupied(primary)) return primary;

    const fallback = this.basePort + 500 + offset;
    if (!occupied(fallback)) return fallback;

    throw new Error(`Cannot allocate port for task ${taskId}: both ${primary} and ${fallback} are in use`);
  }

  create(opts: { branch: string; taskId: string; agent: string }): string {
    const port = this.allocatePort(opts.taskId);
    const worktreePath = resolve(this.projectRoot, '.myrmidon', 'worktrees', opts.branch);
    mkdirSync(resolve(this.projectRoot, '.myrmidon', 'worktrees'), { recursive: true });

    execSync(`git worktree add -b ${opts.branch} ${worktreePath}`, {
      cwd: this.projectRoot,
      stdio: 'pipe',
    });

    this.db
      .prepare(
        'INSERT INTO worktrees (branch, path, task_id, port, agent, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(opts.branch, worktreePath, opts.taskId, port, opts.agent, new Date().toISOString(), 'active');

    return worktreePath;
  }

  remove(branch: string): void {
    const row = this.db
      .prepare('SELECT path FROM worktrees WHERE branch = ?')
      .get(branch) as { path: string } | undefined;
    if (!row) return;

    try {
      execSync(`git worktree remove --force ${row.path}`, {
        cwd: this.projectRoot,
        stdio: 'pipe',
      });
    } catch {
      // Best-effort removal; ignore filesystem errors
    }

    this.db
      .prepare("UPDATE worktrees SET status = 'removed' WHERE branch = ?")
      .run(branch);
  }

  list(): WorktreeEntry[] {
    return this.db
      .prepare('SELECT branch, path, port, agent, status FROM worktrees')
      .all() as WorktreeEntry[];
  }
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // coerce to 32-bit int
  }
  return hash;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/worktree.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Run full test suite**

```
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -f src/core/workflow/worktree.ts tests/core/workflow/worktree.test.ts
git commit -m "feat(workflow): add WorktreeManager with port allocation"
```
