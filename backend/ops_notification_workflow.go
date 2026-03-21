package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"
)

const gateApprovalExpiryNotificationWindow = 24 * time.Hour

func buildOpsNotificationEventKey(parts ...string) string {
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(strings.ToLower(part))
		if trimmed == "" {
			trimmed = "-"
		}
		normalized = append(normalized, trimmed)
	}
	return strings.Join(normalized, ":")
}

func recordOpsNotificationEvent(eventKey, category, target string, details map[string]any) (bool, error) {
	if DB == nil {
		return false, nil
	}
	eventKey = strings.TrimSpace(eventKey)
	if eventKey == "" {
		return false, fmt.Errorf("event key is required")
	}

	detailsJSON := ""
	if len(details) > 0 {
		encoded, err := json.Marshal(details)
		if err != nil {
			return false, err
		}
		detailsJSON = string(encoded)
	}

	result, err := execContext(`
		INSERT INTO ops_notification_events (event_key, category, target, details)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (event_key) DO NOTHING
	`, eventKey, strings.TrimSpace(category), strings.TrimSpace(target), detailsJSON)
	if err != nil {
		return false, err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rowsAffected > 0, nil
}

func uniquePositiveIntIDs(values []int) []int {
	if len(values) == 0 {
		return []int{}
	}
	seen := make(map[int]struct{}, len(values))
	out := make([]int, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Ints(out)
	return out
}

func getDevopsUserIDs() ([]int, error) {
	users, err := GetDevopsUsers()
	if err != nil {
		return nil, err
	}
	out := make([]int, 0, len(users))
	for _, user := range users {
		if user.ID > 0 {
			out = append(out, user.ID)
		}
	}
	return uniquePositiveIntIDs(out), nil
}

func resolveOpsNotificationRecipientsFromOwner(owner string) ([]int, error) {
	trimmedOwner := strings.TrimSpace(owner)
	if trimmedOwner == "" {
		return []int{}, nil
	}

	recipientIDs := make([]int, 0, 4)
	if user, err := GetUserByUsername(trimmedOwner); err != nil {
		return nil, err
	} else if user != nil && user.ID > 0 {
		recipientIDs = append(recipientIDs, user.ID)
	}

	managerIDs, err := GetPortalManagerUserIDsByTeamNameOrSlug(trimmedOwner)
	if err != nil {
		return nil, err
	}
	recipientIDs = append(recipientIDs, managerIDs...)
	return uniquePositiveIntIDs(recipientIDs), nil
}

func buildOpsNotificationRecipients(base []int) ([]int, error) {
	devopsUserIDs, err := getDevopsUserIDs()
	if err != nil {
		return nil, err
	}
	return uniquePositiveIntIDs(append(base, devopsUserIDs...)), nil
}

func dispatchOpsNotification(eventKey, category, title, message string, requestID *int, projectID *int, recipientIDs []int, payload map[string]any) error {
	if strings.TrimSpace(title) == "" || strings.TrimSpace(message) == "" {
		return nil
	}

	settings, err := loadOpsNotificationSettings()
	if err != nil {
		return err
	}
	if !isOpsNotificationCategoryEnabled(settings, category) {
		return nil
	}

	recipientIDs = uniquePositiveIntIDs(recipientIDs)
	targetParts := make([]string, 0, len(recipientIDs))
	for _, recipientID := range recipientIDs {
		targetParts = append(targetParts, fmt.Sprintf("user:%d", recipientID))
	}
	if projectID != nil && *projectID > 0 {
		targetParts = append(targetParts, fmt.Sprintf("project:%d", *projectID))
	}
	if requestID != nil && *requestID > 0 {
		targetParts = append(targetParts, fmt.Sprintf("request:%d", *requestID))
	}

	inserted, err := recordOpsNotificationEvent(eventKey, category, strings.Join(targetParts, ","), payload)
	if err != nil {
		return err
	}
	if !inserted {
		return nil
	}

	if settings.InAppEnabled {
		for _, recipientID := range recipientIDs {
			if err := InsertUserNotification(recipientID, requestID, projectID, category, message); err != nil {
				log.Printf("ops notification insert failed category=%s user_id=%d: %v", category, recipientID, err)
			}
		}
	}

	if settings.EmailEnabled {
		for _, recipientID := range recipientIDs {
			sendNotificationEmailIfConfigured(recipientID, category, title, message)
		}
	}

	if settings.SlackEnabled {
		if webhookURL := settings.effectiveSlackWebhookURL(); webhookURL != "" {
			sendSlackNotificationToWebhook(webhookURL, title+": "+message, nil)
		}
	}
	if settings.TeamsEnabled {
		if webhookURL := settings.effectiveTeamsWebhookURL(); webhookURL != "" {
			sendTeamsNotificationToWebhook(webhookURL, "**"+title+"**\n\n"+message)
		}
	}

	if settings.WebhookEnabled {
		if webhookURL := settings.effectiveWebhookURL(); webhookURL != "" {
		enqueueJob("webhook", WebhookJob{
			URL:   webhookURL,
			Event: category,
			Payload: map[string]any{
				"title":      title,
				"message":    message,
				"request_id": requestID,
				"project_id": projectID,
				"payload":    payload,
			},
		})
	}
	}
	return nil
}

func notifyBlockedPromotion(req *PRRequest, gate *promotionGateDecision) error {
	if req == nil || gate == nil || gate.Status != "blocked" {
		return nil
	}

	recipients := make([]int, 0, 8)
	if req.CreatedBy != nil && *req.CreatedBy > 0 {
		recipients = append(recipients, *req.CreatedBy)
	}
	ownerRecipients, err := resolveOpsNotificationRecipientsFromOwner(req.Team)
	if err != nil {
		return err
	}
	recipients = append(recipients, ownerRecipients...)
	recipients, err = buildOpsNotificationRecipients(recipients)
	if err != nil {
		return err
	}

	targetEnvironment := strings.ToUpper(strings.TrimSpace(gate.TargetEnvironment))
	message := fmt.Sprintf(
		"Promotion for request #%d to %s is blocked. %s",
		req.ID,
		targetEnvironment,
		strings.TrimSpace(gate.Summary),
	)
	if req.ProjectName != "" {
		message += fmt.Sprintf(" Project: %s.", req.ProjectName)
	}

	return dispatchOpsNotification(
		buildOpsNotificationEventKey("blocked-promotion", fmt.Sprintf("%d", req.ID), gate.TargetEnvironment, fmt.Sprintf("%d", req.UpdatedAt.Unix())),
		"blocked_promotion",
		"Blocked promotion requires attention",
		message,
		&req.ID,
		req.ProjectID,
		recipients,
		map[string]any{
			"request_id":           req.ID,
			"project_id":           req.ProjectID,
			"project_name":         req.ProjectName,
			"project_code":         req.ProjectCode,
			"source_environment":   req.Env,
			"target_environment":   gate.TargetEnvironment,
			"summary":              gate.Summary,
			"blocking_check_count": gate.BlockingCheckCount,
		},
	)
}

func notifyGateApprovalNearExpiry(req *PRRequest, gate *promotionGateDecision) error {
	if req == nil || gate == nil || gate.Approval == nil || gate.Approval.ExpiresAt == nil {
		return nil
	}
	expiresAt := *gate.Approval.ExpiresAt
	remaining := time.Until(expiresAt)
	if remaining <= 0 || remaining > gateApprovalExpiryNotificationWindow {
		return nil
	}
	if strings.EqualFold(gate.Approval.State, "revoked") {
		return nil
	}

	recipients := make([]int, 0, 8)
	if gate.Approval.ApprovedBy > 0 {
		recipients = append(recipients, gate.Approval.ApprovedBy)
	}
	if req.CreatedBy != nil && *req.CreatedBy > 0 {
		recipients = append(recipients, *req.CreatedBy)
	}
	recipients, err := buildOpsNotificationRecipients(recipients)
	if err != nil {
		return err
	}

	message := fmt.Sprintf(
		"Gate approval for request #%d to %s expires at %s. Review whether the promotion still needs to proceed.",
		req.ID,
		strings.ToUpper(strings.TrimSpace(gate.TargetEnvironment)),
		expiresAt.Format(time.RFC3339),
	)

	return dispatchOpsNotification(
		buildOpsNotificationEventKey("gate-approval-expiring", fmt.Sprintf("%d", gate.Approval.ID), expiresAt.UTC().Format("2006-01-02")),
		"gate_approval_expiring",
		"Deployment gate approval is nearing expiry",
		message,
		&req.ID,
		req.ProjectID,
		recipients,
		map[string]any{
			"approval_id":        gate.Approval.ID,
			"request_id":         req.ID,
			"project_id":         req.ProjectID,
			"target_environment": gate.TargetEnvironment,
			"expires_at":         expiresAt.Format(time.RFC3339),
			"approved_by":        gate.Approval.ApprovedByUsername,
			"source_environment": gate.Approval.SourceEnvironment,
		},
	)
}

func notifyPromotionCenterWatchers(items []promotionCenterItem) error {
	requestCache := make(map[int]*PRRequest, len(items))
	for _, item := range items {
		if item.RequestID <= 0 || item.Gate == nil {
			continue
		}
		req, ok := requestCache[item.RequestID]
		if !ok {
			loaded, err := GetPRRequestByID(item.RequestID)
			if err != nil {
				return err
			}
			req = loaded
			requestCache[item.RequestID] = req
		}
		if item.Gate.Status == "blocked" {
			if err := notifyBlockedPromotion(req, item.Gate); err != nil {
				return err
			}
		}
		if err := notifyGateApprovalNearExpiry(req, item.Gate); err != nil {
			return err
		}
	}
	return nil
}

func notifyExpiryTrackerWatchers(items []expiryTrackerItem) error {
	todayKey := time.Now().UTC().Format("2006-01-02")
	for _, item := range items {
		if item.WorkflowState == "rotated" {
			continue
		}
		if item.Status != "expired" && item.Status != "expiring_30d" {
			continue
		}

		recipients, err := resolveOpsNotificationRecipientsFromOwner(item.Owner)
		if err != nil {
			return err
		}
		recipients, err = buildOpsNotificationRecipients(recipients)
		if err != nil {
			return err
		}

		message := fmt.Sprintf(
			"%s in %s is %s and needs attention. %s",
			item.ResourceName,
			strings.ToUpper(strings.TrimSpace(item.Environment)),
			strings.ReplaceAll(item.Status, "_", " "),
			item.Recommendation,
		)
		if item.ProjectName != "" {
			message = fmt.Sprintf("%s Project: %s.", message, item.ProjectName)
		}

		if err := dispatchOpsNotification(
			buildOpsNotificationEventKey("expiry-tracker", item.ItemKey, item.Status, todayKey),
			"expiry_tracker_alert",
			"Secret or certificate needs review",
			message,
			nil,
			item.ProjectID,
			recipients,
			map[string]any{
				"item_key":       item.ItemKey,
				"category":       item.Category,
				"project_id":     item.ProjectID,
				"project_name":   item.ProjectName,
				"project_code":   item.ProjectCode,
				"environment":    item.Environment,
				"resource_name":  item.ResourceName,
				"resource_type":  item.ResourceType,
				"status":         item.Status,
				"days_remaining": item.DaysRemaining,
				"owner":          item.Owner,
			},
		); err != nil {
			return err
		}
	}
	return nil
}
