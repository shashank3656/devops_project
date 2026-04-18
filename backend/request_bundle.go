package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type ServiceBundleEntry struct {
	Env               string                 `json:"env,omitempty"`
	Cloud             string                 `json:"cloud"`
	Service           string                 `json:"service"`
	NormalizedService string                 `json:"normalized_service,omitempty"`
	DisplayName       string                 `json:"display_name,omitempty"`
	Config            map[string]interface{} `json:"config,omitempty"`
}

type RequestBundleSummary struct {
	Count        int      `json:"count"`
	Clouds       []string `json:"clouds,omitempty"`
	Services     []string `json:"services,omitempty"`
	DisplayNames []string `json:"display_names,omitempty"`
}

func canonicalizeRequestBundlePayload(payload InfraRequest) ([]ServiceBundleEntry, error) {
	if payload == nil {
		return nil, nil
	}

	target, targetIsNested := resolveRequestBundleTarget(payload)
	rawBundle, hasBundle := target["service_bundle"]
	if !hasBundle || rawBundle == nil {
		delete(target, "bundle_mode")
		delete(target, "bundle_summary")
		delete(target, "service_bundle")
		if targetIsNested {
			delete(payload, "bundle_mode")
			delete(payload, "bundle_summary")
			delete(payload, "service_bundle")
		}
		return nil, nil
	}

	entries, err := normalizeServiceBundleEntries(rawBundle)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("service_bundle must include at least one service")
	}

	primary := entries[0]
	payload["cloud"] = primary.Cloud
	payload["service"] = primary.Service
	target["bundle_mode"] = len(entries) > 1
	target["service_bundle"] = entries
	target["bundle_summary"] = buildRequestBundleSummary(entries)
	prunePrimaryServiceConfigFieldsForBundle(target, entries)

	return entries, nil
}

func resolveRequestBundleTarget(payload InfraRequest) (map[string]interface{}, bool) {
	if payload == nil {
		return nil, false
	}
	if rawConfig, ok := payload["config"].(map[string]interface{}); ok && rawConfig != nil {
		return rawConfig, true
	}
	return payload, false
}

func normalizeServiceBundleEntries(raw any) ([]ServiceBundleEntry, error) {
	switch value := raw.(type) {
	case []ServiceBundleEntry:
		entries := make([]ServiceBundleEntry, 0, len(value))
		for _, entry := range value {
			normalized, err := normalizeServiceBundleEntry(entry)
			if err != nil {
				return nil, err
			}
			entries = append(entries, normalized)
		}
		return entries, nil
	case []interface{}:
		entries := make([]ServiceBundleEntry, 0, len(value))
		for index, item := range value {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				return nil, fmt.Errorf("service_bundle item %d is invalid", index+1)
			}
			normalized, err := normalizeServiceBundleEntryFromMap(itemMap)
			if err != nil {
				return nil, fmt.Errorf("service_bundle item %d: %w", index+1, err)
			}
			entries = append(entries, normalized)
		}
		return entries, nil
	default:
		return nil, fmt.Errorf("service_bundle must be an array")
	}
}

func normalizeServiceBundleEntryFromMap(item map[string]interface{}) (ServiceBundleEntry, error) {
	entry := ServiceBundleEntry{}

	cloud, _ := item["cloud"].(string)
	env, _ := item["env"].(string)
	service, _ := item["service"].(string)
	entry.Env = strings.TrimSpace(env)
	entry.Cloud = strings.TrimSpace(cloud)
	entry.Service = strings.TrimSpace(service)
	entry.NormalizedService = strings.TrimSpace(stringValue(item["normalized_service"]))
	entry.DisplayName = strings.TrimSpace(stringValue(item["display_name"]))

	if rawConfig, ok := item["config"]; ok && rawConfig != nil {
		switch config := rawConfig.(type) {
		case map[string]interface{}:
			entry.Config = config
		default:
			bytes, err := json.Marshal(config)
			if err != nil {
				return ServiceBundleEntry{}, fmt.Errorf("config is invalid")
			}
			var decoded map[string]interface{}
			if err := json.Unmarshal(bytes, &decoded); err != nil {
				return ServiceBundleEntry{}, fmt.Errorf("config is invalid")
			}
			entry.Config = decoded
		}
	}

	return normalizeServiceBundleEntry(entry)
}

