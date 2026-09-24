package main

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

type deployIntelRevertRef struct {
	PRNumber int       `json:"pr_number"`
	Title    string    `json:"title"`
	PRURL    string    `json:"pr_url,omitempty"`
	MergedAt time.Time `json:"merged_at"`
}

type deployIntelSimilarMerge struct {
	PRNumber    int                   `json:"pr_number"`
	Title       string                `json:"title"`
	Headline    string                `json:"headline,omitempty"`
	RiskLevel   string                `json:"risk_level"`
	Score       int                   `json:"score"`
	MergedAt    time.Time             `json:"merged_at"`
	PRURL       string                `json:"pr_url,omitempty"`
	Overlap     []string              `json:"overlap"`
	LaterRevert *deployIntelRevertRef `json:"later_revert,omitempty"`
}

var revertTitlePattern = regexp.MustCompile(`(?i)\b(revert|rollback|roll[\s-]?back)\b`)

func similarMergeSignals(brief prImpactBrief) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, 8)
	add := func(value string) {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" || value == "docs" || value == "tests" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if brief.ChangeBrief != nil {
		for _, group := range brief.ChangeBrief.Changing {
			add(group.Key)
		}
	}
	for _, file := range brief.Files {
		cat := strings.ToLower(strings.TrimSpace(file.Category))
		if cat == "" {
			cat = categorizeChangedPath(file.Path)
		}
		add(cat)
		if prefix := fileConflictPrefix(file.Path); prefix != "" {
			add(prefix)
		}
	}
	for _, item := range brief.BlastRadius {
		add(item)
	}
	return out
}

func overlapSignals(left, right []string) []string {
	if len(left) == 0 || len(right) == 0 {
		return nil
	}
	lookup := map[string]struct{}{}
	for _, item := range right {
		lookup[item] = struct{}{}
	}
	out := make([]string, 0, 4)
	seen := map[string]struct{}{}
	for _, item := range left {
		if _, ok := lookup[item]; !ok {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func similarMergeHeadline(ev repoDeployEvent) string {
	if ev.ChangeBrief != nil && strings.TrimSpace(ev.ChangeBrief.Headline) != "" {
		return ev.ChangeBrief.Headline
	}
	if ev.Impact.ChangeBrief != nil && strings.TrimSpace(ev.Impact.ChangeBrief.Headline) != "" {
		return ev.Impact.ChangeBrief.Headline
	}
	return strings.TrimSpace(ev.Title)
}

func isRevertOf(later, original repoDeployEvent) bool {
	title := strings.TrimSpace(later.Title)
	if title == "" || !revertTitlePattern.MatchString(title) {
		return false
	}
	if original.PRNumber > 0 {
		if strings.Contains(title, fmt.Sprintf("#%d", original.PRNumber)) {
			return true
		}
		if strings.Contains(strings.ToLower(title), fmt.Sprintf("pr %d", original.PRNumber)) {
			return true
		}
		if strings.Contains(strings.ToLower(later.HeadBranch), fmt.Sprintf("revert-%d", original.PRNumber)) {
			return true
		}
	}
	orig := strings.TrimSpace(original.Title)
	return orig != "" && strings.Contains(strings.ToLower(title), strings.ToLower(orig))
}

func findLaterRevert(history []repoDeployEvent, original repoDeployEvent) *deployIntelRevertRef {
	for _, ev := range history {
		if ev.PRNumber == original.PRNumber || ev.MergedAt.IsZero() || !ev.MergedAt.After(original.MergedAt) {
			continue
		}
		if !isRevertOf(ev, original) {
			continue
		}
		return &deployIntelRevertRef{
			PRNumber: ev.PRNumber,
			Title:    ev.Title,
			PRURL:    ev.PRURL,
			MergedAt: ev.MergedAt,
		}
	}
	return nil
}

func findSimilarPastMerges(history []repoDeployEvent, brief prImpactBrief, owner, repo string, excludePR int, before time.Time) []deployIntelSimilarMerge {
	current := similarMergeSignals(brief)
	if len(current) == 0 || len(history) == 0 {
		return nil
	}
	type ranked struct {
		item  deployIntelSimilarMerge
		score int
		when  time.Time
	}
	rankedItems := make([]ranked, 0, 3)
	for _, ev := range history {
		if ev.PRNumber <= 0 || ev.PRNumber == excludePR {
			continue
		}
		if revertTitlePattern.MatchString(ev.Title) {
			continue
		}
		if owner != "" && repo != "" && (!strings.EqualFold(ev.RepoOwner, owner) || !strings.EqualFold(ev.RepoName, repo)) {
			continue
		}
		if !before.IsZero() && !ev.MergedAt.IsZero() && !ev.MergedAt.Before(before) {
			continue
		}
		other := ev.Impact
		if other.ChangeBrief == nil {
			attachChangeBrief(&other)
		}
		overlap := overlapSignals(current, similarMergeSignals(other))
		if len(overlap) == 0 {
			continue
		}
		item := deployIntelSimilarMerge{
			PRNumber:    ev.PRNumber,
			Title:       ev.Title,
			Headline:    similarMergeHeadline(ev),
			RiskLevel:   ev.RiskLevel,
			Score:       ev.Score,
			MergedAt:    ev.MergedAt,
			PRURL:       ev.PRURL,
			Overlap:     overlap,
			LaterRevert: findLaterRevert(history, ev),
		}
		rankedItems = append(rankedItems, ranked{item: item, score: len(overlap), when: ev.MergedAt})
	}
	sort.Slice(rankedItems, func(i, j int) bool {
		if rankedItems[i].score != rankedItems[j].score {
			return rankedItems[i].score > rankedItems[j].score
		}
		return rankedItems[i].when.After(rankedItems[j].when)
	})
	if len(rankedItems) > 3 {
		rankedItems = rankedItems[:3]
	}
	out := make([]deployIntelSimilarMerge, 0, len(rankedItems))
	for _, item := range rankedItems {
		out = append(out, item.item)
	}
	return out
}

func attachSimilarMergesToEvents(events []repoDeployEvent) {
	for i := range events {
		before := events[i].MergedAt
		if before.IsZero() {
			before = time.Now()
		}
		events[i].Impact.SimilarMerges = findSimilarPastMerges(events, events[i].Impact, events[i].RepoOwner, events[i].RepoName, events[i].PRNumber, before)
		events[i].SimilarMerges = events[i].Impact.SimilarMerges
	}
}

func attachSimilarPastMerges(brief *prImpactBrief, owner, repo string) {
	if brief == nil {
		return
	}
	if owner == "" || repo == "" {
		owner, repo, _, _ = parseGitHubPRURL(brief.PRURL)
	}
	if owner == "" || repo == "" || DB == nil {
		return
	}
	history, err := listRepoDeployEvents(owner, repo, 80)
	if err != nil || len(history) == 0 {
		return
	}
	before := time.Now()
	brief.SimilarMerges = findSimilarPastMerges(history, *brief, owner, repo, brief.PRNumber, before)
}

func attachSimilarMergesToOpenEvents(owner, repo string, events []repoDeployEvent) {
	if len(events) == 0 {
		return
	}
	history, err := listRepoDeployEvents(owner, repo, 80)
	if err != nil {
		history = nil
	}
	for i := range events {
		events[i].Impact.SimilarMerges = findSimilarPastMerges(history, events[i].Impact, owner, repo, events[i].PRNumber, time.Now())
		events[i].SimilarMerges = events[i].Impact.SimilarMerges
	}
}
