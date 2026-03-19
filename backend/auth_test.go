package main

import "testing"

func TestNormalizeUserNotificationKind(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "valid normalized", input: "approved", want: "approved"},
		{name: "valid mixed case", input: " Project_Assigned ", want: "project_assigned"},
		{name: "valid update kind", input: "project_access_updated", want: "project_access_updated"},
		{name: "invalid kind", input: "<script>alert(1)</script>", want: ""},
		{name: "unknown kind", input: "pending_request", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeUserNotificationKind(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeUserNotificationKind(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
