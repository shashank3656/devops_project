package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type driftKeyValue struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type environmentDriftFinding struct {
	Key          string   `json:"key"`
	Label        string   `json:"label"`
	Status       string   `json:"status"`
	Detail       string   `json:"detail"`
	Environments []string `json:"environments,omitempty"`
}

type environmentDriftSnapshot struct {
	Environment          string          `json:"environment"`
	ConnectionCount      int             `json:"connection_count"`
	ConnectedClusters    []string        `json:"connected_clusters"`
	ObservedNamespaces   []string        `json:"observed_namespaces"`
	ExpectedNamespace    string          `json:"expected_namespace"`
	LatestRequestID      *int            `json:"latest_request_id,omitempty"`
	LatestRequestStatus  string          `json:"latest_request_status,omitempty"`
	LatestUpdatedAt      *time.Time      `json:"latest_updated_at,omitempty"`
	ObservedServices     []string        `json:"observed_services"`
	VersionMarkers       []driftKeyValue `json:"version_markers"`
	VariableKeys         []string        `json:"variable_keys"`
	SecretReferences     []string        `json:"secret_references"`
	SecretInventoryCount int             `json:"secret_inventory_count"`
	State                string          `json:"state"`
	Notes                []string        `json:"notes"`
}

type environmentDriftProjectItem struct {
	ProjectID    int                        `json:"project_id"`
	ProjectName  string                     `json:"project_name"`
	ProjectCode  string                     `json:"project_code"`
	OwnerTeam    string                     `json:"owner_team,omitempty"`
	State        string                     `json:"state"`
	DriftScore   int                        `json:"drift_score"`
	Summary      string                     `json:"summary"`
	Findings     []environmentDriftFinding  `json:"findings"`
	Environments []environmentDriftSnapshot `json:"environments"`
}

type environmentDriftSummary struct {
	ProjectCount              int `json:"project_count"`
	AlignedProjects           int `json:"aligned_projects"`
	AttentionProjects         int `json:"attention_projects"`
	DriftedProjects           int `json:"drifted_projects"`
	EnvironmentCount          int `json:"environment_count"`
	MissingConnectionCount    int `json:"missing_connection_count"`
	VersionDriftCount         int `json:"version_drift_count"`
	VariableDriftCount        int `json:"variable_drift_count"`
	SecretReferenceDriftCount int `json:"secret_reference_drift_count"`
}

type environmentDriftPayload struct {
	Projects []ProjectSummary              `json:"projects"`
	Summary  environmentDriftSummary       `json:"summary"`
	Items    []environmentDriftProjectItem `json:"items"`
}

type opsCommandNamespaceAlert struct {
	ProjectID      int    `json:"project_id"`
	ProjectName    string `json:"project_name"`
	ProjectCode    string `json:"project_code"`
	Namespace      string `json:"namespace"`
	ClusterName    string `json:"cluster_name"`
	Status         string `json:"status"`
	IssueCount     int    `json:"issue_count"`
	RestartingPods int    `json:"restarting_pods"`
	WarningLogs    int    `json:"warning_logs"`
}

type opsCommandCenterProjectPulse struct {
	ProjectID           int    `json:"project_id"`
	ProjectName         string `json:"project_name"`
	ProjectCode         string `json:"project_code"`
	DriftState          string `json:"drift_state"`
	DriftScore          int    `json:"drift_score"`
	PendingRequests     int    `json:"pending_requests"`
	BlockedPromotions   int    `json:"blocked_promotions"`
	AttentionPromotions int    `json:"attention_promotions"`
	OpenIncidents       int    `json:"open_incidents"`
	ExpiryItems         int    `json:"expiry_items"`
	NamespaceAlerts     int    `json:"namespace_alerts"`
}

type opsCommandCenterSummary struct {
	BlockedPromotions   int `json:"blocked_promotions"`
	AttentionPromotions int `json:"attention_promotions"`
	ActiveIncidents     int `json:"active_incidents"`
	DeliveryFailures    int `json:"delivery_failures"`
	ActionableExpiry    int `json:"actionable_expiry"`
	DriftedProjects     int `json:"drifted_projects"`
	UnhealthyNamespaces int `json:"unhealthy_namespaces"`
	ActiveOverrides     int `json:"active_overrides"`
	BudgetAlerts        int `json:"budget_alerts"`
	IdleResources       int `json:"idle_resources"`
}

type opsCommandCenterPayload struct {
	Projects            []ProjectSummary               `json:"projects"`
	Summary             opsCommandCenterSummary        `json:"summary"`
	ProjectPulse        []opsCommandCenterProjectPulse `json:"project_pulse"`
	DriftedProjects     []environmentDriftProjectItem  `json:"drifted_projects"`
	BlockedPromotions   []promotionCenterItem          `json:"blocked_promotions"`
	AttentionPromotions []promotionCenterItem          `json:"attention_promotions"`
	ActiveIncidents     []requestIncident              `json:"active_incidents"`
	DeliveryFailures    []opsDeliveryFailure           `json:"delivery_failures"`
	ExpiryItems         []expiryTrackerItem            `json:"expiry_items"`
	NamespaceAlerts     []opsCommandNamespaceAlert     `json:"namespace_alerts"`
	ActiveOverrides     []projectAccessOverride        `json:"active_overrides"`
	CostDigest          *fleetCostDigest               `json:"cost_digest,omitempty"`
}

type projectDependencyNode struct {
	ProjectID           int      `json:"project_id"`
	ProjectName         string   `json:"project_name"`
	ProjectCode         string   `json:"project_code"`
	Status              string   `json:"status"`
	OwnerTeam           string   `json:"owner_team,omitempty"`
	Environments        []string `json:"environments"`
	Clouds              []string `json:"clouds"`
	Teams               []string `json:"teams"`
	Services            []string `json:"services"`
	Clusters            []string `json:"clusters"`
	PendingRequestCount int      `json:"pending_request_count"`
	OpenIncidentCount   int      `json:"open_incident_count"`
	DependencyEdgeCount int      `json:"dependency_edge_count"`
	DependencyPeerCount int      `json:"dependency_peer_count"`
}

