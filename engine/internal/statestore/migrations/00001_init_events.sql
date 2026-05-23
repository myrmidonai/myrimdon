-- +goose Up
CREATE TABLE events (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    id              TEXT NOT NULL UNIQUE,
    type            TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    ts_unix_ms      INTEGER NOT NULL,
    payload_json    TEXT NOT NULL DEFAULT ''
);

-- +goose Down
DROP TABLE events;
