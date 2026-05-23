package backend

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/rpc"
	"github.com/myrmidonai/myrmidon/internal/workflow"
)

// TestHelperProcess is re-executed by the tests below as a fake `pi --rpc`
// agent peer (only when MYRMIDON_HELPER=1). It reads one prompt and replies
// with a result line, then exits before the test framework prints anything.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("MYRMIDON_HELPER") != "1" {
		return
	}
	sc := bufio.NewScanner(os.Stdin)
	if sc.Scan() {
		var req rpc.Request
		_ = json.Unmarshal(sc.Bytes(), &req)
		result := "success"
		if req.Task == "make-it-fail" {
			result = "failed"
		}
		fmt.Fprintf(os.Stdout, `{"type":"result","result":%q}`+"\n", result)
	}
	os.Exit(0)
}

func helperExecutor() *SubprocessExecutor {
	return &SubprocessExecutor{
		Name: os.Args[0],
		Args: []string{"-test.run=TestHelperProcess"},
		Env:  []string{"MYRMIDON_HELPER=1"},
	}
}

func TestSubprocessExecutorSuccess(t *testing.T) {
	res, err := helperExecutor().Execute(context.Background(), "run1", workflow.Node{ID: "build", Name: "add /health"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res != "success" {
		t.Fatalf("result: %q", res)
	}
}

func TestSubprocessExecutorFailure(t *testing.T) {
	res, err := helperExecutor().Execute(context.Background(), "run1", workflow.Node{ID: "build", Name: "make-it-fail"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res != "failed" {
		t.Fatalf("result: %q", res)
	}
}