type projectDependencyEdge struct {
	SourceProjectID   int      `json:"source_project_id"`
	SourceProjectName string   `json:"source_project_name"`
	SourceProjectCode string   `json:"source_project_code"`
	TargetProjectID   int      `json:"target_project_id"`
	TargetProjectName string   `json:"target_project_name"`
	TargetProjectCode string   `json:"target_project_code"`
	Relationship      string   `json:"relationship"`
	Label             string   `json:"label"`
	SharedCount       int      `json:"shared_count"`
	SharedValues      []string `json:"shared_values"`
}

type projectDependencyHotspot struct {
	ProjectID         int      `json:"project_id"`
	ProjectName       string   `json:"project_name"`
	ProjectCode       string   `json:"project_code"`
	RelationshipCount int      `json:"relationship_count"`
	PeerCount         int      `json:"peer_count"`
	SharedLabels      []string `json:"shared_labels"`
}

type projectDependencySummary struct {
	NodeCount    int `json:"node_count"`
	EdgeCount    int `json:"edge_count"`
	ServiceEdges int `json:"service_edges"`
	TeamEdges    int `json:"team_edges"`
	ClusterEdges int `json:"cluster_edges"`
	CloudEdges   int `json:"cloud_edges"`
}

type projectDependencyMapPayload struct {
	Projects       []ProjectSummary           `json:"projects"`
	Summary        projectDependencySummary   `json:"summary"`
	Nodes          []projectDependencyNode    `json:"nodes"`
	Edges          []projectDependencyEdge    `json:"edges"`
	Hotspots       []projectDependencyHotspot `json:"hotspots"`
	FocusProjectID int                        `json:"focus_project_id,omitempty"`
	FocusNode      *projectDependencyNode     `json:"focus_node,omitempty"`
}

type driftSignalProfile struct {
	VersionMarkers   map[string]string
	VariableKeys     []string
	SecretReferences []string
	InvalidConfig    bool
}

var driftEnvironmentRank = map[string]int{
	"dev":        1,
	"qa":         2,
	"test":       2,
	"uat":        3,
	"stage":      4,
	"staging":    4,
	"preprod":    5,
	"prod":       6,
	"production": 6,
}

func buildProjectSummaries(projects []ProjectCatalog) []ProjectSummary {
	out := make([]ProjectSummary, 0, len(projects))
	for _, project := range projects {
		out = append(out, ProjectSummary{
			ID:     project.ID,
			Name:   project.Name,
			Code:   project.Code,
			Status: project.Status,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

func uniqueLowerSorted(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	sort.Strings(out)
	return out
}

func uniqueSorted(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	sort.Strings(out)
	return out
}

func environmentSortKey(raw string) (int, string) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	rank, ok := driftEnvironmentRank[normalized]
	if !ok {
		rank = 99
	}
	return rank, normalized
}

func sortEnvironments(values []string) []string {
	out := uniqueLowerSorted(values)
	sort.Slice(out, func(i, j int) bool {
		leftRank, leftValue := environmentSortKey(out[i])
		rightRank, rightValue := environmentSortKey(out[j])
		if leftRank == rightRank {
			return leftValue < rightValue
		}
		return leftRank < rightRank
	})
	return out
}

func normalizeServiceLabel(cloud, service string) string {
	cloud = strings.ToUpper(strings.TrimSpace(cloud))
	service = strings.TrimSpace(service)
	if cloud == "" && service == "" {
		return ""
	}
	if cloud == "" {
		return service
	}
	if service == "" {
		return cloud
	}
	return cloud + ":" + service
}

func stringsIntersection(left, right []string) []string {
	leftSet := map[string]struct{}{}
	for _, value := range left {
		leftSet[strings.TrimSpace(value)] = struct{}{}
	}
	out := make([]string, 0)
	for _, value := range right {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := leftSet[trimmed]; ok {
			out = append(out, trimmed)
		}
	}
	return uniqueSorted(out)
}

func stringsDifference(source, against []string) []string {
	againstSet := map[string]struct{}{}
	for _, value := range against {
		againstSet[strings.TrimSpace(value)] = struct{}{}
	}
	out := make([]string, 0)
	for _, value := range source {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := againstSet[trimmed]; ok {
			continue
		}
		out = append(out, trimmed)
	}
	return uniqueSorted(out)
}

func configKeyLooksLikeVersion(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	if key == "" {
		return false
	}
	return strings.Contains(key, "version") ||
		strings.Contains(key, "tag") ||
		strings.Contains(key, "image") ||
		strings.Contains(key, "release") ||
		strings.Contains(key, "chart")
}

func configKeyLooksLikeSecret(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	if key == "" {
		return false
	}
	return strings.Contains(key, "secret") ||
		strings.Contains(key, "password") ||
		strings.Contains(key, "token") ||
		strings.Contains(key, "credential") ||
		strings.Contains(key, "apikey") ||
		strings.Contains(key, "api_key") ||
		strings.Contains(key, "cert") ||
		strings.Contains(key, "certificate") ||
		strings.Contains(key, "private_key") ||
		strings.Contains(key, "privatekey")
}

func flattenConfigScalars(prefix string, value interface{}, out map[string]string) {
	switch typed := value.(type) {
	case map[string]interface{}:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			nextPrefix := key
			if prefix != "" {
				nextPrefix = prefix + "." + key
			}
			flattenConfigScalars(nextPrefix, typed[key], out)
		}
	case []interface{}:
		for index, item := range typed {
			nextPrefix := fmt.Sprintf("%s[%d]", prefix, index)
			flattenConfigScalars(nextPrefix, item, out)
		}
	case string:
		out[prefix] = strings.TrimSpace(typed)
	case bool:
		out[prefix] = strconv.FormatBool(typed)
	case float64:
		out[prefix] = strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		out[prefix] = strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case int:
		out[prefix] = strconv.Itoa(typed)
	case int64:
		out[prefix] = strconv.FormatInt(typed, 10)
	case nil:
		out[prefix] = "null"
	default:
		out[prefix] = fmt.Sprintf("%v", typed)
	}
}

func extractDriftSignalProfile(raw string) driftSignalProfile {
	profile := driftSignalProfile{
		VersionMarkers:   map[string]string{},
		VariableKeys:     []string{},
		SecretReferences: []string{},
	}
	if strings.TrimSpace(raw) == "" {
		return profile
	}
	var parsed interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		profile.InvalidConfig = true
		return profile
	}

	flatValues := map[string]string{}
	flattenConfigScalars("", parsed, flatValues)
	keys := make([]string, 0, len(flatValues))
	for key := range flatValues {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := flatValues[key]
		switch {
		case configKeyLooksLikeVersion(key):
			profile.VersionMarkers[key] = value
		case configKeyLooksLikeSecret(key):
			profile.SecretReferences = append(profile.SecretReferences, key)
		default:
			profile.VariableKeys = append(profile.VariableKeys, key)
		}
	}
	profile.VariableKeys = uniqueSorted(profile.VariableKeys)
	profile.SecretReferences = uniqueSorted(profile.SecretReferences)
	return profile
}

func versionMarkersToPairs(markers map[string]string) []driftKeyValue {
	if len(markers) == 0 {
		return []driftKeyValue{}
	}
	keys := make([]string, 0, len(markers))
	for key := range markers {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]driftKeyValue, 0, len(keys))
	for _, key := range keys {
		out = append(out, driftKeyValue{Key: key, Value: markers[key]})
	}
	return out
}

