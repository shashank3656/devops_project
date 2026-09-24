package main

import "testing"

func TestNormalizeRepoIdentity(t *testing.T) {
	owner, name := normalizeRepoIdentity("", "acme/infra-live")
	if owner != "acme" || name != "infra-live" {
		t.Fatalf("got %s/%s", owner, name)
	}
	owner, name = normalizeRepoIdentity("acme", "infra-live")
	if owner != "acme" || name != "infra-live" {
		t.Fatalf("got %s/%s", owner, name)
	}
}

func TestRepoIsOnboardedLegacyMismatch(t *testing.T) {
	if repoIsOnboardedLegacy("other", GitHubRepo) {
		t.Fatal("wrong owner should not match")
	}
}

func TestDeployIntelGitHubAccessRequiresToken(t *testing.T) {
	prev := GitHubToken
	GitHubToken = ""
	defer func() { GitHubToken = prev }()
	if deployIntelGitHubAccessAllowed("acme", "infra") {
		t.Fatal("expected false without token")
	}
}
