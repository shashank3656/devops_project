package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestNormalizeDashboardPeriod(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "today", input: "today", want: "today"},
		{name: "trimmed week", input: " Week ", want: "week"},
		{name: "month", input: "MONTH", want: "month"},
		{name: "invalid", input: "<script>", want: ""},
		{name: "empty", input: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeDashboardPeriod(tt.input); got != tt.want {
				t.Fatalf("normalizeDashboardPeriod(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeDateOnlyQuery(t *testing.T) {
	gotValue, gotTime, ok := normalizeDateOnlyQuery(" 2026-03-19 ")
	if !ok {
		t.Fatal("expected valid date to be accepted")
	}
	if gotValue != "2026-03-19" {
		t.Fatalf("normalizeDateOnlyQuery() value = %q, want %q", gotValue, "2026-03-19")
	}
	if gotTime.Format("2006-01-02") != "2026-03-19" {
		t.Fatalf("normalizeDateOnlyQuery() time = %q, want %q", gotTime.Format("2006-01-02"), "2026-03-19")
	}

	if _, zeroTime, ok := normalizeDateOnlyQuery("<script>"); ok {
		t.Fatal("expected invalid date to be rejected")
	} else if !zeroTime.Equal(time.Time{}) {
		t.Fatal("expected rejected invalid date to return zero time")
	}
}

func TestEncodeAdminJSONSetsSafeHeaders(t *testing.T) {
	rec := httptest.NewRecorder()

	encodeAdminJSON(rec, map[string]any{"status": "ok"})

	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want %q", got, "application/json; charset=utf-8")
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want %q", got, "nosniff")
	}
}
