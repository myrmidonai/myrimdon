package engine

import (
	"testing"

	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

func TestProjectFromEvents(t *testing.T) {
	def := &workflow.Def{ID: "wf", Nodes: []workflow.Node{{ID: "a"}, {ID: "b"}}}
	evs := []statestore.Event{
		{Type: EvWorkflowStarted, PayloadJSON: `{}`},
		{Type: EvNodeStarted, PayloadJSON: `{"node_id":"a"}`},
		{Type: EvNodeCompleted, PayloadJSON: `{"node_id":"a","result":"success"}`},
		{Type: EvNodeStarted, PayloadJSON: `{"node_id":"b"}`},
	}
	st := Project(def, evs)
	if st.Nodes["a"] != NodeCompleted {
		t.Fatalf("a: %v", st.Nodes["a"])
	}
	if st.Results["a"] != "success" {
		t.Fatalf("a result: %v", st.Results["a"])
	}
	if st.Nodes["b"] != NodeRunning {
		t.Fatalf("b: %v", st.Nodes["b"])
	}
	if st.Status != "running" {
		t.Fatalf("status: %v", st.Status)
	}
}

func TestProjectFailedAndTerminal(t *testing.T) {
	def := &workflow.Def{ID: "wf", Nodes: []workflow.Node{{ID: "a"}}}
	evs := []statestore.Event{
		{Type: EvNodeCompleted, PayloadJSON: `{"node_id":"a","result":"failed"}`},
		{Type: EvWorkflowFailed, PayloadJSON: `{}`},
	}
	st := Project(def, evs)
	if st.Nodes["a"] != NodeFailed {
		t.Fatalf("a: %v", st.Nodes["a"])
	}
	if st.Status != "failed" {
		t.Fatalf("status: %v", st.Status)
	}
}
