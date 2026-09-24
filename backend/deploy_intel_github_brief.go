package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
)

const deployIntelGitHubCommentMarker = "<!-- infragate-deploy-intel -->"

type deployIntelGitHubPost struct {
	CheckPosted   bool   `json:"check_posted"`
	CommentPosted bool   `json:"comment_posted"`
	CheckName     string `json:"check_name,omitempty"`
	Conclusion    string `json:"conclusion,omitempty"`
	Error         string `json:"error,omitempty"`
}

func deployIntelCheckConclusion(risk string) string {
	switch strings.ToLower(strings.TrimSpace(risk)) {
	case "high":
		return "action_required"
	case "medium":
		return "neutral"
	default:
		return "success"
	}
}

func deployIntelCommitStatusState(risk string) string {
	if strings.EqualFold(strings.TrimSpace(risk), "high") {
		return "failure"
	}
	return "success"
}

func formatDeployIntelGitHubComment(brief prImpactBrief) string {
	if brief.ChangeBrief == nil {
		attachChangeBrief(&brief)
	}
	headline := ""
	if brief.ChangeBrief != nil {
		headline = brief.ChangeBrief.Headline
	}
	if headline == "" {
		headline = brief.Summary
	}
	var b strings.Builder
	b.WriteString(deployIntelGitHubCommentMarker)
	b.WriteString("\n## InfraGate deploy intelligence\n\n")
	b.WriteString(fmt.Sprintf("**%s** · %s risk (%d/100)\n\n", headline, brief.RiskLevel, brief.Score))
	if brief.ChangeBrief != nil && len(brief.ChangeBrief.Changing) > 0 {
		b.WriteString("### Changing\n")
		for _, group := range brief.ChangeBrief.Changing {
			b.WriteString(fmt.Sprintf("- %s · %d file(s)\n", group.Label, group.Count))
		}
		b.WriteString("\n")
	}
	if brief.ChangeBrief != nil && len(brief.ChangeBrief.RiskBecause) > 0 {
		b.WriteString("### Risk because\n")
		for _, reason := range brief.ChangeBrief.RiskBecause {
			b.WriteString("- ")
			b.WriteString(reason)
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}
	if brief.RecommendedAction != "" {
		b.WriteString("**Action:** ")
		b.WriteString(brief.RecommendedAction)
		b.WriteString("\n")
	}
	if brief.PRURL != "" {
		b.WriteString("\n")
		b.WriteString(brief.PRURL)
		b.WriteString("\n")
	}
	return b.String()
}

func formatDeployIntelCheckSummary(brief prImpactBrief) string {
	if brief.ChangeBrief == nil {
		attachChangeBrief(&brief)
	}
	lines := make([]string, 0, 8)
	if brief.ChangeBrief != nil && brief.ChangeBrief.Headline != "" {
		lines = append(lines, brief.ChangeBrief.Headline)
	}
	if brief.ChangeBrief != nil {
		for _, reason := range brief.ChangeBrief.RiskBecause {
			lines = append(lines, "• "+reason)
		}
	}
	if brief.RecommendedAction != "" {
		lines = append(lines, brief.RecommendedAction)
	}
	if len(lines) == 0 {
		return brief.Summary
	}
	return strings.Join(lines, "\n")
}

func postDeployIntelGitHubBrief(owner, name string, number int, sha string, brief prImpactBrief) deployIntelGitHubPost {
	out := deployIntelGitHubPost{CheckName: checkInfragateDeployIntel, Conclusion: deployIntelCheckConclusion(brief.RiskLevel)}
	if GitHubToken == "" || number <= 0 {
		out.Error = "GitHub token or pull request number missing."
		return out
	}
	owner, name = normalizeRepoIdentity(owner, name)
	if owner == "" || name == "" {
		out.Error = "repository identity missing."
		return out
	}
	if brief.ChangeBrief == nil {
		attachChangeBrief(&brief)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client, err := newGitHubClient()
	if err != nil || client == nil {
		out.Error = "GitHub client unavailable."
		return out
	}
	if sha == "" {
		pr, _, getErr := client.PullRequests.Get(ctx, owner, name, number)
		if getErr == nil && pr != nil && pr.GetHead() != nil {
			sha = pr.GetHead().GetSHA()
		}
	}
	if sha != "" {
		if err := createDeployIntelCheckRun(ctx, client, owner, name, sha, brief); err != nil {
			if statusErr := createDeployIntelCommitStatus(ctx, client, owner, name, sha, brief); statusErr != nil {
				out.Error = err.Error()
				log.Printf("[deploy-intel] github check/status #%d: %v / %v", number, err, statusErr)
			} else {
				out.CheckPosted = true
			}
		} else {
			out.CheckPosted = true
		}
	}
	if err := upsertDeployIntelPRComment(ctx, client, owner, name, number, brief); err != nil {
		if out.Error == "" {
			out.Error = err.Error()
		}
		log.Printf("[deploy-intel] github comment #%d: %v", number, err)
	} else {
		out.CommentPosted = true
	}
	return out
}

func createDeployIntelCheckRun(ctx context.Context, client *github.Client, owner, name, sha string, brief prImpactBrief) error {
	title := checkInfragateDeployIntel
	if brief.ChangeBrief != nil && brief.ChangeBrief.Headline != "" {
		title = brief.ChangeBrief.Headline
	}
	summary := formatDeployIntelCheckSummary(brief)
	text := formatDeployIntelGitHubComment(brief)
	now := github.Timestamp{Time: time.Now().UTC()}
	_, _, err := client.Checks.CreateCheckRun(ctx, owner, name, github.CreateCheckRunOptions{
		Name:        checkInfragateDeployIntel,
		HeadSHA:     sha,
		Status:      github.String("completed"),
		Conclusion:  github.String(deployIntelCheckConclusion(brief.RiskLevel)),
		CompletedAt: &now,
		Output: &github.CheckRunOutput{
			Title:   github.String(title),
			Summary: github.String(summary),
			Text:    github.String(text),
		},
	})
	return err
}

func createDeployIntelCommitStatus(ctx context.Context, client *github.Client, owner, name, sha string, brief prImpactBrief) error {
	desc := brief.Summary
	if brief.ChangeBrief != nil && brief.ChangeBrief.Headline != "" {
		desc = brief.ChangeBrief.Headline
	}
	if len(desc) > 140 {
		desc = desc[:137] + "..."
	}
	status := &github.RepoStatus{
		State:       github.String(deployIntelCommitStatusState(brief.RiskLevel)),
		Context:     github.String(checkInfragateDeployIntel),
		Description: github.String(desc),
	}
	if brief.PRURL != "" {
		status.TargetURL = github.String(brief.PRURL)
	}
	_, _, err := client.Repositories.CreateStatus(ctx, owner, name, sha, status)
	return err
}

func upsertDeployIntelPRComment(ctx context.Context, client *github.Client, owner, name string, number int, brief prImpactBrief) error {
	body := formatDeployIntelGitHubComment(brief)
	opts := &github.IssueListCommentsOptions{ListOptions: github.ListOptions{PerPage: 100}}
	for {
		comments, resp, err := client.Issues.ListComments(ctx, owner, name, number, opts)
		if err != nil {
			return err
		}
		for _, comment := range comments {
			if comment == nil || !strings.Contains(comment.GetBody(), deployIntelGitHubCommentMarker) {
				continue
			}
			_, _, err := client.Issues.EditComment(ctx, owner, name, comment.GetID(), &github.IssueComment{Body: github.String(body)})
			return err
		}
		if resp == nil || resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}
	_, _, err := client.Issues.CreateComment(ctx, owner, name, number, &github.IssueComment{Body: github.String(body)})
	return err
}
