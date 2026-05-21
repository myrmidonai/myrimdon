import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/core/database/client.js';
import { WorktreeManager } from '../../../src/core/workflow/worktree.js';

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

describe('WorktreeManager.allocatePort', () => {
  it('returns a port in the expected range', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
    const mgr = new WorktreeManager(tmpDir, db, 31000);
    const port = mgr.allocatePort('task-abc123');
    expect(port).toBeGreaterThanOrEqual(31000);
    expect(port).toBeLessThan(32000);
  });

  it('returns a different port for the same task when the first is occupied', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
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
    dbs.push(db);
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
  });

  it('list() returns rows from the worktrees table', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const db = openDatabase(tmpDir);
    dbs.push(db);
    db.prepare(
      "INSERT INTO worktrees (branch, path, task_id, port, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('my-branch', '/tmp/my', 'task-1', 31001, new Date().toISOString(), 'active');
    const mgr = new WorktreeManager(tmpDir, db, 31000);
    const list = mgr.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.branch).toBe('my-branch');
  });
});