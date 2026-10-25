package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const costK8sMaxIdentities = 2000

type costK8sIdentity struct {
	PodUID          string
	PodName         string
	Namespace       string
	ControllerKind  string
	ControllerName  string
	WorkloadKey     string
	StartedAt       *time.Time
	EndedAt         *time.Time
	Deleted         bool
	CPURequest      string
	MemoryRequest   string
	CPUUsage        *string
	MemoryUsage     *string
	AllocationTotal *string
	Currency        string
	Estimated       bool
	LabelsJSON      string
	ManagedBy       string
	HPA             string
	VPA             string
	PDB             string
	Owner           string
}

type costK8sSnapshotDoc struct {
	ClusterUID           string
	WindowStart          time.Time
	WindowEnd            time.Time
	Complete             bool
	CollectedAt          time.Time
	Nodes                int
	NodeRecords          []costK8sNode
	Identities           []costK8sIdentity
	IdleEstimated        *string
	SharedEstimated      *string
	UnallocatedEstimated *string
	Unattributed         int
	Undercoverage        string
}

type costK8sSnapshotRow struct {
	ID                   int       `json:"id"`
	BindingID            int       `json:"binding_id"`
	ClusterUID           string    `json:"cluster_uid"`
	WindowStart          string    `json:"window_start"`
	WindowEnd            string    `json:"window_end"`
	Complete             bool      `json:"complete"`
	ContentHash          string    `json:"content_hash"`
	CollectedAt          time.Time `json:"collected_at"`
	ImportedAt           time.Time `json:"imported_at"`
	Supersedes           int       `json:"supersedes_snapshot_id,omitempty"`
	Stale                bool      `json:"stale,omitempty"`
	InventoryPresent     bool      `json:"inventory_present"`
	MetricsPresent       bool      `json:"metrics_present"`
	AllocationPresent    bool      `json:"allocation_present"`
	Undercoverage        string    `json:"undercoverage,omitempty"`
	IdleEstimated        *string   `json:"idle_estimated,omitempty"`
	SharedEstimated      *string   `json:"shared_estimated,omitempty"`
	UnallocatedEstimated *string   `json:"unallocated_estimated,omitempty"`
	Duplicate            bool      `json:"duplicate,omitempty"`
	Correction           bool      `json:"correction,omitempty"`
	IgnoredStale         bool      `json:"ignored_stale,omitempty"`
	AddedToCloudTotal    bool      `json:"added_to_cloud_total"`
	InstallsOpenCost     bool      `json:"installs_opencost"`
	WorkerCanEdit        bool      `json:"worker_can_edit"`
	Estimated            bool      `json:"estimated"`
	Note                 string    `json:"note,omitempty"`
}

type costK8sIdentityView struct {
	PodUID            string         `json:"pod_uid"`
	PodName           string         `json:"pod_name"`
	Namespace         string         `json:"namespace"`
	ControllerKind    string         `json:"controller_kind"`
	ControllerName    string         `json:"controller_name"`
	WorkloadKey       string         `json:"workload_key"`
	Deleted           bool           `json:"deleted"`
	CPURequest        string         `json:"cpu_request,omitempty"`
	MemoryRequest     string         `json:"memory_request,omitempty"`
	CPUUsage          map[string]any `json:"cpu_usage"`
	MemoryUsage       map[string]any `json:"memory_usage"`
	AllocationTotal   map[string]any `json:"allocation_total"`
	ManagedBy         string         `json:"managed_by"`
	HPA               string         `json:"hpa"`
	VPA               string         `json:"vpa"`
	PDB               string         `json:"pdb"`
	Owner             string         `json:"owner"`
	Estimated         bool           `json:"estimated"`
	AddedToCloudTotal bool           `json:"added_to_cloud_total"`
}

type costK8sWorkloadView struct {
	WorkloadKey       string         `json:"workload_key"`
	Namespace         string         `json:"namespace"`
	ControllerKind    string         `json:"controller_kind"`
	ControllerName    string         `json:"controller_name"`
	PodCount          int            `json:"pod_count"`
	DeletedCount      int            `json:"deleted_count"`
	CPURequest        string         `json:"cpu_request,omitempty"`
	MemoryRequest     string         `json:"memory_request,omitempty"`
	CPUUsage          map[string]any `json:"cpu_usage"`
	MemoryUsage       map[string]any `json:"memory_usage"`
	AllocationTotal   map[string]any `json:"allocation_total"`
	ManagedBy         string         `json:"managed_by"`
	HPA               string         `json:"hpa"`
	VPA               string         `json:"vpa"`
	PDB               string         `json:"pdb"`
	Owner             string         `json:"owner"`
	Estimated         bool           `json:"estimated"`
	AddedToCloudTotal bool           `json:"added_to_cloud_total"`
}

func costK8sPodIdentityKey(uid string) (string, error) {
	uid = strings.TrimSpace(uid)
	if uid == "" {
		return "", fmt.Errorf("pod identity requires a UID")
	}
	return uid, nil
}

func costK8sWorkloadKey(namespace, kind, name string) string {
	return strings.ToLower(strings.TrimSpace(namespace)) + "|" + strings.ToLower(strings.TrimSpace(kind)) + "|" + strings.TrimSpace(name)
}

