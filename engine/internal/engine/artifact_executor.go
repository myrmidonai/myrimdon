package engine

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/myrmidonai/myrmidon/internal/artifact"
	"github.com/myrmidonai/myrmidon/internal/executor"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/validate"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// ArtifactExecutor is a NodeExecutor that runs an executor, records produced
// artifacts (with checksums) and their validation as events, and returns the
// node result based on validation — realizing P2 (artifacts are truth) and
// P3 (validation decides completion; agents never self-report done).
type ArtifactExecutor struct {
	Store     artifact.Store
	Events    statestore.StateStore
	Validator validate.Validator
	Mock      *executor.Mock
}

func (a *ArtifactExecutor) emit(ctx context.Context, runID, typ string, p artifactPayload) error {
	payload, _ := json.Marshal(p)
	key := runID + ":" + typ + ":" + p.NodeID + ":" + p.ArtifactID
	_, err := a.Events.AppendEvent(ctx, statestore.Event{
		ID:             uuid.NewString(),
		Type:           typ,
		IdempotencyKey: key,
		PayloadJSON:    string(payload),
	})
	return err
}

func (a *ArtifactExecutor) Execute(ctx context.Context, runID string, n workflow.Node) (string, error) {
	execResult, _, err := a.Mock.Run(n.ID)
	if err != nil {
		return "", err
	}
	allValid := true
	for _, ref := range n.Produces {
		cs, _, _ := a.Store.Stat(ref.Path)
		if err := a.emit(ctx, runID, EvArtifactProduced, artifactPayload{
			NodeID: n.ID, ArtifactID: ref.ID, Path: ref.Path, SHA256: cs.SHA256,
		}); err != nil {
			return "", err
		}
		res := a.Validator.Validate(a.Store, ref.Path)
		if err := a.emit(ctx, runID, EvArtifactValidated, artifactPayload{
			NodeID: n.ID, ArtifactID: ref.ID, Path: ref.Path, SHA256: cs.SHA256, Passed: res.Passed,
		}); err != nil {
			return "", err
		}
		if !res.Passed {
			allValid = false
		}
	}
	if execResult == "failed" || !allValid {
		return "failed", nil
	}
	return "success", nil
}
