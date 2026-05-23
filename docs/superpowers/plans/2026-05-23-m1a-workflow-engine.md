# M1a — Workflow Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or subagent-driven-development. Steps use `- [ ]`.

**Goal:** A static-DAG workflow engine: load+validate a `WorkflowDef` (JSON), project run/node state from the event log, compute node readiness (edge-condition enums + AND-join), and drive a DAG to a terminal state via a `NodeExecutor` interface (stubbed here) — emitting all transitions as events through the M0 `StateStore`.

**Architecture:** Builds directly on M0. The engine is **data-driven** (interprets a JSON DAG; PRD6 P7 — no LLM/no code-workflows) and **event-sourced** (state is a projection of events, exactly like M0's `RunnerRegistry.List`). Real executor dispatch + artifacts come in M1b; here `NodeExecutor` is an interface with a trivial stub so the scheduler logic is testable in isolation.

**Tech Stack:** Go, M0 `StateStore`. New package tree under `engine/internal/workflow` (the DSL/def) and `engine/internal/engine` (scheduler + state machines).

**M1a gate:** Load a small multi-node DAG (entry → branch via `condition` → parallel fork → join → end), run it with a scripted stub executor, and assert the emitted event sequence drives every node to a correct terminal status and the run to `WORKFLOW_COMPLETED` — proven by tests + a `go test ./...` green suite.

---

## Model (read before tasks)

- **`WorkflowDef`** = `{id, version, name, nodes[], edges[]}`. `Node{id, type, name}`; `Edge{from, to, condition}`.
- **Edge condition enum** (PRD6 §7.3): `success` | `failed` | `always` | `approved` | `rejected`. M1a routes on `success`/`failed`/`always` (the stub executor returns success/failed; `approved`/`rejected` are accepted by the validator but exercised in M1d with `human_approval`).
- **Node status:** `pending` → `running` → `completed`|`failed`|`skipped`. **Run status:** `running` → `completed`|`failed`.
- **Events:** `WORKFLOW_STARTED`, `NODE_STARTED`, `NODE_COMPLETED`(result), `NODE_SKIPPED`, `WORKFLOW_COMPLETED`, `WORKFLOW_FAILED`. State is the projection of these (no in-memory authority).
- **Readiness (per pending node N):** if N has no incoming edges → ready. Else let resolved = all incoming sources terminal; if not all resolved → wait; if all resolved and ≥1 incoming edge is *active* (source terminal AND condition matches source result) → ready; if all resolved and none active → skip. This yields: linear, branching (condition), parallel-fork (one source, many `always`/`success` out-edges), and AND-join (many incoming, wait for all).
- **Terminal:** when no node is ready/skippable/running, the run ends — `WORKFLOW_COMPLETED` if no node is `failed`, else `WORKFLOW_FAILED`.

---

## Task 1: WorkflowDef types + JSON load

**Files:** Create `engine/internal/workflow/def.go`, `engine/internal/workflow/def_test.go`

- [ ] **Step 1: Test** — `Load` parses a JSON DAG into `*Def` with nodes/edges.
- [ ] **Step 2:** run `cd engine && go test ./internal/workflow/ -run TestLoad` → FAIL (undefined).
- [ ] **Step 3: Impl** `def.go`:

```go
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

type Node struct {
	ID   string   `json:"id"`
	Type NodeType `json:"type"`
	Name string   `json:"name,omitempty"`
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
```

- [ ] **Step 4:** run test → PASS.
- [ ] **Step 5: Commit** `feat(m1a): add WorkflowDef types and JSON loader`

---

## Task 2: Validate

**Files:** Create `engine/internal/workflow/validate.go`, `engine/internal/workflow/validate_test.go`

- [ ] **Step 1: Test** cases: duplicate node id → err; edge referencing missing node → err; bad condition → err; no entry node → err; valid DAG → nil.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Impl** `validate.go`:

```go
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
	// at least one entry node (no incoming edges)
	hasEntry := false
	for _, n := range d.Nodes {
		if len(d.Incoming(n.ID)) == 0 {
			hasEntry = true
			break
		}
	}
	if !hasEntry {
		return fmt.Errorf("no entry node (every node has an incoming edge)")
	}
	return nil
}
```

- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(m1a): add WorkflowDef validation`

---

## Task 3: Event types + state projection

**Files:** Create `engine/internal/engine/events.go`, `engine/internal/engine/state.go`, `engine/internal/engine/state_test.go`

- [ ] **Step 1: Test** — given a `[]statestore.Event` (WORKFLOW_STARTED, NODE_STARTED x, NODE_COMPLETED x success), `Project(def, events)` returns the right node statuses/results and run status.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Impl** `events.go` (constants + payload structs) and `state.go`:

```go
// events.go
package engine

const (
	EvWorkflowStarted   = "WORKFLOW_STARTED"
	EvNodeStarted       = "NODE_STARTED"
	EvNodeCompleted     = "NODE_COMPLETED"
	EvNodeSkipped       = "NODE_SKIPPED"
	EvWorkflowCompleted = "WORKFLOW_COMPLETED"
	EvWorkflowFailed    = "WORKFLOW_FAILED"
)

type nodePayload struct {
	NodeID string `json:"node_id"`
	Result string `json:"result,omitempty"` // "success"|"failed" for NODE_COMPLETED
}
```

```go
// state.go
package engine

import (
	"encoding/json"

	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

type NodeStatus string

const (
	NodePending   NodeStatus = "pending"
	NodeRunning   NodeStatus = "running"
	NodeCompleted NodeStatus = "completed"
	NodeFailed    NodeStatus = "failed"
	NodeSkipped   NodeStatus = "skipped"
)

type RunState struct {
	Status  string                // "running"|"completed"|"failed"
	Nodes   map[string]NodeStatus // node id -> status
	Results map[string]string     // node id -> "success"|"failed"
}

func terminal(s NodeStatus) bool {
	return s == NodeCompleted || s == NodeFailed || s == NodeSkipped
}

// Project rebuilds run state purely from the event log (PRD6 §15.1).
func Project(def *workflow.Def, events []statestore.Event) RunState {
	st := RunState{Status: "running", Nodes: map[string]NodeStatus{}, Results: map[string]string{}}
	for _, n := range def.Nodes {
		st.Nodes[n.ID] = NodePending
	}
	for _, e := range events {
		var p nodePayload
		_ = json.Unmarshal([]byte(e.PayloadJSON), &p)
		switch e.Type {
		case EvNodeStarted:
			st.Nodes[p.NodeID] = NodeRunning
		case EvNodeCompleted:
			if p.Result == "failed" {
				st.Nodes[p.NodeID] = NodeFailed
			} else {
				st.Nodes[p.NodeID] = NodeCompleted
			}
			st.Results[p.NodeID] = p.Result
		case EvNodeSkipped:
			st.Nodes[p.NodeID] = NodeSkipped
		case EvWorkflowCompleted:
			st.Status = "completed"
		case EvWorkflowFailed:
			st.Status = "failed"
		}
	}
	return st
}
```

- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(m1a): add engine event types and event-log state projection`

---

## Task 4: Readiness + edge evaluation

**Files:** Create `engine/internal/engine/schedule.go`, `engine/internal/engine/schedule_test.go`

- [ ] **Step 1: Test** — cover: entry node ready; linear (downstream waits then ready on success); condition branch (matching edge active → ready, mismatching → skip); AND-join (waits for all incoming).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Impl** `schedule.go`:

```go
package engine

import "github.com/myrmidonai/myrmidon/internal/workflow"

// edgeActive: source terminal AND condition matches source's result.
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

func nodeDecision(d *workflow.Def, st RunState, nodeID string) decision {
	if st.Nodes[nodeID] != NodePending {
		return decWait // not actionable
	}
	in := d.Incoming(nodeID)
	if len(in) == 0 {
		return decReady // entry node
	}
	anyActive := false
	for _, e := range in {
		if !terminal(st.Nodes[e.From]) {
			return decWait // some upstream not finished
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
```

- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(m1a): add node readiness + edge-condition evaluation`

---

## Task 5: Engine drive loop + NodeExecutor

**Files:** Create `engine/internal/engine/engine.go`, `engine/internal/engine/engine_test.go`

- [ ] **Step 1: Test** — linear DAG (a→b→c, all `success`) with a stub executor returning success: `Run` emits WORKFLOW_STARTED, NODE_STARTED/COMPLETED for a,b,c in order, WORKFLOW_COMPLETED; final `Project` shows all completed, run completed.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Impl** `engine.go`:

```go
package engine

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/myrmidonai/myrmidon/internal/statestore"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// NodeExecutor runs a single node and reports a result. M1a uses a stub; M1b
// dispatches to a runner via ExecutionBackend.
type NodeExecutor interface {
	Execute(ctx context.Context, runID string, node workflow.Node) (result string, err error) // "success"|"failed"
}

type Engine struct {
	store statestore.StateStore
}

func New(store statestore.StateStore) *Engine { return &Engine{store: store} }

func (e *Engine) emit(ctx context.Context, runID, typ string, p nodePayload) error {
	payload, _ := json.Marshal(p)
	key := runID + ":" + typ + ":" + p.NodeID
	_, err := e.store.AppendEvent(ctx, statestore.Event{
		ID: uuid.NewString(), Type: typ, IdempotencyKey: key, PayloadJSON: string(payload),
	})
	return err
}

// Run drives def to a terminal state using exec. Synchronous (M1a).
func (e *Engine) Run(ctx context.Context, runID string, def *workflow.Def, exec NodeExecutor) error {
	if err := def.Validate(); err != nil {
		return fmt.Errorf("invalid workflow: %w", err)
	}
	if err := e.emit(ctx, runID, EvWorkflowStarted, nodePayload{}); err != nil {
		return err
	}
	for {
		events, err := e.store.ReadEvents(ctx, 0)
		if err != nil {
			return err
		}
		st := Project(def, events)
		progressed := false
		for _, n := range def.Nodes {
			switch nodeDecision(def, st, n.ID) {
			case decReady:
				if err := e.emit(ctx, runID, EvNodeStarted, nodePayload{NodeID: n.ID}); err != nil {
					return err
				}
				res, err := exec.Execute(ctx, runID, n)
				if err != nil {
					return fmt.Errorf("execute %s: %w", n.ID, err)
				}
				if res != "failed" {
					res = "success"
				}
				if err := e.emit(ctx, runID, EvNodeCompleted, nodePayload{NodeID: n.ID, Result: res}); err != nil {
					return err
				}
				progressed = true
			case decSkip:
				if err := e.emit(ctx, runID, EvNodeSkipped, nodePayload{NodeID: n.ID}); err != nil {
					return err
				}
				progressed = true
			}
		}
		if !progressed {
			break
		}
	}
	// terminal status
	events, _ := e.store.ReadEvents(ctx, 0)
	st := Project(def, events)
	failed := false
	for _, s := range st.Nodes {
		if s == NodeFailed {
			failed = true
		}
	}
	if failed {
		return e.emit(ctx, runID, EvWorkflowFailed, nodePayload{})
	}
	return e.emit(ctx, runID, EvWorkflowCompleted, nodePayload{})
}
```

> Note: `emit`'s idempotency key omits attempt (single-attempt in M1a); retries/attempts arrive in M1d. Reading all events each loop is fine at M0/M1a scale; bounded reads come later.

- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(m1a): add workflow Engine drive loop with NodeExecutor interface`

---

## Task 6: Branching + parallel/join coverage

**Files:** extend `engine/internal/engine/engine_test.go`

- [ ] **Step 1: Tests** with a scripted stub executor (`map[nodeID]result`):
  - **Branch:** `start →(success) gate`, `gate →(success) ok`, `gate →(failed) bad`; script `gate=failed` ⇒ `bad` runs, `ok` skipped, run completed.
  - **Parallel fork+join:** `start →(always) a`, `start →(always) b`, `a →(success) join`, `b →(success) join`; assert `join` runs only after both `a`,`b` complete; run completed.
- [ ] **Step 2:** run → confirm pass (logic from Tasks 4-5).
- [ ] **Step 3: Commit** `test(m1a): cover condition branching and parallel fork/join`

---

## Task 7: M1a gate — load DAG from JSON + drive end-to-end

**Files:** Create `engine/internal/integration/m1a_test.go`

- [ ] **Step 1: Test** — embed a JSON workflow (entry `trigger` → `condition` gate → fork to two `agent` nodes → `join` agent → end), `workflow.Load` + `Validate`, run with a stub executor returning success, assert: run `WORKFLOW_COMPLETED`, all nodes `completed`, and `WORKFLOW_STARTED`/`WORKFLOW_COMPLETED` bracket the event log.
- [ ] **Step 2:** run `cd engine && go test ./...` → full suite green.
- [ ] **Step 3: Commit** `test(m1a): add M1a gate (load JSON DAG -> drive to completion via events)`

---

## Self-Review

- **Spec coverage:** WorkflowDef + node types (PRD6 §7.1-7.2) → T1; validation → T2; event-sourced state (§15) → T3; readiness/edge enums/join AND (§7.3) → T4; static DAG drive, no-LLM-flow (P7) → T5; branching/parallel → T6; gate → T7. Out of M1a: real executor dispatch + artifacts (M1b), reconciliation (M1c), bounded autonomy + human_approval routing (M1d), template (M1e).
- **Type consistency:** `Def/Node/Edge`, `Project`, `RunState`, `nodeDecision`, `Engine.Run`, `NodeExecutor.Execute(ctx,runID,node)→(string,error)` used consistently across tasks. Reuses M0 `statestore.Event` fields exactly (`ID/Type/IdempotencyKey/PayloadJSON`).
- **Placeholders:** none — every step has code + commands.
