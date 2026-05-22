# PRD4 Implementation Design

**Date:** 2026-05-23  
**Scope:** Full PRD4 v1 — Foundation + WorkflowEngine v2 + ExecutionBackend (Claude Code) + Reconciliation + Bounded Autonomy + TUI + software-dev-agile template  
**Strategy:** Bottom-Up (Approach A) — strict layer-by-layer, each layer only uses interfaces from the layer below  
**Spec baseline:** PRD4.md (定稿) + PRD5.md (平台化架构守则)

---

## 1. What We're Building

Myrmidon v1 is a local autonomous workflow runtime. A user describes "desired world state" (workflow definition), and Myrmidon continuously coordinates AI agents and human reviewers to drive reality toward that state while maintaining consistency.

This milestone delivers the complete PRD4 kernel:
- Four Foundation interfaces (StateStore / ArtifactStore / ExecutionBackend / Scheduler) with local implementations
- WorkflowEngine v2 built entirely on those interfaces (no direct db.prepare or fs.readFile in engine code)
- Real Claude Code dispatch with worktree isolation and 7-layer context injection
- Reconciliation engine with stale propagation and drift detection
- Bounded autonomy (retry escalation, similarity detection, structured feedback)
- 5-Tab Ink TUI
- software-dev-agile prebuilt template (§16.A complete)

---

## 2. Architecture: 7 Layers

```
Layer 6  software-dev-agile template     src/core/templates/software-dev-agile/
Layer 5  TUI (5-Tab Ink)                 src/tui/
Layer 4  Bounded Autonomy                src/core/autonomy/
Layer 3  Reconciliation Engine           src/core/reconciler/
Layer 2  WorkflowEngine v2               src/core/engine/
Layer 1  ExecutionBackend (Claude Code)  src/core/foundation/impl/local-execution-backend.ts
Layer 0  Foundation interfaces + impls   src/core/foundation/
```

**Hard constraint (PRD4 P7):** Code in `engine/`, `reconciler/`, `autonomy/` must only access state and artifacts through Foundation interfaces. No `db.prepare()`, no `fs.readFile()` on artifact paths. Domain words (coder, port, DOM) belong only in `templates/`.

---

## 3. Module Directory

```
src/
  core/
    foundation/
      state-store.ts            StateStore interface
      artifact-store.ts         ArtifactStore interface
      execution-backend.ts      ExecutionBackend interface
      scheduler.ts              Scheduler interface
      impl/
        sqlite-state-store.ts   SQLite implementation
        local-artifact-store.ts node:fs implementation
        local-execution-backend.ts  child_process.spawn implementation
        noop-scheduler.ts       v1: claim always succeeds, fencing token = 1
    database/
      schema.ts                 Full new event-sourcing schema (SCHEMA_VERSION = 3)
      migrations.ts             Version migration scripts
      client.ts                 (keep, minor updates)
    engine/
      workflow-engine.ts        WorkflowEngine v2
      state-machines.ts         Three state machines (Run / Node / Artifact)
      dag.ts                    Upstream check + topological sort
    reconciler/
      reconciler.ts             Continuous reconciliation loop
      stale-propagator.ts       Stale propagation (BFS, depth-limited)
      drift-detector.ts         Drift type detection and handling
    autonomy/
      retry-manager.ts          Bounded retry with escalation
      similarity-detector.ts    Output similarity via SHA-256 set diff
      feedback-store.ts         Structured feedback storage and injection
    executors/                  Node executors (keep structure, rewire to Foundation)
    templates/
      software-dev-agile/
        roles.ts                9 role definitions
        workflow.ts             Full node + edge DAG
        dom-contract.ts         DOM Contract format
        config.ts               Port allocation, monorepo layout, coderOverrides
  tui/
    index.ts                    Ink app entry
    tabs/
      overview.ts               Tab 1: artifact status graph
      review-queue.ts           Tab 2: needs_review list + keyboard actions
      logs.ts                   Tab 3: event stream
      cron.ts                   Tab 4: timer states
      config-tab.ts             Tab 5: read-only config
  cli/                          Keep existing CLI skeleton
```

---

## 4. Foundation Layer

### 4.1 StateStore

