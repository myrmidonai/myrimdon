import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of dbs) {
    try { db.close(); } catch { /* ignore */ }
  }
  dbs.length = 0;
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
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
    dbs.push(db);

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
  });
});
