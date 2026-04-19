package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
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
	CPUUtilization  int    `json:"cpu_utilization_pct"`
	CPUHours        int    `json:"cpu_hours"`
	MemoryUsageGB   int    `json:"memory_utilization_gb"`
	MemoryHours     int    `json:"memory_hours"`
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

type k8sEventItem struct {
	ID            string `json:"id"`
	Namespace     string `json:"namespace"`
	ClusterName   string `json:"cluster_name"`
	Severity      string `json:"severity"`
	Reason        string `json:"reason"`
	Message       string `json:"message"`
	ResourceKind  string `json:"resource_kind"`
	ResourceName  string `json:"resource_name"`
	Timestamp     string `json:"timestamp"`
	OccurrenceCnt int    `json:"occurrence_count"`
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
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	ClusterName  string `json:"cluster_name"`
	Type         string `json:"type"`
	Claim        string `json:"claim"`
	Status       string `json:"status"`
	MountedBy    string `json:"mounted_by"`
	StorageClass string `json:"storage_class"`
	Capacity     string `json:"capacity"`
	AccessMode   string `json:"access_mode"`
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
	ExternalIP  string `json:"external_ip"`
	IngressHost string `json:"ingress_host"`
}

type k8sIngressItem struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	ClusterName       string `json:"cluster_name"`
	Host              string `json:"host"`
	Paths             string `json:"paths"`
	Exposure          string `json:"exposure"`
	Status            string `json:"status"`
	TLSSecret         string `json:"tls_secret"`
	CertificateStatus string `json:"certificate_status"`
}

type k8sSecretItem struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	ClusterName       string `json:"cluster_name"`
	Type              string `json:"type"`
	ManagedBy         string `json:"managed_by"`
	Age               string `json:"age"`
	KeyCount          int    `json:"key_count"`
	BoundTo           string `json:"bound_to"`
	ExpiresAt         string `json:"expires_at"`
	CertificateStatus string `json:"certificate_status"`
}

type k8sCertificateItem struct {
	Name          string `json:"name"`
	Namespace     string `json:"namespace"`
	ClusterName   string `json:"cluster_name"`
	SecretName    string `json:"secret_name"`
	Hosts         string `json:"hosts"`
	Issuer        string `json:"issuer"`
	Status        string `json:"status"`
	ExpiresAt     string `json:"expires_at"`
	DaysRemaining int    `json:"days_remaining"`
	ManagedBy     string `json:"managed_by"`
}

type k8sServiceAccountItem struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	ClusterName string `json:"cluster_name"`
	Automount   bool   `json:"automount"`
	TokenCount  int    `json:"token_count"`
}

type k8sConfigMapItem struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	ClusterName     string `json:"cluster_name"`
	DataKeys        int    `json:"data_keys"`
	MountedBy       string `json:"mounted_by"`
	ResourceVersion string `json:"resource_version"`
	Age             string `json:"age"`
}

