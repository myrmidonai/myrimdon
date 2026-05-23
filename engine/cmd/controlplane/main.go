package main

import (
	"log"
	"net/http"
	"os"

	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"github.com/myrmidonai/myrmidon/gen/myrmidon/v1/myrmidonv1connect"
	"github.com/myrmidonai/myrmidon/internal/registry"
	"github.com/myrmidonai/myrmidon/internal/server"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

func main() {
	addr := envOr("MYRMIDON_CP_ADDR", "127.0.0.1:9100")
	dbPath := envOr("MYRMIDON_DB", "myrmidon.db")

	store, err := statestore.OpenSQLite(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer store.Close()

	h := server.NewRunnerServiceHandler(registry.New(store))
	mux := http.NewServeMux()
	mux.Handle(myrmidonv1connect.NewRunnerServiceHandler(h))

	log.Printf("control plane listening on http://%s", addr)
	// h2c lets us serve gRPC/Connect over plain HTTP/2 (no TLS) for local dev.
	if err := http.ListenAndServe(addr, h2c.NewHandler(mux, &http2.Server{})); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
