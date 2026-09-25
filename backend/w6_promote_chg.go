package main

import (
	"fmt"
	"strings"
)

func isWatchableChangeType(changeType string) bool {
	switch normalizeChangeType(changeType) {
	case "preview", "flag":
		return false
	default:
		return true
	}
}

func lastWatchableChange(repo, service, environment string) *changeRequestRecord {
	items, err := listChangeRequests(0, environment, "", "")
	if err != nil {
		return nil
	}
	repo = strings.ToLower(strings.TrimSpace(repo))
	service = strings.ToLower(strings.TrimSpace(service))
	for i := range items {
		item := items[i]
		if !isWatchableChangeType(item.ChangeType) {
			continue
		}
		if repo != "" && strings.ToLower(strings.TrimSpace(item.Repo)) != repo {
			if service == "" || !strings.EqualFold(item.Service, service) {
				continue
			}
		} else if repo == "" && service != "" && !strings.EqualFold(item.Service, service) {
			continue
		}
		copy := item
		return &copy
	}
	return nil
}

func buildPromotionHopPayload(sourceEnv, targetEnv, service, repo, sha, previousSHA string, requestID, projectID int) parsedChangeWebhook {
	changeType := "standard"
	if isHighControlEnvironment(targetEnv) {
		changeType = "normal"
	}
	payload := parsedChangeWebhook{
		Repo:           firstNonEmpty(repo, service+"/infra"),
		SHA:            sha,
		PreviousSHA:    previousSHA,
		Title:          fmt.Sprintf("Promote %s %s → %s", firstNonEmpty(service, "service"), sourceEnv, targetEnv),
		Summary:        "Promotion hop recorded as a Change Request. Freeze and CAB still apply.",
		Service:        service,
		Environment:    targetEnv,
		ChangeType:     changeType,
		Status:         "implemented",
		WatchMinutes:   60,
		RequestID:      requestID,
		Impact:         "Environment promotion " + sourceEnv + " to " + targetEnv,
		RolloutStage:   "100",
		RolloutPercent: 100,
	}
	if projectID > 0 {
		payload.ProjectID = projectID
	}
	return payload
}

func promotionHopNotice(env string, chg *changeRequestRecord) string {
	if chg != nil && strings.TrimSpace(chg.ChangeNumber) != "" {
		return fmt.Sprintf("Request created for %s as %s. Edit and submit from History.", env, chg.ChangeNumber)
	}
	return "Request created for " + env + ". Edit and submit from History."
}

func recordPromotionChange(source, promoted *PRRequest) *changeRequestRecord {
	if source == nil || promoted == nil {
		return nil
	}
	mapped := lookupServiceMap(source.Service, "", promoted.Env)
	repo := ""
	if mapped != nil {
		repo = mapped.Repo
	}
	sourceChange := lastWatchableChange(repo, source.Service, source.Env)
	targetChange := lastWatchableChange(repo, source.Service, promoted.Env)
	sha := ""
	if sourceChange != nil {
		sha = sourceChange.SHA
	}
	if sha == "" {
		sha = firstNonEmpty(source.ApplicationID, fmt.Sprintf("request-%d", source.ID))
	}
	previous := ""
	if targetChange != nil {
		previous = targetChange.SHA
	} else if sourceChange != nil {
		previous = sourceChange.PreviousSHA
	}
	projectID := 0
	if promoted.ProjectID != nil {
		projectID = *promoted.ProjectID
	} else if source.ProjectID != nil {
		projectID = *source.ProjectID
	}
	payload := buildPromotionHopPayload(source.Env, promoted.Env, source.Service, repo, sha, previous, promoted.ID, projectID)
	item, created, err := upsertChangeRequest(payload)
	if err == nil && item != nil && created {
		go FireOutboundWebhooks("change.created", map[string]interface{}{
			"change_number": item.ChangeNumber,
			"change_type":   item.ChangeType,
			"promoted":      true,
			"from_env":      source.Env,
			"to_env":        promoted.Env,
			"request_id":    promoted.ID,
		})
	}
	return item
}
