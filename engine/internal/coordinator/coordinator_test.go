package coordinator

import (
	"context"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/conversation"
	"github.com/myrmidonai/myrmidon/internal/engine"
	"github.com/myrmidonai/myrmidon/internal/members"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

type okExec struct{}

func (okExec) Execute(ctx context.Context, runID string, n workflow.Node) (string, error) {
	return "success", nil
}

func TestHandleTriggersWorkflow(t *testing.T) {
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
		},
		Edges: []workflow.Edge{{From: "trigger", To: "build", Condition: "success"}},
	}

	c := &Coordinator{
		Members:  mem,
		Engine:   engine.New(store),
		Executor: okExec{},
		Resolve: func(id string) (*workflow.Def, bool) {
			if id == "demo" {
				return def, true
			}
			return nil, false
		},
	}

	hub := conversation.New(store)
	msg, _ := hub.Post(ctx, "c1", "alice", "@DevAgent build the health endpoint")
	runs, err := c.Handle(ctx, msg)
	if err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected 1 run started, got %v", runs)
	}

	events, _ := store.ReadEvents(ctx, 0)
	if st := engine.Project(def, events); st.Status != "completed" {
		t.Fatalf("triggered run status: %v", st.Status)
	}
}

func TestHandleIgnoresHumanMention(t *testing.T) {
	ctx := context.Background()
	store, _ := statestore.OpenSQLite(":memory:")
	t.Cleanup(func() { _ = store.Close() })
	mem := members.New(store)
	_ = mem.Add(ctx, members.Member{ID: "alice", Kind: members.Human, Name: "Alice"})

	c := &Coordinator{
		Members:  mem,
		Engine:   engine.New(store),
		Executor: okExec{},
		Resolve:  func(string) (*workflow.Def, bool) { return nil, false },
	}
	runs, err := c.Handle(ctx, conversation.Message{ID: "m1", Mentions: []string{"alice"}})
	if err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(runs) != 0 {
		t.Fatalf("human mention should not start a workflow, got %v", runs)
	}
}
