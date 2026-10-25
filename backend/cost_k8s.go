package main

import (
	"fmt"
	"strings"
	"time"
)

const costK8sLeastPrivilegeYAML = `# OpsTrellis Cost collector — least-privilege, read-only.
# Apply this through the existing cluster administration workflow.
# This product does not install OpenCost and does not edit workloads.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: opstrellis-cost-readonly
rules:
  - apiGroups: [""]
    resources: ["nodes", "pods", "namespaces", "persistentvolumeclaims", "persistentvolumes", "services", "events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets", "daemonsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["autoscaling.k8s.io"]
    resources: ["verticalpodautoscalers"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["policy"]
    resources: ["poddisruptionbudgets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["storage.k8s.io"]
    resources: ["storageclasses"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: opstrellis-cost-readonly
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: opstrellis-cost-readonly
subjects:
  - kind: ServiceAccount
    name: opstrellis-cost
    namespace: opstrellis-cost
`

type costK8sBinding struct {
	ID                  int        `json:"id"`
	K8sConnectionID     int        `json:"k8s_connection_id"`
	CostConnectionID    int        `json:"cost_connection_id,omitempty"`
	ClusterUID          string     `json:"cluster_uid,omitempty"`
	ClusterName         string     `json:"cluster_name"`
	Environment         string     `json:"environment"`
	Cloud               string     `json:"cloud"`
	AuthMode            string     `json:"auth_mode"`
	ProjectID           int        `json:"project_id"`
	ProjectName         string     `json:"project_name,omitempty"`
	ProjectCode         string     `json:"project_code,omitempty"`
	Status              string     `json:"status"`
	InventoryReadiness  string     `json:"inventory_readiness"`
	MetricsReadiness    string     `json:"metrics_readiness"`
	AllocationReadiness string     `json:"allocation_readiness"`
	BillingReconciled   string     `json:"billing_reconciled"`
	CollectorHealth     string     `json:"collector_health"`
	CollectorInstall    string     `json:"collector_install"`
	WorkerCanEdit       bool       `json:"worker_can_edit"`
	InstallsOpenCost    bool       `json:"installs_opencost"`
	AddedToCloudTotal   bool       `json:"added_to_cloud_total"`
	HasCollectorToken   bool       `json:"has_collector_token"`
	FixtureIssuedAt     *time.Time `json:"fixture_issued_at,omitempty"`
	LastIngestedAt      *time.Time `json:"last_ingested_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	Gaps                []string   `json:"capability_gaps,omitempty"`
	RBACYAML            string     `json:"rbac_yaml,omitempty"`
	Note                string     `json:"note,omitempty"`
}

type costK8sEligibleCluster struct {
	ID            int    `json:"id"`
	ProjectID     int    `json:"project_id"`
	ProjectName   string `json:"project_name"`
	ProjectCode   string `json:"project_code"`
	Cloud         string `json:"cloud"`
	ClusterName   string `json:"cluster_name"`
	Environment   string `json:"environment"`
	AuthMode      string `json:"auth_mode"`
	HasCredential bool   `json:"has_auth_credential"`
}

type costK8sCollectorContract struct {
	Direction         string   `json:"direction"`
	PublicScrape      bool     `json:"public_scrape"`
	InstallsOpenCost  bool     `json:"installs_opencost"`
	WorkerCanEdit     bool     `json:"worker_can_edit"`
	DockerSocket      bool     `json:"docker_socket"`
	TokenStoredAs     string   `json:"token_stored_as"`
	Sources           []string `json:"sources"`
	MetricsServerRole string   `json:"metrics_server_role"`
	Note              string   `json:"note"`
}

func costK8sLamp(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "ready":
		return "ready"
	default:
		return "unknown"
	}
}

func costK8sCollectorHealth(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "healthy", "ok", "ready", "up", "success", "failed", "error", "down":
		return "unknown"
	case "current":
		return "current"
	default:
		return "unknown"
	}
}

func defaultCostK8sCollectorContract() costK8sCollectorContract {
	return costK8sCollectorContract{
		Direction:         "outbound_upload",
		PublicScrape:      false,
		InstallsOpenCost:  false,
		WorkerCanEdit:     false,
		DockerSocket:      false,
		TokenStoredAs:     "hash",
		Sources:           []string{"inventory", "historical_metrics", "opencost_allocation"},
		MetricsServerRole: "not_the_cost_pipeline",
		Note:              "This product does not install OpenCost. Collection uses the existing cluster administration workflow. OpenCost and Prometheus stay private. The token is shown once.",
	}
}

func kubernetesSpendIsBreakdown() bool {
	return true
}

func combineCloudAndKubernetesTotal(cloudAmount, _ string) string {
	return cloudAmount
}

func costK8sFixtureIsLeastPrivilege(doc string) error {
	lower := strings.ToLower(doc)
	if !strings.Contains(lower, "kind: clusterrole") {
		return fmt.Errorf("least-privilege fixture must document a ClusterRole")
	}
	forbidden := []string{
		"helm install", "helm upgrade", "docker.sock", "--force",
		"pods/exec", "pods/attach", "cluster-admin",
	}
	for _, item := range forbidden {
		if strings.Contains(lower, item) {
			return fmt.Errorf("least-privilege fixture cannot include %s", item)
		}
	}
	for _, verb := range []string{"create", "update", "patch", "delete", "bind", "escalate", "impersonate"} {
		if strings.Contains(lower, `"`+verb+`"`) || strings.Contains(lower, "- "+verb) {
			return fmt.Errorf("least-privilege fixture cannot include write verb %s", verb)
		}
	}
	if !strings.Contains(lower, `"get"`) || !strings.Contains(lower, `"list"`) || !strings.Contains(lower, `"watch"`) {
		return fmt.Errorf("least-privilege fixture must be get/list/watch")
	}
	return nil
}

func decorateCostK8sBinding(item *costK8sBinding, costConn *costConnection) {
	if item == nil {
		return
	}
	item.InventoryReadiness = costK8sLamp(item.InventoryReadiness)
	item.MetricsReadiness = costK8sLamp(item.MetricsReadiness)
	item.AllocationReadiness = costK8sLamp(item.AllocationReadiness)
	item.BillingReconciled = costK8sLamp(item.BillingReconciled)
	item.CollectorHealth = costK8sCollectorHealth(item.CollectorHealth)
	if item.CollectorHealth == "current" && (item.LastIngestedAt == nil || time.Since(item.LastIngestedAt.UTC()) > costStaleAfter) {
		item.CollectorHealth = "unknown"
	}
	item.CollectorInstall = "not_installed_by_product"
	item.WorkerCanEdit = false
	item.InstallsOpenCost = false
	item.AddedToCloudTotal = false
	item.RBACYAML = costK8sLeastPrivilegeYAML
	item.Gaps = costK8sCapabilityGaps(*item, costConn)
	item.Note = "Kubernetes cost is a breakdown of charges already on the cloud bill. It is never added again to total cloud spend. This product does not install OpenCost."
}

func costK8sCapabilityGaps(item costK8sBinding, costConn *costConnection) []string {
	gaps := []string{}
	if strings.TrimSpace(item.ClusterUID) == "" {
		gaps = append(gaps, "Cluster immutable identity and node provider IDs are not collected yet.")
	}
	if item.InventoryReadiness != "ready" {
		gaps = append(gaps, "Inventory ready stays Unknown until a read-only object snapshot exists.")
	}
	if item.MetricsReadiness != "ready" {
		gaps = append(gaps, "Historical metrics are not configured. Metrics Server is not the cost pipeline.")
	}
	if item.AllocationReadiness != "ready" {
		gaps = append(gaps, "OpenCost-compatible allocation is not connected. This product does not install OpenCost.")
	}
	if costConn == nil || item.CostConnectionID <= 0 {
		gaps = append(gaps, "No cloud Cost connection is linked. Billing reconciled stays Unknown.")
	} else if item.BillingReconciled == "ready" {
		// mapping already reconciled
	} else if costK8sLamp(costConn.BillingReadiness) != "ready" {
		gaps = append(gaps, "Linked cloud billing is Unknown. List-price estimates would be labelled Estimated.")
	} else {
		gaps = append(gaps, "Cloud billing is present. Node-to-bill mapping is not done, so Billing reconciled stays Unknown.")
	}
	if item.CollectorHealth != "current" {
		gaps = append(gaps, "Collector health is Unknown. A failed pull is never Healthy.")
	}
	if !costK8sEnvironmentIsNonprod(item.Environment) {
		gaps = append(gaps, "This cluster is outside the nonproduction Cost pilot.")
	}
	return gaps
}

func getK8sConnectionByID(id int) (*k8sConnectionRecord, error) {
	if id <= 0 {
		return nil, fmt.Errorf("kubernetes connection not found")
	}
	items, err := listK8sConnections()
	if err != nil {
		if isMissingDatabaseRelation(err, "project_k8s_connections") {
			return nil, fmt.Errorf("kubernetes connection not found")
		}
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("kubernetes connection not found")
}

func costK8sBindError(conn *k8sConnectionRecord, costConn *costConnection) error {
	if conn == nil || conn.ID <= 0 {
		return fmt.Errorf("bind an existing Kubernetes connection")
	}
	if strings.TrimSpace(conn.ClusterName) == "" {
		return fmt.Errorf("the Kubernetes connection has no cluster name")
	}
	if !costK8sEnvironmentIsNonprod(conn.Environment) {
		return fmt.Errorf("the Kubernetes Cost pilot is limited to one nonproduction cluster")
	}
	if costConn != nil {
		if costDemoAccountID(costConn.AccountID) {
			return fmt.Errorf("demo cloud accounts cannot be used for Cost")
		}
	}
	return nil
}

func listCostK8sBindings(userID int) ([]costK8sBinding, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	rows, err := DB.Query(`
		SELECT b.id, b.k8s_connection_id, b.cost_connection_id, COALESCE(b.cluster_uid, ''),
		       COALESCE(b.cluster_name, ''), COALESCE(b.environment, ''), COALESCE(b.cloud, ''),
		       COALESCE(b.auth_mode, ''), b.project_id, COALESCE(p.name, ''), COALESCE(p.code, ''),
		       b.status, b.inventory_readiness, b.metrics_readiness, b.allocation_readiness,
		       b.billing_reconciled, b.collector_health, b.collector_install, b.worker_can_edit,
		       CASE WHEN COALESCE(b.token_hash, '') <> '' THEN TRUE ELSE FALSE END,
		       b.fixture_issued_at, b.last_ingested_at, b.created_at, b.updated_at
		  FROM cost_k8s_bindings b
		  LEFT JOIN projects p ON p.id = NULLIF(b.project_id, 0)
		 ORDER BY COALESCE(p.name, ''), b.environment, b.cluster_name
	`)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_k8s_bindings") {
			return []costK8sBinding{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costK8sBinding{}
	for rows.Next() {
		var item costK8sBinding
		if err := rows.Scan(
			&item.ID, &item.K8sConnectionID, &item.CostConnectionID, &item.ClusterUID,
			&item.ClusterName, &item.Environment, &item.Cloud, &item.AuthMode, &item.ProjectID,
			&item.ProjectName, &item.ProjectCode, &item.Status, &item.InventoryReadiness,
			&item.MetricsReadiness, &item.AllocationReadiness, &item.BillingReconciled,
			&item.CollectorHealth, &item.CollectorInstall, &item.WorkerCanEdit,
			&item.HasCollectorToken, &item.FixtureIssuedAt, &item.LastIngestedAt, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if k8sRank(userK8sAccessForProject(userID, item.ProjectID)) < 1 && !k8sSeesAll(userID) {
			continue
		}
		var costConn *costConnection
		if item.CostConnectionID > 0 {
			costConn, _ = getCostConnection(userID, item.CostConnectionID)
		}
		decorateCostK8sBinding(&item, costConn)
		out = append(out, item)
	}
	return out, nil
}

func getCostK8sBinding(userID, id int) (*costK8sBinding, error) {
	items, err := listCostK8sBindings(userID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("cluster cost binding not found")
}

func listEligibleCostK8sClusters(userID int) ([]costK8sEligibleCluster, error) {
	connections, err := listK8sConnections()
	if err != nil {
		if isMissingDatabaseRelation(err, "project_k8s_connections") {
			return []costK8sEligibleCluster{}, nil
		}
		return nil, err
	}
	_, visible, _ := filterK8sConnectionCatalog(userID, nil, connections)
	bound := map[int]bool{}
	existing, err := listCostK8sBindings(userID)
	if err != nil {
		return nil, err
	}
	for _, item := range existing {
		bound[item.K8sConnectionID] = true
	}
	out := []costK8sEligibleCluster{}
	if len(existing) >= 1 {
		return []costK8sEligibleCluster{}, nil
	}
	for _, conn := range visible {
		if bound[conn.ID] || strings.TrimSpace(conn.ClusterName) == "" || !costK8sEnvironmentIsNonprod(conn.Environment) {
			continue
		}
		out = append(out, costK8sEligibleCluster{
			ID:            conn.ID,
			ProjectID:     conn.ProjectID,
			ProjectName:   conn.ProjectName,
			ProjectCode:   conn.ProjectCode,
			Cloud:         conn.Cloud,
			ClusterName:   conn.ClusterName,
			Environment:   conn.Environment,
			AuthMode:      conn.AuthMode,
			HasCredential: conn.HasAuthCredential,
		})
	}
	return out, nil
}

func bindCostK8sCluster(userID, k8sConnectionID, costConnectionID int) (*costK8sBinding, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	conn, err := getK8sConnectionByID(k8sConnectionID)
	if err != nil {
		return nil, err
	}
	if k8sRank(userK8sAccessForProject(userID, conn.ProjectID)) < 1 {
		return nil, fmt.Errorf("this cluster is not included for your group")
	}
	if !userCanOperateCost(userID, conn.ProjectID) {
		return nil, errCostOperateRequired
	}
	var costConn *costConnection
	if costConnectionID > 0 {
		costConn, err = getCostConnection(userID, costConnectionID)
		if err != nil || costConn == nil {
			return nil, fmt.Errorf("cost connection not found")
		}
		costConnectionID = costConn.ID
	}
	if err := costK8sBindError(conn, costConn); err != nil {
		return nil, err
	}
	existing, err := listCostK8sBindings(userID)
	if err != nil {
		return nil, err
	}
	if err := costK8sPilotBindLimit(existing, conn.ID); err != nil {
		return nil, err
	}
	var id int
	err = DB.QueryRow(`
		INSERT INTO cost_k8s_bindings (
			k8s_connection_id, cost_connection_id, cluster_name, environment, cloud, auth_mode, project_id,
			status, inventory_readiness, metrics_readiness, allocation_readiness, billing_reconciled,
			collector_health, collector_install, worker_can_edit, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','unknown','unknown','unknown','unknown','unknown','not_installed_by_product', FALSE, $8)
		ON CONFLICT (k8s_connection_id) DO UPDATE SET
			cost_connection_id = EXCLUDED.cost_connection_id,
			cluster_name = EXCLUDED.cluster_name,
			environment = EXCLUDED.environment,
			cloud = EXCLUDED.cloud,
			auth_mode = EXCLUDED.auth_mode,
			project_id = EXCLUDED.project_id,
			worker_can_edit = FALSE,
			collector_install = 'not_installed_by_product',
			updated_at = CURRENT_TIMESTAMP
		RETURNING id
	`, conn.ID, costConnectionID, conn.ClusterName, conn.Environment, conn.Cloud, conn.AuthMode, conn.ProjectID, userID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return getCostK8sBinding(userID, id)
}

func issueCostK8sFixture(userID, id int) (*costK8sBinding, string, error) {
	item, err := getCostK8sBinding(userID, id)
	if err != nil {
		return nil, "", err
	}
	if err := costK8sFixtureIsLeastPrivilege(costK8sLeastPrivilegeYAML); err != nil {
		return nil, "", err
	}
	token, err := randomVulnToken("costk8s_")
	if err != nil {
		return nil, "", err
	}
	_, err = DB.Exec(`
		UPDATE cost_k8s_bindings
		   SET token_hash = $2,
		       fixture_issued_at = CURRENT_TIMESTAMP,
		       collector_install = 'not_installed_by_product',
		       worker_can_edit = FALSE,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE id = $1
	`, item.ID, hashVulnToken(token))
	if err != nil {
		return nil, "", err
	}
	next, err := getCostK8sBinding(userID, id)
	if err != nil {
		return nil, "", err
	}
	return next, token, nil
}

func buildCostKubernetesCatalog(userID int) (map[string]any, error) {
	items, err := listCostK8sBindings(userID)
	if err != nil {
		return nil, err
	}
	eligible, err := listEligibleCostK8sClusters(userID)
	if err != nil {
		return nil, err
	}
	connections, err := listCostConnections(userID)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_connections") {
			connections = []costConnection{}
		} else {
			return nil, err
		}
	}
	return map[string]any{
		"status":               "ok",
		"clusters":             items,
		"eligible":             eligible,
		"cost_connections":     connections,
		"collector_contract":   defaultCostK8sCollectorContract(),
		"rbac_yaml":            costK8sLeastPrivilegeYAML,
		"installs_opencost":    false,
		"worker_can_edit":      false,
		"added_to_cloud_total": false,
		"auth_modes":           k8sAuthModes(),
		"pilot":                buildCostK8sPilot(nil),
		"can_operate":          userHasCostOperateAnywhere(userID),
		"note":                 "The Kubernetes Cost pilot is one nonproduction cluster, read-only. Inventory, historical metrics, allocation, and billing reconciled stay independent. Missing stays Unknown, never Healthy. This product does not install OpenCost.",
	}, nil
}

func buildCostKubernetesCard(userID int) map[string]any {
	items, err := listCostK8sBindings(userID)
	if err != nil {
		items = []costK8sBinding{}
	}
	mappedReady := 0
	for _, item := range items {
		if costK8sLamp(item.BillingReconciled) == "ready" {
			mappedReady++
		}
	}
	return map[string]any{
		"cluster_count":        len(items),
		"mapped_ready":         mappedReady,
		"spend":                costMoneyView(costCoverage(false, false), "0.000000", "USD", "actual"),
		"added_to_cloud_total": false,
		"installs_opencost":    false,
		"worker_can_edit":      false,
		"pilot":                buildCostK8sPilot(nil),
		"note":                 "Kubernetes cost is a breakdown of charges already on the cloud bill. It is never added again to total cloud spend. The pilot is one nonproduction cluster, read-only.",
	}
}
