import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorkflowEngine } from '../../src/core/engine/workflow-engine.js';
import { SqliteStateStore } from '../../src/core/foundation/impl/sqlite-state-store.js';
import { LocalArtifactStore } from '../../src/core/foundation/impl/local-artifact-store.js';
import { LocalExecutionBackend } from '../../src/core/foundation/impl/local-execution-backend.js';
import { NoopScheduler } from '../../src/core/foundation/impl/noop-scheduler.js';
import { ExecutorRegistry } from '../../src/core/workflow/executor-registry.js';
import { CREATE_TABLES, MIGRATIONS } from '../../src/core/database/schema.js';
import { defineWorkflow } from '../../src/core/workflow/schema.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(CREATE_TABLES);
  db.exec(MIGRATIONS[2]);
  db.exec(MIGRATIONS[3]);
  return db;
}

const triggerOnlyWorkflow = defineWorkflow({
  id: 'test-wf', version: '1.0', name: 'Test',
  nodes: [{ id: 'start', type: 'trigger', name: 'Start' }],
  edges: [],
});

describe('WorkflowEngine', () => {
  let db: Database.Database;
  let engine: WorkflowEngine;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'engine-test-'));
    db = makeDb();
    const stateStore = new SqliteStateStore(db);
    const artifactStore = new LocalArtifactStore(dir);
    const backend = new LocalExecutionBackend();
    const scheduler = new NoopScheduler();
    const registry = new ExecutorRegistry();
    engine = new WorkflowEngine(stateStore, artifactStore, backend, scheduler, registry, dir);
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('start creates a workflow_run row with status=running', async () => {
    engine.register(triggerOnlyWorkflow);
    const runId = await engine.start('test-wf');
    const rows = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").all(runId);
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).status).toBe('running');
  });

  it('start creates node_execution rows for all nodes', async () => {
    engine.register(triggerOnlyWorkflow);
    const runId = await engine.start('test-wf');
    const rows = db.prepare("SELECT * FROM node_executions WHERE run_id = ?").all(runId);
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).node_id).toBe('start');
    expect((rows[0] as any).status).toBe('pending');
  });

  it('tick dispatches a trigger node (trigger completes immediately)', async () => {
    engine.register(triggerOnlyWorkflow);
    await engine.start('test-wf');
    await engine.tick();
    const rows = db.prepare("SELECT status FROM node_executions WHERE node_id = 'start'").all();
    expect((rows[0] as any).status).toBe('completed');
  });
});
