package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
)

type deployIntelPlanDelta struct {
	HasPlan           bool     `json:"has_plan"`
	Add               int      `json:"add"`
	Change            int      `json:"change"`
	Destroy           int      `json:"destroy"`
	Replace           int      `json:"replace"`
	PlanResourceCount int      `json:"plan_resource_count"`
	PRFileCount       int      `json:"pr_file_count"`
	TerraformFiles    int      `json:"terraform_files"`
	HasDestroy        bool     `json:"has_destroy"`
	Mismatch          bool     `json:"mismatch"`
	Summary           string   `json:"summary"`
	Flags             []string `json:"flags,omitempty"`
}

type projectRiskPath struct {
	ID        int    `json:"id"`
	ProjectID int    `json:"project_id"`
	Glob      string `json:"glob"`
	Label     string `json:"label"`
	Weight    int    `json:"weight"`
}

func buildPlanDelta(req *PRRequest, brief prImpactBrief) *deployIntelPlanDelta {
	if req == nil || strings.TrimSpace(req.TerraformPlanOutput) == "" {
		return nil
	}
	review := parseTerraformPlan(req.TerraformPlanOutput)
	if !review.HasPlan {
		return nil
	}
	tfFiles := 0
	for _, file := range brief.Files {
		cat := strings.ToLower(strings.TrimSpace(file.Category))
		if cat == "" {
			cat = categorizeChangedPath(file.Path)
		}
		if cat == "terraform" || strings.HasSuffix(strings.ToLower(file.Path), ".tf") {
			tfFiles++
		}
	}
	prFiles := brief.FileCount
	if prFiles == 0 {
		prFiles = len(brief.Files)
	}
	planCount := review.Add + review.Change + review.Destroy
	hasDestroy := planDestroysResources(review)
	mismatch := planVsPRMismatch(planCount, prFiles)

	flags := make([]string, 0, 2)
	if hasDestroy {
		flags = append(flags, "destroy")
	}
	if mismatch {
		flags = append(flags, "plan_vs_pr")
	}

	summary := fmt.Sprintf("Plan %d add / %d change / %d destroy · PR %d file(s)", review.Add, review.Change, review.Destroy, prFiles)
	if hasDestroy {
		summary += " · plan destroys resources"
	}
	if mismatch {
		summary += fmt.Sprintf(" · plan %d / PR %d files", planCount, prFiles)
	}

	return &deployIntelPlanDelta{
		HasPlan:           true,
		Add:               review.Add,
		Change:            review.Change,
		Destroy:           review.Destroy,
		Replace:           review.Replace,
		PlanResourceCount: planCount,
		PRFileCount:       prFiles,
		TerraformFiles:    tfFiles,
		HasDestroy:        hasDestroy,
		Mismatch:          mismatch,
		Summary:           summary,
		Flags:             flags,
	}
}

func planVsPRMismatch(planCount, prFiles int) bool {
	if planCount <= 0 || prFiles <= 0 {
		return false
	}
	if planCount <= 2 && prFiles >= 12 {
		return true
	}
	return prFiles >= 8 && prFiles >= planCount*4
}

func attachPlanDelta(brief *prImpactBrief, req *PRRequest) []prImpactFactor {
	if brief == nil {
		return nil
	}
	delta := buildPlanDelta(req, *brief)
	brief.PlanDelta = delta
	if delta == nil {
		return nil
	}
	factors := make([]prImpactFactor, 0, 2)
	if delta.HasDestroy {
		factors = append(factors, prImpactFactor{
			Key:      "plan-destroy",
			Label:    "Terraform plan destroys resources",
			Severity: "high",
			Weight:   18,
			Detail:   fmt.Sprintf("Plan destroys %d resource(s) (%d replace).", delta.Destroy, delta.Replace),
		})
	}
	if delta.Mismatch {
		factors = append(factors, prImpactFactor{
			Key:      "plan-vs-pr",
			Label:    "Plan size does not match the PR",
			Severity: "medium",
			Weight:   10,
			Detail:   fmt.Sprintf("Plan %d / PR %d files — review whether the plan covers the change.", delta.PlanResourceCount, delta.PRFileCount),
		})
	}
	return factors
}

