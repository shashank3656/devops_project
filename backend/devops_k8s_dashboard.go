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

type k8sProjectOption struct {
	ID           int      `json:"id"`
	Name         string   `json:"name"`
	Code         string   `json:"code"`
	Clouds       []string `json:"clouds"`
	Environments []string `json:"environments"`
}

type k8sConnectionRecord struct {
	ID                int       `json:"id"`
	ProjectID         int       `json:"project_id"`
	ProjectName       string    `json:"project_name"`
	ProjectCode       string    `json:"project_code"`
	Cloud             string    `json:"cloud"`
	ClusterName       string    `json:"cluster_name"`
	ClusterEndpoint   string    `json:"cluster_endpoint"`
	Environment       string    `json:"environment"`
	Namespace         string    `json:"namespace"`
	AuthMode          string    `json:"auth_mode"`
	HasAuthCredential bool      `json:"has_auth_credential"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type k8sOnboardingInput struct {
	ProjectID       int    `json:"project_id"`
	Cloud           string `json:"cloud"`
	ClusterName     string `json:"cluster_name"`
	ClusterEndpoint string `json:"cluster_endpoint"`
	Environment     string `json:"environment"`
	AuthMode        string `json:"auth_mode"`
	AuthCredential  string `json:"auth_credential"`
}

type k8sSummary struct {
	NamespaceCount    int `json:"namespace_count"`
	DeploymentCount   int `json:"deployment_count"`
	PodCount          int `json:"pod_count"`
	ServiceCount      int `json:"service_count"`
	IngressCount      int `json:"ingress_count"`
	WarningEventCount int `json:"warning_event_count"`
}

type k8sNamespaceItem struct {
	Name         string `json:"name"`
	Status       string `json:"status"`
	Environment  string `json:"environment"`
	ClusterName  string `json:"cluster_name"`
	PodCount     int    `json:"pod_count"`
	ServiceCount int    `json:"service_count"`
	LastActivity string `json:"last_activity"`
}

type k8sDeploymentItem struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	ClusterName     string `json:"cluster_name"`
	Image           string `json:"image"`
	Replicas        int    `json:"replicas"`
	ReadyReplicas   int    `json:"ready_replicas"`
	UpdatedReplicas int    `json:"updated_replicas"`
	Status          string `json:"status"`
}

type k8sPodItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	Status      string `json:"status"`
	Restarts    int    `json:"restarts"`
	Node        string `json:"node"`
	Age         string `json:"age"`
	Deployment  string `json:"deployment"`
}

type k8sLogItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	Container   string `json:"container"`
	Level       string `json:"level"`
	Message     string `json:"message"`
	Timestamp   string `json:"timestamp"`
}

type k8sReplicaSetItem struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	ClusterName     string `json:"cluster_name"`
	DesiredReplicas int    `json:"desired_replicas"`
	ReadyReplicas   int    `json:"ready_replicas"`
	Age             string `json:"age"`
	Deployment      string `json:"deployment"`
}

type k8sVolumeItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	Type        string `json:"type"`
	Claim       string `json:"claim"`
	Status      string `json:"status"`
	MountedBy   string `json:"mounted_by"`
}

type k8sServiceItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	Type        string `json:"type"`
	ClusterIP   string `json:"cluster_ip"`
	Ports       string `json:"ports"`
	Selector    string `json:"selector"`
	Exposure    string `json:"exposure"`
}

type k8sIngressItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	Host        string `json:"host"`
	Paths       string `json:"paths"`
	Exposure    string `json:"exposure"`
	Status      string `json:"status"`
}

type k8sSecretItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	Type        string `json:"type"`
	ManagedBy   string `json:"managed_by"`
	Age         string `json:"age"`
}

type k8sServiceAccountItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	Automount   bool   `json:"automount"`
	TokenCount  int    `json:"token_count"`
}

type k8sConfigMapItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	DataKeys    int    `json:"data_keys"`
	MountedBy   string `json:"mounted_by"`
}

type k8sDashboardResponse struct {
	Projects            []k8sProjectOption      `json:"projects"`
	Connections         []k8sConnectionRecord   `json:"connections"`
	SelectedProjectID   int                     `json:"selected_project_id"`
	SelectedCluster     string                  `json:"selected_cluster"`
	SelectedNamespace   string                  `json:"selected_namespace"`
	SelectedEnvironment string                  `json:"selected_environment"`
	Clusters            []string                `json:"clusters"`
	Namespaces          []string                `json:"namespaces"`
	Environments        []string                `json:"environments"`
	Summary             k8sSummary              `json:"summary"`
	NamespaceItems      []k8sNamespaceItem      `json:"namespace_items"`
	Deployments         []k8sDeploymentItem     `json:"deployments"`
	Pods                []k8sPodItem            `json:"pods"`
	Logs                []k8sLogItem            `json:"logs"`
	ReplicaSets         []k8sReplicaSetItem     `json:"replicasets"`
	Volumes             []k8sVolumeItem         `json:"volumes"`
	Services            []k8sServiceItem        `json:"services"`
	Ingresses           []k8sIngressItem        `json:"ingresses"`
	Secrets             []k8sSecretItem         `json:"secrets"`
	ServiceAccounts     []k8sServiceAccountItem `json:"service_accounts"`
	ConfigMaps          []k8sConfigMapItem      `json:"configmaps"`
}

func k8sAuthModes() []string {
	return []string{"kubeconfig", "service_account", "token", "oidc", "in_cluster"}
}

func k8sSafeToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "app"
	}
	var b strings.Builder
	prevDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevDash = false
			continue
		}
		if !prevDash {
			b.WriteRune('-')
			prevDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "app"
	}
	return out
}

func namespaceForProject(project ProjectCatalog, environment string) string {
	return fmt.Sprintf("%s-%s", k8sSafeToken(project.Code), k8sSafeToken(environment))
}

func deploymentStatus(ready, replicas int) string {
	if replicas == 0 {
		return "scaled-down"
	}
	if ready >= replicas {
		return "healthy"
	}
	if ready == 0 {
		return "blocked"
	}
	return "degraded"
}

func buildK8sProjectOptions(projects []ProjectCatalog) []k8sProjectOption {
	options := make([]k8sProjectOption, 0, len(projects))
	for _, project := range projects {
		options = append(options, k8sProjectOption{
			ID:           project.ID,
			Name:         project.Name,
			Code:         project.Code,
			Clouds:       append([]string{}, project.Clouds...),
			Environments: append([]string{}, project.Environments...),
		})
	}
	sort.Slice(options, func(i, j int) bool {
		return options[i].Name < options[j].Name
	})
	return options
}

func listK8sConnections() ([]k8sConnectionRecord, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT
			c.id,
			c.project_id,
			COALESCE(p.name, ''),
			COALESCE(p.code, ''),
			COALESCE(c.cloud, ''),
			COALESCE(c.cluster_name, ''),
			COALESCE(c.cluster_endpoint, ''),
			COALESCE(c.environment, ''),
			COALESCE(c.namespace, ''),
			COALESCE(c.auth_mode, ''),
			CASE WHEN COALESCE(c.auth_credential, '') <> '' THEN TRUE ELSE FALSE END,
			c.created_at,
			c.updated_at
		FROM project_k8s_connections c
		INNER JOIN projects p ON p.id = c.project_id
		ORDER BY p.name, c.environment, c.cluster_name
	`)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	var out []k8sConnectionRecord
	for rows.Next() {
		var item k8sConnectionRecord
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.ProjectName,
			&item.ProjectCode,
			&item.Cloud,
			&item.ClusterName,
			&item.ClusterEndpoint,
			&item.Environment,
			&item.Namespace,
			&item.AuthMode,
			&item.HasAuthCredential,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}