func chooseLatestRequestForEnvironment(requests []PRRequest) *PRRequest {
	if len(requests) == 0 {
		return nil
	}
	statusRank := map[string]int{
		"completed":                     5,
		"in_progress":                   4,
		"pending_devops_approval":       3,
		"pending_approval":              2,
		"pending_user_manager_approval": 2,
		"draft":                         1,
	}
	best := requests[0]
	for _, candidate := range requests[1:] {
		bestRank := statusRank[strings.ToLower(strings.TrimSpace(best.Status))]
		candidateRank := statusRank[strings.ToLower(strings.TrimSpace(candidate.Status))]
		if candidateRank > bestRank {
			best = candidate
			continue
		}
		if candidateRank == bestRank && candidate.UpdatedAt.After(best.UpdatedAt) {
			best = candidate
		}
	}
	return &best
}

func buildProjectEnvironmentDriftItem(project ProjectCatalog, requests []PRRequest, connections []k8sConnectionRecord, credentialCounts map[string]int) environmentDriftProjectItem {
	envSet := append([]string{}, project.Environments...)
	requestsByEnv := make(map[string][]PRRequest)
	for _, req := range requests {
		env := strings.ToLower(strings.TrimSpace(req.Env))
		if env == "" {
			continue
		}
		envSet = append(envSet, env)
		requestsByEnv[env] = append(requestsByEnv[env], req)
	}
	connectionsByEnv := make(map[string][]k8sConnectionRecord)
	for _, connection := range connections {
		env := strings.ToLower(strings.TrimSpace(connection.Environment))
		if env == "" {
			continue
		}
		envSet = append(envSet, env)
		connectionsByEnv[env] = append(connectionsByEnv[env], connection)
	}
	for env := range credentialCounts {
		envSet = append(envSet, env)
	}

	expectedServices := make([]string, 0, len(project.Services))
	for _, service := range project.Services {
		label := normalizeServiceLabel(service.Cloud, service.Service)
		if label != "" {
			expectedServices = append(expectedServices, label)
		}
	}
	expectedServices = uniqueSorted(expectedServices)

	item := environmentDriftProjectItem{
		ProjectID:    project.ID,
		ProjectName:  project.Name,
		ProjectCode:  project.Code,
		OwnerTeam:    project.OwnerTeam,
		Findings:     []environmentDriftFinding{},
		Environments: []environmentDriftSnapshot{},
	}
	findingsSeen := map[string]struct{}{}

	addFinding := func(finding environmentDriftFinding) {
		key := finding.Key + "::" + finding.Status + "::" + finding.Detail + "::" + strings.Join(finding.Environments, ",")
		if _, ok := findingsSeen[key]; ok {
			return
		}
		findingsSeen[key] = struct{}{}
		item.Findings = append(item.Findings, finding)
		switch finding.Status {
		case "drift":
			item.DriftScore += 3
		case "attention":
			item.DriftScore++
		}
	}

	envProfiles := make(map[string]driftSignalProfile)
	envSnapshots := make(map[string]environmentDriftSnapshot)

	for _, env := range sortEnvironments(envSet) {
		snapshot := environmentDriftSnapshot{
			Environment:          env,
			ConnectedClusters:    []string{},
			ObservedNamespaces:   []string{},
			ObservedServices:     []string{},
			VersionMarkers:       []driftKeyValue{},
			VariableKeys:         []string{},
			SecretReferences:     []string{},
			SecretInventoryCount: credentialCounts[env],
			State:                "aligned",
			Notes:                []string{},
		}

		expectedNamespace := namespaceForProject(project, env)
		snapshot.ExpectedNamespace = expectedNamespace

		connectionsForEnv := connectionsByEnv[env]
		snapshot.ConnectionCount = len(connectionsForEnv)
		clusterNames := make([]string, 0, len(connectionsForEnv))
		namespaces := make([]string, 0, len(connectionsForEnv))
		namespaceMatched := false
		for _, connection := range connectionsForEnv {
			clusterNames = append(clusterNames, connection.ClusterName)
			namespaces = append(namespaces, connection.Namespace)
			if strings.EqualFold(strings.TrimSpace(connection.Namespace), strings.TrimSpace(expectedNamespace)) {
				namespaceMatched = true
			}
		}
		snapshot.ConnectedClusters = uniqueSorted(clusterNames)
		snapshot.ObservedNamespaces = uniqueSorted(namespaces)
		if snapshot.ConnectionCount == 0 {
			snapshot.State = "drift"
			snapshot.Notes = append(snapshot.Notes, "No Kubernetes connection is configured for this environment.")
			addFinding(environmentDriftFinding{
				Key:          "connection",
				Label:        "Missing runtime connection",
				Status:       "drift",
				Detail:       fmt.Sprintf("%s has no Kubernetes connection even though it is configured for %s.", env, project.Name),
				Environments: []string{env},
			})
		} else if expectedNamespace != "" && !namespaceMatched {
			snapshot.State = "drift"
			snapshot.Notes = append(snapshot.Notes, "Connected namespaces do not match the expected project namespace.")
			addFinding(environmentDriftFinding{
				Key:          "namespace",
				Label:        "Namespace mismatch",
				Status:       "drift",
				Detail:       fmt.Sprintf("%s is expected to use namespace %s but current connections point elsewhere.", env, expectedNamespace),
				Environments: []string{env},
			})
		}

		requestsForEnv := requestsByEnv[env]
		observedServices := make([]string, 0, len(requestsForEnv))
		for _, req := range requestsForEnv {
			label := normalizeServiceLabel(req.Cloud, req.Service)
			if label != "" {
				observedServices = append(observedServices, label)
			}
		}
		snapshot.ObservedServices = uniqueSorted(observedServices)
		latestRequest := chooseLatestRequestForEnvironment(requestsForEnv)
		profile := driftSignalProfile{
			VersionMarkers:   map[string]string{},
			VariableKeys:     []string{},
			SecretReferences: []string{},
		}
		if latestRequest != nil {
			requestID := latestRequest.ID
			snapshot.LatestRequestID = &requestID
			snapshot.LatestRequestStatus = latestRequest.Status
			snapshot.LatestUpdatedAt = &latestRequest.UpdatedAt
			profile = extractDriftSignalProfile(latestRequest.Config)
			snapshot.VersionMarkers = versionMarkersToPairs(profile.VersionMarkers)
			snapshot.VariableKeys = profile.VariableKeys
			snapshot.SecretReferences = profile.SecretReferences
			if profile.InvalidConfig {
				if snapshot.State == "aligned" {
					snapshot.State = "attention"
				}
				snapshot.Notes = append(snapshot.Notes, "Latest request config is not valid JSON and could not be compared.")
				addFinding(environmentDriftFinding{
					Key:          "config",
					Label:        "Invalid config payload",
					Status:       "attention",
					Detail:       fmt.Sprintf("The latest %s request config for %s is not valid JSON.", env, project.Name),
					Environments: []string{env},
				})
			}
		} else {
			if snapshot.State == "aligned" {
				snapshot.State = "attention"
			}
			snapshot.Notes = append(snapshot.Notes, "No recent request configuration was found for comparison.")
			addFinding(environmentDriftFinding{
				Key:          "requests",
				Label:        "No deployment sample",
				Status:       "attention",
				Detail:       fmt.Sprintf("%s has no recent request configuration to compare against other environments.", env),
				Environments: []string{env},
			})
		}

		if len(expectedServices) > 0 {
			unexpectedServices := stringsDifference(snapshot.ObservedServices, expectedServices)
			missingServices := stringsDifference(expectedServices, snapshot.ObservedServices)
			if len(unexpectedServices) > 0 {
				snapshot.State = "drift"
				snapshot.Notes = append(snapshot.Notes, "Observed services are not part of the catalog definition.")
				addFinding(environmentDriftFinding{
					Key:          "services",
					Label:        "Unexpected services",
					Status:       "drift",
					Detail:       fmt.Sprintf("%s is serving unexpected services: %s.", env, strings.Join(unexpectedServices, ", ")),
					Environments: []string{env},
				})
			}
			if len(snapshot.ObservedServices) == 0 && len(expectedServices) > 0 {
				if snapshot.State == "aligned" {
					snapshot.State = "attention"
				}
				snapshot.Notes = append(snapshot.Notes, "No services have been observed yet for this environment.")
			} else if len(missingServices) > 0 && snapshot.State == "aligned" {
				snapshot.State = "attention"
				snapshot.Notes = append(snapshot.Notes, "Some catalog services have not been observed in recent activity.")
			}
		}

		if len(snapshot.SecretReferences) > 0 && snapshot.SecretInventoryCount == 0 {
			if snapshot.State == "aligned" {
				snapshot.State = "attention"
			}
			snapshot.Notes = append(snapshot.Notes, "Config references secrets, but no credential inventory was observed for this environment.")
			addFinding(environmentDriftFinding{
				Key:          "secret_refs",
				Label:        "Unbacked secret references",
				Status:       "attention",
				Detail:       fmt.Sprintf("%s references secrets in config but has no credential audit inventory.", env),
				Environments: []string{env},
			})
		}

		envProfiles[env] = profile
		envSnapshots[env] = snapshot
		item.Environments = append(item.Environments, snapshot)
	}

	var baselineEnv string
	for _, snapshot := range item.Environments {
		if snapshot.LatestRequestID != nil {
			baselineEnv = snapshot.Environment
			break
		}
	}
	if baselineEnv == "" && len(item.Environments) > 0 {
		baselineEnv = item.Environments[0].Environment
	}
	baselineProfile := envProfiles[baselineEnv]

	for _, snapshot := range item.Environments {
		if snapshot.Environment == baselineEnv {
			continue
		}
		profile := envProfiles[snapshot.Environment]

		for key, baselineValue := range baselineProfile.VersionMarkers {
			if currentValue, ok := profile.VersionMarkers[key]; ok && currentValue != baselineValue {
				addFinding(environmentDriftFinding{
					Key:          "version",
					Label:        "Version mismatch",
					Status:       "drift",
					Detail:       fmt.Sprintf("%s differs between %s (%s) and %s (%s).", key, baselineEnv, baselineValue, snapshot.Environment, currentValue),
					Environments: []string{baselineEnv, snapshot.Environment},
				})
			}
		}

		variableDiff := stringsDifference(profile.VariableKeys, baselineProfile.VariableKeys)
		variableMissing := stringsDifference(baselineProfile.VariableKeys, profile.VariableKeys)
		if len(variableDiff) > 0 || len(variableMissing) > 0 {
			addFinding(environmentDriftFinding{
				Key:          "variables",
				Label:        "Variable coverage drift",
				Status:       "attention",
				Detail:       fmt.Sprintf("%s does not expose the same config variable set as %s.", snapshot.Environment, baselineEnv),
				Environments: []string{baselineEnv, snapshot.Environment},
			})
		}

		secretDiff := stringsDifference(profile.SecretReferences, baselineProfile.SecretReferences)
		secretMissing := stringsDifference(baselineProfile.SecretReferences, profile.SecretReferences)
		if len(secretDiff) > 0 || len(secretMissing) > 0 {
			addFinding(environmentDriftFinding{
				Key:          "secret_refs",
				Label:        "Secret reference drift",
				Status:       "attention",
				Detail:       fmt.Sprintf("%s does not reference the same secret set as %s.", snapshot.Environment, baselineEnv),
				Environments: []string{baselineEnv, snapshot.Environment},
			})
		}
	}

	sort.Slice(item.Findings, func(i, j int) bool {
		statusRank := map[string]int{"drift": 0, "attention": 1, "aligned": 2}
		leftRank := statusRank[item.Findings[i].Status]
		rightRank := statusRank[item.Findings[j].Status]
		if leftRank == rightRank {
			return item.Findings[i].Label < item.Findings[j].Label
		}
		return leftRank < rightRank
	})

	switch {
	case len(item.Findings) == 0:
		item.State = "aligned"
		item.Summary = "Configured environments currently align across connections, service observations, and config signals."
	case item.DriftScore >= 3:
		item.State = "drift"
		item.Summary = fmt.Sprintf("%d drift signals detected across runtime connections and environment config.", len(item.Findings))
	default:
		item.State = "attention"
		item.Summary = fmt.Sprintf("%d environment differences need review before the next release.", len(item.Findings))
	}

	return item
}

