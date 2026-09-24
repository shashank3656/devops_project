package main

import (
	"strings"
	"testing"
)

func TestChangeBriefFromDeployEventUsesImpact(t *testing.T) {
	ev := &repoDeployEvent{
		Title: "IAM change",
		Impact: prImpactBrief{
			ChangeBrief: &deployIntelChangeBrief{Headline: "IAM · prod"},
		},
	}
	brief := changeBriefFromDeployEvent(ev)
	if brief == nil || brief.Headline != "IAM · prod" {
		t.Fatalf("expected headline from impact, got %#v", brief)
	}
	if ev.ChangeBrief == nil || ev.ChangeBrief.Headline != "IAM · prod" {
		t.Fatal("expected event change brief to be populated")
	}
}

func TestChangeBriefFromPromotionGate(t *testing.T) {
	gate := &promotionGateDecision{
		Checks: []deploymentGateCheck{
			{Key: "freeze", Detail: "ok"},
			{Key: "recent_high_risk_merge", ChangeBrief: &deployIntelChangeBrief{Headline: "IAM · prod"}},
		},
	}
	brief := changeBriefFromPromotionGate(gate)
	if brief == nil || brief.Headline != "IAM · prod" {
		t.Fatalf("got %#v", brief)
	}
}

func TestEvaluateHighRiskMergeAckNilRequest(t *testing.T) {
	gate := evaluateHighRiskMergeAck(nil)
	if gate.Required {
		t.Fatal("nil request should not require high-risk acknowledgement")
	}
}

func TestMergeRequiredCheckContextsKeepsExisting(t *testing.T) {
	merged := mergeRequiredCheckContexts(
		[]string{"ci/tests", "infragate/plan-review"},
		recommendedDeployIntelCheckContexts(),
	)
	joined := strings.Join(merged, ",")
	if !strings.Contains(joined, "ci/tests") || !strings.Contains(joined, checkInfragatePlanReview) || !strings.Contains(joined, checkInfragatePolicy) {
		t.Fatalf("merged checks = %#v", merged)
	}
	seen := map[string]int{}
	for _, item := range merged {
		seen[strings.ToLower(item)]++
		if seen[strings.ToLower(item)] > 1 {
			t.Fatalf("duplicate check %q", item)
		}
	}
}

func TestFormatHighRiskMergeSlackBodyIncludesChangingAndLinks(t *testing.T) {
	body := formatHighRiskMergeSlackBody("acme", "infra", prImpactBrief{
		PRNumber:  12,
		RequestID: 44,
		Score:     81,
		PRURL:     "https://github.com/acme/infra/pull/12",
		ChangeBrief: &deployIntelChangeBrief{
			Headline:    "IAM · Terraform · prod",
			Changing:    []deployIntelChangingGroup{{Key: "iam", Label: "IAM", Count: 2}},
			RiskBecause: []string{"Base branch is main."},
		},
	})
	for _, part := range []string{"IAM (2)", "Base branch is main.", "https://github.com/acme/infra/pull/12", "Ticket: #44"} {
		if !strings.Contains(body, part) {
			t.Fatalf("slack body missing %q:\n%s", part, body)
		}
	}
}

func TestGithubIdentityForRequestFallsBackToEnv(t *testing.T) {
	identity := githubIdentityForRequest(nil)
	if identity.Source != "env" {
		t.Fatalf("source = %s", identity.Source)
	}
}

func TestFormatHighRiskMergeSlackText(t *testing.T) {
	text := formatHighRiskMergeSlackText("acme", "infra", prImpactBrief{
		PRNumber: 12,
		Score:    81,
		Summary:  "high risk",
		ChangeBrief: &deployIntelChangeBrief{
			Headline: "IAM · Terraform · prod",
		},
	})
	for _, part := range []string{"acme/infra", "PR #12", "IAM · Terraform · prod", "81"} {
		if !strings.Contains(text, part) {
			t.Fatalf("slack text missing %q: %s", part, text)
		}
	}
}

func TestDefaultGitHubRepoIdentityUsesEnv(t *testing.T) {
	identity := defaultGitHubRepoIdentity()
	if identity.Source != "env" {
		t.Fatalf("source = %s", identity.Source)
	}
	if identity.Owner == "" || identity.Name == "" {
		t.Fatalf("expected default owner/repo, got %#v", identity)
	}
}