```typescript
interface StateStore {
  appendEvent(e: Omit<Event, 'seq'>): Promise<Event>;
  readEvents(runId: string, since?: number): AsyncIterable<Event>;
  projection<T>(table: string, query: Query): Promise<T[]>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

interface Event {
  seq: number;                // AUTOINCREMENT, sort key
  run_id: string;
  type: string;               // e.g. 'NODE_STARTED', 'ARTIFACT_PRODUCED'
  payload_json: string;
  idempotency_key: string;    // UNIQUE — prevents double-write on retry
  created_at: string;
}
```

`SqliteStateStore` implementation: uses better-sqlite3; `appendEvent` runs inside a transaction that also updates the relevant projection table. `idempotency_key` conflict = no-op (return existing event).

### 4.2 ArtifactStore

```typescript
interface ArtifactStore {
  put(id: string, content: Buffer | Readable): Promise<Checksum>;
  get(id: string): Promise<Readable>;
  stat(id: string): Promise<{ mtime: number; size: number; sha256?: string }>;
  exists(id: string): Promise<boolean>;
}
```

`LocalArtifactStore`: reads/writes files at the path registered in the `artifacts` projection. The path is resolved relative to project root. Reconciliation calls `stat()` for checksum checks — never touches fs directly.

### 4.3 ExecutionBackend

```typescript
interface ExecutionBackend {
  spawn(opts: SpawnOpts): Promise<WorkerHandle>;
  heartbeat(handle: WorkerHandle): Promise<HeartbeatStatus>;
  kill(handle: WorkerHandle, signal: 'SIGTERM' | 'SIGKILL'): Promise<void>;
}

interface SpawnOpts {
  execId: string;
  worktreePath: string;
  dispatchFilePath: string;   // pre-written DISPATCH.md
}

interface WorkerHandle {
  pid: number;
  worktreePath: string;
  execId: string;
}
```

`LocalExecutionBackend.heartbeat()`: calls `process.kill(pid, 0)` to check liveness. Returns `{ alive: boolean, lastSeen: number }`.

### 4.4 Scheduler

```typescript
interface Scheduler {
  claim(runId: string): Promise<Lease | null>;
  renew(lease: Lease): Promise<void>;
  release(lease: Lease): Promise<void>;
}

interface Lease {
  runId: string;
  fencingToken: number;       // monotonically increasing; StateStore validates on write
}
```

`NoopScheduler` (v1): `claim()` always returns `{ runId, fencingToken: 1 }`. Token validation in StateStore is a no-op in v1 but the parameter is threaded through so v3 can add real validation without API changes.

---

## 5. Database Schema (SCHEMA_VERSION = 3)

Migration from version 2 to 3:
- **Drop** PRD1-era domain-specific tables: `workflow` (single-row state machine), `agents`, `tasks`, `worktrees`, `git_ops`, `timer_events`, `agent_sessions`
  - `agents` is dropped: agent status is now tracked via `executor_procs` + `node_executions`
- **Keep** `meta`, `executor_procs`, `workflows` (from v2)
- **Add** event-sourcing tables

### New tables

```sql
-- Append-only event log (the only source of truth)
CREATE TABLE IF NOT EXISTS events (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           TEXT NOT NULL,
  type             TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id, seq);

-- Projections (rebuilt from events on demand)
CREATE TABLE IF NOT EXISTS workflow_runs (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL,
  status        TEXT NOT NULL,   -- running|paused|completed|failed
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  context_json  TEXT,
  lease_token   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS node_executions (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  status        TEXT NOT NULL,
  -- pending|running|completed|failed|skipped|waiting_human|stale_blocked
  attempt       INTEGER NOT NULL DEFAULT 1,
  agent_id      TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  error         TEXT,
  output_json   TEXT,
  feedback_json TEXT    -- structured feedback from human rejections
);

CREATE TABLE IF NOT EXISTS artifacts (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  status       TEXT NOT NULL,
  -- pending|generating|needs_validation|valid|invalid|needs_review|stale|orphaned
  checksum     TEXT,              -- SHA-256, updated by ArtifactStore.stat()
  upstream_ids TEXT,             -- JSON array of artifact IDs this depends on
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

---

## 6. WorkflowEngine v2

### 6.1 Core principle

All state transitions go through `StateStore.appendEvent()`. The event handler updates the projection in the same transaction. Engine reads state through `StateStore.projection()`.

### 6.2 State machines

**WorkflowRun:** `idle → running → paused | completed | failed`  
**NodeExecution:** `pending → running → completed | failed | waiting_human | stale_blocked` (+ `skipped`)  
**Artifact:** `pending → generating → needs_validation → valid | invalid | needs_review → stale | orphaned`

State machine transitions are defined as pure functions in `state-machines.ts`; the engine applies them by appending the corresponding event.

### 6.3 tick() scheduling

```
1. Load pending NodeExecutions for current run
2. For each pending node:
   a. upstreamsComplete(def, runId, nodeId)   → join=ALL, others=ANY
   b. inputArtifactsReady(node, runId)         → all consumes artifacts are 'valid'
   c. If both pass → dispatch(node, exec)