func costK8sMetricView(sample *string) map[string]any {
	if sample == nil || strings.TrimSpace(*sample) == "" {
		return map[string]any{"coverage": "none", "display": "Needs more data", "amount": nil}
	}
	return map[string]any{"coverage": "complete", "display": strings.TrimSpace(*sample), "amount": strings.TrimSpace(*sample)}
}

func costK8sEstimatedView(amount *string, complete bool) map[string]any {
	view := map[string]any{
		"estimated":            true,
		"billed":               false,
		"added_to_cloud_total": false,
		"amount":               nil,
		"display":              "Needs more data",
		"coverage":             "none",
	}
	if !complete || amount == nil || strings.TrimSpace(*amount) == "" {
		return view
	}
	parsed, err := parseCostAmount(*amount)
	if err != nil {
		return view
	}
	view["coverage"] = "complete"
	view["amount"] = parsed
	view["display"] = "Estimated " + formatCostDisplay(parsed, "USD")
	return view
}

func costK8sOptionalMetric(raw map[string]any, keys ...string) *string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			if value == nil {
				return nil
			}
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil
			}
			return &text
		}
	}
	return nil
}

func costK8sParseTime(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, fmt.Errorf("timestamp is required")
	}
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		return parsed.UTC(), nil
	}
	if len(raw) >= 10 {
		return costParseDate(raw[:10])
	}
	return time.Time{}, fmt.Errorf("timestamp must be RFC3339")
}

