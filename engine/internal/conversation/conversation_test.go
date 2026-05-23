package conversation

import (
	"context"
	"testing"

	"github.com/myrmidonai/myrmidon/internal/statestore"
)

func TestParseMentions(t *testing.T) {
	got := ParseMentions("hey @DevAgent and @Qa, also @DevAgent again")
	if len(got) != 2 || got[0] != "DevAgent" || got[1] != "Qa" {
		t.Fatalf("mentions: %v", got)
	}
	if len(ParseMentions("no mentions here")) != 0 {
		t.Fatal("expected no mentions")
	}
}

func TestPostAndList(t *testing.T) {
	ctx := context.Background()
	store, err := statestore.OpenSQLite(":memory:")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	h := New(store)

	_, _ = h.Post(ctx, "c1", "alice", "hello")
	m2, err := h.Post(ctx, "c1", "alice", "@DevAgent build it")
	if err != nil {
		t.Fatalf("Post: %v", err)
	}
	_, _ = h.Post(ctx, "c2", "bob", "different channel")

	msgs, err := h.Messages(ctx, "c1")
	if err != nil || len(msgs) != 2 {
		t.Fatalf("c1 messages: %v len=%d", err, len(msgs))
	}
	if msgs[1].Text != "@DevAgent build it" {
		t.Fatalf("message order/text: %+v", msgs)
	}
	if len(m2.Mentions) != 1 || m2.Mentions[0] != "DevAgent" {
		t.Fatalf("mentions: %v", m2.Mentions)
	}
}