3. Poll running nodes: backend.heartbeat() for each
   → timeout T4 (60s no heartbeat) → PhantomRunning drift
4. Check and update overall workflow status
```

### 6.4 Dispatch flow

```
1. Scheduler.claim(runId)           → Lease
2. StateStore.appendEvent(NODE_STARTED, { idempotency_key: execId + ':start' })
3. Write DISPATCH.md (7-layer context, §7 below)
4. ExecutionBackend.spawn(opts)     → WorkerHandle
5. StateStore.appendEvent(PROCESS_SPAWNED, { pid, worktreePath })
6. Register pid in executor_procs
```

When agent process exits (detected by `heartbeat()` returning `{ alive: false }` in tick's poll-running-nodes step):
```
7. ArtifactStore.stat() all produces paths
8. Run outputValidator
9. If valid → StateStore.appendEvent(ARTIFACT_PRODUCED) × N → ARTIFACT_VALID → NODE_COMPLETED
10. If invalid → StateStore.appendEvent(NODE_FAILED) → RetryManager
11. Scheduler.release(lease)
```

---

## 7. ExecutionBackend — Claude Code Dispatch

### 7.1 Worktree creation

```typescript
// git worktree add .myrmidon/runs/{run_id}/{node_id}/worktree {branch}
// branch = myrmidon/{run_id}/{node_id}
```

### 7.2 DISPATCH.md — 7-layer context injection (PRD4 §5.5.1)

Written to `{worktreePath}/DISPATCH.md`:

```markdown
<!-- Layer 1: Fresh Session Declaration -->
You are starting a fresh session with no prior context.

<!-- Layer 2: Observation Masking -->
You have access to these artifacts only: [list of consumes paths + content summaries]

<!-- Layer 3: Pre-Compaction Snapshot -->
{continue.md content if exists at .myrmidon/runs/{run_id}/{node_id}/continue.md}
{last rejection feedback_json if present}

<!-- Layer 4: Phase Anchor -->
Workflow: {workflow.name}
Node: {node.name} ({node.id})
Your task: produce these artifacts: [list of produces paths]

<!-- Layer 5: 70% Pressure Monitor -->
When your context reaches ~70% capacity, write a continue.md snapshot to
.myrmidon/runs/{run_id}/{node_id}/continue.md and terminate this session.

<!-- Layer 6: Sandboxed Exec -->
Allowed tools: [node.mcpTools whitelist]
Forbidden: modifying files outside your worktree, calling system state APIs.

