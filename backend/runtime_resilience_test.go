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
	if got := base.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("expected JSON content type, got: %q", got)
	}
	if got := base.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("expected nosniff header, got: %q", got)
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

func TestStatusRecorder_SanitizesJSONAPIErrorBody(t *testing.T) {
	base := httptest.NewRecorder()
	rec := &statusRecorder{
		ResponseWriter: base,
		status:         http.StatusBadRequest,
		path:           "/api/test",
		method:         http.MethodPost,
		requestID:      "req-json-1",
	}
	rec.Header().Set("Content-Type", "application/json")

	_, err := rec.Write([]byte(`{"status":"error","error":"<script>alert('x')</script>","cause":"bad <input>"}`))
	if err != nil {
		t.Fatalf("write failed: %v", err)
	}

	body := strings.TrimSpace(base.Body.String())
	if strings.Contains(body, "<script>") {
		t.Fatalf("expected JSON error payload to be sanitized, got: %s", body)
	}
	if !strings.Contains(body, `\u0026lt;script\u0026gt;alert(\u0026#39;x\u0026#39;)\u0026lt;/script\u0026gt;`) {
		t.Fatalf("expected escaped script payload, got: %s", body)
	}
	if !strings.Contains(body, `"cause":"bad \u0026lt;input\u0026gt;"`) {
		t.Fatalf("expected escaped cause payload, got: %s", body)
	}
	if got := base.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("expected JSON content type, got: %q", got)
	}
	if got := base.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("expected nosniff header, got: %q", got)
	}
}
