package main

import (
	"strings"
	"testing"
	"time"
)

func TestPlanVsPRMismatch(t *testing.T) {
	if !planVsPRMismatch(2, 12) {
		t.Fatal("expected plan 2 / PR 12 to mismatch")
	}
	if planVsPRMismatch(4, 6) {
		t.Fatal("similar sizes should not mismatch")
	}
	if planVsPRMismatch(0, 12) {
		t.Fatal("missing plan count should not mismatch")
	}
}

func TestAttachPlanDeltaAddsDestroyFactor(t *testing.T) {
	brief := prImpactBrief{
		FileCount: 14,
		Files:     []prImpactFile{{Path: "infra/prod/main.tf", Category: "terraform"}},
	}
	factors := attachPlanDelta(&brief, &PRRequest{TerraformPlanOutput: samplePlan})
	if brief.PlanDelta == nil || !brief.PlanDelta.HasDestroy {
		t.Fatal("expected plan delta on brief")
	}
	found := false
	for _, factor := range factors {
		if factor.Key == "plan-destroy" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected plan-destroy factor, got %+v", factors)
	}
}

func TestBuildPlanDeltaDestroyAndMismatch(t *testing.T) {
	destroy := buildPlanDelta(&PRRequest{TerraformPlanOutput: samplePlan}, prImpactBrief{FileCount: 4})
	if destroy == nil || !destroy.HasDestroy || destroy.Mismatch {
		t.Fatalf("expected destroy-only delta, got %+v", destroy)
	}
	mismatch := buildPlanDelta(
		&PRRequest{TerraformPlanOutput: "Plan: 2 to add, 0 to change, 0 to destroy.\n"},
		prImpactBrief{FileCount: 12, Files: []prImpactFile{{Path: "infra/prod/main.tf", Category: "terraform"}}},
	)
	if mismatch == nil || !mismatch.Mismatch || mismatch.HasDestroy {
		t.Fatalf("expected plan 2 / PR 12 mismatch, got %+v", mismatch)
	}
	if !strings.Contains(mismatch.Summary, "plan 2 / PR 12 files") {
		t.Fatalf("summary = %q", mismatch.Summary)
	}
}

func TestPathMatchesRiskGlob(t *testing.T) {
	if !pathMatchesRiskGlob("infra/prod/iam.tf", "infra/prod/**") {
		t.Fatal("prefix glob should match")
	}
	if pathMatchesRiskGlob("infra/dev/iam.tf", "infra/prod/**") {
		t.Fatal("other env should not match prod glob")
	}
	if !pathMatchesRiskGlob("charts/api/values.yaml", "*/values.yaml") {
		t.Fatal("filepath glob should match")
	}
	if !pathMatchesRiskGlob("cluster-secret.yaml", "secret") {
		t.Fatal("substring glob should match")
	}
}

func TestFileConflictPrefixAndOverlap(t *testing.T) {
	if got := fileConflictPrefix("infra/prod/main.tf"); got != "infra/prod" {
		t.Fatalf("prefix = %q", got)
	}
	left := collectConflictPrefixes([]prImpactFile{
		{Path: "infra/prod/main.tf", Category: "terraform"},
		{Path: "docs/README.md", Category: "docs"},
	})
	right := collectConflictPrefixes([]prImpactFile{
		{Path: "infra/prod/iam.tf", Category: "iam"},
	})
	if len(left) != 1 || left[0] != "infra/prod" {
		t.Fatalf("left prefixes = %v", left)
	}
	if !prefixesOverlap(left, right) {
		t.Fatal("expected overlapping prefixes")
	}
}

