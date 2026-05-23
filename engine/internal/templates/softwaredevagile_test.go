package templates

import "testing"

func TestSoftwareDevAgileValid(t *testing.T) {
	def := SoftwareDevAgile()
	if err := def.Validate(); err != nil {
		t.Fatalf("template invalid: %v", err)
	}
	// fork: sprint-plan fans out to two coders
	if got := def.Outgoing("sprint-plan"); len(got) != 2 {
		t.Fatalf("sprint-plan should fork to 2 coders, got %d", len(got))
	}
	// join: integrate gathers both coders
	if got := def.Incoming("integrate"); len(got) != 2 {
		t.Fatalf("integrate should join 2 coders, got %d", len(got))
	}
}
