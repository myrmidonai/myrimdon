package engine

import (
	"testing"

	"github.com/myrmidonai/myrmidon/internal/workflow"
)

func mkState(nodes map[string]NodeStatus, results map[string]string) RunState {
	if results == nil {
		results = map[string]string{}
	}
	return RunState{Status: "running", Nodes: nodes, Results: results}
}

func TestEntryNodeReady(t *testing.T) {
	d := &workflow.Def{Nodes: []workflow.Node{{ID: "a"}}}
	s := mkState(map[string]NodeStatus{"a": NodePending}, nil)
	if nodeDecision(d, s, "a") != decReady {
		t.Fatal("entry node should be ready")
	}
}

func TestDownstreamWaitsThenReady(t *testing.T) {
	d := &workflow.Def{
		Nodes: []workflow.Node{{ID: "a"}, {ID: "b"}},
		Edges: []workflow.Edge{{From: "a", To: "b", Condition: "success"}},
	}
	s := mkState(map[string]NodeStatus{"a": NodeRunning, "b": NodePending}, nil)
	if nodeDecision(d, s, "b") != decWait {
		t.Fatal("b should wait while a runs")
	}
	s = mkState(map[string]NodeStatus{"a": NodeCompleted, "b": NodePending}, map[string]string{"a": "success"})
	if nodeDecision(d, s, "b") != decReady {
		t.Fatal("b should be ready after a succeeds")
	}
}

func TestConditionBranchSkipsMismatch(t *testing.T) {
	d := &workflow.Def{
		Nodes: []workflow.Node{{ID: "g"}, {ID: "ok"}, {ID: "bad"}},
		Edges: []workflow.Edge{
			{From: "g", To: "ok", Condition: "success"},
			{From: "g", To: "bad", Condition: "failed"},
		},
	}
	s := mkState(map[string]NodeStatus{"g": NodeCompleted, "ok": NodePending, "bad": NodePending}, map[string]string{"g": "success"})
	if nodeDecision(d, s, "ok") != decReady {
		t.Fatal("ok should be ready (success edge active)")
	}
	if nodeDecision(d, s, "bad") != decSkip {
		t.Fatal("bad should be skipped (failed edge inactive)")
	}
}

func TestJoinWaitsForAll(t *testing.T) {
	d := &workflow.Def{
		Nodes: []workflow.Node{{ID: "a"}, {ID: "b"}, {ID: "j"}},
		Edges: []workflow.Edge{
			{From: "a", To: "j", Condition: "success"},
			{From: "b", To: "j", Condition: "success"},
		},
	}
	s := mkState(map[string]NodeStatus{"a": NodeCompleted, "b": NodeRunning, "j": NodePending}, map[string]string{"a": "success"})
	if nodeDecision(d, s, "j") != decWait {
		t.Fatal("join should wait for b")
	}
	s = mkState(map[string]NodeStatus{"a": NodeCompleted, "b": NodeCompleted, "j": NodePending}, map[string]string{"a": "success", "b": "success"})
	if nodeDecision(d, s, "j") != decReady {
		t.Fatal("join should be ready when both done")
	}
}
