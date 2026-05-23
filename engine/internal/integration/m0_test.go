package integration

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	v1 "github.com/myrmidonai/myrmidon/gen/myrmidon/v1"
	"github.com/myrmidonai/myrmidon/gen/myrmidon/v1/myrmidonv1connect"
	"github.com/myrmidonai/myrmidon/internal/registry"
	"github.com/myrmidonai/myrmidon/internal/runneragent"
	"github.com/myrmidonai/myrmidon/internal/server"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

// TestM0Gate wires the full stack in-process and proves the M0 gate:
// runner registers → RUNNER_REGISTERED event persists → status (ListRunners) shows it.
func TestM0Gate_RunnerRegistersEventPersistsAndStatusShows(t *testing.T) {
	ctx := context.Background()

	store, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	reg := registry.New(store)

	mux := http.NewServeMux()
	mux.Handle(myrmidonv1connect.NewRunnerServiceHandler(server.NewRunnerServiceHandler(reg)))
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	// Runner registers.
	a := runneragent.New(ts.URL, "runner-A", "127.0.0.1:9001")
	if err := a.Register(ctx); err != nil {
		t.Fatalf("runner register: %v", err)
	}

	// Gate assertion 1: a RUNNER_REGISTERED event is in the event log.
	events, err := store.ReadEvents(ctx, 0)
	if err != nil {
		t.Fatalf("read events: %v", err)
	}
	found := false
	for _, e := range events {
		if e.Type == "RUNNER_REGISTERED" && strings.Contains(e.PayloadJSON, "runner-A") {
			found = true
		}
	}
	if !found {
		t.Fatalf("RUNNER_REGISTERED event not found in log: %+v", events)
	}

	// Gate assertion 2: ListRunners (what `myrmidon status` calls) shows it.
	client := myrmidonv1connect.NewRunnerServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListRunners(ctx, connect.NewRequest(&v1.ListRunnersRequest{}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(resp.Msg.GetRunners()) != 1 || resp.Msg.GetRunners()[0].GetRunnerId() != "runner-A" {
		t.Fatalf("status would not show runner-A: %+v", resp.Msg.GetRunners())
	}
}
