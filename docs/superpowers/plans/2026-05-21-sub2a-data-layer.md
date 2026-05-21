# Sub-2a: Data Layer + WorkflowDef Schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new SQLite tables via migration, define the WorkflowDef Zod schema, and extend the config schema with a `workflows` field.

**Architecture:** Schema migration uses a `MIGRATIONS` dict keyed by version number; `openDatabase()` reads the current `schema_version` from the `meta` table and applies any missing migrations. WorkflowDef is the single canonical format for all workflow definitions.

**Tech Stack:** better-sqlite3, zod, vitest, TypeScript (strict, NodeNext ESM)

**Naming rule:** New internal identifiers must be generic — no "myrmidon" prefix on class/type names.

---

## File Map

- Modify: `src/core/database/schema.ts` — add `MIGRATIONS`, bump `SCHEMA_VERSION` to 2
- Modify: `src/core/database/client.ts` — add migration loop
- Modify: `src/core/config/schema.ts` — add `workflows` optional field
- Modify: `src/core/init/templates.ts` — add `workflows` field to generated config
- Create: `src/core/workflow/schema.ts` — WorkflowDef Zod schema + `defineWorkflow()`
- Modify: `tests/core/database/client.test.ts` — assert 4 new tables + schema_version=2
- Create: `tests/core/workflow/schema.test.ts` — WorkflowDef validation tests
- Modify: `tests/core/config/schema.test.ts` — assert `workflows` field is accepted

---

### Task 1: DB migration — schema.ts

**Files:**
- Modify: `src/core/database/schema.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/core/database/client.test.ts` (inside the existing `describe` block):

```typescript
it('creates the 4 new workflow engine tables (schema v2)', () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
  const db = openDatabase(tmpDir);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: unknown) => (r as { name: string }).name);
  expect(tables).toContain('workflows');
  expect(tables).toContain('workflow_runs');
  expect(tables).toContain('node_executions');
  expect(tables).toContain('artifacts');
  db.close();
});

it('sets schema_version to 2 in the meta table', () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
  const db = openDatabase(tmpDir);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  expect(row?.value).toBe('2');
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/database/client.test.ts
```

Expected: FAILs — tables `workflows`, `workflow_runs`, `node_executions`, `artifacts` not found, schema_version is `'1'`.

- [ ] **Step 3: Update `src/core/database/schema.ts`**

```typescript
export const SCHEMA_VERSION = 2;

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS workflow (
  id                        INTEGER PRIMARY KEY DEFAULT 1,
  state                     TEXT NOT NULL DEFAULT 'IDLE',
  current_phase             TEXT,
  current_epic              TEXT,
  current_sprint            TEXT,
  workflow_node             TEXT,
  started_at                TEXT,
  updated_at                TEXT,
  pending_confirmation      TEXT,
  confirmation_requested_at TEXT,
  next_poll_at              TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  name          TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'idle',
  current_task  TEXT,
  worktree      TEXT,
  started_at    TEXT,
  updated_at    TEXT,
  waiting_for   TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  sprint        TEXT,
  assignee      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  worktree      TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  retry_count   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS worktrees (
  branch      TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  task_id     INTEGER NOT NULL,
  port        INTEGER NOT NULL,
  agent       TEXT,
  created_at  TEXT,
  status      TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS git_ops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operation   TEXT NOT NULL,
  branch      TEXT NOT NULL,
  target      TEXT,
  result      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timer_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timer_id    TEXT NOT NULL,
  event       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  duration_ms INTEGER,
  detail      TEXT
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  task_id     TEXT,
  start_time  TEXT NOT NULL,
  end_time    TEXT,
  exit_status TEXT,
  file_path   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS executor_procs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  task_id     TEXT,
  pid         INTEGER NOT NULL,
  port        INTEGER,
  proc_type   TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  killed_at   TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO workflow (id, state) VALUES (1, 'IDLE');
`;

export const MIGRATIONS: Record<number, string> = {
  2: `
    CREATE TABLE IF NOT EXISTS workflows (
      id          TEXT PRIMARY KEY,
      version     TEXT NOT NULL,
      name        TEXT NOT NULL,
      def_json    TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id            TEXT PRIMARY KEY,
      workflow_id   TEXT NOT NULL,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      context_json  TEXT
    );

    CREATE TABLE IF NOT EXISTS node_executions (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL,
      node_id       TEXT NOT NULL,
      status        TEXT NOT NULL,
      attempt       INTEGER DEFAULT 1,
      agent_id      TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      error         TEXT,
      output_json   TEXT
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id           TEXT PRIMARY KEY,
      workflow_id  TEXT NOT NULL,
      run_id       TEXT NOT NULL,
      node_id      TEXT NOT NULL,
      file_path    TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
  `,
};
```

- [ ] **Step 4: Update `src/core/database/client.ts`**

```typescript
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREATE_TABLES, MIGRATIONS, SCHEMA_VERSION } from './schema.js';

