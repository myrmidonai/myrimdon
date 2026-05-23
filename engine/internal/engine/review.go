package engine

import "context"

// Approve records a human approval for a human_approval node. The decision is
// picked up on the next Run (resume), which routes the node's `approved` edges.
func (e *Engine) Approve(ctx context.Context, runID, nodeID string) error {
	_, err := e.emit(ctx, runID, EvHumanApproved, nodePayload{NodeID: nodeID})
	return err
}

// Reject records a human rejection with structured feedback (P6/§9.3). The
// node's `rejected` edges are routed on resume.
func (e *Engine) Reject(ctx context.Context, runID, nodeID, feedback string) error {
	_, err := e.emit(ctx, runID, EvHumanRejected, nodePayload{NodeID: nodeID, Feedback: feedback})
	return err
}
