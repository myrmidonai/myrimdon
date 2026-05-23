package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// NodeExecutor runs a single node and reports a result ("success"|"failed").
type NodeExecutor interface {
	Execute(ctx context.Context, runID string, node workflow.Node) (result string, err error)
}

type Engine struct {
	store statestore.StateStore
}

func New(store statestore.StateStore) *Engine { return &Engine{store: store} }

// emit appends an event; returns whether it was newly appended (false = deduped).
func (e *Engine) emit(ctx context.Context, runID, typ string, p nodePayload) (bool, error) {
	payload, _ := json.Marshal(p)
	key := runID + ":" + typ + ":" + p.NodeID + ":" + strconv.Itoa(p.Attempt)
	return e.store.AppendEvent(ctx, statestore.Event{
		ID:             uuid.NewString(),
		Type:           typ,
		IdempotencyKey: key,
		PayloadJSON:    string(payload),
	})
}

func maxAttempts(n workflow.Node) int {
	if n.MaxAttempts > 0 {
		return n.MaxAttempts
	}
	return 1
}

// countCompleted returns total completions and failed completions for a node.
func countCompleted(events []statestore.Event, nodeID string) (total, failed int) {
	for _, ev := range events {
		if ev.Type != EvNodeCompleted {
			continue
		}
		var p nodePayload
		_ = json.Unmarshal([]byte(ev.PayloadJSON), &p)
		if p.NodeID != nodeID {
			continue
		}
		total++
		if p.Result == "failed" {
			failed++
		}
	}
	return total, failed
}

func (e *Engine) runNode(ctx context.Context, runID string, n workflow.Node, attempt int, exec NodeExecutor) error {
	if _, err := e.emit(ctx, runID, EvNodeStarted, nodePayload{NodeID: n.ID, Attempt: attempt}); err != nil {
		return err
	}
	res, err := exec.Execute(ctx, runID, n)
	if err != nil {
		return fmt.Errorf("execute %s: %w", n.ID, err)
	}
	if res != "failed" {
		res = "success"
	}
	_, err = e.emit(ctx, runID, EvNodeCompleted, nodePayload{NodeID: n.ID, Result: res, Attempt: attempt})
	return err
}

func hasActiveOutEdge(def *workflow.Def, st RunState, nodeID string) bool {
	for _, oe := range def.Outgoing(nodeID) {
		if edgeActive(oe, st) {
			return true
		}
	}
	return false
}

// Run drives def toward a terminal state, emitting all transitions as events.
// Synchronous, idempotent, resumable. The run ends COMPLETED, or PAUSED when a
// human_approval awaits a decision or a node's retries are exhausted (P6).
//
// It advances ONE action per iteration and re-projects, so each decision sees
// fresh state (e.g. a node that just paused is non-terminal for its downstream).
func (e *Engine) Run(ctx context.Context, runID string, def *workflow.Def, exec NodeExecutor) error {
	if err := def.Validate(); err != nil {
		return fmt.Errorf("invalid workflow: %w", err)
	}
	if _, err := e.emit(ctx, runID, EvWorkflowStarted, nodePayload{}); err != nil {
		return err
	}
	for {
		events, err := e.store.ReadEvents(ctx, 0)
		if err != nil {
			return err
		}
		st := Project(def, events)
		acted := false
		for _, n := range def.Nodes {
			a, err := e.step(ctx, runID, def, st, events, n, exec)
			if err != nil {
				return err
			}
			if a {
				acted = true
				break
			}
		}
		if !acted {
			break
		}
	}

	events, _ := e.store.ReadEvents(ctx, 0)
	st := Project(def, events)
	for _, s := range st.Nodes {
		if s == NodePaused || s == NodeWaitingHuman {
			_, err := e.emit(ctx, runID, EvWorkflowPaused, nodePayload{})
			return err
		}
	}
	_, err := e.emit(ctx, runID, EvWorkflowCompleted, nodePayload{})
	return err
}

// step performs at most one state-advancing action on node n, returning whether
// it acted (a new event was appended).
func (e *Engine) step(ctx context.Context, runID string, def *workflow.Def, st RunState, events []statestore.Event, n workflow.Node, exec NodeExecutor) (bool, error) {
	switch st.Nodes[n.ID] {
	case NodeRunning:
		// crash recovery: re-run the in-flight attempt
		total, _ := countCompleted(events, n.ID)
		return true, e.runNode(ctx, runID, n, total+1, exec)

	case NodeFailed:
		total, failed := countCompleted(events, n.ID)
		if failed < maxAttempts(n) {
			return true, e.runNode(ctx, runID, n, total+1, exec) // retry
		}
		if !hasActiveOutEdge(def, st, n.ID) {
			return e.emit(ctx, runID, EvNodePaused, nodePayload{NodeID: n.ID}) // exhausted + unhandled → pause
		}
		return false, nil // failure routed by an active edge; nothing to do here

	case NodePending:
		switch nodeDecision(def, st, n.ID) {
		case decReady:
			if n.Type == workflow.NodeHumanApproval {
				return e.emit(ctx, runID, EvHumanReviewRequested, nodePayload{NodeID: n.ID})
			}
			total, _ := countCompleted(events, n.ID)
			return true, e.runNode(ctx, runID, n, total+1, exec)
		case decSkip:
			return e.emit(ctx, runID, EvNodeSkipped, nodePayload{NodeID: n.ID})
		}
	}
	return false, nil
}
