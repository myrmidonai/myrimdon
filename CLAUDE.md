# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State: Fresh Rebuild

**There is no source code on disk.** The previous v1 implementation was intentionally deleted; it survives only in git history (`git show HEAD:<path>`). The project is being **rebuilt from scratch against the PRDs**. The only files in the working tree are the PRD documents and `docs/`.

When implementing, scaffold fresh from the spec rather than restoring deleted files wholesale — the prior code is a reference, not the target.

## Source-of-Truth Documents

| Doc | Role | Treat as |
|-----|------|----------|
| `PRD4.md` | 通用自治工作流运行时 — final fused spec, status 定稿 | **The v1 implementation baseline.** Build to this. |
| `PRD5.md` | Platform-evolution increment layer | **Architectural guardrails.** Does NOT replace PRD4. Mandates 5 abstractions be reserved in v1 (see below). |
| `PRD1/2/3.md` | Superseded by PRD4 | Background only; PRD4 inherits and generalizes them. |
| `partyA.prd.md` | Original client (甲方) brief | Origin context. |

If PRD4 and PRD5 ever conflict, PRD5 is pure-addition ("只增不改"); resolve toward PRD4 for v1 scope and PRD5 for which interfaces to reserve.

## What Myrmidon Is

A **general-purpose autonomous workflow runtime** — not a pipeline. The user declares a desired world-state (a workflow DAG); the Runtime continuously drives reality toward it and maintains consistency. Software development (`software-dev-agile`) is just one built-in template; the kernel knows nothing about any domain. Other templates: novel-writing, video-production, content-moderation.

> CI/CD asks "what step are we on?" Myrmidon asks "is the world the shape I expect?"

## Intended Stack & Commands

ADR (PRD4 §12.0): **Node.js / TypeScript** for v1–v2. Reasons: the `defineWorkflow()` DSL *is* TS code; `npx myrmidon` zero-install distribution; workload is IO-bound (spawning external runtimes), not CPU-bound. Go is reserved only for a possible v3 cloud control-plane, isolated behind the PRD5 interfaces.

These scripts/deps come from the deleted v1 scaffold and should be recreated as part of the rebuild (`package.json` does not currently exist):

```bash
npm run build       # tsup → dist/cli/index.js (the `myrmidon` bin)
npm run dev         # tsx src/cli/index.ts
npm test            # vitest run
npm run test:watch  # vitest
npm run typecheck   # tsc --noEmit
npx vitest run path/to/file.test.ts          # single test file
npx vitest run -t "test name substring"      # single test by name
```

Key deps: `better-sqlite3` (state store), `ink` + `react` (TUI), `commander` (CLI), `zod` (schema validation), `pino` (logging), `jiti`/`tsx` (loading the TS config & workflow DSL files at runtime).

## Architecture: The Big Picture

### Six core principles (PRD4 §2) — internalize these before changing behavior
- **P1 Runtime is the sole authority on world-state.** Agents only *propose* (produce artifacts). Agents may never declare completion, mutate state directly, or bypass validation.
- **P2 Artifacts are the only truth.** World-state = the set of artifact files on disk + their validation results. Memory/summaries/an agent's claims are NOT truth. On conflict, the artifact wins.
- **P3 Validation decides completion; humans are first-class validators.** Three tiers: automated (compile/test/lint — trusted), AI-assisted (screenshot diff — advisory), human (semantic/UI — final authority). Human verdict overrides all automated validators.
- **P4 Continuous reconciliation.** When an upstream artifact changes, downstream is marked `stale` and dependent nodes pause. **`stale` only propagates a marker — it never auto-triggers re-execution** (prevents cascade re-runs that burn API budget).
- **P5 Workers are stateless, ephemeral cognition units.** Each execution gets minimal injected context and is destroyed on completion. No long sessions/memory/context.
- **P6 Bounded autonomy; failure must converge.** Bounded retries → on exhaustion `pause_for_human` (not abort). Structured rejection feedback is injected into the next attempt. Output-similarity detection stops spinning in place.

### Process architecture (PRD4 §12.1) — hard boundaries
```
myrmidon-runtime (long-running: tray or daemon)
  ├── RuntimeKernel       ← the ONLY writer of SQLite + event log
  ├── WorkflowEngine      ← DAG scheduling, state machines, condition/join eval
  ├── ReconciliationLoop  ← periodic checksum scan + stale propagation
  ├── ExecutorManager     ← Worker (Agent) lifecycle
  ├── ValidatorBus        ← runs validators, writes results back to kernel
  ├── NotificationBus     ← Slack / 企业微信 / tray
  └── IPCServer           ← Unix socket, accepts CLI commands

myrmidon CLI (short-lived, fully stateless)
  └── IPCClient → IPCServer (JSON-RPC over ~/.myrmidon/runtime.sock)
```
- **CLI is a thin stateless client** — it never touches SQLite or artifact files; every command is an IPC request.
- **Runtime is the only writer** — CLI, Workers, external tools may read SQLite but never write it.
- **IPC is the only mutation entry point** (including review approve/reject). State-changing commands require the bearer token from `~/.myrmidon/auth.token` (chmod 600); the token is never injected into Agent environments, so a generated script cannot self-approve its own review.

### Event sourcing is the foundation (PRD4 §11)
The append-only event log (`events` table, ordered by autoincrement `seq`) is the **single source of truth**; SQLite projection tables are a rebuildable cache. On crash/restart: load latest snapshot, replay events, rebuild projections. Events carry an `idempotency_key` (`{run_id}:{type}:{entity}:{attempt}`) written `INSERT OR IGNORE` so retries/rescans don't duplicate. The **World Reconstruction Test** (§12.12) is a release gate: delete sessions+snapshots+projection tables, keep only event log + artifact files, restart, assert state is identical — if it fails, truth leaked somewhere other than the event log.

