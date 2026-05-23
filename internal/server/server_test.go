package server

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	v1 "github.com/myrmidonai/myrmidon/gen/myrmidon/v1"
	"github.com/myrmidonai/myrmidon/internal/registry"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

func newHandler(t *testing.T) *RunnerServiceHandler {
	t.Helper()
	s, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return NewRunnerServiceHandler(registry.New(s))
}

func TestRegisterThenListRunners(t *testing.T) {
	ctx := context.Background()
	h := newHandler(t)

	regResp, err := h.Register(ctx, connect.NewRequest(&v1.RegisterRequest{
		RunnerId: "runner-1", Address: "127.0.0.1:9001",
	}))
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if !regResp.Msg.GetOk() {
		t.Fatalf("expected ok=true")
	}

	listResp, err := h.ListRunners(ctx, connect.NewRequest(&v1.ListRunnersRequest{}))
	if err != nil {
		t.Fatalf("ListRunners: %v", err)
	}
	runners := listResp.Msg.GetRunners()
	if len(runners) != 1 || runners[0].GetRunnerId() != "runner-1" {
		t.Fatalf("unexpected runners: %+v", runners)
	}
}
