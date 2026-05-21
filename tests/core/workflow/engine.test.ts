import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
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
const dbs: Database.Database[] = [];
afterEach(() => {
  for (const db of dbs) {
    try { db.close(); } catch { /* ignore */ }
  }
  dbs.length = 0;
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
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
    dbs.push(db);
    const engine = makeEngine(db, tmpDir);
    engine.register(simpleTwoNodeWorkflow);
    const loaded = engine.load('test-flow');
    expect(loaded.id).toBe('test-flow');
    expect(loaded.nodes).toHaveLength(2);
  });

  it('throws when loading a workflow that does not exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
    const engine = makeEngine(db, tmpDir);
    expect(() => engine.load('nonexistent')).toThrow("Workflow 'nonexistent' not found");
  });
});

describe('WorkflowEngine.start', () => {
  it('creates a workflow_runs row and node_executions for all nodes', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
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
  });
});

describe('WorkflowEngine.tick', () => {
  it('advances pending entry nodes to completed on first tick (trigger + condition)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
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
  });

  it('marks workflow_run as completed when all nodes complete', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
    const engine = makeEngine(db, tmpDir);
    engine.register(simpleTwoNodeWorkflow);
    const runId = await engine.start('test-flow');
    await engine.tick();
    await engine.tick();

    const run = db
      .prepare('SELECT status FROM workflow_runs WHERE id = ?')
      .get(runId) as { status: string } | undefined;
    expect(run?.status).toBe('completed');
  });
});

describe('WorkflowEngine.recover', () => {
  it('finds the most recent running workflow run and sets runId', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
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
  });
});
