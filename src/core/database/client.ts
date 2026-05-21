import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREATE_TABLES, SCHEMA_VERSION } from './schema.js';

export function openDatabase(baseDir: string): Database.Database {
  const runtimeDir = resolve(baseDir, '.myrmidon', 'runtime');
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });

  const db = new Database(resolve(runtimeDir, 'myrmidon.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLES);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  return db;
}