func buildEnvironmentDriftPayload(projectID int) (*environmentDriftPayload, error) {
	var projects []ProjectCatalog
	if projectID > 0 {
		project, err := getProjectCatalogByID(projectID)
		if err != nil {
			return nil, err
		}
		if project == nil {
			return &environmentDriftPayload{}, nil
		}
		projects = []ProjectCatalog{*project}
	} else {
		var err error
		projects, err = listProjectCatalogs()
		if err != nil {
			return nil, err
		}
	}

	payload := &environmentDriftPayload{
		Projects: buildProjectSummaries(projects),
		Items:    []environmentDriftProjectItem{},
	}
	if len(projects) == 0 {
		return payload, nil
	}

	connections, err := listK8sConnections()
	if err != nil {
		return nil, err
	}
	connectionsByProject := make(map[int][]k8sConnectionRecord)
	for _, connection := range connections {
		connectionsByProject[connection.ProjectID] = append(connectionsByProject[connection.ProjectID], connection)
	}

	credentialEntries, err := GetCredentialAuditLogs(2000, 0, "", "", "", 0)
	if err != nil {
		return nil, err
	}
	credentialCounts := make(map[int]map[string]int)
	for _, entry := range credentialEntries {
		if entry.ProjectID == nil || *entry.ProjectID <= 0 {
			continue
		}
		env := strings.ToLower(strings.TrimSpace(entry.Env))
		if env == "" {
			continue
		}
		if _, ok := credentialCounts[*entry.ProjectID]; !ok {
			credentialCounts[*entry.ProjectID] = make(map[string]int)
		}
		credentialCounts[*entry.ProjectID][env]++
	}

	for _, project := range projects {
		requests, err := GetPRRequests("", "", "", project.ID, "", "", "", 0, 0, nil, 200, 0, "updated_at", "desc", false, "", "")
		if err != nil {
			return nil, err
		}
		item := buildProjectEnvironmentDriftItem(project, requests, connectionsByProject[project.ID], credentialCounts[project.ID])
		payload.Items = append(payload.Items, item)
		payload.Summary.ProjectCount++
		payload.Summary.EnvironmentCount += len(item.Environments)
		switch item.State {
		case "aligned":
			payload.Summary.AlignedProjects++
		case "attention":
			payload.Summary.AttentionProjects++
		default:
			payload.Summary.DriftedProjects++
		}
		for _, finding := range item.Findings {
			switch finding.Key {
			case "connection":
				payload.Summary.MissingConnectionCount++
			case "version":
				payload.Summary.VersionDriftCount++
			case "variables":
				payload.Summary.VariableDriftCount++
			case "secret_refs":
				payload.Summary.SecretReferenceDriftCount++
			}
		}
	}

	sort.Slice(payload.Items, func(i, j int) bool {
		if payload.Items[i].DriftScore == payload.Items[j].DriftScore {
			return payload.Items[i].ProjectName < payload.Items[j].ProjectName
		}
		return payload.Items[i].DriftScore > payload.Items[j].DriftScore
	})
	return payload, nil
}