type k8sClusterListItem struct {
	ProjectID         int       `json:"project_id"`
	ProjectName       string    `json:"project_name"`
	ProjectCode       string    `json:"project_code"`
	Cloud             string    `json:"cloud"`
	ClusterName       string    `json:"cluster_name"`
	ClusterEndpoint   string    `json:"cluster_endpoint"`
	Environment       string    `json:"environment"`
	AuthMode          string    `json:"auth_mode"`
	HasAuthCredential bool      `json:"has_auth_credential"`
	NamespaceCount    int       `json:"namespace_count"`
	WorkloadCount     int       `json:"workload_count"`
	ServiceCount      int       `json:"service_count"`
	ConfigMapCount    int       `json:"configmap_count"`
	StorageCount      int       `json:"storage_count"`
	NodePool          string    `json:"node_pool"`
	NodeCount         int       `json:"node_count"`
	KubernetesVersion string    `json:"kubernetes_version"`
	Location          string    `json:"location"`
	HealthStatus      string    `json:"health_status"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type k8sResourceMeta struct {
	Projects            []k8sProjectOption    `json:"projects"`
	SelectedProjectID   int                   `json:"selected_project_id"`
	SelectedCluster     string                `json:"selected_cluster"`
	SelectedNamespace   string                `json:"selected_namespace"`
	SelectedEnvironment string                `json:"selected_environment"`
	Clusters            []string              `json:"clusters"`
	Namespaces          []string              `json:"namespaces"`
	Environments        []string              `json:"environments"`
	Connections         []k8sConnectionRecord `json:"connections,omitempty"`
}

type k8sClustersResponse struct {
	k8sResourceMeta
	Items []k8sClusterListItem `json:"items"`
}

type k8sWorkloadsResponse struct {
	k8sResourceMeta
	HealthSummary k8sWorkloadHealthSummary `json:"health_summary"`
	Items         []k8sDeploymentItem      `json:"items"`
}

type k8sServicesResponse struct {
	k8sResourceMeta
	Items []k8sServiceItem `json:"items"`
}

type k8sConfigMapsResponse struct {
	k8sResourceMeta
	Items []k8sConfigMapItem `json:"items"`
}

type k8sStorageResponse struct {
	k8sResourceMeta
	Items []k8sVolumeItem `json:"items"`
}

type k8sPodsResponse struct {
	k8sResourceMeta
	HealthSummary k8sWorkloadHealthSummary `json:"health_summary"`
	Items         []k8sPodItem             `json:"items"`
}

type k8sIngressesResponse struct {
	k8sResourceMeta
	Items []k8sIngressItem `json:"items"`
}

type k8sSecretsResponse struct {
	k8sResourceMeta
	Items []k8sSecretItem `json:"items"`
}

type k8sCertificatesResponse struct {
	k8sResourceMeta
	Items []k8sCertificateItem `json:"items"`
}

type k8sLogsResponse struct {
	k8sResourceMeta
	Items []k8sLogItem `json:"items"`
}

type k8sLogStreamResponse struct {
	k8sResourceMeta
	Items               []k8sLogItem `json:"items"`
	NextCursor          string       `json:"next_cursor"`
	StreamStatus        string       `json:"stream_status"`
	LiveIntervalSeconds int          `json:"live_interval_seconds"`
	AppendedCount       int          `json:"appended_count"`
}

type k8sEventsResponse struct {
	k8sResourceMeta
	Items []k8sEventItem `json:"items"`
}

type k8sClusterDetailResponse struct {
	k8sResourceMeta
	Cluster            *k8sClusterListItem      `json:"cluster"`
	Summary            k8sSummary               `json:"summary"`
	HealthSummary      k8sWorkloadHealthSummary `json:"health_summary"`
	NamespaceItems     []k8sNamespaceItem       `json:"namespace_items"`
	NamespaceHealth    []k8sNamespaceHealth     `json:"namespace_health"`
	WorkloadSpotlights []k8sWorkloadSpotlight   `json:"workload_spotlights"`
	RecentLogs         []k8sLogItem             `json:"recent_logs"`
	Events             []k8sEventItem           `json:"events"`
}

type k8sPodDetailResponse struct {
	k8sResourceMeta
	Pod          *k8sPodItem        `json:"pod"`
	Deployment   *k8sDeploymentItem `json:"deployment"`
	SiblingPods  []k8sPodItem       `json:"sibling_pods"`
	Services     []k8sServiceItem   `json:"services"`
	RecentLogs   []k8sLogItem       `json:"recent_logs"`
	RecentEvents []k8sEventItem     `json:"recent_events"`
}

type k8sRolloutStep struct {
	Title     string `json:"title"`
	Detail    string `json:"detail"`
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
}

type k8sRolloutDetailResponse struct {
	k8sResourceMeta
	Cluster      *k8sClusterListItem `json:"cluster"`
	Workload     *k8sDeploymentItem  `json:"workload"`
	ReplicaSets  []k8sReplicaSetItem `json:"replicasets"`
	Pods         []k8sPodItem        `json:"pods"`
	Services     []k8sServiceItem    `json:"services"`
	RecentLogs   []k8sLogItem        `json:"recent_logs"`
	RecentEvents []k8sEventItem      `json:"recent_events"`
	Timeline     []k8sRolloutStep    `json:"timeline"`
}

type k8sOperatorActivityItem struct {
	ID           string `json:"id"`
	Action       string `json:"action"`
	ActorName    string `json:"actor_name"`
	ResourceType string `json:"resource_type"`
	ResourceName string `json:"resource_name"`
	ClusterName  string `json:"cluster_name"`
	Namespace    string `json:"namespace"`
	Environment  string `json:"environment"`
	ProjectID    int    `json:"project_id"`
	Summary      string `json:"summary"`
	Detail       string `json:"detail"`
	Timestamp    string `json:"timestamp"`
}

type k8sActivityResponse struct {
	k8sResourceMeta
	Items []k8sOperatorActivityItem `json:"items"`
}

type k8sPodExecProfileResponse struct {
	k8sResourceMeta
	Cluster             *k8sClusterListItem `json:"cluster"`
	Pod                 *k8sPodItem         `json:"pod"`
	AvailableContainers []string            `json:"available_containers"`
	AllowedShells       []string            `json:"allowed_shells"`
	DefaultShell        string              `json:"default_shell"`
	CommandPreview      string              `json:"command_preview"`
	AccessModel         string              `json:"access_model"`
	AuditHint           string              `json:"audit_hint"`
	RecentLogs          []k8sLogItem        `json:"recent_logs"`
	RecentEvents        []k8sEventItem      `json:"recent_events"`
}

type k8sTerminalLaunchInput struct {
	ProjectID   int    `json:"project_id"`
	ClusterName string `json:"cluster_name"`
	Namespace   string `json:"namespace"`
	Environment string `json:"environment"`
	PodName     string `json:"pod_name"`
	Container   string `json:"container"`
	Shell       string `json:"shell"`
	Reason      string `json:"reason"`
}

type k8sTerminalLaunchResponse struct {
	k8sResourceMeta
	SessionID      string              `json:"session_id"`
	Status         string              `json:"status"`
	Cluster        *k8sClusterListItem `json:"cluster"`
	Pod            *k8sPodItem         `json:"pod"`
	Container      string              `json:"container"`
	Shell          string              `json:"shell"`
	CommandPreview string              `json:"command_preview"`
	Reason         string              `json:"reason"`
	CreatedAt      string              `json:"created_at"`
	ExpiresAt      string              `json:"expires_at"`
	LastActivityAt string              `json:"last_activity_at"`
	AccessModel    string              `json:"access_model"`
	AuditHint      string              `json:"audit_hint"`
	InitialOutput  []string            `json:"initial_output"`
}

type k8sTerminalSession struct {
	SessionID      string
	ManagerID      int
	ProjectID      int
	ClusterName    string
	Namespace      string
	Environment    string
	PodName        string
	Container      string
	Shell          string
	Reason         string
	Status         string
	CreatedAt      time.Time
	ExpiresAt      time.Time
	LastActivityAt time.Time
	Transcript     []string
	Subscribers    map[string]chan k8sTerminalStreamEvent
}

func parseK8sAuditDetails(details string) map[string]string {
	parsed := make(map[string]string)
	for _, rawPart := range strings.Split(details, ",") {
		part := strings.TrimSpace(rawPart)
		if part == "" {
			continue
		}
		pieces := strings.SplitN(part, "=", 2)
		if len(pieces) != 2 {
			continue
		}
		key := strings.TrimSpace(pieces[0])
		value := strings.TrimSpace(pieces[1])
		if key == "" {
			continue
		}
		if _, exists := parsed[key]; !exists {
			parsed[key] = value
		}
	}
	return parsed
}

func parseK8sScopedResource(resourceType, resourceID string) (clusterName, namespace, resourceName string) {
	if resourceType != "k8s_pod" && resourceType != "k8s_workload" {
		return "", "", ""
	}
	parts := strings.SplitN(resourceID, ":", 3)
	if len(parts) != 3 {
		return "", "", ""
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2])
}

func humanizeK8sAction(action string, resourceName string, fields map[string]string) string {
	target := resourceName
	if target == "" {
		target = "resource"
	}
	switch action {
	case "k8s_workload_restart":
		return fmt.Sprintf("Restart requested for %s", target)
	case "k8s_workload_scale":
		if replicas := strings.TrimSpace(fields["desired_replicas"]); replicas != "" {
			return fmt.Sprintf("Scaled %s to %s replica(s)", target, replicas)
		}
		return fmt.Sprintf("Scale updated for %s", target)
	case "k8s_workload_resume_rollout":
		return fmt.Sprintf("Resumed rollout for %s", target)
	case "k8s_pod_terminal_launch":
		return fmt.Sprintf("Opened terminal session for %s", target)
	case "k8s_pod_terminal_command":
		return fmt.Sprintf("Ran audited terminal command on %s", target)
	case "k8s_onboarding_update":
		return fmt.Sprintf("Updated K8s onboarding for %s", target)
	default:
		return strings.ReplaceAll(strings.TrimPrefix(action, "k8s_"), "_", " ")
	}
}

func buildK8sActivityDetail(action string, fields map[string]string) string {
	parts := make([]string, 0, 5)
	if environment := strings.TrimSpace(fields["environment"]); environment != "" {
		parts = append(parts, fmt.Sprintf("Env %s", strings.ToUpper(environment)))
	}
	if container := strings.TrimSpace(fields["container"]); container != "" {
		parts = append(parts, fmt.Sprintf("Container %s", container))
	}
	if shell := strings.TrimSpace(fields["shell"]); shell != "" {
		parts = append(parts, fmt.Sprintf("Shell %s", shell))
	}
	if replicas := strings.TrimSpace(fields["desired_replicas"]); replicas != "" && action == "k8s_workload_scale" {
		parts = append(parts, fmt.Sprintf("Replicas %s", replicas))
	}
	if session := strings.TrimSpace(fields["session"]); session != "" {
		parts = append(parts, fmt.Sprintf("Session %s", session))
	}
	if reason := strings.TrimSpace(fields["reason"]); reason != "" {
		parts = append(parts, fmt.Sprintf("Reason %s", reason))
	}
	if len(parts) == 0 {
		return "Recorded in the DevOps K8s operator audit trail."
	}
	return strings.Join(parts, " · ")
}

type k8sTerminalSessionResponse struct {
	k8sResourceMeta
	SessionID      string              `json:"session_id"`
	Status         string              `json:"status"`
	Cluster        *k8sClusterListItem `json:"cluster"`
	Pod            *k8sPodItem         `json:"pod"`
	Container      string              `json:"container"`
	Shell          string              `json:"shell"`
	CommandPreview string              `json:"command_preview"`
	Reason         string              `json:"reason"`
	CreatedAt      string              `json:"created_at"`
	ExpiresAt      string              `json:"expires_at"`
	LastActivityAt string              `json:"last_activity_at"`
	Transcript     []string            `json:"transcript"`
}

type k8sLogAttachEvent struct {
	Type      string                `json:"type"`
	Timestamp string                `json:"timestamp"`
	Message   string                `json:"message,omitempty"`
	Data      *k8sLogStreamResponse `json:"data,omitempty"`
}

type k8sTerminalStreamEvent struct {
	Type      string                      `json:"type"`
	Timestamp string                      `json:"timestamp"`
	Message   string                      `json:"message,omitempty"`
	Data      *k8sTerminalSessionResponse `json:"data,omitempty"`
}

type k8sTerminalCommandInput struct {
	SessionID string `json:"session_id"`
	Command   string `json:"command"`
}

var (
	k8sTerminalSessionMu sync.RWMutex
	k8sTerminalSessions  = map[string]*k8sTerminalSession{}
)

type k8sIngressRouteItem struct {
	Host              string `json:"host"`
	Path              string `json:"path"`
	ServiceName       string `json:"service_name"`
	ServiceType       string `json:"service_type"`
	TargetAddress     string `json:"target_address"`
	Exposure          string `json:"exposure"`
	TLSSecret         string `json:"tls_secret"`
	CertificateStatus string `json:"certificate_status"`
}

type k8sIngressDetailResponse struct {
	k8sResourceMeta
	Cluster      *k8sClusterListItem   `json:"cluster"`
	Ingress      *k8sIngressItem       `json:"ingress"`
	Routes       []k8sIngressRouteItem `json:"routes"`
	Services     []k8sServiceItem      `json:"services"`
	Secret       *k8sSecretItem        `json:"secret"`
	Certificates []k8sCertificateItem  `json:"certificates"`
	RecentEvents []k8sEventItem        `json:"recent_events"`
}

type k8sDashboardResponse struct {
	Projects            []k8sProjectOption       `json:"projects"`
	Connections         []k8sConnectionRecord    `json:"connections"`
	SelectedProjectID   int                      `json:"selected_project_id"`
	SelectedCluster     string                   `json:"selected_cluster"`
	SelectedNamespace   string                   `json:"selected_namespace"`
	SelectedEnvironment string                   `json:"selected_environment"`
	Clusters            []string                 `json:"clusters"`
	Namespaces          []string                 `json:"namespaces"`
	Environments        []string                 `json:"environments"`
	Summary             k8sSummary               `json:"summary"`
	HealthSummary       k8sWorkloadHealthSummary `json:"health_summary"`
	NamespaceItems      []k8sNamespaceItem       `json:"namespace_items"`
	NamespaceHealth     []k8sNamespaceHealth     `json:"namespace_health"`
	Deployments         []k8sDeploymentItem      `json:"deployments"`
	WorkloadSpotlights  []k8sWorkloadSpotlight   `json:"workload_spotlights"`
	Pods                []k8sPodItem             `json:"pods"`
	Logs                []k8sLogItem             `json:"logs"`
	Events              []k8sEventItem           `json:"events"`
	ReplicaSets         []k8sReplicaSetItem      `json:"replicasets"`
	Volumes             []k8sVolumeItem          `json:"volumes"`
	Services            []k8sServiceItem         `json:"services"`
	Ingresses           []k8sIngressItem         `json:"ingresses"`
	Secrets             []k8sSecretItem          `json:"secrets"`
	Certificates        []k8sCertificateItem     `json:"certificates"`
	ServiceAccounts     []k8sServiceAccountItem  `json:"service_accounts"`
	ConfigMaps          []k8sConfigMapItem       `json:"configmaps"`
}

type k8sWorkloadActionInput struct {
	ProjectID    int    `json:"project_id"`
	ClusterName  string `json:"cluster_name"`
	Namespace    string `json:"namespace"`
	Environment  string `json:"environment"`
	WorkloadName string `json:"workload_name"`
	Action       string `json:"action"`
	Replicas     int    `json:"replicas"`
	Reason       string `json:"reason"`
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

func findK8sPodInScope(payload *k8sDashboardResponse, clusterName, namespace, podName string) *k8sPodItem {
	for i := range payload.Pods {
		item := &payload.Pods[i]
		if item.ClusterName == clusterName && item.Namespace == namespace && item.Name == podName {
			return item
		}
	}
	return nil
}

func commandPreviewForPod(namespace, podName, container, shell string) string {
	return fmt.Sprintf(
		"kubectl exec -it -n %s %s -c %s -- %s",
		namespace,
		podName,
		container,
		shell,
	)
}

func k8sTerminalWorkingDir(namespace, podName string) string {
	return fmt.Sprintf("/workspace/%s/%s", k8sSafeToken(namespace), k8sSafeToken(podName))
}

func getK8sTerminalSession(sessionID string) (*k8sTerminalSession, bool) {
	now := time.Now()
	k8sTerminalSessionMu.Lock()
	defer k8sTerminalSessionMu.Unlock()

	session, ok := k8sTerminalSessions[sessionID]
	if !ok {
		return nil, false
	}
	if now.After(session.ExpiresAt) {
		delete(k8sTerminalSessions, sessionID)
		return nil, false
	}
	copySession := *session
	copySession.Transcript = append([]string{}, session.Transcript...)
	copySession.Subscribers = nil
	return &copySession, true
}

func upsertK8sTerminalSession(session *k8sTerminalSession) {
	if session == nil {
		return
	}
	copySession := *session
	copySession.Transcript = append([]string{}, session.Transcript...)
	if copySession.Subscribers == nil {
		copySession.Subscribers = map[string]chan k8sTerminalStreamEvent{}
	}
	k8sTerminalSessionMu.Lock()
	defer k8sTerminalSessionMu.Unlock()
	k8sTerminalSessions[session.SessionID] = &copySession
}

func appendK8sTerminalTranscript(sessionID string, lines ...string) (*k8sTerminalSession, bool) {
	now := time.Now()
	k8sTerminalSessionMu.Lock()
	defer k8sTerminalSessionMu.Unlock()

	session, ok := k8sTerminalSessions[sessionID]
	if !ok {
		return nil, false
	}
	if now.After(session.ExpiresAt) {
		delete(k8sTerminalSessions, sessionID)
		return nil, false
	}
	session.Transcript = append(session.Transcript, lines...)
	session.LastActivityAt = now
	copySession := *session
	copySession.Transcript = append([]string{}, session.Transcript...)
	copySession.Subscribers = nil
	return &copySession, true
}

func addK8sTerminalSubscriber(sessionID string, managerID int) (*k8sTerminalSession, string, chan k8sTerminalStreamEvent, string) {
	now := time.Now()
	k8sTerminalSessionMu.Lock()
	defer k8sTerminalSessionMu.Unlock()

	session, ok := k8sTerminalSessions[sessionID]
	if !ok {
		return nil, "", nil, "not_found"
	}
	if now.After(session.ExpiresAt) {
		delete(k8sTerminalSessions, sessionID)
		return nil, "", nil, "expired"
	}
	if session.ManagerID != managerID {
		return nil, "", nil, "forbidden"
	}
	if session.Subscribers == nil {
		session.Subscribers = map[string]chan k8sTerminalStreamEvent{}
	}
	subscriberID := fmt.Sprintf("sub-%d", now.UnixNano())
	ch := make(chan k8sTerminalStreamEvent, 12)
	session.Subscribers[subscriberID] = ch

	copySession := *session
	copySession.Transcript = append([]string{}, session.Transcript...)
	copySession.Subscribers = nil
	return &copySession, subscriberID, ch, ""
}

func removeK8sTerminalSubscriber(sessionID, subscriberID string) {
	if sessionID == "" || subscriberID == "" {
		return
	}
	k8sTerminalSessionMu.Lock()
	defer k8sTerminalSessionMu.Unlock()

	session, ok := k8sTerminalSessions[sessionID]
	if !ok || session.Subscribers == nil {
		return
	}
	delete(session.Subscribers, subscriberID)
}

func broadcastK8sTerminalEvent(sessionID string, event k8sTerminalStreamEvent) {
	if sessionID == "" {
		return
	}

	k8sTerminalSessionMu.RLock()
	session, ok := k8sTerminalSessions[sessionID]
	if !ok || len(session.Subscribers) == 0 {
		k8sTerminalSessionMu.RUnlock()
		return
	}
	subscribers := make([]chan k8sTerminalStreamEvent, 0, len(session.Subscribers))
	for _, ch := range session.Subscribers {
		subscribers = append(subscribers, ch)
	}
	k8sTerminalSessionMu.RUnlock()

	for _, ch := range subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

func writeK8sNDJSONEvent(w http.ResponseWriter, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := w.Write(payload); err != nil {
		return err
	}
	if _, err := w.Write([]byte("\n")); err != nil {
		return err
	}
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	return nil
}

func buildK8sTerminalSessionResponse(session *k8sTerminalSession) (k8sTerminalSessionResponse, error) {
	payload, err := buildK8sDashboard(session.ProjectID, session.ClusterName, session.Namespace, session.Environment, false)
	if err != nil {
		return k8sTerminalSessionResponse{}, err
	}

	clusterItems := buildK8sClusterItems(payload)
	selectedCluster := selectK8sClusterItem(clusterItems, session.ClusterName, session.Environment)
	pod := findK8sPodInScope(payload, session.ClusterName, session.Namespace, session.PodName)
	status := session.Status
	if pod == nil && status == "attached" {
		status = "stale"
	}

	return k8sTerminalSessionResponse{
		k8sResourceMeta: buildK8sResourceMeta(payload, false),
		SessionID:       session.SessionID,
		Status:          status,
		Cluster:         selectedCluster,
		Pod:             pod,
		Container:       session.Container,
		Shell:           session.Shell,
		CommandPreview:  commandPreviewForPod(session.Namespace, session.PodName, session.Container, session.Shell),
		Reason:          session.Reason,
		CreatedAt:       session.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt:       session.ExpiresAt.UTC().Format(time.RFC3339),
		LastActivityAt:  session.LastActivityAt.UTC().Format(time.RFC3339),
		Transcript:      append([]string{}, session.Transcript...),
	}, nil
}

func simulateK8sTerminalCommandOutput(session *k8sTerminalSession, command string) []string {
	normalized := strings.TrimSpace(command)
	lower := strings.ToLower(normalized)
	workingDir := k8sTerminalWorkingDir(session.Namespace, session.PodName)

	switch {
	case lower == "pwd":
		return []string{workingDir}
	case lower == "ls" || lower == "ls -la":
		return []string{"app/  config/  logs/  tmp/  var/"}
	case lower == "env":
		return []string{
			fmt.Sprintf("POD_NAME=%s", session.PodName),
			fmt.Sprintf("POD_NAMESPACE=%s", session.Namespace),
			fmt.Sprintf("CLUSTER_NAME=%s", session.ClusterName),
			fmt.Sprintf("CONTAINER_NAME=%s", session.Container),
		}
	case lower == "whoami":
		return []string{"root"}
	case strings.Contains(lower, "kubectl"):
		return []string{"kubectl is not installed inside the pod shell. Use the K8s workspace for control-plane actions."}
	case strings.Contains(lower, "cat /var/run/secrets/kubernetes.io/serviceaccount/namespace"):
		return []string{session.Namespace}
	default:
		return []string{
			fmt.Sprintf("Recorded command for audited session %s.", session.SessionID),
			fmt.Sprintf("Simulated exec output: %s", normalized),
		}
	}
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

func k8sCertificateStatus(daysRemaining int) string {
	if daysRemaining <= 14 {
		return "expiring"
	}
	if daysRemaining <= 30 {
		return "warning"
	}
	return "healthy"
}

func k8sCertificateIssuer(cloud, environment string) string {
	if strings.EqualFold(environment, "prod") {
		return "letsencrypt-prod"
	}
	switch strings.ToLower(strings.TrimSpace(cloud)) {
	case "gcp":
		return "google-managed-cert"
	case "aws":
		return "acm-private-ca"
	case "azure":
		return "key-vault-cert-manager"
	default:
		return "internal-pki"
	}
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

func k8sVersionForCloud(cloud string) string {
	switch strings.ToLower(strings.TrimSpace(cloud)) {
	case "gcp":
		return "1.29.8-gke.1093000"
	case "aws":
		return "1.29.7-eks"
	case "azure":
		return "1.29.6-aks"
	default:
		return "1.29.6"
	}
}

func k8sLocationForCloud(cloud, environment string) string {
	env := strings.ToLower(strings.TrimSpace(environment))
	switch strings.ToLower(strings.TrimSpace(cloud)) {
	case "gcp":
		if env == "prod" {
			return "asia-south1"
		}
		return "asia-south1-b"
	case "aws":
		if env == "prod" {
			return "ap-south-1"
		}
		return "ap-south-1a"
	case "azure":
		if env == "prod" {
			return "centralindia"
		}
		return "centralindia-1"
	default:
		return "regional"
	}
}

func k8sNodePoolName(clusterName, environment string) string {
	token := k8sSafeToken(clusterName)
	env := k8sSafeToken(environment)
	return fmt.Sprintf("%s-%s-pool", token, env)
}

func buildK8sResourceMeta(payload *k8sDashboardResponse, includeConnections bool) k8sResourceMeta {
	meta := k8sResourceMeta{
		Projects:            append([]k8sProjectOption(nil), payload.Projects...),
		SelectedProjectID:   payload.SelectedProjectID,
		SelectedCluster:     payload.SelectedCluster,
		SelectedNamespace:   payload.SelectedNamespace,
		SelectedEnvironment: payload.SelectedEnvironment,
		Clusters:            append([]string(nil), payload.Clusters...),
		Namespaces:          append([]string(nil), payload.Namespaces...),
		Environments:        append([]string(nil), payload.Environments...),
	}
	if includeConnections {
		meta.Connections = append([]k8sConnectionRecord(nil), payload.Connections...)
	}
	return meta
}

func parseK8sLogTimestamp(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func sortK8sLogsDesc(items []k8sLogItem) {
	sort.Slice(items, func(i, j int) bool {
		left := parseK8sLogTimestamp(items[i].Timestamp)
		right := parseK8sLogTimestamp(items[j].Timestamp)
		if left.Equal(right) {
			if items[i].Name == items[j].Name {
				return items[i].Container < items[j].Container
			}
			return items[i].Name < items[j].Name
		}
		if left.IsZero() {
			return false
		}
		if right.IsZero() {
			return true
		}
		return left.After(right)
	})
}

func buildK8sClusterItems(payload *k8sDashboardResponse) []k8sClusterListItem {
	rows := make(map[string]*k8sClusterListItem)

	for _, connection := range payload.Connections {
		key := fmt.Sprintf("%d:%s:%s:%s", connection.ProjectID, connection.Cloud, connection.ClusterName, connection.Environment)
		rows[key] = &k8sClusterListItem{
			ProjectID:         connection.ProjectID,
			ProjectName:       connection.ProjectName,
			ProjectCode:       connection.ProjectCode,
			Cloud:             connection.Cloud,
			ClusterName:       connection.ClusterName,
			ClusterEndpoint:   connection.ClusterEndpoint,
			Environment:       connection.Environment,
			AuthMode:          connection.AuthMode,
			HasAuthCredential: connection.HasAuthCredential,
			NodePool:          k8sNodePoolName(connection.ClusterName, connection.Environment),
			NodeCount:         3 + ((connection.ProjectID + len(connection.ClusterName)) % 4),
			KubernetesVersion: k8sVersionForCloud(connection.Cloud),
			Location:          k8sLocationForCloud(connection.Cloud, connection.Environment),
			HealthStatus:      "Healthy",
			UpdatedAt:         connection.UpdatedAt,
		}
	}

	clusterKeys := func(clusterName, environment string) []string {
		out := make([]string, 0, len(rows))
		for key, row := range rows {
			if row.ClusterName != clusterName {
				continue
			}
			if environment != "" && row.Environment != environment {
				continue
			}
			out = append(out, key)
		}
		return out
	}

	for _, item := range payload.NamespaceItems {
		for _, key := range clusterKeys(item.ClusterName, item.Environment) {
			rows[key].NamespaceCount++
		}
	}
	for _, item := range payload.Deployments {
		for _, key := range clusterKeys(item.ClusterName, "") {
			row := rows[key]
			row.WorkloadCount++
			switch strings.ToLower(item.Status) {
			case "blocked":
				row.HealthStatus = "Blocked"
			case "degraded":
				if row.HealthStatus != "Blocked" {
					row.HealthStatus = "Needs attention"
				}
			}
		}
	}
	for _, item := range payload.Services {
		for _, key := range clusterKeys(item.ClusterName, "") {
			rows[key].ServiceCount++
		}
	}
	for _, item := range payload.ConfigMaps {
		for _, key := range clusterKeys(item.ClusterName, "") {
			rows[key].ConfigMapCount++
		}
	}
	for _, item := range payload.Volumes {
		for _, key := range clusterKeys(item.ClusterName, "") {
			rows[key].StorageCount++
		}
	}

	items := make([]k8sClusterListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, *row)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ProjectName != items[j].ProjectName {
			return items[i].ProjectName < items[j].ProjectName
		}
		if items[i].ClusterName != items[j].ClusterName {
			return items[i].ClusterName < items[j].ClusterName
		}
		return items[i].Environment < items[j].Environment
	})
	return items
}

func selectK8sClusterItem(items []k8sClusterListItem, clusterName, environment string) *k8sClusterListItem {
	for i := range items {
		item := items[i]
		if clusterName != "" && item.ClusterName != clusterName {
			continue
		}
		if environment != "" && item.Environment != environment {
			continue
		}
		selected := item
		return &selected
	}
	if len(items) == 0 {
		return nil
	}
	fallback := items[0]
	return &fallback
}

func buildK8sClustersResponse(projectID int, clusterName, environment string) (k8sClustersResponse, error) {
	if projectID > 0 {
		payload, err := buildK8sDashboard(projectID, clusterName, "", environment, false)
		if err != nil {
			return k8sClustersResponse{}, err
		}
		return k8sClustersResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, true),
			Items:           buildK8sClusterItems(payload),
		}, nil
	}

	projects, err := listProjectCatalogs()
	if err != nil {
		return k8sClustersResponse{}, err
	}
	connections, err := listK8sConnections()
	if err != nil {
		return k8sClustersResponse{}, err
	}

	items := make([]k8sClusterListItem, 0)
	seen := make(map[string]struct{})
	for _, project := range projects {
		payload, err := buildK8sDashboard(project.ID, clusterName, "", environment, false)
		if err != nil {
			return k8sClustersResponse{}, err
		}
		for _, item := range buildK8sClusterItems(payload) {
			key := fmt.Sprintf("%d:%s:%s:%s", item.ProjectID, item.Cloud, item.ClusterName, item.Environment)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			items = append(items, item)
		}
	}

	filteredConnections := make([]k8sConnectionRecord, 0, len(connections))
	clusterOptions := make([]string, 0, len(connections))
	environmentOptions := make([]string, 0, len(connections))
	for _, item := range connections {
		if clusterName != "" && item.ClusterName != clusterName {
			continue
		}
		if environment != "" && item.Environment != environment {
			continue
		}
		filteredConnections = append(filteredConnections, item)
		clusterOptions = append(clusterOptions, item.ClusterName)
		environmentOptions = append(environmentOptions, item.Environment)
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].ProjectName != items[j].ProjectName {
			return items[i].ProjectName < items[j].ProjectName
		}
		if items[i].ClusterName != items[j].ClusterName {
			return items[i].ClusterName < items[j].ClusterName
		}
		return items[i].Environment < items[j].Environment
	})

	return k8sClustersResponse{
		k8sResourceMeta: k8sResourceMeta{
			Projects:            buildK8sProjectOptions(projects),
			SelectedProjectID:   0,
			SelectedCluster:     clusterName,
			SelectedNamespace:   "",
			SelectedEnvironment: environment,
			Clusters:            uniqueSortedNonEmpty(clusterOptions),
			Namespaces:          []string{},
			Environments:        uniqueSortedNonEmpty(environmentOptions),
			Connections:         filteredConnections,
		},
		Items: items,
	}, nil
}

func buildK8sDashboard(projectID int, clusterName, namespaceFilter, environmentFilter string, applyDefaults bool) (*k8sDashboardResponse, error) {
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
	if applyDefaults && selectedCluster == "" && len(response.Clusters) > 0 {
		selectedCluster = response.Clusters[0]
	}
	selectedEnvironment := strings.TrimSpace(environmentFilter)
	if applyDefaults && selectedEnvironment == "" && len(response.Environments) > 0 {
		selectedEnvironment = response.Environments[0]
	}
	selectedNamespace := strings.TrimSpace(namespaceFilter)
	if applyDefaults && selectedNamespace == "" && len(response.Namespaces) > 0 {
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
	var events []k8sEventItem
	var replicaSets []k8sReplicaSetItem
	var volumes []k8sVolumeItem
	var services []k8sServiceItem
	var ingresses []k8sIngressItem
	var secrets []k8sSecretItem
	var certificates []k8sCertificateItem
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
			tlsSecretName := fmt.Sprintf("%s-tls", deploymentName)
			certificateHosts := fmt.Sprintf("%s.%s.internal.example.com", deploymentName, k8sSafeToken(selectedProject.Code))
			certDaysRemaining := 42 + ((index*9 + len(connection.ClusterName)) % 55)
			if index == 0 && strings.EqualFold(connection.Environment, "prod") {
				certDaysRemaining = 13
			} else if index == 0 {
				certDaysRemaining = 27
			}
			certificateStatus := k8sCertificateStatus(certDaysRemaining)
			certificateExpiry := now.Add(time.Duration(certDaysRemaining) * 24 * time.Hour).Format(time.RFC3339)
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
				CPUUtilization:  28 + ((index + len(connection.ClusterName)) % 47),
				CPUHours:        3 + index,
				MemoryUsageGB:   4 + ((index * 3) % 13),
				MemoryHours:     2 + ((index + 1) % 6),
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
				ExternalIP:  fmt.Sprintf("34.%d.%d.%d", 100+(index%40), 10+(index%50), 20+(index%100)),
				IngressHost: fmt.Sprintf("%s.%s.internal.example.com", deploymentName, k8sSafeToken(selectedProject.Code)),
			})
			ingresses = append(ingresses, k8sIngressItem{
				Name:              fmt.Sprintf("%s-ing", deploymentName),
				Namespace:         connection.Namespace,
				ClusterName:       connection.ClusterName,
				Host:              certificateHosts,
				Paths:             "/",
				Exposure:          "private",
				Status:            map[bool]string{true: "ready", false: "warning"}[ready == replicas],
				TLSSecret:         tlsSecretName,
				CertificateStatus: certificateStatus,
			})
			volumes = append(volumes, k8sVolumeItem{
				Name:         fmt.Sprintf("%s-data", deploymentName),
				Namespace:    connection.Namespace,
				ClusterName:  connection.ClusterName,
				Type:         "PersistentVolumeClaim",
				Claim:        fmt.Sprintf("pvc-%s", deploymentName),
				Status:       "Bound",
				MountedBy:    deploymentName,
				StorageClass: fmt.Sprintf("%s-standard", k8sSafeToken(connection.Cloud)),
				Capacity:     fmt.Sprintf("%dGi", 20+(index*10)),
				AccessMode:   "ReadWriteOnce",
			})
			secrets = append(secrets, k8sSecretItem{
				Name:        fmt.Sprintf("%s-secrets", deploymentName),
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				Type:        "Opaque",
				ManagedBy:   "portal",
				Age:         fmt.Sprintf("%dd", 7+(index*3)),
				KeyCount:    6 + (index % 4),
				BoundTo:     deploymentName,
			})
			secrets = append(secrets, k8sSecretItem{
				Name:              tlsSecretName,
				Namespace:         connection.Namespace,
				ClusterName:       connection.ClusterName,
				Type:              "kubernetes.io/tls",
				ManagedBy:         "cert-manager",
				Age:               fmt.Sprintf("%dd", 14+(index*4)),
				KeyCount:          2,
				BoundTo:           certificateHosts,
				ExpiresAt:         certificateExpiry,
				CertificateStatus: certificateStatus,
			})
			certificates = append(certificates, k8sCertificateItem{
				Name:          fmt.Sprintf("%s-cert", deploymentName),
				Namespace:     connection.Namespace,
				ClusterName:   connection.ClusterName,
				SecretName:    tlsSecretName,
				Hosts:         certificateHosts,
				Issuer:        k8sCertificateIssuer(connection.Cloud, connection.Environment),
				Status:        certificateStatus,
				ExpiresAt:     certificateExpiry,
				DaysRemaining: certDaysRemaining,
				ManagedBy:     "cert-manager",
			})
			serviceAccounts = append(serviceAccounts, k8sServiceAccountItem{
				Name:        fmt.Sprintf("%s-sa", deploymentName),
				Namespace:   connection.Namespace,
				ClusterName: connection.ClusterName,
				Automount:   true,
				TokenCount:  1,
			})
			configMaps = append(configMaps, k8sConfigMapItem{
				Name:            fmt.Sprintf("%s-config", deploymentName),
				Namespace:       connection.Namespace,
				ClusterName:     connection.ClusterName,
				DataKeys:        4 + index,
				MountedBy:       deploymentName,
				ResourceVersion: fmt.Sprintf("%d", 2000+(index*37)),
				Age:             fmt.Sprintf("%dd", 4+(index*2)),
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
			eventTime := now.Add(-time.Duration((index+1)*15) * time.Minute).Format(time.RFC3339)
			events = append(events, k8sEventItem{
				ID:            fmt.Sprintf("%s:%s:%s:rollout", connection.ClusterName, connection.Namespace, deploymentName),
				Namespace:     connection.Namespace,
				ClusterName:   connection.ClusterName,
				Severity:      map[bool]string{true: "Normal", false: "Warning"}[ready == replicas],
				Reason:        map[bool]string{true: "RolloutComplete", false: "ReadinessProbeFailed"}[ready == replicas],
				Message:       map[bool]string{true: "Deployment rollout completed and replicas are available.", false: "One or more replicas failed readiness probes during rollout."}[ready == replicas],
				ResourceKind:  "Deployment",
				ResourceName:  deploymentName,
				Timestamp:     eventTime,
				OccurrenceCnt: map[bool]int{true: 1, false: 3}[ready == replicas],
			})
			if ready != replicas {
				warningEventCount++
				events = append(events, k8sEventItem{
					ID:            fmt.Sprintf("%s:%s:%s:pod-restart", connection.ClusterName, connection.Namespace, deploymentName),
					Namespace:     connection.Namespace,
					ClusterName:   connection.ClusterName,
					Severity:      "Warning",
					Reason:        "BackOff",
					Message:       "A pod is restarting after a failed readiness or dependency check.",
					ResourceKind:  "Pod",
					ResourceName:  fmt.Sprintf("%s-2", deploymentName),
					Timestamp:     now.Add(-time.Duration((index+1)*10) * time.Minute).Format(time.RFC3339),
					OccurrenceCnt: 2,
				})
			}
		}
	}

	sort.Slice(namespaceItems, func(i, j int) bool { return namespaceItems[i].Name < namespaceItems[j].Name })
	sort.Slice(deployments, func(i, j int) bool { return deployments[i].Name < deployments[j].Name })
	sort.Slice(pods, func(i, j int) bool { return pods[i].Name < pods[j].Name })
	sort.Slice(logs, func(i, j int) bool { return logs[i].Timestamp > logs[j].Timestamp })
	sort.Slice(events, func(i, j int) bool { return events[i].Timestamp > events[j].Timestamp })
	sort.Slice(replicaSets, func(i, j int) bool { return replicaSets[i].Name < replicaSets[j].Name })
	sort.Slice(volumes, func(i, j int) bool { return volumes[i].Name < volumes[j].Name })
	sort.Slice(services, func(i, j int) bool { return services[i].Name < services[j].Name })
	sort.Slice(ingresses, func(i, j int) bool { return ingresses[i].Name < ingresses[j].Name })
	sort.Slice(secrets, func(i, j int) bool { return secrets[i].Name < secrets[j].Name })
	sort.Slice(certificates, func(i, j int) bool {
		if certificates[i].Status != certificates[j].Status {
			return certificates[i].DaysRemaining < certificates[j].DaysRemaining
		}
		return certificates[i].Name < certificates[j].Name
	})
	sort.Slice(serviceAccounts, func(i, j int) bool { return serviceAccounts[i].Name < serviceAccounts[j].Name })
	sort.Slice(configMaps, func(i, j int) bool { return configMaps[i].Name < configMaps[j].Name })

	healthSummary, namespaceHealth, workloadSpotlights := buildK8sWorkloadHealth(namespaceItems, deployments, pods, logs)

	response.Summary = k8sSummary{
		NamespaceCount:    len(namespaceItems),
		DeploymentCount:   len(deployments),
		PodCount:          len(pods),
		ServiceCount:      len(services),
		IngressCount:      len(ingresses),
		WarningEventCount: warningEventCount,
	}
	response.HealthSummary = healthSummary
	response.NamespaceItems = namespaceItems
	response.NamespaceHealth = namespaceHealth
	response.Deployments = deployments
	response.WorkloadSpotlights = workloadSpotlights
	response.Pods = pods
	response.Logs = logs
	response.Events = events
	response.ReplicaSets = replicaSets
	response.Volumes = volumes
	response.Services = services
	response.Ingresses = ingresses
	response.Secrets = secrets
	response.Certificates = certificates
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
		writeMethodNotAllowed(w, r)
	}
}

func devopsK8sQuerySelection(r *http.Request) (int, string, string, string) {
	projectID, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("project_id")))
	clusterName := strings.TrimSpace(r.URL.Query().Get("cluster_name"))
	namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))
	environment := strings.TrimSpace(r.URL.Query().Get("environment"))
	return projectID, clusterName, namespace, environment
}

func devopsK8sClustersHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, _, environment := devopsK8sQuerySelection(r)
	response, err := buildK8sClustersResponse(projectID, clusterName, environment)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data":   response,
	})
}

func devopsK8sWorkloadsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sWorkloadsResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			HealthSummary:   payload.HealthSummary,
			Items:           payload.Deployments,
		},
	})
}

func devopsK8sServicesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sServicesResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           payload.Services,
		},
	})
}

func devopsK8sConfigMapsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sConfigMapsResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           payload.ConfigMaps,
		},
	})
}

func devopsK8sStorageHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sStorageResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           payload.Volumes,
		},
	})
}

func devopsK8sPodsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sPodsResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			HealthSummary:   payload.HealthSummary,
			Items:           payload.Pods,
		},
	})
}

func devopsK8sIngressesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sIngressesResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           payload.Ingresses,
		},
	})
}

func devopsK8sSecretsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sSecretsResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           payload.Secrets,
		},
	})
}

func devopsK8sCertificatesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sCertificatesResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           payload.Certificates,
		},
	})
}

func devopsK8sIngressDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	ingressName := strings.TrimSpace(r.URL.Query().Get("ingress_name"))
	if ingressName == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "ingress_name is required", "status": "error"})
		return
	}

	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	var ingress *k8sIngressItem
	for i := range payload.Ingresses {
		item := &payload.Ingresses[i]
		if item.Name == ingressName &&
			(clusterName == "" || item.ClusterName == clusterName) &&
			(namespace == "" || item.Namespace == namespace) {
			ingress = item
			break
		}
	}
	if ingress == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeDevopsJSON(w, map[string]any{"error": "ingress not found in current cluster scope", "status": "error"})
		return
	}

	clusterItems := buildK8sClusterItems(payload)
	selectedCluster := selectK8sClusterItem(clusterItems, ingress.ClusterName, environment)

	services := make([]k8sServiceItem, 0, 4)
	for _, item := range payload.Services {
		if item.ClusterName != ingress.ClusterName || item.Namespace != ingress.Namespace {
			continue
		}
		if ingress.Host != "" && item.IngressHost != "" && (strings.Contains(ingress.Host, item.IngressHost) || strings.Contains(item.IngressHost, ingress.Host)) {
			services = append(services, item)
			continue
		}
		if item.Exposure == ingress.Exposure || strings.Contains(item.Name, k8sSafeToken(ingress.Name)) {
			services = append(services, item)
		}
	}
	if len(services) == 0 {
		for _, item := range payload.Services {
			if item.ClusterName == ingress.ClusterName && item.Namespace == ingress.Namespace {
				services = append(services, item)
				if len(services) >= 3 {
					break
				}
			}
		}
	}

	var tlsSecret *k8sSecretItem
	if ingress.TLSSecret != "" {
		for i := range payload.Secrets {
			item := &payload.Secrets[i]
			if item.ClusterName == ingress.ClusterName && item.Namespace == ingress.Namespace && item.Name == ingress.TLSSecret {
				tlsSecret = item
				break
			}
		}
	}

	certificates := make([]k8sCertificateItem, 0, 3)
	for _, item := range payload.Certificates {
		if item.ClusterName != ingress.ClusterName || item.Namespace != ingress.Namespace {
			continue
		}
		if ingress.TLSSecret != "" && item.SecretName == ingress.TLSSecret {
			certificates = append(certificates, item)
			continue
		}
		if ingress.Host != "" && strings.Contains(strings.ToLower(item.Hosts), strings.ToLower(ingress.Host)) {
			certificates = append(certificates, item)
		}
	}

	paths := make([]string, 0, 2)
	for _, part := range strings.Split(ingress.Paths, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			paths = append(paths, trimmed)
		}
	}
	if len(paths) == 0 {
		paths = []string{"/"}
	}

	routes := make([]k8sIngressRouteItem, 0, len(paths))
	for index, pathItem := range paths {
		serviceName := "unmapped"
		serviceType := "unknown"
		targetAddress := "No backend address recorded"
		if len(services) > 0 {
			selectedService := services[index%len(services)]
			serviceName = selectedService.Name
			serviceType = selectedService.Type
			targetAddress = selectedService.ExternalIP
			if targetAddress == "" {
				targetAddress = selectedService.ClusterIP
			}
			if targetAddress == "" {
				targetAddress = "Service has no address yet"
			}
		}
		routes = append(routes, k8sIngressRouteItem{
			Host:              ingress.Host,
			Path:              pathItem,
			ServiceName:       serviceName,
			ServiceType:       serviceType,
			TargetAddress:     targetAddress,
			Exposure:          ingress.Exposure,
			TLSSecret:         ingress.TLSSecret,
			CertificateStatus: ingress.CertificateStatus,
		})
	}

	recentEvents := make([]k8sEventItem, 0, 6)
	for _, item := range payload.Events {
		if item.ClusterName != ingress.ClusterName || item.Namespace != ingress.Namespace {
			continue
		}
		if strings.EqualFold(item.ResourceKind, "Ingress") || item.ResourceName == ingress.Name {
			recentEvents = append(recentEvents, item)
		}
		if len(recentEvents) >= 6 {
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sIngressDetailResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Cluster:         selectedCluster,
			Ingress:         ingress,
			Routes:          routes,
			Services:        services,
			Secret:          tlsSecret,
			Certificates:    certificates,
			RecentEvents:    recentEvents,
		},
	})
}

func devopsK8sPodDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	podName := strings.TrimSpace(r.URL.Query().Get("pod_name"))
	if podName == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "pod_name is required", "status": "error"})
		return
	}

	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	var pod *k8sPodItem
	for i := range payload.Pods {
		item := &payload.Pods[i]
		if item.Name == podName &&
			(clusterName == "" || item.ClusterName == clusterName) &&
			(namespace == "" || item.Namespace == namespace) {
			pod = item
			break
		}
	}
	if pod == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeDevopsJSON(w, map[string]any{"error": "pod not found in current cluster scope", "status": "error"})
		return
	}

	var deployment *k8sDeploymentItem
	if pod.Deployment != "" {
		for i := range payload.Deployments {
			item := &payload.Deployments[i]
			if item.Name == pod.Deployment && item.ClusterName == pod.ClusterName && item.Namespace == pod.Namespace {
				deployment = item
				break
			}
		}
	}

	siblingPods := make([]k8sPodItem, 0, 3)
	for _, item := range payload.Pods {
		if item.ClusterName == pod.ClusterName && item.Namespace == pod.Namespace && item.Deployment == pod.Deployment {
			siblingPods = append(siblingPods, item)
		}
		if len(siblingPods) >= 6 {
			break
		}
	}

	relatedServices := make([]k8sServiceItem, 0, 3)
	for _, item := range payload.Services {
		if item.ClusterName == pod.ClusterName &&
			item.Namespace == pod.Namespace &&
			(strings.Contains(item.Selector, pod.Deployment) || strings.Contains(item.Name, pod.Deployment)) {
			relatedServices = append(relatedServices, item)
		}
	}

	recentLogs := make([]k8sLogItem, 0, 8)
	for _, item := range payload.Logs {
		if item.ClusterName == pod.ClusterName &&
			item.Namespace == pod.Namespace &&
			(item.Name == pod.Deployment || item.Name == pod.Name) {
			recentLogs = append(recentLogs, item)
		}
		if len(recentLogs) >= 8 {
			break
		}
	}

	recentEvents := make([]k8sEventItem, 0, 8)
	for _, item := range payload.Events {
		if item.ClusterName == pod.ClusterName &&
			item.Namespace == pod.Namespace &&
			(item.ResourceName == pod.Name || item.ResourceName == pod.Deployment) {
			recentEvents = append(recentEvents, item)
		}
		if len(recentEvents) >= 8 {
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sPodDetailResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Pod:             pod,
			Deployment:      deployment,
			SiblingPods:     siblingPods,
			Services:        relatedServices,
			RecentLogs:      recentLogs,
			RecentEvents:    recentEvents,
		},
	})
}

func devopsK8sActivityHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	workloadName := strings.TrimSpace(r.URL.Query().Get("workload_name"))
	podName := strings.TrimSpace(r.URL.Query().Get("pod_name"))
	limit := 12
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil && parsed > 0 && parsed <= 50 {
			limit = parsed
		}
	}

	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "ok",
			"data": k8sActivityResponse{
				k8sResourceMeta: buildK8sResourceMeta(payload, false),
				Items:           []k8sOperatorActivityItem{},
			},
		})
		return
	}

	queryLimit := limit * 5
	if queryLimit < 100 {
		queryLimit = 100
	}
	if queryLimit > 500 {
		queryLimit = 500
	}

	rows, err := DB.Query(`
		SELECT a.id,
		       COALESCE(u.username, ''),
		       a.action,
		       a.resource_type,
		       COALESCE(a.resource_id, ''),
		       COALESCE(a.details, ''),
		       a.created_at
		  FROM admin_audit_log a
		  LEFT JOIN users u ON u.id = a.admin_user_id
		 WHERE a.action LIKE 'k8s_%'
		 ORDER BY a.created_at DESC
		 LIMIT $1
	`, queryLimit)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "failed to load K8s activity", "status": "error"})
		return
	}
	defer rows.Close()

	items := make([]k8sOperatorActivityItem, 0, limit)
	for rows.Next() {
		var (
			entryID      int
			actorName    string
			action       string
			resourceType string
			resourceID   string
			details      string
			createdAt    time.Time
		)
		if err := rows.Scan(&entryID, &actorName, &action, &resourceType, &resourceID, &details, &createdAt); err != nil {
			continue
		}

		fields := parseK8sAuditDetails(details)
		scopedCluster, scopedNamespace, resourceName := parseK8sScopedResource(resourceType, resourceID)
		if scopedCluster == "" {
			scopedCluster = strings.TrimSpace(fields["cluster"])
		}
		if scopedNamespace == "" {
			scopedNamespace = strings.TrimSpace(fields["namespace"])
		}
		if resourceName == "" {
			switch resourceType {
			case "k8s_pod":
				resourceName = strings.TrimSpace(fields["pod"])
			case "k8s_workload":
				resourceName = strings.TrimSpace(fields["workload"])
			case "project":
				resourceName = strings.TrimSpace(fields["cluster"])
			}
		}
		if resourceName == "" {
			resourceName = resourceID
		}

		entryProjectID := 0
		if rawProjectID := strings.TrimSpace(fields["project_id"]); rawProjectID != "" {
			if parsed, err := strconv.Atoi(rawProjectID); err == nil {
				entryProjectID = parsed
			}
		}
		if entryProjectID == 0 && resourceType == "project" {
			if parsed, err := strconv.Atoi(strings.TrimSpace(resourceID)); err == nil {
				entryProjectID = parsed
			}
		}

		if projectID > 0 && entryProjectID > 0 && entryProjectID != projectID {
			continue
		}
		if clusterName != "" && !strings.EqualFold(scopedCluster, clusterName) {
			continue
		}
		if namespace != "" && !strings.EqualFold(scopedNamespace, namespace) {
			continue
		}
		if environment != "" && !strings.EqualFold(strings.TrimSpace(fields["environment"]), environment) {
			continue
		}
		if workloadName != "" || podName != "" {
			switch resourceType {
			case "k8s_workload":
				if workloadName == "" || !strings.EqualFold(resourceName, workloadName) {
					continue
				}
			case "k8s_pod":
				if podName != "" && strings.EqualFold(resourceName, podName) {
					// keep the pod-specific action
				} else if workloadName != "" && strings.EqualFold(strings.TrimSpace(fields["workload"]), workloadName) {
					// keep the pod action if it explicitly references the workload
				} else if podName != "" || workloadName != "" {
					continue
				}
			}
		}

		if actorName == "" {
			actorName = "DevOps manager"
		}
		items = append(items, k8sOperatorActivityItem{
			ID:           fmt.Sprintf("k8s-activity-%d", entryID),
			Action:       action,
			ActorName:    actorName,
			ResourceType: resourceType,
			ResourceName: resourceName,
			ClusterName:  scopedCluster,
			Namespace:    scopedNamespace,
			Environment:  strings.TrimSpace(fields["environment"]),
			ProjectID:    entryProjectID,
			Summary:      humanizeK8sAction(action, resourceName, fields),
			Detail:       buildK8sActivityDetail(action, fields),
			Timestamp:    createdAt.UTC().Format(time.RFC3339),
		})
		if len(items) >= limit {
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sActivityResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           items,
		},
	})
}

func devopsK8sPodExecProfileHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	podName := strings.TrimSpace(r.URL.Query().Get("pod_name"))
	if podName == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "pod_name is required", "status": "error"})
		return
	}

	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	var pod *k8sPodItem
	for i := range payload.Pods {
		item := &payload.Pods[i]
		if item.Name == podName &&
			(clusterName == "" || item.ClusterName == clusterName) &&
			(namespace == "" || item.Namespace == namespace) {
			pod = item
			break
		}
	}
	if pod == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeDevopsJSON(w, map[string]any{"error": "pod not found in current cluster scope", "status": "error"})
		return
	}

	clusterItems := buildK8sClusterItems(payload)
	selectedCluster := selectK8sClusterItem(clusterItems, pod.ClusterName, environment)

	containers := make([]string, 0, 3)
	seenContainers := map[string]bool{}
	for _, item := range payload.Logs {
		if item.ClusterName != pod.ClusterName || item.Namespace != pod.Namespace {
			continue
		}
		if item.Name != pod.Name && item.Name != pod.Deployment {
			continue
		}
		container := strings.TrimSpace(item.Container)
		if container == "" || seenContainers[container] {
			continue
		}
		seenContainers[container] = true
		containers = append(containers, container)
	}
	if len(containers) == 0 {
		containers = append(containers, "main")
	}

	recentLogs := make([]k8sLogItem, 0, 8)
	for _, item := range payload.Logs {
		if item.ClusterName == pod.ClusterName &&
			item.Namespace == pod.Namespace &&
			(item.Name == pod.Name || item.Name == pod.Deployment) {
			recentLogs = append(recentLogs, item)
		}
		if len(recentLogs) >= 8 {
			break
		}
	}

	recentEvents := make([]k8sEventItem, 0, 8)
	for _, item := range payload.Events {
		if item.ClusterName == pod.ClusterName &&
			item.Namespace == pod.Namespace &&
			(item.ResourceName == pod.Name || item.ResourceName == pod.Deployment) {
			recentEvents = append(recentEvents, item)
		}
		if len(recentEvents) >= 8 {
			break
		}
	}

	defaultShell := "/bin/sh"
	commandPreview := fmt.Sprintf("kubectl exec -it -n %s %s -- %s", pod.Namespace, pod.Name, defaultShell)
	if len(containers) > 0 {
		commandPreview = fmt.Sprintf("kubectl exec -it -n %s %s -c %s -- %s", pod.Namespace, pod.Name, containers[0], defaultShell)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sPodExecProfileResponse{
			k8sResourceMeta:     buildK8sResourceMeta(payload, false),
			Cluster:             selectedCluster,
			Pod:                 pod,
			AvailableContainers: containers,
			AllowedShells:       []string{"/bin/sh", "/bin/bash"},
			DefaultShell:        defaultShell,
			CommandPreview:      commandPreview,
			AccessModel:         "Live terminal sessions stay manager-gated and audited before we open a real interactive exec channel.",
			AuditHint:           "Use this page to confirm the exact pod, container, and shell before enabling live exec in the next phase.",
			RecentLogs:          recentLogs,
			RecentEvents:        recentEvents,
		},
	})
}

func buildK8sLogStreamResponse(payload *k8sDashboardResponse, cursor, workloadName, podName, containerName, level string) (k8sLogStreamResponse, error) {
	var cursorTime time.Time
	if cursor != "" {
		cursorTime = parseK8sLogTimestamp(cursor)
		if cursorTime.IsZero() {
			return k8sLogStreamResponse{}, fmt.Errorf("cursor must be an RFC3339 timestamp")
		}
	}

	filtered := make([]k8sLogItem, 0, len(payload.Logs))
	nextCursor := cursor
	for _, item := range payload.Logs {
		if workloadName != "" && item.Name != workloadName {
			continue
		}
		if podName != "" && item.Name != podName {
			continue
		}
		if containerName != "" && item.Container != containerName {
			continue
		}
		if level != "" && strings.ToLower(item.Level) != level {
			continue
		}
		itemTime := parseK8sLogTimestamp(item.Timestamp)
		if cursorTime.IsZero() || itemTime.After(cursorTime) {
			filtered = append(filtered, item)
		}
		if itemTime.IsZero() {
			continue
		}
		if nextCursor == "" || itemTime.After(parseK8sLogTimestamp(nextCursor)) {
			nextCursor = item.Timestamp
		}
	}

	sortK8sLogsDesc(filtered)

	streamStatus := "snapshot"
	if cursor != "" {
		streamStatus = "live"
	}

	return k8sLogStreamResponse{
		k8sResourceMeta:     buildK8sResourceMeta(payload, false),
		Items:               filtered,
		NextCursor:          nextCursor,
		StreamStatus:        streamStatus,
		LiveIntervalSeconds: 5,
		AppendedCount:       len(filtered),
	}, nil
}

func devopsK8sLogsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sLogsResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           payload.Logs,
		},
	})
}

func devopsK8sLogStreamHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	workloadName := strings.TrimSpace(r.URL.Query().Get("workload_name"))
	podName := strings.TrimSpace(r.URL.Query().Get("pod_name"))
	containerName := strings.TrimSpace(r.URL.Query().Get("container"))
	level := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("level")))

	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	response, err := buildK8sLogStreamResponse(payload, cursor, workloadName, podName, containerName, level)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data":   response,
	})
}

func devopsK8sLogAttachHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, r, http.StatusInternalServerError, "streaming is not supported", nil)
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	workloadName := strings.TrimSpace(r.URL.Query().Get("workload_name"))
	podName := strings.TrimSpace(r.URL.Query().Get("pod_name"))
	containerName := strings.TrimSpace(r.URL.Query().Get("container"))
	level := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("level")))

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Connection", "keep-alive")

	writeSnapshot := func(eventType string, cursor string) (string, error) {
		payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
		if err != nil {
			return cursor, err
		}
		response, err := buildK8sLogStreamResponse(payload, cursor, workloadName, podName, containerName, level)
		if err != nil {
			return cursor, err
		}
		if err := writeK8sNDJSONEvent(w, k8sLogAttachEvent{
			Type:      eventType,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Data:      &response,
		}); err != nil {
			return cursor, err
		}
		flusher.Flush()
		return response.NextCursor, nil
	}

	cursor, err := writeSnapshot("snapshot", "")
	if err != nil {
		return
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			nextCursor, err := writeSnapshot("delta", cursor)
			if err != nil {
				return
			}
			cursor = nextCursor
		}
	}
}

func devopsK8sEventsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sEventsResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Items:           payload.Events,
		},
	})
}

func devopsK8sTerminalLaunchHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}

	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}

	var input k8sTerminalLaunchInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "invalid json", "status": "error"})
		return
	}

	input.ClusterName = strings.TrimSpace(input.ClusterName)
	input.Namespace = strings.TrimSpace(input.Namespace)
	input.Environment = strings.ToLower(strings.TrimSpace(input.Environment))
	input.PodName = strings.TrimSpace(input.PodName)
	input.Container = strings.TrimSpace(input.Container)
	input.Shell = strings.TrimSpace(input.Shell)
	input.Reason = strings.Join(strings.Fields(strings.TrimSpace(input.Reason)), " ")

	if input.ProjectID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "project is required", "status": "error"})
		return
	}
	if input.ClusterName == "" || input.Namespace == "" || input.PodName == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "cluster, namespace, and pod are required", "status": "error"})
		return
	}
	if input.Reason == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "reason is required for audited terminal access", "status": "error"})
		return
	}

	payload, err := buildK8sDashboard(input.ProjectID, input.ClusterName, input.Namespace, input.Environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	var pod *k8sPodItem
	for i := range payload.Pods {
		item := &payload.Pods[i]
		if item.Name == input.PodName && item.ClusterName == input.ClusterName && item.Namespace == input.Namespace {
			pod = item
			break
		}
	}
	if pod == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeDevopsJSON(w, map[string]any{"error": "pod not found in current cluster scope", "status": "error"})
		return
	}

	containers := make([]string, 0, 3)
	seenContainers := map[string]bool{}
	for _, item := range payload.Logs {
		if item.ClusterName != pod.ClusterName || item.Namespace != pod.Namespace {
			continue
		}
		if item.Name != pod.Name && item.Name != pod.Deployment {
			continue
		}
		container := strings.TrimSpace(item.Container)
		if container == "" || seenContainers[container] {
			continue
		}
		seenContainers[container] = true
		containers = append(containers, container)
	}
	if len(containers) == 0 {
		containers = append(containers, "main")
	}

	selectedContainer := containers[0]
	if input.Container != "" {
		validContainer := false
		for _, item := range containers {
			if item == input.Container {
				validContainer = true
				selectedContainer = input.Container
				break
			}
		}
		if !validContainer {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]any{"error": "selected container is not available for this pod", "status": "error"})
			return
		}
	}

	allowedShells := map[string]bool{"/bin/sh": true, "/bin/bash": true}
	selectedShell := "/bin/sh"
	if input.Shell != "" {
		if !allowedShells[input.Shell] {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			encodeDevopsJSON(w, map[string]any{"error": "unsupported shell for audited terminal launch", "status": "error"})
			return
		}
		selectedShell = input.Shell
	}

	commandPreview := commandPreviewForPod(pod.Namespace, pod.Name, selectedContainer, selectedShell)

	clusterItems := buildK8sClusterItems(payload)
	selectedCluster := selectK8sClusterItem(clusterItems, pod.ClusterName, input.Environment)
	createdAt := time.Now().UTC()
	sessionID := fmt.Sprintf("term-%d-%d", managerID, createdAt.Unix())
	expiresAt := createdAt.Add(10 * time.Minute)
	initialOutput := []string{
		fmt.Sprintf("Session %s attached to %s/%s.", sessionID, pod.Namespace, pod.Name),
		fmt.Sprintf("Container: %s", selectedContainer),
		fmt.Sprintf("Shell: %s", selectedShell),
		fmt.Sprintf("Reason: %s", input.Reason),
		fmt.Sprintf("Working directory: %s", k8sTerminalWorkingDir(pod.Namespace, pod.Name)),
		"Audit logging enabled for this session.",
		"Use the attached session console to send commands and watch transcript updates.",
	}

	upsertK8sTerminalSession(&k8sTerminalSession{
		SessionID:      sessionID,
		ManagerID:      managerID,
		ProjectID:      input.ProjectID,
		ClusterName:    pod.ClusterName,
		Namespace:      pod.Namespace,
		Environment:    input.Environment,
		PodName:        pod.Name,
		Container:      selectedContainer,
		Shell:          selectedShell,
		Reason:         input.Reason,
		Status:         "attached",
		CreatedAt:      createdAt,
		ExpiresAt:      expiresAt,
		LastActivityAt: createdAt,
		Transcript:     initialOutput,
	})

	details := []string{
		fmt.Sprintf("project_id=%d", input.ProjectID),
		fmt.Sprintf("cluster=%s", pod.ClusterName),
		fmt.Sprintf("namespace=%s", pod.Namespace),
		fmt.Sprintf("pod=%s", pod.Name),
		fmt.Sprintf("container=%s", selectedContainer),
		fmt.Sprintf("shell=%s", selectedShell),
		fmt.Sprintf("session=%s", sessionID),
		fmt.Sprintf("reason=%s", input.Reason),
	}
	if input.Environment != "" {
		details = append(details, fmt.Sprintf("environment=%s", input.Environment))
	}
	AppendAuditLog(&managerID, "k8s_pod_terminal_launch", "k8s_pod", fmt.Sprintf("%s:%s:%s", pod.ClusterName, pod.Namespace, pod.Name), strings.Join(details, ","))

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sTerminalLaunchResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			SessionID:       sessionID,
			Status:          "ready",
			Cluster:         selectedCluster,
			Pod:             pod,
			Container:       selectedContainer,
			Shell:           selectedShell,
			CommandPreview:  commandPreview,
			Reason:          input.Reason,
			CreatedAt:       createdAt.Format(time.RFC3339),
			ExpiresAt:       expiresAt.Format(time.RFC3339),
			LastActivityAt:  createdAt.Format(time.RFC3339),
			AccessModel:     "Live exec launch is manager-gated, session-scoped, and recorded through the audit trail.",
			AuditHint:       "Use the generated session and command preview together so responders can prove who opened the shell, when, and why.",
			InitialOutput:   initialOutput,
		},
	})
}

func devopsK8sTerminalSessionHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}

	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}

	sessionID := strings.TrimSpace(r.URL.Query().Get("session_id"))
	if sessionID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "session_id is required", "status": "error"})
		return
	}

	session, found := getK8sTerminalSession(sessionID)
	if !found {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		encodeDevopsJSON(w, map[string]any{"error": "terminal session expired or not found", "status": "error"})
		return
	}
	if session.ManagerID != managerID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeDevopsJSON(w, map[string]any{"error": "terminal session is not available for this user", "status": "error"})
		return
	}

	response, err := buildK8sTerminalSessionResponse(session)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "data": response})
}

func devopsK8sTerminalAttachHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}

	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, r, http.StatusInternalServerError, "streaming is not supported", nil)
		return
	}

	sessionID := strings.TrimSpace(r.URL.Query().Get("session_id"))
	if sessionID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "session_id is required", "status": "error"})
		return
	}

	session, subscriberID, events, status := addK8sTerminalSubscriber(sessionID, managerID)
	switch status {
	case "not_found", "expired":
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		encodeDevopsJSON(w, map[string]any{"error": "terminal session expired or not found", "status": "error"})
		return
	case "forbidden":
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeDevopsJSON(w, map[string]any{"error": "terminal session is not available for this user", "status": "error"})
		return
	}
	defer removeK8sTerminalSubscriber(sessionID, subscriberID)

	response, err := buildK8sTerminalSessionResponse(session)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Connection", "keep-alive")

	if err := writeK8sNDJSONEvent(w, k8sTerminalStreamEvent{
		Type:      "snapshot",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data:      &response,
	}); err != nil {
		return
	}
	flusher.Flush()

	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-events:
			if err := writeK8sNDJSONEvent(w, event); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			current, found := getK8sTerminalSession(sessionID)
			if !found {
				_ = writeK8sNDJSONEvent(w, k8sTerminalStreamEvent{
					Type:      "closed",
					Timestamp: time.Now().UTC().Format(time.RFC3339),
					Message:   "Terminal session expired",
				})
				flusher.Flush()
				return
			}
			snapshot, err := buildK8sTerminalSessionResponse(current)
			if err != nil {
				return
			}
			if err := writeK8sNDJSONEvent(w, k8sTerminalStreamEvent{
				Type:      "heartbeat",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Data:      &snapshot,
			}); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func devopsK8sTerminalCommandHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}

	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}

	var input k8sTerminalCommandInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "invalid json", "status": "error"})
		return
	}
	input.SessionID = strings.TrimSpace(input.SessionID)
	input.Command = strings.TrimSpace(input.Command)

	if input.SessionID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "session_id is required", "status": "error"})
		return
	}
	if input.Command == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "command is required", "status": "error"})
		return
	}

	session, found := getK8sTerminalSession(input.SessionID)
	if !found {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		encodeDevopsJSON(w, map[string]any{"error": "terminal session expired or not found", "status": "error"})
		return
	}
	if session.ManagerID != managerID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		encodeDevopsJSON(w, map[string]any{"error": "terminal session is not available for this user", "status": "error"})
		return
	}

	transcriptLines := []string{fmt.Sprintf("$ %s", input.Command)}
	transcriptLines = append(transcriptLines, simulateK8sTerminalCommandOutput(session, input.Command)...)
	session, found = appendK8sTerminalTranscript(input.SessionID, transcriptLines...)
	if !found {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		encodeDevopsJSON(w, map[string]any{"error": "terminal session expired or not found", "status": "error"})
		return
	}

	commandForAudit := input.Command
	if len(commandForAudit) > 120 {
		commandForAudit = commandForAudit[:117] + "..."
	}
	AppendAuditLog(&managerID, "k8s_pod_terminal_command", "k8s_pod", fmt.Sprintf("%s:%s:%s", session.ClusterName, session.Namespace, session.PodName), strings.Join([]string{
		fmt.Sprintf("session=%s", session.SessionID),
		fmt.Sprintf("container=%s", session.Container),
		fmt.Sprintf("shell=%s", session.Shell),
		fmt.Sprintf("command=%s", commandForAudit),
	}, ","))

	response, err := buildK8sTerminalSessionResponse(session)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	broadcastK8sTerminalEvent(session.SessionID, k8sTerminalStreamEvent{
		Type:      "snapshot",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data:      &response,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "data": response})
}

func devopsK8sWorkloadActionsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}

	managerID, ok := requireDevopsManager(w, r)
	if !ok {
		return
	}

	var input k8sWorkloadActionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "invalid json", "status": "error"})
		return
	}

	input.ClusterName = strings.TrimSpace(input.ClusterName)
	input.Namespace = strings.TrimSpace(input.Namespace)
	input.Environment = strings.ToLower(strings.TrimSpace(input.Environment))
	input.WorkloadName = strings.TrimSpace(input.WorkloadName)
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	input.Reason = strings.TrimSpace(input.Reason)

	if input.ProjectID <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "project is required", "status": "error"})
		return
	}
	if input.ClusterName == "" || input.Namespace == "" || input.WorkloadName == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "cluster, namespace, and workload are required", "status": "error"})
		return
	}
	if input.Action != "restart" && input.Action != "scale" && input.Action != "resume" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "unsupported workload action", "status": "error"})
		return
	}
	if input.Action == "scale" && input.Replicas < 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "replicas must be zero or greater", "status": "error"})
		return
	}

	payload, err := buildK8sDashboard(input.ProjectID, input.ClusterName, input.Namespace, input.Environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	var workload k8sDeploymentItem
	foundWorkload := false
	for i := range payload.Deployments {
		item := payload.Deployments[i]
		if item.ClusterName == input.ClusterName && item.Namespace == input.Namespace && item.Name == input.WorkloadName {
			workload = item
			foundWorkload = true
			break
		}
	}
	if !foundWorkload {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeDevopsJSON(w, map[string]any{"error": "workload not found in current cluster scope", "status": "error"})
		return
	}

	resourceID := fmt.Sprintf("%s:%s:%s", workload.ClusterName, workload.Namespace, workload.Name)
	details := []string{
		fmt.Sprintf("project_id=%d", input.ProjectID),
		fmt.Sprintf("cluster=%s", workload.ClusterName),
		fmt.Sprintf("namespace=%s", workload.Namespace),
		fmt.Sprintf("workload=%s", workload.Name),
	}
	if input.Environment != "" {
		details = append(details, fmt.Sprintf("environment=%s", input.Environment))
	}
	if input.Reason != "" {
		details = append(details, fmt.Sprintf("reason=%s", input.Reason))
	}

	message := ""
	switch input.Action {
	case "restart":
		AppendAuditLog(&managerID, "k8s_workload_restart", "k8s_workload", resourceID, strings.Join(details, ","))
		message = fmt.Sprintf("Restart request queued for %s in %s.", workload.Name, workload.Namespace)
	case "scale":
		details = append(details, fmt.Sprintf("replicas=%d", input.Replicas))
		AppendAuditLog(&managerID, "k8s_workload_scale", "k8s_workload", resourceID, strings.Join(details, ","))
		message = fmt.Sprintf("Scale request queued for %s to %d replicas.", workload.Name, input.Replicas)
	case "resume":
		AppendAuditLog(&managerID, "k8s_workload_resume_rollout", "k8s_workload", resourceID, strings.Join(details, ","))
		message = fmt.Sprintf("Rollout resume queued for %s in %s.", workload.Name, workload.Namespace)
	}

	w.Header().Set("Content-Type", "application/json")
	encodeDevopsJSON(w, map[string]any{
		"status":  "ok",
		"message": message,
		"action":  input.Action,
	})
}

func devopsK8sRolloutDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	workloadName := strings.TrimSpace(r.URL.Query().Get("workload_name"))
	if workloadName == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		encodeDevopsJSON(w, map[string]any{"error": "workload_name is required", "status": "error"})
		return
	}

	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsJSON(w, map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	var workload *k8sDeploymentItem
	for i := range payload.Deployments {
		item := &payload.Deployments[i]
		if item.Name == workloadName &&
			(clusterName == "" || item.ClusterName == clusterName) &&
			(namespace == "" || item.Namespace == namespace) {
			workload = item
			break
		}
	}
	if workload == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		encodeDevopsJSON(w, map[string]any{"error": "workload not found in current cluster scope", "status": "error"})
		return
	}

	clusterItems := buildK8sClusterItems(payload)
	selectedCluster := selectK8sClusterItem(clusterItems, workload.ClusterName, environment)

	replicaSets := make([]k8sReplicaSetItem, 0, 4)
	for _, item := range payload.ReplicaSets {
		if item.ClusterName == workload.ClusterName && item.Namespace == workload.Namespace && item.Deployment == workload.Name {
			replicaSets = append(replicaSets, item)
		}
	}

	pods := make([]k8sPodItem, 0, 8)
	for _, item := range payload.Pods {
		if item.ClusterName == workload.ClusterName && item.Namespace == workload.Namespace && item.Deployment == workload.Name {
			pods = append(pods, item)
		}
	}

	services := make([]k8sServiceItem, 0, 3)
	for _, item := range payload.Services {
		if item.ClusterName == workload.ClusterName && item.Namespace == workload.Namespace &&
			(strings.Contains(item.Selector, workload.Name) || strings.Contains(item.Name, workload.Name)) {
			services = append(services, item)
		}
	}

	recentLogs := make([]k8sLogItem, 0, 8)
	for _, item := range payload.Logs {
		if item.ClusterName == workload.ClusterName && item.Namespace == workload.Namespace && item.Name == workload.Name {
			recentLogs = append(recentLogs, item)
		}
		if len(recentLogs) >= 8 {
			break
		}
	}

	recentEvents := make([]k8sEventItem, 0, 8)
	for _, item := range payload.Events {
		if item.ClusterName == workload.ClusterName && item.Namespace == workload.Namespace &&
			(item.ResourceName == workload.Name || strings.Contains(item.ResourceName, workload.Name)) {
			recentEvents = append(recentEvents, item)
		}
		if len(recentEvents) >= 8 {
			break
		}
	}

	timeline := []k8sRolloutStep{
		{
			Title:     "Rollout state evaluated",
			Detail:    fmt.Sprintf("%d of %d replicas are ready for %s.", workload.ReadyReplicas, workload.Replicas, workload.Name),
			Status:    strings.ToLower(workload.Status),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		},
	}
	for _, item := range replicaSets {
		timeline = append(timeline, k8sRolloutStep{
			Title:     fmt.Sprintf("ReplicaSet %s", item.Name),
			Detail:    fmt.Sprintf("%d/%d ready replicas in %s.", item.ReadyReplicas, item.DesiredReplicas, item.Namespace),
			Status:    map[bool]string{true: "healthy", false: "warning"}[item.ReadyReplicas == item.DesiredReplicas],
			Timestamp: time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339),
		})
		if len(timeline) >= 4 {
			break
		}
	}
	for _, item := range recentEvents {
		timeline = append(timeline, k8sRolloutStep{
			Title:     item.Reason,
			Detail:    item.Message,
			Status:    strings.ToLower(item.Severity),
			Timestamp: item.Timestamp,
		})
		if len(timeline) >= 8 {
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sRolloutDetailResponse{
			k8sResourceMeta: buildK8sResourceMeta(payload, false),
			Cluster:         selectedCluster,
			Workload:        workload,
			ReplicaSets:     replicaSets,
			Pods:            pods,
			Services:        services,
			RecentLogs:      recentLogs,
			RecentEvents:    recentEvents,
			Timeline:        timeline,
		},
	})
}

func devopsK8sClusterDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, false)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "status": "error"})
		return
	}

	clusterItems := buildK8sClusterItems(payload)
	var selectedCluster *k8sClusterListItem
	for i := range clusterItems {
		item := clusterItems[i]
		if clusterName != "" && item.ClusterName != clusterName {
			continue
		}
		if environment != "" && item.Environment != environment {
			continue
		}
		selectedCluster = &item
		break
	}
	if selectedCluster == nil && len(clusterItems) > 0 {
		item := clusterItems[0]
		selectedCluster = &item
	}
	if selectedCluster == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "cluster not found", "status": "error"})
		return
	}

	recentLogs := payload.Logs
	if len(recentLogs) > 6 {
		recentLogs = recentLogs[:6]
	}
	recentEvents := payload.Events
	if len(recentEvents) > 8 {
		recentEvents = recentEvents[:8]
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data": k8sClusterDetailResponse{
			k8sResourceMeta:    buildK8sResourceMeta(payload, true),
			Cluster:            selectedCluster,
			Summary:            payload.Summary,
			HealthSummary:      payload.HealthSummary,
			NamespaceItems:     payload.NamespaceItems,
			NamespaceHealth:    payload.NamespaceHealth,
			WorkloadSpotlights: payload.WorkloadSpotlights,
			RecentLogs:         recentLogs,
			Events:             recentEvents,
		},
	})
}

func devopsK8sOverviewHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}

	projectID, clusterName, namespace, environment := devopsK8sQuerySelection(r)
	payload, err := buildK8sDashboard(projectID, clusterName, namespace, environment, true)
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
