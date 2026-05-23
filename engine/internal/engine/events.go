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
	EvWorkflowPaused    = "WORKFLOW_PAUSED"
	EvNodePaused        = "NODE_PAUSED" // retries exhausted → pause_for_human (P6)
	EvArtifactProduced  = "ARTIFACT_PRODUCED"
	EvArtifactValidated = "ARTIFACT_VALIDATED"

	EvHumanReviewRequested = "HUMAN_REVIEW_REQUESTED"
	EvHumanApproved        = "HUMAN_APPROVED"
	EvHumanRejected        = "HUMAN_REJECTED"
)

type nodePayload struct {
	NodeID   string `json:"node_id"`
	Result   string `json:"result,omitempty"`   // "success"|"failed" for NODE_COMPLETED
	Attempt  int    `json:"attempt,omitempty"`   // retry attempt (1-based)
	Feedback string `json:"feedback,omitempty"`  // structured rejection feedback (P6/§9.3)
}

type artifactPayload struct {
	NodeID     string `json:"node_id"`
	ArtifactID string `json:"artifact_id"`
	Path       string `json:"path"`
	SHA256     string `json:"sha256,omitempty"`
	Passed     bool   `json:"passed,omitempty"`
}
