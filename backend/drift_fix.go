package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// One-click drift fix: prepare a draft request that copies the baseline
// environment's version markers (image tags, chart and engine versions) into
// the drifted environment's latest config. The draft then goes through the
// normal approval, PR and plan-review flow.

type driftFixChange struct {
	Key  string `json:"key"`
	From string `json:"from"`
	To   string `json:"to"`
}

type configPathStep struct {
	key   string
	index int
	isIdx bool
}

// parseFlattenedPath reverses flattenConfigScalars: "a.b[0].c" -> a, b, [0], c.
func parseFlattenedPath(path string) ([]configPathStep, bool) {
	steps := make([]configPathStep, 0, 4)
	for _, segment := range strings.Split(path, ".") {
		name := segment
		if bracket := strings.IndexByte(segment, '['); bracket >= 0 {
			name = segment[:bracket]
			rest := segment[bracket:]
			if name != "" {
				steps = append(steps, configPathStep{key: name})
			}
			for rest != "" {
				if rest[0] != '[' {
					return nil, false
				}
				end := strings.IndexByte(rest, ']')
				if end < 0 {
					return nil, false
				}
				index, err := strconv.Atoi(rest[1:end])
				if err != nil || index < 0 {
					return nil, false
				}
				steps = append(steps, configPathStep{index: index, isIdx: true})
				rest = rest[end+1:]
			}
			continue
		}
		if name == "" {
			return nil, false
		}
		steps = append(steps, configPathStep{key: name})
	}
	return steps, len(steps) > 0
}

func getConfigPath(root interface{}, steps []configPathStep) (interface{}, bool) {
	current := root
	for _, step := range steps {
		if step.isIdx {
			list, ok := current.([]interface{})
			if !ok || step.index >= len(list) {
				return nil, false
			}
			current = list[step.index]
			continue
		}
		object, ok := current.(map[string]interface{})
		if !ok {
			return nil, false
		}
		current, ok = object[step.key]
		if !ok {
			return nil, false
		}
	}
	return current, true
}

func setConfigPath(root interface{}, steps []configPathStep, value interface{}) bool {
	if len(steps) == 0 {
		return false
	}
	parent, ok := getConfigPath(root, steps[:len(steps)-1])
	if !ok {
		return false
	}
	last := steps[len(steps)-1]
	if last.isIdx {
		list, ok := parent.([]interface{})
		if !ok || last.index >= len(list) {
			return false
		}
		list[last.index] = value
		return true
	}
	object, ok := parent.(map[string]interface{})
	if !ok {
		return false
	}
	if _, exists := object[last.key]; !exists {
		return false
	}
	object[last.key] = value
	return true
}

