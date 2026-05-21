# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Myrmidon** is a CLI/TUI tool that acts as an AI agent orchestrator for software development workflows. It plays the role of a contractor (乙方) that collects client (甲方) requirements and internally coordinates specialized AI agents (PM, Architect, Coder, QA, Security, UI) to deliver software projects.

The project is currently in the PRD phase. The canonical requirements document is `partyA.prd.md`.

## Architecture Vision

### Core Design Principle

The orchestration workflow is **non-LLM-driven** (hardcoded state machine, not free-form AI). Each agent node has fixed:
- Input format and validation
- Executor and execution scope
- Authorized actions / forbidden actions
- Output artifacts
- Completion report format

The orchestrator polls (configurable interval) to advance the workflow automatically.

### Agent Roles

| Agent | Responsibility |
|---|---|
| orchestrator | Client-facing interface; internal workflow coordinator; status checker |
| pm | Wireframes, PRD, epics/sprints planning |
| arch | Technical review, detailed design, task breakdown |
| coder(n) | SQL design, API design, implementation, bug fixes |
| qa | Test case generation, testing, issue reporting |
| security | Security review |
| ui | UI/UX design |

### File-Based State

Two categories of documents drive recovery and status checking:
- **Project docs** (committed to git): backlog, epics, sprints, tasks, issues, prototypes, design docs, architecture diagrams, SQL/API design
- **Runtime docs** (not committed): agent execution state, logs, results — used for crash recovery and live status

Task and issue references use the format `task-xxid@dir/xxxx.md` and `issues-xxid@dir/xxxx.md`.

### Key Workflow Stages (fixed order, configurable)

1. Requirements gathering (client ↔ orchestrator)
2. Requirement review (PM) + Technical review (Arch)
3. Wireframe + PRD → multi-round review
4. Detailed design → multi-round review
5. UI design → client confirmation
6. Sprint/epic planning → task breakdown
7. Parallel development (SQL, API, test cases generated first)
8. QA testing → bug fix loop
9. Sprint delivery → client confirmation (with configurable timeout/auto-pass rules)

### Multi-Runtime Support

Phase 1: Claude Code. Future: opencode, Kimi Codex, Gemini CLI, etc.

## Tech Stack Decision (TBD)

Three options under consideration in the PRD:
- **Node.js** — enables `npx xxx install` distribution
- **Python**
- **Go**

No implementation exists yet. When the stack is chosen, update this file with build/test/lint commands.

## Key Design Constraints

- Tasks must be small enough that each agent invocation avoids context window compression.
- A context-compression hook should be available to preserve critical state if compression occurs.
- The system should support IM integration (Slack, 企业微信, etc.) so human collaborators can participate remotely without being at their computer.
- Client timeout rules are configurable (e.g., auto-approve after 10 minutes during off-hours).
