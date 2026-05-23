package engine

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// scriptExecutor returns a per-node result; nodes not in the map default to "success".
type scriptExecutor struct{ results map[string]string }

func (s scriptExecutor) Execute(ctx context.Context, runID string, n workflow.Node) (string, error) {
	if r, ok := s.results[n.ID]; ok {
		return r, nil
	}
	return "success", nil
}

func newEngine(t *testing.T) (*Engine, statestore.StateStore) {
	t.Helper()
	store, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return New(store), store
}

func TestRunLinearDAG(t *testing.T) {
	def := &workflow.Def{
		ID: "wf",
		Nodes: []workflow.Node{
			{ID: "a", Type: workflow.NodeTrigger},
			{ID: "b", Type: workflow.NodeAgent},
			{ID: "c", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "a", To: "b", Condition: "success"},
			{From: "b", To: "c", Condition: "success"},
		},
	}
	eng, store := newEngine(t)
	if err := eng.Run(context.Background(), "run1", def, scriptExecutor{}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	events, _ := store.ReadEvents(context.Background(), 0)
	st := Project(def, events)
	if st.Status != "completed" {
		t.Fatalf("run status: %v", st.Status)
	}
	for _, id := range []string{"a", "b", "c"} {
		if st.Nodes[id] != NodeCompleted {
			t.Fatalf("node %s: %v", id, st.Nodes[id])
		}
	}
	if events[0].Type != EvWorkflowStarted {
		t.Fatalf("first event: %v", events[0].Type)
	}
	if events[len(events)-1].Type != EvWorkflowCompleted {
		t.Fatalf("last event: %v", events[len(events)-1].Type)
	}
}

func TestRunConditionBranch(t *testing.T) {
	def := &workflow.Def{
		ID: "wf",
		Nodes: []workflow.Node{
			{ID: "start", Type: workflow.NodeTrigger},
			{ID: "gate", Type: workflow.NodeCondition},
			{ID: "ok", Type: workflow.NodeAgent},
			{ID: "bad", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "start", To: "gate", Condition: "success"},
			{From: "gate", To: "ok", Condition: "success"},
			{From: "gate", To: "bad", Condition: "failed"},
		},
	}
	eng, store := newEngine(t)
	// gate "fails" → routes to bad; ok is skipped; failure is handled → run completes.
	exec := scriptExecutor{results: map[string]string{"gate": "failed"}}
	if err := eng.Run(context.Background(), "run1", def, exec); err != nil {
		t.Fatalf("Run: %v", err)
	}
	st := Project(def, mustEvents(t, store))
	if st.Status != "completed" {
		t.Fatalf("run status: %v (want completed; failure handled by failed-edge)", st.Status)
	}
	if st.Nodes["gate"] != NodeFailed {
		t.Fatalf("gate: %v", st.Nodes["gate"])
	}
	if st.Nodes["bad"] != NodeCompleted {
		t.Fatalf("bad: %v (should run via failed-edge)", st.Nodes["bad"])
	}
	if st.Nodes["ok"] != NodeSkipped {
		t.Fatalf("ok: %v (should be skipped)", st.Nodes["ok"])
	}
}

func TestRunParallelForkJoin(t *testing.T) {
	def := &workflow.Def{
		ID: "wf",
		Nodes: []workflow.Node{
			{ID: "start", Type: workflow.NodeTrigger},
			{ID: "a", Type: workflow.NodeAgent},
			{ID: "b", Type: workflow.NodeAgent},
			{ID: "join", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "start", To: "a", Condition: "always"},
			{From: "start", To: "b", Condition: "always"},
			{From: "a", To: "join", Condition: "success"},
			{From: "b", To: "join", Condition: "success"},
		},
	}
	eng, store := newEngine(t)
	if err := eng.Run(context.Background(), "run1", def, scriptExecutor{}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	events := mustEvents(t, store)
	st := Project(def, events)
	if st.Status != "completed" {
		t.Fatalf("run status: %v", st.Status)
	}
	for _, id := range []string{"start", "a", "b", "join"} {
		if st.Nodes[id] != NodeCompleted {
			t.Fatalf("node %s: %v", id, st.Nodes[id])
		}
	}
	// join must start only after BOTH a and b completed (AND-join at runtime).
	startSeq, compSeq := map[string]int{}, map[string]int{}
	for i, e := range events {
		var p nodePayload
		_ = json.Unmarshal([]byte(e.PayloadJSON), &p)
		switch e.Type {
		case EvNodeStarted:
			startSeq[p.NodeID] = i
		case EvNodeCompleted:
			compSeq[p.NodeID] = i
		}
	}
	if !(startSeq["join"] > compSeq["a"] && startSeq["join"] > compSeq["b"]) {
		t.Fatalf("join started before both parents completed: join_start=%d a_done=%d b_done=%d",
			startSeq["join"], compSeq["a"], compSeq["b"])
	}
}

func mustEvents(t *testing.T, store statestore.StateStore) []statestore.Event {
	t.Helper()
	ev, err := store.ReadEvents(context.Background(), 0)
	if err != nil {
		t.Fatalf("ReadEvents: %v", err)
	}
	return ev
}

func TestRunResumesRunningNode(t *testing.T) {
	def := &workflow.Def{
		ID: "wf",
		Nodes: []workflow.Node{
			{ID: "a", Type: workflow.NodeTrigger},
			{ID: "b", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{{From: "a", To: "b", Condition: "success"}},
	}
	eng, store := newEngine(t)
	ctx := context.Background()
	// Simulate a crash: "a" was started but never completed.
	_, _ = store.AppendEvent(ctx, statestore.Event{ID: "e1", Type: EvWorkflowStarted, IdempotencyKey: "run1:WORKFLOW_STARTED:"})
	_, _ = store.AppendEvent(ctx, statestore.Event{ID: "e2", Type: EvNodeStarted, IdempotencyKey: "run1:NODE_STARTED:a", PayloadJSON: `{"node_id":"a"}`})

	// Resume: Run is idempotent and re-runs the stuck node.
	if err := eng.Run(ctx, "run1", def, scriptExecutor{}); err != nil {
		t.Fatalf("Run (resume): %v", err)
	}
	st := Project(def, mustEvents(t, store))
	if st.Status != "completed" {
		t.Fatalf("status: %v", st.Status)
	}
	if st.Nodes["a"] != NodeCompleted || st.Nodes["b"] != NodeCompleted {
		t.Fatalf("nodes after resume: %+v", st.Nodes)
	}
}