func sanitizeK8sOnboardingInput(input k8sOnboardingInput) (k8sOnboardingInput, *ProjectCatalog, error) {
	input.Cloud = strings.ToLower(strings.TrimSpace(input.Cloud))
	input.ClusterName = strings.TrimSpace(input.ClusterName)
	input.ClusterEndpoint = strings.TrimSpace(input.ClusterEndpoint)
	input.Environment = strings.ToLower(strings.TrimSpace(input.Environment))
	input.AuthMode = strings.ToLower(strings.TrimSpace(input.AuthMode))
	input.AuthCredential = strings.TrimSpace(input.AuthCredential)

	if input.ProjectID <= 0 {
		return input, nil, fmt.Errorf("project is required")
	}
	project, err := getProjectCatalogByID(input.ProjectID)
	if err != nil {
		return input, nil, err
	}
	if project == nil {
		return input, nil, fmt.Errorf("project not found")
	}
	if input.Cloud == "" {
		return input, nil, fmt.Errorf("cloud is required")
	}
	if input.ClusterName == "" {
		return input, nil, fmt.Errorf("cluster name is required")
	}
	if input.ClusterEndpoint == "" {
		return input, nil, fmt.Errorf("cluster endpoint is required")
	}
	if input.Environment == "" {
		return input, nil, fmt.Errorf("environment is required")
	}
	if input.AuthMode == "" {
		input.AuthMode = "service_account"
	}

	validAuth := false
	for _, mode := range k8sAuthModes() {
		if input.AuthMode == mode {
			validAuth = true
			break
		}
	}
	if !validAuth {
		return input, nil, fmt.Errorf("invalid auth mode")
	}
	if input.AuthMode != "in_cluster" && input.AuthCredential == "" {
		return input, nil, fmt.Errorf("authentication credential is required for %s mode", input.AuthMode)
	}

	allowedEnv := false
	for _, env := range project.Environments {
		if input.Environment == env {
			allowedEnv = true
			break
		}
	}
	if !allowedEnv {
		return input, nil, fmt.Errorf("environment %s is not configured for this project", input.Environment)
	}

	allowedCloud := false
	for _, cloud := range project.Clouds {
		if input.Cloud == cloud {
			allowedCloud = true
			break
		}
	}
	if !allowedCloud {
		return input, nil, fmt.Errorf("cloud %s is not configured for this project", input.Cloud)
	}

	return input, project, nil
}