func pathMatchesRiskGlob(path, glob string) bool {
	path = strings.TrimPrefix(strings.ReplaceAll(strings.TrimSpace(path), "\\", "/"), "/")
	glob = strings.TrimSpace(strings.ReplaceAll(glob, "\\", "/"))
	if path == "" || glob == "" {
		return false
	}
	if strings.HasSuffix(glob, "/**") {
		prefix := strings.TrimSuffix(strings.TrimSuffix(glob, "/**"), "/")
		return prefix != "" && (path == prefix || strings.HasPrefix(path, prefix+"/"))
	}
	if strings.ContainsAny(glob, "*?[") {
		if ok, _ := filepath.Match(glob, path); ok {
			return true
		}
		parts := strings.Split(path, "/")
		for i := range parts {
			if ok, _ := filepath.Match(glob, strings.Join(parts[i:], "/")); ok {
				return true
			}
		}
		return false
	}
	return strings.Contains(strings.ToLower(path), strings.ToLower(glob))
}

func fileConflictPrefix(path string) string {
	path = strings.TrimPrefix(strings.ReplaceAll(strings.TrimSpace(path), "\\", "/"), "/")
	if path == "" {
		return ""
	}
	parts := strings.Split(path, "/")
	if len(parts) >= 2 && parts[0] != "" && parts[1] != "" {
		return parts[0] + "/" + parts[1]
	}
	return parts[0]
}

func collectConflictPrefixes(files []prImpactFile) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, 4)
	for _, file := range files {
		cat := strings.ToLower(strings.TrimSpace(file.Category))
		if cat == "docs" || cat == "tests" {
			continue
		}
		prefix := fileConflictPrefix(file.Path)
		if prefix == "" {
			continue
		}
		if _, ok := seen[prefix]; ok {
			continue
		}
		seen[prefix] = struct{}{}
		out = append(out, prefix)
	}
	sort.Strings(out)
	return out
}

func prefixesOverlap(left, right []string) bool {
	if len(left) == 0 || len(right) == 0 {
		return false
	}
	lookup := map[string]struct{}{}
	for _, item := range right {
		lookup[item] = struct{}{}
	}
	for _, item := range left {
		if _, ok := lookup[item]; ok {
			return true
		}
	}
	return false
}

func attachOpenPRConflicts(events []repoDeployEvent) {
	prefixes := make([][]string, len(events))
	for i, ev := range events {
		prefixes[i] = collectConflictPrefixes(ev.Impact.Files)
	}
	for i := range events {
		if events[i].OpenPR == nil || len(prefixes[i]) == 0 {
			continue
		}
		with := make([]int, 0, 2)
		seen := map[int]struct{}{}
		for j := range events {
			if i == j || events[j].PRNumber <= 0 || events[j].PRNumber == events[i].PRNumber {
				continue
			}
			if !prefixesOverlap(prefixes[i], prefixes[j]) {
				continue
			}
			if _, ok := seen[events[j].PRNumber]; ok {
				continue
			}
			seen[events[j].PRNumber] = struct{}{}
			with = append(with, events[j].PRNumber)
		}
		sort.Ints(with)
		events[i].OpenPR.ConflictsWith = with
	}
}

func formatHighRiskOpenPRDigestLine(owner, name string, ev repoDeployEvent) string {
	headline := strings.TrimSpace(ev.Title)
	if ev.ChangeBrief != nil && strings.TrimSpace(ev.ChangeBrief.Headline) != "" {
		headline = ev.ChangeBrief.Headline
	} else if ev.Impact.ChangeBrief != nil && strings.TrimSpace(ev.Impact.ChangeBrief.Headline) != "" {
		headline = ev.Impact.ChangeBrief.Headline
	}
	if headline == "" {
		headline = "high-risk open PR"
	}
	url := strings.TrimSpace(ev.PRURL)
	if url == "" && ev.PRNumber > 0 {
		url = fmt.Sprintf("https://github.com/%s/%s/pull/%d", owner, name, ev.PRNumber)
	}
	return fmt.Sprintf("• *%s/%s* #%d — %s\n  %s", owner, name, ev.PRNumber, headline, url)
}