<!-- Layer 7: Tool Result Truncation -->
Truncate tool results longer than 10,000 characters to the first 10,000 characters.
```

### 7.3 continue.md protocol

`continue.md` lives at node level: `.myrmidon/runs/{run_id}/{node_id}/continue.md`  
(Above the attempt directories: `.myrmidon/runs/{run_id}/{node_id}/{attempt}/`)

On new attempt: inject existing `continue.md` content in Layer 3. Agent overwrites it when approaching context limit. Engine never deletes it between attempts — it's the cross-attempt memory.

### 7.4 Process lifecycle

On SIGTERM → wait 10s → SIGKILL. All cleanup logged to `executor_procs.killed_at`. Orphan sweep: TimerManager T1 (30s) calls `backend.heartbeat()` for all active procs; dead ones get SIGKILL + `executor_procs` updated.

---

## 8. Reconciliation Engine

### 8.1 Loop cadence

- **Event-driven** (dirty-bit): When `StateStore.appendEvent(ARTIFACT_PRODUCED)` fires, the Reconciler immediately marks all downstream artifacts dirty. In v1, agents write files directly to disk; `ARTIFACT_PRODUCED` is the canonical signal, not `ArtifactStore.put()`.
- **Periodic** (T5 = 300s): Full checksum scan via `ArtifactStore.stat()` as backstop (catches out-of-band file changes the event stream missed).

### 8.2 Stale propagation

1. Build artifact dependency graph from `artifacts.upstream_ids`
2. BFS from changed artifact, mark each downstream as `stale`
3. Debounce: collect changes for 500ms, then propagate in one pass
4. Max depth: 10 hops (prevents Reconciliation Storm on circular-like graphs)
5. Downstream NodeExecutions in `running` or `pending` state → set to `stale_blocked`

### 8.3 Drift types and handling

| Drift Type | Detection | Action |
|-----------|-----------|--------|
| MissingArtifact | `ArtifactStore.exists()` = false but status = valid | → invalid, notify |
| StaleArtifact | `stat()` checksum ≠ stored checksum | → stale, propagate |
| PhantomRunning | NodeExecution running but heartbeat timeout T4 | → failed, trigger retry |
| OrphanWorktree | executor_procs: killed_at IS NULL but pid dead | → SIGKILL, cleanup |
| InvalidProjection | Projection state ≠ event-log replay | → rebuild projection from events |

---

## 9. Bounded Autonomy

### 9.1 Retry config (per node in WorkflowDef)

```typescript
retry?: {
  maxAttempts: number;        // default 3
  notifyAttempt: number;      // default maxAttempts - 1; after this many failures, notify human
  retryIntervalMs: number;    // default 30_000
  onExhausted: 'pause_for_human';  // never 'abort'
}
```

### 9.2 Escalation path

With defaults (maxAttempts=3, notifyAttempt=2):

```
Attempt 1 failure   → auto-retry
Attempt 2 failure   → auto-retry + NotificationBus.notify('human_attention_needed', ...)
Attempt 3 failure   → WorkflowRun status → 'paused', require explicit human resume
```

Rule: failures < notifyAttempt → silent auto-retry; failures ≥ notifyAttempt AND < maxAttempts → retry + notify; failures = maxAttempts → pause.

### 9.3 Similarity detection (oscillation guard)

Between attempt K and K-1: compute SHA-256 of each file in `produces`, build set. If set-diff = ∅ (identical outputs), mark node as `oscillating` and skip straight to the N+M escalation path, bypassing further auto-retries.

### 9.4 Oscillation stuck detection (PRD4 §9.5)

Track last 4 node transitions per run in a sliding window. If pattern is A→B→A→B (same two node IDs alternating), pause the run and notify. Also: if a node fails with "missing dependency" on the same artifact for 2 consecutive attempts, escalate immediately rather than waiting for maxAttempts.

### 9.5 Structured feedback injection

`human_approval` reject action writes:
```typescript
{ category: 'layout_wrong'|'token_mismatch'|'logic_error'|'requirement_gap'|'other',
  description: string,
  expectation: string }
```

Stored in `node_executions.feedback_json`. On next dispatch, injected as part of Layer 3 (Pre-Compaction Snapshot) in DISPATCH.md.

---

## 10. TUI (Ink)

### 10.1 5-Tab structure

Tabs rendered by Ink with two data paths:
- **Read path:** Direct SQLite SELECT on projection tables (`workflow_runs`, `node_executions`, `artifacts`). PRD4 P7 forbids bypassing StateStore for writes only; read-only projections are acceptable for display performance.
- **Write path:** Human approval actions (approve / reject / defer) go through `StateStore.appendEvent()`. No direct db writes from TUI code.

| Tab | Key | Content |
|-----|-----|---------|
| Overview | 1 | Per-artifact status symbols. ✅ valid · 🔄 running · ⚠️ stale · ❌ invalid · 👤 needs_review · ○ pending |
| Review Queue | 2 | needs_review artifacts list. Keys: [a] approve · [r] reject (opens reason form) · [d] defer |
| Logs | 3 | Live event stream from StateStore.readEvents() |
| Cron | 4 | TimerManager slot states (T1-T5) + next-fire timestamps |
| Config | 5 | Read-only myrmidon.config.ts display |

### 10.2 Review rejection form

Inline form in Tab 2 on [r]:
```
Category: [layout_wrong / token_mismatch / logic_error / requirement_gap / other]
Description: _______________
Expectation: _______________
```

Submits to StateStore via `ARTIFACT_REJECTED` event.

---

## 11. software-dev-agile Template (§16.A)

### 11.1 Files

```
src/core/templates/software-dev-agile/
  index.ts          re-exports WorkflowTemplate
  workflow.ts       defineWorkflow() — full DAG (§16.A node list)
  roles.ts          9 AgentRole definitions
  dom-contract.ts   DOM Contract interface (interface file format)
  config.ts         DomainConfig (port allocation, monorepo, coderOverrides)