func costK8sSanitizeLabels(raw map[string]any) string {
	if len(raw) == 0 {
		return ""
	}
	clean := map[string]string{}
	for key, value := range raw {
		k := strings.TrimSpace(key)
		v := strings.TrimSpace(fmt.Sprint(value))
		if k == "" || strings.Contains(k, "@") || strings.Contains(v, "@") {
			continue
		}
		clean[k] = v
	}
	if len(clean) == 0 {
		return ""
	}
	encoded, err := json.Marshal(clean)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func costK8sMapAsObject(raw any) map[string]any {
	if typed, ok := raw.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func costK8sOpenCostItems(raw any) []map[string]any {
	switch typed := raw.(type) {
	case []any:
		out := []map[string]any{}
		for _, item := range typed {
			if row, ok := item.(map[string]any); ok {
				out = append(out, row)
			}
		}
		return out
	case map[string]any:
		if nested, ok := typed["data"]; ok && nested != raw {
			return costK8sOpenCostItems(nested)
		}
		out := []map[string]any{}
		for _, item := range typed {
			if row, ok := item.(map[string]any); ok {
				if _, hasProps := row["properties"]; hasProps || row["namespace"] != nil || row["pod"] != nil {
					out = append(out, row)
					continue
				}
				out = append(out, costK8sOpenCostItems(item)...)
			}
		}
		return out
	default:
		return nil
	}
}

func costK8sPayloadForbidden(raw map[string]any) error {
	if costPayloadHasSecret(raw) {
		return fmt.Errorf("snapshot cannot include secrets")
	}
	encoded, _ := json.Marshal(raw)
	lower := strings.ToLower(string(encoded))
	for _, item := range []string{"kubeconfig", "docker.sock", "--force", "helm install"} {
		if strings.Contains(lower, item) {
			return fmt.Errorf("snapshot cannot include %s", item)
		}
	}
	return nil
}

func parseCostK8sSnapshot(raw map[string]any, now time.Time) (*costK8sSnapshotDoc, error) {
	if err := costK8sPayloadForbidden(raw); err != nil {
		return nil, err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	inventory := costK8sMapAsObject(raw["inventory"])
	opencost := costK8sMapAsObject(raw["opencost"])
	if len(opencost) == 0 {
		opencost = costK8sMapAsObject(raw["allocation"])
	}
	clusterUID := costRawString(raw, "cluster_uid", "clusterUID")
	if clusterUID == "" {
		clusterUID = costRawString(inventory, "cluster_uid", "clusterUID", "uid")
	}
	windowStartRaw := costRawString(raw, "window_start", "windowStart")
	windowEndRaw := costRawString(raw, "window_end", "windowEnd")
	if window := costK8sMapAsObject(raw["window"]); windowStartRaw == "" {
		windowStartRaw = costRawString(window, "start", "window_start")
		windowEndRaw = costRawString(window, "end", "window_end")
	}
	if window := costK8sMapAsObject(opencost["window"]); windowStartRaw == "" {
		windowStartRaw = costRawString(window, "start")
		windowEndRaw = costRawString(window, "end")
	}
	start, err := costK8sParseTime(windowStartRaw)
	if err != nil {
		return nil, fmt.Errorf("window_start must be RFC3339")
	}
	end, err := costK8sParseTime(windowEndRaw)
	if err != nil {
		return nil, fmt.Errorf("window_end must be RFC3339")
	}
	if err := costWindowAllowed(start, end, now); err != nil {
		return nil, err
	}
	collected := now
	if rawCollected := costRawString(raw, "collected_at", "collectedAt"); rawCollected != "" {
		if parsed, parseErr := costK8sParseTime(rawCollected); parseErr == nil {
			collected = parsed
		}
	}
	complete := true
	if value, ok := raw["complete"]; ok {
		if typed, isBool := value.(bool); isBool {
			complete = typed
		}
	}
	nodes := costK8sOpenCostItems(inventory["nodes"])
	if len(nodes) == 0 {
		nodes = costK8sOpenCostItems(raw["nodes"])
	}
	podRaw := costK8sOpenCostItems(inventory["pods"])
	if len(podRaw) == 0 {
		podRaw = costK8sOpenCostItems(raw["pods"])
	}
	if len(podRaw) > costK8sMaxIdentities {
		return nil, fmt.Errorf("snapshot is limited to %d pod identities", costK8sMaxIdentities)
	}
	identities := make([]costK8sIdentity, 0, len(podRaw))
	byUID := map[string]int{}
	byName := map[string][]string{}
	for _, row := range podRaw {
		uid, idErr := costK8sPodIdentityKey(costRawString(row, "uid", "pod_uid", "podUID"))
		if idErr != nil {
			return nil, idErr
		}
		namespace := costRawString(row, "namespace")
		name := costRawString(row, "name", "pod", "pod_name")
		kind := costRawString(row, "controller_kind", "controllerKind", "kind")
		controller := costRawString(row, "controller_name", "controller", "controllerName")
		deleted := false
		if value, ok := row["deleted"].(bool); ok {
			deleted = value
		}
		if costRawString(row, "ended_at", "end", "deletionTimestamp") != "" && costRawString(row, "phase") == "Succeeded" {
			deleted = true
		}
		labels := costK8sMapAsObject(row["labels"])
		item := costK8sIdentity{
			PodUID:         uid,
			PodName:        name,
			Namespace:      namespace,
			ControllerKind: kind,
			ControllerName: controller,
			WorkloadKey:    costK8sWorkloadKey(namespace, kind, controller),
			Deleted:        deleted,
			CPURequest:     costRawString(row, "cpu_request", "cpuRequest"),
			MemoryRequest:  costRawString(row, "memory_request", "memoryRequest"),
			CPUUsage:       costK8sOptionalMetric(row, "cpu_usage", "cpuUsage"),
			MemoryUsage:    costK8sOptionalMetric(row, "memory_usage", "memoryUsage"),
			Currency:       "USD",
			Estimated:      true,
			ManagedBy:      costK8sConstraintValue(row, labels, []string{"managed_by", "managedBy"}, []string{"app.kubernetes.io/managed-by", "managed-by"}),
			HPA:            costK8sConstraintValue(row, labels, []string{"hpa", "horizontalPodAutoscaler", "horizontal_pod_autoscaler"}, []string{"autoscaling.horizontal"}),
			VPA:            costK8sConstraintValue(row, labels, []string{"vpa", "verticalPodAutoscaler", "vertical_pod_autoscaler"}, []string{"autoscaling.k8s.io/vpa"}),
			PDB:            costK8sConstraintValue(row, labels, []string{"pdb", "podDisruptionBudget", "pod_disruption_budget"}, []string{"policy/pdb"}),
			Owner:          firstNonEmpty(costRawString(row, "owner", "team"), costRawString(labels, "team", "owner", "app.kubernetes.io/team")),
		}
		if item.Owner != "" {
			if _, ok := labels["team"]; !ok {
				labels["team"] = item.Owner
			}
		}
		item.LabelsJSON = costK8sSanitizeLabels(labels)
		if started, parseErr := costK8sParseTime(costRawString(row, "started_at", "start", "startTime")); parseErr == nil {
			item.StartedAt = &started
		}
		if ended, parseErr := costK8sParseTime(costRawString(row, "ended_at", "end", "deletionTimestamp")); parseErr == nil {
			item.EndedAt = &ended
			item.Deleted = true
		}
		if _, exists := byUID[uid]; exists {
			return nil, fmt.Errorf("duplicate pod UID %s", uid)
		}
		byUID[uid] = len(identities)
		byName[namespace+"/"+name] = append(byName[namespace+"/"+name], uid)
		identities = append(identities, item)
	}
	unattributed := 0
	var idleAmt, sharedAmt, unallocAmt *string
	allocItems := costK8sOpenCostItems(opencost["data"])
	if len(allocItems) == 0 {
		allocItems = costK8sOpenCostItems(raw["allocations"])
	}
	for _, row := range allocItems {
		props := costK8sMapAsObject(row["properties"])
		if len(props) == 0 {
			props = row
		}
		uid := costRawString(props, "pod_uid", "podUID", "uid")
		namespace := costRawString(props, "namespace")
		podName := costRawString(props, "pod", "pod_name", "name")
		kind := costRawString(props, "controllerKind", "controller_kind", "kind")
		amount := costK8sOptionalMetric(row, "totalCost", "total_cost", "cpuCost")
		if amount == nil {
			amount = costK8sOptionalMetric(props, "totalCost", "total_cost")
		}
		if costK8sIdleName(namespace, podName, kind) {
			idleAmt = addCostOptional(idleAmt, amount)
			continue
		}
		if uid == "" {
			matches := byName[namespace+"/"+podName]
			if len(matches) == 1 {
				uid = matches[0]
			}
		}
		if uid == "" && costK8sSharedName(namespace, kind) {
			sharedAmt = addCostOptional(sharedAmt, amount)
			continue
		}
		if uid == "" {
			unattributed++
			unallocAmt = addCostOptional(unallocAmt, amount)
			continue
		}
		idx, ok := byUID[uid]
		if !ok {
			unattributed++
			unallocAmt = addCostOptional(unallocAmt, amount)
			continue
		}
		identities[idx].AllocationTotal = amount
		if identities[idx].ControllerName == "" {
			identities[idx].ControllerName = costRawString(props, "controller", "controllerName")
			identities[idx].ControllerKind = kind
			identities[idx].WorkloadKey = costK8sWorkloadKey(identities[idx].Namespace, identities[idx].ControllerKind, identities[idx].ControllerName)
		}
	}
	nodeRecords := parseCostK8sNodes(nodes)
	under := []string{}
	if clusterUID == "" {
		under = append(under, "Cluster immutable identity is missing.")
	}
	if unattributed > 0 {
		under = append(under, "Some OpenCost rows have no pod UID and stay Needs more data, not zero usage.")
	}
	if len(identities) == 0 {
		under = append(under, "No pod identities were uploaded.")
	}
	if len(nodeRecords) == 0 {
		under = append(under, "Node provider IDs are missing, so billing cannot be reconciled.")
	}
	return &costK8sSnapshotDoc{
		ClusterUID:           clusterUID,
		WindowStart:          start,
		WindowEnd:            end,
		Complete:             complete,
		CollectedAt:          collected,
		Nodes:                len(nodeRecords),
		NodeRecords:          nodeRecords,
		Identities:           identities,
		IdleEstimated:        idleAmt,
		SharedEstimated:      sharedAmt,
		UnallocatedEstimated: unallocAmt,
		Unattributed:         unattributed,
		Undercoverage:        strings.Join(under, " "),
	}, nil
}

func costK8sSnapshotIsStale(incoming, latest time.Time) bool {
	return !latest.IsZero() && incoming.Before(latest)
}

func costK8sSnapshotHash(doc *costK8sSnapshotDoc) string {
	sum := sha256.New()
	_, _ = fmt.Fprintf(sum, "k8s_snap|%s|%s|%s|%t|%d|%s|%s|%s\n", doc.ClusterUID, doc.WindowStart.UTC().Format(time.RFC3339), doc.WindowEnd.UTC().Format(time.RFC3339), doc.Complete, doc.Nodes, optionalCostAmount(doc.IdleEstimated), optionalCostAmount(doc.SharedEstimated), optionalCostAmount(doc.UnallocatedEstimated))
	nodeCopy := append([]costK8sNode(nil), doc.NodeRecords...)
	sort.Slice(nodeCopy, func(i, j int) bool { return nodeCopy[i].InstanceID < nodeCopy[j].InstanceID })
	for _, node := range nodeCopy {
		_, _ = fmt.Fprintf(sum, "node|%s|%s|%s\n", node.Name, node.ProviderID, node.InstanceID)
	}
	ordered := append([]costK8sIdentity(nil), doc.Identities...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].PodUID < ordered[j].PodUID })
	for _, item := range ordered {
		usage := ""
		if item.CPUUsage != nil {
			usage = *item.CPUUsage
		}
		alloc := ""
		if item.AllocationTotal != nil {
			alloc = *item.AllocationTotal
		}
		_, _ = fmt.Fprintf(sum, "%s|%s|%s|%s|%t|%s|%s|%s|%s|%s|%s\n", item.PodUID, item.Namespace, item.PodName, item.WorkloadKey, item.Deleted, usage, alloc, item.ManagedBy, item.HPA, item.VPA, item.PDB)
	}
	return fmt.Sprintf("k8s-%x", sum.Sum(nil))
}

func costK8sSnapshotSignals(doc *costK8sSnapshotDoc) (inventory, metrics, allocation bool) {
	if doc == nil {
		return false, false, false
	}
	inventory = strings.TrimSpace(doc.ClusterUID) != "" && (doc.Nodes > 0 || len(doc.Identities) > 0)
	for _, item := range doc.Identities {
		if item.CPUUsage != nil || item.MemoryUsage != nil {
			metrics = true
		}
		if item.AllocationTotal != nil {
			allocation = true
		}
	}
	return inventory, metrics, allocation
}

func lookupCostK8sBindingByToken(raw string) (*costK8sBinding, error) {
	hash := hashVulnToken(strings.TrimSpace(raw))
	if hash == "" || DB == nil {
		return nil, fmt.Errorf("collector identity required")
	}
	var id int
	err := DB.QueryRow(`SELECT id FROM cost_k8s_bindings WHERE token_hash = $1`, hash).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("collector identity required")
	}
	return getCostK8sBindingRecord(id)
}

