import type Database from 'better-sqlite3';
import type { StateStore, Event, EventInput, Query } from '../state-store.js';

export class SqliteStateStore implements StateStore {
  constructor(private readonly db: Database.Database) {}

  async appendEvent(e: EventInput): Promise<Event> {
    const existing = this.db
      .prepare('SELECT * FROM events WHERE idempotency_key = ?')
      .get(e.idempotency_key) as Event | undefined;
    if (existing) return existing;

    const result = this.db
      .prepare(
        'INSERT INTO events (run_id, type, payload_json, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(e.run_id, e.type, e.payload_json, e.idempotency_key, e.created_at);

    return { ...e, seq: Number(result.lastInsertRowid) };
  }

  async *readEvents(runId: string, since?: number): AsyncGenerator<Event> {
    const rows =
      since != null
        ? (this.db
            .prepare('SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq')
            .all(runId, since) as Event[])
        : (this.db
            .prepare('SELECT * FROM events WHERE run_id = ? ORDER BY seq')
            .all(runId) as Event[]);
    for (const row of rows) yield row;
  }

  async projection<T>(table: string, query?: Query): Promise<T[]> {
    const params: unknown[] = [];
    let sql = `SELECT * FROM ${table}`;
    if (query?.where && Object.keys(query.where).length > 0) {
      const clauses = Object.entries(query.where).map(([k, v]) => {
        params.push(v);
        return `${k} = ?`;
      });
      sql += ` WHERE ${clauses.join(' AND ')}`;
    }
    if (query?.orderBy) sql += ` ORDER BY ${query.orderBy}`;
    if (query?.limit) { sql += ` LIMIT ?`; params.push(query.limit); }
    return this.db.prepare(sql).all(...params) as T[];
  }
}
