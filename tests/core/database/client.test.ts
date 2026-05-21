import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../../src/core/database/client.js';

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
