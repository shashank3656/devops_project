package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	driftAutomationMinScore = 6
	driftAutoPrepareEnv     = "DRIFT_AUTO_PREPARE_DRAFTS"
)

var (
	costDigestSchedulerActive      int32
	driftAutomationSchedulerActive int32
)

type projectInfraSettings struct {
	MonthlyBudgetUSD   int `json:"monthly_budget_usd"`
	DefaultTempEnvDays int `json:"default_temp_env_days"`
}

type fleetBudgetAlert struct {
	ProjectID        int     `json:"project_id"`
	ProjectName      string  `json:"project_name"`
	ProjectCode      string  `json:"project_code"`
	AlertLevel       string  `json:"alert_level"`
	ProjectedPercent float64 `json:"projected_percent"`
	BudgetMonthly    int     `json:"budget_monthly"`
	ProjectedMonthly float64 `json:"projected_monthly"`
}

type fleetIdleRow struct {
	idleCandidate
	ProjectID   int    `json:"project_id"`
	ProjectName string `json:"project_name"`
	ProjectCode string `json:"project_code"`
}

type fleetCostDigest struct {
	GeneratedAt   time.Time          `json:"generated_at"`
	BudgetAlerts  []fleetBudgetAlert `json:"budget_alerts"`
	IdleResources []fleetIdleRow     `json:"idle_resources"`
	TotalIdleUSD  float64            `json:"total_idle_monthly_usd"`
	Summary       string             `json:"summary"`
}

type prodRunbookGateResult struct {
	Required bool             `json:"required"`
	Message  string           `json:"message,omitempty"`
	Runbooks []projectRunbook `json:"runbooks,omitempty"`
}

func loadProjectInfraSettings(projectID int) projectInfraSettings {
	settings := projectInfraSettings{}
	if DB == nil || projectID <= 0 {
		return settings
	}
	_ = DB.QueryRow(`
		SELECT COALESCE(monthly_budget_usd, 0), COALESCE(default_temp_env_days, 0)
		  FROM projects WHERE id = $1
	`, projectID).Scan(&settings.MonthlyBudgetUSD, &settings.DefaultTempEnvDays)
	return settings
}

func saveProjectInfraSettings(projectID int, settings projectInfraSettings) error {
	if DB == nil || projectID <= 0 {
		return nil
	}
	days := settings.DefaultTempEnvDays
	if days < 0 {
		days = 0
	}
	if days > lifetimeMaxDays {
		days = lifetimeMaxDays
	}
	budget := settings.MonthlyBudgetUSD
	if budget < 0 {
		budget = 0
	}
	_, err := DB.Exec(`
		UPDATE projects
		   SET monthly_budget_usd = $1, default_temp_env_days = $2, updated_at = CURRENT_TIMESTAMP
		 WHERE id = $3
	`, budget, days, projectID)
	return err
}

func applyProjectDefaultLifetimeIfEligible(requestID int, projectID *int, env string) {
	if DB == nil || requestID <= 0 || envEqualsProd(env) {
		return
	}
	var exists int
	_ = queryRowContext(`SELECT 1 FROM pr_request_lifetimes WHERE request_id = $1 LIMIT 1`, requestID).Scan(&exists)
	if exists == 1 {
		return
	}
	pid := 0
	if projectID != nil {
		pid = *projectID
	}
	days := loadProjectInfraSettings(pid).DefaultTempEnvDays
	if days <= 0 {
		return
	}
	expiresAt := time.Now().UTC().Add(time.Duration(days) * 24 * time.Hour)
	_, _ = execContext(`
		INSERT INTO pr_request_lifetimes (request_id, expires_at, set_by, updated_at)
		VALUES ($1, $2, NULL, CURRENT_TIMESTAMP)
		ON CONFLICT (request_id) DO NOTHING
	`, requestID, expiresAt)
}

