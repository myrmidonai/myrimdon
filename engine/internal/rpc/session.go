// Package rpc speaks the newline-delimited JSON protocol used to drive an
// external agent executor (e.g. `pi --rpc`, PRD6 §28). One prompt → a stream of
// events → a terminal result line.
package rpc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
)

type Request struct {
	Type   string `json:"type"`
	RunID  string `json:"run_id,omitempty"`
	NodeID string `json:"node_id,omitempty"`
	Task   string `json:"task,omitempty"`
}

type Response struct {
	Type   string `json:"type"`             // "result" is terminal; others are progress events
	Result string `json:"result,omitempty"` // "success"|"failed"
	Error  string `json:"error,omitempty"`
}

// Session is one conversation with an agent peer over an in/out byte stream.
type Session struct {
	w io.Writer
	r *bufio.Scanner
}

func NewSession(w io.Writer, r io.Reader) *Session {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	return &Session{w: w, r: sc}
}

// Prompt sends a prompt and blocks until the peer emits a terminal result line,
// ignoring intermediate (message/tool/...) events.
func (s *Session) Prompt(req Request) (Response, error) {
	req.Type = "prompt"
	line, err := json.Marshal(req)
	if err != nil {
		return Response{}, fmt.Errorf("marshal prompt: %w", err)
	}
	if _, err := s.w.Write(append(line, '\n')); err != nil {
		return Response{}, fmt.Errorf("write prompt: %w", err)
	}
	for s.r.Scan() {
		var resp Response
		if err := json.Unmarshal(s.r.Bytes(), &resp); err != nil {
			continue // skip non-JSON / log lines
		}
		if resp.Type == "result" {
			return resp, nil
		}
	}
	if err := s.r.Err(); err != nil {
		return Response{}, fmt.Errorf("read: %w", err)
	}
	return Response{}, fmt.Errorf("peer closed without a result")
}
