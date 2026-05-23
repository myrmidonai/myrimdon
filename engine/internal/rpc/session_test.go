package rpc

import (
	"bufio"
	"io"
	"testing"
)

func TestSessionPromptReturnsResult(t *testing.T) {
	promptR, promptW := io.Pipe() // caller → peer
	respR, respW := io.Pipe()     // peer → caller

	// Fake agent peer: read the prompt, emit a progress event then a result.
	go func() {
		sc := bufio.NewScanner(promptR)
		sc.Scan() // consume the prompt line
		_, _ = respW.Write([]byte(`{"type":"message","text":"working"}` + "\n"))
		_, _ = respW.Write([]byte(`{"type":"result","result":"success"}` + "\n"))
		_ = respW.Close()
	}()

	s := NewSession(promptW, respR)
	resp, err := s.Prompt(Request{NodeID: "build", Task: "add /health"})
	if err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if resp.Result != "success" {
		t.Fatalf("result: %q", resp.Result)
	}
}

func TestSessionPeerClosesWithoutResult(t *testing.T) {
	promptR, promptW := io.Pipe()
	respR, respW := io.Pipe()
	go func() {
		sc := bufio.NewScanner(promptR)
		sc.Scan()
		_ = respW.Close() // no result
	}()
	s := NewSession(promptW, respR)
	if _, err := s.Prompt(Request{NodeID: "x"}); err == nil {
		t.Fatal("expected error when peer closes without a result")
	}
}
