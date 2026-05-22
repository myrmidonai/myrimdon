import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteStateStore } from '../../src/core/foundation/impl/sqlite-state-store.js';
import { CREATE_TABLES, MIGRATIONS } from '../../src/core/database/schema.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(CREATE_TABLES);
  db.exec(MIGRATIONS[2]);
  db.exec(MIGRATIONS[3]);
  db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('schema_version','3')").run();
  return db;
}

describe('SqliteStateStore', () => {
  let db: Database.Database;
  let store: SqliteStateStore;

  beforeEach(() => { db = makeDb(); store = new SqliteStateStore(db); });
  afterEach(() => db.close());

  it('appends an event and returns it with seq=1', async () => {
    const e = await store.appendEvent({
      run_id: 'r1', type: 'NODE_STARTED', payload_json: '{}',
      idempotency_key: 'r1:n1:start', created_at: '2026-01-01T00:00:00Z',
    });
    expect(e.seq).toBe(1);
    expect(e.type).toBe('NODE_STARTED');
  });

  it('is idempotent on duplicate idempotency_key', async () => {
    const input = { run_id: 'r1', type: 'X', payload_json: '{}',
      idempotency_key: 'k1', created_at: '' };
    const a = await store.appendEvent(input);
    const b = await store.appendEvent(input);
    expect(b.seq).toBe(a.seq);
    const rows = db.prepare('SELECT * FROM events').all();
    expect(rows).toHaveLength(1);
  });

  it('readEvents yields events in seq order', async () => {
    await store.appendEvent({ run_id: 'r', type: 'A', payload_json: '{}', idempotency_key: 'k1', created_at: '' });
    await store.appendEvent({ run_id: 'r', type: 'B', payload_json: '{}', idempotency_key: 'k2', created_at: '' });
    const types: string[] = [];
    for await (const e of store.readEvents('r')) types.push(e.type);
    expect(types).toEqual(['A', 'B']);
  });

  it('readEvents with since filters older events', async () => {
    const e1 = await store.appendEvent({ run_id: 'r', type: 'A', payload_json: '{}', idempotency_key: 'k1', created_at: '' });
    await store.appendEvent({ run_id: 'r', type: 'B', payload_json: '{}', idempotency_key: 'k2', created_at: '' });
    const types: string[] = [];
    for await (const e of store.readEvents('r', e1.seq)) types.push(e.type);
    expect(types).toEqual(['B']);
  });

  it('projection queries a table with where clause', async () => {
    db.prepare("INSERT INTO workflow_runs VALUES ('run-1','wf-1','running','2026-01-01',NULL,NULL,1)").run();
    db.prepare("INSERT INTO workflow_runs VALUES ('run-2','wf-1','completed','2026-01-01','2026-01-02',NULL,1)").run();
    const rows = await store.projection<{ id: string }>('workflow_runs', { where: { status: 'running' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('run-1');
  });
});
