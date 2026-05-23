// Package templates holds built-in domain workflows. Domain content lives here,
// never in the kernel (PRD6 §4.6).
package templates

import "github.com/myrmidonai/myrmidon/internal/workflow"

// SoftwareDevAgile returns the software-dev-agile happy-path workflow (PRD6 §16.A):
// requirements → PRD → [PRD approval] → design → [arch approval] → sprint plan →
// parallel coders → integrate (join) → QA → [delivery approval] → release.
//
// The qa→bug-fix cyclic loop (PRD6 §16.A) needs the `loop` node type (§4.2) and
// is intentionally omitted from this M1 happy-path template.
func SoftwareDevAgile() *workflow.Def {
	return &workflow.Def{
		ID:      "software-dev-agile",
		Version: "1.0.0",
		Name:    "Software Development (Agile)",
		Nodes: []workflow.Node{
			{ID: "trigger", Type: workflow.NodeTrigger},
			{ID: "requirements", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "reqs", Path: "docs/requirements.md"}}},
			{ID: "prd", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "prd", Path: "docs/prd.md"}}},
			{ID: "prd-approval", Type: workflow.NodeHumanApproval},
			{ID: "design", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "design", Path: "docs/design.md"}}},
			{ID: "arch-approval", Type: workflow.NodeHumanApproval},
			{ID: "sprint-plan", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "backlog", Path: "docs/backlog.md"}}},
			{ID: "coder-be", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "api", Path: "src/api.go"}}},
			{ID: "coder-fe", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "ui", Path: "src/ui.tsx"}}},
			{ID: "integrate", Type: workflow.NodeAgent},
			{ID: "qa", Type: workflow.NodeAgent, Produces: []workflow.ArtifactRef{{ID: "qa", Path: "docs/qa-report.md"}}},
			{ID: "delivery-approval", Type: workflow.NodeHumanApproval},
			{ID: "release", Type: workflow.NodeAgent},
		},
		Edges: []workflow.Edge{
			{From: "trigger", To: "requirements", Condition: "success"},
			{From: "requirements", To: "prd", Condition: "success"},
			{From: "prd", To: "prd-approval", Condition: "success"},
			{From: "prd-approval", To: "design", Condition: "approved"},
			{From: "design", To: "arch-approval", Condition: "success"},
			{From: "arch-approval", To: "sprint-plan", Condition: "approved"},
			{From: "sprint-plan", To: "coder-be", Condition: "success"},
			{From: "sprint-plan", To: "coder-fe", Condition: "success"},
			{From: "coder-be", To: "integrate", Condition: "success"},
			{From: "coder-fe", To: "integrate", Condition: "success"},
			{From: "integrate", To: "qa", Condition: "success"},
			{From: "qa", To: "delivery-approval", Condition: "success"},
			{From: "delivery-approval", To: "release", Condition: "approved"},
		},
	}
}
