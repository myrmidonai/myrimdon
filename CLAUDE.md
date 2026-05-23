# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

The project is being **rebuilt from scratch against PRD6** (the previous TS scaffold was intentionally deleted; it survives only in git history). **M0 (Foundation) is implemented and merged to `dev`.**

- **`dev`** is the active development branch — do all code work here.
- **`main`** holds the docs/specs (PRD6, plans) as the stable line.
- What exists today: a Go control-plane + runner that register over a Connect/gRPC network protocol, a SQLite event-log `StateStore`, and a `myrmidon status` CLI. See "Repo layout" below.

## Source-of-Truth Documents

| Doc | Location | Treat as |
|-----|----------|----------|
| **`PRD6.md`** | repo root | **The single authoritative spec.** Build to this. |
| `PRD4.md` / `PRD5.md` | `RFC/` | Historical inputs. PRD6 inherits PRD4's execution core and promotes PRD5's abstractions; see PRD6 §24 for the override list. |
| `RFC_260523.md`, `PRD1/2/3.md`, `partyA.prd.md` | `RFC/` | Earlier historical inputs. |
| Implementation plans | `docs/superpowers/plans/` | Bite-sized milestone plans (e.g. `2026-05-23-m0-foundation.md`). |

If anything here disagrees with `PRD6.md`, **PRD6 wins** — and update this file.

## What Myrmidon Is

A **general-purpose autonomous workflow runtime** — not a pipeline. Users declare a desired world-state (a workflow DAG); the runtime continuously drives reality toward it and maintains consistency. Software development (`software-dev-agile`) is just one built-in template; the kernel knows no domain vocabulary.

> CI/CD asks "what step are we on?" Myrmidon asks "is the world the shape I expect?"

**Differentiation (PRD6 §26):** others run one-shot agent tasks; Myrmidon maintains a verifiable, reproducible, auditable world-state — failure converges, completion is decided by validators (never self-reported).

## Tech Stack & Commands

