package integration

import (
	"context"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/engine"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

type stubExec struct{}

func (stubExec) Execute(ctx context.Context, runID string, n workflow.Node) (string, error) {
	return "success", nil
}

// A realistic small DAG: trigger → plan → condition gate → fork(frontend,backend) → join(qa).
const demoWorkflowJSON = `{
  "id": "demo", "version": "1.0.0", "name": "demo pipeline",
  "nodes": [
    {"id": "trigger",  "type": "trigger"},
    {"id": "plan",     "type": "agent"},
    {"id": "gate",     "type": "condition"},
    {"id": "frontend", "type": "agent"},
    {"id": "backend",  "type": "agent"},
    {"id": "qa",       "type": "agent"}
  ],
  "edges": [
    {"from": "trigger",  "to": "plan",     "condition": "success"},
    {"from": "plan",     "to": "gate",     "condition": "success"},
    {"from": "gate",     "to": "frontend", "condition": "success"},
    {"from": "gate",     "to": "backend",  "condition": "success"},
    {"from": "frontend", "to": "qa",       "condition": "success"},
    {"from": "backend",  "to": "qa",       "condition": "success"}
  ]
}`

func TestM1aGate_LoadJSONDriveToCompletion(t *testing.T) {
	ctx := context.Background()

	def, err := workflow.Load([]byte(demoWorkflowJSON))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if err := def.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}

	store, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	eng := engine.New(store)
	if err := eng.Run(ctx, "run1", def, stubExec{}); err != nil {
		t.Fatalf("Run: %v", err)
	}

	events, err := store.ReadEvents(ctx, 0)
	if err != nil {
		t.Fatalf("ReadEvents: %v", err)
	}
	st := engine.Project(def, events)

	if st.Status != "completed" {
		t.Fatalf("run status: %v (want completed)", st.Status)
	}
	for _, n := range def.Nodes {
		if st.Nodes[n.ID] != engine.NodeCompleted {
			t.Fatalf("node %s: %v (want completed)", n.ID, st.Nodes[n.ID])
		}
	}
	if events[0].Type != engine.EvWorkflowStarted {
		t.Fatalf("first event %s, want %s", events[0].Type, engine.EvWorkflowStarted)
	}
	if events[len(events)-1].Type != engine.EvWorkflowCompleted {
		t.Fatalf("last event %s, want %s", events[len(events)-1].Type, engine.EvWorkflowCompleted)
	}
}