func getCostK8sBindingRecord(id int) (*costK8sBinding, error) {
	if DB == nil || id <= 0 {
		return nil, fmt.Errorf("cluster cost binding not found")
	}
	var item costK8sBinding
	err := DB.QueryRow(`
		SELECT b.id, b.k8s_connection_id, b.cost_connection_id, COALESCE(b.cluster_uid, ''),
		       COALESCE(b.cluster_name, ''), COALESCE(b.environment, ''), COALESCE(b.cloud, ''),
		       COALESCE(b.auth_mode, ''), b.project_id, COALESCE(p.name, ''), COALESCE(p.code, ''),
		       b.status, b.inventory_readiness, b.metrics_readiness, b.allocation_readiness,
		       b.billing_reconciled, b.collector_health, b.collector_install, b.worker_can_edit,
		       CASE WHEN COALESCE(b.token_hash, '') <> '' THEN TRUE ELSE FALSE END,
		       b.fixture_issued_at, b.last_ingested_at, b.created_at, b.updated_at
		  FROM cost_k8s_bindings b
		  LEFT JOIN projects p ON p.id = NULLIF(b.project_id, 0)
		 WHERE b.id = $1
	`, id).Scan(
		&item.ID, &item.K8sConnectionID, &item.CostConnectionID, &item.ClusterUID,
		&item.ClusterName, &item.Environment, &item.Cloud, &item.AuthMode, &item.ProjectID,
		&item.ProjectName, &item.ProjectCode, &item.Status, &item.InventoryReadiness,
		&item.MetricsReadiness, &item.AllocationReadiness, &item.BillingReconciled,
		&item.CollectorHealth, &item.CollectorInstall, &item.WorkerCanEdit,
		&item.HasCollectorToken, &item.FixtureIssuedAt, &item.LastIngestedAt, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("cluster cost binding not found")
	}
	decorateCostK8sBinding(&item, nil)
	return &item, nil
}