export function openDatabase(baseDir: string): Database.Database {
  const runtimeDir = resolve(baseDir, '.myrmidon', 'runtime');
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });

  const db = new Database(resolve(runtimeDir, 'myrmidon.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);

  // Read current schema version (absent on brand-new DB = treat as 1)
  const metaRow = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined;
  let current = metaRow ? parseInt(metaRow.value, 10) : 1;

  // Apply any pending migrations sequentially
  while (current < SCHEMA_VERSION) {
    const next = current + 1;
    const sql = MIGRATIONS[next];
    if (sql) db.exec(sql);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(next),
    );
    current = next;
  }

  return db;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx vitest run tests/core/database/client.test.ts
```

Expected: all tests PASS (including the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add -f src/core/database/schema.ts src/core/database/client.ts tests/core/database/client.test.ts
git commit -m "feat(db): add schema v2 migration with 4 workflow engine tables"
```

---

### Task 2: WorkflowDef Zod schema + defineWorkflow()

**Files:**
- Create: `src/core/workflow/schema.ts`
- Create: `tests/core/workflow/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/workflow/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WorkflowDefSchema, defineWorkflow } from '../../../src/core/workflow/schema.js';

const minimalWorkflow = {
  id: 'test-flow',
  version: '1.0.0',
  name: 'Test Flow',
  nodes: [{ id: 'start', type: 'trigger', name: 'Start' }],
  edges: [],
};

describe('WorkflowDefSchema', () => {
  it('accepts a minimal valid workflow', () => {
    const result = WorkflowDefSchema.safeParse(minimalWorkflow);
    expect(result.success).toBe(true);
  });

  it('rejects workflow with no nodes', () => {
    const bad = { ...minimalWorkflow, nodes: [] };
    expect(WorkflowDefSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown node type', () => {
    const bad = {
      ...minimalWorkflow,
      nodes: [{ id: 'x', type: 'unknown_type', name: 'X' }],
    };
    expect(WorkflowDefSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a node with artifacts', () => {
    const wf = {
      ...minimalWorkflow,
      nodes: [
        {
          id: 'writer',
          type: 'agent',
          name: 'Writer',
          agentRole: 'pm',
          artifacts: {
            consumes: [],
            produces: [{ id: 'doc', path: 'docs/doc.md' }],
          },
        },
      ],
    };
    expect(WorkflowDefSchema.safeParse(wf).success).toBe(true);
  });

  it('accepts human_approval config on a node', () => {
    const wf = {
      ...minimalWorkflow,
      nodes: [
        {
          id: 'approval',
          type: 'human_approval',
          name: 'Approve',
          humanApproval: {
            message: 'Please review',
            onTimeout: 'auto_approve',
            allowedActions: ['approve', 'reject'],
          },
        },
      ],
    };
    expect(WorkflowDefSchema.safeParse(wf).success).toBe(true);
  });
});

describe('defineWorkflow', () => {
  it('parses and returns a WorkflowDef', () => {
    const wf = defineWorkflow(minimalWorkflow);
    expect(wf.id).toBe('test-flow');
    expect(wf.nodes).toHaveLength(1);
  });

  it('throws ZodError on invalid input', () => {
    expect(() => defineWorkflow({ id: '', version: '1', name: 'x', nodes: [], edges: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/workflow/schema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/workflow/schema.ts`**

```typescript
import { z } from 'zod';

export const NodeTypeSchema = z.enum([
  'agent',
  'human_approval',
  'condition',
  'parallel_fork',
  'join',
  'transform',
  'trigger',
  'loop',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

const ArtifactRefSchema = z.object({ id: z.string() });
const ArtifactDefSchema = z.object({ id: z.string(), path: z.string() });

const HookDefSchema = z.object({
  type: z.enum(['skill', 'script', 'notify', 'transform']),
  ref: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});

const PluginRefSchema = z.object({
  id: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const ValidatorDefSchema = z.object({
  required: z.array(z.string()).optional(),
});

export const HumanApprovalDefSchema = z.object({
  message: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  onTimeout: z.enum(['auto_approve', 'auto_reject', 'escalate']),
  notifyChannels: z.array(z.string()).optional(),
  allowedActions: z.array(z.enum(['approve', 'reject', 'defer'])),
  onReject: z.string().optional(),
});

export const NodeDefSchema = z.object({
  id: z.string().min(1),
  type: NodeTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  agentRole: z.string().optional(),
  executor: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcpTools: z.array(z.string()).optional(),
  plugins: z.array(PluginRefSchema).optional(),
  artifacts: z
    .object({
      consumes: z.array(ArtifactRefSchema),
      produces: z.array(ArtifactDefSchema),
    })
    .optional(),
  inputValidator: ValidatorDefSchema.optional(),
  outputValidator: ValidatorDefSchema.optional(),
  hooks: z
    .object({
      pre: z.array(HookDefSchema).optional(),
      post: z.array(HookDefSchema).optional(),
      onError: z.array(HookDefSchema).optional(),
    })
    .optional(),
  humanApproval: HumanApprovalDefSchema.optional(),
  retry: z
    .object({
      maxAttempts: z.number().int().positive().default(3),
      backoffMs: z.number().int().nonnegative().default(5000),
    })
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const EdgeDefSchema = z.object({
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
  label: z.string().optional(),
});

const WorkflowConfigSchema = z.object({
  maxParallelNodes: z.number().int().positive().optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
  timers: z
    .object({
      workflowPollMs: z.number().int().positive().optional(),
      heartbeatMs: z.number().int().positive().optional(),
      clientTimeoutMs: z.number().int().positive().optional(),
      stuckDetectionMs: z.number().int().positive().optional(),
      consistencyMs: z.number().int().positive().optional(),
      externalDepWatchMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export const WorkflowDefSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(NodeDefSchema).min(1),
  edges: z.array(EdgeDefSchema),
  config: WorkflowConfigSchema.optional(),
});

export type NodeDef = z.infer<typeof NodeDefSchema>;
export type EdgeDef = z.infer<typeof EdgeDefSchema>;
export type WorkflowDef = z.infer<typeof WorkflowDefSchema>;
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
export type HumanApprovalDef = z.infer<typeof HumanApprovalDefSchema>;
export type ArtifactDef = z.infer<typeof ArtifactDefSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export function defineWorkflow(
  def: z.input<typeof WorkflowDefSchema>,
): WorkflowDef {
  return WorkflowDefSchema.parse(def);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run tests/core/workflow/schema.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/core/workflow/schema.ts tests/core/workflow/schema.test.ts
git commit -m "feat(workflow): add WorkflowDef Zod schema and defineWorkflow()"
```

---

### Task 3: Config schema + init template update

**Files:**
- Modify: `src/core/config/schema.ts`
- Modify: `src/core/init/templates.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/core/config/schema.test.ts`:

```typescript
it('accepts a config with a workflows array', () => {
  const withWorkflows = {
    ...minimal,
    workflows: ['software-dev-agile', './workflows/my-flow.ts'],
  };
  const result = MyrmidonConfigSchema.safeParse(withWorkflows);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.workflows).toEqual(['software-dev-agile', './workflows/my-flow.ts']);
  }
});

it('accepts a config without the workflows field', () => {
  const result = MyrmidonConfigSchema.safeParse(minimal);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.workflows).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/core/config/schema.test.ts
```

Expected: FAIL — `workflows` field not recognised.

- [ ] **Step 3: Add `workflows` field to `MyrmidonConfigSchema` in `src/core/config/schema.ts`**

Add this field inside `MyrmidonConfigSchema` (after the `notifications` field):

```typescript
  workflows: z.array(z.string()).optional(),
```

The `MyrmidonConfig` type is inferred from the schema, so it picks up the new field automatically.

- [ ] **Step 4: Update generated config in `src/core/init/templates.ts`**

In `generateConfig()`, add a comment placeholder after the `agents` block:

```typescript
  // workflows: ['software-dev-agile'],
```

Full updated return string (replace the existing template string):

```typescript
export function generateConfig(opts: TemplateOptions): string {
  return `// @ts-ignore — defineConfig is a passthrough type helper
const defineConfig = (c) => c;

export default defineConfig({
  project: {
    name: '${opts.name}',
    lang: '${opts.lang}',
    description: '',
  },

  tui: { lang: '${opts.lang}' },
  audit: { retention: '30d' },
  basePort: ${opts.basePort},

  executors: {
    sonnet: {
      runtime: '${opts.runtime}',
      model: 'claude-sonnet-4-6',
      maxContextTokens: 200_000,
    },
  },

  agentRoles: {},
  agents: {},

  // workflows: ['software-dev-agile'],
});
`;
}
```

- [ ] **Step 5: Run all tests**

```
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -f src/core/config/schema.ts src/core/init/templates.ts tests/core/config/schema.test.ts
git commit -m "feat(config): add optional workflows field to config schema"
```
