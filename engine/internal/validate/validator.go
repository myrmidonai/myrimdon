// Package validate decides whether produced artifacts are valid (PRD6 §7).
// A node's completion is gated on validation — agents never self-report done (P3).
package validate

import (
	"fmt"

	"github.com/myrmidonai/myrmidon/internal/artifact"
)

type Result struct {
	Passed   bool
	Evidence string
}

type Validator interface {
	Validate(store artifact.Store, relpath string) Result
}

// FileExists is the default automated validator: the artifact must exist and be non-empty.
type FileExists struct{}

func (FileExists) Validate(store artifact.Store, relpath string) Result {
	cs, exists, err := store.Stat(relpath)
	if err != nil {
		return Result{Passed: false, Evidence: "stat error: " + err.Error()}
	}
	if !exists {
		return Result{Passed: false, Evidence: "file does not exist: " + relpath}
	}
	if cs.Size == 0 {
		return Result{Passed: false, Evidence: "file is empty: " + relpath}
	}
	return Result{Passed: true, Evidence: fmt.Sprintf("exists size=%d sha=%s", cs.Size, cs.SHA256)}
}
