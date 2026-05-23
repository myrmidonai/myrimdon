package engine

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// NodeExecutor runs a single node and reports a result ("success"|"failed").
// M1a uses a stub; M1b dispatches to a runner via ExecutionBackend.
type NodeExecutor interface {
	Execute(ctx context.Context, runID string, node workflow.Node) (result string, err error)
}

type Engine struct {
	store statestore.StateStore
}

func New(store statestore.StateStore) *Engine { return &Engine{store: store} }

func (e *Engine) emit(ctx context.Context, runID, typ string, p nodePayload) error {
	payload, _ := json.Marshal(p)
	key := runID + ":" + typ + ":" + p.NodeID
	_, err := e.store.AppendEvent(ctx, statestore.Event{
		ID:             uuid.NewString(),
		Type:           typ,
		IdempotencyKey: key,
		PayloadJSON:    string(payload),
	})
	return err
}

// Run drives def to a terminal state using exec. Synchronous (M1a).
func (e *Engine) Run(ctx context.Context, runID string, def *workflow.Def, exec NodeExecutor) error {
	if err := def.Validate(); err != nil {
		return fmt.Errorf("invalid workflow: %w", err)
	}
	if err := e.emit(ctx, runID, EvWorkflowStarted, nodePayload{}); err != nil {
		return err
	}
	for {
		events, err := e.store.ReadEvents(ctx, 0)
		if err != nil {
			return err
		}
		st := Project(def, events)
		progressed := false
		for _, n := range def.Nodes {
			if st.Nodes[n.ID] == NodeRunning {
				// Crash recovery: node was started but never completed → re-run
				// (events are idempotent, so the duplicate NODE_STARTED is ignored).
				if err := e.runNode(ctx, runID, n, exec); err != nil {
					return err
				}
				progressed = true
				continue
			}
			switch nodeDecision(def, st, n.ID) {
			case decReady:
				if err := e.runNode(ctx, runID, n, exec); err != nil {
					return err
				}
				progressed = true
			case decSkip:
				if err := e.emit(ctx, runID, EvNodeSkipped, nodePayload{NodeID: n.ID}); err != nil {
					return err
				}
				progressed = true
			}
		}
		if !progressed {
			break
		}
	}
	events, _ := e.store.ReadEvents(ctx, 0)
	st := Project(def, events)
	// The run fails only on an UNHANDLED failure: a failed node whose failure
	// was not routed onward by an active outgoing edge (e.g. a `failed` edge to
	// a bug-fix node). A handled failure is normal control flow, not a run failure.
	for _, n := range def.Nodes {
		if st.Nodes[n.ID] != NodeFailed {
			continue
		}
		handled := false
		for _, oe := range def.Outgoing(n.ID) {
			if edgeActive(oe, st) {
				handled = true
				break
			}
		}
		if !handled {
			return e.emit(ctx, runID, EvWorkflowFailed, nodePayload{})
		}
	}
	return e.emit(ctx, runID, EvWorkflowCompleted, nodePayload{})
}

// runNode emits NODE_STARTED, executes the node, and emits NODE_COMPLETED.
// Safe to call on a node already marked running (crash recovery): the duplicate
// NODE_STARTED is ignored by the idempotent event log.
func (e *Engine) runNode(ctx context.Context, runID string, n workflow.Node, exec NodeExecutor) error {
	if err := e.emit(ctx, runID, EvNodeStarted, nodePayload{NodeID: n.ID}); err != nil {
		return err
	}
	res, err := exec.Execute(ctx, runID, n)
	if err != nil {
		return fmt.Errorf("execute %s: %w", n.ID, err)
	}
	if res != "failed" {
		res = "success"
	}
	return e.emit(ctx, runID, EvNodeCompleted, nodePayload{NodeID: n.ID, Result: res})
}
