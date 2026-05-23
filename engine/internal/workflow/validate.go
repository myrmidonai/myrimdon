package workflow

import "fmt"

var validConditions = map[string]bool{
	"success": true, "failed": true, "always": true, "approved": true, "rejected": true,
}

// Validate checks structural integrity (PRD6 §7.3). It does not execute anything.
func (d *Def) Validate() error {
	if d.ID == "" {
		return fmt.Errorf("workflow id required")
	}
	ids := make(map[string]bool, len(d.Nodes))
	for _, n := range d.Nodes {
		if n.ID == "" {
			return fmt.Errorf("node with empty id")
		}
		if ids[n.ID] {
			return fmt.Errorf("duplicate node id %q", n.ID)
		}
		ids[n.ID] = true
	}
	for _, e := range d.Edges {
		if !ids[e.From] {
			return fmt.Errorf("edge from unknown node %q", e.From)
		}
		if !ids[e.To] {
			return fmt.Errorf("edge to unknown node %q", e.To)
		}
		if !validConditions[e.Condition] {
			return fmt.Errorf("edge %s->%s has invalid condition %q", e.From, e.To, e.Condition)
		}
	}
	for _, n := range d.Nodes {
		if len(d.Incoming(n.ID)) == 0 {
			return nil // found an entry node
		}
	}
	return fmt.Errorf("no entry node (every node has an incoming edge)")
}