func normalizeServiceBundleEntry(entry ServiceBundleEntry) (ServiceBundleEntry, error) {
	entry.Cloud = strings.TrimSpace(entry.Cloud)
	entry.Env = strings.TrimSpace(entry.Env)
	entry.Service = strings.TrimSpace(entry.Service)
	entry.NormalizedService = strings.TrimSpace(entry.NormalizedService)
	entry.DisplayName = strings.TrimSpace(entry.DisplayName)

	if entry.Cloud == "" {
		return ServiceBundleEntry{}, fmt.Errorf("cloud is required")
	}
	if entry.Service == "" {
		return ServiceBundleEntry{}, fmt.Errorf("service is required")
	}
	normalizedService := normalizeRequestServiceKey(entry.Cloud, entry.Service)
	if normalizedService == "" {
		normalizedService = normalizeRequestServiceKey(entry.Cloud, entry.NormalizedService)
	}
	if normalizedService != "" {
		entry.Service = normalizedService
		entry.NormalizedService = normalizedService
	} else if entry.NormalizedService == "" {
		entry.NormalizedService = entry.Service
	}
	if entry.Config == nil {
		entry.Config = map[string]interface{}{}
	}
	if entry.Env == "" {
		entry.Env = strings.TrimSpace(stringValue(entry.Config["env"]))
	}
	if entry.Env != "" {
		entry.Config["env"] = entry.Env
	}
	return entry, nil
}

func buildRequestBundleSummary(entries []ServiceBundleEntry) *RequestBundleSummary {
	if len(entries) == 0 {
		return nil
	}

	cloudSeen := map[string]bool{}
	serviceSeen := map[string]bool{}
	displaySeen := map[string]bool{}
	summary := &RequestBundleSummary{
		Count:        len(entries),
		Clouds:       make([]string, 0, len(entries)),
		Services:     make([]string, 0, len(entries)),
		DisplayNames: make([]string, 0, len(entries)),
	}

	for _, entry := range entries {
		if entry.Cloud != "" && !cloudSeen[entry.Cloud] {
			cloudSeen[entry.Cloud] = true
			summary.Clouds = append(summary.Clouds, entry.Cloud)
		}
		if entry.Service != "" && !serviceSeen[entry.Service] {
			serviceSeen[entry.Service] = true
			summary.Services = append(summary.Services, entry.Service)
		}
		if entry.DisplayName != "" && !displaySeen[entry.DisplayName] {
			displaySeen[entry.DisplayName] = true
			summary.DisplayNames = append(summary.DisplayNames, entry.DisplayName)
		}
	}

	sort.Strings(summary.Clouds)
	sort.Strings(summary.Services)
	sort.Strings(summary.DisplayNames)

	return summary
}

func hydrateRequestBundleMetadata(req *PRRequest) {
	if req == nil || strings.TrimSpace(req.Config) == "" {
		return
	}

	entries, err := extractServiceBundleEntriesFromConfig(req.Config)
	if err != nil || len(entries) == 0 {
		return
	}
	applyRequestBundleEntries(req, entries)
	if req.ID > 0 && DB != nil {
		_ = replaceRequestServiceItems(req.ID, req)
	}
}

func primaryRequestService(req *PRRequest) (cloud string, service string) {
	if req == nil {
		return "", ""
	}
	if len(req.ServiceBundle) > 0 {
		return req.ServiceBundle[0].Cloud, req.ServiceBundle[0].Service
	}
	return req.Cloud, req.Service
}

func validateProjectBundleRequestForUser(userID, projectID int, teamNameOrSlug, environment, fallbackCloud, fallbackService string, entries []ServiceBundleEntry) (*ProjectRequestValidation, error) {
	if projectID <= 0 {
		return nil, nil
	}
	if len(entries) == 0 {
		return validateProjectRequestForUser(userID, projectID, teamNameOrSlug, environment, fallbackCloud, fallbackService)
	}

	var primaryValidation *ProjectRequestValidation
	for _, entry := range entries {
		validation, err := validateProjectRequestForUser(
			userID,
			projectID,
			teamNameOrSlug,
			bundleEntryEnvironment(entry, environment),
			entry.Cloud,
			entry.Service,
		)
		if err != nil {
			return nil, err
		}
		if primaryValidation == nil {
			primaryValidation = validation
		}
	}
	return primaryValidation, nil
}

