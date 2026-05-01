package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

// devopsIdleResourcesRouter is the entry point for /api/devops/idle/*. It
// dispatches to handlers based on path tokens to keep HandleFunc registrations
// in main.go small.
func devopsIdleResourcesRouter(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	userID, ok := requireDevopsUser(w, r)
	if !ok {
		return
	}
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		encodeDevopsJSON(w, map[string]any{"error": "database not available", "status": "error"})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/devops/idle")
	path = strings.Trim(path, "/")
	segments := strings.Split(path, "/")
	if len(segments) == 1 && segments[0] == "" {
		writeNotFound(w)
		return
	}

	switch segments[0] {
	case "options":
		idleOptionsHandler(w, r)
	case "settings":
		idleSettingsHandler(w, r, userID)
	case "accounts":
		idleAccountsRouter(w, r, segments[1:], userID)
	case "scans":
		idleScansRouter(w, r, segments[1:], userID)
	case "summary":
		idleSummaryHandler(w, r)
	case "audit":
		idleAuditHandler(w, r)
	default:
		writeNotFound(w)
	}
}

func writeNotFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	encodeDevopsJSON(w, map[string]any{"error": "not found", "status": "error"})
}

// ---------- options + settings ----------

func idleOptionsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r, "GET")
		return
	}
	encodeDevopsJSON(w, map[string]any{
		"clouds":       SupportedClouds,
		"auth_methods": SupportedAuthMethods,
		"ai_providers": SupportedAIProviders,
		"scan_scopes":  SupportedScanScopes,
		"status":       "ok",
	})
}

func idleSettingsHandler(w http.ResponseWriter, r *http.Request, userID int) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case "GET":
		s, err := getIdleSettings(r.Context())
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		encodeDevopsJSON(w, map[string]any{"settings": s, "status": "ok"})
	case "PATCH", "PUT":
		var body IdleSettings
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if body.RetentionDays <= 0 {
			body.RetentionDays = IdleRetentionDays
		}
		if !containsString(SupportedAIProviders, body.DefaultAIProvider) {
			body.DefaultAIProvider = "none"
		}
		if err := updateIdleSettings(r.Context(), body, userID); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeIdleAudit(r.Context(), 0, 0, userID, "settings_updated", map[string]any{"retention_days": body.RetentionDays})
		encodeDevopsJSON(w, map[string]any{"settings": body, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r, "GET", "PATCH", "PUT")
	}
}

// ---------- accounts ----------

func idleAccountsRouter(w http.ResponseWriter, r *http.Request, rest []string, userID int) {
	w.Header().Set("Content-Type", "application/json")
	if len(rest) == 0 || rest[0] == "" {
		switch r.Method {
		case "GET":
			accs, err := listCloudAccounts(r.Context())
			if err != nil {
				respondError(w, http.StatusInternalServerError, err.Error())
				return
			}
			encodeDevopsJSON(w, map[string]any{"accounts": accs, "status": "ok"})
		case "POST":
			handleCreateAccount(w, r, userID)
		default:
			writeMethodNotAllowed(w, r, "GET", "POST")
		}
		return
	}
	id, err := strconv.Atoi(rest[0])
	if err != nil || id <= 0 {
		respondError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	if len(rest) >= 2 {
		switch rest[1] {
		case "test":
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r, "POST")
				return
			}
			handleTestAccount(w, r, id)
			return
		case "rotate":
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r, "POST")
				return
			}
			handleRotateCredentials(w, r, id, userID)
			return
		case "schedules":
			handleAccountSchedules(w, r, id, rest[2:], userID)
			return
		case "exceptions":
			handleAccountExceptions(w, r, id, rest[2:], userID)
			return
		default:
			writeNotFound(w)
			return
		}
	}

	switch r.Method {
	case "GET":
		acc, err := getCloudAccount(r.Context(), id)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if acc == nil {
			respondError(w, http.StatusNotFound, "account not found")
			return
		}
		encodeDevopsJSON(w, map[string]any{"account": acc, "status": "ok"})
	case "PATCH", "PUT":
		handleUpdateAccount(w, r, id, userID)
	case "DELETE":
		if err := deleteCloudAccount(r.Context(), id); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeIdleAudit(r.Context(), id, 0, userID, "account_deleted", nil)
		encodeDevopsJSON(w, map[string]any{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r, "GET", "PATCH", "PUT", "DELETE")
	}
}

