import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../../src/core/database/client.js';
import { HumanApprovalExecutor } from '../../../../src/core/workflow/executors/human-approval.js';
import { ConsoleBus } from '../../../../src/core/workflow/notifications.js';
import type { NodeContext } from '../../../../src/core/workflow/executor-registry.js';
import type { NodeDef } from '../../../../src/core/workflow/schema.js';

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

function makeCtx(node: NodeDef, tmpD: string): NodeContext {
  const db = openDatabase(tmpD);
  dbs.push(db);
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
