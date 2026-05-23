package registry

import (
	"context"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/statestore"
)

func newRegistry(t *testing.T) *Registry {
	t.Helper()
	s, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return New(s)
}

func TestRegisterAppendsEventAndLists(t *testing.T) {
	ctx := context.Background()
	r := newRegistry(t)

	if err := r.Register(ctx, "runner-1", "127.0.0.1:9001"); err != nil {
		t.Fatalf("register: %v", err)
	}

	runners, err := r.List(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(runners) != 1 || runners[0].RunnerID != "runner-1" || runners[0].Address != "127.0.0.1:9001" {
		t.Fatalf("unexpected runners: %+v", runners)
	}
}

func TestRegisterIsIdempotentPerRunner(t *testing.T) {
	ctx := context.Background()
	r := newRegistry(t)
	_ = r.Register(ctx, "runner-1", "127.0.0.1:9001")
	_ = r.Register(ctx, "runner-1", "127.0.0.1:9001") // same id+addr → no duplicate

	runners, _ := r.List(ctx)
	if len(runners) != 1 {
		t.Fatalf("want 1 runner after duplicate register, got %d", len(runners))
	}
}
