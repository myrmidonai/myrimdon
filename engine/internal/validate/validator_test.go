package validate

import (
	"testing"

	"github.com/myrmidonai/myrmidon/internal/artifact"
)

func TestFileExistsValidator(t *testing.T) {
	s := artifact.NewLocal(t.TempDir())
	v := FileExists{}

	if v.Validate(s, "missing.txt").Passed {
		t.Fatal("missing file should not pass")
	}
	if _, err := s.Put("empty.txt", []byte("")); err != nil {
		t.Fatalf("Put empty: %v", err)
	}
	if v.Validate(s, "empty.txt").Passed {
		t.Fatal("empty file should not pass")
	}
	if _, err := s.Put("ok.txt", []byte("data")); err != nil {
		t.Fatalf("Put ok: %v", err)
	}
	res := v.Validate(s, "ok.txt")
	if !res.Passed {
		t.Fatalf("non-empty file should pass; evidence=%q", res.Evidence)
	}
}
