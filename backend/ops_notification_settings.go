package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type opsNotificationSettings struct {
	InAppEnabled               bool       `json:"in_app_enabled"`
	EmailEnabled               bool       `json:"email_enabled"`
	SlackEnabled               bool       `json:"slack_enabled"`
	SlackWebhookURL            string     `json:"slack_webhook_url,omitempty"`
	SlackConfigured            bool       `json:"slack_configured"`
	SlackUsingEnvironment      bool       `json:"slack_using_environment"`
	TeamsEnabled               bool       `json:"teams_enabled"`
	TeamsWebhookURL            string     `json:"teams_webhook_url,omitempty"`
	TeamsConfigured            bool       `json:"teams_configured"`
	TeamsUsingEnvironment      bool       `json:"teams_using_environment"`
	WebhookEnabled             bool       `json:"webhook_enabled"`
	WebhookURL                 string     `json:"webhook_url,omitempty"`
	WebhookConfigured          bool       `json:"webhook_configured"`
	WebhookUsingEnvironment    bool       `json:"webhook_using_environment"`
	NotifyExpiringAssets       bool       `json:"notify_expiring_assets"`
	NotifyHandovers            bool       `json:"notify_handovers"`
	NotifyBlockedPromotions    bool       `json:"notify_blocked_promotions"`
	NotifyGateApprovalExpiring bool       `json:"notify_gate_approval_expiring"`
	NotifyCost                 bool       `json:"notify_cost"`
	UpdatedAt                  *time.Time `json:"updated_at,omitempty"`
	UpdatedBy                  *int       `json:"updated_by,omitempty"`
	UpdatedByUsername          string     `json:"updated_by_username,omitempty"`
}

func defaultOpsNotificationSettings() opsNotificationSettings {
	settings := opsNotificationSettings{
		InAppEnabled:               true,
		EmailEnabled:               true,
		SlackEnabled:               strings.TrimSpace(SlackWebhookURL) != "",
		TeamsEnabled:               strings.TrimSpace(TeamsWebhookURL) != "",
		WebhookEnabled:             strings.TrimSpace(OpsNotificationWebhookURL) != "",
		NotifyExpiringAssets:       true,
		NotifyHandovers:            true,
		NotifyBlockedPromotions:    true,
		NotifyGateApprovalExpiring: true,
		NotifyCost:                 true,
	}
	settings.applyDerivedConfiguration()
	return settings
}

func (s *opsNotificationSettings) applyDerivedConfiguration() {
	slackURL := strings.TrimSpace(s.SlackWebhookURL)
	teamsURL := strings.TrimSpace(s.TeamsWebhookURL)
	webhookURL := strings.TrimSpace(s.WebhookURL)

	if slackURL == "" && strings.TrimSpace(SlackWebhookURL) != "" {
		s.SlackUsingEnvironment = true
	}
	if teamsURL == "" && strings.TrimSpace(TeamsWebhookURL) != "" {
		s.TeamsUsingEnvironment = true
	}
	if webhookURL == "" && strings.TrimSpace(OpsNotificationWebhookURL) != "" {
		s.WebhookUsingEnvironment = true
	}

	s.SlackConfigured = slackURL != "" || s.SlackUsingEnvironment
	s.TeamsConfigured = teamsURL != "" || s.TeamsUsingEnvironment
	s.WebhookConfigured = webhookURL != "" || s.WebhookUsingEnvironment
}

func (s opsNotificationSettings) effectiveSlackWebhookURL() string {
	if url := strings.TrimSpace(s.SlackWebhookURL); url != "" {
		return url
	}
	return strings.TrimSpace(SlackWebhookURL)
}

func (s opsNotificationSettings) effectiveTeamsWebhookURL() string {
	if url := strings.TrimSpace(s.TeamsWebhookURL); url != "" {
		return url
	}
	return strings.TrimSpace(TeamsWebhookURL)
}

func (s opsNotificationSettings) effectiveWebhookURL() string {
	if url := strings.TrimSpace(s.WebhookURL); url != "" {
		return url
	}
	return strings.TrimSpace(OpsNotificationWebhookURL)
}

func loadOpsNotificationSettings() (opsNotificationSettings, error) {
	settings := defaultOpsNotificationSettings()
	if DB == nil {
		return settings, nil
	}

	var updatedAt sql.NullTime
	var updatedBy sql.NullInt64
	err := queryRowContext(`
		SELECT in_app_enabled,
		       email_enabled,
		       slack_enabled,
		       COALESCE(slack_webhook_url, ''),
		       teams_enabled,
		       COALESCE(teams_webhook_url, ''),
		       webhook_enabled,
		       COALESCE(webhook_url, ''),
		       notify_expiring_assets,
		       COALESCE(notify_handovers, TRUE),
		       notify_blocked_promotions,
		       notify_gate_approval_expiring,
		       COALESCE(notify_cost, TRUE),
		       updated_at,
		       updated_by,
		       COALESCE(u.username, '')
		  FROM ops_notification_settings s
		  LEFT JOIN users u ON u.id = s.updated_by
		 WHERE s.id = 1
	`).Scan(
		&settings.InAppEnabled,
		&settings.EmailEnabled,
		&settings.SlackEnabled,
		&settings.SlackWebhookURL,
		&settings.TeamsEnabled,
		&settings.TeamsWebhookURL,
		&settings.WebhookEnabled,
		&settings.WebhookURL,
		&settings.NotifyExpiringAssets,
		&settings.NotifyHandovers,
		&settings.NotifyBlockedPromotions,
		&settings.NotifyGateApprovalExpiring,
		&settings.NotifyCost,
		&updatedAt,
		&updatedBy,
		&settings.UpdatedByUsername,
	)
	if err != nil {
		if err == sql.ErrNoRows || strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return settings, nil
		}
		return settings, err
	}

	if updatedAt.Valid {
		settings.UpdatedAt = &updatedAt.Time
	}
	if updatedBy.Valid {
		value := int(updatedBy.Int64)
		settings.UpdatedBy = &value
	}
	settings.applyDerivedConfiguration()
	return settings, nil
}