**Language ADR (PRD6 §4 — supersedes PRD4's TS decision):** the **engine (control plane + runner) and CLI are Go**. There is **no TS code DSL**; workflows are authored as JSON/YAML + (later) a visual editor + AI generation, all compiling to `WorkflowDef` JSON (JSON is the single truth). A TS SDK + **Vite/React** web UI (not Next.js) come in later milestones as thin clients over the network protocol.

- Network contract: **protobuf in `schema/`** → codegen via **buf + Connect** (`connectrpc.com/connect`).
- Persistence: **pure-Go SQLite** (`modernc.org/sqlite`, no cgo) behind the `StateStore` interface; migrations via **goose** (embedded), queries via **sqlc**.

All Go work lives in **`./engine`**. The root `Makefile` targets work on Linux/macOS/CI; on **Windows (no `make`)** run the raw equivalents shown:

```bash
make gen     # = (cd schema && buf generate) ; (cd engine && sqlc generate)
make test    # = cd engine && go test ./...
make build   # = cd engine && go build ./cmd/...
make tidy    # = cd engine && go mod tidy

cd engine && go test ./internal/statestore/ -run TestIdempotentAppend -v   # single test
```

**One-time tool install** (Go-installed; `$(go env GOPATH)/bin` must be on PATH):

```bash
go install github.com/bufbuild/buf/cmd/buf@latest
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install connectrpc.com/connect/cmd/protoc-gen-connect-go@latest
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install github.com/pressly/goose/v3/cmd/goose@latest
```

**CN network:** this machine uses `go env -w GOPROXY=https://goproxy.cn,direct GOSUMDB=off` (sum.golang.org TLS times out otherwise).

**Run locally (from `./engine`):** `go run ./cmd/controlplane` (listens `127.0.0.1:9100`, env `MYRMIDON_CP_ADDR`/`MYRMIDON_DB`); `go run ./cmd/runner` (registers + heartbeats, env `MYRMIDON_CP_URL`/`MYRMIDON_RUNNER_ID`); `go run ./cmd/myrmidon status`.

## Repo Layout

Polyglot monorepo. The Go module is rooted at `/engine` (module path stays `github.com/myrmidonai/myrmidon`, so package imports are `github.com/myrmidonai/myrmidon/internal/...`). `/schema` is shared (Go + TS both codegen from it). `/web`, `/sdk`, `/desktop` are placeholders for later milestones.

```
schema/                      SHARED protobuf contract (buf.yaml, buf.gen.yaml, proto/myrmidon/v1/control.proto)
engine/                      Go module (control-plane + runner + cli)
  go.mod  sqlc.yaml
  gen/                       GENERATED Connect/proto Go (do not hand-edit; run `make gen`)
  internal/statestore/       StateStore iface + SQLite impl; migrations/ (goose), queries/ (sqlc), db/ (generated)
  internal/registry/         RunnerRegistry — runner domain logic, projected from the event log
  internal/server/           Connect RunnerService handler (adapts registry; no persistence logic)
  internal/runneragent/      runner-side register + heartbeat client
  internal/integration/      cross-component gate tests
  cmd/controlplane/          control-plane binary (StateStore + registry + Connect server over h2c)
  cmd/runner/                runner binary
  cmd/myrmidon/              CLI (`status`)
web/                         placeholder — Vite/React SPA (visual editor + chat), M2/M3
sdk/                         placeholder — TS SDK (emits WorkflowDef JSON), optional/later
desktop/                     placeholder — Tauri/Electron shell embedding the Go binaries, later
```

**Boundary discipline (PRD6 §28, learned from the DeepSeek-TUI "god-crate"):** each package has one responsibility — `statestore` = persistence only, `registry` = domain logic only (talks to `StateStore`, never raw SQL), `server` = RPC mapping only, `cmd/*` = thin wiring. Keep it that way.

## Architecture: The Big Picture (PRD6)

**One architecture, three deployment profiles** (`desktop` / `self-hosted` / `cloud`). Desktop = an embedded "tenant of one"; v1→v2 only relocates the control plane to the cloud (zero rewrite). **Executors always run locally** in every profile.

- **Control plane** (sole state authority, P1) is **networked** (Connect/gRPC), not a single Unix-socket process. v1: desktop process; v2: cloud. Components: RuntimeKernel/StateStore, WorkflowEngine (static DAG), Scheduler (per-run lease + **fencing token**, real from day one), ReconciliationLoop, ValidatorBus, ConversationHub, digital-human agents.
- **Machine runners** (1..N, cross-machine) host **executor agents** and an `ArtifactStore`; they register with the control plane.
- **Two agent classes:** *executor agents* — ephemeral, stateless, one workflow node then destroyed (P5); *digital-human agents* — long-lived members with persistent memory, `@mention`-able, configurable action policy (`workflow-only` default). Only members are `@mention`ed, never executors.

### Core principles (PRD6 §2 — internalize before changing behavior)
- **P1** Control plane is the sole authority on world-state; agents only *propose* artifacts.
- **P2** Artifacts are the only truth (not memory/summaries/agent claims).
- **P3** Validation decides completion; humans are first-class validators and override automated ones.
- **P4** Continuous reconciliation; upstream change → downstream `stale` + pause. **`stale` never auto-triggers re-execution.**
- **P5** Executor workers are stateless/ephemeral (does NOT constrain digital-human agents).
- **P6** Bounded autonomy; on retry exhaustion → `pause_for_human` (not abort); structured feedback + similarity detection.

### Event sourcing is the foundation (PRD6 §15)
Append-only `events` table (ordered by autoincrement `seq`) is the single truth; SQLite projections are a rebuildable cache. Idempotency key `INSERT OR IGNORE` dedups retries/rescans. **Per-run single writer + fencing token** (not global single writer) from day one. The **World Reconstruction Test** is a release gate. *(M0 implements the append-only log + idempotency; the M0 `RunnerRegistry.List` is already a pure event-log projection.)*

### Authoring (PRD6 §8) & Kernel vs Template (§7.4)
JSON/YAML + visual editor + AI generation → `WorkflowDef` JSON; **JSON is the sole truth, execution stays a static DAG** (authoring may be dynamic; runtime is not). The kernel is domain-agnostic — **no domain words (coder/port/DOM Contract) in the kernel**; domain content lives only in templates. Adding a domain = a new template, zero kernel changes.

### Four platform abstractions — REAL in v1 (PRD6 §15.2)
Because v1 already has a networked control plane + cross-machine runners, these are real implementations (not no-ops). **Never let business code touch raw SQL/FS/spawn directly — go through:** `StateStore` (SQLite→Postgres), `ArtifactStore` (local FS / S3), `ExecutionBackend` (local spawn → remote runner), `Scheduler` (per-run lease + fencing).

## Hard Anti-Patterns (PRD6 §P7) — never introduce, even "helpfully"
| Forbidden | Correct approach |
|-----------|-----------------|
| LLM decides workflow control flow | Structure is static before start; chat/AI only *author* it |
| Agent self-reports "task done" | Validators decide; artifacts are truth |
| Relying on long session/memory (executors) | Stateless executor, minimal injected context |
| `stale` auto-triggers re-execution | `stale` only marks; scheduler/human decides |
| Infinite retry | Bounded retry + similarity detection + escalate |
| "Visualization is truth" (n8n) | JSON is sole truth; canvas is a projection |
| Domain words in the kernel | Domain content only in templates |
| Business code touching SQL/FS/spawn directly | Go through StateStore / ArtifactStore / ExecutionBackend / Scheduler |
| A function hardcoding a deployment profile's specifics | Use the abstraction; switch impl by profile |

## Roadmap & Open Decisions

Milestones (PRD6 §21): **M0 ✅ done** → M1 static execution core (PRD4 MVP on the new base) → M2 members + IM channels → M3 authoring surfaces → M4 multi-runner + real executors → M5 cloud profile. M1's first real executor adapter will target **`pi --rpc`** (PRD6 §28).

**Open strategic decisions before M1 (PRD6 §27):** **R1** wedge vs full-v1 scope; **R2** build M1's durable-execution core on Temporal/LangGraph vs all-Go-from-scratch (this directly shapes M1); **R3** primary market. M1 is gated on R2 — settle it first.
