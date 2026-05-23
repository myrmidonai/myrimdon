# Myrmidon — Sub-project 1: Foundation & CLI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `myrmidon init` creates a complete project scaffold with runtime auto-detection, config validation, and SQLite initialization; `myrmidon config validate/get/set` work end-to-end.

**Architecture:** Commander.js CLI → inquirer wizard → Zod-validated TypeScript config (loaded via jiti at runtime) → better-sqlite3 state store. All runtime state lives in SQLite. File-system scaffolding is idempotent (append-not-overwrite). No LLM calls in this sub-project.

**Tech Stack:** Node.js 20 LTS, TypeScript 5, Commander.js 12, inquirer 10, Zod 3, better-sqlite3 9, jiti 2, Pino 9, tsup 8, Vitest 2, tsx 4

---

## File Structure

```
src/
  cli/
    index.ts                     — Commander program, version, subcommands
    commands/
      init.ts                    — `myrmidon init` command (wizard + direct mode)
      config.ts                  — `myrmidon config validate/get/set` commands
  core/
    config/
      schema.ts                  — Zod schema + defineConfig() export
      loader.ts                  — load myrmidon.config.ts via jiti + validate
    database/
      schema.ts                  — SQL CREATE TABLE strings + SCHEMA_VERSION
      client.ts                  — openDatabase() → Database (WAL, migrations)
    runtime/
      detector.ts                — detectRuntimes(), getRuntimeInstallGuide()
    init/
      templates.ts               — generateConfig(), generateEnvExample(), etc.
      scaffolder.ts              — scaffold() — idempotent directory + file creation
      wizard.ts                  — runWizard() → WizardAnswers (inquirer prompts)
  utils/
    errors.ts                    — MyrmidonError class
    logger.ts                    — pino wrapper

tests/
  utils/errors.test.ts
  core/
    config/schema.test.ts
    config/loader.test.ts
    database/client.test.ts
    runtime/detector.test.ts
    init/templates.test.ts
    init/scaffolder.test.ts
    init/wizard.test.ts
  cli/
    commands/config.test.ts
  integration/
    init-flow.test.ts

package.json
tsconfig.json
tsup.config.ts
vitest.config.ts
```

---

## Task 1: Project Scaffold & Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "myrmidon",
  "version": "0.1.0",
  "type": "module",
  "bin": { "myrmidon": "./dist/cli/index.js" },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "commander": "^12.1.0",
    "inquirer": "^10.3.1",
    "jiti": "^2.3.3",
    "pino": "^9.4.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.5.5",
    "tsup": "^8.3.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: false,
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',           // required for better-sqlite3 (native module)
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8' },
  },
});
```

- [ ] **Step 5: Create source directories and install dependencies**

```bash
mkdir -p src/cli/commands src/core/config src/core/database src/core/runtime src/core/init src/utils
mkdir -p tests/utils tests/core/config tests/core/database tests/core/runtime tests/core/init tests/cli/commands tests/integration
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Verify TypeScript compiles on an empty entry**

```bash
# create placeholder
echo 'export {}' > src/cli/index.ts
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git init
git add package.json tsconfig.json tsup.config.ts vitest.config.ts
git commit -m "feat: project scaffold — Node.js/TS/Vitest/tsup"
```

---

## Task 2: Typed Errors & Logger

**Files:**
- Create: `src/utils/errors.ts`
- Create: `src/utils/logger.ts`
- Create: `tests/utils/errors.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/utils/errors.test.ts
import { describe, it, expect } from 'vitest';
import { MyrmidonError } from '../../src/utils/errors.js';

describe('MyrmidonError', () => {
  it('sets code and message', () => {
    const err = new MyrmidonError('CONFIG_NOT_FOUND', 'no config here');
    expect(err.code).toBe('CONFIG_NOT_FOUND');
    expect(err.message).toBe('no config here');
    expect(err.name).toBe('MyrmidonError');
    expect(err).toBeInstanceOf(Error);
  });

  it('wraps cause', () => {
    const cause = new Error('original');
    const err = new MyrmidonError('WRAP', 'wrapped', { cause });
    expect(err.cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/utils/errors.test.ts
```

Expected: FAIL — `Cannot find module '../../src/utils/errors.js'`

- [ ] **Step 3: Implement `src/utils/errors.ts`**

```typescript
export class MyrmidonError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MyrmidonError';
  }
}
```

- [ ] **Step 4: Implement `src/utils/logger.ts`**

```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'warn',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/utils/errors.test.ts
```

Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/utils/errors.ts src/utils/logger.ts tests/utils/errors.test.ts
git commit -m "feat: MyrmidonError typed error class + pino logger"
```

---

## Task 3: Config Zod Schema & `defineConfig`

**Files:**
- Create: `src/core/config/schema.ts`
- Create: `tests/core/config/schema.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/config/schema.test.ts
import { describe, it, expect } from 'vitest';
import { MyrmidonConfigSchema, defineConfig } from '../../src/core/config/schema.js';

const minimal = {
  project: { name: 'acme', lang: 'zh', description: '' },
  executors: {
    sonnet: { runtime: 'claude-code', model: 'claude-sonnet-4-6', maxContextTokens: 200_000 },
  },
};

