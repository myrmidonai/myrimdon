package integration

import (
	"context"
	"strings"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/conversation"
	"github.com/myrmidonai/myrmidon/internal/coordinator"
	"github.com/myrmidonai/myrmidon/internal/engine"
	"github.com/myrmidonai/myrmidon/internal/members"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// M2 gate: a human @mentions a digital-human agent in a channel → the agent's
// workflow starts → it pauses at an approval gate → the gate is surfaced back
// into the channel → a human replies "/approve ..." → the run resumes to done.
func TestM2Gate_ChatToWorkflowToApproveToDone(t *testing.T) {
	ctx := context.Background()
	store, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	mem := members.New(store)
	_ = mem.Add(ctx, members.Member{ID: "DevAgent", Kind: members.DigitalHuman, Name: "DevAgent", WorkflowID: "demo"})

	def := &workflow.Def{
		ID: "demo",
		Nodes: []workflow.Node{
			{ID: "trigger", Type: workflow.NodeTrigger},
			{ID: "build", Type: workflow.NodeAgent},
			{ID: "approve", Type: workflow.NodeHumanApproval},
			{ID: "ship", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "trigger", To: "build", Condition: "success"},
			{From: "build", To: "approve", Condition: "success"},
			{From: "approve", To: "ship", Condition: "approved"},
		},
	}

	hub := conversation.New(store)
	c := &coordinator.Coordinator{
		Members:  mem,
		Hub:      hub,
		Engine:   engine.New(store),
		Executor: stubExec{},
		Resolve: func(id string) (*workflow.Def, bool) {
			if id == "demo" {
				return def, true
			}
			return nil, false
		},
	}

	// 1. Human chats an @mention → starts the agent's workflow (pauses at approval).
	msg, _ := hub.Post(ctx, "proj-1", "alice", "@DevAgent add a /health endpoint")
	runs, err := c.Handle(ctx, msg)
	if err != nil || len(runs) != 1 {
		t.Fatalf("Handle: runs=%v err=%v", runs, err)
	}
	runID := runs[0]

	if st, _ := c.Engine.State(ctx, def); st.Status != "paused" {
		t.Fatalf("expected paused at approval, got %v", st.Status)
	}

	// 2. Surface the approval into the channel.
	surfaced, err := c.SurfaceApprovals(ctx, "proj-1", runID, def)
	if err != nil || len(surfaced) != 1 || surfaced[0] != "approve" {
		t.Fatalf("SurfaceApprovals: %v err=%v", surfaced, err)
	}
	msgs, _ := hub.Messages(ctx, "proj-1")
	last := msgs[len(msgs)-1]
	if last.Author != "system" || !strings.Contains(last.Text, "/approve "+runID+" approve") {
		t.Fatalf("review request not posted correctly: %+v", last)
	}

	// 3. Human replies with the approve command from the channel.
	handled, err := c.HandleCommand(ctx, "/approve "+runID+" approve")
	if err != nil || !handled {
		t.Fatalf("HandleCommand: handled=%v err=%v", handled, err)
	}

	// 4. Resume the run → completes.
	if err := c.Engine.Run(ctx, runID, def, stubExec{}); err != nil {
		t.Fatalf("resume Run: %v", err)
	}
	st, _ := c.Engine.State(ctx, def)
	if st.Status != "completed" {
		t.Fatalf("expected completed after approval, got %v", st.Status)
	}
	if st.Nodes["ship"] != engine.NodeCompleted {
		t.Fatalf("ship should be completed: %v", st.Nodes["ship"])
	}
}
