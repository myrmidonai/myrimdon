package workflow

import "testing"

func TestLoadParsesNodesAndEdges(t *testing.T) {
	data := []byte(`{
	  "id":"wf1","version":"1.0.0","name":"demo",
	  "nodes":[{"id":"a","type":"trigger"},{"id":"b","type":"agent"}],
	  "edges":[{"from":"a","to":"b","condition":"success"}]
	}`)
	d, err := Load(data)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if d.ID != "wf1" || len(d.Nodes) != 2 || len(d.Edges) != 1 {
		t.Fatalf("unexpected def: %+v", d)
	}
	if got := d.Incoming("b"); len(got) != 1 || got[0].From != "a" {
		t.Fatalf("Incoming(b): %+v", got)
	}
	if got := d.Outgoing("a"); len(got) != 1 || got[0].To != "b" {
		t.Fatalf("Outgoing(a): %+v", got)
	}
}
