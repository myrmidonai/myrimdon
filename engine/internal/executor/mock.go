// Package executor provides node executors. Mock is a deterministic, fixture-driven
// executor for tests (PRD6 §12.12) — no real AI/subprocess.
package executor

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/myrmidonai/myrmidon/internal/artifact"
)

type Mock struct {
	FixturesDir string
	Store       artifact.Store
}

type fixture struct {
	Files  map[string]string `json:"files"`
	Result string            `json:"result"`
}

// Run writes the fixture's files via the Store and returns its result.
// A missing fixture means a no-op node that succeeds.
func (m *Mock) Run(nodeID string) (result string, written []string, err error) {
	path := filepath.Join(m.FixturesDir, nodeID+".json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "success", nil, nil
	}
	if err != nil {
		return "", nil, fmt.Errorf("read fixture %s: %w", path, err)
	}
	var fx fixture
	if err := json.Unmarshal(data, &fx); err != nil {
		return "", nil, fmt.Errorf("parse fixture %s: %w", path, err)
	}
	for rel, content := range fx.Files {
		if _, err := m.Store.Put(rel, []byte(content)); err != nil {
			return "", nil, fmt.Errorf("write artifact %s: %w", rel, err)
		}
		written = append(written, rel)
	}
	result = fx.Result
	if result == "" {
		result = "success"
	}
	return result, written, nil
}
