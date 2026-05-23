package workflow

import "testing"

func validDef() *Def {
	return &Def{
		ID:    "wf",
		Nodes: []Node{{ID: "a", Type: NodeTrigger}, {ID: "b", Type: NodeAgent}},
		Edges: []Edge{{From: "a", To: "b", Condition: "success"}},
	}
}

func TestValidateOK(t *testing.T) {
	if err := validDef().Validate(); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}

func TestValidateDuplicateID(t *testing.T) {
	d := validDef()
	d.Nodes = append(d.Nodes, Node{ID: "a", Type: NodeAgent})
	if d.Validate() == nil {
		t.Fatal("want duplicate id error")
	}
}

func TestValidateUnknownEdgeNode(t *testing.T) {
	d := validDef()
	d.Edges = []Edge{{From: "a", To: "zzz", Condition: "success"}}
	if d.Validate() == nil {
		t.Fatal("want unknown node error")
	}
}

func TestValidateBadCondition(t *testing.T) {
	d := validDef()
	d.Edges = []Edge{{From: "a", To: "b", Condition: "maybe"}}
	if d.Validate() == nil {
		t.Fatal("want bad condition error")
	}
}

func TestValidateNoEntryNode(t *testing.T) {
	d := &Def{
		ID:    "wf",
		Nodes: []Node{{ID: "a", Type: NodeAgent}, {ID: "b", Type: NodeAgent}},
		Edges: []Edge{{From: "a", To: "b", Condition: "success"}, {From: "b", To: "a", Condition: "success"}},
	}
	if d.Validate() == nil {
		t.Fatal("want no-entry-node error")
	}
}
