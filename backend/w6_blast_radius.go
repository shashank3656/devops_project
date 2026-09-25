package main

import (
	"strings"
)

func oneHopServiceDependents(anchor serviceMapEntry, catalog []serviceMapEntry) []serviceMapEntry {
	out := []serviceMapEntry{}
	seen := map[string]bool{}
	anchorService := strings.ToLower(strings.TrimSpace(anchor.Service))
	anchorRepo := strings.ToLower(strings.TrimSpace(anchor.Repo))
	anchorTeam := strings.ToLower(strings.TrimSpace(anchor.Team))
	anchorEnv := strings.ToLower(strings.TrimSpace(anchor.Environment))
	for _, item := range catalog {
		key := strings.ToLower(item.Service) + "/" + strings.ToLower(item.Environment) + "/" + strings.ToLower(item.Repo)
		if seen[key] || strings.EqualFold(item.Service, anchor.Service) && strings.EqualFold(item.Environment, anchor.Environment) {
			continue
		}
		sameRepo := anchorRepo != "" && strings.EqualFold(item.Repo, anchor.Repo)
		sameTeam := anchorTeam != "" && strings.EqualFold(item.Team, anchor.Team) && (anchorEnv == "" || item.Environment == "" || strings.EqualFold(item.Environment, anchor.Environment))
		if !sameRepo && !sameTeam {
			continue
		}
		if anchorService != "" && strings.EqualFold(item.Service, anchor.Service) && !sameRepo {
			continue
		}
		seen[key] = true
		out = append(out, item)
		if len(out) >= 8 {
			break
		}
	}
	return out
}

func formatBlastRadius(anchor string, hops []serviceMapEntry) []string {
	out := []string{}
	if trimmed := strings.TrimSpace(anchor); trimmed != "" {
		out = append(out, trimmed)
	}
	for _, item := range hops {
		label := firstNonEmpty(item.Service, item.Repo)
		if item.Environment != "" {
			label += " (" + item.Environment + ")"
		}
		if item.Repo != "" && !strings.EqualFold(item.Service, item.Repo) {
			label += " · " + item.Repo
		}
		out = append(out, label)
	}
	return out
}

func blastRadiusForService(service, repo, environment string, projectID *int) []string {
	pid := 0
	if projectID != nil {
		pid = *projectID
	}
	catalog, err := listServiceMap(pid, "", "")
	if err != nil {
		return []string{}
	}
	anchor := serviceMapEntry{Service: service, Repo: repo, Environment: environment}
	if mapped := lookupServiceMap(service, repo, environment); mapped != nil {
		anchor = *mapped
	}
	return formatBlastRadius(firstNonEmpty(anchor.Service, service), oneHopServiceDependents(anchor, catalog))
}

func blastRadiusForChange(item changeRequestRecord) []string {
	return blastRadiusForService(item.Service, item.Repo, item.Environment, item.ProjectID)
}
