package main

import (
	"net/http"
	"strconv"
	"strings"
)

type requestBundleNormalizationCandidate struct {
	ID            int
	Team          string
	Env           string
	Cloud         string
	Service       string
	ApplicationID string
	Config        string
}

type requestBundleNormalizationItem struct {
	RequestID          int    `json:"request_id"`
	ApplicationID      string `json:"application_id,omitempty"`
	Team               string `json:"team"`
	BeforeEnv          string `json:"before_env"`
	AfterEnv           string `json:"after_env,omitempty"`
	BeforeCloud        string `json:"before_cloud"`
	AfterCloud         string `json:"after_cloud,omitempty"`
	BeforeService      string `json:"before_service"`
	AfterService       string `json:"after_service,omitempty"`
	BundleCount        int    `json:"bundle_count"`
	ConfigChanged      bool   `json:"config_changed"`
	ServiceItemsSynced bool   `json:"service_items_synced"`
	Error              string `json:"error,omitempty"`
}

func adminRequestBundleNormalizationHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}

	limit := 100
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil && parsed > 0 {
			if parsed > 500 {
				parsed = 500
			}
			limit = parsed
		}
	}

	candidates, err := listBundledRequestsForNormalization(limit)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
		return
	}

	dryRun := r.Method == http.MethodGet
	items := make([]requestBundleNormalizationItem, 0, len(candidates))
	configChangesNeeded := 0
	serviceItemsSynced := 0
	errorCount := 0

	for _, candidate := range candidates {
		item := requestBundleNormalizationItem{
			RequestID:     candidate.ID,
			ApplicationID: candidate.ApplicationID,
			Team:          candidate.Team,
			BeforeEnv:     candidate.Env,
			BeforeCloud:   candidate.Cloud,
			BeforeService: candidate.Service,
		}

		req := &PRRequest{
			ID:            candidate.ID,
			Team:          candidate.Team,
			Env:           candidate.Env,
			Cloud:         candidate.Cloud,
			Service:       candidate.Service,
			ApplicationID: candidate.ApplicationID,
			Config:        candidate.Config,
		}
		normalizedConfig, entries, changed, normalizeErr := normalizeStoredRequestBundleConfig(req, nil)
		if normalizeErr != nil {
			item.Error = normalizeErr.Error()
			errorCount++
			items = append(items, item)
			continue
		}
		if len(entries) == 0 {
			continue
		}

		applyRequestBundleEntries(req, entries)
		item.BundleCount = len(entries)
		item.ConfigChanged = changed
		item.AfterEnv = req.Env
		item.AfterCloud = req.Cloud
		item.AfterService = req.Service
		if changed {
			configChangesNeeded++
		}

		if !dryRun {
			req.Config = normalizedConfig
			if changed {
				if err := BackfillPRRequestNormalizedConfig(req.ID, normalizedConfig); err != nil {
					item.Error = err.Error()
					errorCount++
					items = append(items, item)
					continue
				}
			}
			if err := replaceRequestServiceItems(req.ID, req); err != nil {
				item.Error = err.Error()
				errorCount++
				items = append(items, item)
				continue
			}
			item.ServiceItemsSynced = true
			serviceItemsSynced++
		}

		items = append(items, item)
	}

	encodeAdminJSON(w, map[string]interface{}{
		"status":                "ok",
		"dry_run":               dryRun,
		"scanned":               len(candidates),
		"bundled_requests":      len(items),
		"config_changes_needed": configChangesNeeded,
		"service_items_synced":  serviceItemsSynced,
		"errors":                errorCount,
		"items":                 items,
	})
}

func listBundledRequestsForNormalization(limit int) ([]requestBundleNormalizationCandidate, error) {
	rows, err := DB.Query(`
		SELECT id, team, env, cloud, service, COALESCE(application_id,''), COALESCE(config,'')
		FROM pr_requests
		WHERE POSITION('service_bundle' IN COALESCE(config, '')) > 0
		ORDER BY id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]requestBundleNormalizationCandidate, 0)
	for rows.Next() {
		var item requestBundleNormalizationCandidate
		if err := rows.Scan(&item.ID, &item.Team, &item.Env, &item.Cloud, &item.Service, &item.ApplicationID, &item.Config); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}