```

### 11.2 Roles

| ID | Responsibility |
|----|----------------|
| pm | Requirements, PRD, sprint planning |
| arch | Technical review, detailed design, task breakdown |
| coder | Implementation, SQL design, API design, bug fixes |
| qa | Test case generation, testing, issue reporting |
| security | Security review |
| ui | UI/UX design |
| reviewer | Code review |
| release-manager | Release coordination |
| devops | CI/CD, infrastructure |

### 11.3 Domain config

```typescript
interface SoftwareDevAgileConfig {
  portAllocation: { base: number; range: number };
  monorepo: { packages: string[] };
  coderOverrides: Record<string, Partial<AgentRole>>;
  externalDependencies: string[];
}
```

### 11.4 DAG summary

```
trigger → requirements(pm) → prd(pm) → design(arch) → sprint-plan(pm)
→ [parallel_fork] → coding-1, coding-2, coding-3 (coder) → [join]
→ qa(qa) → [condition]
  → passed → human_approval(sprint-delivery)
  → failed → bug-fix(coder) → qa [loop, maxIterations=5]
```

Parallel coder slots are statically defined at N=3 maximum. Unused slots (when sprint has fewer tasks) are skipped via a `condition` node at each slot entry that checks `context.coderTasks[n]` exists.

---

## 12. What Changes vs. Current Code

| File/Area | Action |
|-----------|--------|
| `src/core/database/schema.ts` | Rewrite: SCHEMA_VERSION=3, new event-sourcing tables, drop old PRD1 tables |
| `src/core/workflow/engine.ts` | Rewrite as `src/core/engine/workflow-engine.ts`, uses Foundation interfaces |
| `src/core/workflow/worktree.ts` | Move into `ExecutionBackend` impl |
| `src/core/workflow/monitor.ts` | Replace with `reconciler/drift-detector.ts` (heartbeat check folded in) |
| `src/core/workflow/timers.ts` | Keep TimerManager, rewire events to StateStore |
| `src/core/workflow/dispatcher.ts` | Move DISPATCH.md logic into ExecutionBackend.spawn() |
| `src/core/workflow/executor-registry.ts` | Keep, rewire executor context to pass StateStore/ArtifactStore |
| `src/core/templates/software-dev-agile.ts` | Replace with `src/core/templates/software-dev-agile/` directory |
| `src/cli/tui.ts` | Replace with `src/tui/` Ink app |
| `src/cli/` commands | Keep structure, update imports |

---

## 13. Implementation Order

```
Step 1   Foundation interfaces + NoopScheduler (state-store.ts, artifact-store.ts, etc.)
Step 2   Database schema v3 + migration script
Step 3   SqliteStateStore + LocalArtifactStore + LocalExecutionBackend implementations
Step 4   WorkflowEngine v2 (state machines + DAG + dispatch skeleton)
Step 5   DISPATCH.md 7-layer context builder
Step 6   Full ExecutionBackend: worktree, spawn, heartbeat, process lifecycle
Step 7   Reconciliation engine + stale propagator + drift detector
Step 8   Bounded autonomy: RetryManager + SimilarityDetector + FeedbackStore
Step 9   TUI: Ink 5-tab app
Step 10  software-dev-agile template (§16.A)
Step 11  Integration: wire CLI commands to new engine, smoke test full workflow
```

---

## 14. Out of Scope (This Milestone)

- Multi-tenant isolation, SSO/RBAC
- OS-level sandboxing (Docker/Firecracker)
- Distributed StateStore / S3 ArtifactStore (interfaces are pre-defined, impls are v3)
- Sub-workflow composition (PRD5 P5-2 — v2)
- OTel span tracing (PRD5 P5-3 — v2)
- Partition / batch execution (PRD5 P5-4 — v2)
- Connector ecosystem (PRD5 P5-5 — v2)
- Canvas visual editor (PRD5 P5-8 — v3)
