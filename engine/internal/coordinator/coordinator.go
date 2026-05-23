// Package coordinator wires the ConversationHub to the workflow engine: an
// @mention of a digital-human member triggers that member's bound workflow
// (PRD6 §9.2). Chat is an authoring/interface layer over the static DAG (P7).
package coordinator

import (
	"context"

	"github.com/myrmidonai/myrmidon/internal/conversation"
	"github.com/myrmidonai/myrmidon/internal/engine"
	"github.com/myrmidonai/myrmidon/internal/members"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// WorkflowResolver looks up a WorkflowDef by id.
type WorkflowResolver func(id string) (*workflow.Def, bool)

type Coordinator struct {
	Members  *members.Registry
	Hub      *conversation.Hub
	Engine   *engine.Engine
	Executor engine.NodeExecutor
	Resolve  WorkflowResolver
}

// Handle starts a workflow run for each @mention that resolves to a
// digital-human member bound to a workflow. Returns the run ids started.
// (A `direct`-policy agent or a human mention is a no-op here — it would be a
// notification; M2 backend only wires the workflow trigger.)
func (c *Coordinator) Handle(ctx context.Context, msg conversation.Message) ([]string, error) {
	var runs []string
	for _, mid := range msg.Mentions {
		m, ok, err := c.Members.Get(ctx, mid)
		if err != nil {
			return runs, err
		}
		if !ok || m.Kind != members.DigitalHuman || m.WorkflowID == "" {
			continue
		}
		def, ok := c.Resolve(m.WorkflowID)
		if !ok {
			continue
		}
		runID := msg.ID + ":" + mid // deterministic run id from the triggering message
		if err := c.Engine.Run(ctx, runID, def, c.Executor); err != nil {
			return runs, err
		}
		runs = append(runs, runID)
	}
	return runs, nil
}
