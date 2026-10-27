package main

import (
	"errors"
	"testing"
)

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

func TestVerifyGitHubRepositoryForOnboardRejectsMissing(t *testing.T) {
	prev := lookupGitHubRepository
	lookupGitHubRepository = func(owner, name string) (string, string, bool, error) {
		return owner, name, false, nil
	}
	defer func() { lookupGitHubRepository = prev }()
	_, _, err := verifyGitHubRepositoryForOnboard("acme", "missing-repo")
	if !errors.Is(err, errGitHubRepoNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestVerifyGitHubRepositoryForOnboardUsesCanonicalName(t *testing.T) {
	prev := lookupGitHubRepository
	lookupGitHubRepository = func(owner, name string) (string, string, bool, error) {
		return "Acme", "infra-live", true, nil
	}
	defer func() { lookupGitHubRepository = prev }()
	owner, name, err := verifyGitHubRepositoryForOnboard("acme", "infra-live")
	if err != nil {
		t.Fatal(err)
	}
	if owner != "Acme" || name != "infra-live" {
		t.Fatalf("got %s/%s", owner, name)
	}
}

func TestLookupGitHubRepositoryLiveWithoutToken(t *testing.T) {
	prev := GitHubToken
	GitHubToken = ""
	defer func() { GitHubToken = prev }()
	_, _, exists, err := lookupGitHubRepositoryLive("acme", "infra")
	if exists || err == nil {
		t.Fatal("missing GitHub token must not create an onboard")
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

func TestDisconnectDeployIntelRepoDoesNotCallGitHub(t *testing.T) {
	called := false
	prevLookup := lookupGitHubRepository
	lookupGitHubRepository = func(owner, name string) (string, string, bool, error) {
		called = true
		return owner, name, false, errors.New("github must not be called")
	}
	defer func() { lookupGitHubRepository = prevLookup }()
	saved := DB
	DB = nil
	defer func() { DB = saved }()
	if err := disconnectDeployIntelRepo("acme", "infra"); err == nil {
		t.Fatal("expected unavailable without database")
	}
	if called {
		t.Fatal("disconnect must not call GitHub")
	}
}

func TestUpdateDeployIntelRepoCatalogWithoutDB(t *testing.T) {
	called := false
	prevLookup := lookupGitHubRepository
	lookupGitHubRepository = func(owner, name string) (string, string, bool, error) {
		called = true
		return owner, name, true, nil
	}
	defer func() { lookupGitHubRepository = prevLookup }()
	saved := DB
	DB = nil
	defer func() { DB = saved }()
	if _, err := updateDeployIntelRepoCatalog("acme", "infra", "acme", "infra", "main"); err == nil {
		t.Fatal("expected unavailable without database")
	}
	if called {
		t.Fatal("same-name catalog edit must not call GitHub")
	}
}