// alignVersionMarkers returns target's config with every version marker that
// both configs share set to the baseline value. Only scalar values are copied.
func alignVersionMarkers(baselineConfig, targetConfig string) (string, []driftFixChange, error) {
	var baseline, target interface{}
	if err := json.Unmarshal([]byte(baselineConfig), &baseline); err != nil {
		return "", nil, fmt.Errorf("baseline config is not valid JSON")
	}
	if err := json.Unmarshal([]byte(targetConfig), &target); err != nil {
		return "", nil, fmt.Errorf("target config is not valid JSON")
	}
	baselineProfile := extractDriftSignalProfile(baselineConfig)
	targetProfile := extractDriftSignalProfile(targetConfig)

	keys := make([]string, 0, len(baselineProfile.VersionMarkers))
	for key := range baselineProfile.VersionMarkers {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	changes := make([]driftFixChange, 0)
	for _, key := range keys {
		from, ok := targetProfile.VersionMarkers[key]
		to := baselineProfile.VersionMarkers[key]
		if !ok || from == to {
			continue
		}
		steps, ok := parseFlattenedPath(key)
		if !ok {
			continue
		}
		value, ok := getConfigPath(baseline, steps)
		if !ok {
			continue
		}
		switch value.(type) {
		case map[string]interface{}, []interface{}:
			continue
		}
		if setConfigPath(target, steps, value) {
			changes = append(changes, driftFixChange{Key: key, From: from, To: to})
		}
	}
	if len(changes) == 0 {
		return targetConfig, changes, nil
	}
	encoded, err := json.MarshalIndent(target, "", "  ")
	if err != nil {
		return "", nil, err
	}
	return string(encoded), changes, nil
}

func prepareDriftFixRequest(managerID, projectID int, baselineEnv, targetEnv string) (*PRRequest, []driftFixChange, error) {
	baselineEnv = strings.ToLower(strings.TrimSpace(baselineEnv))
	targetEnv = strings.ToLower(strings.TrimSpace(targetEnv))
	if baselineEnv == "" || targetEnv == "" || baselineEnv == targetEnv {
		return nil, nil, fmt.Errorf("choose two different environments")
	}
	project, err := getProjectCatalogByID(projectID)
	if err != nil {
		return nil, nil, err
	}
	if project == nil {
		return nil, nil, fmt.Errorf("project not found")
	}
	requests, err := GetPRRequests("", "", "", project.ID, "", "", "", 0, 0, nil, 200, 0, "updated_at", "desc", false, "", "")
	if err != nil {
		return nil, nil, err
	}
	byEnv := map[string][]PRRequest{}
	for _, req := range requests {
		env := strings.ToLower(strings.TrimSpace(req.Env))
		byEnv[env] = append(byEnv[env], req)
	}
	baseline := chooseLatestRequestForEnvironment(byEnv[baselineEnv])
	target := chooseLatestRequestForEnvironment(byEnv[targetEnv])
	if baseline == nil {
		return nil, nil, fmt.Errorf("%s has no request to copy versions from", baselineEnv)
	}
	if target == nil {
		return nil, nil, fmt.Errorf("%s has no request to update", targetEnv)
	}

	config, changes, err := alignVersionMarkers(baseline.Config, target.Config)
	if err != nil {
		return nil, nil, err
	}
	if len(changes) == 0 {
		return nil, nil, fmt.Errorf("%s already matches %s versions", targetEnv, baselineEnv)
	}

	appID, err := GenerateApplicationID()
	if err != nil {
		return nil, nil, err
	}
	filePath, branchName := BuildRequestGitArtifacts(target.ProjectID, target.Team, target.Cloud, target.Env, target.Service, appID)
	draft := &PRRequest{
		ProjectID:     target.ProjectID,
		Team:          target.Team,
		Env:           target.Env,
		Cloud:         target.Cloud,
		Service:       target.Service,
		ClientName:    strings.TrimSpace(fmt.Sprintf("%s (drift fix: align %s to %s)", target.ClientName, targetEnv, baselineEnv)),
		ApplicationID: appID,
		Priority:      target.Priority,
		DueDate:       target.DueDate,
		Branch:        branchName,
		FilePath:      filePath,
		Status:        "draft",
		Config:        ensureRequestConfigApplicationID(config, appID),
		CreatedBy:     &managerID,
	}
	if err := SavePRRequest(draft); err != nil {
		return nil, nil, err
	}
	_, _ = execContext(`UPDATE pr_requests SET linked_request_id = $1 WHERE id = $2`, target.ID, draft.ID)
	_ = SaveRequestConfigHistory(draft.ID, draft.Config, "drift fix")

	keys := make([]string, 0, len(changes))
	for _, change := range changes {
		keys = append(keys, change.Key)
	}
	AppendAuditLog(&managerID, "environment_drift_fix_prepare", "pr_request", strconv.Itoa(draft.ID),
		fmt.Sprintf("project=%d source=%d baseline=%s target=%s keys=%s", projectID, target.ID, baselineEnv, targetEnv, strings.Join(keys, ",")))
	return draft, changes, nil
}

func devopsEnvironmentDriftFixHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodPost, http.MethodOptions)
		return
	}
	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}
	var body struct {
		ProjectID   int    `json:"project_id"`
		BaselineEnv string `json:"baseline_env"`
		TargetEnv   string `json:"target_env"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ProjectID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "project_id, baseline_env and target_env are required", nil)
		return
	}
	draft, changes, err := prepareDriftFixRequest(managerID, body.ProjectID, body.BaselineEnv, body.TargetEnv)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "request": draft, "changes": changes})
}