### Kernel vs Template separation (PRD4 §4.6) — the defining constraint
The kernel is domain-agnostic. **No domain vocabulary (coder/port/DOM Contract) may appear in the kernel.** Domain content lives ONLY in templates:
- **Kernel:** DAG scheduling, state machines, condition/join eval, artifact lifecycle, stale propagation, reconciliation, 7-layer context management, bounded autonomy, the 3-layer config mechanism, runtime detection, process cleanup.
- **Template:** concrete roles (pm/writer/moderator), artifact format specs (DOM Contract, storyboard format), conventions, domain validators, domain config (port allocation, monorepo).

Adding a domain = writing a new template (roles + artifact specs + conventions), changing **zero kernel code**. That is the litmus test for "general OS."

### Workflow DSL & scheduling (PRD4 §4)
Workflows are TS via `defineWorkflow({ nodes, edges })`. Node types: `agent`, `human_approval`, `condition`, `parallel_fork`, `join`, `transform`, `trigger`, `loop`. Edge `condition` is a **fixed string enum** (`success`/`failed`/`approved`/`rejected`/`always`) — never `eval`. `condition`-type nodes may use sandboxed **JSON Logic** `expr` against `workflow_run.context_json` only. Node readiness = all incoming edges satisfied AND all consumed artifacts `valid` AND node `pending` AND not autonomy-paused. `join` is AND-semantics only.

### Three-layer config (PRD4 §5.3.1)
`agentRoles` (capability boundaries, filled by template) → `executors` (runtime × model) → `agents` (workflow binding). Decoupling goal: swap model without touching roles; change role without touching workflow.

### Per-execution filesystem layout (created by the Runtime)
```
.myrmidon/runs/{run_id}/{node_id}/
  continue.md            ← context-pressure handoff (node-level, persists across attempts)
  {attempt}/
    context/  output/  logs/{heartbeat.json,stdout.log,stderr.log}  exit_code
worktrees/{run_id}-{node_id}-{attempt}/   ← git worktree per Worker (isolation)
```
Exit codes: `0` done · `1` fail→retry · `2` out-of-context→pause_for_human · `3` give-up→pause_for_human. Heartbeat every 15s; no heartbeat > `stuckDetectionMs` (120s) ⇒ Phantom Running ⇒ failed.

## PRD5: Five Abstractions That MUST Be Reserved in v1

PRD5's core message: PRD4's event-sourcing foundation is already platform-ready, but five seams must be defined at v1 coding time (implement only the local version, but program against the interface) or future migration becomes a rewrite. **Do not let business code call `db.prepare(...)` or `fs.readFile(...)` on artifacts directly.**

1. **`StateStore`** — all event-log/projection access goes through it (v1 SQLite → v3 Postgres).
2. **`ArtifactStore`** — all artifact read/write + checksum via `put/get/stat/exists` (v1 local FS → v3 S3). Reconciliation calls `stat()`, never touches FS directly.
3. **`ExecutionBackend`** — `spawn/heartbeat/kill` behind an interface (v1 local spawn → v2 remote machine → v3 K8s).
4. **`Scheduler`** — `claim/renew/release` leases with a monotonic **fencing token**. Even though v1 `claim` always succeeds, the interface + token field must exist. Semantics: **per-run single writer, not global single writer.**
5. **Executor span callback** (P5-3) — adapters emit OpenTelemetry-style spans (LLMCall/ToolCall) now, even if only to a local log, so v2 tracing doesn't require rewriting every adapter.

Also reserve the **`subworkflow` node type** (P5-2): never assume the DAG is flat. Everything else in PRD5 (partitions, connectors, model routing, marketplace, compliance) is v2/v3 — don't build it for v1.

## Hard Anti-Patterns (PRD4 §P7) — never introduce these, even "helpfully"
| Forbidden | Correct approach |
|-----------|-----------------|
| LLM decides workflow control flow | Structure is statically defined before start; engine advances the DAG |
| Agent self-reports "task done" | Validators decide; artifacts are truth |
| Relying on long session / memory | Stateless Worker, minimal injected context |
| `stale` auto-triggers re-execution | `stale` only marks; scheduler/human decides |
| Infinite retry until success | Bounded retry + similarity detection + escalate to human |
| "Visualization is truth" (n8n model) | DSL is the sole truth; canvas is a projection |
| Domain words in the kernel | Domain content only in templates |
| CLI/Worker writing SQLite directly | All state changes go through the Runtime via IPC |
| Business code touching `db.prepare`/`fs` for artifacts | Go through StateStore / ArtifactStore |

**v1 explicitly does NOT do:** multi-tenant isolation, enterprise SSO/RBAC/audit, >10 concurrent runs, OS-level sandbox (Docker/Firecracker), auto-verifying external state (URL polling).

## MVP Scope (PRD4 §14)
MVP target: an indie developer can really use it. MVP = Workflow Engine (with a **fully-runnable** `software-dev-agile` template, not placeholders) + lightweight Reconciliation (checksum scan, stale propagation, crash recovery) + bounded autonomy + `myrmidon review list/approve/reject` as **CLI text output** + Mock Executor/Reviewer + basic cost tracking. MVP excludes the full Ink TUI, Slack notifications, and the tray app.