describe('MyrmidonConfigSchema', () => {
  it('accepts a minimal valid config', () => {
    const result = MyrmidonConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('applies defaults for optional fields', () => {
    const result = MyrmidonConfigSchema.safeParse(minimal);
    expect(result.success && result.data.basePort).toBe(31000);
    expect(result.success && result.data.runtime.maxRetries).toBe(3);
    expect(result.success && result.data.tui.lang).toBe('zh');
    expect(result.success && result.data.audit.retention).toBe('30d');
  });

  it('rejects a config with missing project.name', () => {
    const bad = { ...minimal, project: { lang: 'zh' } };
    const result = MyrmidonConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects an executor with unknown runtime', () => {
    const bad = {
      ...minimal,
      executors: { bad: { runtime: 'unknown-runtime', model: 'x', maxContextTokens: 1000 } },
    };
    const result = MyrmidonConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe('defineConfig', () => {
  it('is an identity function returning the same object', () => {
    const config = defineConfig(minimal as Parameters<typeof defineConfig>[0]);
    expect(config).toBe(minimal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/config/schema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/config/schema.ts`**

```typescript
import { z } from 'zod';

const RuntimeIdSchema = z.enum(['claude-code', 'opencode', 'gemini-cli', 'kimi-codex']);

const ExecutorSchema = z.object({
  runtime: RuntimeIdSchema.optional(),
  model: z.string().min(1),
  maxContextTokens: z.number().int().positive(),
});

const AgentRoleSchema = z.object({
  systemPrompt: z.string(),
  allowedTools: z.array(z.string()),
  forbiddenTools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  mcpTools: z.array(z.string()).default([]),
  outputLanguage: z.enum(['zh', 'en']).default('zh'),
  contextRecoveryInstructions: z.string().default(''),
});

const AppSchema = z.object({
  root: z.string(),
  testCmd: z.string(),
  devCmd: z.string().optional(),
  basePort: z.number().int().positive(),
  coderOverrides: z.object({
    systemPromptAppend: z.string().optional(),
    skills: z.array(z.string()).default([]),
    additionalRules: z.array(z.string()).default([]),
  }).optional(),
  reviewRules: z.object({
    rulesFile: z.string().optional(),
    checklistItems: z.array(z.string()).default([]),
  }).optional(),
});

export const MyrmidonConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    lang: z.enum(['zh', 'en']).default('zh'),
    description: z.string().default(''),
  }),
  tui: z.object({
    lang: z.enum(['zh', 'en']).default('zh'),
  }).default({ lang: 'zh' }),
  audit: z.object({
    retention: z.string().default('30d'),
  }).default({ retention: '30d' }),
  basePort: z.number().int().positive().default(31000),
  executors: z.record(z.string(), ExecutorSchema),
  agentRoles: z.record(z.string(), AgentRoleSchema).default({}),
  agents: z.record(z.string(), z.object({
    role: z.string(),
    executor: z.string(),
    maxInstances: z.number().int().positive().optional(),
  })).default({}),
  apps: z.record(z.string(), AppSchema).optional(),
  externalDependencies: z.array(z.object({
    name: z.string(),
    path: z.string(),
    watchFor: z.enum(['changes']),
  })).default([]),
  runtime: z.object({
    maxRetries: z.number().int().nonnegative().default(3),
  }).default({ maxRetries: 3 }),
  dispatch: z.object({
    contextPressureThreshold: z.number().min(0).max(1).default(0.7),
    wrapUpSignalMessage: z.string().default('Context window is near capacity. Please write continue.md and exit.'),
    maxDispatchPromptTokens: z.number().int().positive().default(8000),
    toolResultMaxChars: z.number().int().positive().default(800),
    tokenProfile: z.enum(['budget', 'balanced', 'quality']).default('balanced'),
    contextEstimateThresholds: z.object({
      small:  z.number().int().positive().default(8_000),
      medium: z.number().int().positive().default(32_000),
      large:  z.number().int().positive().default(100_000),
    }).default({}),
  }).default({}),
  notifications: z.object({
    channels: z.array(z.object({ type: z.string() }).passthrough()).default([]),
  }).default({ channels: [] }),
});

export type MyrmidonConfig = z.infer<typeof MyrmidonConfigSchema>;
export type RuntimeId = z.infer<typeof RuntimeIdSchema>;

export function defineConfig(config: z.input<typeof MyrmidonConfigSchema>): z.input<typeof MyrmidonConfigSchema> {
  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/core/config/schema.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/schema.ts tests/core/config/schema.test.ts
git commit -m "feat: Zod config schema + defineConfig helper"
```

---

## Task 4: SQLite Schema & Client

**Files:**
- Create: `src/core/database/schema.ts`
- Create: `src/core/database/client.ts`
- Create: `tests/core/database/client.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/database/client.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/core/database/client.js';

let tmpDir: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('creates the database file and all tables', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-test-'));
    const db = openDatabase(tmpDir);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: unknown) => (r as { name: string }).name);

    expect(tables).toContain('workflow');
    expect(tables).toContain('agents');
    expect(tables).toContain('tasks');
    expect(tables).toContain('worktrees');
    expect(tables).toContain('git_ops');
    expect(tables).toContain('timer_events');
    expect(tables).toContain('agent_sessions');
    expect(tables).toContain('executor_procs');
    expect(tables).toContain('meta');
    db.close();
  });

  it('inserts the default workflow row (id=1)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-test-'));
    const db = openDatabase(tmpDir);
    const row = db.prepare('SELECT id, state FROM workflow WHERE id = 1').get();
    expect(row).toEqual({ id: 1, state: 'IDLE' });
    db.close();
  });

  it('is idempotent — calling twice does not throw', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-test-'));
    expect(() => {
      const db1 = openDatabase(tmpDir);
      db1.close();
      const db2 = openDatabase(tmpDir);
      db2.close();
    }).not.toThrow();
  });

  it('enables WAL journal mode', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-test-'));
    const db = openDatabase(tmpDir);
    const row = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(row[0]?.journal_mode).toBe('wal');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/database/client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/database/schema.ts`**

```typescript
export const SCHEMA_VERSION = 1;

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
```

- [ ] **Step 4: Implement `src/core/database/client.ts`**

```typescript
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREATE_TABLES, SCHEMA_VERSION } from './schema.js';

export function openDatabase(baseDir: string): Database.Database {
  const runtimeDir = resolve(baseDir, '.myrmidon', 'runtime');
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });

  const db = new Database(resolve(runtimeDir, 'myrmidon.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  return db;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/core/database/client.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/database/ tests/core/database/
git commit -m "feat: SQLite schema (9 tables) + openDatabase() with WAL"
```

---

## Task 5: Runtime Detector

**Files:**
- Create: `src/core/runtime/detector.ts`
- Create: `tests/core/runtime/detector.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/runtime/detector.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectRuntimes, getRuntimeInstallGuide } from '../../src/core/runtime/detector.js';
import * as cp from 'node:child_process';

afterEach(() => vi.restoreAllMocks());

describe('detectRuntimes', () => {
  it('returns runtimes whose command exits 0', () => {
    vi.spyOn(cp, 'spawnSync').mockImplementation((cmd) => {
      if (cmd === 'claude') return { status: 0, stdout: 'claude 1.2.3\n', stderr: '' } as ReturnType<typeof cp.spawnSync>;
      return { status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>;
    });

    const found = detectRuntimes();
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('claude-code');
    expect(found[0]?.version).toBe('claude 1.2.3');
  });

  it('returns empty array when no runtime is installed', () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>);
    expect(detectRuntimes()).toHaveLength(0);
  });

  it('returns multiple runtimes when several are installed', () => {
    vi.spyOn(cp, 'spawnSync').mockImplementation((cmd) => {
      if (cmd === 'claude' || cmd === 'opencode') {
        return { status: 0, stdout: `${cmd} 0.1.0\n`, stderr: '' } as ReturnType<typeof cp.spawnSync>;
      }
      return { status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>;
    });
    expect(detectRuntimes()).toHaveLength(2);
  });
});

describe('getRuntimeInstallGuide', () => {
  it('includes all 4 supported runtimes', () => {
    const guide = getRuntimeInstallGuide();
    expect(guide).toContain('claude-code');
    expect(guide).toContain('opencode');
    expect(guide).toContain('gemini-cli');
    expect(guide).toContain('kimi-codex');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/runtime/detector.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/runtime/detector.ts`**

```typescript
import { spawnSync } from 'node:child_process';
import type { RuntimeId } from '../config/schema.js';

export type { RuntimeId };

export interface RuntimeInfo {
  id: RuntimeId;
  command: string;
  version: string;
  installUrl: string;
  installCmd: string;
}

const RUNTIMES: Array<Omit<RuntimeInfo, 'version'>> = [
  { id: 'claude-code', command: 'claude',   installUrl: 'https://claude.ai/code',                      installCmd: 'npx @anthropic-ai/claude-code' },
  { id: 'opencode',    command: 'opencode', installUrl: 'https://opencode.ai',                         installCmd: 'npm install -g opencode' },
  { id: 'gemini-cli',  command: 'gemini',   installUrl: 'https://github.com/google-gemini/gemini-cli', installCmd: 'npm install -g @google/gemini-cli' },
  { id: 'kimi-codex',  command: 'kimi',     installUrl: 'https://github.com/MoonshotAI/kimi-codex',   installCmd: 'pip install kimi-codex' },
];

export function detectRuntimes(): RuntimeInfo[] {
  const found: RuntimeInfo[] = [];
  for (const rt of RUNTIMES) {
    const result = spawnSync(rt.command, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (result.status === 0) {
      const version = (result.stdout ?? result.stderr ?? '').trim().split('\n')[0] ?? '';
      found.push({ ...rt, version });
    }
  }
  return found;
}

export function getRuntimeInstallGuide(): string {
  return RUNTIMES
    .map(rt => `  ${rt.id.padEnd(14)} ${rt.installCmd.padEnd(42)} ${rt.installUrl}`)
    .join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/core/runtime/detector.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/runtime/detector.ts tests/core/runtime/detector.test.ts
git commit -m "feat: runtime detector for claude-code/opencode/gemini-cli/kimi-codex"
```

---

## Task 6: Init File Templates

**Files:**
- Create: `src/core/init/templates.ts`
- Create: `tests/core/init/templates.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/init/templates.test.ts
import { describe, it, expect } from 'vitest';
import {
  generateConfig,
  generateEnvExample,
  generateGitignoreEntries,
  generateClaudeMd,
} from '../../src/core/init/templates.js';

const baseOpts = {
  name: 'my-app',
  lang: 'zh' as const,
  template: 'default' as const,
  basePort: 31000,
  runtime: 'claude-code' as const,
  isExisting: false,
  targetDir: '/tmp/my-app',
};

describe('generateConfig', () => {
  it('includes project name and runtime', () => {
    const out = generateConfig(baseOpts);
    expect(out).toContain("name: 'my-app'");
    expect(out).toContain("runtime: 'claude-code'");
    expect(out).toContain('basePort: 31000');
  });

  it('is valid TypeScript (contains defineConfig call)', () => {
    expect(generateConfig(baseOpts)).toContain('defineConfig(');
  });
});

describe('generateEnvExample', () => {
  it('includes ANTHROPIC_API_KEY', () => {
    expect(generateEnvExample()).toContain('ANTHROPIC_API_KEY=');
  });
  it('includes notification keys', () => {
    const out = generateEnvExample();
    expect(out).toContain('SLACK_WEBHOOK_URL=');
    expect(out).toContain('SMTP_PASS=');
  });
});

describe('generateGitignoreEntries', () => {
  it('includes .env and runtime dir', () => {
    const out = generateGitignoreEntries();
    expect(out).toContain('.env\n');
    expect(out).toContain('.myrmidon/runtime/');
    expect(out).toContain('.myrmidon/logs/');
  });
});

describe('generateClaudeMd', () => {
  it('includes ## Myrmidon section', () => {
    expect(generateClaudeMd(baseOpts)).toContain('## Myrmidon');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/init/templates.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/init/templates.ts`**

```typescript
import type { RuntimeId } from '../config/schema.js';

export interface TemplateOptions {
  name: string;
  lang: 'zh' | 'en';
  template: 'default' | 'web' | 'mobile' | 'saas' | 'monorepo';
  basePort: number;
  runtime: RuntimeId;
  isExisting: boolean;
  targetDir: string;
}

export function generateConfig(opts: TemplateOptions): string {
  return `import { defineConfig } from 'myrmidon';

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
});
`;
}

export function generateEnvExample(): string {
  return `# Claude Code / Anthropic API
ANTHROPIC_API_KEY=

# Notifications (fill as needed)
SLACK_WEBHOOK_URL=
WECOM_WEBHOOK_URL=
SMTP_PASS=

# External integrations (fill as needed)
FIGMA_TOKEN=
GITHUB_TOKEN=
LINEAR_API_KEY=
`;
}

export function generateGitignoreEntries(): string {
  return `.env
.myrmidon/runtime/
.myrmidon/logs/
node_modules/
dist/
`;
}

export function generateClaudeMd(opts: TemplateOptions): string {
  return `## Myrmidon

This project is orchestrated by Myrmidon.

- Config: \`myrmidon.config.ts\`
- Runtime: ${opts.runtime}
- Start: \`myrmidon start\`
- Status: \`myrmidon status\`
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/core/init/templates.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/init/templates.ts tests/core/init/templates.test.ts
git commit -m "feat: init file template generators (config, env, gitignore, CLAUDE.md)"
```

---

## Task 7: Init Scaffolder

**Files:**
- Create: `src/core/init/scaffolder.ts`
- Create: `tests/core/init/scaffolder.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/init/scaffolder.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffold } from '../../src/core/init/scaffolder.js';

const baseOpts = {
  name: 'my-app',
  lang: 'zh' as const,
  template: 'default' as const,
  basePort: 31000,
  runtime: 'claude-code' as const,
  isExisting: false,
};

let tmpDir: string;
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('scaffold', () => {
  it('creates required directories', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });

    expect(existsSync(join(tmpDir, '.myrmidon/runtime'))).toBe(true);
    expect(existsSync(join(tmpDir, '.myrmidon/logs'))).toBe(true);
    expect(existsSync(join(tmpDir, 'docs/design/ui/components'))).toBe(true);
    expect(existsSync(join(tmpDir, '.claude/rules'))).toBe(true);
  });

  it('creates myrmidon.config.ts', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'myrmidon.config.ts'), 'utf-8');
    expect(content).toContain("name: 'my-app'");
  });

  it('creates .env.example with ANTHROPIC_API_KEY', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const content = readFileSync(join(tmpDir, '.env.example'), 'utf-8');
    expect(content).toContain('ANTHROPIC_API_KEY=');
  });

  it('.gitignore includes .env and runtime dir', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.env');
    expect(content).toContain('.myrmidon/runtime/');
  });

  it('creates SQLite database', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    expect(existsSync(join(tmpDir, '.myrmidon/runtime/myrmidon.db'))).toBe(true);
  });

  it('is idempotent — second run does not throw or overwrite config', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const before = readFileSync(join(tmpDir, 'myrmidon.config.ts'), 'utf-8');
    const result2 = scaffold({ ...baseOpts, targetDir: tmpDir });
    const after = readFileSync(join(tmpDir, 'myrmidon.config.ts'), 'utf-8');
    expect(after).toBe(before);
    expect(result2.skipped).toContain('myrmidon.config.ts');
  });

  it('appends missing .gitignore entries without overwriting existing ones', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    // Pre-create .gitignore with one entry
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n', 'utf-8');
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.env');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/init/scaffolder.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/init/scaffolder.ts`**

```typescript
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateConfig, generateEnvExample, generateGitignoreEntries, generateClaudeMd, type TemplateOptions } from './templates.js';
import { openDatabase } from '../database/client.js';

export type ScaffoldOptions = TemplateOptions;

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  appended: string[];
}

const DIRECTORIES = [
  '.myrmidon/runtime',
  '.myrmidon/logs',
  '.myrmidon/prompts',
  '.myrmidon/skills',
  'docs/prd',
  'docs/requirements',
  'docs/design/architecture',
  'docs/design/ui/components',
  'docs/epics',
  'docs/sprints',
  'docs/qa',
  'docs/security',
  'docs/ops',
  'docs/decisions',
  '.claude/rules',
];

export function scaffold(opts: ScaffoldOptions): ScaffoldResult {
  const result: ScaffoldResult = { created: [], skipped: [], appended: [] };
  const base = opts.targetDir;

  for (const dir of DIRECTORIES) {
    const full = resolve(base, dir);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
      result.created.push(dir + '/');
    }
  }

  createOrSkip(base, 'myrmidon.config.ts', generateConfig(opts), result);
  createOrSkip(base, '.env.example',         generateEnvExample(),        result);
  appendMissing(base, '.gitignore',           generateGitignoreEntries(),  result);
  appendSection(base, 'CLAUDE.md',            generateClaudeMd(opts), '## Myrmidon', result);

  openDatabase(base);

  return result;
}

function createOrSkip(base: string, rel: string, content: string, result: ScaffoldResult): void {
  const full = resolve(base, rel);
  if (!existsSync(full)) {
    writeFileSync(full, content, 'utf-8');
    result.created.push(rel);
  } else {
    result.skipped.push(rel);
  }
}

function appendMissing(base: string, rel: string, newContent: string, result: ScaffoldResult): void {
  const full = resolve(base, rel);
  if (!existsSync(full)) {
    writeFileSync(full, newContent, 'utf-8');
    result.created.push(rel);
    return;
  }
  const existing = readFileSync(full, 'utf-8');
  const missing = newContent.split('\n').filter(line => line.trim() && !existing.includes(line));
  if (missing.length > 0) {
    writeFileSync(full, existing.trimEnd() + '\n' + missing.join('\n') + '\n', 'utf-8');
    result.appended.push(rel);
  } else {
    result.skipped.push(rel);
  }
}

function appendSection(base: string, rel: string, section: string, marker: string, result: ScaffoldResult): void {
  const full = resolve(base, rel);
  if (!existsSync(full)) {
    writeFileSync(full, section, 'utf-8');
    result.created.push(rel);
    return;
  }
  const existing = readFileSync(full, 'utf-8');
  if (!existing.includes(marker)) {
    writeFileSync(full, existing.trimEnd() + '\n\n' + section, 'utf-8');
    result.appended.push(rel);
  } else {
    result.skipped.push(rel);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/core/init/scaffolder.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/init/scaffolder.ts tests/core/init/scaffolder.test.ts
git commit -m "feat: idempotent project scaffolder (dirs + files + SQLite)"
```

---

## Task 8: Config Loader (jiti)

**Files:**
- Create: `src/core/config/loader.ts`
- Create: `tests/core/config/loader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/config/loader.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/core/config/loader.js';
import { MyrmidonError } from '../../src/utils/errors.js';

let tmpDir: string;
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('loads and validates a valid myrmidon.config.ts', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-loader-'));
    writeFileSync(join(tmpDir, 'myrmidon.config.ts'), `
      export default {
        project: { name: 'test-proj', lang: 'zh', description: '' },
        executors: { sonnet: { runtime: 'claude-code', model: 'claude-sonnet-4-6', maxContextTokens: 200000 } },
      };
    `, 'utf-8');

    const config = await loadConfig(tmpDir);
    expect(config.project.name).toBe('test-proj');
    expect(config.basePort).toBe(31000); // default applied
  });

  it('throws MyrmidonError(CONFIG_NOT_FOUND) when file is missing', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-loader-'));
    await expect(loadConfig(tmpDir)).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
    });
  });

  it('throws MyrmidonError(CONFIG_INVALID) when schema fails', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-loader-'));
    writeFileSync(join(tmpDir, 'myrmidon.config.ts'), `
      export default { project: { lang: 'zh' }, executors: {} };
    `, 'utf-8');

    await expect(loadConfig(tmpDir)).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/config/loader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/config/loader.ts`**

```typescript
import { createJiti } from 'jiti';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MyrmidonConfigSchema, type MyrmidonConfig } from './schema.js';
import { MyrmidonError } from '../../utils/errors.js';

export async function loadConfig(baseDir: string): Promise<MyrmidonConfig> {
  const configPath = resolve(baseDir, 'myrmidon.config.ts');
  if (!existsSync(configPath)) {
    throw new MyrmidonError('CONFIG_NOT_FOUND', `No myrmidon.config.ts in ${baseDir}. Run: myrmidon init`);
  }

  const jiti = createJiti(import.meta.url, { moduleCache: false });
  let raw: unknown;
  try {
    const mod = await jiti.import(configPath, { default: true });
    raw = mod;
  } catch (cause) {
    throw new MyrmidonError('CONFIG_LOAD_ERROR', `Failed to load myrmidon.config.ts: ${String(cause)}`, { cause });
  }

  const result = MyrmidonConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new MyrmidonError('CONFIG_INVALID', `Invalid myrmidon.config.ts:\n${issues}`);
  }

  return result.data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/core/config/loader.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/loader.ts tests/core/config/loader.test.ts
git commit -m "feat: config loader via jiti — loads myrmidon.config.ts at runtime"
```

---

## Task 9: `myrmidon config` Commands

**Files:**
- Create: `src/cli/commands/config.ts`
- Create: `tests/cli/commands/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/cli/commands/config.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConfigCommand } from '../../src/cli/commands/config.js';

let tmpDir: string;
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

const validConfigContent = `
export default {
  project: { name: 'acme', lang: 'zh', description: '' },
  executors: { sonnet: { runtime: 'claude-code', model: 'claude-sonnet-4-6', maxContextTokens: 200000 } },
};
`;

describe('config validate', () => {
  it('exits 0 for a valid config', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-cfg-'));
    writeFileSync(join(tmpDir, 'myrmidon.config.ts'), validConfigContent, 'utf-8');
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit:0'); });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = makeConfigCommand();
    await expect(cmd.parseAsync(['node', 'myrmidon', 'validate'])).rejects.toThrow('exit:0');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(consoleSpy.mock.calls.flat().join(' ')).toContain('valid');
  });

  it('exits 1 for missing config', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-cfg-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit:1'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const cmd = makeConfigCommand();
    await expect(cmd.parseAsync(['node', 'myrmidon', 'validate'])).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('config get', () => {
  it('prints the value for a valid key path', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-cfg-'));
    writeFileSync(join(tmpDir, 'myrmidon.config.ts'), validConfigContent, 'utf-8');
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = makeConfigCommand();
    await cmd.parseAsync(['node', 'myrmidon', 'get', 'project.name']).catch(() => {});
    expect(consoleSpy.mock.calls.flat().join(' ')).toContain('acme');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/commands/config.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/cli/commands/config.ts`**

```typescript
import { Command } from 'commander';
import { loadConfig } from '../../core/config/loader.js';
import { openDatabase } from '../../core/database/client.js';
import { MyrmidonError } from '../../utils/errors.js';

export function makeConfigCommand(): Command {
  const cmd = new Command('config').description('Manage Myrmidon configuration');

  cmd.command('validate')
    .description('Validate myrmidon.config.ts against schema')
    .action(async () => {
      try {
        const config = await loadConfig(process.cwd());
        console.log('✓ myrmidon.config.ts is valid');
        console.log(`  project:   ${config.project.name} (${config.project.lang})`);
        console.log(`  executors: ${Object.keys(config.executors).join(', ')}`);
        console.log(`  basePort:  ${config.basePort}`);
        process.exit(0);
      } catch (err) {
        console.error(`✗ ${err instanceof MyrmidonError ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  cmd.command('get <key>')
    .description('Get a config value by dot-path (e.g. project.name)')
    .action(async (key: string) => {
      try {
        const config = await loadConfig(process.cwd());
        const value = key.split('.').reduce((obj: unknown, k) => {
          if (obj !== null && typeof obj === 'object') return (obj as Record<string, unknown>)[k];
          return undefined;
        }, config as unknown);

        if (value === undefined) {
          console.error(`Key not found: ${key}`);
          process.exit(1);
        }
        console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
      } catch (err) {
        console.error(err instanceof MyrmidonError ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd.command('set <key> <value>')
    .description('Store a runtime config override in SQLite (permanent TS edits: edit myrmidon.config.ts directly)')
    .action(async (key: string, value: string) => {
      const db = openDatabase(process.cwd());
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`config.override.${key}`, value);
      console.log(`✓ Runtime override set: ${key} = ${value}`);
    });

  return cmd;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/config.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/config.ts tests/cli/commands/config.test.ts
git commit -m "feat: myrmidon config validate/get/set commands"
```

---

## Task 10: `myrmidon init` Command

**Files:**
- Create: `src/core/init/wizard.ts`
- Create: `src/cli/commands/init.ts`

- [ ] **Step 1: Implement `src/core/init/wizard.ts`**

(Wizard is tested through the integration test in Task 11. Direct unit testing requires complex inquirer mocking — covered there.)

```typescript
import { detectRuntimes, getRuntimeInstallGuide, type RuntimeId } from '../runtime/detector.js';
import { MyrmidonError } from '../../utils/errors.js';

export interface WizardAnswers {
  isExisting: boolean;
  name: string;
  lang: 'zh' | 'en';
  template: 'default' | 'web' | 'mobile' | 'saas' | 'monorepo';
  basePort: number;
  runtime: RuntimeId;
}

export async function runWizard(): Promise<WizardAnswers> {
  const { default: inquirer } = await import('inquirer');
  const detected = detectRuntimes();

  if (detected.length === 0) {
    throw new MyrmidonError(
      'NO_RUNTIME',
      `No supported AI runtime detected.\n\nInstall one:\n${getRuntimeInstallGuide()}\n\nThen retry.`,
    );
  }

  const runtimeChoices = detected.map(rt => ({
    name: `${rt.id.padEnd(14)} ${rt.version}`,
    value: rt.id as RuntimeId,
  }));

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'New project or add Myrmidon to existing project?',
      choices: [
        { name: 'New project', value: 'new' },
        { name: 'Existing project (current directory)', value: 'existing' },
      ],
    },
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      when: (a: { mode: string }) => a.mode === 'new',
      validate: (v: string) => v.trim().length > 0 || 'Project name is required',
    },
    {
      type: 'list',
      name: 'lang',
      message: 'Document language:',
      choices: [{ name: '中文 (zh)', value: 'zh' }, { name: 'English (en)', value: 'en' }],
    },
    {
      type: 'list',
      name: 'template',
      message: 'Project template:',
      choices: ['default', 'web', 'mobile', 'saas', 'monorepo'],
    },
    {
      type: 'number',
      name: 'basePort',
      message: 'Base port for worktrees:',
      default: 31000,
      validate: (v: number) => (v > 1024 && v < 65000) || 'Must be 1025–64999',
    },
    detected.length === 1
      ? {
          type: 'confirm',
          name: 'runtimeConfirm',
          message: `Use ${detected[0]!.id} (${detected[0]!.version})?`,
          default: true,
        }
      : {
          type: 'list',
          name: 'runtime',
          message: 'Select AI runtime:',
          choices: runtimeChoices,
        },
  ]);

  const runtime: RuntimeId = detected.length === 1
    ? (answers.runtimeConfirm ? detected[0]!.id : (() => { throw new MyrmidonError('NO_RUNTIME', 'Runtime selection cancelled'); })())
    : answers.runtime;

  return {
    isExisting: answers.mode === 'existing',
    name: answers.name ?? process.cwd().split('/').pop() ?? 'my-project',
    lang: answers.lang,
    template: answers.template,
    basePort: answers.basePort,
    runtime,
  };
}
```

- [ ] **Step 2: Implement `src/cli/commands/init.ts`**

```typescript
import { Command } from 'commander';
import { resolve } from 'node:path';
import { runWizard } from '../../core/init/wizard.js';
import { scaffold } from '../../core/init/scaffolder.js';
import { detectRuntimes } from '../../core/runtime/detector.js';
import { loadConfig } from '../../core/config/loader.js';
import { MyrmidonError } from '../../utils/errors.js';
import type { RuntimeId } from '../../core/config/schema.js';

export function makeInitCommand(): Command {
  const cmd = new Command('init');
  cmd.description('Initialize a Myrmidon project or add to an existing one');
  cmd.argument('[name]', 'Project name (new projects only)');
  cmd.option('--lang <lang>', 'Document language: zh | en', 'zh');
  cmd.option('--template <template>', 'Template: default | web | mobile | saas | monorepo', 'default');
  cmd.option('--base-port <port>', 'Base port for worktrees', '31000');
  cmd.option('--runtime <runtime>', 'AI runtime: claude-code | opencode | gemini-cli | kimi-codex');
  cmd.option('--add', 'Add Myrmidon to existing project in current directory');
  cmd.option('--yes', 'Skip prompts, use defaults (CI mode)');

  cmd.action(async (name: string | undefined, opts: {
    lang: string; template: string; basePort: string;
    runtime?: string; add?: boolean; yes?: boolean;
  }) => {
    try {
      const hasExplicitArgs = Boolean(name ?? opts.add ?? opts.yes);
      let answers;

      if (!hasExplicitArgs) {
        answers = await runWizard();
      } else {
        const detected = detectRuntimes();
        const runtime = (opts.runtime ?? detected[0]?.id) as RuntimeId | undefined;
        if (!runtime) {
          console.error('✗ No runtime detected. Install one or pass --runtime <id>.');
          process.exit(1);
        }
        answers = {
          isExisting: Boolean(opts.add),
          name: name ?? process.cwd().split('/').pop() ?? 'my-project',
          lang: opts.lang as 'zh' | 'en',
          template: opts.template as 'default' | 'web' | 'mobile' | 'saas' | 'monorepo',
          basePort: parseInt(opts.basePort, 10),
          runtime,
        };
      }

      const targetDir = answers.isExisting
        ? process.cwd()
        : resolve(process.cwd(), answers.name);

      console.log('\nInitializing Myrmidon...\n');
      const result = scaffold({ ...answers, targetDir });

      for (const f of result.created) console.log(`  ✓ created   ${f}`);
      for (const f of result.appended) console.log(`  + appended  ${f}`);
      for (const f of result.skipped) console.log(`  ─ skipped   ${f}`);

      console.log('\nValidating configuration...');
      const config = await loadConfig(targetDir);
      console.log(`✓ Config valid — project: ${config.project.name}`);
      console.log(`\n✓ Done! Next: cd ${answers.name} && myrmidon start`);
    } catch (err) {
      if (err instanceof MyrmidonError) {
        console.error(`\n✗ ${err.message}`);
      } else {
        console.error(`\n✗ Unexpected error: ${String(err)}`);
      }
      process.exit(1);
    }
  });

  return cmd;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/init/wizard.ts src/cli/commands/init.ts
git commit -m "feat: myrmidon init command — wizard + direct mode + config validation"
```

---

## Task 11: CLI Entry Point & Bin

**Files:**
- Create: `src/cli/index.ts`

- [ ] **Step 1: Implement `src/cli/index.ts`**

```typescript
import { program } from 'commander';
import { createRequire } from 'node:module';
import { makeInitCommand } from './commands/init.js';
import { makeConfigCommand } from './commands/config.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

program
  .name('myrmidon')
  .description('AI Agent Orchestrator for software development')
  .version(pkg.version, '-v, --version');

program.addCommand(makeInitCommand());
program.addCommand(makeConfigCommand());

await program.parseAsync(process.argv);
```

- [ ] **Step 2: Smoke-test the CLI in dev mode**

```bash
node --import tsx/esm src/cli/index.ts --help
```

Expected output:
```
Usage: myrmidon [options] [command]

AI Agent Orchestrator for software development

Options:
  -v, --version   output the version number
  -h, --help      display help for command

Commands:
  init [options] [name]
  config
  help [command]
```

- [ ] **Step 3: Build and test the binary**

```bash
npm run build
node dist/cli/index.js --version
```

Expected: `0.1.0`

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: CLI entry point — Commander program with init + config commands"
```

---

## Task 12: Integration Test — Full Init Flow

**Files:**
- Create: `tests/integration/init-flow.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/integration/init-flow.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cp from 'node:child_process';
import { makeInitCommand } from '../../src/cli/commands/init.js';
import { loadConfig } from '../../src/core/config/loader.js';

let tmpDir: string;
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('myrmidon init (direct mode)', () => {
  it('creates a complete project structure and valid config', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-integration-'));
    
    // Mock runtime detection: only claude-code available
    vi.spyOn(cp, 'spawnSync').mockImplementation((cmd) => {
      if (cmd === 'claude') return { status: 0, stdout: 'claude 1.2.3\n', stderr: '' } as ReturnType<typeof cp.spawnSync>;
      return { status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>;
    });

    // Mock cwd so the project is created inside tmpDir
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = makeInitCommand();
    await cmd.parseAsync([
      'node', 'myrmidon', 'my-shop',
      '--lang', 'zh',
      '--template', 'default',
      '--base-port', '31000',
    ]).catch((e: Error) => {
      // process.exit throws in test — only fail for unexpected errors
      if (!e.message.startsWith('exit')) throw e;
    });

    const projectDir = join(tmpDir, 'my-shop');

    // Directory structure
    expect(existsSync(join(projectDir, '.myrmidon/runtime'))).toBe(true);
    expect(existsSync(join(projectDir, '.myrmidon/logs'))).toBe(true);
    expect(existsSync(join(projectDir, 'docs/design/ui/components'))).toBe(true);

    // Generated files
    expect(existsSync(join(projectDir, 'myrmidon.config.ts'))).toBe(true);
    expect(existsSync(join(projectDir, '.env.example'))).toBe(true);
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);
    expect(existsSync(join(projectDir, '.myrmidon/runtime/myrmidon.db'))).toBe(true);

    // Config is loadable and valid
    const config = await loadConfig(projectDir);
    expect(config.project.name).toBe('my-shop');
    expect(config.project.lang).toBe('zh');
    expect(config.executors['sonnet']?.runtime).toBe('claude-code');

    // .gitignore excludes .env
    const gitignore = readFileSync(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.myrmidon/runtime/');

    // .env.example has ANTHROPIC_API_KEY
    const envExample = readFileSync(join(projectDir, '.env.example'), 'utf-8');
    expect(envExample).toContain('ANTHROPIC_API_KEY=');
  });

  it('handles --add mode for existing projects (idempotent)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-integration-'));
    vi.spyOn(cp, 'spawnSync').mockImplementation((cmd) =>
      cmd === 'claude'
        ? { status: 0, stdout: 'claude 1.2.3\n', stderr: '' } as ReturnType<typeof cp.spawnSync>
        : { status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>
    );
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const run = () =>
      makeInitCommand().parseAsync(['node', 'myrmidon', '--add', '--lang', 'zh']).catch(e => {
        if (!e.message.startsWith('exit')) throw e;
      });

    await run();
    await run(); // second run must not throw

    const config = await loadConfig(tmpDir);
    expect(config.project.lang).toBe('zh');
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
npx vitest run tests/integration/init-flow.test.ts
```

Expected: PASS — 2 tests.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, no failures.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Final commit**

```bash
git add tests/integration/init-flow.test.ts
git commit -m "test: integration tests for full myrmidon init flow"
```

---

## Sub-project Boundary

This plan ends here. The following sub-projects build on this foundation:

| Sub-project | First task | Depends on |
|------------|-----------|------------|
| 2 — Orchestrator Core | WorkflowEngine state machine | Task 4 (SQLite), Task 3 (config) |
| 3 — Runtime & Worktree | Executor spawn, worktree lifecycle | Sub-project 2 |
| 4 — TUI | Ink app, 5 tabs | Sub-projects 1 + 2 |
| 5 — Notifications | Slack/WeChat/email | Sub-projects 1 + 2 |
| 6 — Skills & MCP | Skill resolver, MCP lifecycle | Sub-projects 1 + 3 |
