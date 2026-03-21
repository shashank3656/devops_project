package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

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

func TestParseRFC3339Query(t *testing.T) {
	parsed, ok := parseRFC3339Query(" 2026-03-19T08:30:00Z ")
	if !ok {
		t.Fatal("expected RFC3339 timestamp to be accepted")
	}
	if parsed.UTC().Format(time.RFC3339) != "2026-03-19T08:30:00Z" {
		t.Fatalf("parseRFC3339Query() = %q, want %q", parsed.UTC().Format(time.RFC3339), "2026-03-19T08:30:00Z")
	}

	if _, ok := parseRFC3339Query("not-a-timestamp"); ok {
		t.Fatal("expected invalid timestamp to be rejected")
	}
}

func TestEncodeAuthJSONSetsSafeHeaders(t *testing.T) {
	rec := httptest.NewRecorder()

	encodeAuthJSON(rec, map[string]any{"status": "ok"})

	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want %q", got, "application/json; charset=utf-8")
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want %q", got, "nosniff")
	}
}
