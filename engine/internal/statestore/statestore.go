// Package statestore is the single persistence boundary (PRD6 §15.2).
// Business code MUST go through StateStore, never raw SQL.
package statestore

import "context"

// Event is one append-only record in the event log (PRD6 §15.1).
type Event struct {
	Seq            int64  // monotonic, assigned by the store on append
	ID             string // unique event id
	Type           string // e.g. "RUNNER_REGISTERED"
	IdempotencyKey string // dedup key; duplicate appends are ignored
	TSUnixMs       int64
	PayloadJSON    string
}

// StateStore is the append-only event log + projection boundary.
// v1 = SQLite; later impls (Postgres) swap in without touching callers.
type StateStore interface {
	// AppendEvent appends e. If an event with the same IdempotencyKey already
	// exists, it is a no-op and returns (false, nil). On a real append it
	// returns (true, nil). Seq is assigned by the store.
	AppendEvent(ctx context.Context, e Event) (appended bool, err error)

	// ReadEvents returns all events with Seq > sinceSeq, ordered by Seq ascending.
	ReadEvents(ctx context.Context, sinceSeq int64) ([]Event, error)

	Close() error
}
