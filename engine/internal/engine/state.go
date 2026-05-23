package engine

import (
	"encoding/json"

	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

type NodeStatus string

const (
	NodePending      NodeStatus = "pending"
	NodeRunning      NodeStatus = "running"
	NodeCompleted    NodeStatus = "completed"
	NodeFailed       NodeStatus = "failed"
	NodeSkipped      NodeStatus = "skipped"
	NodeWaitingHuman NodeStatus = "waiting_human"
	NodePaused       NodeStatus = "paused" // retries exhausted → awaiting human guidance
)

type RunState struct {
	Status  string                // "running"|"completed"|"failed"
	Nodes   map[string]NodeStatus // node id -> status
	Results map[string]string     // node id -> "success"|"failed"
}

func terminal(s NodeStatus) bool {
	return s == NodeCompleted || s == NodeFailed || s == NodeSkipped
}

// Project rebuilds run state purely from the event log (PRD6 §15.1).
func Project(def *workflow.Def, events []statestore.Event) RunState {
	st := RunState{Status: "running", Nodes: map[string]NodeStatus{}, Results: map[string]string{}}
	for _, n := range def.Nodes {
		st.Nodes[n.ID] = NodePending
	}
	for _, e := range events {
		var p nodePayload
		_ = json.Unmarshal([]byte(e.PayloadJSON), &p)
		switch e.Type {
		case EvNodeStarted:
			st.Nodes[p.NodeID] = NodeRunning
		case EvNodeCompleted:
			if p.Result == "failed" {
				st.Nodes[p.NodeID] = NodeFailed
			} else {
				st.Nodes[p.NodeID] = NodeCompleted
			}
			st.Results[p.NodeID] = p.Result
		case EvNodeSkipped:
			st.Nodes[p.NodeID] = NodeSkipped
		case EvNodePaused:
			st.Nodes[p.NodeID] = NodePaused
		case EvHumanReviewRequested:
			st.Nodes[p.NodeID] = NodeWaitingHuman
		case EvHumanApproved:
			st.Nodes[p.NodeID] = NodeCompleted
			st.Results[p.NodeID] = "approved"
		case EvHumanRejected:
			st.Nodes[p.NodeID] = NodeCompleted
			st.Results[p.NodeID] = "rejected"
		case EvWorkflowCompleted:
			st.Status = "completed"
		case EvWorkflowFailed:
			st.Status = "failed"
		case EvWorkflowPaused:
			st.Status = "paused"
		}
	}
	return st
}
