package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDevopsUsersHandlerRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devops/users", nil)
	devopsUsersHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing auth GET /api/devops/users = %d, want 401", rec.Code)
	}
}

func TestAdminBreakGlassRejectsBrowserOrigin(t *testing.T) {
	t.Setenv("ADMIN_SECRET", "break-glass")
	t.Setenv("ADMIN_BREAKGLASS_USER_ID", "42")
	req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	req.Header.Set("X-Admin-Secret", "break-glass")
	req.Header.Set("Origin", "http://localhost:3001")
	if _, ok := adminBreakGlassUserID(req); ok {
		t.Fatal("break-glass must not succeed when Origin is set (browser portal)")
	}
}
