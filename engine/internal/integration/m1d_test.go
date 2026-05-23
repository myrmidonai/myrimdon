package integration

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/artifact"
	"github.com/myrmidonai/myrmidon/internal/engine"
	"github.com/myrmidonai/myrmidon/internal/executor"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/validate"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// M1d gate: full stack with a human_approval gate. The run produces a validated
// artifact, then PAUSES at the approval gate; a (mock) reviewer approves; the
// resumed run routes the `approved` edge and completes.
func TestM1dGate_ApprovalGatePausesThenResumes(t *testing.T) {
	ctx := context.Background()
	ws := t.TempDir()
	fixDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(fixDir, "build.json"),
		[]byte(`{"files":{"api.go":"package api"}}`), 0o644); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	store := artifact.NewLocal(ws)
	ev, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = ev.Close() })

	def := &workflow.Def{
		ID: "demo",
		Nodes: []workflow.Node{
			{ID: "trigger", Type: workflow.NodeTrigger},
			{ID: "build", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "api", Path: "api.go"}}},
			{ID: "approve", Type: workflow.NodeHumanApproval},
			{ID: "ship", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "trigger", To: "build", Condition: "success"},
			{From: "build", To: "approve", Condition: "success"},
			{From: "approve", To: "ship", Condition: "approved"},
		},
	}
	ae := &engine.ArtifactExecutor{
		Store: store, Events: ev, Validator: validate.FileExists{},
		Mock: &executor.Mock{FixturesDir: fixDir, Store: store},
	}
	eng := engine.New(ev)

	// First run: builds + validates, then pauses at the approval gate.
	if err := eng.Run(ctx, "run1", def, ae); err != nil {
		t.Fatalf("Run: %v", err)
	}
	st := engine.Project(def, readAll(t, ev))
	if st.Status != "paused" {
		t.Fatalf("expected paused at approval, got %v", st.Status)
	}
	if st.Nodes["build"] != engine.NodeCompleted {
		t.Fatalf("build should be completed: %v", st.Nodes["build"])
	}
	if st.Nodes["approve"] != engine.NodeWaitingHuman {
		t.Fatalf("approve should await human: %v", st.Nodes["approve"])
	}
	if st.Nodes["ship"] != engine.NodePending {
		t.Fatalf("ship should not run before approval: %v", st.Nodes["ship"])
	}
	if !store.Exists("api.go") {
		t.Fatal("artifact api.go should exist after build")
	}

	// Mock reviewer approves; resume completes the run.
	if err := eng.Approve(ctx, "run1", "approve"); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if err := eng.Run(ctx, "run1", def, ae); err != nil {
		t.Fatalf("Run (resume): %v", err)
	}
	st = engine.Project(def, readAll(t, ev))
	if st.Status != "completed" {
		t.Fatalf("expected completed after approval, got %v", st.Status)
	}
	if st.Nodes["ship"] != engine.NodeCompleted {
		t.Fatalf("ship should be completed: %v", st.Nodes["ship"])
	}
}

func readAll(t *testing.T, ev statestore.StateStore) []statestore.Event {
	t.Helper()
	e, err := ev.ReadEvents(context.Background(), 0)
	if err != nil {
		t.Fatalf("ReadEvents: %v", err)
	}
	return e
}
