package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStatusRecorder_NormalizesAPIErrorBody(t *testing.T) {
	base := httptest.NewRecorder()
	rec := &statusRecorder{
		ResponseWriter: base,
		status:         http.StatusMethodNotAllowed,
		path:           "/api/test",
		method:         http.MethodPost,
		requestID:      "req-123",
	}

	_, err := rec.Write([]byte("method not allowed\n"))
	if err != nil {
		t.Fatalf("write failed: %v", err)
	}

	body := strings.TrimSpace(base.Body.String())
	if !strings.Contains(body, `"status":"error"`) {
		t.Fatalf("expected normalized error payload, got: %s", body)
	}
	if !strings.Contains(body, `"error":"method not allowed"`) {
		t.Fatalf("expected normalized error message, got: %s", body)
	}
	if !strings.Contains(body, `"request_id":"req-123"`) {
		t.Fatalf("expected request_id in payload, got: %s", body)
	}
	if got := base.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected JSON content type, got: %q", got)
	}
}

func TestStatusRecorder_EnsuresBodyForEmptyAPIError(t *testing.T) {
	base := httptest.NewRecorder()
	rec := &statusRecorder{
		ResponseWriter: base,
		status:         http.StatusUnauthorized,
		path:           "/api/secure",
		method:         http.MethodGet,
		requestID:      "req-456",
	}
	rec.WriteHeader(http.StatusUnauthorized)
	rec.ensureAPIErrorBody()

	body := strings.TrimSpace(base.Body.String())
	if !strings.Contains(body, `"status":"error"`) {
		t.Fatalf("expected fallback error payload, got: %s", body)
	}
	if !strings.Contains(body, `"error":"Unauthorized"`) {
		t.Fatalf("expected Unauthorized message, got: %s", body)
	}
	if !strings.Contains(body, `"request_id":"req-456"`) {
		t.Fatalf("expected request_id in payload, got: %s", body)
	}
}

func TestStatusRecorder_DoesNotNormalizeNonAPIError(t *testing.T) {
	base := httptest.NewRecorder()
	rec := &statusRecorder{
		ResponseWriter: base,
		status:         http.StatusInternalServerError,
		path:           "/health",
		method:         http.MethodGet,
		requestID:      "req-789",
	}

	_, err := rec.Write([]byte("internal error"))
	if err != nil {
		t.Fatalf("write failed: %v", err)
	}

	body := base.Body.String()
	if body != "internal error" {
		t.Fatalf("expected non-API payload to remain unchanged, got: %q", body)
	}
	if got := base.Header().Get("Content-Type"); got == "application/json" {
		t.Fatalf("expected non-API response not to force JSON content type")
	}
}
