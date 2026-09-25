package main

import (
	"strings"
	"testing"
)

func TestMCPWriteToolNames(t *testing.T) {
	names := strings.Join(mcpToolNames(), ",")
	for _, want := range []string{"comment_incident", "request_rollback"} {
		if !strings.Contains(names, want) {
			t.Fatalf("missing write tool %s in %s", want, names)
		}
	}
	listed := strings.Join(mcpWriteToolNames(), ",")
	if listed != "comment_incident,request_rollback" {
		t.Fatalf("write_tools %s", listed)
	}
}

func TestMCPWriteToolsRefuseApply(t *testing.T) {
	if _, err := callMCPTool("comment_incident", map[string]any{"comment": "terraform apply now", "id": 1}); err == nil || !strings.Contains(err.Error(), "will not apply") {
		t.Fatalf("comment must refuse apply, got %v", err)
	}
	if _, err := callMCPToolAs("request_rollback", map[string]any{"reason": "kubectl apply -f prod.yaml", "change_id": 1}, 1); err == nil || !strings.Contains(err.Error(), "will not apply") {
		t.Fatalf("rollback must refuse apply, got %v", err)
	}
	if _, err := callMCPTool("terraform_apply", nil); err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("terraform_apply must stay unknown, got %v", err)
	}
}

func TestMCPWriteToolsRequireUser(t *testing.T) {
	if _, err := callMCPTool("comment_incident", map[string]any{"comment": "looking at INC", "id": 1}); err == nil || !strings.Contains(err.Error(), "signed-in user required") {
		t.Fatalf("comment without user: %v", err)
	}
	if _, err := callMCPTool("request_rollback", map[string]any{"change_id": 1, "reason": "watch failed"}); err == nil || !strings.Contains(err.Error(), "signed-in user required") {
		t.Fatalf("rollback without user: %v", err)
	}
}

func TestMCPGetChangeIncludesBlastAndDrift(t *testing.T) {
	payload := mcpChangeDetail(&changeRequestRecord{Service: "checkout", Environment: "dev", SHA: "abc123def456"})
	if _, ok := payload["blast_radius"]; !ok {
		t.Fatal("blast_radius missing")
	}
	drift, ok := payload["drift"].(liveChangeDrift)
	if !ok {
		t.Fatalf("drift type %T", payload["drift"])
	}
	if drift.CatalogSHA != "abc123def456" {
		t.Fatalf("catalog sha %s", drift.CatalogSHA)
	}
}