func buildFleetCostDigest(now time.Time) (*fleetCostDigest, error) {
	projects, err := listProjectCatalogs()
	if err != nil {
		return nil, err
	}
	digest := &fleetCostDigest{
		GeneratedAt:   now.UTC(),
		BudgetAlerts:  []fleetBudgetAlert{},
		IdleResources: []fleetIdleRow{},
	}
	for _, project := range projects {
		summary := buildProjectCostSummary(project.ID, now)
		if summary.BudgetMonthly > 0 && summary.AlertLevel != "none" {
			digest.BudgetAlerts = append(digest.BudgetAlerts, fleetBudgetAlert{
				ProjectID:        project.ID,
				ProjectName:      project.Name,
				ProjectCode:      project.Code,
				AlertLevel:       summary.AlertLevel,
				ProjectedPercent: summary.ProjectedPercent,
				BudgetMonthly:    summary.BudgetMonthly,
				ProjectedMonthly: summary.ProjectedMonthly,
			})
		}
		for _, idle := range summary.IdleCandidates {
			digest.IdleResources = append(digest.IdleResources, fleetIdleRow{
				idleCandidate: idle,
				ProjectID:     project.ID,
				ProjectName:   project.Name,
				ProjectCode:   project.Code,
			})
			digest.TotalIdleUSD += idle.MonthlyCost
		}
	}
	sort.Slice(digest.BudgetAlerts, func(i, j int) bool {
		return digest.BudgetAlerts[i].ProjectedPercent > digest.BudgetAlerts[j].ProjectedPercent
	})
	sort.Slice(digest.IdleResources, func(i, j int) bool {
		return digest.IdleResources[i].DaysIdle > digest.IdleResources[j].DaysIdle
	})
	digest.TotalIdleUSD = roundTo(digest.TotalIdleUSD, 2)
	parts := []string{}
	if len(digest.BudgetAlerts) > 0 {
		parts = append(parts, fmt.Sprintf("%d project(s) over or near budget", len(digest.BudgetAlerts)))
	}
	if len(digest.IdleResources) > 0 {
		parts = append(parts, fmt.Sprintf("%d idle non-prod resource(s) (~$%.0f/mo)", len(digest.IdleResources), digest.TotalIdleUSD))
	}
	if len(parts) == 0 {
		digest.Summary = "No budget or idle cleanup signals this week."
	} else {
		digest.Summary = strings.Join(parts, "; ") + "."
	}
	return digest, nil
}

func runCostIdleDigestSweep(now time.Time) {
	digest, err := buildFleetCostDigest(now)
	if err != nil || digest == nil {
		log.Printf("[cost-digest] build failed: %v", err)
		return
	}
	if len(digest.BudgetAlerts) == 0 && len(digest.IdleResources) == 0 {
		return
	}
	recipients, err := buildOpsNotificationRecipients(nil)
	if err != nil || len(recipients) == 0 {
		return
	}
	title := "Weekly cost & idle digest"
	message := digest.Summary + " Open Ops Command Center → Cost & idle for details."
	eventKey := buildOpsNotificationEventKey("cost-idle-digest", now.Format("2006-W02"))
	_ = dispatchOpsNotification(eventKey, "cost_idle_digest", title, message, nil, nil, recipients, map[string]any{
		"budget_alerts": len(digest.BudgetAlerts),
		"idle_count":    len(digest.IdleResources),
		"idle_monthly":  digest.TotalIdleUSD,
	})
}

func startCostDigestScheduler() {
	if !atomic.CompareAndSwapInt32(&costDigestSchedulerActive, 0, 1) {
		return
	}
	go func() {
		time.Sleep(5 * time.Minute)
		runCostIdleDigestSweep(time.Now())
		ticker := time.NewTicker(7 * 24 * time.Hour)
		defer ticker.Stop()
		for tick := range ticker.C {
			runCostIdleDigestSweep(tick)
		}
	}()
}

func evaluateProdRunbookGate(req *PRRequest) prodRunbookGateResult {
	result := prodRunbookGateResult{}
	if req == nil || !envEqualsProd(req.Env) {
		return result
	}
	if req.ProjectID == nil || *req.ProjectID <= 0 {
		result.Required = true
		result.Message = "Production requests must be linked to a project catalog entry with a service runbook."
		return result
	}
	runbooks, err := listProjectRunbooks(*req.ProjectID)
	if err != nil {
		result.Required = true
		result.Message = "Could not verify runbooks for this production request."
		return result
	}
	service := strings.ToLower(strings.TrimSpace(req.Service))
	matched := []projectRunbook{}
	for _, rb := range runbooks {
		rbService := strings.ToLower(strings.TrimSpace(rb.Service))
		if rbService == "" || rbService == service {
			matched = append(matched, rb)
		}
	}
	if len(matched) == 0 {
		result.Required = true
		result.Runbooks = runbooks
		if service == "" {
			result.Message = "Add a production runbook for this project before approving."
		} else {
			result.Message = fmt.Sprintf("Add a runbook for service %q (or a project-wide runbook) before approving production.", req.Service)
		}
		return result
	}
	result.Runbooks = matched
	return result
}

