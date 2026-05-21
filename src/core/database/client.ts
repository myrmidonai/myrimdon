import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREATE_TABLES, MIGRATIONS, SCHEMA_VERSION } from './schema.js';

export function openDatabase(baseDir: string): Database.Database {
  const runtimeDir = resolve(baseDir, '.myrmidon', 'runtime');
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });

  const db = new Database(resolve(runtimeDir, 'myrmidon.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);

  // Read current schema version (absent on brand-new DB = treat as 1)
  const metaRow = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined;
  let current = metaRow ? parseInt(metaRow.value, 10) : 1;

  // Apply any pending migrations sequentially
  while (current < SCHEMA_VERSION) {
    const next = current + 1;
    const sql = MIGRATIONS[next];
    if (sql) db.exec(sql);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(next),
    );
    current = next;
  }

  return db;
}
