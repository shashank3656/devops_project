package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// E18 contract. The adapter is one in-app publication. There is no email,
// phone, Slack, or public status page. Service Status is not changed.
// A delivered receipt is not claimed, because this adapter cannot confirm
// that a person read the notice. Delivery is sent or failed. Failed stays
// visible.
//
// Read is allowed for a viewer or operator with a grant. Preview is a read.
// Approve, publish, and cancel are writes, and a viewer is denied. Another
// project is hidden, including search and export. Approval matches the exact
// body, impact, window, and opted-in audience. A repeated publication key
// does not create a second notice. Cancel records a correction and leaves
// the linked change and incident open. A notice never reports recovery.
// Body text is limited to 200 characters. List reads stay on the existing
// API timeout. No latency target is set because there is no baseline.

const maintenanceBodyLimit = 200

var (
	errMaintenanceHidden  = errors.New("maintenance hidden")
	errMaintenanceDenied  = errors.New("maintenance denied")
	errMaintenanceInvalid = errors.New("maintenance invalid")
)

type maintenanceWindow struct {
	Service  string    `json:"service"`
	Timezone string    `json:"timezone"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
}

type maintenanceSubscriber struct {
	Service  string `json:"service"`
	OptedOut bool   `json:"opted_out"`
}

type maintenanceNotice struct {
	ID                  string    `json:"id"`
	ProjectID           int       `json:"project_id"`
	Service             string    `json:"service"`
	Timezone            string    `json:"timezone"`
	Impact              string    `json:"impact"`
	Body                string    `json:"body"`
	Owner               string    `json:"owner"`
	ChangeID            string    `json:"change_id"`
	IncidentID          string    `json:"incident_id"`
	Start               time.Time `json:"start"`
	End                 time.Time `json:"end"`
	State               string    `json:"state"`
	ApprovedFingerprint string    `json:"-"`
	PublicationKey      string    `json:"-"`
	Publications        int       `json:"publications"`
	Delivery            string    `json:"delivery"`
	Correction          string    `json:"correction"`
	IncidentOpen        bool      `json:"incident_open"`
	ChangeOpen          bool      `json:"change_open"`
	Overlap             string    `json:"overlap,omitempty"`
	AudienceCount       int       `json:"audience_count"`
	Approved            bool      `json:"approved"`
}

func maintenancePublicText(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	if lower == "" || strings.Contains(value, "@") {
		return false
	}
	return !strings.Contains(lower, "password") && !strings.Contains(lower, "secret") && !strings.Contains(lower, "token") && !strings.Contains(lower, "recovered") && !strings.Contains(lower, "healthy")
}

func maintenanceOverlaps(left, right maintenanceWindow) bool {
	if !strings.EqualFold(strings.TrimSpace(left.Service), strings.TrimSpace(right.Service)) {
		return false
	}
	return left.Start.Before(right.End) && right.Start.Before(left.End)
}

func maintenanceAudienceCount(service string, subscribers []maintenanceSubscriber) int {
	count := 0
	wanted := strings.TrimSpace(service)
	for _, subscriber := range subscribers {
		if subscriber.OptedOut {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(subscriber.Service), wanted) {
			count++
		}
	}
	return count
}

func maintenanceFingerprint(notice maintenanceNotice, subscribers []maintenanceSubscriber) string {
	opted := make([]string, 0, len(subscribers))
	for _, subscriber := range subscribers {
		if subscriber.OptedOut || !strings.EqualFold(subscriber.Service, notice.Service) {
			continue
		}
		opted = append(opted, strings.ToLower(strings.TrimSpace(subscriber.Service)))
	}
	sort.Strings(opted)
	return strings.Join([]string{
		strings.TrimSpace(notice.Service),
		strings.TrimSpace(notice.Impact),
		strings.TrimSpace(notice.Body),
		notice.Start.UTC().Format(time.RFC3339),
		notice.End.UTC().Format(time.RFC3339),
		strings.Join(opted, ","),
	}, "|")
}

func reviewMaintenance(notice *maintenanceNotice, others []maintenanceWindow, subscribers []maintenanceSubscriber) error {
	if strings.TrimSpace(notice.Timezone) == "" {
		return errMaintenanceInvalid
	}
	if _, err := time.LoadLocation(notice.Timezone); err != nil {
		return errMaintenanceInvalid
	}
	if !notice.End.After(notice.Start) {
		return errMaintenanceInvalid
	}
	if !maintenancePublicText(notice.Service) || !maintenancePublicText(notice.Impact) || !maintenancePublicText(notice.Body) || !maintenancePublicText(notice.Owner) {
		return errMaintenanceInvalid
	}
	if len(notice.Body) > maintenanceBodyLimit {
		return errMaintenanceInvalid
	}
	notice.Overlap = ""
	current := maintenanceWindow{Service: notice.Service, Timezone: notice.Timezone, Start: notice.Start, End: notice.End}
	for _, other := range others {
		if maintenanceOverlaps(current, other) {
			notice.Overlap = "Windows overlap for " + strings.TrimSpace(notice.Service)
			break
		}
	}
	notice.AudienceCount = maintenanceAudienceCount(notice.Service, subscribers)
	fingerprint := maintenanceFingerprint(*notice, subscribers)
	if notice.ApprovedFingerprint != "" && notice.ApprovedFingerprint != fingerprint {
		notice.ApprovedFingerprint = ""
		notice.Approved = false
		if notice.State == "published" || notice.State == "reviewed" {
			notice.State = "corrected"
			notice.Correction = "corrected:" + notice.ID
		}
	}
	if notice.State == "" || notice.State == "draft" {
		notice.State = "reviewed"
	}
	notice.IncidentOpen = true
	notice.ChangeOpen = true
	return nil
}

func approveMaintenance(notice *maintenanceNotice, subscribers []maintenanceSubscriber, memberAllowed, projectAllowed bool) error {
	if !projectAllowed {
		return errMaintenanceHidden
	}
	if !memberAllowed {
		return errMaintenanceDenied
	}
	if notice.State == "cancelled" || notice.State == "" {
		return errMaintenanceInvalid
	}
	notice.ApprovedFingerprint = maintenanceFingerprint(*notice, subscribers)
	notice.Approved = true
	if notice.State == "corrected" || notice.State == "draft" || notice.State == "reviewed" {
		notice.State = "reviewed"
	}
	return nil
}

func publishMaintenance(notice *maintenanceNotice, key string, providerFailed, memberAllowed, projectAllowed bool) error {
	if !projectAllowed {
		return errMaintenanceHidden
	}
	if !memberAllowed {
		return errMaintenanceDenied
	}
	key = strings.TrimSpace(key)
	if key == "" || !notice.Approved {
		return errMaintenanceInvalid
	}
	if notice.PublicationKey == key && notice.Publications > 0 {
		return nil
	}
	notice.PublicationKey = key
	notice.Publications = 1
	notice.State = "published"
	if providerFailed {
		notice.Delivery = "failed"
		return nil
	}
	notice.Delivery = "sent"
	return nil
}

func cancelMaintenance(notice *maintenanceNotice, memberAllowed, projectAllowed bool) error {
	if !projectAllowed {
		return errMaintenanceHidden
	}
	if !memberAllowed {
		return errMaintenanceDenied
	}
	notice.State = "cancelled"
	notice.Approved = false
	notice.Correction = "cancelled:" + notice.ID
	return nil
}

func readMaintenance(notice *maintenanceNotice, projectAllowed bool) (*maintenanceNotice, error) {
	if notice == nil || !projectAllowed || notice.ProjectID <= 0 {
		return nil, errMaintenanceHidden
	}
	copy := *notice
	return &copy, nil
}

func searchMaintenance(notices []maintenanceNotice, projectID int, projectAllowed bool) []maintenanceNotice {
	if !projectAllowed {
		return nil
	}
	visible := make([]maintenanceNotice, 0, len(notices))
	for _, notice := range notices {
		if notice.ProjectID == projectID {
			visible = append(visible, notice)
		}
	}
	return visible
}

type maintenanceStore struct {
	mu      sync.Mutex
	notices map[string]maintenanceNotice
}

var maintenanceNotices = &maintenanceStore{notices: map[string]maintenanceNotice{}}

func maintenanceNoticeHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	subject := authzSubjectForUser(userID)
	projectID, environment, action, notice, subscribers, err := readMaintenanceRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
		return
	}
	write := action == "approve" || action == "publish" || action == "cancel"
	decision := authorizeResource(authzRequest{
		Subject: subject,
		Resource: authzResource{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Environment:    environment,
			Kind:           "maintenance",
			ResourceID:     notice.ID,
		},
		Action: map[bool]authzAction{true: authzWrite, false: authzRead}[write],
	})
	if !decision.Allowed {
		status := http.StatusNotFound
		if write && decision.Reason == "role cannot perform this action" {
			status = http.StatusForbidden
		}
		writeAPIError(w, r, status, "Maintenance notices are not available for this scope.", nil)
		return
	}
	notice.ProjectID = projectID
	switch action {
	case "", "read":
		maintenanceNotices.mu.Lock()
		stored, found := maintenanceNotices.notices[notice.ID]
		maintenanceNotices.mu.Unlock()
		if !found {
			writeJSON(w, http.StatusOK, map[string]interface{}{"state": "empty", "notice": maintenanceNotice{State: "draft", IncidentOpen: true, ChangeOpen: true}})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"state": stored.State, "notice": stored})
	case "preview":
		if err := reviewMaintenance(&notice, nil, subscribers); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "preview", "approved": false, "notice": notice})
	case "approve":
		if err := reviewMaintenance(&notice, nil, subscribers); err != nil || approveMaintenance(&notice, subscribers, true, true) != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		maintenanceNotices.mu.Lock()
		maintenanceNotices.notices[notice.ID] = notice
		maintenanceNotices.mu.Unlock()
		persistMaintenanceNotice(projectID, environment, notice)
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "reviewed", "approved": true, "notice": notice})
	case "publish":
		maintenanceNotices.mu.Lock()
		stored, found := maintenanceNotices.notices[notice.ID]
		if !found {
			stored = notice
		}
		publishErr := publishMaintenance(&stored, notice.ID, false, true, true)
		if publishErr == nil {
			maintenanceNotices.notices[notice.ID] = stored
		}
		maintenanceNotices.mu.Unlock()
		if publishErr != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": stored.Delivery, "notice": stored})
	case "cancel":
		maintenanceNotices.mu.Lock()
		stored, found := maintenanceNotices.notices[notice.ID]
		if !found {
			stored = notice
		}
		stored.IncidentOpen = true
		stored.ChangeOpen = true
		cancelErr := cancelMaintenance(&stored, true, true)
		if cancelErr == nil {
			maintenanceNotices.notices[notice.ID] = stored
		}
		maintenanceNotices.mu.Unlock()
		if cancelErr != nil {
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		persistMaintenanceNotice(projectID, environment, stored)
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "cancelled", "notice": stored})
	default:
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
	}
}

func readMaintenanceRequest(r *http.Request) (int, string, string, maintenanceNotice, []maintenanceSubscriber, error) {
	var body struct {
		ProjectID   int                     `json:"project_id"`
		Environment string                  `json:"environment"`
		Action      string                  `json:"action"`
		Notice      maintenanceNotice       `json:"notice"`
		Subscribers []maintenanceSubscriber `json:"subscribers"`
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, part := range []byte(r.URL.Query().Get("project_id")) {
			if part < '0' || part > '9' {
				return 0, "", "", maintenanceNotice{}, nil, errMaintenanceInvalid
			}
			projectID = projectID*10 + int(part-'0')
		}
		environment := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("environment")))
		id := strings.TrimSpace(r.URL.Query().Get("notice_id"))
		if projectID <= 0 || !singleEnvironment(environment) || id == "" {
			return 0, "", "", maintenanceNotice{}, nil, errMaintenanceInvalid
		}
		return projectID, environment, "read", maintenanceNotice{ID: id, ProjectID: projectID}, nil, nil
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return 0, "", "", maintenanceNotice{}, nil, errMaintenanceInvalid
	}
	environment := strings.ToLower(strings.TrimSpace(body.Environment))
	if body.ProjectID <= 0 || !singleEnvironment(environment) || strings.TrimSpace(body.Notice.ID) == "" {
		return 0, "", "", maintenanceNotice{}, nil, errMaintenanceInvalid
	}
	return body.ProjectID, environment, strings.ToLower(strings.TrimSpace(body.Action)), body.Notice, body.Subscribers, nil
}

func persistMaintenanceNotice(projectID int, environment string, notice maintenanceNotice) {
	if DB == nil {
		return
	}
	raw, err := json.Marshal(notice)
	if err != nil {
		return
	}
	_, _ = DB.Exec(`
		INSERT INTO maintenance_notices (project_id, environment, notice_id, state, payload)
		VALUES ($1, $2, $3, $4, $5)
	`, projectID, environment, notice.ID, notice.State, string(raw))
}

func migrateMaintenanceNoticeSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS maintenance_notices (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(80) NOT NULL,
			notice_id VARCHAR(120) NOT NULL,
			state VARCHAR(20) NOT NULL,
			payload TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
}