type accountCreatePayload struct {
	Name            string           `json:"name"`
	Cloud           string           `json:"cloud"`
	DefaultRegions  []string         `json:"default_regions"`
	DefaultCurrency string           `json:"default_currency"`
	RetentionDays   *int             `json:"retention_days"`
	AIProvider      string           `json:"ai_provider"`
	AIModel         string           `json:"ai_model"`
	Credentials     CloudCredentials `json:"credentials"`
}

func handleCreateAccount(w http.ResponseWriter, r *http.Request, userID int) {
	var body accountCreatePayload
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid json")
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Cloud = strings.ToLower(strings.TrimSpace(body.Cloud))
	if body.Name == "" {
		respondError(w, http.StatusBadRequest, "name is required")
		return
	}
	if !containsString(SupportedClouds, body.Cloud) {
		respondError(w, http.StatusBadRequest, "cloud must be aws|azure|gcp")
		return
	}
	if !containsString(SupportedAuthMethods[body.Cloud], body.Credentials.AuthMethod) {
		respondError(w, http.StatusBadRequest, "auth_method not allowed for cloud "+body.Cloud)
		return
	}
	if err := body.Credentials.validateForCloud(body.Cloud); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.AIProvider != "" && !containsString(SupportedAIProviders, body.AIProvider) {
		respondError(w, http.StatusBadRequest, "ai_provider invalid")
		return
	}
	if _, err := cloudSecretsKey(); err != nil {
		respondError(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	acct := CloudAccount{
		Name:            body.Name,
		Cloud:           body.Cloud,
		DefaultRegions:  body.DefaultRegions,
		DefaultCurrency: body.DefaultCurrency,
		RetentionDays:   body.RetentionDays,
		AIProvider:      body.AIProvider,
		AIModel:         body.AIModel,
	}
	saved, err := saveCloudAccount(r.Context(), userID, acct, body.Credentials)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	saved.AuthMethod = body.Credentials.AuthMethod
	writeIdleAudit(r.Context(), saved.ID, 0, userID, "account_created", map[string]any{"cloud": saved.Cloud})
	encodeDevopsJSON(w, map[string]any{"account": saved, "status": "ok"})
}

func handleUpdateAccount(w http.ResponseWriter, r *http.Request, id, userID int) {
	var body struct {
		Name            string   `json:"name"`
		DefaultRegions  []string `json:"default_regions"`
		DefaultCurrency string   `json:"default_currency"`
		RetentionDays   *int     `json:"retention_days"`
		AIProvider      string   `json:"ai_provider"`
		AIModel         string   `json:"ai_model"`
		Status          string   `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.AIProvider != "" && !containsString(SupportedAIProviders, body.AIProvider) {
		respondError(w, http.StatusBadRequest, "ai_provider invalid")
		return
	}
	regions := body.DefaultRegions
	var regsArg []string
	if regions != nil {
		regsArg = regions
	}
	if err := updateCloudAccountMeta(r.Context(), id, body.Name, body.DefaultCurrency, body.AIProvider, body.AIModel, regsArg, body.RetentionDays, body.Status); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	updated, _ := getCloudAccount(r.Context(), id)
	writeIdleAudit(r.Context(), id, 0, userID, "account_updated", nil)
	encodeDevopsJSON(w, map[string]any{"account": updated, "status": "ok"})
}

func handleTestAccount(w http.ResponseWriter, r *http.Request, id int) {
	w.Header().Set("Content-Type", "application/json")
	acc, err := getCloudAccount(r.Context(), id)
	if err != nil || acc == nil {
		respondError(w, http.StatusNotFound, "account not found")
		return
	}
	creds, err := loadCloudCredentials(r.Context(), id)
	if err != nil {
		respondError(w, http.StatusBadGateway, "decrypt credentials: "+err.Error())
		return
	}
	region := firstNonEmpty(acc.DefaultRegions, "us-east-1")
	var info string
	switch acc.Cloud {
	case "aws":
		info, err = testAWSConnection(r.Context(), region, creds)
	case "azure":
		info, err = testAzureConnection(r.Context(), creds)
	case "gcp":
		info, err = testGCPConnection(r.Context(), creds)
	default:
		err = fmt.Errorf("unsupported cloud %s", acc.Cloud)
	}
	if err != nil {
		recordAccountTest(r.Context(), id, "error", err.Error())
		respondError(w, http.StatusBadGateway, err.Error())
		return
	}
	recordAccountTest(r.Context(), id, "ok", info)
	encodeDevopsJSON(w, map[string]any{"info": info, "status": "ok"})
}

func handleRotateCredentials(w http.ResponseWriter, r *http.Request, id, userID int) {
	var creds CloudCredentials
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		respondError(w, http.StatusBadRequest, "invalid json")
		return
	}
	acc, err := getCloudAccount(r.Context(), id)
	if err != nil || acc == nil {
		respondError(w, http.StatusNotFound, "account not found")
		return
	}
	if !containsString(SupportedAuthMethods[acc.Cloud], creds.AuthMethod) {
		respondError(w, http.StatusBadRequest, "auth_method not allowed for cloud "+acc.Cloud)
		return
	}
	if err := creds.validateForCloud(acc.Cloud); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := rotateCloudCredentials(r.Context(), id, creds); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeIdleAudit(r.Context(), id, 0, userID, "credentials_rotated", map[string]any{"auth_method": creds.AuthMethod})
	encodeDevopsJSON(w, map[string]any{"status": "ok"})
}

// ---------- scans ----------

func idleScansRouter(w http.ResponseWriter, r *http.Request, rest []string, userID int) {
	w.Header().Set("Content-Type", "application/json")
	if len(rest) == 0 || rest[0] == "" {
		switch r.Method {
		case "GET":
			accountID, _ := strconv.Atoi(r.URL.Query().Get("account_id"))
			scans, err := listIdleScans(r.Context(), accountID)
			if err != nil {
				respondError(w, http.StatusInternalServerError, err.Error())
				return
			}
			encodeDevopsJSON(w, map[string]any{"scans": scans, "status": "ok"})
		case "POST":
			handleCreateScan(w, r, userID)
		default:
			writeMethodNotAllowed(w, r, "GET", "POST")
		}
		return
	}
	id, err := strconv.Atoi(rest[0])
	if err != nil || id <= 0 {
		respondError(w, http.StatusBadRequest, "invalid scan id")
		return
	}
	if len(rest) >= 2 {
		switch rest[1] {
		case "resources":
			if r.Method != "GET" {
				writeMethodNotAllowed(w, r, "GET")
				return
			}
			handleListResources(w, r, id)
			return
		case "resources.csv":
			if r.Method != "GET" {
				writeMethodNotAllowed(w, r, "GET")
				return
			}
			handleExportCSV(w, r, id)
			return
		case "resources.xlsx":
			if r.Method != "GET" {
				writeMethodNotAllowed(w, r, "GET")
				return
			}
			handleExportXLSX(w, r, id)
			return
		case "rerank":
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r, "POST")
				return
			}
			handleRerank(w, r, id, userID)
			return
		case "remediations":
			handleScanRemediations(w, r, id, userID)
			return
		case "cleanup.tf":
			if r.Method != "GET" {
				writeMethodNotAllowed(w, r, "GET")
				return
			}
			handleCleanupTfPreview(w, r, id)
			return
		case "cancel":
			if r.Method != "POST" {
				writeMethodNotAllowed(w, r, "POST")
				return
			}
			cancelStatus := "cancelled"
			_ = updateIdleScan(r.Context(), id, scanUpdate{Status: &cancelStatus})
			writeIdleAudit(r.Context(), 0, id, userID, "scan_cancelled", nil)
			encodeDevopsJSON(w, map[string]any{"status": "ok"})
			return
		default:
			writeNotFound(w)
			return
		}
	}
	switch r.Method {
	case "GET":
		scan, err := getIdleScan(r.Context(), id)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if scan == nil {
			respondError(w, http.StatusNotFound, "scan not found")
			return
		}
		encodeDevopsJSON(w, map[string]any{"scan": scan, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r, "GET")
	}
}

type scanCreatePayload struct {
	AccountID  int             `json:"account_id"`
	Regions    []string        `json:"regions"`
	Scope      []string        `json:"scope"`
	Thresholds json.RawMessage `json:"thresholds"`
	AIProvider string          `json:"ai_provider"`
	AIModel    string          `json:"ai_model"`
}

func handleCreateScan(w http.ResponseWriter, r *http.Request, userID int) {
	var body scanCreatePayload
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.AccountID <= 0 {
		respondError(w, http.StatusBadRequest, "account_id required")
		return
	}
	acc, err := getCloudAccount(r.Context(), body.AccountID)
	if err != nil || acc == nil {
		respondError(w, http.StatusNotFound, "account not found")
		return
	}
	if len(body.Regions) == 0 {
		body.Regions = acc.DefaultRegions
	}
	if len(body.Regions) == 0 {
		respondError(w, http.StatusBadRequest, "no regions to scan – set default_regions on the account or pass regions[]")
		return
	}
	if len(body.Scope) == 0 {
		body.Scope = SupportedScanScopes[acc.Cloud]
	}
	scan := IdleScan{
		AccountID:  acc.ID,
		Cloud:      acc.Cloud,
		Regions:    body.Regions,
		Scope:      body.Scope,
		Thresholds: body.Thresholds,
		AIProvider: body.AIProvider,
		AIModel:    body.AIModel,
	}
	saved, err := createIdleScan(r.Context(), scan, userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	enqueueIdleScan(saved.ID, acc.ID, userID)
	writeIdleAudit(r.Context(), acc.ID, saved.ID, userID, "scan_started", map[string]any{"regions": body.Regions, "scope": body.Scope})
	encodeDevopsJSON(w, map[string]any{"scan": saved, "status": "ok"})
}

func handleListResources(w http.ResponseWriter, r *http.Request, scanID int) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	rs, err := listIdleResourcesByScan(r.Context(), scanID, resourceFilters{
		Service:  q.Get("service"),
		Severity: q.Get("severity"),
		Region:   q.Get("region"),
		Query:    q.Get("q"),
		Limit:    limit,
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	encodeDevopsJSON(w, map[string]any{"resources": rs, "status": "ok"})
}

func handleExportCSV(w http.ResponseWriter, r *http.Request, scanID int) {
	rs, err := listIdleResourcesByScan(r.Context(), scanID, resourceFilters{Limit: 5000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=idle-scan-%d.csv", scanID))
	cw := csv.NewWriter(w)
	defer cw.Flush()
	_ = cw.Write([]string{"cloud", "service", "region", "resource_id", "name", "state", "monthly_usd", "severity", "ai_rank", "reason", "tags"})
	for _, row := range rs {
		tags, _ := json.Marshal(row.Tags)
		aiRank := ""
		if row.AIRank != nil {
			aiRank = strconv.Itoa(*row.AIRank)
		}
		_ = cw.Write([]string{
			row.Cloud, row.Service, row.Region, row.ResourceID, row.Name, row.State,
			fmt.Sprintf("%.2f", row.CostEstimateUSD), row.Severity, aiRank, row.Reason, string(tags),
		})
	}
}

func handleExportXLSX(w http.ResponseWriter, r *http.Request, scanID int) {
	rs, err := listIdleResourcesByScan(r.Context(), scanID, resourceFilters{Limit: 5000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	scan, _ := getIdleScan(r.Context(), scanID)

	f := excelize.NewFile()
	defer f.Close()
	sheet := "Idle Resources"
	idx, _ := f.NewSheet(sheet)
	f.DeleteSheet("Sheet1")
	f.SetActiveSheet(idx)

	// Header style: bold + light fill.
	headerStyle, _ := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true, Color: "1F2937"},
		Fill: excelize.Fill{Type: "pattern", Color: []string{"E5E7EB"}, Pattern: 1},
	})
	usdStyle, _ := f.NewStyle(&excelize.Style{NumFmt: 7}) // "$#,##0.00"

	headers := []string{"Cloud", "Service", "Region", "Resource ID", "Name", "State", "Monthly USD", "Severity", "AI Rank", "AI Recommendation", "Reason", "Tags"}
	for col, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(col+1, 1)
		_ = f.SetCellValue(sheet, cell, h)
		_ = f.SetCellStyle(sheet, cell, cell, headerStyle)
	}

	for i, row := range rs {
		r := i + 2
		_ = f.SetCellValue(sheet, fmt.Sprintf("A%d", r), row.Cloud)
		_ = f.SetCellValue(sheet, fmt.Sprintf("B%d", r), row.Service)
		_ = f.SetCellValue(sheet, fmt.Sprintf("C%d", r), row.Region)
		_ = f.SetCellValue(sheet, fmt.Sprintf("D%d", r), row.ResourceID)
		_ = f.SetCellValue(sheet, fmt.Sprintf("E%d", r), row.Name)
		_ = f.SetCellValue(sheet, fmt.Sprintf("F%d", r), row.State)
		_ = f.SetCellValue(sheet, fmt.Sprintf("G%d", r), row.CostEstimateUSD)
		_ = f.SetCellStyle(sheet, fmt.Sprintf("G%d", r), fmt.Sprintf("G%d", r), usdStyle)
		_ = f.SetCellValue(sheet, fmt.Sprintf("H%d", r), row.Severity)
		if row.AIRank != nil {
			_ = f.SetCellValue(sheet, fmt.Sprintf("I%d", r), *row.AIRank)
		}
		_ = f.SetCellValue(sheet, fmt.Sprintf("J%d", r), row.AIRecommendation)
		_ = f.SetCellValue(sheet, fmt.Sprintf("K%d", r), row.Reason)
		if len(row.Tags) > 0 {
			tags, _ := json.Marshal(row.Tags)
			_ = f.SetCellValue(sheet, fmt.Sprintf("L%d", r), string(tags))
		}
	}

	// Summary sheet
	if scan != nil {
		summary := "Summary"
		_, _ = f.NewSheet(summary)
		rows := [][]any{
			{"Scan ID", scanID},
			{"Cloud", scan.Cloud},
			{"Status", scan.Status},
			{"Regions", strings.Join(scan.Regions, ", ")},
			{"Scope", strings.Join(scan.Scope, ", ")},
			{"AI Provider", scan.AIProvider},
			{"AI Model", scan.AIModel},
			{"Started", formatTimePtr(scan.StartedAt)},
			{"Finished", formatTimePtr(scan.FinishedAt)},
			{"Resources", len(rs)},
		}
		for i, kv := range rows {
			_ = f.SetCellValue(summary, fmt.Sprintf("A%d", i+1), kv[0])
			_ = f.SetCellValue(summary, fmt.Sprintf("B%d", i+1), kv[1])
		}
		_ = f.SetColWidth(summary, "A", "A", 18)
		_ = f.SetColWidth(summary, "B", "B", 60)
	}

	// Auto column width on the data sheet
	for col, width := range map[string]float64{
		"A": 8, "B": 14, "C": 14, "D": 50, "E": 28, "F": 12,
		"G": 14, "H": 10, "I": 8, "J": 36, "K": 60, "L": 40,
	} {
		_ = f.SetColWidth(sheet, col, col, width)
	}

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=idle-scan-%d.xlsx", scanID))
	if err := f.Write(w); err != nil {
		log.Printf("xlsx export %d: %v", scanID, err)
	}
}

func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

func handleRerank(w http.ResponseWriter, r *http.Request, scanID, userID int) {
	var body struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	scan, err := getIdleScan(r.Context(), scanID)
	if err != nil || scan == nil {
		respondError(w, http.StatusNotFound, "scan not found")
		return
	}
	resources, err := listIdleResourcesByScan(r.Context(), scanID, resourceFilters{Limit: 5000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	provider := body.Provider
	if provider == "" {
		provider = scan.AIProvider
	}
	model := body.Model
	if model == "" {
		model = scan.AIModel
	}
	ranks, rankErr := rankIdleResources(r.Context(), scanID, provider, model, resources, userID)
	_ = applyAIRanksToResources(r.Context(), scanID, ranks)
	writeIdleAudit(r.Context(), 0, scanID, userID, "scan_reranked", map[string]any{"provider": provider, "model": model})
	out := map[string]any{"status": "ok", "ranked_count": len(ranks), "provider": provider, "model": model}
	if rankErr != nil {
		out["status"] = "fallback"
		out["error"] = rankErr.Error()
	}
	encodeDevopsJSON(w, out)
}

// ---------- summary ----------

func idleSummaryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r, "GET")
		return
	}
	row := DB.QueryRowContext(r.Context(), `
		SELECT
			(SELECT COUNT(*) FROM cloud_accounts WHERE status = 'active'),
			(SELECT COUNT(*) FROM idle_scans WHERE created_at > NOW() - INTERVAL '30 days'),
			(SELECT COALESCE(SUM(cost_estimate_usd), 0) FROM idle_resources r
				JOIN idle_scans s ON s.id = r.scan_id
				WHERE s.created_at > NOW() - INTERVAL '30 days'
				AND s.id IN (SELECT MAX(id) FROM idle_scans GROUP BY account_id)),
			(SELECT COUNT(*) FROM idle_resources r JOIN idle_scans s ON s.id = r.scan_id
				WHERE r.severity = 'high'
				AND s.id IN (SELECT MAX(id) FROM idle_scans GROUP BY account_id))
	`)
	var (
		accounts, recentScans, highCount int
		monthlyWaste                     float64
	)
	if err := row.Scan(&accounts, &recentScans, &monthlyWaste, &highCount); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	encodeDevopsJSON(w, map[string]any{
		"accounts":         accounts,
		"recent_scans":     recentScans,
		"monthly_waste":    monthlyWaste,
		"high_severity":    highCount,
		"status":           "ok",
	})
}

// ---------- helpers ----------

func respondError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	encodeDevopsJSON(w, map[string]any{"error": msg, "status": "error"})
}

func firstNonEmpty(values []string, fallback string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return fallback
}

// ensure context isn't dropped; used by handler signatures referenced above
var _ context.Context = context.Background()

// ---------- schedules ----------

func handleAccountSchedules(w http.ResponseWriter, r *http.Request, accountID int, rest []string, userID int) {
	w.Header().Set("Content-Type", "application/json")
	if len(rest) == 0 || rest[0] == "" {
		switch r.Method {
		case "GET":
			schedules, err := listSchedulesForAccount(r.Context(), accountID)
			if err != nil {
				respondError(w, http.StatusInternalServerError, err.Error())
				return
			}
			encodeDevopsJSON(w, map[string]any{"schedules": schedules, "status": "ok"})
		case "POST":
			var body IdleSchedule
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				respondError(w, http.StatusBadRequest, "invalid json")
				return
			}
			body.AccountID = accountID
			if body.Cadence == "" {
				body.Cadence = "daily"
			}
			if body.HourUTC < 0 || body.HourUTC > 23 {
				body.HourUTC = 4
			}
			if !containsString([]string{"hourly", "daily", "weekly"}, body.Cadence) {
				respondError(w, http.StatusBadRequest, "cadence must be hourly|daily|weekly")
				return
			}
			if body.Name == "" {
				body.Name = "Default schedule"
			}
			saved, err := createIdleSchedule(r.Context(), body, userID)
			if err != nil {
				respondError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeIdleAudit(r.Context(), accountID, 0, userID, "schedule_created", map[string]any{"schedule_id": saved.ID, "cadence": saved.Cadence})
			encodeDevopsJSON(w, map[string]any{"schedule": saved, "status": "ok"})
		default:
			writeMethodNotAllowed(w, r, "GET", "POST")
		}
		return
	}
	id, err := strconv.Atoi(rest[0])
	if err != nil || id <= 0 {
		respondError(w, http.StatusBadRequest, "invalid schedule id")
		return
	}
	switch r.Method {
	case "PATCH", "PUT":
		var body IdleSchedule
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		body.ID = id
		body.AccountID = accountID
		if body.Cadence == "" {
			body.Cadence = "daily"
		}
		if !containsString([]string{"hourly", "daily", "weekly"}, body.Cadence) {
			respondError(w, http.StatusBadRequest, "cadence must be hourly|daily|weekly")
			return
		}
		if err := updateIdleSchedule(r.Context(), body); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeIdleAudit(r.Context(), accountID, 0, userID, "schedule_updated", map[string]any{"schedule_id": id})
		encodeDevopsJSON(w, map[string]any{"status": "ok"})
	case "DELETE":
		if err := deleteIdleSchedule(r.Context(), id); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeIdleAudit(r.Context(), accountID, 0, userID, "schedule_deleted", map[string]any{"schedule_id": id})
		encodeDevopsJSON(w, map[string]any{"status": "ok"})
	default:
		writeMethodNotAllowed(w, r, "PATCH", "PUT", "DELETE")
	}
}

// ---------- exceptions ----------

func handleAccountExceptions(w http.ResponseWriter, r *http.Request, accountID int, rest []string, userID int) {
	w.Header().Set("Content-Type", "application/json")
	if len(rest) == 0 || rest[0] == "" {
		switch r.Method {
		case "GET":
			ex, err := listExceptions(r.Context(), accountID)
			if err != nil {
				respondError(w, http.StatusInternalServerError, err.Error())
				return
			}
			encodeDevopsJSON(w, map[string]any{"exceptions": ex, "status": "ok"})
		case "POST":
			var body struct {
				ResourceID string `json:"resource_id"`
				Reason     string `json:"reason"`
				ExpiresAt  string `json:"expires_at"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				respondError(w, http.StatusBadRequest, "invalid json")
				return
			}
			if strings.TrimSpace(body.ResourceID) == "" {
				respondError(w, http.StatusBadRequest, "resource_id required")
				return
			}
			var exp *time.Time
			if strings.TrimSpace(body.ExpiresAt) != "" {
				t, err := time.Parse(time.RFC3339, body.ExpiresAt)
				if err == nil {
					exp = &t
				}
			}
			created, err := createException(r.Context(), accountID, body.ResourceID, body.Reason, exp, userID)
			if err != nil {
				respondError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeIdleAudit(r.Context(), accountID, 0, userID, "exception_created", map[string]any{"resource_id": body.ResourceID})
			encodeDevopsJSON(w, map[string]any{"exception": created, "status": "ok"})
		default:
			writeMethodNotAllowed(w, r, "GET", "POST")
		}
		return
	}
	id, err := strconv.Atoi(rest[0])
	if err != nil || id <= 0 {
		respondError(w, http.StatusBadRequest, "invalid exception id")
		return
	}
	if r.Method == "DELETE" {
		if err := deleteException(r.Context(), id); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeIdleAudit(r.Context(), accountID, 0, userID, "exception_deleted", map[string]any{"exception_id": id})
		encodeDevopsJSON(w, map[string]any{"status": "ok"})
		return
	}
	writeMethodNotAllowed(w, r, "DELETE")
}

// ---------- audit log viewer ----------

func idleAuditHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r, "GET")
		return
	}
	accountID, _ := strconv.Atoi(r.URL.Query().Get("account_id"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := listAuditLog(r.Context(), accountID, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	encodeDevopsJSON(w, map[string]any{"entries": entries, "status": "ok"})
}

// ensure time import is referenced
var _ = time.Now

// ---------- remediations ----------

func handleScanRemediations(w http.ResponseWriter, r *http.Request, scanID, userID int) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case "GET":
		out, err := listRemediationsForScan(r.Context(), scanID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		encodeDevopsJSON(w, map[string]any{"remediations": out, "status": "ok"})
	case "POST":
		var body struct {
			Target      string   `json:"target"`
			ResourceIDs []string `json:"resource_ids"`
			Notes       string   `json:"notes"`
			IssueType   string   `json:"issue_type"`
			BranchName  string   `json:"branch_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		body.Target = strings.TrimSpace(body.Target)
		if !containsString([]string{"download", "github_pr", "jira_ticket"}, body.Target) {
			respondError(w, http.StatusBadRequest, "target must be download|github_pr|jira_ticket")
			return
		}
		if len(body.ResourceIDs) == 0 {
			respondError(w, http.StatusBadRequest, "resource_ids required")
			return
		}
		runRemediation(w, r, scanID, userID, body.Target, body.ResourceIDs, body.Notes, body.IssueType, body.BranchName)
	default:
		writeMethodNotAllowed(w, r, "GET", "POST")
	}
}

func runRemediation(w http.ResponseWriter, r *http.Request, scanID, userID int, target string, resourceIDs []string, notes, issueType, branchName string) {
	scan, err := getIdleScan(r.Context(), scanID)
	if err != nil || scan == nil {
		respondError(w, http.StatusNotFound, "scan not found")
		return
	}
	allResources, err := listIdleResourcesByScan(r.Context(), scanID, resourceFilters{Limit: 5000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	picked := filterResourcesByID(allResources, resourceIDs)
	if len(picked) == 0 {
		respondError(w, http.StatusBadRequest, "none of the supplied resource_ids match this scan")
		return
	}
	totalCost := 0.0
	for _, p := range picked {
		totalCost += p.CostEstimateUSD
	}
	rem := IdleRemediation{
		ScanID:              scanID,
		AccountID:           scan.AccountID,
		Target:              target,
		ResourceIDs:         resourceIDs,
		EstimatedSavingsUSD: totalCost,
		Notes:               notes,
		Status:              "pending",
	}

	tf := generateCleanupTerraform(scan, picked)

	switch target {
	case "download":
		// Persist row first to obtain an ID for the artifact key.
		saved, err := saveRemediation(r.Context(), rem, userID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		url, err := uploadCleanupTerraformArtifact(r.Context(), scanID, saved.ID, tf)
		if err != nil {
			finalizeRemediation(r.Context(), saved.ID, "failed", err.Error(), nil)
			respondError(w, http.StatusBadGateway, "supabase upload: "+err.Error())
			return
		}
		finalizeRemediation(r.Context(), saved.ID, "completed", "", map[string]string{"cleanup_tf_url": url})
		writeIdleAudit(r.Context(), scan.AccountID, scanID, userID, "remediation_download", map[string]any{"remediation_id": saved.ID, "resources": len(picked), "savings_usd": totalCost})
		saved.CleanupTfURL = url
		saved.Status = "completed"
		encodeDevopsJSON(w, map[string]any{"remediation": saved, "status": "ok"})

	case "github_pr":
		saved, err := saveRemediation(r.Context(), rem, userID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		artifactURL, _ := uploadCleanupTerraformArtifact(r.Context(), scanID, saved.ID, tf)
		branch := strings.TrimSpace(branchName)
		if branch == "" {
			branch = fmt.Sprintf("idle-cleanup/scan-%d-rem-%d", scanID, saved.ID)
		}
		title := fmt.Sprintf("Idle resource cleanup · scan #%d (%d resources, $%.2f/mo)", scanID, len(picked), totalCost)
		body := buildJiraDescription(scan, picked, artifactURL, "")
		path := fmt.Sprintf("idle-cleanup/scan-%d.tf", scanID)
		prURL, err := CreateGitHubPRWithFiles(branch, map[string][]byte{path: tf}, title, body)
		if err != nil {
			finalizeRemediation(r.Context(), saved.ID, "failed", err.Error(), map[string]string{"cleanup_tf_url": artifactURL})
			respondError(w, http.StatusBadGateway, "github pr: "+err.Error())
			return
		}
		finalizeRemediation(r.Context(), saved.ID, "completed", "", map[string]string{"cleanup_tf_url": artifactURL, "pr_url": prURL})
		writeIdleAudit(r.Context(), scan.AccountID, scanID, userID, "remediation_pr", map[string]any{"remediation_id": saved.ID, "pr_url": prURL, "savings_usd": totalCost})
		saved.CleanupTfURL = artifactURL
		saved.PRURL = prURL
		saved.Status = "completed"
		encodeDevopsJSON(w, map[string]any{"remediation": saved, "status": "ok"})

	case "jira_ticket":
		saved, err := saveRemediation(r.Context(), rem, userID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		artifactURL, _ := uploadCleanupTerraformArtifact(r.Context(), scanID, saved.ID, tf)
		summary := fmt.Sprintf("Idle resource cleanup · scan #%d (%d resources, $%.2f/mo)", scanID, len(picked), totalCost)
		desc := buildJiraDescription(scan, picked, artifactURL, "")
		key, ticketURL, err := createJiraIssue(r.Context(), JiraIssueRequest{Summary: summary, Description: desc, IssueType: issueType})
		if err != nil {
			finalizeRemediation(r.Context(), saved.ID, "failed", err.Error(), map[string]string{"cleanup_tf_url": artifactURL})
			respondError(w, http.StatusBadGateway, "jira: "+err.Error())
			return
		}
		finalizeRemediation(r.Context(), saved.ID, "completed", "", map[string]string{"cleanup_tf_url": artifactURL, "ticket_url": ticketURL, "ticket_key": key})
		writeIdleAudit(r.Context(), scan.AccountID, scanID, userID, "remediation_ticket", map[string]any{"remediation_id": saved.ID, "ticket_key": key, "savings_usd": totalCost})
		saved.CleanupTfURL = artifactURL
		saved.TicketURL = ticketURL
		saved.TicketKey = key
		saved.Status = "completed"
		encodeDevopsJSON(w, map[string]any{"remediation": saved, "status": "ok"})
	}
}

// handleCleanupTfPreview lets users preview the generated Terraform without
// committing to a remediation row. Useful for sanity-checking before opening
// a PR. Accepts ?resource_ids=a,b,c (else uses all resources in the scan).
func handleCleanupTfPreview(w http.ResponseWriter, r *http.Request, scanID int) {
	scan, err := getIdleScan(r.Context(), scanID)
	if err != nil || scan == nil {
		respondError(w, http.StatusNotFound, "scan not found")
		return
	}
	allResources, err := listIdleResourcesByScan(r.Context(), scanID, resourceFilters{Limit: 5000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	picked := allResources
	if ids := strings.TrimSpace(r.URL.Query().Get("resource_ids")); ids != "" {
		picked = filterResourcesByID(allResources, strings.Split(ids, ","))
	}
	tf := generateCleanupTerraform(scan, picked)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=cleanup-scan-%d.tf", scanID))
	_, _ = w.Write(tf)
}

func filterResourcesByID(rs []IdleResource, ids []string) []IdleResource {
	want := map[string]struct{}{}
	for _, id := range ids {
		s := strings.TrimSpace(id)
		if s != "" {
			want[s] = struct{}{}
		}
	}
	out := make([]IdleResource, 0, len(want))
	for _, r := range rs {
		if _, ok := want[r.ResourceID]; ok {
			out = append(out, r)
		}
	}
	return out
}

func finalizeRemediation(ctx context.Context, id int, status, errMsg string, fields map[string]string) {
	if DB == nil {
		return
	}
	cleanup := fields["cleanup_tf_url"]
	pr := fields["pr_url"]
	ticket := fields["ticket_url"]
	key := fields["ticket_key"]
	_, _ = DB.ExecContext(ctx, `
		UPDATE idle_remediations SET
			status = $2,
			error_message = NULLIF($3, ''),
			cleanup_tf_url = COALESCE(NULLIF($4, ''), cleanup_tf_url),
			pr_url = COALESCE(NULLIF($5, ''), pr_url),
			ticket_url = COALESCE(NULLIF($6, ''), ticket_url),
			ticket_key = COALESCE(NULLIF($7, ''), ticket_key),
			completed_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, status, errMsg, cleanup, pr, ticket, key)
}
