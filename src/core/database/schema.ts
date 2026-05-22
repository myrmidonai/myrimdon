export const SCHEMA_VERSION = 3;

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS executor_procs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  task_id     TEXT,
  pid         INTEGER NOT NULL,
  port        INTEGER,
  proc_type   TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  killed_at   TEXT
);

CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  name        TEXT NOT NULL,
  def_json    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`;

export const MIGRATIONS: Record<number, string> = {
  2: `
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id            TEXT PRIMARY KEY,
      workflow_id   TEXT NOT NULL,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      context_json  TEXT
    );
    CREATE TABLE IF NOT EXISTS node_executions (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL,
      node_id       TEXT NOT NULL,
      status        TEXT NOT NULL,
      attempt       INTEGER DEFAULT 1,
      agent_id      TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      error         TEXT,
      output_json   TEXT
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id           TEXT PRIMARY KEY,
      workflow_id  TEXT NOT NULL,
      run_id       TEXT NOT NULL,
      node_id      TEXT NOT NULL,
      file_path    TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
  `,

  3: `
    -- Drop PRD1-era domain-specific tables
    DROP TABLE IF EXISTS workflow;
    DROP TABLE IF EXISTS agents;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS worktrees;
    DROP TABLE IF EXISTS git_ops;
    DROP TABLE IF EXISTS timer_events;
    DROP TABLE IF EXISTS agent_sessions;

    -- Drop old projection tables (replaced below with richer schema)
    DROP TABLE IF EXISTS workflow_runs;
    DROP TABLE IF EXISTS node_executions;
    DROP TABLE IF EXISTS artifacts;

    -- Append-only event log (source of truth)
    CREATE TABLE IF NOT EXISTS events (
      seq              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id           TEXT NOT NULL,
      type             TEXT NOT NULL,
      payload_json     TEXT NOT NULL,
      idempotency_key  TEXT NOT NULL UNIQUE,
      created_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id, seq);

    -- Projection tables (rebuilt from events)
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id            TEXT PRIMARY KEY,
      workflow_id   TEXT NOT NULL,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      context_json  TEXT,
      lease_token   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS node_executions (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL,
      node_id       TEXT NOT NULL,
      status        TEXT NOT NULL,
      attempt       INTEGER NOT NULL DEFAULT 1,
      agent_id      TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      error         TEXT,
      output_json   TEXT,
      feedback_json TEXT
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id           TEXT PRIMARY KEY,
      workflow_id  TEXT NOT NULL,
      run_id       TEXT NOT NULL,
      node_id      TEXT NOT NULL,
      file_path    TEXT NOT NULL,
      status       TEXT NOT NULL,
      checksum     TEXT,
      upstream_ids TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
  `,
};
