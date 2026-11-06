package main

import (
	"sort"
	"strings"
)

type reviewBottleneckTeam struct {
	Repository          string `json:"repository"`
	Open                int    `json:"open"`
	AwaitingOwner       int    `json:"awaiting_owner"`
	Overdue             int    `json:"overdue"`
	MedianAgeDays       int    `json:"median_age_days"`
	MedianApprovalDelay int    `json:"median_approval_delay_days"`
	ApprovalSample      int    `json:"approval_sample"`
	DelayKnown          bool   `json:"delay_known"`
}

type reviewBottleneckSummary struct {
	AwaitingOwner       int                    `json:"awaiting_owner"`
	Overdue             int                    `json:"overdue"`
	Open                int                    `json:"open"`
	MedianAgeDays       int                    `json:"median_age_days"`
	MedianApprovalDelay int                    `json:"median_approval_delay_days"`
	ApprovalSample      int                    `json:"approval_sample"`
	DelayKnown          bool                   `json:"delay_known"`
	Note                string                 `json:"note"`
	Teams               []reviewBottleneckTeam `json:"teams"`
}

const reviewBottleneckNote = "Awaiting a reviewer means no assignee and no requested reviewer. The pull request author is not the assigned owner. Overdue uses the seven-day review SLA. Approval delay includes only pull requests with a recorded first-approval timestamp and shows that sample size. No approvals yet means none qualify. Repository trends are not a proven team capacity claim."

func hasNonAuthorLogin(logins []string, author string) bool {
	author = strings.TrimSpace(author)
	for _, login := range logins {
		login = strings.TrimSpace(login)
		if login == "" || strings.EqualFold(login, author) {
			continue
		}
		return true
	}
	return false
}

func prAwaitingOwner(meta *deployIntelOpenPRMeta, author string) bool {
	if meta == nil {
		return true
	}
	decision := strings.ToUpper(strings.TrimSpace(meta.ReviewDecision))
	if decision == "APPROVED" {
		return false
	}
	if hasNonAuthorLogin(meta.Assignees, author) || hasNonAuthorLogin(meta.RequestedReviewers, author) {
		return false
	}
	if decision == "CHANGES_REQUESTED" {
		return false
	}
	return true
}

func prApprovalDelayDays(ev repoDeployEvent) (int, bool) {
	if ev.OpenPR == nil || ev.OpenPR.CreatedAt == nil || ev.OpenPR.CreatedAt.IsZero() {
		return 0, false
	}
	if ev.OpenPR.FirstApprovedAt == nil || ev.OpenPR.FirstApprovedAt.IsZero() {
		return 0, false
	}
	start := ev.OpenPR.CreatedAt.UTC()
	end := ev.OpenPR.FirstApprovedAt.UTC()
	if end.Before(start) {
		return 0, false
	}
	days := int(end.Sub(start).Hours() / 24)
	if days < 0 {
		days = 0
	}
	return days, true
}

func medianInt(values []int) int {
	if len(values) == 0 {
		return 0
	}
	copyValues := append([]int{}, values...)
	sort.Ints(copyValues)
	mid := len(copyValues) / 2
	if len(copyValues)%2 == 1 {
		return copyValues[mid]
	}
	return (copyValues[mid-1] + copyValues[mid]) / 2
}

func attachReviewWait(events []repoDeployEvent) {
	for i := range events {
		if events[i].OpenPR == nil {
			continue
		}
		events[i].OpenPR.AwaitingOwner = prAwaitingOwner(events[i].OpenPR, events[i].Author)
		if delay, ok := prApprovalDelayDays(events[i]); ok {
			events[i].OpenPR.ApprovalDelayDays = delay
			events[i].OpenPR.DelayKnown = true
		}
	}
}

func buildReviewBottleneckSummary(events []repoDeployEvent) reviewBottleneckSummary {
	attachReviewWait(events)
	out := reviewBottleneckSummary{Note: reviewBottleneckNote, Teams: []reviewBottleneckTeam{}}
	if len(events) == 0 {
		return out
	}
	type bucket struct {
		repo   string
		open   int
		await  int
		over   int
		ages   []int
		delays []int
	}
	byRepo := map[string]*bucket{}
	var ages []int
	var delays []int
	for _, ev := range events {
		repo := strings.TrimSpace(ev.RepoName)
		if repo == "" {
			repo = "Unknown"
		}
		item := byRepo[repo]
		if item == nil {
			item = &bucket{repo: repo}
			byRepo[repo] = item
		}
		item.open++
		out.Open++
		age := 0
		overdue := false
		awaiting := true
		if ev.OpenPR != nil {
			age = ev.OpenPR.AgeDays
			overdue = strings.EqualFold(ev.OpenPR.ReviewSLA, "breach")
			awaiting = ev.OpenPR.AwaitingOwner
			if ev.OpenPR.DelayKnown {
				item.delays = append(item.delays, ev.OpenPR.ApprovalDelayDays)
				delays = append(delays, ev.OpenPR.ApprovalDelayDays)
			}
		}
		item.ages = append(item.ages, age)
		ages = append(ages, age)
		if awaiting {
			item.await++
			out.AwaitingOwner++
		}
		if overdue {
			item.over++
			out.Overdue++
		}
	}
	out.MedianAgeDays = medianInt(ages)
	out.ApprovalSample = len(delays)
	if len(delays) > 0 {
		out.MedianApprovalDelay = medianInt(delays)
		out.DelayKnown = true
	}
	teams := make([]reviewBottleneckTeam, 0, len(byRepo))
	for _, item := range byRepo {
		row := reviewBottleneckTeam{
			Repository:    item.repo,
			Open:          item.open,
			AwaitingOwner: item.await,
			Overdue:       item.over,
			MedianAgeDays: medianInt(item.ages),
		}
		row.ApprovalSample = len(item.delays)
		if len(item.delays) > 0 {
			row.MedianApprovalDelay = medianInt(item.delays)
			row.DelayKnown = true
		}
		teams = append(teams, row)
	}
	sort.Slice(teams, func(i, j int) bool {
		if teams[i].Overdue == teams[j].Overdue {
			if teams[i].AwaitingOwner == teams[j].AwaitingOwner {
				return teams[i].Repository < teams[j].Repository
			}
			return teams[i].AwaitingOwner > teams[j].AwaitingOwner
		}
		return teams[i].Overdue > teams[j].Overdue
	})
	out.Teams = teams
	return out
}
