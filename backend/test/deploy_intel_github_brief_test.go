package main

import (
	"strings"
	"testing"
)

func TestDeployIntelCheckConclusion(t *testing.T) {
	if got := deployIntelCheckConclusion("high"); got != "action_required" {
		t.Fatalf("high = %s", got)
	}
	if got := deployIntelCheckConclusion("medium"); got != "neutral" {
		t.Fatalf("medium = %s", got)
	}
	if got := deployIntelCheckConclusion("low"); got != "success" {
		t.Fatalf("low = %s", got)
	}
}

func TestFormatDeployIntelGitHubCommentIncludesMarker(t *testing.T) {
	brief := prImpactBrief{
		RiskLevel:         "high",
		Score:             72,
		Summary:           "high risk",
		RecommendedAction: "Needs extra approval before merge or promotion.",
		PRURL:             "https://github.com/acme/infra/pull/9",
		ChangeBrief: &deployIntelChangeBrief{
			Headline:    "IAM · Terraform · prod",
			RiskBecause: []string{"Base branch is main."},
			Changing:    []deployIntelChangingGroup{{Key: "iam", Label: "IAM", Count: 2}},
		},
	}
	body := formatDeployIntelGitHubComment(brief)
	for _, part := range []string{deployIntelGitHubCommentMarker, "IAM · Terraform · prod", "Needs extra approval", "https://github.com/acme/infra/pull/9"} {
		if !strings.Contains(body, part) {
			t.Fatalf("comment missing %q:\n%s", part, body)
		}
	}
}
