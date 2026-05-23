package workflow

import (
	"sort"
	"testing"
)

func TestDownstreamReachesAll(t *testing.T) {
	d := &Def{
		Nodes: []Node{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}},
		Edges: []Edge{
			{From: "a", To: "b", Condition: "always"},
			{From: "b", To: "c", Condition: "always"},
			{From: "c", To: "d", Condition: "always"},
		},
	}
	ds := d.Downstream("a", 10)
	sort.Strings(ds)
	if len(ds) != 3 || ds[0] != "b" || ds[1] != "c" || ds[2] != "d" {
		t.Fatalf("want [b c d], got %v", ds)
	}
}

func TestDownstreamDepthLimited(t *testing.T) {
	d := &Def{
		Nodes: []Node{{ID: "a"}, {ID: "b"}, {ID: "c"}},
		Edges: []Edge{
			{From: "a", To: "b", Condition: "always"},
			{From: "b", To: "c", Condition: "always"},
		},
	}
	ds := d.Downstream("a", 1)
	if len(ds) != 1 || ds[0] != "b" {
		t.Fatalf("depth-limited want [b], got %v", ds)
	}
}
