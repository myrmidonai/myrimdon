package artifact

import "testing"

func TestPutGetStat(t *testing.T) {
	s := NewLocal(t.TempDir())
	cs, err := s.Put("sub/a.txt", []byte("hello"))
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if cs.Size != 5 || cs.SHA256 == "" {
		t.Fatalf("checksum: %+v", cs)
	}

	got, err := s.Get("sub/a.txt")
	if err != nil || string(got) != "hello" {
		t.Fatalf("Get: %q %v", got, err)
	}

	cs2, exists, err := s.Stat("sub/a.txt")
	if err != nil || !exists {
		t.Fatalf("Stat: exists=%v err=%v", exists, err)
	}
	if cs2.SHA256 != cs.SHA256 {
		t.Fatalf("sha mismatch between Put and Stat")
	}
}

func TestExistsAndChange(t *testing.T) {
	s := NewLocal(t.TempDir())
	if s.Exists("nope.txt") {
		t.Fatal("missing file should not exist")
	}
	cs1, _ := s.Put("f.txt", []byte("one"))
	cs2, _ := s.Put("f.txt", []byte("two-different"))
	if cs1.SHA256 == cs2.SHA256 {
		t.Fatal("sha should change with content")
	}
	if !s.Exists("f.txt") {
		t.Fatal("file should exist after Put")
	}
}
