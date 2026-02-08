package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

// costEstimateHandler GET /api/cost-estimate?cloud=aws&service=EKS&env=prod - returns pricing calculator link and optional ballpark
func costEstimateHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cloud := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("cloud")))
	service := strings.TrimSpace(r.URL.Query().Get("service"))
	env := strings.TrimSpace(r.URL.Query().Get("env"))
	link := ""
	var estimate interface{} = nil
	switch cloud {
	case "aws":
		link = "https://calculator.aws/"
		if service != "" {
			link = "https://calculator.aws/#/estimate?service=" + strings.ToLower(strings.ReplaceAll(service, " ", "-"))
		}
	case "gcp":
		link = "https://cloud.google.com/products/calculator"
	case "azure":
		link = "https://azure.microsoft.com/en-us/pricing/calculator/"
	default:
		link = "https://calculator.aws/"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"link":     link,
		"estimate": estimate,
		"cloud":    cloud,
		"service":  service,
		"env":      env,
		"status":   "ok",
	})
}