func bundleEntryEnvironment(entry ServiceBundleEntry, fallback string) string {
	if env := strings.TrimSpace(entry.Env); env != "" {
		return env
	}
	if entry.Config != nil {
		if env := strings.TrimSpace(stringValue(entry.Config["env"])); env != "" {
			return env
		}
	}
	return strings.TrimSpace(fallback)
}

func stringValue(raw any) string {
	value, _ := raw.(string)
	return value
}

func normalizeRequestServiceKey(cloud, service string) string {
	cloud = strings.TrimSpace(strings.ToLower(cloud))
	service = strings.TrimSpace(strings.ToLower(service))

	switch cloud {
	case "gcp":
		switch service {
		case "storage", "cloud-storage", "cloud_storage", "cloud storage":
			return "cloud-storage"
		case "cloudsql", "cloud-sql", "cloud_sql", "cloud sql":
			return "cloud-sql"
		case "compute", "compute-engine", "compute_engine", "compute engine":
			return "compute-engine"
		}
	}

	return strings.TrimSpace(service)
}

func normalizeRequestServicePathKey(cloud, service string) string {
	normalized := normalizeRequestServiceKey(cloud, service)
	switch strings.TrimSpace(strings.ToLower(cloud)) {
	case "gcp":
		switch normalized {
		case "cloud-storage":
			return "storage"
		case "cloud-sql":
			return "cloudsql"
		}
	}
	return normalized
}

func prunePrimaryServiceConfigFieldsForBundle(target map[string]interface{}, entries []ServiceBundleEntry) {
	if target == nil || len(entries) <= 1 {
		return
	}

	primaryConfig := entries[0].Config
	for key := range primaryConfig {
		if key == "service_bundle" || key == "bundle_summary" || key == "bundle_mode" {
			continue
		}
		delete(target, key)
	}
}

func extractServiceBundleEntriesFromConfig(rawConfig string) ([]ServiceBundleEntry, error) {
	if strings.TrimSpace(rawConfig) == "" {
		return nil, nil
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(rawConfig), &payload); err != nil {
		return nil, err
	}
	return extractServiceBundleEntriesFromPayload(payload)
}

func extractServiceBundleEntriesFromPayload(payload map[string]interface{}) ([]ServiceBundleEntry, error) {
	if payload == nil {
		return nil, nil
	}

	if rawBundle, ok := payload["service_bundle"]; ok && rawBundle != nil {
		return normalizeServiceBundleEntries(rawBundle)
	}
	if rawConfig, ok := payload["config"].(map[string]interface{}); ok && rawConfig != nil {
		if rawBundle, ok := rawConfig["service_bundle"]; ok && rawBundle != nil {
			return normalizeServiceBundleEntries(rawBundle)
		}
	}
	return nil, nil
}

func requestServiceEntriesForPersistence(req *PRRequest) ([]ServiceBundleEntry, error) {
	if req == nil {
		return nil, nil
	}

	if len(req.ServiceBundle) > 0 {
		return normalizeServiceBundleEntries(req.ServiceBundle)
	}

	entries, err := extractServiceBundleEntriesFromConfig(req.Config)
	if err != nil {
		return nil, err
	}
	if len(entries) > 0 {
		return entries, nil
	}

	if strings.TrimSpace(req.Cloud) == "" || strings.TrimSpace(req.Service) == "" {
		return nil, nil
	}

	return []ServiceBundleEntry{
		{
			Cloud:   strings.TrimSpace(req.Cloud),
			Service: strings.TrimSpace(req.Service),
			Config:  map[string]interface{}{},
		},
	}, nil
}

func applyRequestBundleEntries(req *PRRequest, entries []ServiceBundleEntry) {
	if req == nil {
		return
	}
	if len(entries) == 0 {
		req.ServiceBundle = nil
		req.BundleSummary = nil
		req.BundleMode = false
		return
	}

	req.ServiceBundle = entries
	req.BundleSummary = buildRequestBundleSummary(entries)
	req.BundleMode = len(entries) > 1
}
