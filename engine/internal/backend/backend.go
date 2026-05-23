// Package backend dispatches node execution to an external agent process
// (PRD6 §15.2 ExecutionBackend). v1 = local subprocess speaking JSON-RPC over
// stdio (the seam to `pi --rpc`, claude-code, etc.); v2 = remote runner; v3 = K8s.
package backend

import (
	"context"
	"fmt"
	"os"
	"os/exec"

	"github.com/myrmidonai/myrmidon/internal/rpc"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// ExecutionBackend runs a node and reports a result. Identical in shape to
// engine.NodeExecutor — a backend IS the executor the engine drives.
type ExecutionBackend interface {
	Execute(ctx context.Context, runID string, node workflow.Node) (result string, err error)
}

// SubprocessExecutor spawns a command (e.g. `pi --rpc`) and drives it over
// newline-delimited JSON-RPC, returning the peer's terminal result.
type SubprocessExecutor struct {
	Name string   // command, e.g. "pi"
	Args []string // e.g. ["--rpc"]
	Env  []string // extra "KEY=VAL" entries appended to os.Environ()
}

func (s *SubprocessExecutor) Execute(ctx context.Context, runID string, node workflow.Node) (string, error) {
	cmd := exec.CommandContext(ctx, s.Name, s.Args...)
	cmd.Env = append(os.Environ(), s.Env...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start %s: %w", s.Name, err)
	}

	sess := rpc.NewSession(stdin, stdout)
	resp, perr := sess.Prompt(rpc.Request{RunID: runID, NodeID: node.ID, Task: node.Name})
	_ = stdin.Close()
	_ = cmd.Wait()

	if perr != nil {
		return "", perr
	}
	if resp.Result == "failed" {
		return "failed", nil
	}
	return "success", nil
}
