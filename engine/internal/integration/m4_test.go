package integration

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/backend"
	"github.com/myrmidonai/myrmidon/internal/engine"
	"github.com/myrmidonai/myrmidon/internal/rpc"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// TestHelperProcess is re-executed (MYRMIDON_HELPER=1) as a fake `pi --rpc`
// agent peer: reads one prompt, replies success, exits.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("MYRMIDON_HELPER") != "1" {
		return
	}
	sc := bufio.NewScanner(os.Stdin)
	if sc.Scan() {
		var req rpc.Request
		_ = json.Unmarshal(sc.Bytes(), &req)
		fmt.Fprintln(os.Stdout, `{"type":"result","result":"success"}`)
	}
	os.Exit(0)
}

// M4b: the engine drives a DAG whose nodes execute via the real SubprocessExecutor
// (against the helper-process fake agent), reaching completion — proving the
// real-executor seam works through the full engine, not just in isolation.
func TestM4_EngineDrivesSubprocessExecutor(t *testing.T) {
	ctx := context.Background()
	store, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	def := &workflow.Def{
		ID: "demo",
		Nodes: []workflow.Node{
			{ID: "trigger", Type: workflow.NodeTrigger},
			{ID: "build", Type: workflow.NodeAgent, Name: "add /health endpoint"},
			{ID: "done", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "trigger", To: "build", Condition: "success"},
			{From: "build", To: "done", Condition: "success"},
		},
	}
	exec := &backend.SubprocessExecutor{
		Name: os.Args[0],
		Args: []string{"-test.run=TestHelperProcess"},
		Env:  []string{"MYRMIDON_HELPER=1"},
	}

	if err := engine.New(store).Run(ctx, "run1", def, exec); err != nil {
		t.Fatalf("Run: %v", err)
	}
	st := engine.Project(def, readAll(t, store))
	if st.Status != "completed" {
		t.Fatalf("run status: %v", st.Status)
	}
	for _, n := range def.Nodes {
		if st.Nodes[n.ID] != engine.NodeCompleted {
			t.Fatalf("node %s: %v", n.ID, st.Nodes[n.ID])
		}
	}
}
