package engine

import (
	"encoding/json"

	"github.com/myrmidonai/myrmidon/internal/artifact"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

type DriftKind string

const (
	DriftMissing DriftKind = "missing"
	DriftChanged DriftKind = "changed"
)

type Drift struct {
	ArtifactID string
	Path       string
	Kind       DriftKind
}

type ReconcileReport struct {
	Drifts     []Drift
	StaleNodes []string // downstream nodes made stale by drift
}

const maxStaleDepth = 10 // PRD6 §8.1

// Reconcile scans recorded artifact checksums (from ARTIFACT_PRODUCED events)
// against the ArtifactStore, reporting Missing/Changed artifacts and the
// downstream nodes that become stale (PRD6 §8). It only detects — per P4 it
// does NOT trigger re-execution.
func Reconcile(def *workflow.Def, events []statestore.Event, store artifact.Store) ReconcileReport {
	recorded := map[string]string{} // path -> sha256 (latest)
	idByPath := map[string]string{}
	for _, e := range events {
		if e.Type != EvArtifactProduced {
			continue
		}
		var p artifactPayload
		_ = json.Unmarshal([]byte(e.PayloadJSON), &p)
		recorded[p.Path] = p.SHA256
		idByPath[p.Path] = p.ArtifactID
	}

	var rep ReconcileReport
	staleSet := map[string]bool{}
	for path, sha := range recorded {
		cs, exists, _ := store.Stat(path)
		var kind DriftKind
		switch {
		case !exists:
			kind = DriftMissing
		case sha != "" && cs.SHA256 != sha:
			kind = DriftChanged
		default:
			continue
		}
		rep.Drifts = append(rep.Drifts, Drift{ArtifactID: idByPath[path], Path: path, Kind: kind})
		if producer := producingNode(def, path); producer != "" {
			for _, n := range def.Downstream(producer, maxStaleDepth) {
				staleSet[n] = true
			}
		}
	}
	for n := range staleSet {
		rep.StaleNodes = append(rep.StaleNodes, n)
	}
	return rep
}

func producingNode(def *workflow.Def, path string) string {
	for _, n := range def.Nodes {
		for _, ref := range n.Produces {
			if ref.Path == path {
				return n.ID
			}
		}
	}
	return ""
}
