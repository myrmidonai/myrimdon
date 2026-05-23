package engine

import "github.com/myrmidonai/myrmidon/internal/workflow"

// edgeActive: source terminal AND its condition matches the source's result.
func edgeActive(e workflow.Edge, st RunState) bool {
	s := st.Nodes[e.From]
	if !terminal(s) {
		return false
	}
	switch e.Condition {
	case "always":
		return true
	case "success":
		return s == NodeCompleted && st.Results[e.From] == "success"
	case "failed":
		return s == NodeFailed || st.Results[e.From] == "failed"
	default: // approved|rejected — resolved by human_approval (M1d); inactive here
		return false
	}
}

type decision int

const (
	decWait decision = iota
	decReady
	decSkip
)

// nodeDecision decides what to do with a pending node this tick:
//   - entry node (no incoming) → ready
//   - some upstream not terminal → wait
//   - all upstream terminal, ≥1 incoming edge active → ready
//   - all upstream terminal, none active → skip
func nodeDecision(d *workflow.Def, st RunState, nodeID string) decision {
	if st.Nodes[nodeID] != NodePending {
		return decWait // not actionable
	}
	in := d.Incoming(nodeID)
	if len(in) == 0 {
		return decReady
	}
	anyActive := false
	for _, e := range in {
		if !terminal(st.Nodes[e.From]) {
			return decWait
		}
		if edgeActive(e, st) {
			anyActive = true
		}
	}
	if anyActive {
		return decReady
	}
	return decSkip
}
