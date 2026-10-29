package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

// E16 contract. The first adapter is an in-app delivery attempt. Phone numbers,
// email addresses, and secret values are not stored or returned. A schedule
// version is previewed before it is activated. Acknowledgement deadline is
// supplied by the policy; a missing deadline does not dispatch. Unreachable
// delivery stays a failure and is not acknowledgement. At most five steps.
// List reads stay on the existing API timeout. One logical notification exists
// per episode and step key.

const oncallMaxSteps = 5

var (
	errOncallHidden     = errors.New("on-call hidden")
	errOncallDenied     = errors.New("on-call denied")
	errOncallInvalid    = errors.New("on-call invalid")
	errOncallNeedBackup = errors.New("mission-critical teams need a primary and a different backup")
)

type oncallShift struct {
	Role  string    `json:"role"`
	Name  string    `json:"name"`
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

type oncallOverride struct {
	Name   string    `json:"name"`
	Start  time.Time `json:"start"`
	End    time.Time `json:"end"`
	Actor  string    `json:"actor"`
	Reason string    `json:"reason"`
}

type oncallGap struct {
	Start  time.Time `json:"start"`
	End    time.Time `json:"end"`
	Reason string    `json:"reason"`
}

type oncallVersion struct {
	Timezone  string           `json:"timezone"`
	Shifts    []oncallShift    `json:"shifts"`
	Overrides []oncallOverride `json:"overrides"`
	Gaps      []oncallGap      `json:"gaps"`
}

type oncallResolution struct {
	State  string `json:"state"`
	Name   string `json:"name,omitempty"`
	Role   string `json:"role,omitempty"`
	Next   string `json:"next,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type oncallStep struct {
	Key        string `json:"key"`
	Name       string `json:"name"`
	State      string `json:"state"`
	Attempts   int    `json:"attempts"`
	Dispatched bool   `json:"dispatched"`
}

type oncallEpisode struct {
	Key          string       `json:"key"`
	ProjectID    int          `json:"project_id"`
	Acknowledged bool         `json:"acknowledged"`
	Resolved     bool         `json:"resolved"`
	Steps        []oncallStep `json:"steps"`
}

func oncallPublicName(name string) (string, bool) {
	trimmed := strings.TrimSpace(name)
	lower := strings.ToLower(trimmed)
	if trimmed == "" || strings.Contains(trimmed, "@") || strings.Contains(lower, "phone") || strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") {
		return "", false
	}
	return trimmed, true
}

func oncallContains(start, end, at time.Time) bool {
	return !at.Before(start) && at.Before(end)
}

func resolveOncall(at time.Time, version oncallVersion) oncallResolution {
	if strings.TrimSpace(version.Timezone) == "" {
		return oncallResolution{State: "gap", Reason: "timezone missing"}
	}
	if _, err := time.LoadLocation(version.Timezone); err != nil {
		return oncallResolution{State: "gap", Reason: "timezone invalid"}
	}
	for _, gap := range version.Gaps {
		if oncallContains(gap.Start, gap.End, at) {
			reason := strings.TrimSpace(gap.Reason)
			if reason == "" {
				reason = "uncovered period"
			}
			return oncallResolution{State: "gap", Reason: reason}
		}
	}
	overrides := make([]oncallOverride, 0, 2)
	for _, item := range version.Overrides {
		if oncallContains(item.Start, item.End, at) {
			overrides = append(overrides, item)
		}
	}
	if len(overrides) > 1 {
		return oncallResolution{State: "gap", Reason: "overlapping override"}
	}
	if len(overrides) == 1 {
		name, ok := oncallPublicName(overrides[0].Name)
		if !ok {
			return oncallResolution{State: "gap", Reason: "responder name is not public"}
		}
		return oncallResolution{State: "responder", Name: name, Role: "override", Next: nextOncallName(at, version)}
	}
	primaries := matchingShifts(at, version.Shifts, "primary")
	if len(primaries) > 1 {
		return oncallResolution{State: "gap", Reason: "overlapping primary"}
	}
	if len(primaries) == 1 {
		name, ok := oncallPublicName(primaries[0].Name)
		if !ok {
			return oncallResolution{State: "gap", Reason: "responder name is not public"}
		}
		return oncallResolution{State: "responder", Name: name, Role: "primary", Next: nextOncallName(at, version)}
	}
	backups := matchingShifts(at, version.Shifts, "backup")
	if len(backups) == 1 {
		name, ok := oncallPublicName(backups[0].Name)
		if !ok {
			return oncallResolution{State: "gap", Reason: "responder name is not public"}
		}
		return oncallResolution{State: "responder", Name: name, Role: "backup", Next: nextOncallName(at, version)}
	}
	return oncallResolution{State: "gap", Reason: "no coverage"}
}

func matchingShifts(at time.Time, shifts []oncallShift, role string) []oncallShift {
	matched := make([]oncallShift, 0, 1)
	for _, shift := range shifts {
		if strings.EqualFold(shift.Role, role) && oncallContains(shift.Start, shift.End, at) {
			matched = append(matched, shift)
		}
	}
	return matched
}

func nextOncallName(at time.Time, version oncallVersion) string {
	var next time.Time
	name := ""
	for _, shift := range version.Shifts {
		if !shift.Start.After(at) {
			continue
		}
		public, ok := oncallPublicName(shift.Name)
		if !ok {
			continue
		}
		if name == "" || shift.Start.Before(next) {
			next = shift.Start
			name = public
		}
	}
	return name
}

func acknowledgeOncall(episode *oncallEpisode) {
	episode.Acknowledged = true
	for i := range episode.Steps {
		if episode.Steps[i].State == "queued" {
			episode.Steps[i].State = "cancelled"
		}
	}
}

func resolveOncallEpisode(episode *oncallEpisode) {
	episode.Resolved = true
	acknowledgeOncall(episode)
}

func dispatchOncallStep(episode *oncallEpisode, index int, memberAllowed, projectAllowed bool) error {
	if !projectAllowed {
		return errOncallHidden
	}
	if !memberAllowed {
		return errOncallDenied
	}
	if index < 0 || index >= len(episode.Steps) || len(episode.Steps) > oncallMaxSteps {
		return errOncallInvalid
	}
	if episode.Acknowledged || episode.Resolved {
		for i := range episode.Steps {
			if episode.Steps[i].State == "queued" {
				episode.Steps[i].State = "cancelled"
			}
		}
		return nil
	}
	step := &episode.Steps[index]
	if step.State == "sent" || step.State == "failed" || step.State == "cancelled" {
		return nil
	}
	step.State = "sent"
	step.Dispatched = true
	step.Attempts++
	return nil
}

func failOncallDelivery(episode *oncallEpisode, index int) {
	if index < 0 || index >= len(episode.Steps) {
		return
	}
	if episode.Steps[index].State == "sent" {
		episode.Steps[index].State = "failed"
	}
	episode.Acknowledged = false
}

func advanceOncall(episode *oncallEpisode) int {
	if episode.Acknowledged || episode.Resolved {
		return -1
	}
	for i := range episode.Steps {
		if episode.Steps[i].State == "queued" {
			return i
		}
	}
	return -1
}

type oncallStore struct {
	mu       sync.Mutex
	versions map[string]oncallVersion
	episodes map[string]oncallEpisode
}

var coverageStore = &oncallStore{
	versions: map[string]oncallVersion{},
	episodes: map[string]oncallEpisode{},
}

func coverageKey(projectID int, environment string) string {
	return strings.TrimSpace(environment) + ":" + itoa(projectID)
}

func snapshotOncallCoverage() (map[string]oncallVersion, map[string]oncallEpisode) {
	coverageStore.mu.Lock()
	defer coverageStore.mu.Unlock()
	versions := make(map[string]oncallVersion, len(coverageStore.versions))
	for key, version := range coverageStore.versions {
		versions[key] = version
	}
	episodes := make(map[string]oncallEpisode, len(coverageStore.episodes))
	for key, episode := range coverageStore.episodes {
		steps := make([]oncallStep, len(episode.Steps))
		copy(steps, episode.Steps)
		episode.Steps = steps
		episodes[key] = episode
	}
	return versions, episodes
}

func replaceOncallCoverage(versions map[string]oncallVersion, episodes map[string]oncallEpisode) {
	coverageStore.mu.Lock()
	defer coverageStore.mu.Unlock()
	if versions == nil {
		versions = map[string]oncallVersion{}
	}
	if episodes == nil {
		episodes = map[string]oncallEpisode{}
	}
	coverageStore.versions = versions
	coverageStore.episodes = episodes
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	digits := []byte{}
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	if negative {
		digits = append([]byte{'-'}, digits...)
	}
	return string(digits)
}

func oncallCoverageHandler(w http.ResponseWriter, r *http.Request) {
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
	projectID, environment, action, version, episode, err := readOncallRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
		return
	}
	write := action == "activate" || action == "dispatch" || action == "acknowledge"
	decision := authorizeResource(authzRequest{
		Subject: subject,
		Resource: authzResource{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Environment:    environment,
			Kind:           "on-call",
			ResourceID:     coverageKey(projectID, environment),
		},
		Action: map[bool]authzAction{true: authzWrite, false: authzRead}[write],
	})
	if !decision.Allowed {
		status := http.StatusNotFound
		if write && decision.Reason == "role cannot perform this action" {
			status = http.StatusForbidden
		}
		writeAPIError(w, r, status, "On-call coverage is not available for this scope.", nil)
		return
	}
	switch action {
	case "", "read":
		writeOncallRead(w, projectID, environment)
	case "preview":
		resolution := resolveOncall(time.Now().UTC(), version)
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "preview", "activated": false, "resolution": resolution})
	case "activate":
		if strings.TrimSpace(version.Timezone) == "" {
			writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
			return
		}
		coverageStore.mu.Lock()
		coverageStore.versions[coverageKey(projectID, environment)] = version
		coverageStore.mu.Unlock()
		persistOncallVersion(projectID, environment, version)
		resolution := resolveOncall(time.Now().UTC(), version)
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "active", "activated": true, "resolution": resolution})
	case "dispatch":
		if err := dispatchStoredEpisode(&episode, true); err != nil {
			status := http.StatusForbidden
			if errors.Is(err, errOncallHidden) {
				status = http.StatusNotFound
			}
			writeAPIError(w, r, status, "On-call coverage is not available for this scope.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok", "episode": publicEpisode(episode)})
	case "acknowledge":
		acknowledgeStored(episode.Key)
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "acknowledged"})
	default:
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", nil)
	}
}

func writeOncallRead(w http.ResponseWriter, projectID int, environment string) {
	coverageStore.mu.Lock()
	version, ok := coverageStore.versions[coverageKey(projectID, environment)]
	coverageStore.mu.Unlock()
	if !ok {
		writeJSON(w, http.StatusOK, map[string]interface{}{"state": "empty", "resolution": oncallResolution{State: "empty", Reason: "No schedule is active for this project."}})
		return
	}
	resolution := resolveOncall(time.Now().UTC(), version)
	writeJSON(w, http.StatusOK, map[string]interface{}{"state": resolution.State, "resolution": resolution})
}

func publicEpisode(episode oncallEpisode) oncallEpisode {
	for i := range episode.Steps {
		name, ok := oncallPublicName(episode.Steps[i].Name)
		if !ok {
			episode.Steps[i].Name = "Unknown"
		} else {
			episode.Steps[i].Name = name
		}
	}
	return episode
}

func dispatchStoredEpisode(episode *oncallEpisode, allowed bool) error {
	coverageStore.mu.Lock()
	defer coverageStore.mu.Unlock()
	if current, ok := coverageStore.episodes[episode.Key]; ok {
		*episode = current
	}
	index := advanceOncall(episode)
	if index < 0 {
		return nil
	}
	if err := dispatchOncallStep(episode, index, allowed, allowed); err != nil {
		return err
	}
	coverageStore.episodes[episode.Key] = *episode
	persistOncallStep(episode.ProjectID, episode.Key, episode.Steps[index])
	return nil
}

func acknowledgeStored(key string) {
	coverageStore.mu.Lock()
	defer coverageStore.mu.Unlock()
	episode, ok := coverageStore.episodes[key]
	if !ok {
		return
	}
	acknowledgeOncall(&episode)
	coverageStore.episodes[key] = episode
}

func readOncallRequest(r *http.Request) (int, string, string, oncallVersion, oncallEpisode, error) {
	var body struct {
		ProjectID   int           `json:"project_id"`
		Environment string        `json:"environment"`
		Action      string        `json:"action"`
		Version     oncallVersion `json:"version"`
		Episode     oncallEpisode `json:"episode"`
	}
	if r.Method == http.MethodGet {
		projectID := 0
		for _, part := range []byte(r.URL.Query().Get("project_id")) {
			if part < '0' || part > '9' {
				return 0, "", "", oncallVersion{}, oncallEpisode{}, errOncallInvalid
			}
			projectID = projectID*10 + int(part-'0')
		}
		environment := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("environment")))
		if projectID <= 0 || !singleEnvironment(environment) {
			return 0, "", "", oncallVersion{}, oncallEpisode{}, errOncallInvalid
		}
		return projectID, environment, "read", oncallVersion{}, oncallEpisode{}, nil
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return 0, "", "", oncallVersion{}, oncallEpisode{}, errOncallInvalid
	}
	environment := strings.ToLower(strings.TrimSpace(body.Environment))
	if body.ProjectID <= 0 || !singleEnvironment(environment) {
		return 0, "", "", oncallVersion{}, oncallEpisode{}, errOncallInvalid
	}
	return body.ProjectID, environment, strings.ToLower(strings.TrimSpace(body.Action)), body.Version, body.Episode, nil
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func persistOncallVersion(projectID int, environment string, version oncallVersion) {
	if DB == nil {
		return
	}
	raw, err := json.Marshal(version)
	if err != nil {
		return
	}
	_, _ = DB.Exec(`
		INSERT INTO oncall_schedule_versions (project_id, environment, timezone, state, payload)
		VALUES ($1, $2, $3, 'active', $4)
	`, projectID, environment, version.Timezone, string(raw))
}

func persistOncallStep(projectID int, episodeKey string, step oncallStep) {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		INSERT INTO oncall_escalation_runs (project_id, episode_key, step_key, state, detail)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (episode_key, step_key) DO UPDATE SET state = EXCLUDED.state
	`, projectID, episodeKey, step.Key, step.State, step.Name)
}

func migrateOncallCoverageSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_schedule_versions (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment VARCHAR(80) NOT NULL,
			timezone VARCHAR(80) NOT NULL,
			state VARCHAR(20) NOT NULL,
			payload TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS oncall_escalation_runs (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			episode_key VARCHAR(120) NOT NULL,
			step_key VARCHAR(160) NOT NULL,
			state VARCHAR(20) NOT NULL,
			detail TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (episode_key, step_key)
		)
	`)
}