func buildNamespaceAlerts(projects []ProjectCatalog) ([]opsCommandNamespaceAlert, error) {
	out := make([]opsCommandNamespaceAlert, 0)
	for _, project := range projects {
		preview, err := buildProjectK8sPreview(project)
		if err != nil {
			return nil, err
		}
		if preview == nil {
			continue
		}
		for _, item := range preview.NamespaceWatchlist {
			out = append(out, opsCommandNamespaceAlert{
				ProjectID:      project.ID,
				ProjectName:    project.Name,
				ProjectCode:    project.Code,
				Namespace:      item.Namespace,
				ClusterName:    item.ClusterName,
				Status:         item.Status,
				IssueCount:     item.IssueCount,
				RestartingPods: item.RestartingPods,
				WarningLogs:    item.WarningLogs,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IssueCount == out[j].IssueCount {
			return out[i].ProjectName < out[j].ProjectName
		}
		return out[i].IssueCount > out[j].IssueCount
	})
	return out, nil
}

func buildOpsCommandCenterPayload(projectID int) (*opsCommandCenterPayload, error) {
	var projects []ProjectCatalog
	if projectID > 0 {
		project, err := getProjectCatalogByID(projectID)
		if err != nil {
			return nil, err
		}
		if project == nil {
			return &opsCommandCenterPayload{}, nil
		}
		projects = []ProjectCatalog{*project}
	} else {
		var err error
		projects, err = listProjectCatalogs()
		if err != nil {
			return nil, err
		}
	}

	payload := &opsCommandCenterPayload{
		Projects: buildProjectSummaries(projects),
	}
	if len(projects) == 0 {
		return payload, nil
	}

	projectSet := make(map[int]ProjectCatalog, len(projects))
	for _, project := range projects {
		projectSet[project.ID] = project
	}

	driftPayload, err := buildEnvironmentDriftPayload(projectID)
	if err != nil {
		return nil, err
	}
	payload.DriftedProjects = make([]environmentDriftProjectItem, 0)
	for _, item := range driftPayload.Items {
		if item.State != "aligned" {
			payload.DriftedProjects = append(payload.DriftedProjects, item)
		}
	}
	sort.Slice(payload.DriftedProjects, func(i, j int) bool {
		if payload.DriftedProjects[i].DriftScore == payload.DriftedProjects[j].DriftScore {
			return payload.DriftedProjects[i].ProjectName < payload.DriftedProjects[j].ProjectName
		}
		return payload.DriftedProjects[i].DriftScore > payload.DriftedProjects[j].DriftScore
	})

	promotions, err := listPromotionCenterItems()
	if err != nil {
		return nil, err
	}
	if err := enrichPromotionItemsWithDeploymentGates(promotions); err != nil {
		return nil, err
	}
	for _, item := range promotions {
		if projectID > 0 && (item.ProjectID == nil || *item.ProjectID != projectID) {
			continue
		}
		if item.Gate == nil {
			continue
		}
		switch item.Gate.Status {
		case "blocked":
			payload.BlockedPromotions = append(payload.BlockedPromotions, item)
			payload.Summary.BlockedPromotions++
		case "attention":
			payload.AttentionPromotions = append(payload.AttentionPromotions, item)
			payload.Summary.AttentionPromotions++
		}
	}
	if len(payload.BlockedPromotions) > 8 {
		payload.BlockedPromotions = payload.BlockedPromotions[:8]
	}
	if len(payload.AttentionPromotions) > 8 {
		payload.AttentionPromotions = payload.AttentionPromotions[:8]
	}

	incidents, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	for _, incident := range incidents {
		if strings.EqualFold(strings.TrimSpace(incident.Status), "resolved") {
			continue
		}
		if projectID > 0 {
			if incident.ProjectID == nil || *incident.ProjectID != projectID {
				continue
			}
		}
		payload.ActiveIncidents = append(payload.ActiveIncidents, incident)
		payload.Summary.ActiveIncidents++
	}
	if len(payload.ActiveIncidents) > 8 {
		payload.ActiveIncidents = payload.ActiveIncidents[:8]
	}

	failures, err := listOpsDeliveryFailures("")
	if err != nil {
		return nil, err
	}
	for _, failure := range failures {
		if strings.EqualFold(strings.TrimSpace(failure.Status), "resolved") {
			continue
		}
		payload.DeliveryFailures = append(payload.DeliveryFailures, failure)
		payload.Summary.DeliveryFailures++
	}
	if len(payload.DeliveryFailures) > 8 {
		payload.DeliveryFailures = payload.DeliveryFailures[:8]
	}

	credentialEntries, err := GetCredentialAuditLogs(2000, 0, "", "", "", projectID)
	if err != nil {
		return nil, err
	}
	expiryTracker, err := buildExpiryTracker(credentialEntries, "", projectID, "", "")
	if err != nil {
		return nil, err
	}
	actions, err := listExpiryTrackerActions(expiryTrackerItemKeys(expiryTracker.Items))
	if err != nil {
		return nil, err
	}
	applyExpiryTrackerActions(expiryTracker, actions)
	for _, item := range expiryTracker.Items {
		if item.Status == "healthy" || item.WorkflowState == "rotated" {
			continue
		}
		payload.ExpiryItems = append(payload.ExpiryItems, item)
		payload.Summary.ActionableExpiry++
	}
	sort.Slice(payload.ExpiryItems, func(i, j int) bool {
		return payload.ExpiryItems[i].DaysRemaining < payload.ExpiryItems[j].DaysRemaining
	})
	if len(payload.ExpiryItems) > 10 {
		payload.ExpiryItems = payload.ExpiryItems[:10]
	}

	namespaceAlerts, err := buildNamespaceAlerts(projects)
	if err != nil {
		return nil, err
	}
	payload.NamespaceAlerts = namespaceAlerts
	payload.Summary.UnhealthyNamespaces = len(namespaceAlerts)
	if len(payload.NamespaceAlerts) > 8 {
		payload.NamespaceAlerts = payload.NamespaceAlerts[:8]
	}

	activeOverrides, err := listProjectAccessOverrides(true)
	if err != nil {
		return nil, err
	}
	for _, override := range activeOverrides {
		if projectID > 0 && override.ProjectID != projectID {
			continue
		}
		payload.ActiveOverrides = append(payload.ActiveOverrides, override)
		payload.Summary.ActiveOverrides++
	}
	if len(payload.ActiveOverrides) > 8 {
		payload.ActiveOverrides = payload.ActiveOverrides[:8]
	}

	pulseByProject := make(map[int]*opsCommandCenterProjectPulse, len(projects))
	for _, project := range projects {
		pulseByProject[project.ID] = &opsCommandCenterProjectPulse{
			ProjectID:           project.ID,
			ProjectName:         project.Name,
			ProjectCode:         project.Code,
			PendingRequests:     project.PendingRequestCount,
			DriftState:          "aligned",
			DriftScore:          0,
			BlockedPromotions:   0,
			AttentionPromotions: 0,
			OpenIncidents:       0,
			ExpiryItems:         0,
			NamespaceAlerts:     0,
		}
	}
	for _, item := range driftPayload.Items {
		pulse := pulseByProject[item.ProjectID]
		if pulse == nil {
			continue
		}
		pulse.DriftState = item.State
		pulse.DriftScore = item.DriftScore
	}
	for _, item := range promotions {
		if item.ProjectID == nil {
			continue
		}
		pulse := pulseByProject[*item.ProjectID]
		if pulse == nil || item.Gate == nil {
			continue
		}
		switch item.Gate.Status {
		case "blocked":
			pulse.BlockedPromotions++
		case "attention":
			pulse.AttentionPromotions++
		}
	}
	for _, incident := range incidents {
		if incident.ProjectID == nil {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(incident.Status), "resolved") {
			continue
		}
		pulse := pulseByProject[*incident.ProjectID]
		if pulse != nil {
			pulse.OpenIncidents++
		}
	}
	for _, item := range expiryTracker.Items {
		if item.ProjectID == nil || item.Status == "healthy" || item.WorkflowState == "rotated" {
			continue
		}
		pulse := pulseByProject[*item.ProjectID]
		if pulse != nil {
			pulse.ExpiryItems++
		}
	}
	for _, item := range namespaceAlerts {
		pulse := pulseByProject[item.ProjectID]
		if pulse != nil {
			pulse.NamespaceAlerts++
		}
	}
	for _, pulse := range pulseByProject {
		if pulse.DriftState == "aligned" &&
			pulse.BlockedPromotions == 0 &&
			pulse.AttentionPromotions == 0 &&
			pulse.OpenIncidents == 0 &&
			pulse.ExpiryItems == 0 &&
			pulse.NamespaceAlerts == 0 &&
			pulse.PendingRequests == 0 {
			continue
		}
		payload.ProjectPulse = append(payload.ProjectPulse, *pulse)
	}
	sort.Slice(payload.ProjectPulse, func(i, j int) bool {
		leftWeight := payload.ProjectPulse[i].DriftScore + payload.ProjectPulse[i].BlockedPromotions*3 + payload.ProjectPulse[i].OpenIncidents*3 + payload.ProjectPulse[i].ExpiryItems*2 + payload.ProjectPulse[i].NamespaceAlerts*2 + payload.ProjectPulse[i].PendingRequests
		rightWeight := payload.ProjectPulse[j].DriftScore + payload.ProjectPulse[j].BlockedPromotions*3 + payload.ProjectPulse[j].OpenIncidents*3 + payload.ProjectPulse[j].ExpiryItems*2 + payload.ProjectPulse[j].NamespaceAlerts*2 + payload.ProjectPulse[j].PendingRequests
		if leftWeight == rightWeight {
			return payload.ProjectPulse[i].ProjectName < payload.ProjectPulse[j].ProjectName
		}
		return leftWeight > rightWeight
	})
	if len(payload.ProjectPulse) > 12 {
		payload.ProjectPulse = payload.ProjectPulse[:12]
	}

	payload.Summary.DriftedProjects = len(payload.DriftedProjects)
	if digest, err := buildFleetCostDigest(time.Now()); err == nil && digest != nil {
		payload.CostDigest = digest
		payload.Summary.BudgetAlerts = len(digest.BudgetAlerts)
		payload.Summary.IdleResources = len(digest.IdleResources)
		if len(payload.CostDigest.BudgetAlerts) > 8 {
			payload.CostDigest.BudgetAlerts = payload.CostDigest.BudgetAlerts[:8]
		}
		if len(payload.CostDigest.IdleResources) > 10 {
			payload.CostDigest.IdleResources = payload.CostDigest.IdleResources[:10]
		}
	}
	return payload, nil
}

func buildProjectDependencyNodes(projects []ProjectCatalog, connections []k8sConnectionRecord, incidents []requestIncident) []projectDependencyNode {
	clusterByProject := make(map[int][]string)
	for _, connection := range connections {
		label := strings.TrimSpace(connection.ClusterName)
		if label == "" {
			continue
		}
		clusterByProject[connection.ProjectID] = append(clusterByProject[connection.ProjectID], label)
	}
	incidentCountByProject := make(map[int]int)
	for _, incident := range incidents {
		if incident.ProjectID == nil {
			continue
		}
		incidentCountByProject[*incident.ProjectID]++
	}

	nodes := make([]projectDependencyNode, 0, len(projects))
	for _, project := range projects {
		teams := make([]string, 0, len(project.TeamAccess)+1)
		if strings.TrimSpace(project.OwnerTeam) != "" {
			teams = append(teams, project.OwnerTeam)
		}
		for _, access := range project.TeamAccess {
			if strings.TrimSpace(access.TeamName) != "" {
				teams = append(teams, access.TeamName)
			}
			if strings.TrimSpace(access.TeamSlug) != "" {
				teams = append(teams, access.TeamSlug)
			}
		}

		services := make([]string, 0, len(project.Services))
		for _, service := range project.Services {
			label := normalizeServiceLabel(service.Cloud, service.Service)
			if label != "" {
				services = append(services, label)
			}
		}

		nodes = append(nodes, projectDependencyNode{
			ProjectID:           project.ID,
			ProjectName:         project.Name,
			ProjectCode:         project.Code,
			Status:              project.Status,
			OwnerTeam:           project.OwnerTeam,
			Environments:        sortEnvironments(project.Environments),
			Clouds:              uniqueSorted(project.Clouds),
			Teams:               uniqueSorted(teams),
			Services:            uniqueSorted(services),
			Clusters:            uniqueSorted(clusterByProject[project.ID]),
			PendingRequestCount: project.PendingRequestCount,
			OpenIncidentCount:   incidentCountByProject[project.ID],
		})
	}
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].ProjectName < nodes[j].ProjectName
	})
	return nodes
}

