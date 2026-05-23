package engine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/artifact"
	"github.com/myrmidonai/myrmidon/internal/executor"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/validate"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

func newArtifactExecutor(t *testing.T, fixtures map[string]string) (*ArtifactExecutor, statestore.StateStore, artifact.Store) {
	t.Helper()
	fixDir := t.TempDir()
	for name, body := range fixtures {
		if err := os.WriteFile(filepath.Join(fixDir, name+".json"), []byte(body), 0o644); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
	}
	store := artifact.NewLocal(t.TempDir())
	ev, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = ev.Close() })
	ae := &ArtifactExecutor{
		Store:     store,
		Events:    ev,
		Validator: validate.FileExists{},
		Mock:      &executor.Mock{FixturesDir: fixDir, Store: store},
	}
	return ae, ev, store
}

func validationOutcome(t *testing.T, ev statestore.StateStore) (found, passed bool) {
	t.Helper()
	events, _ := ev.ReadEvents(context.Background(), 0)
	for _, e := range events {
		if e.Type == EvArtifactValidated {
			var p artifactPayload
			_ = json.Unmarshal([]byte(e.PayloadJSON), &p)
			return true, p.Passed
		}
	}
	return false, false
}

func TestArtifactExecutorProducesAndValidates(t *testing.T) {
	ae, ev, store := newArtifactExecutor(t, map[string]string{
		"build": `{"files":{"api.go":"package api"}}`,
	})
	node := workflow.Node{ID: "build", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "api", Path: "api.go"}}}
	res, err := ae.Execute(context.Background(), "run1", node)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res != "success" {
		t.Fatalf("result: %q", res)
	}
	if !store.Exists("api.go") {
		t.Fatal("artifact not on disk")
	}
	found, passed := validationOutcome(t, ev)
	if !found || !passed {
		t.Fatalf("expected a passed ARTIFACT_VALIDATED event (found=%v passed=%v)", found, passed)
	}
}

func TestArtifactExecutorFailsWhenArtifactMissing(t *testing.T) {
	// Fixture writes nothing, but the node declares it produces api.go → validation fails.
	ae, ev, _ := newArtifactExecutor(t, map[string]string{
		"build": `{"files":{},"result":"success"}`,
	})
	node := workflow.Node{ID: "build", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "api", Path: "api.go"}}}
	res, err := ae.Execute(context.Background(), "run1", node)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res != "failed" {
		t.Fatalf("expected failed (declared artifact not produced), got %q", res)
	}
	found, passed := validationOutcome(t, ev)
	if !found || passed {
		t.Fatalf("expected a failed ARTIFACT_VALIDATED event (found=%v passed=%v)", found, passed)
	}
}
