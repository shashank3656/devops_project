package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// costEstimateHandler GET /api/cost-estimate?cloud=aws&service=EKS&env=prod - returns pricing calculator link and optional ballpark
func costEstimateHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	cloud := r.URL.Query().Get("cloud")
	service := r.URL.Query().Get("service")
	env := r.URL.Query().Get("env")
	band, monthly, basis := estimateCostFootprint(cloud, service, env, "")
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"link":              getCostCalculatorLink(cloud, service),
		"estimate":          monthly,
		"estimated_band":    band,
		"estimated_monthly": monthly,
		"estimate_basis":    basis,
		"cloud":             cloud,
		"service":           service,
		"env":               env,
		"status":            "ok",
	}); err != nil {
		requestID := requestIDFromContext(r.Context())
		traceID, spanID := traceAndSpanIDs(r.Context())
		log.Printf(
			"[HTTP] error_response_encode_failed request_id=%s trace_id=%s span_id=%s method=%s path=%s err=%v",
			requestID,
			traceID,
			spanID,
			r.Method,
			r.URL.Path,
			err,
		)
	}
}