func buildProjectDependencyEdges(nodes []projectDependencyNode) []projectDependencyEdge {
	edges := make([]projectDependencyEdge, 0)
	for leftIndex := 0; leftIndex < len(nodes); leftIndex++ {
		for rightIndex := leftIndex + 1; rightIndex < len(nodes); rightIndex++ {
			left := nodes[leftIndex]
			right := nodes[rightIndex]

			relationships := []struct {
				kind   string
				label  string
				values []string
			}{
				{
					kind:   "service",
					label:  "Shared services",
					values: stringsIntersection(left.Services, right.Services),
				},
				{
					kind:   "team",
					label:  "Shared teams",
					values: stringsIntersection(left.Teams, right.Teams),
				},
				{
					kind:   "cluster",
					label:  "Shared clusters",
					values: stringsIntersection(left.Clusters, right.Clusters),
				},
				{
					kind:   "cloud",
					label:  "Shared clouds",
					values: stringsIntersection(left.Clouds, right.Clouds),
				},
			}

			for _, relationship := range relationships {
				if len(relationship.values) == 0 {
					continue
				}
				edges = append(edges, projectDependencyEdge{
					SourceProjectID:   left.ProjectID,
					SourceProjectName: left.ProjectName,
					SourceProjectCode: left.ProjectCode,
					TargetProjectID:   right.ProjectID,
					TargetProjectName: right.ProjectName,
					TargetProjectCode: right.ProjectCode,
					Relationship:      relationship.kind,
					Label:             relationship.label,
					SharedCount:       len(relationship.values),
					SharedValues:      relationship.values,
				})
			}
		}
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].SharedCount == edges[j].SharedCount {
			if edges[i].Relationship == edges[j].Relationship {
				if edges[i].SourceProjectName == edges[j].SourceProjectName {
					return edges[i].TargetProjectName < edges[j].TargetProjectName
				}
				return edges[i].SourceProjectName < edges[j].SourceProjectName
			}
			return edges[i].Relationship < edges[j].Relationship
		}
		return edges[i].SharedCount > edges[j].SharedCount
	})
	return edges
}