func createOrUpdateK8sConnection(input k8sOnboardingInput, updatedBy *int) (*k8sConnectionRecord, error) {
	input, project, err := sanitizeK8sOnboardingInput(input)
	if err != nil {
		return nil, err
	}
	namespace := namespaceForProject(*project, input.Environment)
	ctx, cancel := dbTimeoutContext()
	defer cancel()

	_, err = DB.ExecContext(ctx, `
		INSERT INTO project_k8s_connections
			(project_id, cloud, cluster_name, cluster_endpoint, environment, namespace, auth_mode, auth_credential)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (project_id, cluster_name, environment)
		DO UPDATE SET
			cloud = EXCLUDED.cloud,
			cluster_endpoint = EXCLUDED.cluster_endpoint,
			namespace = EXCLUDED.namespace,
			auth_mode = EXCLUDED.auth_mode,
			auth_credential = EXCLUDED.auth_credential,
			updated_at = CURRENT_TIMESTAMP
	`, input.ProjectID, input.Cloud, input.ClusterName, input.ClusterEndpoint, input.Environment, namespace, input.AuthMode, input.AuthCredential)
	if err != nil {
		return nil, err
	}

	actionUser := updatedBy
	AppendAuditLog(actionUser, "k8s_onboarding_update", "project", strconv.Itoa(input.ProjectID), fmt.Sprintf("cluster=%s,environment=%s", input.ClusterName, input.Environment))

	connections, err := listK8sConnections()
	if err != nil {
		return nil, err
	}
	for _, item := range connections {
		if item.ProjectID == input.ProjectID && item.ClusterName == input.ClusterName && item.Environment == input.Environment {
			return &item, nil
		}
	}
	return nil, fmt.Errorf("k8s onboarding record not found after upsert")
}

