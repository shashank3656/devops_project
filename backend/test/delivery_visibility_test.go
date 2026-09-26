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