func buildProjectDependencyPayload(projectID int) (*projectDependencyMapPayload, error) {
	projects, err := listProjectCatalogs()
	if err != nil {
		return nil, err
	}
	payload := &projectDependencyMapPayload{
		Projects: buildProjectSummaries(projects),
	}
	if len(projects) == 0 {
		return payload, nil
	}
	connections, err := listK8sConnections()
	if err != nil {
		return nil, err
	}
	incidents, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	nodes := buildProjectDependencyNodes(projects, connections, incidents)
	edges := buildProjectDependencyEdges(nodes)

	if projectID > 0 {
		payload.FocusProjectID = projectID
		filteredNodes := make([]projectDependencyNode, 0)
		filteredEdges := make([]projectDependencyEdge, 0)
		nodeByID := make(map[int]projectDependencyNode, len(nodes))
		includeIDs := map[int]struct{}{}
		for _, node := range nodes {
			nodeByID[node.ProjectID] = node
			if node.ProjectID == projectID {
				focus := node
				payload.FocusNode = &focus
			}
		}
		for _, edge := range edges {
			if edge.SourceProjectID != projectID && edge.TargetProjectID != projectID {
				continue
			}
			filteredEdges = append(filteredEdges, edge)
			includeIDs[edge.SourceProjectID] = struct{}{}
			includeIDs[edge.TargetProjectID] = struct{}{}
		}
		if payload.FocusNode != nil {
			includeIDs[payload.FocusNode.ProjectID] = struct{}{}
		}
		for _, node := range nodes {
			if _, ok := includeIDs[node.ProjectID]; ok {
				filteredNodes = append(filteredNodes, node)
			}
		}
		nodes = filteredNodes
		edges = filteredEdges
	}

	dependencyCountByProject := make(map[int]int)
	peerSetByProject := make(map[int]map[int]struct{})
	labelsByProject := make(map[int][]string)
	for _, edge := range edges {
		dependencyCountByProject[edge.SourceProjectID]++
		dependencyCountByProject[edge.TargetProjectID]++
		if _, ok := peerSetByProject[edge.SourceProjectID]; !ok {
			peerSetByProject[edge.SourceProjectID] = map[int]struct{}{}
		}
		if _, ok := peerSetByProject[edge.TargetProjectID]; !ok {
			peerSetByProject[edge.TargetProjectID] = map[int]struct{}{}
		}
		peerSetByProject[edge.SourceProjectID][edge.TargetProjectID] = struct{}{}
		peerSetByProject[edge.TargetProjectID][edge.SourceProjectID] = struct{}{}
		labelsByProject[edge.SourceProjectID] = append(labelsByProject[edge.SourceProjectID], edge.Label)
		labelsByProject[edge.TargetProjectID] = append(labelsByProject[edge.TargetProjectID], edge.Label)

		switch edge.Relationship {
		case "service":
			payload.Summary.ServiceEdges++
		case "team":
			payload.Summary.TeamEdges++
		case "cluster":
			payload.Summary.ClusterEdges++
		case "cloud":
			payload.Summary.CloudEdges++
		}
	}

	for index := range nodes {
		nodes[index].DependencyEdgeCount = dependencyCountByProject[nodes[index].ProjectID]
		nodes[index].DependencyPeerCount = len(peerSetByProject[nodes[index].ProjectID])
	}

	hotspots := make([]projectDependencyHotspot, 0, len(nodes))
	for _, node := range nodes {
		if node.DependencyEdgeCount == 0 {
			continue
		}
		hotspots = append(hotspots, projectDependencyHotspot{
			ProjectID:         node.ProjectID,
			ProjectName:       node.ProjectName,
			ProjectCode:       node.ProjectCode,
			RelationshipCount: node.DependencyEdgeCount,
			PeerCount:         node.DependencyPeerCount,
			SharedLabels:      uniqueSorted(labelsByProject[node.ProjectID]),
		})
	}
	sort.Slice(hotspots, func(i, j int) bool {
		if hotspots[i].RelationshipCount == hotspots[j].RelationshipCount {
			return hotspots[i].ProjectName < hotspots[j].ProjectName
		}
		return hotspots[i].RelationshipCount > hotspots[j].RelationshipCount
	})
	if len(hotspots) > 10 {
		hotspots = hotspots[:10]
	}

	payload.Nodes = nodes
	payload.Edges = edges
	payload.Hotspots = hotspots
	payload.Summary.NodeCount = len(nodes)
	payload.Summary.EdgeCount = len(edges)
	return payload, nil
}

func devopsEnvironmentDriftHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodOptions)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	payload, err := buildEnvironmentDriftPayload(projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to build environment drift view", err)
		return
	}
	if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"drift":  payload,
	}); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to write environment drift response", err)
	}
}

func devopsOpsCommandCenterHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodOptions)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	payload, err := buildOpsCommandCenterPayload(projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to build ops command center", err)
		return
	}
	if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"center": payload,
	}); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to write ops command center response", err)
	}
}

func devopsProjectDependenciesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet, http.MethodOptions)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	payload, err := buildProjectDependencyPayload(projectID)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to build project dependency map", err)
		return
	}
	if err := writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"status":       "ok",
		"dependencies": payload,
	}); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to write project dependency response", err)
	}
}
