import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../../src/core/database/client.js';
import { AgentExecutor } from '../../../../src/core/workflow/executors/agent.js';
import { ConsoleBus } from '../../../../src/core/workflow/notifications.js';
import { ClaudeCodeAdapter } from '../../../../src/core/workflow/runtime-adapter.js';
import type { NodeContext } from '../../../../src/core/workflow/executor-registry.js';
import type { MyrmidonConfig } from '../../../../src/core/config/schema.js';

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
    dbs.push(db);
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
  });
});
