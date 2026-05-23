package runneragent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	v1 "github.com/myrmidonai/myrmidon/gen/myrmidon/v1"
	"github.com/myrmidonai/myrmidon/gen/myrmidon/v1/myrmidonv1connect"
	"github.com/myrmidonai/myrmidon/internal/registry"
	"github.com/myrmidonai/myrmidon/internal/server"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

func TestRunnerRegisters(t *testing.T) {
	store, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	mux := http.NewServeMux()
	mux.Handle(myrmidonv1connect.NewRunnerServiceHandler(
		server.NewRunnerServiceHandler(registry.New(store))))
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	a := New(ts.URL, "runner-1", "127.0.0.1:9001")
	if err := a.Register(context.Background()); err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Verify via the same service that the runner is now listed.
	client := myrmidonv1connect.NewRunnerServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListRunners(context.Background(), connect.NewRequest(&v1.ListRunnersRequest{}))
	if err != nil {
		t.Fatalf("ListRunners: %v", err)
	}
	if len(resp.Msg.GetRunners()) != 1 {
		t.Fatalf("want 1 runner, got %d", len(resp.Msg.GetRunners()))
	}
}
