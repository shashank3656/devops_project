package main

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type OpsNotificationItem struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	Title       string    `json:"title"`
	Message     string    `json:"message"`
	CreatedAt   time.Time `json:"created_at"`
	RequestID   *int      `json:"request_id,omitempty"`
	ProjectID   *int      `json:"project_id,omitempty"`
	ProjectName string    `json:"project_name,omitempty"`
	ProjectCode string    `json:"project_code,omitempty"`
	Status      string    `json:"status,omitempty"`
	Action      string    `json:"action,omitempty"`
}

func buildPendingRequestNotification(req PRRequest, kind string) OpsNotificationItem {
	titlePrefix := "Approval required"
	if kind == "pending_approval" {
		titlePrefix = "DevOps approval required"
	}
	title := fmt.Sprintf("%s: Request #%d", titlePrefix, req.ID)
	if req.ProjectName != "" {
		title = fmt.Sprintf("%s: %s", titlePrefix, req.ProjectName)
	}
	message := fmt.Sprintf("%s / %s / %s %s", req.Team, req.Env, req.Cloud, req.Service)
	if req.ProjectName != "" {
		message = fmt.Sprintf("%s (%s) - %s", req.ProjectName, req.ProjectCode, message)
	}
	requestID := req.ID
	return OpsNotificationItem{
		ID:          fmt.Sprintf("request-%d", req.ID),
		Kind:        kind,
		Title:       title,
		Message:     message,
		CreatedAt:   req.CreatedAt,
		RequestID:   &requestID,
		ProjectID:   req.ProjectID,
		ProjectName: req.ProjectName,
		ProjectCode: req.ProjectCode,
		Status:      req.Status,
	}
}

func buildAuditNotification(entry AuditLogEntry) OpsNotificationItem {
	title := "Project event"
	switch entry.Action {
	case "project_create":
		title = "Project created"
	case "project_update":
		title = "Project updated"
	case "project_lifecycle":
		title = "Project lifecycle changed"
	}
	message := entry.Details
	if entry.ProjectName != "" {
		message = fmt.Sprintf("%s (%s) - %s", entry.ProjectName, entry.ProjectCode, entry.Details)
	}
	return OpsNotificationItem{
		ID:          fmt.Sprintf("audit-%d", entry.ID),
		Kind:        "project_event",
		Title:       title,
		Message:     message,
		CreatedAt:   entry.CreatedAt,
		ProjectID:   entry.ProjectID,
		ProjectName: entry.ProjectName,
		ProjectCode: entry.ProjectCode,
		Action:      entry.Action,
	}
}

func getProjectAuditNotificationEntries(limit int, projectID int) ([]AuditLogEntry, error) {
	entries, err := GetAuditLogs(limit, 0, "", "", "", projectID)
	if err != nil {
		return nil, err
	}
	filtered := make([]AuditLogEntry, 0, len(entries))
	for _, entry := range entries {
		switch entry.Action {
		case "project_create", "project_update", "project_lifecycle":
			filtered = append(filtered, entry)
		}
	}
	return filtered, nil
}

func paginateOpsNotifications(items []OpsNotificationItem, limit, offset int) []OpsNotificationItem {
	if offset >= len(items) {
		return []OpsNotificationItem{}
	}
	end := len(items)
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return items[offset:end]
}

func buildAdminNotifications(limit, offset, projectID int, kind string) (map[string]interface{}, error) {
	requests, err := GetPRRequests("", "", "", projectID, "pending_any", "", "", 0, 0, nil, 250, 0, "", "", false, "", "")
	if err != nil {
		return nil, err
	}
	projectEvents, err := getProjectAuditNotificationEntries(250, projectID)
	if err != nil {
		return nil, err
	}

	pendingItems := make([]OpsNotificationItem, 0, len(requests))
	for _, req := range requests {
		pendingItems = append(pendingItems, buildPendingRequestNotification(req, "pending_request"))
	}
	projectItems := make([]OpsNotificationItem, 0, len(projectEvents))
	for _, entry := range projectEvents {
		projectItems = append(projectItems, buildAuditNotification(entry))
	}

	allItems := make([]OpsNotificationItem, 0, len(pendingItems)+len(projectItems))
	if kind == "" || kind == "all" || kind == "pending_request" {
		allItems = append(allItems, pendingItems...)
	}
	if kind == "" || kind == "all" || kind == "project_event" {
		allItems = append(allItems, projectItems...)
	}
	sort.Slice(allItems, func(i, j int) bool {
		return allItems[i].CreatedAt.After(allItems[j].CreatedAt)
	})

	return map[string]interface{}{
		"status":       "ok",
		"new_requests": len(pendingItems),
		"items":        paginateOpsNotifications(allItems, limit, offset),
		"total_count":  len(allItems),
		"counts_by_kind": map[string]int{
			"all":             len(pendingItems) + len(projectItems),
			"pending_request": len(pendingItems),
			"project_event":   len(projectItems),
		},
	}, nil
}

func buildDevopsNotifications(limit, offset, projectID int, kind string) (map[string]interface{}, error) {
	requests, err := GetPRRequests("", "", "", projectID, "pending_devops_approval", "", "", 0, 0, nil, 250, 0, "", "", false, "", "")
	if err != nil {
		return nil, err
	}
	projectEvents, err := getProjectAuditNotificationEntries(250, projectID)
	if err != nil {
		return nil, err
	}

	pendingItems := make([]OpsNotificationItem, 0, len(requests))
	for _, req := range requests {
		pendingItems = append(pendingItems, buildPendingRequestNotification(req, "pending_approval"))
	}
	projectItems := make([]OpsNotificationItem, 0, len(projectEvents))
	for _, entry := range projectEvents {
		projectItems = append(projectItems, buildAuditNotification(entry))
	}

	allItems := make([]OpsNotificationItem, 0, len(pendingItems)+len(projectItems))
	if kind == "" || kind == "all" || kind == "pending_approval" {
		allItems = append(allItems, pendingItems...)
	}
	if kind == "" || kind == "all" || kind == "project_event" {
		allItems = append(allItems, projectItems...)
	}
	sort.Slice(allItems, func(i, j int) bool {
		return allItems[i].CreatedAt.After(allItems[j].CreatedAt)
	})

	return map[string]interface{}{
		"status":                 "ok",
		"pending_approval_count": len(pendingItems),
		"items":                  paginateOpsNotifications(allItems, limit, offset),
		"total_count":            len(allItems),
		"counts_by_kind": map[string]int{
			"all":              len(pendingItems) + len(projectItems),
			"pending_approval": len(pendingItems),
			"project_event":    len(projectItems),
		},
	}, nil
}

func parseOpsNotificationFilters(rawLimit, rawOffset, rawProjectID, rawKind string) (int, int, int, string) {
	limit := 20
	offset := 0
	projectID := 0
	if parsed, err := strconv.Atoi(strings.TrimSpace(rawLimit)); err == nil && parsed > 0 && parsed <= 100 {
		limit = parsed
	}
	if parsed, err := strconv.Atoi(strings.TrimSpace(rawOffset)); err == nil && parsed >= 0 {
		offset = parsed
	}
	if parsed, err := strconv.Atoi(strings.TrimSpace(rawProjectID)); err == nil && parsed > 0 {
		projectID = parsed
	}
	var kind string
	switch strings.TrimSpace(strings.ToLower(rawKind)) {
	case "", "all":
		kind = "all"
	case "pending_request":
		kind = "pending_request"
	case "pending_approval":
		kind = "pending_approval"
	case "project_event":
		kind = "project_event"
	default:
		kind = "all"
	}
	return limit, offset, projectID, kind
}
