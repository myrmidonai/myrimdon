package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"

	"connectrpc.com/connect"
	v1 "github.com/myrmidonai/myrmidon/gen/myrmidon/v1"
	"github.com/myrmidonai/myrmidon/gen/myrmidon/v1/myrmidonv1connect"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "status" {
		fmt.Fprintln(os.Stderr, "usage: myrmidon status")
		os.Exit(2)
	}
	cpURL := envOr("MYRMIDON_CP_URL", "http://127.0.0.1:9100")
	if err := runStatus(context.Background(), http.DefaultClient, cpURL, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

// runStatus is the testable core: queries the control plane and writes a
// human-readable runner list to w.
func runStatus(ctx context.Context, httpClient connect.HTTPClient, cpURL string, w io.Writer) error {
	client := myrmidonv1connect.NewRunnerServiceClient(httpClient, cpURL)
	resp, err := client.ListRunners(ctx, connect.NewRequest(&v1.ListRunnersRequest{}))
	if err != nil {
		return err
	}
	runners := resp.Msg.GetRunners()
	if len(runners) == 0 {
		fmt.Fprintln(w, "no runners registered")
		return nil
	}
	fmt.Fprintf(w, "%-20s %-22s %s\n", "RUNNER", "ADDRESS", "REGISTERED_AT_MS")
	for _, r := range runners {
		fmt.Fprintf(w, "%-20s %-22s %d\n", r.GetRunnerId(), r.GetAddress(), r.GetRegisteredAtUnixMs())
	}
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