func uniqueSortedNonEmpty(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func buildK8sDashboard(projectID int, clusterName, namespaceFilter, environmentFilter string) (*k8sDashboardResponse, error) {
	projects, err := listProjectCatalogs()
	if err != nil {
		return nil, err
	}
	response := &k8sDashboardResponse{
		Projects: buildK8sProjectOptions(projects),
	}
	connections, err := listK8sConnections()
	if err != nil {
		return nil, err
	}
	response.Connections = connections
	if len(projects) == 0 {
		return response, nil
	}

	selectedProject := projects[0]
	if projectID > 0 {
		for _, project := range projects {
			if project.ID == projectID {
				selectedProject = project
				break
			}
		}
	} else if len(connections) > 0 {
		for _, project := range projects {
			if project.ID == connections[0].ProjectID {
				selectedProject = project
				break
			}
		}
	}
	response.SelectedProjectID = selectedProject.ID

	projectConnections := make([]k8sConnectionRecord, 0)
	for _, item := range connections {
		if item.ProjectID == selectedProject.ID {
			projectConnections = append(projectConnections, item)
		}
	}

	clusterOptions := make([]string, 0, len(projectConnections))
	namespaceOptions := make([]string, 0, len(projectConnections))
	environmentOptions := make([]string, 0, len(projectConnections))
	for _, item := range projectConnections {
		clusterOptions = append(clusterOptions, item.ClusterName)
		namespaceOptions = append(namespaceOptions, item.Namespace)
		environmentOptions = append(environmentOptions, item.Environment)
	}
	response.Clusters = uniqueSortedNonEmpty(clusterOptions)
	response.Namespaces = uniqueSortedNonEmpty(namespaceOptions)
	response.Environments = uniqueSortedNonEmpty(environmentOptions)

	selectedCluster := strings.TrimSpace(clusterName)
	if selectedCluster == "" && len(response.Clusters) > 0 {
		selectedCluster = response.Clusters[0]
	}
	selectedEnvironment := strings.TrimSpace(environmentFilter)
	if selectedEnvironment == "" && len(response.Environments) > 0 {
		selectedEnvironment = response.Environments[0]
	}
	selectedNamespace := strings.TrimSpace(namespaceFilter)
	if selectedNamespace == "" && len(response.Namespaces) > 0 {
		selectedNamespace = response.Namespaces[0]
	}
	response.SelectedCluster = selectedCluster
	response.SelectedEnvironment = selectedEnvironment
	response.SelectedNamespace = selectedNamespace

	requests, err := GetPRRequests("", "", "", selectedProject.ID, "", "", "", 0, 0, nil, 250, 0, "updated_at", "desc", false, "", "")
	if err != nil {
		return nil, err
	}

	servicePairs := append([]ProjectServiceOption{}, selectedProject.Services...)
	if len(servicePairs) == 0 {
		seen := map[string]struct{}{}
		for _, req := range requests {
			key := strings.ToLower(req.Cloud) + "::" + strings.ToLower(req.Service)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			servicePairs = append(servicePairs, ProjectServiceOption{Cloud: req.Cloud, Service: req.Service})
		}
	}
	if len(servicePairs) == 0 {
		servicePairs = append(servicePairs, ProjectServiceOption{Cloud: "aws", Service: "application"})
	}

	requestsByEnv := map[string][]PRRequest{}
	for _, req := range requests {
		env := strings.ToLower(strings.TrimSpace(req.Env))
		requestsByEnv[env] = append(requestsByEnv[env], req)
	}

	filteredConnections := make([]k8sConnectionRecord, 0, len(projectConnections))
	for _, item := range projectConnections {
		if selectedCluster != "" && item.ClusterName != selectedCluster {
			continue
		}
		if selectedEnvironment != "" && item.Environment != selectedEnvironment {
			continue
		}
		if selectedNamespace != "" && item.Namespace != selectedNamespace {
			continue
		}
		filteredConnections = append(filteredConnections, item)
	}

	now := time.Now()
	var namespaceItems []k8sNamespaceItem
	var deployments []k8sDeploymentItem
	var pods []k8sPodItem
	var logs []k8sLogItem
	var replicaSets []k8sReplicaSetItem
	var volumes []k8sVolumeItem
	var services []k8sServiceItem
	var ingresses []k8sIngressItem
	var secrets []k8sSecretItem
	var serviceAccounts []k8sServiceAccountItem
	var configMaps []k8sConfigMapItem
	warningEventCount := 0

	for _, connection := range filteredConnections {
		envRequests := requestsByEnv[connection.Environment]
		podCount := len(servicePairs) * 2
		serviceCount := len(servicePairs)
		lastActivity := now.Add(-24 * time.Hour)
		for _, req := range envRequests {
			if req.UpdatedAt.After(lastActivity) {
				lastActivity = req.UpdatedAt
			}
		}
		if len(envRequests) > 0 {
			podCount += len(envRequests)
		}

		namespaceItems = append(namespaceItems, k8sNamespaceItem{
			Name:         connection.Namespace,
			Status:       "active",
			Environment:  connection.Environment,
			ClusterName:  connection.ClusterName,
			PodCount:     podCount,
			ServiceCount: serviceCount,
			LastActivity: lastActivity.Format(time.RFC3339),
		})

		for index, pair := range servicePairs {
			serviceToken := k8sSafeToken(pair.Service)
			deploymentName := fmt.Sprintf("%s-%s", serviceToken, connection.Environment)
			replicas := 2
			ready := 2
			if index == 0 && len(envRequests) > 0 {
				for _, req := range envRequests {
					if strings.Contains(strings.ToLower(req.Status), "pending") {
						ready = 1
						warningEventCount++
						break
					}
				}
			}

			deployments = append(deployments, k8sDeploymentItem{
				Name:            deploymentName,
				Namespace:       connection.Namespace,
				ClusterName:     connection.ClusterName,
				Image:           fmt.Sprintf("registry.internal/%s/%s:%s", k8sSafeToken(selectedProject.Code), serviceToken, connection.Environment),
				Replicas:        replicas,
				ReadyReplicas:   ready,
				UpdatedReplicas: replicas,
				Status:          deploymentStatus(ready, replicas),
			})
			replicaSets = append(replicaSets, k8sReplicaSetItem{
				Name:            fmt.Sprintf("%s-rs-%d", deploymentName, index+1),
				Namespace:       connection.Namespace,
				ClusterName:     connection.ClusterName,
				DesiredReplicas: replicas,
				ReadyReplicas:   ready,
				Age:             fmt.Sprintf("%dh", 6+(index*3)),
				Deployment:      deploymentName,
			})
			for podIndex := 0; podIndex < replicas; podIndex++ {
				pods = append(pods, k8sPodItem{
					Name:        fmt.Sprintf("%s-%d", deploymentName, podIndex+1),
					Namespace:   connection.Namespace,
					ClusterName: connection.ClusterName,
					Status:      map[bool]string{true: "Running", false: "CrashLoopBackOff"}[ready == replicas || podIndex == 0],
					Restarts:    map[bool]int{true: 0, false: 3}[ready == replicas || podIndex == 0],
					Node:        fmt.Sprintf("%s-node-%d", k8sSafeToken(connection.ClusterName), (index%3)+1),
					Age:         fmt.Sprintf("%dh", 2+(podIndex*3)),
					Deployment:  deploymentName,
				})
			}
			services = append(services, k8sServiceItem{
				Name:        fmt.Sprintf("%s-svc", deploymentName),
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				Type:        "ClusterIP",
				ClusterIP:   fmt.Sprintf("10.96.%d.%d", (index%20)+10, (index%200)+10),
				Ports:       "80/TCP, 443/TCP",
				Selector:    fmt.Sprintf("app=%s", deploymentName),
				Exposure:    strings.ToUpper(connection.Cloud),
			})
			ingresses = append(ingresses, k8sIngressItem{
				Name:        fmt.Sprintf("%s-ing", deploymentName),
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				Host:        fmt.Sprintf("%s.%s.internal.example.com", deploymentName, k8sSafeToken(selectedProject.Code)),
				Paths:       "/",
				Exposure:    "private",
				Status:      map[bool]string{true: "ready", false: "warning"}[ready == replicas],
			})
			volumes = append(volumes, k8sVolumeItem{
				Name:        fmt.Sprintf("%s-data", deploymentName),
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				Type:        "PersistentVolumeClaim",
				Claim:       fmt.Sprintf("pvc-%s", deploymentName),
				Status:      "Bound",
				MountedBy:   deploymentName,
			})
			secrets = append(secrets, k8sSecretItem{
				Name:        fmt.Sprintf("%s-secrets", deploymentName),
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				Type:        "Opaque",
				ManagedBy:   "portal",
				Age:         fmt.Sprintf("%dd", 7+(index*3)),
			})
			serviceAccounts = append(serviceAccounts, k8sServiceAccountItem{
				Name:        fmt.Sprintf("%s-sa", deploymentName),
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				Automount:   true,
				TokenCount:  1,
			})
			configMaps = append(configMaps, k8sConfigMapItem{
				Name:        fmt.Sprintf("%s-config", deploymentName),
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				DataKeys:    4 + index,
				MountedBy:   deploymentName,
			})
			logs = append(logs, k8sLogItem{
				Name:        deploymentName,
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				Container:   serviceToken,
				Level:       map[bool]string{true: "info", false: "warning"}[ready == replicas],
				Message:     map[bool]string{true: "Readiness probe passed and rollout stable.", false: "One replica is restarting after a readiness probe failure."}[ready == replicas],
				Timestamp:   now.Add(-time.Duration(index+1) * time.Hour).Format(time.RFC3339),
			})
		}
	}

	sort.Slice(namespaceItems, func(i, j int) bool { return namespaceItems[i].Name < namespaceItems[j].Name })
	sort.Slice(deployments, func(i, j int) bool { return deployments[i].Name < deployments[j].Name })
	sort.Slice(pods, func(i, j int) bool { return pods[i].Name < pods[j].Name })
	sort.Slice(logs, func(i, j int) bool { return logs[i].Timestamp > logs[j].Timestamp })
	sort.Slice(replicaSets, func(i, j int) bool { return replicaSets[i].Name < replicaSets[j].Name })
	sort.Slice(volumes, func(i, j int) bool { return volumes[i].Name < volumes[j].Name })
	sort.Slice(services, func(i, j int) bool { return services[i].Name < services[j].Name })
	sort.Slice(ingresses, func(i, j int) bool { return ingresses[i].Name < ingresses[j].Name })
	sort.Slice(secrets, func(i, j int) bool { return secrets[i].Name < secrets[j].Name })
	sort.Slice(serviceAccounts, func(i, j int) bool { return serviceAccounts[i].Name < serviceAccounts[j].Name })
	sort.Slice(configMaps, func(i, j int) bool { return configMaps[i].Name < configMaps[j].Name })

	response.Summary = k8sSummary{
		NamespaceCount:    len(namespaceItems),
		DeploymentCount:   len(deployments),
		PodCount:          len(pods),
		ServiceCount:      len(services),
		IngressCount:      len(ingresses),
		WarningEventCount: warningEventCount,
	}
	response.NamespaceItems = namespaceItems
	response.Deployments = deployments
	response.Pods = pods
	response.Logs = logs
	response.ReplicaSets = replicaSets
	response.Volumes = volumes
	response.Services = services
	response.Ingresses = ingresses
	response.Secrets = secrets
	response.ServiceAccounts = serviceAccounts
	response.ConfigMaps = configMaps
	return response, nil
}

func devopsK8sConnectionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	switch r.Method {
	case "GET":
		if _, ok := requireDevopsUser(w, r); !ok {
			return
		}
		projects, err := listProjectCatalogs()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
			return
		}
		connections, err := listK8sConnections()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "ok",
			"data": map[string]any{
				"projects":    buildK8sProjectOptions(projects),
				"connections": connections,
				"auth_modes":  k8sAuthModes(),
			},
		})
	case "POST":
		userID, ok := requireDevopsManager(w, r)
		if !ok {
			return
		}
		var input k8sOnboardingInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid json", "status": "error"})
			return
		}
		connection, err := createOrUpdateK8sConnection(input, &userID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":     "ok",
			"message":    "K8s onboarding saved",
			"connection": connection,
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func devopsK8sOverviewHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	clusterName := strings.TrimSpace(r.URL.Query().Get("cluster_name"))
	namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))
	environment := strings.TrimSpace(r.URL.Query().Get("environment"))
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data":   payload,
	})
}