func upsertOpsNotificationSettings(managerID int, settings opsNotificationSettings) (opsNotificationSettings, error) {
	settings.SlackWebhookURL = strings.TrimSpace(settings.SlackWebhookURL)
	settings.TeamsWebhookURL = strings.TrimSpace(settings.TeamsWebhookURL)
	settings.WebhookURL = strings.TrimSpace(settings.WebhookURL)

	if _, err := execContext(`
		INSERT INTO ops_notification_settings (
			id,
			in_app_enabled,
			email_enabled,
			slack_enabled,
			slack_webhook_url,
			teams_enabled,
			teams_webhook_url,
			webhook_enabled,
			webhook_url,
			notify_expiring_assets,
			notify_handovers,
			notify_blocked_promotions,
			notify_gate_approval_expiring,
			notify_cost,
			updated_by,
			updated_at
		) VALUES (
			1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP
		)
		ON CONFLICT (id) DO UPDATE SET
			in_app_enabled = EXCLUDED.in_app_enabled,
			email_enabled = EXCLUDED.email_enabled,
			slack_enabled = EXCLUDED.slack_enabled,
			slack_webhook_url = EXCLUDED.slack_webhook_url,
			teams_enabled = EXCLUDED.teams_enabled,
			teams_webhook_url = EXCLUDED.teams_webhook_url,
			webhook_enabled = EXCLUDED.webhook_enabled,
			webhook_url = EXCLUDED.webhook_url,
			notify_expiring_assets = EXCLUDED.notify_expiring_assets,
			notify_handovers = EXCLUDED.notify_handovers,
			notify_blocked_promotions = EXCLUDED.notify_blocked_promotions,
			notify_gate_approval_expiring = EXCLUDED.notify_gate_approval_expiring,
			notify_cost = EXCLUDED.notify_cost,
			updated_by = EXCLUDED.updated_by,
			updated_at = CURRENT_TIMESTAMP
	`,
		settings.InAppEnabled,
		settings.EmailEnabled,
		settings.SlackEnabled,
		settings.SlackWebhookURL,
		settings.TeamsEnabled,
		settings.TeamsWebhookURL,
		settings.WebhookEnabled,
		settings.WebhookURL,
		settings.NotifyExpiringAssets,
		settings.NotifyHandovers,
		settings.NotifyBlockedPromotions,
		settings.NotifyGateApprovalExpiring,
		settings.NotifyCost,
		managerID,
	); err != nil {
		return settings, err
	}
	return loadOpsNotificationSettings()
}

func isOpsNotificationCategoryEnabled(settings opsNotificationSettings, category string) bool {
	switch strings.TrimSpace(strings.ToLower(category)) {
	case "expiry_tracker_alert":
		return settings.NotifyExpiringAssets
	case "oncall_handover_submitted", "oncall_handover_acknowledged", "oncall_handover_escalated", "oncall_handover_revised", "oncall_handover_reminder":
		return settings.NotifyHandovers
	case "blocked_promotion":
		return settings.NotifyBlockedPromotions
	case "gate_approval_expiring":
		return settings.NotifyGateApprovalExpiring
	case "cost_anomaly", "cost_recommendation", "cost_budget":
		return settings.NotifyCost
	default:
		return true
	}
}

func devopsNotificationSettingsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		settings, err := loadOpsNotificationSettings()
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to load notification settings", err)
			return
		}
		if err := writeJSONResponse(w, http.StatusOK, map[string]any{
			"status":   "ok",
			"settings": settings,
		}); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to write notification settings response", err)
		}
	case http.MethodPatch:
		var body opsNotificationSettings
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid notification settings payload", err)
			return
		}
		settings, err := upsertOpsNotificationSettings(managerID, body)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to save notification settings", err)
			return
		}
		AppendAuditLog(&managerID, "ops_notification_settings_update", "ops_notification_settings", "1", fmt.Sprintf("slack=%t teams=%t webhook=%t", settings.SlackEnabled, settings.TeamsEnabled, settings.WebhookEnabled))
		if err := writeJSONResponse(w, http.StatusOK, map[string]any{
			"status":   "ok",
			"settings": settings,
		}); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to write notification settings response", err)
		}
	default:
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPatch, http.MethodOptions)
	}
}
