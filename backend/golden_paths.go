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
	Advanced bool   `json:"advanced,omitempty"`
}

func goldenPaths() []goldenPath {
	return []goldenPath{
		{ID: "database", Title: "Add a database", Summary: "Managed Postgres or MySQL with backups and a safe default size.", Cloud: "aws", Service: "rds", Href: "/select-service?cloud=aws&service=rds"},
		{ID: "cache", Title: "Add cache / Redis", Summary: "In-memory cache for sessions, queues, or hot keys.", Cloud: "aws", Service: "elasticache", Href: "/select-service?cloud=aws&service=elasticache"},
		{ID: "kubernetes", Title: "Run a Kubernetes app", Summary: "Cluster or workload path with a production-ready node default.", Cloud: "aws", Service: "eks", Href: "/select-service?cloud=aws&service=eks"},
		{ID: "api", Title: "Expose a public API", Summary: "Load balancer or ingress so a service can be reached safely.", Cloud: "aws", Service: "alb", Href: "/select-service?cloud=aws&service=alb"},
		{ID: "iam", Title: "Grant IAM access", Summary: "Identity and permission changes for a cloud account.", Cloud: "aws", Service: "iam", Href: "/create-infrastructure/iam"},
		{ID: "advanced", Title: "Cloud + JSON", Summary: "Use the raw cloud picker or paste a prepared payload.", Href: "/custom-json", Advanced: true},
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
	if _, _, ok := requireSignedIn(w, r); !ok {
		return
	}
	cloud := r.URL.Query().Get("cloud")
	service := r.URL.Query().Get("service")
	env := r.URL.Query().Get("env")
	instance := r.URL.Query().Get("instance_type")
	projectID := atoiDefault(r.URL.Query().Get("project_id"), 0)
	if r.Method == http.MethodPost {
		var body struct {
			Cloud        string `json:"cloud"`
			Service      string `json:"service"`
			Env          string `json:"env"`
			InstanceType string `json:"instance_type"`
			ProjectID    int    `json:"project_id"`
			MonthlyUSD   int    `json:"monthly_budget_usd"`
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
			if body.ProjectID > 0 {
				projectID = body.ProjectID
			}
			if body.MonthlyUSD > 0 && body.ProjectID > 0 {
				_ = saveProjectBudget(body.ProjectID, body.MonthlyUSD)
			}
		}
	}
	estimate := estimateInstanceCost(cloud, service, env, instance)
	budget := loadProjectBudget(projectID)
	allowed := true
	warning := ""
	if budget > 0 && estimate > budget {
		allowed = false
		warning = "This estimate exceeds the project monthly budget."
	} else if budget > 0 && estimate*100 >= budget*80 {
		warning = "This estimate uses most of the project monthly budget."
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":            "ok",
		"estimated_monthly": estimate,
		"currency":          "USD",
		"budget_monthly":    budget,
		"allowed":           allowed,
		"warning":           warning,
		"instance_type":     instance,
		"cloud":             cloud,
		"service":           service,
		"env":               env,
	})
}

func estimateInstanceCost(cloud, service, env, instance string) int {
	key := strings.ToLower(strings.TrimSpace(instance))
	table := map[string]int{
		"t2.micro": 8, "t3.micro": 8, "t3.small": 16, "t3.medium": 30, "t3.large": 60,
		"m5.large": 70, "db.t3.micro": 15, "db.t3.small": 28, "db.t3.medium": 55,
		"cache.t3.micro": 12, "cache.t3.small": 24,
	}
	if monthly, ok := table[key]; ok {
		if strings.EqualFold(env, "prod") || strings.EqualFold(env, "production") {
			return monthly * 2
		}
		return monthly
	}
	_, monthlyLabel, _ := estimateCostFootprint(cloud, service, env, "")
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, monthlyLabel)
	if digits == "" {
		return 25
	}
	return atoiDefault(digits, 25)
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
