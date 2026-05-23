// Package registry owns runner domain logic. It persists through StateStore
// and never touches SQL directly (PRD6 §28 boundary discipline).
package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

const eventRunnerRegistered = "RUNNER_REGISTERED"

type Runner struct {
	RunnerID         string `json:"runner_id"`
	Address          string `json:"address"`
	RegisteredAtUnix int64  `json:"registered_at_unix_ms"`
}

type Registry struct {
	store statestore.StateStore
	now   func() time.Time
}

func New(store statestore.StateStore) *Registry {
	return &Registry{store: store, now: time.Now}
}

// Register records a runner. Idempotent per runner_id (same runner registering
// twice produces at most one RUNNER_REGISTERED event).
func (r *Registry) Register(ctx context.Context, runnerID, address string) error {
	if runnerID == "" {
		return fmt.Errorf("runnerID required")
	}
	payload, err := json.Marshal(Runner{
		RunnerID:         runnerID,
		Address:          address,
		RegisteredAtUnix: r.now().UnixMilli(),
	})
	if err != nil {
		return fmt.Errorf("marshal runner: %w", err)
	}
	_, err = r.store.AppendEvent(ctx, statestore.Event{
		ID:             uuid.NewString(),
		Type:           eventRunnerRegistered,
		IdempotencyKey: eventRunnerRegistered + ":" + runnerID,
		TSUnixMs:       r.now().UnixMilli(),
		PayloadJSON:    string(payload),
	})
	return err
}

// List rebuilds the runner set by replaying RUNNER_REGISTERED events
// (projection from the event log — PRD6 §15.1).
func (r *Registry) List(ctx context.Context) ([]Runner, error) {
	events, err := r.store.ReadEvents(ctx, 0)
	if err != nil {
		return nil, err
	}
	var out []Runner
	for _, e := range events {
		if e.Type != eventRunnerRegistered {
			continue
		}
		var run Runner
		if err := json.Unmarshal([]byte(e.PayloadJSON), &run); err != nil {
			return nil, fmt.Errorf("unmarshal runner event %s: %w", e.ID, err)
		}
		out = append(out, run)
	}
	return out, nil
}
