import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/core/database/client.js';
import { buildDispatchPrompt, writeDispatchPrompt } from '../../../src/core/workflow/dispatcher.js';
import type { NodeDef } from '../../../src/core/workflow/schema.js';
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
    dbs.push(db);
    const node: NodeDef = { id: 'writer', type: 'agent', name: 'Writer', agentRole: 'pm' };
    const prompt = buildDispatchPrompt({ node, workflowId: 'wf-1', runId: 'run-1', db, config: minimalConfig, projectRoot: tmpDir });
    expect(prompt.node.id).toBe('writer');
    expect(prompt.node.name).toBe('Writer');
  });

  it('resolves consumed artifacts from DB', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'disp-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
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
  });

  it('marks missing artifacts as missing', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'disp-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
    const node: NodeDef = {
      id: 'writer',
      type: 'agent',
      name: 'Writer',
      artifacts: { consumes: [{ id: 'nonexistent' }], produces: [] },
    };
    const prompt = buildDispatchPrompt({ node, workflowId: 'wf-1', runId: 'run-1', db, config: minimalConfig, projectRoot: tmpDir });
    expect(prompt.artifacts.consumes[0]?.status).toBe('missing');
  });
});

describe('writeDispatchPrompt', () => {
  it('writes a JSON file and returns the path', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'disp-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
    const node: NodeDef = { id: 'writer', type: 'agent', name: 'Writer' };
    const prompt = buildDispatchPrompt({ node, workflowId: 'wf-1', runId: 'run-1', db, config: minimalConfig, projectRoot: tmpDir });
    const filePath = writeDispatchPrompt({ prompt, projectRoot: tmpDir });
    expect(existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as typeof prompt;
    expect(parsed.runId).toBe('run-1');
  });
});
