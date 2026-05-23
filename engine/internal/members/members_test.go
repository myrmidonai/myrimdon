package members

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

func TestAddListGet(t *testing.T) {
	ctx := context.Background()
	r := newRegistry(t)
	if err := r.Add(ctx, Member{ID: "alice", Kind: Human, Name: "Alice"}); err != nil {
		t.Fatalf("add human: %v", err)
	}
	if err := r.Add(ctx, Member{ID: "dev", Kind: DigitalHuman, Name: "DevAgent", WorkflowID: "software-dev-agile"}); err != nil {
		t.Fatalf("add agent: %v", err)
	}

	all, err := r.List(ctx)
	if err != nil || len(all) != 2 {
		t.Fatalf("list: %v len=%d", err, len(all))
	}

	dev, ok, err := r.Get(ctx, "dev")
	if err != nil || !ok {
		t.Fatalf("get dev: ok=%v err=%v", ok, err)
	}
	if dev.WorkflowID != "software-dev-agile" {
		t.Fatalf("workflow: %q", dev.WorkflowID)
	}
	if dev.ActionPolicy != "workflow-only" {
		t.Fatalf("digital-human should default to workflow-only, got %q", dev.ActionPolicy)
	}
}

func TestAddIdempotentPerMember(t *testing.T) {
	ctx := context.Background()
	r := newRegistry(t)
	_ = r.Add(ctx, Member{ID: "alice", Kind: Human, Name: "Alice"})
	_ = r.Add(ctx, Member{ID: "alice", Kind: Human, Name: "Alice"})
	all, _ := r.List(ctx)
	if len(all) != 1 {
		t.Fatalf("want 1 member after duplicate add, got %d", len(all))
	}
}
