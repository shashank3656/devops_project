package main

import "testing"

func TestReadOnlyPromoteSignalsAtHighestEnv(t *testing.T) {
	req := &PRRequest{Env: "production", Service: "api"}
	freeze, incidents, hints := readOnlyPromoteSignals(req)
	if freeze.Active {
		t.Fatalf("expected no freeze at highest env, got active")
	}
	if len(incidents) != 0 {
		t.Fatalf("expected no incidents slice at highest env")
	}
	if hints == nil || len(hints.Warnings) == 0 {
		t.Fatalf("expected highest-env warning")
	}
}

func TestTargetEnvironmentSignalsEmptyScope(t *testing.T) {
	freeze, incidents := targetEnvironmentSignals(0, "uat", "svc")
	if freeze.Active || len(incidents) != 0 {
		t.Fatalf("expected empty signals for invalid project")
	}
}
