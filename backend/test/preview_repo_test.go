package main

import "testing"

func TestNormalizePreviewRepo(t *testing.T) {
	got, err := normalizePreviewRepo(" acme/api.git ")
	if err != nil || got != "acme/api" {
		t.Fatalf("got %q %v", got, err)
	}
	got, err = normalizePreviewRepo("https://github.com/acme/api/pull/12")
	if err != nil || got != "acme/api" {
		t.Fatalf("url got %q %v", got, err)
	}
	if _, err := normalizePreviewRepo("just-a-name"); err == nil {
		t.Fatal("owner/name is required")
	}
	if _, err := normalizePreviewRepo("acme/api?token=secret"); err == nil {
		t.Fatal("secrets must be rejected")
	}
	if _, err := normalizePreviewRepo("../etc/passwd"); err == nil {
		t.Fatal("path segments must be rejected")
	}
}

func TestUpdatePreviewRepoWithoutDB(t *testing.T) {
	saved := DB
	DB = nil
	defer func() { DB = saved }()
	if _, err := updatePreviewRepo(1, "acme/api"); err == nil {
		t.Fatal("expected unavailable without DB")
	}
}
