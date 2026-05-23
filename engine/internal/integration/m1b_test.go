package integration

import (
	"context"
	"encoding/json"
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

// M1b gate: an agent node produces a declared artifact via the mock executor;
// the engine records ARTIFACT_PRODUCED(checksum) + ARTIFACT_VALIDATED(passed),
// the node completes, the run completes, and the file is on disk with a checksum.
func TestM1bGate_NodeProducesValidatedArtifact(t *testing.T) {
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
		ID: "demo", Version: "1.0.0",
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
		Store:     store,
		Events:    ev,
		Validator: validate.FileExists{},
		Mock:      &executor.Mock{FixturesDir: fixDir, Store: store},
	}
	if err := engine.New(ev).Run(ctx, "run1", def, ae); err != nil {
		t.Fatalf("Run: %v", err)
	}

	events, err := ev.ReadEvents(ctx, 0)
	if err != nil {
		t.Fatalf("ReadEvents: %v", err)
	}
	st := engine.Project(def, events)
	if st.Status != "completed" {
		t.Fatalf("run status: %v (want completed)", st.Status)
	}
	if st.Nodes["build"] != engine.NodeCompleted || st.Nodes["qa"] != engine.NodeCompleted {
		t.Fatalf("node statuses: %+v", st.Nodes)
	}

	// Artifact is truth: file on disk with a recorded checksum.
	if !store.Exists("api.go") {
		t.Fatal("produced artifact api.go is not on disk")
	}
	if cs, _, _ := store.Stat("api.go"); cs.SHA256 == "" {
		t.Fatal("no checksum recorded for produced artifact")
	}

	produced, validatedPassed := false, false
	for _, e := range events {
		switch e.Type {
		case engine.EvArtifactProduced:
			produced = true
		case engine.EvArtifactValidated:
			var p struct {
				Passed bool `json:"passed"`
			}
			_ = json.Unmarshal([]byte(e.PayloadJSON), &p)
			if p.Passed {
				validatedPassed = true
			}
		}
	}
	if !produced || !validatedPassed {
		t.Fatalf("missing ARTIFACT_PRODUCED/ARTIFACT_VALIDATED(passed) events (produced=%v validated=%v)", produced, validatedPassed)
	}
}
