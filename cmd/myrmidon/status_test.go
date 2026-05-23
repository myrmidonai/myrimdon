package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/myrmidonai/myrmidon/gen/myrmidon/v1/myrmidonv1connect"
	"github.com/myrmidonai/myrmidon/internal/registry"
	"github.com/myrmidonai/myrmidon/internal/server"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

func TestStatusListsRegisteredRunners(t *testing.T) {
	store, _ := statestore.OpenSQLite(":memory:")
	t.Cleanup(func() { _ = store.Close() })
	reg := registry.New(store)
	_ = reg.Register(context.Background(), "runner-1", "127.0.0.1:9001")

	mux := http.NewServeMux()
	mux.Handle(myrmidonv1connect.NewRunnerServiceHandler(server.NewRunnerServiceHandler(reg)))
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	var out strings.Builder
	if err := runStatus(context.Background(), ts.Client(), ts.URL, &out); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
	if !strings.Contains(out.String(), "runner-1") || !strings.Contains(out.String(), "127.0.0.1:9001") {
		t.Fatalf("status output missing runner: %q", out.String())
	}
}
