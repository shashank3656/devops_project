package main

import (
	"fmt"
	"strings"
)

func previewClosedMerged(pr map[string]interface{}, action string) (closed, merged bool) {
	merged, _ = pr["merged"].(bool)
	if strings.EqualFold(strings.TrimSpace(action), "merged") {
		merged = true
	}
	closed = strings.EqualFold(strings.TrimSpace(action), "closed") || strings.EqualFold(strings.TrimSpace(action), "merged") || merged
	return closed, merged
}

func previewGitSHA(pr map[string]interface{}, fallback string) string {
	sha := strings.TrimSpace(stringFromAny(pr["merge_commit_sha"]))
	if sha == "" {
		if head, ok := pr["head"].(map[string]interface{}); ok {
			sha = strings.TrimSpace(stringFromAny(head["sha"]))
		}
	}
	return firstNonEmpty(sha, strings.TrimSpace(fallback))
}

func graduatePreviewTarget(repo, service string) (string, string) {
	mapped := lookupServiceMap(service, repo, "")
	targetService := strings.TrimSpace(service)
	targetEnv := "dev"
	if mapped != nil {
		targetService = firstNonEmpty(mapped.Service, targetService)
		targetEnv = firstNonEmpty(mapped.Environment, targetEnv)
	}
	if strings.EqualFold(targetEnv, "preview") || targetEnv == "" {
		targetEnv = "dev"
	}
	if targetService == "" {
		parts := strings.Split(strings.TrimSpace(repo), "/")
		targetService = parts[len(parts)-1]
	}
	return targetService, targetEnv
}

func buildGraduatedPreviewPayload(preview previewEnvironment, gitSHA, service, environment, previousSHA string) parsedChangeWebhook {
	return parsedChangeWebhook{
		Repo:           preview.Repo,
		SHA:            firstNonEmpty(gitSHA, preview.SHA),
		PreviousSHA:    previousSHA,
		PRNumber:       preview.PRNumber,
		Title:          firstNonEmpty("Graduated preview "+preview.ChangeNumber, "Graduated preview PR #"+fmt.Sprint(preview.PRNumber)),
		Summary:        "Preview merged. Same git SHA is now watched in " + environment + ".",
		Service:        service,
		Environment:    environment,
		ChangeType:     "standard",
		Status:         "implemented",
		WatchMinutes:   60,
		RolloutStage:   "100",
		RolloutPercent: 100,
	}
}

func findPreviewEnvironment(repo string, prNumber int) *previewEnvironment {
	for _, item := range listPreviewEnvironments(100) {
		if strings.EqualFold(item.Repo, repo) && item.PRNumber == prNumber {
			copy := item
			return &copy
		}
	}
	return nil
}

func graduatePreviewFromPullRequest(repo string, pr map[string]interface{}) *previewEnvironment {
	number := intFromAny(pr["number"])
	existing := findPreviewEnvironment(repo, number)
	torn := teardownPreview(repo, number)
	if existing == nil {
		return torn
	}
	gitSHA := previewGitSHA(pr, existing.SHA)
	if gitSHA == "" || strings.HasPrefix(strings.ToLower(gitSHA), "preview-") {
		return torn
	}
	service, environment := graduatePreviewTarget(existing.Repo, "")
	previous := ""
	if last := lastWatchableChange(existing.Repo, service, environment); last != nil {
		previous = last.SHA
	}
	payload := buildGraduatedPreviewPayload(*existing, gitSHA, service, environment, previous)
	if mapped := lookupServiceMap(service, existing.Repo, environment); mapped != nil && mapped.ProjectID != nil {
		payload.ProjectID = *mapped.ProjectID
	}
	item, created, err := upsertChangeRequest(payload)
	if err == nil && item != nil && created {
		go FireOutboundWebhooks("change.created", map[string]interface{}{
			"change_number": item.ChangeNumber,
			"change_type":   item.ChangeType,
			"graduated":     true,
			"preview_pr":    number,
		})
	}
	return torn
}
