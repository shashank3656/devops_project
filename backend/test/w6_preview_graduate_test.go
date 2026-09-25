package main

import "testing"

func TestPreviewClosedMerged(t *testing.T) {
	closed, merged := previewClosedMerged(map[string]interface{}{"merged": true}, "closed")
	if !closed || !merged {
		t.Fatal("merged close must graduate")
	}
	closed, merged = previewClosedMerged(map[string]interface{}{"merged": false}, "closed")
	if !closed || merged {
		t.Fatal("unmerged close must cancel only")
	}
	closed, merged = previewClosedMerged(map[string]interface{}{}, "opened")
	if closed || merged {
		t.Fatal("open stays live")
	}
}

func TestPreviewGitSHAPrefersMergeCommit(t *testing.T) {
	sha := previewGitSHA(map[string]interface{}{
		"merge_commit_sha": "abc123merged",
		"head":             map[string]interface{}{"sha": "headsha"},
	}, "fallback")
	if sha != "abc123merged" {
		t.Fatalf("%s", sha)
	}
	if previewGitSHA(map[string]interface{}{}, "preview-12") != "preview-12" {
		t.Fatal("fallback")
	}
}

func TestBuildGraduatedPreviewPayload(t *testing.T) {
	payload := buildGraduatedPreviewPayload(previewEnvironment{Repo: "acme/api", PRNumber: 12, ChangeNumber: "CHG1", SHA: "head"}, "abc123", "api", "dev", "oldsha")
	if payload.ChangeType != "standard" || payload.Environment != "dev" || payload.SHA != "abc123" {
		t.Fatalf("%+v", payload)
	}
	if payload.PreviousSHA != "oldsha" || payload.Status != "implemented" {
		t.Fatalf("%+v", payload)
	}
}
