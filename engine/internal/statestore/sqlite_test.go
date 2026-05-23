package statestore

import (
	"context"
	"testing"
)

func newTestStore(t *testing.T) *SQLiteStore {
	t.Helper()
	s, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestAppendAndReadInSeqOrder(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	for _, typ := range []string{"A", "B", "C"} {
		appended, err := s.AppendEvent(ctx, Event{ID: typ, Type: typ, IdempotencyKey: typ, TSUnixMs: 1})
		if err != nil {
			t.Fatalf("append %s: %v", typ, err)
		}
		if !appended {
			t.Fatalf("expected append=true for %s", typ)
		}
	}

	events, err := s.ReadEvents(ctx, 0)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("want 3 events, got %d", len(events))
	}
	if events[0].Type != "A" || events[2].Type != "C" {
		t.Fatalf("events out of order: %+v", events)
	}
	if events[0].Seq >= events[1].Seq || events[1].Seq >= events[2].Seq {
		t.Fatalf("seq not strictly increasing: %v %v %v", events[0].Seq, events[1].Seq, events[2].Seq)
	}
}

func TestIdempotentAppend(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	first, err := s.AppendEvent(ctx, Event{ID: "x1", Type: "X", IdempotencyKey: "dup", TSUnixMs: 1})
	if err != nil || !first {
		t.Fatalf("first append: appended=%v err=%v", first, err)
	}
	second, err := s.AppendEvent(ctx, Event{ID: "x2", Type: "X", IdempotencyKey: "dup", TSUnixMs: 2})
	if err != nil {
		t.Fatalf("second append err: %v", err)
	}
	if second {
		t.Fatalf("expected appended=false on duplicate idempotency key")
	}

	events, err := s.ReadEvents(ctx, 0)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("want 1 event after dup, got %d", len(events))
	}
}

func TestReadSinceSeq(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	_, _ = s.AppendEvent(ctx, Event{ID: "1", Type: "T", IdempotencyKey: "1", TSUnixMs: 1})
	_, _ = s.AppendEvent(ctx, Event{ID: "2", Type: "T", IdempotencyKey: "2", TSUnixMs: 1})

	all, _ := s.ReadEvents(ctx, 0)
	tail, err := s.ReadEvents(ctx, all[0].Seq)
	if err != nil {
		t.Fatalf("read since: %v", err)
	}
	if len(tail) != 1 || tail[0].ID != "2" {
		t.Fatalf("want only event 2 after sinceSeq, got %+v", tail)
	}
}