func pickDriftFixPair(item environmentDriftProjectItem) (baselineEnv, targetEnv string, ok bool) {
	if item.DriftScore < driftAutomationMinScore || item.State == "aligned" {
		return "", "", false
	}
	envs := make([]environmentDriftSnapshot, len(item.Environments))
	copy(envs, item.Environments)
	sort.Slice(envs, func(i, j int) bool {
		return envRank(envs[i].Environment) < envRank(envs[j].Environment)
	})
	var baseline string
	for _, snap := range envs {
		if snap.Environment != "" {
			baseline = snap.Environment
			break
		}
	}
	if baseline == "" {
		return "", "", false
	}
	for _, snap := range envs {
		if snap.Environment == baseline {
			continue
		}
		if snap.State == "drift" || snap.State == "attention" {
			return baseline, snap.Environment, true
		}
	}
	for _, snap := range envs {
		if snap.Environment != baseline && (snap.State == "drift" || snap.State == "attention") {
			return baseline, snap.Environment, true
		}
	}
	return "", "", false
}

func envRank(env string) int {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "dev", "development":
		return 0
	case "test", "qa":
		return 1
	case "stage", "staging", "uat":
		return 2
	case "prod", "production":
		return 9
	default:
		return 5
	}
}

func hasOpenDriftFixDraft(projectID int, targetEnv string) bool {
	if DB == nil {
		return false
	}
	var id int
	_ = queryRowContext(`
		SELECT id FROM pr_requests
		WHERE project_id = $1 AND lower(env) = lower($2)
		  AND status IN ('draft', 'pending_user_manager_approval', 'pending_devops_approval', 'pending_approval', 'in_progress')
		  AND COALESCE(client_name, '') ILIKE '%drift fix%'
		ORDER BY id DESC LIMIT 1
	`, projectID, targetEnv).Scan(&id)
	return id > 0
}

func runDriftAutomationSweep(now time.Time) {
	payload, err := buildEnvironmentDriftPayload(0)
	if err != nil || payload == nil {
		log.Printf("[drift-auto] payload failed: %v", err)
		return
	}
	autoPrepare := strings.EqualFold(strings.TrimSpace(os.Getenv(driftAutoPrepareEnv)), "true")
	recipients, _ := buildOpsNotificationRecipients(nil)
	for _, item := range payload.Items {
		if item.DriftScore < driftAutomationMinScore {
			continue
		}
		baseline, target, ok := pickDriftFixPair(item)
		if !ok {
			continue
		}
		if hasOpenDriftFixDraft(item.ProjectID, target) {
			continue
		}
		eventKey := buildOpsNotificationEventKey("drift-auto", strconv.Itoa(item.ProjectID), baseline, target, now.Format("2006-01-02"))
		title := fmt.Sprintf("Drift detected: %s (%s)", item.ProjectName, item.ProjectCode)
		message := fmt.Sprintf("%s has drift score %d (%s → %s). Review Environment Drift or prepare a fix draft.", item.ProjectName, item.DriftScore, baseline, target)
		if autoPrepare && len(recipients) > 0 {
			managerID := recipients[0]
			draft, _, prepErr := prepareDriftFixRequest(managerID, item.ProjectID, baseline, target)
			if prepErr == nil && draft != nil {
				message = fmt.Sprintf("%s Automated drift-fix draft #%d was prepared (align %s to %s). Review and submit from History.", message, draft.ID, target, baseline)
			}
		}
		_ = dispatchOpsNotification(eventKey, "drift_automation", title, message, nil, &item.ProjectID, recipients, map[string]any{
			"project_id":   item.ProjectID,
			"drift_score":  item.DriftScore,
			"baseline_env": baseline,
			"target_env":   target,
		})
	}
}

func startDriftAutomationScheduler() {
	if !atomic.CompareAndSwapInt32(&driftAutomationSchedulerActive, 0, 1) {
		return
	}
	go func() {
		time.Sleep(8 * time.Minute)
		runDriftAutomationSweep(time.Now())
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for tick := range ticker.C {
			runDriftAutomationSweep(tick)
		}
	}()
}

func devopsCostDigestHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	digest, err := buildFleetCostDigest(time.Now())
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "digest": digest})
}

func devopsProjectInfraSettingsHandler(w http.ResponseWriter, r *http.Request, projectID int) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
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
		project, err := getProjectCatalogByID(projectID)
		if err != nil || project == nil {
			writeAPIError(w, r, http.StatusNotFound, "project not found", err)
			return
		}
		settings := loadProjectInfraSettings(projectID)
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "settings": settings})
	case http.MethodPatch, http.MethodPut:
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		if !ensureProjectVisible(w, r, userID, projectID) {
			return
		}
		var body projectInfraSettings
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "invalid json", err)
			return
		}
		if err := saveProjectInfraSettings(projectID, body); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "failed to save settings", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		encodeJSON(w, map[string]interface{}{"status": "ok", "settings": loadProjectInfraSettings(projectID)})
	default:
		writeMethodNotAllowed(w, r)
	}
}