func lookupCostK8sSnapshotHash(bindingID int, hash string) (*costK8sSnapshotRow, bool, error) {
	row, err := scanCostK8sSnapshot(`SELECT `+costK8sSnapshotColumns+` FROM cost_k8s_snapshots WHERE binding_id = $1 AND content_hash = $2`, bindingID, hash)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_k8s_snapshots") {
			return nil, false, nil
		}
		return nil, false, err
	}
	return row, true, nil
}

const costK8sSnapshotColumns = `id, binding_id, COALESCE(cluster_uid,''), window_start, window_end, complete, content_hash, collected_at, imported_at, supersedes_snapshot_id, stale, inventory_present, metrics_present, allocation_present, COALESCE(undercoverage,'')`

func scanCostK8sSnapshot(query string, args ...any) (*costK8sSnapshotRow, error) {
	var item costK8sSnapshotRow
	var start, end time.Time
	err := DB.QueryRow(query, args...).Scan(
		&item.ID, &item.BindingID, &item.ClusterUID, &start, &end, &item.Complete, &item.ContentHash,
		&item.CollectedAt, &item.ImportedAt, &item.Supersedes, &item.Stale, &item.InventoryPresent,
		&item.MetricsPresent, &item.AllocationPresent, &item.Undercoverage,
	)
	if err != nil {
		return nil, err
	}
	item.WindowStart = start.UTC().Format(time.RFC3339)
	item.WindowEnd = end.UTC().Format(time.RFC3339)
	item.AddedToCloudTotal = false
	item.InstallsOpenCost = false
	item.WorkerCanEdit = false
	item.Estimated = true
	return &item, nil
}

func latestCostK8sSnapshot(bindingID int, start, end time.Time) (*costK8sSnapshotRow, error) {
	row, err := scanCostK8sSnapshot(`
		SELECT `+costK8sSnapshotColumns+`
		  FROM cost_k8s_snapshots
		 WHERE binding_id = $1 AND window_start = $2 AND window_end = $3 AND stale = FALSE
		 ORDER BY collected_at DESC, id DESC
		 LIMIT 1
	`, bindingID, start, end)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_k8s_snapshots") {
			return nil, nil
		}
		return nil, err
	}
	return row, nil
}

