package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type ServiceBundleEntry struct {
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

	rawBundle, hasBundle := payload["service_bundle"]
	if !hasBundle || rawBundle == nil {
		delete(payload, "bundle_mode")
		delete(payload, "bundle_summary")
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
	payload["bundle_mode"] = len(entries) > 1
	payload["service_bundle"] = entries
	payload["bundle_summary"] = buildRequestBundleSummary(entries)

	return entries, nil
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
	service, _ := item["service"].(string)
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
	entry.Service = strings.TrimSpace(entry.Service)
	entry.NormalizedService = strings.TrimSpace(entry.NormalizedService)
	entry.DisplayName = strings.TrimSpace(entry.DisplayName)

	if entry.Cloud == "" {
		return ServiceBundleEntry{}, fmt.Errorf("cloud is required")
	}
	if entry.Service == "" {
		return ServiceBundleEntry{}, fmt.Errorf("service is required")
	}
	if entry.Config == nil {
		entry.Config = map[string]interface{}{}
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

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(req.Config), &payload); err != nil {
		return
	}

	if bundleMode, ok := payload["bundle_mode"].(bool); ok {
		req.BundleMode = bundleMode
	}
	entries, err := normalizeServiceBundleEntries(payload["service_bundle"])
	if err != nil || len(entries) == 0 {
		return
	}

	req.ServiceBundle = entries
	req.BundleSummary = buildRequestBundleSummary(entries)
	if len(entries) > 1 {
		req.BundleMode = true
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
		validation, err := validateProjectRequestForUser(userID, projectID, teamNameOrSlug, environment, entry.Cloud, entry.Service)
		if err != nil {
			return nil, err
		}
		if primaryValidation == nil {
			primaryValidation = validation
		}
	}
	return primaryValidation, nil
}

func stringValue(raw any) string {
	value, _ := raw.(string)
	return value
}
