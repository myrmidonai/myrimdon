// Package workflow defines the WorkflowDef DSL (data, not code): a static DAG
// of nodes and edges. JSON is the single source of truth (PRD6 §7.1, P7).
package workflow

import (
	"encoding/json"
	"fmt"
)

type NodeType string

const (
	NodeAgent         NodeType = "agent"
	NodeHumanApproval NodeType = "human_approval"
	NodeCondition     NodeType = "condition"
	NodeTransform     NodeType = "transform"
	NodeTrigger       NodeType = "trigger"
)

// ArtifactRef declares an artifact a node produces (workspace-relative path).
type ArtifactRef struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

type Node struct {
	ID       string        `json:"id"`
	Type     NodeType      `json:"type"`
	Name     string        `json:"name,omitempty"`
	Produces []ArtifactRef `json:"produces,omitempty"`
}

type Edge struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Condition string `json:"condition"` // success|failed|always|approved|rejected
}

type Def struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Name    string `json:"name"`
	Nodes   []Node `json:"nodes"`
	Edges   []Edge `json:"edges"`
}

func Load(data []byte) (*Def, error) {
	var d Def
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("parse workflow def: %w", err)
	}
	return &d, nil
}

// Incoming returns edges whose To == nodeID.
func (d *Def) Incoming(nodeID string) []Edge {
	var out []Edge
	for _, e := range d.Edges {
		if e.To == nodeID {
			out = append(out, e)
		}
	}
	return out
}

// Outgoing returns edges whose From == nodeID.
func (d *Def) Outgoing(nodeID string) []Edge {
	var out []Edge
	for _, e := range d.Edges {
		if e.From == nodeID {
			out = append(out, e)
		}
	}
	return out
}