func TestAttachOpenPRConflicts(t *testing.T) {
	events := []repoDeployEvent{
		{
			PRNumber: 41,
			Impact:   prImpactBrief{Files: []prImpactFile{{Path: "infra/prod/main.tf", Category: "terraform"}}},
			OpenPR:   &deployIntelOpenPRMeta{},
		},
		{
			PRNumber: 44,
			Impact:   prImpactBrief{Files: []prImpactFile{{Path: "infra/prod/iam.tf", Category: "iam"}}},
			OpenPR:   &deployIntelOpenPRMeta{},
		},
		{
			PRNumber: 50,
			Impact:   prImpactBrief{Files: []prImpactFile{{Path: "frontend/pages/home.tsx", Category: "code"}}},
			OpenPR:   &deployIntelOpenPRMeta{},
		},
	}
	attachOpenPRConflicts(events)
	if len(events[0].OpenPR.ConflictsWith) != 1 || events[0].OpenPR.ConflictsWith[0] != 44 {
		t.Fatalf("#41 conflicts = %v", events[0].OpenPR.ConflictsWith)
	}
	if len(events[1].OpenPR.ConflictsWith) != 1 || events[1].OpenPR.ConflictsWith[0] != 41 {
		t.Fatalf("#44 conflicts = %v", events[1].OpenPR.ConflictsWith)
	}
	if len(events[2].OpenPR.ConflictsWith) != 0 {
		t.Fatalf("#50 should not conflict, got %v", events[2].OpenPR.ConflictsWith)
	}
}

func TestFormatHighRiskOpenPRDigestLine(t *testing.T) {
	ev := repoDeployEvent{
		PRNumber:    42,
		Title:       "ignore me",
		PRURL:       "https://github.com/acme/app/pull/42",
		ChangeBrief: &deployIntelChangeBrief{Headline: "IAM · prod"},
	}
	got := formatHighRiskOpenPRDigestLine("acme", "app", ev)
	for _, needle := range []string{"acme/app", "#42", "IAM · prod", "https://github.com/acme/app/pull/42"} {
		if !strings.Contains(got, needle) {
			t.Fatalf("digest line %q missing %q", got, needle)
		}
	}
}

func TestFindSimilarPastMergesAndLaterRevert(t *testing.T) {
	older := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	middle := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	newer := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	history := []repoDeployEvent{
		{
			RepoOwner: "acme", RepoName: "infra", PRNumber: 10, Title: "IAM prod change",
			RiskLevel: "high", Score: 80, MergedAt: older,
			Impact: prImpactBrief{Files: []prImpactFile{{Path: "infra/prod/iam.tf", Category: "iam"}}},
		},
		{
			RepoOwner: "acme", RepoName: "infra", PRNumber: 11, Title: `Revert "IAM prod change"`,
			RiskLevel: "medium", Score: 40, MergedAt: middle, HeadBranch: "revert-10",
			Impact: prImpactBrief{Files: []prImpactFile{{Path: "infra/prod/iam.tf", Category: "iam"}}},
		},
		{
			RepoOwner: "acme", RepoName: "app", PRNumber: 99, Title: "frontend only",
			RiskLevel: "low", Score: 10, MergedAt: older,
			Impact: prImpactBrief{Files: []prImpactFile{{Path: "frontend/pages/home.tsx", Category: "code"}}},
		},
	}
	brief := prImpactBrief{
		PRNumber: 20,
		Files:    []prImpactFile{{Path: "infra/prod/policy.tf", Category: "iam"}},
	}
	got := findSimilarPastMerges(history, brief, "acme", "infra", 20, newer)
	if len(got) == 0 || got[0].PRNumber != 10 {
		t.Fatalf("expected similar #10, got %+v", got)
	}
	if got[0].LaterRevert == nil || got[0].LaterRevert.PRNumber != 11 {
		t.Fatalf("expected later revert #11, got %+v", got[0].LaterRevert)
	}
	for _, item := range got {
		if item.PRNumber == 99 {
			t.Fatal("other repo should not appear")
		}
	}
}

func TestIsRevertOf(t *testing.T) {
	original := repoDeployEvent{PRNumber: 10, Title: "IAM prod change"}
	if !isRevertOf(repoDeployEvent{Title: `Revert "IAM prod change"`, HeadBranch: "revert-10"}, original) {
		t.Fatal("expected revert by title")
	}
	if isRevertOf(repoDeployEvent{Title: "follow-up IAM tweak"}, original) {
		t.Fatal("non-revert should not match")
	}
}

func TestNormalizeAckReasons(t *testing.T) {
	got := normalizeAckReasons([]string{"  prod IAM  ", "", "prod IAM", "no plan review"})
	if len(got) != 2 || got[0] != "prod IAM" || got[1] != "no plan review" {
		t.Fatalf("reasons = %#v", got)
	}
	if got := defaultAckReasons(nil, &deployIntelChangeBrief{RiskBecause: []string{"Base branch is main."}}); len(got) != 1 || got[0] != "Base branch is main." {
		t.Fatalf("default reasons = %#v", got)
	}
}
