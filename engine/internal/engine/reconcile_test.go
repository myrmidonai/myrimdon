package engine

import (
	"encoding/json"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/artifact"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestReconcileDetectsChangeAndStale(t *testing.T) {
	def := &workflow.Def{
		Nodes: []workflow.Node{
			{ID: "build", Produces: []workflow.ArtifactRef{{ID: "api", Path: "api.go"}}},
			{ID: "qa"},
		},
		Edges: []workflow.Edge{{From: "build", To: "qa", Condition: "success"}},
	}
	store := artifact.NewLocal(t.TempDir())
	cs, _ := store.Put("api.go", []byte("v1"))
	events := []statestore.Event{
		{Type: EvArtifactProduced, PayloadJSON: mustJSON(artifactPayload{NodeID: "build", ArtifactID: "api", Path: "api.go", SHA256: cs.SHA256})},
	}

	if rep := Reconcile(def, events, store); len(rep.Drifts) != 0 {
		t.Fatalf("unchanged artifact should not drift: %+v", rep)
	}

	if _, err := store.Put("api.go", []byte("v2-changed")); err != nil {
		t.Fatalf("Put: %v", err)
	}
	rep := Reconcile(def, events, store)
	if len(rep.Drifts) != 1 || rep.Drifts[0].Kind != DriftChanged {
		t.Fatalf("drifts: %+v", rep.Drifts)
	}
	if len(rep.StaleNodes) != 1 || rep.StaleNodes[0] != "qa" {
		t.Fatalf("stale nodes: %v", rep.StaleNodes)
	}
}

func TestReconcileDetectsMissing(t *testing.T) {
	def := &workflow.Def{Nodes: []workflow.Node{{ID: "build", Produces: []workflow.ArtifactRef{{ID: "api", Path: "api.go"}}}}}
	store := artifact.NewLocal(t.TempDir())
	events := []statestore.Event{
		{Type: EvArtifactProduced, PayloadJSON: mustJSON(artifactPayload{Path: "api.go", SHA256: "deadbeef"})},
	}
	rep := Reconcile(def, events, store)
	if len(rep.Drifts) != 1 || rep.Drifts[0].Kind != DriftMissing {
		t.Fatalf("drifts: %+v", rep.Drifts)
	}
}
