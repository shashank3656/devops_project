package main

import "testing"

func TestInferEnvironmentsFromPath(t *testing.T) {
	if got := inferEnvironmentsFromPath("infra/prod/main.tf"); len(got) != 1 || got[0] != "prod" {
		t.Fatalf("prod path = %v", got)
	}
	if got := inferEnvironmentsFromPath("k8s/dev/api.yaml"); len(got) != 1 || got[0] != "dev" {
		t.Fatalf("dev path = %v", got)
	}
	if got := inferEnvironmentsFromPath("frontend/pages/home.tsx"); len(got) != 0 {
		t.Fatalf("app path should have no env, got %v", got)
	}
}

func TestBuildChangeBriefHeadlineAndRisk(t *testing.T) {
	brief := prImpactBrief{
		Environment: "prod",
		FileCount:   3,
		Files: []prImpactFile{
			{Path: "infra/prod/iam.tf", Category: "iam"},
			{Path: "infra/prod/main.tf", Category: "terraform"},
			{Path: "infra/uat/main.tf", Category: "terraform"},
		},
		Factors: []prImpactFactor{
			{Key: "prod-branch", Label: "Merges to a production branch", Severity: "high", Weight: 12, Detail: "Base branch is main."},
			{Key: "sensitive-files", Label: "Touches operational files", Severity: "high", Weight: 14, Detail: "2 files affect infra, access, or runtime config."},
			{Key: "docs-only", Label: "Docs or tests only", Severity: "low", Weight: -15, Detail: "ignored"},
		},
	}
	out := buildChangeBrief(brief)
	if !out.MultiEnv {
		t.Fatal("expected multi_env from prod + uat paths")
	}
	if out.Headline == "" || out.Headline == "No file categories yet" {
		t.Fatalf("headline = %q", out.Headline)
	}
	if len(out.Changing) < 2 {
		t.Fatalf("changing = %+v", out.Changing)
	}
	if out.Changing[0].Key != "iam" {
		t.Fatalf("first changing group should be iam, got %s", out.Changing[0].Key)
	}
	if len(out.RiskBecause) == 0 {
		t.Fatal("expected risk_because")
	}
	for _, reason := range out.RiskBecause {
		if reason == "ignored" {
			t.Fatal("negative-weight factor should be omitted")
		}
	}
}

func TestBuildChangeBriefEmptyFilesFallsBack(t *testing.T) {
	brief := prImpactBrief{FileCount: 4, BlastRadius: []string{"terraform", "team-platform"}}
	out := buildChangeBrief(brief)
	if len(out.Changing) != 1 || out.Changing[0].Key != "terraform" {
		t.Fatalf("fallback changing = %+v", out.Changing)
	}
	if out.Headline == "No file categories yet" {
		t.Fatalf("expected file-count or category headline, got %q", out.Headline)
	}
}
