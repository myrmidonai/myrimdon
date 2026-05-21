export const SCHEMA_VERSION = 1;

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS workflow (
  id                        INTEGER PRIMARY KEY DEFAULT 1,
  state                     TEXT NOT NULL DEFAULT 'IDLE',
  current_phase             TEXT,
  current_epic              TEXT,
  current_sprint            TEXT,
  workflow_node             TEXT,
  started_at                TEXT,
  updated_at                TEXT,
  pending_confirmation      TEXT,
  confirmation_requested_at TEXT,
  next_poll_at              TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  name          TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'idle',
  current_task  TEXT,
  worktree      TEXT,
  started_at    TEXT,
  updated_at    TEXT,
  waiting_for   TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  sprint        TEXT,
  assignee      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  worktree      TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  retry_count   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS worktrees (
  branch      TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  task_id     INTEGER NOT NULL,
  port        INTEGER NOT NULL,
  agent       TEXT,
  created_at  TEXT,
  status      TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS git_ops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operation   TEXT NOT NULL,
  branch      TEXT NOT NULL,
  target      TEXT,
  result      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timer_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timer_id    TEXT NOT NULL,
  event       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  duration_ms INTEGER,
  detail      TEXT
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  task_id     TEXT,
  start_time  TEXT NOT NULL,
  end_time    TEXT,
  exit_status TEXT,
  file_path   TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO workflow (id, state) VALUES (1, 'IDLE');
`;
