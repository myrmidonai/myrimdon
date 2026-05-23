// Package conversation is the event-sourced ConversationHub (PRD6 §9): channels
// hold an append-only message log; @mentions route to members.
package conversation

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/google/uuid"
	"github.com/myrmidonai/myrmidon/internal/statestore"
)

const eventMessagePosted = "MESSAGE_POSTED"

var mentionRe = regexp.MustCompile(`@([A-Za-z][\w-]*)`)

type Message struct {
	ID        string   `json:"id"`
	ChannelID string   `json:"channel_id"`
	Author    string   `json:"author"`
	Text      string   `json:"text"`
	Mentions  []string `json:"mentions,omitempty"`
}

// ParseMentions extracts @ids from text (unique, first-seen order).
func ParseMentions(text string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range mentionRe.FindAllStringSubmatch(text, -1) {
		if id := m[1]; !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

type Hub struct{ store statestore.StateStore }

func New(store statestore.StateStore) *Hub { return &Hub{store: store} }

// Post appends a message to a channel and returns it (with parsed mentions).
func (h *Hub) Post(ctx context.Context, channelID, author, text string) (Message, error) {
	msg := Message{
		ID:        uuid.NewString(),
		ChannelID: channelID,
		Author:    author,
		Text:      text,
		Mentions:  ParseMentions(text),
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return Message{}, fmt.Errorf("marshal message: %w", err)
	}
	if _, err := h.store.AppendEvent(ctx, statestore.Event{
		ID:             msg.ID,
		Type:           eventMessagePosted,
		IdempotencyKey: eventMessagePosted + ":" + msg.ID,
		PayloadJSON:    string(payload),
	}); err != nil {
		return Message{}, err
	}
	return msg, nil
}

// Messages returns all messages in a channel, in post (seq) order.
func (h *Hub) Messages(ctx context.Context, channelID string) ([]Message, error) {
	events, err := h.store.ReadEvents(ctx, 0)
	if err != nil {
		return nil, err
	}
	var out []Message
	for _, e := range events {
		if e.Type != eventMessagePosted {
			continue
		}
		var m Message
		if err := json.Unmarshal([]byte(e.PayloadJSON), &m); err != nil {
			return nil, fmt.Errorf("unmarshal message %s: %w", e.ID, err)
		}
		if m.ChannelID == channelID {
			out = append(out, m)
		}
	}
	return out, nil
}
