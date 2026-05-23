// Package members is the instance member registry: humans and digital-human
// agents are members (PRD6 §5.2). Event-sourced like the runner registry.
package members

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

const eventMemberAdded = "MEMBER_ADDED"

type Kind string

const (
	Human        Kind = "human"
	DigitalHuman Kind = "digital_human"
)

type Member struct {
	ID   string `json:"id"`
	Kind Kind   `json:"kind"`
	Name string `json:"name"`
	// Digital-human only:
	WorkflowID   string `json:"workflow_id,omitempty"`   // workflow it triggers when @mentioned
	ActionPolicy string `json:"action_policy,omitempty"` // workflow-only|direct|both (default workflow-only)
}

type Registry struct {
	store statestore.StateStore
}

func New(store statestore.StateStore) *Registry { return &Registry{store: store} }

func (r *Registry) Add(ctx context.Context, m Member) error {
	if m.ID == "" {
		return fmt.Errorf("member id required")
	}
	if m.Kind == DigitalHuman && m.ActionPolicy == "" {
		m.ActionPolicy = "workflow-only" // safe default (PRD6 §6.2)
	}
	payload, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("marshal member: %w", err)
	}
	_, err = r.store.AppendEvent(ctx, statestore.Event{
		ID:             uuid.NewString(),
		Type:           eventMemberAdded,
		IdempotencyKey: eventMemberAdded + ":" + m.ID,
		PayloadJSON:    string(payload),
	})
	return err
}

func (r *Registry) List(ctx context.Context) ([]Member, error) {
	events, err := r.store.ReadEvents(ctx, 0)
	if err != nil {
		return nil, err
	}
	var out []Member
	for _, e := range events {
		if e.Type != eventMemberAdded {
			continue
		}
		var m Member
		if err := json.Unmarshal([]byte(e.PayloadJSON), &m); err != nil {
			return nil, fmt.Errorf("unmarshal member %s: %w", e.ID, err)
		}
		out = append(out, m)
	}
	return out, nil
}

func (r *Registry) Get(ctx context.Context, id string) (Member, bool, error) {
	all, err := r.List(ctx)
	if err != nil {
		return Member{}, false, err
	}
	for _, m := range all {
		if m.ID == id {
			return m, true, nil
		}
	}
	return Member{}, false, nil
}
