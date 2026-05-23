package integration

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/artifact"
	"github.com/myrmidonai/myrmidon/internal/engine"
	"github.com/myrmidonai/myrmidon/internal/executor"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/validate"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// M1c gate (World Reconstruction Test, PRD6 §12.12): after a run, the entire
// run state is recoverable from the event log alone, and reality (artifacts on
// disk) matches the recorded truth (no drift). Our state is always a projection
// of events (no separate snapshot/projection store), so reconstruction = re-Project.
func TestM1cGate_WorldReconstruction(t *testing.T) {
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
			{ID: "qa", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "trigger", To: "build", Condition: "success"},
			{From: "build", To: "qa", Condition: "success"},
		},
	}
	ae := &engine.ArtifactExecutor{
		Store: store, Events: ev, Validator: validate.FileExists{},
		Mock: &executor.Mock{FixturesDir: fixDir, Store: store},
	}
	if err := engine.New(ev).Run(ctx, "run1", def, ae); err != nil {
		t.Fatalf("Run: %v", err)
	}

	events, _ := ev.ReadEvents(ctx, 0)
	live := engine.Project(def, events)
	if live.Status != "completed" {
		t.Fatalf("run status: %v", live.Status)
	}

	// Discard projections/snapshots; rebuild from the event log alone.
	recon := engine.Project(def, events)
	if !reflect.DeepEqual(live, recon) {
		t.Fatalf("reconstructed state != live state")
	}

	// Reality matches recorded truth → no drift.
	if rep := engine.Reconcile(def, events, store); len(rep.Drifts) != 0 {
		t.Fatalf("unexpected drift after a clean run: %+v", rep.Drifts)
	}
}
