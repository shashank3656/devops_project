package main

import (
	"fmt"
	"sort"
	"strings"
)

type deployIntelChangingGroup struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

type deployIntelChangeBrief struct {
	Headline     string                      `json:"headline"`
	Changing     []deployIntelChangingGroup  `json:"changing"`
	Environments []string                    `json:"environments,omitempty"`
	MultiEnv     bool                        `json:"multi_env"`
	RiskBecause  []string                    `json:"risk_because"`
}

var changeBriefCategoryLabels = map[string]string{
	"terraform":  "Terraform",
	"iam":        "IAM",
	"kubernetes": "Kubernetes",
	"helm":       "Helm",
	"secrets":    "Secrets",
	"database":   "Database",
	"ingress":    "Ingress",
	"code":       "App code",
	"docs":       "Docs",
	"tests":      "Tests",
}

var changeBriefCategoryPriority = map[string]int{
	"secrets":    1,
	"iam":        2,
	"terraform":  3,
	"database":   4,
	"kubernetes": 5,
	"helm":       6,
	"ingress":    7,
	"code":       8,
	"tests":      9,
	"docs":       10,
}

func changeBriefCategoryLabel(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	if label, ok := changeBriefCategoryLabels[key]; ok {
		return label
	}
	if key == "" {
		return "Other"
	}
	return strings.ToUpper(key[:1]) + key[1:]
}

func inferEnvironmentsFromPath(path string) []string {
	lower := strings.ToLower(path)
	found := make([]string, 0, 3)
	add := func(env string) {
		for _, existing := range found {
			if existing == env {
				return
			}
		}
		found = append(found, env)
	}
	switch {
	case strings.Contains(lower, "/prod/"), strings.Contains(lower, "/production/"),
		strings.Contains(lower, "env/prod"), strings.HasPrefix(lower, "prod/"),
		strings.Contains(lower, "-prod."), strings.Contains(lower, ".prod."):
		add("prod")
	}
	switch {
	case strings.Contains(lower, "/uat/"), strings.Contains(lower, "/staging/"),
		strings.Contains(lower, "env/uat"), strings.HasPrefix(lower, "uat/"):
		add("uat")
	}
	switch {
	case strings.Contains(lower, "/dev/"), strings.Contains(lower, "/development/"),
		strings.Contains(lower, "/sandbox/"), strings.Contains(lower, "/preview/"),
		strings.Contains(lower, "env/dev"), strings.HasPrefix(lower, "dev/"):
		add("dev")
	}
	return found
}

func buildChangeBrief(brief prImpactBrief) deployIntelChangeBrief {
	counts := map[string]int{}
	envSeen := map[string]struct{}{}
	envs := make([]string, 0, 3)

	addEnv := func(env string) {
		env = strings.ToLower(strings.TrimSpace(env))
		if env == "production" {
			env = "prod"
		}
		if env == "" {
			return
		}
		if _, ok := envSeen[env]; ok {
			return
		}
		envSeen[env] = struct{}{}
		envs = append(envs, env)
	}

	if brief.Environment != "" {
		addEnv(brief.Environment)
	}
	for _, file := range brief.Files {
		key := strings.ToLower(strings.TrimSpace(file.Category))
		if key == "" {
			key = categorizeChangedPath(file.Path)
		}
		counts[key]++
		for _, env := range inferEnvironmentsFromPath(file.Path) {
			addEnv(env)
		}
	}
	if len(counts) == 0 {
		for _, radius := range brief.BlastRadius {
			key := strings.ToLower(strings.TrimSpace(radius))
			if _, ok := changeBriefCategoryLabels[key]; ok {
				counts[key]++
			}
		}
	}

	changing := make([]deployIntelChangingGroup, 0, len(counts))
	for key, count := range counts {
		changing = append(changing, deployIntelChangingGroup{
			Key:   key,
			Label: changeBriefCategoryLabel(key),
			Count: count,
		})
	}
	sort.Slice(changing, func(i, j int) bool {
		pi, pj := changeBriefCategoryPriority[changing[i].Key], changeBriefCategoryPriority[changing[j].Key]
		if pi == 0 {
			pi = 50
		}
		if pj == 0 {
			pj = 50
		}
		if pi != pj {
			return pi < pj
		}
		if changing[i].Count != changing[j].Count {
			return changing[i].Count > changing[j].Count
		}
		return changing[i].Label < changing[j].Label
	})

	riskBecause := make([]string, 0, 3)
	type rankedFactor struct {
		text  string
		rank  int
		weight int
	}
	ranked := make([]rankedFactor, 0, len(brief.Factors))
	for _, factor := range brief.Factors {
		if factor.Weight < 0 {
			continue
		}
		rank := 2
		switch strings.ToLower(factor.Severity) {
		case "high":
			rank = 0
		case "medium":
			rank = 1
		}
		text := strings.TrimSpace(factor.Detail)
		if text == "" {
			text = strings.TrimSpace(factor.Label)
		}
		if text == "" {
			continue
		}
		ranked = append(ranked, rankedFactor{text: text, rank: rank, weight: factor.Weight})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].rank != ranked[j].rank {
			return ranked[i].rank < ranked[j].rank
		}
		return ranked[i].weight > ranked[j].weight
	})
	seenRisk := map[string]struct{}{}
	for _, item := range ranked {
		key := strings.ToLower(item.text)
		if _, ok := seenRisk[key]; ok {
			continue
		}
		seenRisk[key] = struct{}{}
		riskBecause = append(riskBecause, item.text)
		if len(riskBecause) >= 3 {
			break
		}
	}

	tokens := make([]string, 0, 4)
	for _, group := range changing {
		if group.Key == "docs" || group.Key == "tests" {
			continue
		}
		tokens = append(tokens, group.Label)
		if len(tokens) >= 3 {
			break
		}
	}
	if len(tokens) == 0 && len(changing) > 0 {
		tokens = append(tokens, changing[0].Label)
	}
	if len(envs) == 1 {
		tokens = append(tokens, envs[0])
	} else if len(envs) > 1 {
		tokens = append(tokens, "multi-env")
	}
	headline := strings.Join(tokens, " · ")
	if headline == "" {
		if brief.FileCount > 0 {
			headline = fmt.Sprintf("%d file(s)", brief.FileCount)
		} else {
			headline = "No file categories yet"
		}
	}

	return deployIntelChangeBrief{
		Headline:     headline,
		Changing:     changing,
		Environments: envs,
		MultiEnv:     len(envs) > 1,
		RiskBecause:  riskBecause,
	}
}

func attachChangeBrief(brief *prImpactBrief) {
	if brief == nil {
		return
	}
	built := buildChangeBrief(*brief)
	brief.ChangeBrief = &built
}
