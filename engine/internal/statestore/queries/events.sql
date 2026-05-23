-- name: AppendEvent :execrows
INSERT OR IGNORE INTO events (id, type, idempotency_key, ts_unix_ms, payload_json)
VALUES (?, ?, ?, ?, ?);

-- name: ReadEventsSince :many
SELECT seq, id, type, idempotency_key, ts_unix_ms, payload_json
FROM events
WHERE seq > ?
ORDER BY seq ASC;
