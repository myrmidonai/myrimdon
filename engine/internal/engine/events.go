// Package engine drives a static WorkflowDef DAG to a terminal state, with all
// transitions recorded as events (PRD6 §15 — state is a projection of the log).
package engine

const (
	EvWorkflowStarted   = "WORKFLOW_STARTED"
	EvNodeStarted       = "NODE_STARTED"
	EvNodeCompleted     = "NODE_COMPLETED"
	EvNodeSkipped       = "NODE_SKIPPED"
	EvWorkflowCompleted = "WORKFLOW_COMPLETED"
	EvWorkflowFailed    = "WORKFLOW_FAILED"
	EvArtifactProduced  = "ARTIFACT_PRODUCED"
	EvArtifactValidated = "ARTIFACT_VALIDATED"
)

type nodePayload struct {
	NodeID string `json:"node_id"`
	Result string `json:"result,omitempty"` // "success"|"failed" for NODE_COMPLETED
}

type artifactPayload struct {
	NodeID     string `json:"node_id"`
	ArtifactID string `json:"artifact_id"`
	Path       string `json:"path"`
	SHA256     string `json:"sha256,omitempty"`
	Passed     bool   `json:"passed,omitempty"`
}
