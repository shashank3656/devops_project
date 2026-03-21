package main

import (
	"net/http"
	"sort"
	"strings"
	"time"
)

type opsAnalyticsSummary struct {
	ActiveApprovals            int `json:"active_approvals"`
	ExpiredApprovals           int `json:"expired_approvals"`
	RevokedApprovals           int `json:"revoked_approvals"`
	ApprovalsExpiring24h       int `json:"approvals_expiring_24h"`
	NotificationsLast7Days     int `json:"notifications_last_7_days"`
	NotificationsLast30Days    int `json:"notifications_last_30_days"`
	BlockedPromotionAlerts     int `json:"blocked_promotion_alerts"`
	ExpiryTrackerAlerts        int `json:"expiry_tracker_alerts"`
	GateApprovalExpiringAlerts int `json:"gate_approval_expiring_alerts"`
}

type opsAnalyticsTrendPoint struct {
	Label              string `json:"label"`
	ApprovalCount      int    `json:"approval_count"`
	NotificationCount  int    `json:"notification_count"`
	BlockedAlertCount  int    `json:"blocked_alert_count"`
	ExpiryAlertCount   int    `json:"expiry_alert_count"`
}

type opsAnalyticsCount struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

type opsAnalyticsRecentEvent struct {
	ID        int       `json:"id"`
	EventKey  string    `json:"event_key"`
	Category  string    `json:"category"`
	Target    string    `json:"target"`
	CreatedAt time.Time `json:"created_at"`
}

type opsAnalyticsPayload struct {
	Summary             opsAnalyticsSummary       `json:"summary"`
	ApprovalTrend       []opsAnalyticsTrendPoint  `json:"approval_trend"`
	NotificationTrend   []opsAnalyticsTrendPoint  `json:"notification_trend"`
	ApprovalsByEnv      []opsAnalyticsCount       `json:"approvals_by_environment"`
	ApprovalsByApprover []opsAnalyticsCount       `json:"approvals_by_approver"`
	NotificationsByType []opsAnalyticsCount       `json:"notifications_by_type"`
	RecentEvents        []opsAnalyticsRecentEvent `json:"recent_events"`
	Settings            opsNotificationSettings   `json:"settings"`
}

