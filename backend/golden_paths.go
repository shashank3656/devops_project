package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

type goldenPath struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	Cloud    string `json:"cloud"`
	Service  string `json:"service"`
	Href     string `json:"href"`
	Icon     string `json:"icon,omitempty"`
	Review   string `json:"review,omitempty"`
	Advanced bool   `json:"advanced,omitempty"`
}

func goldenPaths() []goldenPath {
	return []goldenPath{
		{ID: "database", Title: "Add a database", Summary: "Managed Postgres or MySQL with backups and a safe default size.", Cloud: "aws", Service: "rds", Href: "/select-service?cloud=aws&service=rds", Icon: "database", Review: "Manager + DevOps review"},
		{ID: "cache", Title: "Add cache / Redis", Summary: "In-memory cache for sessions, queues, or hot keys.", Cloud: "aws", Service: "elasticache", Href: "/select-service?cloud=aws&service=elasticache", Icon: "cache", Review: "DevOps review"},
		{ID: "kubernetes", Title: "Run a Kubernetes app", Summary: "Cluster or workload path with a production-ready node default.", Cloud: "aws", Service: "eks", Href: "/select-service?cloud=aws&service=eks", Icon: "kubernetes", Review: "Manager + DevOps review"},
		{ID: "api", Title: "Expose a public API", Summary: "Load balancer or ingress so a service can be reached safely.", Cloud: "aws", Service: "alb", Href: "/select-service?cloud=aws&service=alb", Icon: "globe", Review: "DevOps review"},
		{ID: "iam", Title: "Grant IAM access", Summary: "Identity and permission changes for a cloud account.", Cloud: "aws", Service: "iam", Href: "/create-infrastructure/iam", Icon: "key", Review: "Manager + security review"},
		{ID: "advanced", Title: "Cloud + JSON", Summary: "Use the raw cloud picker or paste a prepared payload.", Href: "/custom-json", Icon: "code", Advanced: true},
	}
}

func goldenPathsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	if _, _, ok := requireSignedIn(w, r); !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "paths": goldenPaths()})
}

type costGuardrailInput struct {
	Cloud        string
	Service      string
	Env          string
	InstanceType string
	Budget       int
	FreezeActive bool
}

type costGuardrailResult struct {
	Estimate      int      `json:"estimated_monthly"`
	EstimateLow   int      `json:"estimate_low"`
	EstimateHigh  int      `json:"estimate_high"`
	Basis         string   `json:"estimate_basis"`
	Exact         bool     `json:"estimate_exact"`
	Budget        int      `json:"budget_monthly"`
	BudgetUsedPct int      `json:"budget_used_pct"`
	Allowed       bool     `json:"allowed"`
	Warning       string   `json:"warning"`
	RiskLevel     string   `json:"risk_level"`
	ImpactNotes   []string `json:"impact_notes"`
}

func costGuardrailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodPost)
		return
	}
	userID, _, ok := requireSignedIn(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	cloud := query.Get("cloud")
	service := query.Get("service")
	env := query.Get("env")
	instance := query.Get("instance_type")
	team := query.Get("team")
	projectID := atoiDefault(query.Get("project_id"), 0)
	if r.Method == http.MethodPost {
		var body struct {
			Cloud               string `json:"cloud"`
			Service             string `json:"service"`
			Env                 string `json:"env"`
			InstanceType        string `json:"instance_type"`
			Team                string `json:"team"`
			ProjectID           int    `json:"project_id"`
			MonthlyUSD          int    `json:"monthly_budget_usd"`
			DefaultTempEnvDays  int    `json:"default_temp_env_days"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
			if body.Cloud != "" {
				cloud = body.Cloud
			}
			if body.Service != "" {
				service = body.Service
			}
			if body.Env != "" {
				env = body.Env
			}
			if body.InstanceType != "" {
				instance = body.InstanceType
			}
			if body.Team != "" {
				team = body.Team
			}
			if body.ProjectID > 0 {
				projectID = body.ProjectID
			}
			if body.ProjectID > 0 {
				settings := loadProjectInfraSettings(body.ProjectID)
				if body.MonthlyUSD > 0 {
					settings.MonthlyBudgetUSD = body.MonthlyUSD
				}
				if body.DefaultTempEnvDays >= 0 {
					settings.DefaultTempEnvDays = body.DefaultTempEnvDays
				}
				_ = saveProjectInfraSettings(body.ProjectID, settings)
			}
		}
	}

	result := buildCostGuardrail(costGuardrailInput{
		Cloud:        cloud,
		Service:      service,
		Env:          env,
		InstanceType: instance,
		Budget:       loadProjectBudget(projectID),
		FreezeActive: envEqualsProd(env) && activeFreezeReason() != "",
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":            "ok",
		"estimated_monthly": result.Estimate,
		"estimate_low":      result.EstimateLow,
		"estimate_high":     result.EstimateHigh,
		"estimate_basis":    result.Basis,
		"estimate_exact":    result.Exact,
		"currency":          "USD",
		"budget_monthly":    result.Budget,
		"budget_used_pct":   result.BudgetUsedPct,
		"allowed":           result.Allowed,
		"warning":           result.Warning,
		"risk_level":        result.RiskLevel,
		"impact_notes":      result.ImpactNotes,
		"approval_path":     guardrailApprovalPath(projectID, userID, team, env),
		"calculator_url":    getCostCalculatorLink(cloud, service),
		"instance_type":     instance,
		"cloud":             cloud,
		"service":           service,
		"env":               env,
	})
}

func buildCostGuardrail(in costGuardrailInput) costGuardrailResult {
	res := costGuardrailResult{Allowed: true, Budget: in.Budget, ImpactNotes: []string{}}
	res.Estimate, res.EstimateLow, res.EstimateHigh, res.Basis, res.Exact = estimateMonthlyCost(in.Cloud, in.Service, in.Env, in.InstanceType)

	if in.Budget > 0 {
		res.BudgetUsedPct = res.Estimate * 100 / in.Budget
		switch {
		case res.Estimate > in.Budget:
			res.Allowed = false
			res.Warning = "This estimate exceeds the project monthly budget."
		case res.BudgetUsedPct >= 80:
			res.Warning = "This estimate uses most of the project monthly budget."
		}
	}

	prod := envEqualsProd(in.Env)
	stateful := isStatefulService(in.Service)
	res.RiskLevel = "low"
	if prod {
		res.RiskLevel = "medium"
		res.ImpactNotes = append(res.ImpactNotes, "Touches production. Changes roll out only after approval.")
	} else if strings.TrimSpace(in.Env) != "" {
		res.ImpactNotes = append(res.ImpactNotes, "Non-production change. No customer impact expected.")
	}
	if stateful {
		res.ImpactNotes = append(res.ImpactNotes, "Stateful service. Keep backups and deletion protection on.")
		if prod {
			res.RiskLevel = "high"
		}
	}
	if in.FreezeActive {
		res.RiskLevel = "high"
		res.ImpactNotes = append(res.ImpactNotes, "A production freeze is active. This request will wait until it ends.")
	}
	if !res.Allowed {
		res.RiskLevel = "high"
	}
	return res
}

// estimateMonthlyCost returns a point estimate plus a low/high range in USD.
// Exact is true when the instance type matched the price table.
func estimateMonthlyCost(cloud, service, env, instance string) (estimate, low, high int, basis string, exact bool) {
	key := strings.ToLower(strings.TrimSpace(instance))
	table := map[string]int{
		"t2.micro": 8, "t3.micro": 8, "t3.small": 16, "t3.medium": 30, "t3.large": 60,
		"m5.large": 70, "db.t3.micro": 15, "db.t3.small": 28, "db.t3.medium": 55,
		"cache.t3.micro": 12, "cache.t3.small": 24,
	}
	if monthly, ok := table[key]; ok {
		if envEqualsProd(env) {
			monthly *= 2
		}
		return monthly, monthly, monthly, "Priced from " + key, true
	}
	band, _, bandBasis := estimateCostFootprint(cloud, service, env, "")
	low, high = costBandRange(band)
	return (low + high) / 2, low, high, bandBasis, false
}

func costBandRange(band string) (int, int) {
	switch strings.ToLower(strings.TrimSpace(band)) {
	case "low":
		return 25, 100
	case "moderate":
		return 100, 400
	case "elevated":
		return 400, 1500
	case "high":
		return 1500, 3000
	default:
		return 25, 100
	}
}

func isStatefulService(service string) bool {
	key := strings.ToLower(strings.TrimSpace(service))
	for _, marker := range []string{"rds", "sql", "postgres", "mysql", "elasticache", "redis", "mongo", "storage", "bucket", "s3", "dynamo", "efs", "disk"} {
		if strings.Contains(key, marker) {
			return true
		}
	}
	return false
}

func guardrailApprovalPath(projectID, userID int, team, env string) []string {
	path := []string{}
	if DB == nil || strings.TrimSpace(env) == "" {
		return path
	}
	var pid *int
	if projectID > 0 {
		pid = &projectID
	}
	status := determineApprovalStatusForRequest(pid, userID, team, env)
	if status == "pending_user_manager_approval" {
		path = append(path, "Your manager")
		status = determinePostManagerApprovalStatus(pid, env)
	}
	switch status {
	case "pending_devops_approval":
		path = append(path, "DevOps team")
	case "pending_approval":
		path = append(path, "Platform admin")
	}
	return path
}

func saveProjectBudget(projectID, monthlyUSD int) error {
	if DB == nil || projectID <= 0 {
		return nil
	}
	_, err := DB.Exec(`UPDATE projects SET monthly_budget_usd = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, monthlyUSD, projectID)
	return err
}

func loadProjectBudget(projectID int) int {
	if DB == nil || projectID <= 0 {
		return 0
	}
	var budget int
	_ = DB.QueryRow(`SELECT COALESCE(monthly_budget_usd, 0) FROM projects WHERE id = $1`, projectID).Scan(&budget)
	return budget
}

func atoiDefault(raw string, fallback int) int {
	raw = strings.TrimSpace(raw)
	n := 0
	for _, r := range raw {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int(r-'0')
	}
	if n == 0 && raw != "0" {
		return fallback
	}
	return n
}