func persistCostK8sSnapshot(bindingID int, doc *costK8sSnapshotDoc) (*costK8sSnapshotRow, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	if doc == nil {
		return nil, fmt.Errorf("snapshot is required")
	}
	hash := costK8sSnapshotHash(doc)
	if existing, found, err := lookupCostK8sSnapshotHash(bindingID, hash); err != nil {
		return nil, err
	} else if found {
		_, _ = DB.Exec(`UPDATE cost_k8s_bindings SET last_ingested_at = CURRENT_TIMESTAMP, collector_health = 'current', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, bindingID)
		existing.Duplicate = true
		existing.Note = "This snapshot was already stored. Pod identities were not duplicated."
		return existing, nil
	}
	previous, err := latestCostK8sSnapshot(bindingID, doc.WindowStart, doc.WindowEnd)
	if err != nil {
		return nil, err
	}
	if previous != nil && costK8sSnapshotIsStale(doc.CollectedAt, previous.CollectedAt) {
		previous.IgnoredStale = true
		previous.Note = "An older snapshot cannot overwrite a newer one for the same window."
		return previous, nil
	}
	inventory, metrics, allocation := costK8sSnapshotSignals(doc)
	supersedes := 0
	correction := false
	if previous != nil {
		supersedes = previous.ID
		correction = true
	}
	tx, err := DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var id int
	err = tx.QueryRow(`
		INSERT INTO cost_k8s_snapshots (
			binding_id, cluster_uid, window_start, window_end, complete, content_hash, collected_at,
			supersedes_snapshot_id, stale, inventory_present, metrics_present, allocation_present, undercoverage
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,$10,$11,$12)
		RETURNING id
	`, bindingID, doc.ClusterUID, doc.WindowStart, doc.WindowEnd, doc.Complete, hash, doc.CollectedAt,
		supersedes, inventory, metrics, allocation, doc.Undercoverage).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			_ = tx.Rollback()
			existing, found, lookErr := lookupCostK8sSnapshotHash(bindingID, hash)
			if lookErr != nil || !found {
				return nil, err
			}
			existing.Duplicate = true
			existing.Note = "This snapshot was already stored. Pod identities were not duplicated."
			return existing, nil
		}
		return nil, err
	}
	for _, item := range doc.Identities {
		_, err = tx.Exec(`
			INSERT INTO cost_k8s_identities (
				snapshot_id, binding_id, pod_uid, pod_name, namespace, controller_kind, controller_name, workload_key,
				started_at, ended_at, deleted, cpu_request, memory_request, cpu_usage, memory_usage, allocation_total,
				currency, estimated, labels_json, managed_by, hpa, vpa, pdb
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'USD',TRUE,$17,$18,$19,$20,$21)
		`, id, bindingID, item.PodUID, item.PodName, item.Namespace, item.ControllerKind, item.ControllerName, item.WorkloadKey,
			item.StartedAt, item.EndedAt, item.Deleted, item.CPURequest, item.MemoryRequest, item.CPUUsage, item.MemoryUsage, item.AllocationTotal, item.LabelsJSON,
			item.ManagedBy, item.HPA, item.VPA, item.PDB)
		if err != nil {
			return nil, err
		}
	}
	for _, node := range doc.NodeRecords {
		_, err = tx.Exec(`
			INSERT INTO cost_k8s_nodes (snapshot_id, binding_id, node_name, provider_id, instance_id, instance_class, zone, purchase_model)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		`, id, bindingID, node.Name, node.ProviderID, node.InstanceID, node.InstanceClass, node.Zone, node.PurchaseModel)
		if err != nil {
			return nil, err
		}
	}
	_, _ = tx.Exec(`
		UPDATE cost_k8s_snapshots
		   SET idle_estimated = $2, shared_estimated = $3, unallocated_estimated = $4
		 WHERE id = $1
	`, id, doc.IdleEstimated, doc.SharedEstimated, doc.UnallocatedEstimated)
	inventoryLamp, metricsLamp, allocationLamp := "unknown", "unknown", "unknown"
	if inventory {
		inventoryLamp = "ready"
	}
	if metrics {
		metricsLamp = "ready"
	}
	if allocation {
		allocationLamp = "ready"
	}
	_, err = tx.Exec(`
		UPDATE cost_k8s_bindings
		   SET cluster_uid = CASE WHEN $2 <> '' THEN $2 ELSE cluster_uid END,
		       inventory_readiness = $3,
		       metrics_readiness = $4,
		       allocation_readiness = $5,
		       billing_reconciled = 'unknown',
		       collector_health = 'current',
		       collector_install = 'not_installed_by_product',
		       worker_can_edit = FALSE,
		       last_ingested_at = CURRENT_TIMESTAMP,
		       updated_at = CURRENT_TIMESTAMP
		 WHERE id = $1
	`, bindingID, doc.ClusterUID, inventoryLamp, metricsLamp, allocationLamp)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	row, err := scanCostK8sSnapshot(`SELECT `+costK8sSnapshotColumns+` FROM cost_k8s_snapshots WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	row.Correction = correction
	row.Note = costK8sSnapshotNote(row)
	return row, nil
}

func costK8sSnapshotNote(row *costK8sSnapshotRow) string {
	if row == nil {
		return "Snapshot stored."
	}
	if row.Duplicate {
		return "This snapshot was already stored. Pod identities were not duplicated."
	}
	if row.IgnoredStale {
		return "An older snapshot cannot overwrite a newer one for the same window."
	}
	if !row.Complete {
		return "Partial window stored. Missing history is Needs more data, not zero usage. Estimated allocation is not added to the cloud bill."
	}
	if row.Correction {
		return "This snapshot replaces the previous revision for the same window. Deleted pods keep their UID. Estimated allocation is not added to the cloud bill."
	}
	return "Snapshot stored. Deleted pods keep identity. Missing metrics stay Needs more data. This product does not install OpenCost."
}

func listCostK8sSnapshots(bindingID int) ([]costK8sSnapshotRow, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	rows, err := DB.Query(`
		SELECT `+costK8sSnapshotColumns+`
		  FROM cost_k8s_snapshots
		 WHERE binding_id = $1
		 ORDER BY collected_at DESC, id DESC
	`, bindingID)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_k8s_snapshots") {
			return []costK8sSnapshotRow{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costK8sSnapshotRow{}
	for rows.Next() {
		var item costK8sSnapshotRow
		var start, end time.Time
		if err := rows.Scan(
			&item.ID, &item.BindingID, &item.ClusterUID, &start, &end, &item.Complete, &item.ContentHash,
			&item.CollectedAt, &item.ImportedAt, &item.Supersedes, &item.Stale, &item.InventoryPresent,
			&item.MetricsPresent, &item.AllocationPresent, &item.Undercoverage,
		); err != nil {
			return nil, err
		}
		item.WindowStart = start.UTC().Format(time.RFC3339)
		item.WindowEnd = end.UTC().Format(time.RFC3339)
		item.AddedToCloudTotal = false
		item.InstallsOpenCost = false
		item.WorkerCanEdit = false
		item.Estimated = true
		item.Note = costK8sSnapshotNote(&item)
		out = append(out, item)
	}
	return out, nil
}

func listCostK8sIdentities(snapshotID int) ([]costK8sIdentity, error) {
	rows, err := DB.Query(`
		SELECT pod_uid, pod_name, namespace, controller_kind, controller_name, workload_key,
		       started_at, ended_at, deleted, cpu_request, memory_request, cpu_usage, memory_usage,
		       allocation_total, currency, estimated, labels_json,
		       COALESCE(managed_by,''), COALESCE(hpa,''), COALESCE(vpa,''), COALESCE(pdb,'')
		  FROM cost_k8s_identities
		 WHERE snapshot_id = $1
		 ORDER BY namespace, controller_name, pod_name, pod_uid
	`, snapshotID)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_k8s_identities") {
			return []costK8sIdentity{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costK8sIdentity{}
	for rows.Next() {
		var item costK8sIdentity
		var started, ended sql.NullTime
		var cpuUsage, memUsage, alloc sql.NullString
		if err := rows.Scan(
			&item.PodUID, &item.PodName, &item.Namespace, &item.ControllerKind, &item.ControllerName, &item.WorkloadKey,
			&started, &ended, &item.Deleted, &item.CPURequest, &item.MemoryRequest, &cpuUsage, &memUsage, &alloc,
			&item.Currency, &item.Estimated, &item.LabelsJSON, &item.ManagedBy, &item.HPA, &item.VPA, &item.PDB,
		); err != nil {
			return nil, err
		}
		item.Owner = firstNonEmpty(item.Owner, costK8sOwnerFromLabels(item.LabelsJSON))
		if started.Valid {
			item.StartedAt = &started.Time
		}
		if ended.Valid {
			item.EndedAt = &ended.Time
		}
		if cpuUsage.Valid {
			item.CPUUsage = &cpuUsage.String
		}
		if memUsage.Valid {
			item.MemoryUsage = &memUsage.String
		}
		if alloc.Valid {
			item.AllocationTotal = &alloc.String
		}
		out = append(out, item)
	}
	return out, nil
}

func costK8sIdentityViews(items []costK8sIdentity, complete bool) []costK8sIdentityView {
	out := make([]costK8sIdentityView, 0, len(items))
	for _, item := range items {
		out = append(out, costK8sIdentityView{
			PodUID:            item.PodUID,
			PodName:           item.PodName,
			Namespace:         item.Namespace,
			ControllerKind:    item.ControllerKind,
			ControllerName:    item.ControllerName,
			WorkloadKey:       item.WorkloadKey,
			Deleted:           item.Deleted,
			CPURequest:        item.CPURequest,
			MemoryRequest:     item.MemoryRequest,
			CPUUsage:          costK8sMetricView(item.CPUUsage),
			MemoryUsage:       costK8sMetricView(item.MemoryUsage),
			AllocationTotal:   costK8sEstimatedView(item.AllocationTotal, complete),
			ManagedBy:         costK8sConstraintDisplay(item.ManagedBy),
			HPA:               costK8sConstraintDisplay(item.HPA),
			VPA:               costK8sConstraintDisplay(item.VPA),
			PDB:               costK8sConstraintDisplay(item.PDB),
			Owner:             costK8sConstraintDisplay(costK8sOwner(item)),
			Estimated:         true,
			AddedToCloudTotal: false,
		})
	}
	return out
}

func aggregateCostK8sWorkloads(items []costK8sIdentity, complete bool) []costK8sWorkloadView {
	type bucket struct {
		view     costK8sWorkloadView
		cpu      *string
		mem      *string
		alloc    *string
		cpuGap   bool
		memGap   bool
		allocGap bool
	}
	order := []string{}
	grouped := map[string]*bucket{}
	for _, item := range items {
		key := item.WorkloadKey
		if key == "" {
			key = costK8sWorkloadKey(item.Namespace, "pod", item.PodUID)
		}
		current, ok := grouped[key]
		if !ok {
			current = &bucket{view: costK8sWorkloadView{
				WorkloadKey:       key,
				Namespace:         item.Namespace,
				ControllerKind:    item.ControllerKind,
				ControllerName:    item.ControllerName,
				CPURequest:        item.CPURequest,
				MemoryRequest:     item.MemoryRequest,
				ManagedBy:         costK8sConstraintDisplay(item.ManagedBy),
				HPA:               costK8sConstraintDisplay(item.HPA),
				VPA:               costK8sConstraintDisplay(item.VPA),
				PDB:               costK8sConstraintDisplay(item.PDB),
				Owner:             costK8sConstraintDisplay(costK8sOwner(item)),
				Estimated:         true,
				AddedToCloudTotal: false,
			}}
			grouped[key] = current
			order = append(order, key)
		}
		current.view.ManagedBy = costK8sConstraintDisplay(costK8sPickConstraint(current.view.ManagedBy, item.ManagedBy))
		current.view.HPA = costK8sConstraintDisplay(costK8sPickConstraint(current.view.HPA, item.HPA))
		current.view.VPA = costK8sConstraintDisplay(costK8sPickConstraint(current.view.VPA, item.VPA))
		current.view.PDB = costK8sConstraintDisplay(costK8sPickConstraint(current.view.PDB, item.PDB))
		current.view.Owner = costK8sConstraintDisplay(costK8sPickConstraint(current.view.Owner, costK8sOwner(item)))
		if current.view.CPURequest == "" {
			current.view.CPURequest = item.CPURequest
		}
		if current.view.MemoryRequest == "" {
			current.view.MemoryRequest = item.MemoryRequest
		}
		current.view.PodCount++
		if item.Deleted {
			current.view.DeletedCount++
		}
		if item.CPUUsage == nil {
			current.cpuGap = true
		} else if current.cpu == nil {
			current.cpu = item.CPUUsage
		}
		if item.MemoryUsage == nil {
			current.memGap = true
		} else if current.mem == nil {
			current.mem = item.MemoryUsage
		}
		if item.AllocationTotal == nil {
			current.allocGap = true
		} else if current.alloc == nil {
			copied := *item.AllocationTotal
			current.alloc = &copied
		} else {
			sum := addCostAmounts(*current.alloc, *item.AllocationTotal)
			current.alloc = &sum
		}
	}
	out := make([]costK8sWorkloadView, 0, len(order))
	for _, key := range order {
		item := grouped[key]
		if item.cpuGap {
			item.view.CPUUsage = costK8sMetricView(nil)
		} else {
			item.view.CPUUsage = costK8sMetricView(item.cpu)
		}
		if item.memGap {
			item.view.MemoryUsage = costK8sMetricView(nil)
		} else {
			item.view.MemoryUsage = costK8sMetricView(item.mem)
		}
		if item.allocGap {
			item.view.AllocationTotal = costK8sEstimatedView(nil, complete)
		} else {
			item.view.AllocationTotal = costK8sEstimatedView(item.alloc, complete)
		}
		out = append(out, item.view)
	}
	return out
}

func buildCostK8sWorkloads(bindingID int) (map[string]any, error) {
	return buildCostK8sClusterViews(bindingID, "controller")
}

func buildCostK8sClusterViews(bindingID int, group string) (map[string]any, error) {
	snapshots, err := listCostK8sSnapshots(bindingID)
	if err != nil {
		return nil, err
	}
	if len(snapshots) == 0 {
		return map[string]any{
			"status":               "ok",
			"workloads":            []costK8sWorkloadView{},
			"pods":                 []costK8sIdentityView{},
			"allocations":          []costK8sAllocationGroup{},
			"missing_ownership":    []map[string]any{},
			"group_by":             costK8sAllocationGroupBy(group),
			"coverage":             "none",
			"added_to_cloud_total": false,
			"installs_opencost":    false,
			"worker_can_edit":      false,
			"estimated":            true,
			"list_price_labelled":  true,
			"note":                 "No snapshot yet. Missing history is Needs more data, not zero usage. HPA, VPA, PDB, and managed-by stay Unknown until inventory includes them.",
		}, nil
	}
	latest := snapshots[0]
	for _, item := range snapshots {
		if !item.Stale {
			latest = item
			break
		}
	}
	identities, err := listCostK8sIdentities(latest.ID)
	if err != nil {
		return nil, err
	}
	workloads := aggregateCostK8sWorkloads(identities, latest.Complete)
	return map[string]any{
		"status":               "ok",
		"snapshot":             latest,
		"workloads":            workloads,
		"pods":                 costK8sIdentityViews(identities, latest.Complete),
		"allocations":          groupCostK8sAllocations(identities, group, latest.Complete),
		"missing_ownership":    costK8sMissingOwnership(identities),
		"group_by":             costK8sAllocationGroupBy(group),
		"coverage":             costCoverage(len(identities) > 0, latest.Complete),
		"added_to_cloud_total": false,
		"installs_opencost":    false,
		"worker_can_edit":      false,
		"estimated":            true,
		"list_price_labelled":  true,
		"note":                 "Workload allocation is estimated/list price until billing is mapped. HPA, VPA, PDB, and managed-by stay visible even when Unknown. Deleted pods keep their UID. Missing metrics stay Needs more data.",
	}, nil
}

func buildCostK8sCollectionHealth(item *costK8sBinding) map[string]any {
	health := "unknown"
	var last *time.Time
	if item != nil {
		health = costK8sCollectorHealth(item.CollectorHealth)
		last = item.LastIngestedAt
		if health == "current" && (last == nil || time.Since(last.UTC()) > costStaleAfter) {
			health = "unknown"
		}
	}
	payload := map[string]any{
		"status":               "ok",
		"collector_health":     health,
		"last_ingested_at":     last,
		"public_scrape":        false,
		"installs_opencost":    false,
		"worker_can_edit":      false,
		"added_to_cloud_total": false,
		"list_price_labelled":  true,
		"pilot":                buildCostK8sPilot(item),
		"note":                 "Collector failure is Unknown, never Healthy. This product does not scrape OpenCost publicly and does not edit workloads.",
	}
	if item != nil {
		payload["inventory_readiness"] = costK8sLamp(item.InventoryReadiness)
		payload["metrics_readiness"] = costK8sLamp(item.MetricsReadiness)
		payload["allocation_readiness"] = costK8sLamp(item.AllocationReadiness)
		payload["billing_reconciled"] = costK8sLamp(item.BillingReconciled)
		payload["capability_gaps"] = item.Gaps
		payload["cluster_name"] = item.ClusterName
		payload["environment"] = item.Environment
	}
	return payload
}
