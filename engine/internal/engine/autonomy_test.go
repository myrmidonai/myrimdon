package engine

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/workflow"
)

func TestHumanApprovalPausesThenResumes(t *testing.T) {
	def := &workflow.Def{
		ID: "wf",
		Nodes: []workflow.Node{
			{ID: "trigger", Type: workflow.NodeTrigger},
			{ID: "approve", Type: workflow.NodeHumanApproval},
			{ID: "done", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "trigger", To: "approve", Condition: "success"},
			{From: "approve", To: "done", Condition: "approved"},
		},
	}
	eng, store := newEngine(t)
	ctx := context.Background()

	// First run pauses at the approval gate.
	if err := eng.Run(ctx, "run1", def, scriptExecutor{}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	st := Project(def, mustEvents(t, store))
	if st.Status != "paused" {
		t.Fatalf("expected paused, got %v", st.Status)
	}
	if st.Nodes["approve"] != NodeWaitingHuman {
		t.Fatalf("approve status: %v", st.Nodes["approve"])
	}
	if st.Nodes["done"] != NodePending {
		t.Fatalf("done should not have run yet: %v", st.Nodes["done"])
	}

	// Human approves; resume completes the run.
	if err := eng.Approve(ctx, "run1", "approve"); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if err := eng.Run(ctx, "run1", def, scriptExecutor{}); err != nil {
		t.Fatalf("Run (resume): %v", err)
	}
	st = Project(def, mustEvents(t, store))
	if st.Status != "completed" {
		t.Fatalf("expected completed after approval, got %v", st.Status)
	}
	if st.Nodes["approve"] != NodeCompleted || st.Nodes["done"] != NodeCompleted {
		t.Fatalf("nodes after resume: %+v", st.Nodes)
	}
}

func TestRetryExhaustsThenPauses(t *testing.T) {
	def := &workflow.Def{
		ID: "wf",
		Nodes: []workflow.Node{
			{ID: "trigger", Type: workflow.NodeTrigger},
			{ID: "flaky", Type: workflow.NodeAgent, MaxAttempts: 2},
			{ID: "done", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "trigger", To: "flaky", Condition: "success"},
			{From: "flaky", To: "done", Condition: "success"},
		},
	}
	eng, store := newEngine(t)
	ctx := context.Background()
	exec := scriptExecutor{results: map[string]string{"flaky": "failed"}}

	if err := eng.Run(ctx, "run1", def, exec); err != nil {
		t.Fatalf("Run: %v", err)
	}
	events := mustEvents(t, store)
	st := Project(def, events)
	if st.Status != "paused" {
		t.Fatalf("expected paused (retries exhausted), got %v", st.Status)
	}
	if st.Nodes["flaky"] != NodePaused {
		t.Fatalf("flaky status: %v", st.Nodes["flaky"])
	}
	if st.Nodes["done"] != NodePending {
		t.Fatalf("done should not run after upstream pause: %v", st.Nodes["done"])
	}

	// Exactly maxAttempts (2) failed completions were recorded.
	failed := 0
	for _, e := range events {
		if e.Type != EvNodeCompleted {
			continue
		}
		var p nodePayload
		_ = json.Unmarshal([]byte(e.PayloadJSON), &p)
		if p.NodeID == "flaky" && p.Result == "failed" {
			failed++
		}
	}
	if failed != 2 {
		t.Fatalf("expected 2 failed attempts, got %d", failed)
	}
}
