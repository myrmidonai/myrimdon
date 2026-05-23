package statestore

import (
	"context"
	"database/sql"
	"embed"
	"fmt"

	"github.com/myrmidonai/myrmidon/internal/statestore/db"
	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type SQLiteStore struct {
	sqldb *sql.DB
	q     *db.Queries
}

// OpenSQLite opens a SQLite-backed event log and applies goose migrations.
// Use ":memory:" for tests or a file path for persistence.
func OpenSQLite(dsn string) (*SQLiteStore, error) {
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	sqldb.SetMaxOpenConns(1) // keep :memory: schema stable across calls

	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return nil, fmt.Errorf("goose dialect: %w", err)
	}
	if err := goose.Up(sqldb, "migrations"); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &SQLiteStore{sqldb: sqldb, q: db.New(sqldb)}, nil
}

func (s *SQLiteStore) AppendEvent(ctx context.Context, e Event) (bool, error) {
	rows, err := s.q.AppendEvent(ctx, db.AppendEventParams{
		ID:             e.ID,
		Type:           e.Type,
		IdempotencyKey: e.IdempotencyKey,
		TsUnixMs:       e.TSUnixMs,
		PayloadJson:    e.PayloadJSON,
	})
	if err != nil {
		return false, fmt.Errorf("append: %w", err)
	}
	return rows == 1, nil
}

func (s *SQLiteStore) ReadEvents(ctx context.Context, sinceSeq int64) ([]Event, error) {
	rows, err := s.q.ReadEventsSince(ctx, sinceSeq)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	out := make([]Event, 0, len(rows))
	for _, r := range rows {
		out = append(out, Event{
			Seq:            r.Seq,
			ID:             r.ID,
			Type:           r.Type,
			IdempotencyKey: r.IdempotencyKey,
			TSUnixMs:       r.TsUnixMs,
			PayloadJSON:    r.PayloadJson,
		})
	}
	return out, nil
}

func (s *SQLiteStore) Close() error { return s.sqldb.Close() }