func buildOpsAnalyticsPayload() (*opsAnalyticsPayload, error) {
	payload := &opsAnalyticsPayload{
		ApprovalTrend:       make([]opsAnalyticsTrendPoint, 0, 14),
		NotificationTrend:   make([]opsAnalyticsTrendPoint, 0, 14),
		ApprovalsByEnv:      make([]opsAnalyticsCount, 0),
		ApprovalsByApprover: make([]opsAnalyticsCount, 0),
		NotificationsByType: make([]opsAnalyticsCount, 0),
		RecentEvents:        make([]opsAnalyticsRecentEvent, 0),
	}
	settings, err := loadOpsNotificationSettings()
	if err != nil {
		return nil, err
	}
	payload.Settings = settings
	if DB == nil {
		return payload, nil
	}

	if err := queryRowContext(`
		SELECT
			COALESCE(SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at > CURRENT_TIMESTAMP AND expires_at <= CURRENT_TIMESTAMP + INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)
		FROM deployment_gate_approvals
	`).Scan(
		&payload.Summary.ActiveApprovals,
		&payload.Summary.ExpiredApprovals,
		&payload.Summary.RevokedApprovals,
		&payload.Summary.ApprovalsExpiring24h,
	); err != nil && !strings.Contains(strings.ToLower(err.Error()), "does not exist") {
		return nil, err
	}

	if err := queryRowContext(`
		SELECT
			COALESCE(SUM(CASE WHEN created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN category = 'blocked_promotion' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN category = 'expiry_tracker_alert' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN category = 'gate_approval_expiring' THEN 1 ELSE 0 END), 0)
		FROM ops_notification_events
	`).Scan(
		&payload.Summary.NotificationsLast7Days,
		&payload.Summary.NotificationsLast30Days,
		&payload.Summary.BlockedPromotionAlerts,
		&payload.Summary.ExpiryTrackerAlerts,
		&payload.Summary.GateApprovalExpiringAlerts,
	); err != nil && !strings.Contains(strings.ToLower(err.Error()), "does not exist") {
		return nil, err
	}

	approvalTrendMap := make(map[string]*opsAnalyticsTrendPoint, 14)
	notificationTrendMap := make(map[string]*opsAnalyticsTrendPoint, 14)
	for day := 13; day >= 0; day-- {
		label := time.Now().AddDate(0, 0, -day).Format("02 Jan")
		approvalTrendMap[label] = &opsAnalyticsTrendPoint{Label: label}
		notificationTrendMap[label] = &opsAnalyticsTrendPoint{Label: label}
	}

	if rows, cancel, err := queryRowsWithTimeout(`
		SELECT TO_CHAR(DATE_TRUNC('day', approved_at), 'DD Mon') AS label, COUNT(*)
		FROM deployment_gate_approvals
		WHERE approved_at >= CURRENT_TIMESTAMP - INTERVAL '14 days'
		GROUP BY 1
		ORDER BY MIN(approved_at)
	`); err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var label string
			var count int
			if scanErr := rows.Scan(&label, &count); scanErr != nil {
				return nil, scanErr
			}
			if point, ok := approvalTrendMap[label]; ok {
				point.ApprovalCount = count
			}
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return nil, rowsErr
		}
	}

	if rows, cancel, err := queryRowsWithTimeout(`
		SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'DD Mon') AS label,
		       COUNT(*),
		       COALESCE(SUM(CASE WHEN category = 'blocked_promotion' THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN category = 'expiry_tracker_alert' THEN 1 ELSE 0 END), 0)
		FROM ops_notification_events
		WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '14 days'
		GROUP BY 1
		ORDER BY MIN(created_at)
	`); err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var label string
			var count int
			var blocked int
			var expiry int
			if scanErr := rows.Scan(&label, &count, &blocked, &expiry); scanErr != nil {
				return nil, scanErr
			}
			if point, ok := notificationTrendMap[label]; ok {
				point.NotificationCount = count
				point.BlockedAlertCount = blocked
				point.ExpiryAlertCount = expiry
			}
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return nil, rowsErr
		}
	}

	for day := 13; day >= 0; day-- {
		label := time.Now().AddDate(0, 0, -day).Format("02 Jan")
		payload.ApprovalTrend = append(payload.ApprovalTrend, *approvalTrendMap[label])
		payload.NotificationTrend = append(payload.NotificationTrend, *notificationTrendMap[label])
	}

	if rows, cancel, err := queryRowsWithTimeout(`
		SELECT LOWER(COALESCE(target_environment, 'unknown')), COUNT(*)
		FROM deployment_gate_approvals
		GROUP BY 1
		ORDER BY COUNT(*) DESC, 1 ASC
	`); err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var key string
			var count int
			if scanErr := rows.Scan(&key, &count); scanErr != nil {
				return nil, scanErr
			}
			payload.ApprovalsByEnv = append(payload.ApprovalsByEnv, opsAnalyticsCount{Key: key, Label: strings.ToUpper(key), Count: count})
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return nil, rowsErr
		}
	}

	if rows, cancel, err := queryRowsWithTimeout(`
		SELECT COALESCE(u.username, CONCAT('user-', a.approved_by::text)), COUNT(*)
		FROM deployment_gate_approvals a
		LEFT JOIN users u ON u.id = a.approved_by
		GROUP BY 1
		ORDER BY COUNT(*) DESC, 1 ASC
		LIMIT 8
	`); err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var label string
			var count int
			if scanErr := rows.Scan(&label, &count); scanErr != nil {
				return nil, scanErr
			}
			payload.ApprovalsByApprover = append(payload.ApprovalsByApprover, opsAnalyticsCount{Key: strings.ToLower(label), Label: label, Count: count})
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return nil, rowsErr
		}
	}

	if rows, cancel, err := queryRowsWithTimeout(`
		SELECT COALESCE(category, 'unknown'), COUNT(*)
		FROM ops_notification_events
		WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
		GROUP BY 1
		ORDER BY COUNT(*) DESC, 1 ASC
	`); err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var key string
			var count int
			if scanErr := rows.Scan(&key, &count); scanErr != nil {
				return nil, scanErr
			}
			payload.NotificationsByType = append(payload.NotificationsByType, opsAnalyticsCount{Key: key, Label: strings.ReplaceAll(key, "_", " "), Count: count})
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return nil, rowsErr
		}
	}

	if rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, COALESCE(event_key, ''), COALESCE(category, ''), COALESCE(target, ''), created_at
		FROM ops_notification_events
		ORDER BY created_at DESC, id DESC
		LIMIT 25
	`); err == nil {
		defer cancel()
		defer rows.Close()
		for rows.Next() {
			var event opsAnalyticsRecentEvent
			if scanErr := rows.Scan(&event.ID, &event.EventKey, &event.Category, &event.Target, &event.CreatedAt); scanErr != nil {
				return nil, scanErr
			}
			payload.RecentEvents = append(payload.RecentEvents, event)
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return nil, rowsErr
		}
	}

	sort.Slice(payload.NotificationsByType, func(i, j int) bool {
		if payload.NotificationsByType[i].Count == payload.NotificationsByType[j].Count {
			return payload.NotificationsByType[i].Label < payload.NotificationsByType[j].Label
		}
		return payload.NotificationsByType[i].Count > payload.NotificationsByType[j].Count
	})
	return payload, nil
}

func devopsApprovalNotificationAnalyticsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodOptions)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}

	payload, err := buildOpsAnalyticsPayload()
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to build approval and notification analytics", err)
		return
	}
	if err := writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"analytics": payload,
	}); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to write approval and notification analytics response", err)
	}
}
