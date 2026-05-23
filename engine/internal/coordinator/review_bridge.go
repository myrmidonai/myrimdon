package coordinator

import (
	"context"
	"fmt"
	"strings"

	"github.com/myrmidonai/myrmidon/internal/engine"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// SurfaceApprovals posts a review-request message to the channel for each node
// awaiting human approval in the run (PRD6 §9.3: approvals surfaced into chat).
// Call once after a run pauses. Returns the node ids surfaced.
func (c *Coordinator) SurfaceApprovals(ctx context.Context, channelID, runID string, def *workflow.Def) ([]string, error) {
	st, err := c.Engine.State(ctx, def)
	if err != nil {
		return nil, err
	}
	var surfaced []string
	for _, n := range def.Nodes {
		if st.Nodes[n.ID] != engine.NodeWaitingHuman {
			continue
		}
		text := fmt.Sprintf("review needed for %q (run %s) — reply: /approve %s %s", n.ID, runID, runID, n.ID)
		if _, err := c.Hub.Post(ctx, channelID, "system", text); err != nil {
			return surfaced, err
		}
		surfaced = append(surfaced, n.ID)
	}
	return surfaced, nil
}

// HandleCommand interprets an /approve or /reject chat command and applies the
// human decision to the engine. Returns whether the text was a recognized command.
//
//	/approve <runID> <nodeID>
//	/reject  <runID> <nodeID> <feedback...>
func (c *Coordinator) HandleCommand(ctx context.Context, text string) (handled bool, err error) {
	f := strings.Fields(text)
	if len(f) < 3 {
		return false, nil
	}
	switch f[0] {
	case "/approve":
		return true, c.Engine.Approve(ctx, f[1], f[2])
	case "/reject":
		feedback := strings.Join(f[3:], " ")
		return true, c.Engine.Reject(ctx, f[1], f[2], feedback)
	default:
		return false, nil
	}
}
