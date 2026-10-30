package main

import (
	"strings"
	"testing"
)

func TestCategorizeChangedPath(t *testing.T) {
	tests := map[string]string{
		"helm/infragate/values.yaml": "helm",
		"k8s/deployments/api.yaml":   "kubernetes",
		"infra/main.tf":              "terraform",
		"policies/iam-role.json":     "iam",
		"cluster-secret.yaml":        "secrets",
		"docs/README.md":             "docs",
		"ingress/public.yaml":        "ingress",
		"migrations/20240101.sql":    "database",
		"frontend/pages/home.tsx":    "code",
	}
	for path, want := range tests {
		if got := categorizeChangedPath(path); got != want {
			t.Fatalf("categorizeChangedPath(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestParseGitHubPRURL(t *testing.T) {
	owner, repo, number, ok := parseGitHubPRURL("https://github.com/ngsops/Application_Onboarding/pull/42")
	if !ok || owner != "ngsops" || repo != "Application_Onboarding" || number != 42 {
		t.Fatalf("parseGitHubPRURL got %s %s %d %v", owner, repo, number, ok)
	}
}

func TestScorePRImpactProductionBatch(t *testing.T) {
	brief := prImpactBrief{
		Environment: "prod",
		BaseBranch:  "main",
		CommitCount: 11,
		FileCount:   4,
		Additions:   900,
		Deletions:   40,
		Files: []prImpactFile{
			{Path: "helm/app/values.yaml", Category: "helm"},
			{Path: "k8s/deploy.yaml", Category: "kubernetes"},
		},
	}
	scorePRImpact(&brief, &PRRequest{Env: "prod", Priority: "critical"})
	if brief.RiskLevel != "high" {
		t.Fatalf("risk = %s score = %d, want high", brief.RiskLevel, brief.Score)
	}
	if brief.RecommendedAction == "" {
		t.Fatal("expected a recommended action")
	}
}

func TestScorePRImpactDocsOnly(t *testing.T) {
	brief := prImpactBrief{
		Environment: "dev",
		BaseBranch:  "feature/docs",
		CommitCount: 1,
		FileCount:   1,
		Files:       []prImpactFile{{Path: "docs/README.md", Category: "docs"}},
	}
	scorePRImpact(&brief, &PRRequest{Env: "dev", Priority: "low"})
	if brief.RiskLevel == "high" {
		t.Fatalf("docs-only PR should not be high risk, got score %d", brief.Score)
	}
}

func TestRecommendPRImpactActionDoesNotCallSafeToMerge(t *testing.T) {
	got := recommendPRImpactAction(prImpactBrief{RiskLevel: "low", Score: 12})
	if got != deliveryAdviceUnconfirmed {
		t.Fatalf("got %q", got)
	}
	if recommendPRImpactAction(prImpactBrief{RiskLevel: "medium", Score: 40}) != deliveryAdviceUnconfirmed {
		t.Fatal("medium advice still invited promotion")
	}
	high := recommendPRImpactAction(prImpactBrief{RiskLevel: "high", Score: 80, Environment: "prod"})
	if !strings.Contains(high, deliveryAdviceUnconfirmed) || strings.Contains(strings.ToLower(high), "safe to merge") || strings.Contains(strings.ToLower(high), "consider review or merge") {
		t.Fatalf("high advice drifted: %q", high)
	}
}
