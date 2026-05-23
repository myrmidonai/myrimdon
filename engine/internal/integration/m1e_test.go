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
	"github.com/myrmidonai/myrmidon/internal/templates"
	"github.com/myrmidonai/myrmidon/internal/validate"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

// M1 gate (PRD6 §21): the software-dev-agile template runs end-to-end with the
// mock executor — fork/join, artifact produce+validate, and 3 human-approval
// gates auto-approved by a mock reviewer — reaching WORKFLOW_COMPLETED.
func TestM1Gate_SoftwareDevAgileEndToEnd(t *testing.T) {
	ctx := context.Background()
	def := templates.SoftwareDevAgile()
	ws := t.TempDir()
	fixDir := t.TempDir()

	// Generate a fixture for every producing node (writes its declared artifacts).
	for _, n := range def.Nodes {
		if len(n.Produces) == 0 {
			continue
		}
		files := map[string]string{}
		for _, ref := range n.Produces {
			files[ref.Path] = "// generated for " + ref.ID
		}
		body, _ := json.Marshal(map[string]any{"files": files})
		if err := os.WriteFile(filepath.Join(fixDir, n.ID+".json"), body, 0o644); err != nil {
			t.Fatalf("fixture %s: %v", n.ID, err)
		}
	}

	store := artifact.NewLocal(ws)
	ev, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = ev.Close() })

	ae := &engine.ArtifactExecutor{
		Store: store, Events: ev, Validator: validate.FileExists{},
		Mock: &executor.Mock{FixturesDir: fixDir, Store: store},
	}
	eng := engine.New(ev)

	// Drive: run, auto-approve any pending gates, repeat until completed.
	var st engine.RunState
	for i := 0; i < 30; i++ {
		if err := eng.Run(ctx, "run1", def, ae); err != nil {
			t.Fatalf("Run: %v", err)
		}
		st = engine.Project(def, readAll(t, ev))
		if st.Status == "completed" {
			break
		}
		if st.Status != "paused" {
			t.Fatalf("unexpected status %q: %+v", st.Status, st.Nodes)
		}
		approved := false
		for _, n := range def.Nodes {
			if st.Nodes[n.ID] == engine.NodeWaitingHuman {
				if err := eng.Approve(ctx, "run1", n.ID); err != nil {
					t.Fatalf("Approve %s: %v", n.ID, err)
				}
				approved = true
			}
		}
		if !approved {
			t.Fatalf("paused with no pending approvals: %+v", st.Nodes)
		}
	}

	if st.Status != "completed" {
		t.Fatalf("workflow did not complete: %+v", st.Nodes)
	}
	for _, n := range def.Nodes {
		if st.Nodes[n.ID] != engine.NodeCompleted {
			t.Fatalf("node %s not completed: %v", n.ID, st.Nodes[n.ID])
		}
	}
	// Key artifacts exist on disk.
	for _, p := range []string{"docs/requirements.md", "docs/prd.md", "src/api.go", "src/ui.tsx", "docs/qa-report.md"} {
		if !store.Exists(p) {
			t.Fatalf("expected artifact %s on disk", p)
		}
	}
}
