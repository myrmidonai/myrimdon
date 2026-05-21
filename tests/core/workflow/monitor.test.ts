import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/core/database/client.js';
import { AgentMonitor } from '../../../src/core/workflow/monitor.js';
import { ConsoleBus } from '../../../src/core/workflow/notifications.js';

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

describe('AgentMonitor.checkHeartbeats', () => {
  it('marks node_execution as failed when PID is not alive', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'monitor-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
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
  });
});

describe('AgentMonitor.checkStuckAgents', () => {
  it('emits agent_stuck for nodes running past threshold', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'monitor-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
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
  });
});
