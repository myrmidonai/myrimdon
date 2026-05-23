# M1b — Artifacts, Validation & Mock Executor Implementation Plan

> Execute with superpowers:executing-plans (inline). Steps use `- [ ]`. Builds on M0 (`StateStore`) and M1a (engine + `NodeExecutor` interface).

**Goal:** Make nodes do real work and produce **validated artifacts**. Provide a concrete `NodeExecutor` (replacing M1a's stub) that runs an executor, writes its outputs through an `ArtifactStore`, records `ARTIFACT_PRODUCED` (with checksum) and `ARTIFACT_VALIDATED` events, runs a validator, and returns the node result based on validation. The first executor is a **mock executor** (fixtures) per PRD6 §12.12 — real subprocess/cross-machine dispatch is M4.

**Architecture:** The M1a engine is unchanged — it already drives nodes via `NodeExecutor`. M1b adds: `ArtifactStore` (PRD6 §15.2 abstraction, local-FS impl), a `Validator` interface (PRD6 §7, file-exists default), a mock executor, and an `artifactExecutor` that wires executor → ArtifactStore (checksum) → events → validator → result. This realizes **P2 (artifacts are truth)** and **P3 (validation decides completion)** — a node's "success" now means its produced artifacts validated, not that the agent said so.

**Tech Stack:** Go; SHA-256 + `os.Stat` for checksums; reuses `statestore.Event`.

**M1b gate:** A workflow whose `agent` node declares a produced artifact runs the mock executor (writes the file from a fixture), the engine records `ARTIFACT_PRODUCED`(checksum) + `ARTIFACT_VALIDATED`(passed), the node completes, the run completes — and the artifact file exists on disk with a recorded checksum.

---

## Task 1: ArtifactStore (interface + local FS impl + checksum)

**Files:** `engine/internal/artifact/store.go`, `store_test.go`

- Interface + checksum type:
```go
package artifact

type Checksum struct {
	MTimeMs int64  `json:"mtime_ms"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256,omitempty"` // omitted for files > 10MB (PRD6 §12.9)
}

// Store is the artifact persistence boundary (PRD6 §15.2). v1 = local FS; later S3.
// Keys are workspace-relative paths.
type Store interface {
	Put(relpath string, content []byte) (Checksum, error)
	Get(relpath string) ([]byte, error)
	Stat(relpath string) (cs Checksum, exists bool, err error)
	Exists(relpath string) bool
}
```
- Local impl rooted at a base dir; `Put` creates parent dirs + writes + returns `Stat`; `Stat` does `os.Stat` (mtime ms, size) + SHA-256 (skip if >10MB).
- **Tests:** Put then Get round-trips bytes; Stat returns size + non-empty sha + exists=true; Exists false for missing; checksum changes when content changes.
- Commit `feat(m1b): add ArtifactStore interface + local FS impl with checksums`

## Task 2: Node artifact spec + artifact event constants

**Files:** edit `engine/internal/workflow/def.go`; edit `engine/internal/engine/events.go`

- Add to `workflow`:
```go
type ArtifactRef struct {
	ID   string `json:"id"`
	Path string `json:"path"` // workspace-relative output path
}
```
and field `Produces []ArtifactRef `json:"produces,omitempty"`` on `Node`.
- Add event constants to `engine`: `EvArtifactProduced = "ARTIFACT_PRODUCED"`, `EvArtifactValidated = "ARTIFACT_VALIDATED"`; add an `artifactPayload struct { NodeID, ArtifactID, Path, SHA256 string; Passed bool }`.
- No behavior change to Project (artifact events ignored there for now). Build only.
- Commit `feat(m1b): add Node.Produces artifact spec + artifact event types`

## Task 3: Validator interface + file-exists validator

**Files:** `engine/internal/validate/validator.go`, `validator_test.go`

```go
package validate

import "github.com/myrmidonai/myrmidon/internal/artifact"

type Result struct {
	Passed   bool
	Evidence string
}

// Validator decides whether a produced artifact is valid (PRD6 §7).
type Validator interface {
	Validate(store artifact.Store, relpath string) Result
}

// FileExists: the default automated validator — artifact must exist & be non-empty.
type FileExists struct{}
```
- `FileExists.Validate`: `Stat`; passed iff exists && size>0.
- **Tests:** missing file → !passed; empty file → !passed; non-empty → passed.
- Commit `feat(m1b): add Validator interface + file-exists validator`

## Task 4: Mock executor (fixtures → write artifact files)

**Files:** `engine/internal/executor/mock.go`, `mock_test.go`

```go
package executor