func resolveWatchlistProjectID(brief *prImpactBrief, req *PRRequest) int {
	if req != nil && req.ProjectID != nil && *req.ProjectID > 0 {
		return *req.ProjectID
	}
	if brief == nil {
		return 0
	}
	owner, repo, _, ok := parseGitHubPRURL(brief.PRURL)
	if !ok {
		return 0
	}
	return findGitOpsProjectIDByGitHubRepo(owner, repo)
}

func applyWatchlistFactors(brief *prImpactBrief, req *PRRequest) []prImpactFactor {
	if brief == nil || len(brief.Files) == 0 {
		return nil
	}
	projectID := resolveWatchlistProjectID(brief, req)
	if projectID <= 0 {
		return nil
	}
	rules := listProjectRiskPaths(projectID)
	if len(rules) == 0 {
		return nil
	}
	matched := make([]string, 0, 2)
	bump := 0
	for _, rule := range rules {
		hit := false
		for _, file := range brief.Files {
			if pathMatchesRiskGlob(file.Path, rule.Glob) {
				hit = true
				break
			}
		}
		if !hit {
			continue
		}
		weight := rule.Weight
		if weight <= 0 {
			weight = 10
		}
		bump += weight
		label := strings.TrimSpace(rule.Label)
		if label == "" {
			label = rule.Glob
		}
		matched = append(matched, label)
	}
	if bump <= 0 {
		return nil
	}
	return []prImpactFactor{{
		Key:      "hot-path",
		Label:    "Touches watchlisted paths",
		Severity: "high",
		Weight:   minInt(bump, 30),
		Detail:   "Hot paths: " + strings.Join(matched, ", "),
	}}
}

func listProjectRiskPaths(projectID int) []projectRiskPath {
	if DB == nil || projectID <= 0 {
		return nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, glob, label, weight
		  FROM project_risk_paths
		 WHERE project_id = $1
		 ORDER BY id ASC
	`, projectID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]projectRiskPath, 0, 4)
	for rows.Next() {
		var item projectRiskPath
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Glob, &item.Label, &item.Weight); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

func createProjectRiskPath(projectID int, glob, label string, weight int) (*projectRiskPath, error) {
	if DB == nil {
		return nil, fmt.Errorf("database is not available")
	}
	if projectID <= 0 {
		return nil, fmt.Errorf("project is required")
	}
	glob = strings.TrimSpace(glob)
	label = strings.TrimSpace(label)
	if glob == "" {
		return nil, fmt.Errorf("glob is required")
	}
	if len(glob) > 400 {
		return nil, fmt.Errorf("glob is too long")
	}
	if weight <= 0 {
		weight = 12
	}
	if weight > 30 {
		weight = 30
	}
	item := projectRiskPath{ProjectID: projectID, Glob: glob, Label: label, Weight: weight}
	err := DB.QueryRow(`
		INSERT INTO project_risk_paths (project_id, glob, label, weight)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, projectID, glob, label, weight).Scan(&item.ID)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func deleteProjectRiskPath(projectID, pathID int) error {
	if DB == nil || projectID <= 0 || pathID <= 0 {
		return fmt.Errorf("path not found")
	}
	res, err := DB.Exec(`DELETE FROM project_risk_paths WHERE id = $1 AND project_id = $2`, pathID, projectID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("path not found")
	}
	return nil
}

func devopsProjectRiskPathsHandler(w http.ResponseWriter, r *http.Request, projectID, pathID int) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if projectID <= 0 {
		writeAPIError(w, r, http.StatusNotFound, "project not found", nil)
		return
	}
	switch r.Method {
	case http.MethodGet:
		userID, ok := requireDevopsUser(w, r)
		if !ok {
			return
		}
		if !ensureProjectVisible(w, r, userID, projectID) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "paths": listProjectRiskPaths(projectID)})
	case http.MethodPost:
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		if !ensureProjectVisible(w, r, userID, projectID) {
			return
		}
		var body struct {
			Glob   string `json:"glob"`
			Label  string `json:"label"`
			Weight int    `json:"weight"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		item, err := createProjectRiskPath(projectID, body.Glob, body.Label, body.Weight)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "path": item})
	case http.MethodDelete:
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		if !ensureProjectVisible(w, r, userID, projectID) {
			return
		}
		if err := deleteProjectRiskPath(projectID, pathID); err != nil {
			writeAPIError(w, r, http.StatusNotFound, err.Error(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost, http.MethodDelete)
	}
}
