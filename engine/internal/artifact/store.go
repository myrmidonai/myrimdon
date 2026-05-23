// Package artifact is the artifact persistence boundary (PRD6 §15.2): all
// artifact read/write + checksums go through Store. v1 = local FS; later S3.
package artifact

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

type Checksum struct {
	MTimeMs int64  `json:"mtime_ms"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256,omitempty"` // omitted for files > 10MB (PRD6 §12.9)
}

// Store keys are workspace-relative paths.
type Store interface {
	Put(relpath string, content []byte) (Checksum, error)
	Get(relpath string) ([]byte, error)
	Stat(relpath string) (cs Checksum, exists bool, err error)
	Exists(relpath string) bool
}

const sha256MaxBytes = 10 << 20 // 10MB

type Local struct{ base string }

func NewLocal(base string) *Local { return &Local{base: base} }

func (l *Local) path(relpath string) string { return filepath.Join(l.base, relpath) }

func (l *Local) Put(relpath string, content []byte) (Checksum, error) {
	p := l.path(relpath)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return Checksum{}, fmt.Errorf("mkdir: %w", err)
	}
	if err := os.WriteFile(p, content, 0o644); err != nil {
		return Checksum{}, fmt.Errorf("write: %w", err)
	}
	cs, _, err := l.Stat(relpath)
	return cs, err
}

func (l *Local) Get(relpath string) ([]byte, error) {
	return os.ReadFile(l.path(relpath))
}

func (l *Local) Stat(relpath string) (Checksum, bool, error) {
	p := l.path(relpath)
	fi, err := os.Stat(p)
	if os.IsNotExist(err) {
		return Checksum{}, false, nil
	}
	if err != nil {
		return Checksum{}, false, fmt.Errorf("stat: %w", err)
	}
	cs := Checksum{MTimeMs: fi.ModTime().UnixMilli(), Size: fi.Size()}
	if fi.Size() <= sha256MaxBytes {
		b, err := os.ReadFile(p)
		if err != nil {
			return Checksum{}, true, fmt.Errorf("read for sha: %w", err)
		}
		sum := sha256.Sum256(b)
		cs.SHA256 = hex.EncodeToString(sum[:])
	}
	return cs, true, nil
}

func (l *Local) Exists(relpath string) bool {
	_, ok, _ := l.Stat(relpath)
	return ok
}
