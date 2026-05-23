package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/myrmidonai/myrmidon/internal/runneragent"
)

func main() {
	cpURL := envOr("MYRMIDON_CP_URL", "http://127.0.0.1:9100")
	runnerID := envOr("MYRMIDON_RUNNER_ID", "runner-local")
	addr := envOr("MYRMIDON_RUNNER_ADDR", "127.0.0.1:9001")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	a := runneragent.New(cpURL, runnerID, addr)
	if err := a.Register(ctx); err != nil {
		log.Fatalf("register with control plane: %v", err)
	}
	log.Printf("runner %q registered with %s", runnerID, cpURL)

	a.HeartbeatLoop(ctx, 15*time.Second)
	log.Printf("runner %q shutting down", runnerID)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