// Mock reads fixtures/{node_id}.json = {"files": {"relpath": "content", ...}, "result": "success|failed"}
// and writes the files via the ArtifactStore. Used for deterministic tests (PRD6 §12.12).
type Mock struct {
	FixturesDir string
	Store       artifact.Store
}

type fixture struct {
	Files  map[string]string `json:"files"`
	Result string            `json:"result"`
}

// Run writes the fixture's files and returns its declared result (default "success").
func (m *Mock) Run(nodeID string) (result string, written []string, err error)
```
- Reads `FixturesDir/{nodeID}.json`; for each file → `Store.Put(relpath, []byte(content))`; returns result + written relpaths. Missing fixture → result "success", no files.
- **Tests:** fixture writes declared files (assert via Store.Exists/Get); result honored; missing fixture → success/no files.
- Commit `feat(m1b): add mock executor that writes fixture artifacts via ArtifactStore`

## Task 5: artifactExecutor — wire executor → artifacts → validation → result

**Files:** `engine/internal/engine/artifact_executor.go`, `artifact_executor_test.go`

A concrete `engine.NodeExecutor` (M1a interface) that, for an agent node:
1. runs the mock executor (`Mock.Run(node.ID)`),
2. for each `node.Produces` ref: `Store.Stat(path)` → emit `ARTIFACT_PRODUCED`(checksum) via `StateStore`; run the validator → emit `ARTIFACT_VALIDATED`(passed),
3. returns `"success"` iff the executor result is success **and** all produced artifacts validated; else `"failed"`.

```go
type ArtifactExecutor struct {
	Store     artifact.Store
	Events    statestore.StateStore
	Validator validate.Validator
	Mock      *executor.Mock
}
func (a *ArtifactExecutor) Execute(ctx context.Context, runID string, n workflow.Node) (string, error)
```
- **Tests** (use an in-memory/temp Store + SQLite `StateStore`): node with a fixture that writes its declared artifact → returns "success", `ARTIFACT_PRODUCED` + `ARTIFACT_VALIDATED(passed=true)` events present, checksum non-empty. Node whose declared artifact is NOT written by the fixture → validator fails → returns "failed", `ARTIFACT_VALIDATED(passed=false)`.
- Commit `feat(m1b): wire executor→ArtifactStore→validator→result (artifacts are truth)`

## Task 6: ExecutionBackend interface + M1b gate

**Files:** `engine/internal/backend/backend.go` (PRD6 §15.2 reservation; local in-process impl), `engine/internal/integration/m1b_test.go`

- `ExecutionBackend` interface (`Spawn/Heartbeat/Kill`) with a **local in-process** impl that simply invokes the `ArtifactExecutor` (real subprocess + cross-machine = M4). Keep the interface so M4 swaps the impl. (Minimal: define interface + `Local` that calls the executor; a focused unit test.)
- **M1b gate integration test:** temp workspace + fixtures; a workflow `trigger → build(agent, produces api.go) → qa(agent)`; fixture for `build` writes `api.go`; run the engine with the `ArtifactExecutor`; assert: run `completed`, `api.go` exists on disk with recorded checksum, and the event log contains `ARTIFACT_PRODUCED`+`ARTIFACT_VALIDATED(passed)` for `build`.
- `cd engine && go test ./...` → full suite green.
- Commit `test(m1b): add M1b gate (node produces validated artifact end-to-end)`

---

## Self-Review
- Coverage: ArtifactStore §15.2 → T1; artifact spec/events → T2; Validator §7 → T3; mock executor §12.12 → T4; artifact-as-truth/validation-decides-completion P2/P3 → T5; ExecutionBackend reservation §15.2 + gate → T6.
- The M1a engine is untouched (M1b only supplies a richer `NodeExecutor`).
- Out of M1b: real subprocess/cross-machine dispatch (M4), stale propagation/reconciliation (M1c), bounded autonomy/human approval (M1d).
- Type consistency: `artifact.Store`/`Checksum`, `validate.Validator`/`Result`, `executor.Mock`, `engine.ArtifactExecutor` implements `engine.NodeExecutor` (`Execute(ctx,runID,node)→(string,error)`).
