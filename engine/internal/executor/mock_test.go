package executor

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/artifact"
)

func TestMockWritesFixtureFiles(t *testing.T) {
	fixDir := t.TempDir()
	store := artifact.NewLocal(t.TempDir())
	fx := `{"files":{"src/api.go":"package api"},"result":"success"}`
	if err := os.WriteFile(filepath.Join(fixDir, "build.json"), []byte(fx), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	m := &Mock{FixturesDir: fixDir, Store: store}
	res, written, err := m.Run("build")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res != "success" || len(written) != 1 {
		t.Fatalf("res=%q written=%v", res, written)
	}
	if !store.Exists("src/api.go") {
		t.Fatal("artifact not written")
	}
	got, _ := store.Get("src/api.go")
	if string(got) != "package api" {
		t.Fatalf("content: %q", got)
	}
}

func TestMockMissingFixtureDefaultsSuccess(t *testing.T) {
	m := &Mock{FixturesDir: t.TempDir(), Store: artifact.NewLocal(t.TempDir())}
	res, written, err := m.Run("nonexistent")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res != "success" || len(written) != 0 {
		t.Fatalf("res=%q written=%v", res, written)
	}
}
