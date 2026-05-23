// Package runneragent is the runner-side client that registers with and
// heartbeats to the control plane.
package runneragent

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"connectrpc.com/connect"
	v1 "github.com/myrmidonai/myrmidon/gen/myrmidon/v1"
	"github.com/myrmidonai/myrmidon/gen/myrmidon/v1/myrmidonv1connect"
)

type Agent struct {
	client   myrmidonv1connect.RunnerServiceClient
	runnerID string
	address  string
}

func New(controlPlaneURL, runnerID, address string) *Agent {
	return &Agent{
		client:   myrmidonv1connect.NewRunnerServiceClient(http.DefaultClient, controlPlaneURL),
		runnerID: runnerID,
		address:  address,
	}
}

func (a *Agent) Register(ctx context.Context) error {
	resp, err := a.client.Register(ctx, connect.NewRequest(&v1.RegisterRequest{
		RunnerId: a.runnerID,
		Address:  a.address,
	}))
	if err != nil {
		return fmt.Errorf("register: %w", err)
	}
	if !resp.Msg.GetOk() {
		return fmt.Errorf("control plane rejected registration")
	}
	return nil
}

// HeartbeatLoop sends a heartbeat every interval until ctx is cancelled.
func (a *Agent) HeartbeatLoop(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_, _ = a.client.Heartbeat(ctx, connect.NewRequest(&v1.HeartbeatRequest{RunnerId: a.runnerID}))
		}
	}
}
