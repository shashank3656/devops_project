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

func TestMeChangesRejectsUnauthenticatedWrite(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/me/changes", nil)
	meChangesHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST /api/me/changes without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsRequestApproveRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/devops/requests/1/approve", nil)
	devopsRequestActionHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST approve without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsCloudResourcesRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devops/cloud/resources", nil)
	devopsCloudResourcesHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET cloud inventory without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsCloudAccountsRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devops/cloud/accounts", nil)
	devopsCloudAccountsListHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET cloud accounts without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsCloudAccountCreateRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/devops/cloud/accounts", nil)
	devopsCloudAccountsListHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST cloud accounts without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsOperatorActivityRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devops/operator-activity", nil)
	devopsOperatorActivityHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET operator-activity without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsGuardedActionContextRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devops/guarded-action-context?action=restart", nil)
	devopsGuardedActionContextHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET guarded-action-context without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsEnvironmentCatalogRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/devops/environment-catalog", nil)
	devopsEnvironmentCatalogHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET environment-catalog without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsK8sWorkloadActionsRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/devops/k8s-workload-actions", nil)
	devopsK8sWorkloadActionsHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST k8s-workload-actions without auth = %d, want 401", rec.Code)
	}
}

func TestDevopsCloudAccountTestRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/devops/cloud/accounts/1/test", nil)
	devopsCloudAccountTestHandler(rec, req, 1)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST cloud account test without auth = %d, want 401", rec.Code)
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
