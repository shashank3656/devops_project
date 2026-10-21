package main

import (
	"strings"
	"testing"
)

func TestClassifyRequestPipelineFailedCI(t *testing.T) {
	req := &PRRequest{Status: "in_progress", Env: "dev"}
	status, label, ci := classifyRequestPipeline(req, "apply_failed", true)
	if status != "failed" || !strings.Contains(label, "failed") || ci != "apply failed" {
		t.Fatalf("got status=%q label=%q ci=%q", status, label, ci)
	}
}

func TestClassifyChangePipelineResolved(t *testing.T) {
	status, label, _ := classifyChangePipeline("resolved")
	if status != "success" || label != "Change completed" {
		t.Fatalf("got status=%q label=%q", status, label)
	}
}

func TestDeployIntelHrefFromRepo(t *testing.T) {
	href := deployIntelHrefForRepo("acme/platform-api", "")
	if href != "/deploy-intelligence/acme/platform-api" {
		t.Fatalf("href = %q", href)
	}
}

func TestParseRepoFromPRURL(t *testing.T) {
	owner, name := parseRepoFromPRURL("https://github.com/acme/api/pull/42")
	if owner != "acme" || name != "api" {
		t.Fatalf("owner=%q name=%q", owner, name)
	}
}

func TestRequestPRIsNotVerification(t *testing.T) {
	req := &PRRequest{ID: 1, PRURL: "https://github.com/acme/api/pull/1", Status: "completed", ApplicationID: "ABC1234567"}
	if requestHasVerificationEvidence(req) {
		t.Fatal("a pull request URL must not count as resource verification")
	}
}

func TestObservedDeploymentIsVerification(t *testing.T) {
	original := listDeploymentAttempts
	t.Cleanup(func() { listDeploymentAttempts = original })
	projectID := 9
	listDeploymentAttempts = func(id int, environment string) ([]deploymentAttempt, error) {
		if id != projectID || environment != "dev" {
			t.Fatalf("scope = %d %s", id, environment)
		}
		return []deploymentAttempt{{
			ProjectID:   projectID,
			Environment: "dev",
			CommitSHA:   "abc123",
			ImageDigest: "sha256:artifact",
			State:       "success",
			ObservedAt:  "2026-10-21T12:00:00Z",
		}}, nil
	}
	req := &PRRequest{ID: 1, Env: "dev", ProjectID: &projectID}
	if !requestHasVerificationEvidence(req) {
		t.Fatal("an observed successful deployment should count as verification")
	}
}
