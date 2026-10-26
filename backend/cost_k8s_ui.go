package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
)

type costK8sAllocationGroup struct {
	GroupKey          string         `json:"group_key"`
	GroupBy           string         `json:"group_by"`
	Namespace         string         `json:"namespace"`
	ControllerKind    string         `json:"controller_kind,omitempty"`
	ControllerName    string         `json:"controller_name,omitempty"`
	Owner             string         `json:"owner"`
	MissingOwnership  bool           `json:"missing_ownership"`
	PodCount          int            `json:"pod_count"`
	WorkloadCount     int            `json:"workload_count"`
	ManagedBy         string         `json:"managed_by"`
	HPA               string         `json:"hpa"`
	VPA               string         `json:"vpa"`
	PDB               string         `json:"pdb"`
	AllocationTotal   map[string]any `json:"allocation_total"`
	Estimated         bool           `json:"estimated"`
	AddedToCloudTotal bool           `json:"added_to_cloud_total"`
}

type costK8sRecommendation struct {
	CalcID              string              `json:"calc_id"`
	WorkloadKey         string              `json:"workload_key"`
	Namespace           string              `json:"namespace"`
	ControllerName      string              `json:"controller_name"`
	FindingType         string              `json:"finding_type"`
	ChangeKind          string              `json:"change_kind"`
	Status              string              `json:"status"`
	Lifecycle           string              `json:"lifecycle"`
	Evidence            string              `json:"evidence"`
	ProposedAction      string              `json:"proposed_action"`
	Calculation         string              `json:"calculation"`
	BlockedReason       string              `json:"blocked_reason,omitempty"`
	ManagedBy           string              `json:"managed_by"`
	HPA                 string              `json:"hpa"`
	VPA                 string              `json:"vpa"`
	PDB                 string              `json:"pdb"`
	CPUUsage            map[string]any      `json:"cpu_usage"`
	AllocationTotal     map[string]any      `json:"allocation_total"`
	AllocationReduction map[string]any      `json:"allocation_reduction"`
	BillReduction       map[string]any      `json:"bill_reduction"`
	CapacityReleased    costK8sCapacityView `json:"capacity_released"`
	Savings             map[string]any      `json:"savings"`
	InventsSKU          bool                `json:"invents_sku"`
	CandidateSKU        string              `json:"candidate_sku"`
	Executes            bool                `json:"executes"`
	WorkerCanEdit       bool                `json:"worker_can_edit"`
	Estimated           bool                `json:"estimated"`
	AddedToCloudTotal   bool                `json:"added_to_cloud_total"`
	Note                string              `json:"note"`
}

func costK8sConstraintDisplay(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.EqualFold(value, "unknown") {
		return "Unknown"
	}
	return value
}

func costK8sConstraintPresent(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && !strings.EqualFold(value, "unknown")
}

func costK8sPickConstraint(current, next string) string {
	if costK8sConstraintPresent(current) {
		return strings.TrimSpace(current)
	}
	return strings.TrimSpace(next)
}

func costK8sNamedConstraint(raw map[string]any, keys ...string) string {
	if text := costRawString(raw, keys...); text != "" {
		return text
	}
	for _, key := range keys {
		nested, ok := raw[key].(map[string]any)
		if !ok {
			continue
		}
		if name := firstNonEmpty(costRawString(nested, "name", "targetRef", "minAvailable", "updateMode")); name != "" {
			return name
		}
	}
	return ""
}

func costK8sConstraintValue(row, labels map[string]any, rowKeys, labelKeys []string) string {
	return firstNonEmpty(costK8sNamedConstraint(row, rowKeys...), costRawString(labels, labelKeys...))
}

func costK8sOwnerFromLabels(labelsJSON string) string {
	labelsJSON = strings.TrimSpace(labelsJSON)
	if labelsJSON == "" {
		return ""
	}
	var labels map[string]string
	if err := json.Unmarshal([]byte(labelsJSON), &labels); err != nil {
		return ""
	}
	return firstNonEmpty(labels["team"], labels["owner"], labels["app.kubernetes.io/team"])
}

func costK8sOwner(item costK8sIdentity) string {
	return firstNonEmpty(strings.TrimSpace(item.Owner), costK8sOwnerFromLabels(item.LabelsJSON))
}

func costK8sAllocationGroupBy(group string) string {
	switch strings.ToLower(strings.TrimSpace(group)) {
	case "controller", "workload":
		return "controller"
	case "team", "owner":
		return "team"
	default:
		return "namespace"
	}
}

func groupCostK8sAllocations(items []costK8sIdentity, group string, complete bool) []costK8sAllocationGroup {
	group = costK8sAllocationGroupBy(group)
	type bucket struct {
		view      costK8sAllocationGroup
		alloc     *string
		allocGap  bool
		workloads map[string]bool
	}
	order := []string{}
	grouped := map[string]*bucket{}
	for _, item := range items {
		owner := costK8sOwner(item)
		key := item.Namespace
		if key == "" {
			key = "unknown"
		}
		namespace := item.Namespace
		controllerKind := ""
		controllerName := ""
		missing := owner == ""
		switch group {
		case "controller":
			key = item.WorkloadKey
			if key == "" {
				key = costK8sWorkloadKey(item.Namespace, "pod", item.PodUID)
			}
			controllerKind = item.ControllerKind
			controllerName = item.ControllerName
		case "team":
			if owner == "" {
				key = "unassigned"
			} else {
				key = "team|" + owner
			}
		}
		current, ok := grouped[key]
		if !ok {
			current = &bucket{
				view: costK8sAllocationGroup{
					GroupKey:          key,
					GroupBy:           group,
					Namespace:         namespace,
					ControllerKind:    controllerKind,
					ControllerName:    controllerName,
					Owner:             costK8sConstraintDisplay(owner),
					MissingOwnership:  missing,
					ManagedBy:         costK8sConstraintDisplay(item.ManagedBy),
					HPA:               costK8sConstraintDisplay(item.HPA),
					VPA:               costK8sConstraintDisplay(item.VPA),
					PDB:               costK8sConstraintDisplay(item.PDB),
					Estimated:         true,
					AddedToCloudTotal: false,
				},
				workloads: map[string]bool{},
			}
			grouped[key] = current
			order = append(order, key)
		}
		current.view.MissingOwnership = current.view.MissingOwnership || missing
		if !current.view.MissingOwnership {
			current.view.Owner = costK8sConstraintDisplay(costK8sPickConstraint(current.view.Owner, owner))
		} else {
			current.view.Owner = "Unknown"
		}
		current.view.ManagedBy = costK8sConstraintDisplay(costK8sPickConstraint(current.view.ManagedBy, item.ManagedBy))
		current.view.HPA = costK8sConstraintDisplay(costK8sPickConstraint(current.view.HPA, item.HPA))
		current.view.VPA = costK8sConstraintDisplay(costK8sPickConstraint(current.view.VPA, item.VPA))
		current.view.PDB = costK8sConstraintDisplay(costK8sPickConstraint(current.view.PDB, item.PDB))
		current.view.PodCount++
		if item.WorkloadKey != "" {
			current.workloads[item.WorkloadKey] = true
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
	out := make([]costK8sAllocationGroup, 0, len(order))
	for _, key := range order {
		item := grouped[key]
		item.view.WorkloadCount = len(item.workloads)
		if item.allocGap {
			item.view.AllocationTotal = costK8sEstimatedView(nil, complete)
		} else {
			item.view.AllocationTotal = costK8sEstimatedView(item.alloc, complete)
		}
		out = append(out, item.view)
	}
	return out
}

func costK8sMissingOwnership(items []costK8sIdentity) []map[string]any {
	seen := map[string]bool{}
	out := []map[string]any{}
	for _, item := range items {
		if costK8sOwner(item) != "" {
			continue
		}
		key := item.WorkloadKey
		if key == "" {
			key = item.PodUID
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, map[string]any{
			"workload_key":      key,
			"namespace":         item.Namespace,
			"controller_name":   item.ControllerName,
			"owner":             "Unknown",
			"missing_ownership": true,
			"managed_by":        costK8sConstraintDisplay(item.ManagedBy),
			"hpa":               costK8sConstraintDisplay(item.HPA),
			"vpa":               costK8sConstraintDisplay(item.VPA),
			"pdb":               costK8sConstraintDisplay(item.PDB),
		})
	}
	return out
}

func costK8sIdleShare(idle, total *string, complete bool) map[string]any {
	view := map[string]any{
		"display":  "Unknown",
		"percent":  nil,
		"coverage": "none",
		"amount":   nil,
	}
	if !complete || idle == nil || total == nil {
		return view
	}
	idleAmt, idleErr := parseCostAmount(*idle)
	totalAmt, totalErr := parseCostAmount(*total)
	if idleErr != nil || totalErr != nil || totalAmt == "0."+strings.Repeat("0", costMoneyScale) {
		return view
	}
	tr, ir := new(big.Rat), new(big.Rat)
	if _, ok := tr.SetString(totalAmt); !ok {
		return view
	}
	if _, ok := ir.SetString(idleAmt); !ok {
		return view
	}
	pct := new(big.Rat).Quo(ir, tr)
	pct.Mul(pct, big.NewRat(100, 1))
	shown := pct.FloatString(0)
	view["coverage"] = "complete"
	view["percent"] = shown
	view["display"] = shown + "%"
	return view
}

func costK8sOptimizationFromWorkloads(workloads []costK8sWorkloadView, idle *string, complete bool) []costK8sRecommendation {
	out := make([]costK8sRecommendation, 0, len(workloads)+1)
	for _, item := range workloads {
		cpuDisplay := fmt.Sprint(item.CPUUsage["display"])
		metricsReady := cpuDisplay != "" && cpuDisplay != "Needs more data" && cpuDisplay != "Unknown"
		blocked := []string{}
		if costK8sConstraintPresent(item.VPA) {
			blocked = append(blocked, "VPA manages requests. Manual request changes stay blocked.")
		}
		if costK8sConstraintPresent(item.HPA) {
			blocked = append(blocked, "HPA manages replica or CPU targets. Manual scale-down stays blocked.")
		}
		if costK8sConstraintPresent(item.PDB) {
			blocked = append(blocked, "PDB is a reliability constraint. Drain or consolidation stays blocked.")
		}
		if costK8sConstraintPresent(item.ManagedBy) {
			blocked = append(blocked, "A managed-by controller owns this workload. The worker cannot edit it.")
		}
		if !metricsReady {
			blocked = append(blocked, "Missing usage stays Needs more data. Rightsizing is blocked.")
		}
		status := "under_review"
		lifecycle := "detected"
		finding := "request_only"
		if !metricsReady {
			finding = "needs_more_data"
		}
		if len(blocked) > 0 {
			status = "blocked"
			lifecycle = "blocked"
		}
		kind, capacity, allocated, billed := costK8sRequestOnlySplit(
			item.CPURequest, costK8sMetricSample(item.CPUUsage),
			item.MemoryRequest, costK8sMetricSample(item.MemoryUsage),
			costK8sViewAmount(item.AllocationTotal), complete,
		)
		calcID := costCalcID("k8s", "request_only", item.WorkloadKey)
		out = append(out, costK8sRecommendation{
			CalcID:              calcID,
			WorkloadKey:         item.WorkloadKey,
			Namespace:           item.Namespace,
			ControllerName:      item.ControllerName,
			FindingType:         finding,
			ChangeKind:          kind,
			Status:              status,
			Lifecycle:           lifecycle,
			Evidence:            "Requests " + firstNonEmpty(item.CPURequest, "Unknown") + " vs usage " + firstNonEmpty(cpuDisplay, "Needs more data") + ". Allocation is estimated/list price.",
			ProposedAction:      "Review request versus usage. A request-only change reports capacity, not cash. Candidate SKU is not priced.",
			Calculation:         calcID + " request-only reports capacity, not cash. Allocated reduction is Estimated/list price. Potential bill savings stay Unknown. Candidate SKU is not priced.",
			BlockedReason:       strings.Join(blocked, " "),
			ManagedBy:           costK8sConstraintDisplay(item.ManagedBy),
			HPA:                 costK8sConstraintDisplay(item.HPA),
			VPA:                 costK8sConstraintDisplay(item.VPA),
			PDB:                 costK8sConstraintDisplay(item.PDB),
			CPUUsage:            item.CPUUsage,
			AllocationTotal:     item.AllocationTotal,
			AllocationReduction: allocated,
			BillReduction:       billed,
			CapacityReleased:    capacity,
			Savings:             billed,
			InventsSKU:          false,
			CandidateSKU:        "",
			Executes:            false,
			WorkerCanEdit:       false,
			Estimated:           true,
			AddedToCloudTotal:   false,
			Note:                "Allocated reduction, potential bill savings, and capacity released stay separate. Request-only change reports capacity, not cash. The worker cannot edit workloads.",
		})
	}
	if idle != nil {
		capacity, allocated, billed := costK8sIdleSplit(idle, complete)
		calcID := costCalcID("k8s", "idle_list_price")
		out = append(out, costK8sRecommendation{
			CalcID:              calcID,
			WorkloadKey:         "__idle__",
			Namespace:           "",
			ControllerName:      "Idle",
			FindingType:         "idle_list_price",
			ChangeKind:          "idle_list_price",
			Status:              "blocked",
			Lifecycle:           "blocked",
			Evidence:            "Idle estimated is list-price OpenCost allocation, not a billed node.",
			ProposedAction:      "Do not drain or delete a node from idle list-price. Candidate SKU is not priced.",
			Calculation:         calcID + " idle estimated is not a billed saving. Candidate SKU is not priced. This product does not invent SKUs.",
			BlockedReason:       "Idle list-price is not permission to remove a node. Candidate SKU is not priced.",
			ManagedBy:           "Unknown",
			HPA:                 "Unknown",
			VPA:                 "Unknown",
			PDB:                 "Unknown",
			AllocationReduction: allocated,
			BillReduction:       billed,
			CapacityReleased:    capacity,
			Savings:             billed,
			InventsSKU:          false,
			CandidateSKU:        "",
			Executes:            false,
			WorkerCanEdit:       false,
			Estimated:           true,
			AddedToCloudTotal:   false,
			Note:                "Idle estimated is list-price. Potential bill savings stay Unknown until a mapped instance would actually leave the bill.",
		})
	}
	return out
}

func buildCostK8sOptimization(bindingID int) (map[string]any, error) {
	payload, err := buildCostK8sWorkloads(bindingID)
	if err != nil {
		return nil, err
	}
	workloads, _ := payload["workloads"].([]costK8sWorkloadView)
	complete := false
	var idle *string
	if snap, ok := payload["snapshot"].(costK8sSnapshotRow); ok {
		complete = snap.Complete
		idle, _, _ = loadCostK8sSnapshotEstimates(snap.ID)
	} else if snap, ok := payload["snapshot"].(*costK8sSnapshotRow); ok && snap != nil {
		complete = snap.Complete
		idle, _, _ = loadCostK8sSnapshotEstimates(snap.ID)
	}
	recs := costK8sOptimizationFromWorkloads(workloads, idle, complete)
	return map[string]any{
		"status":               "ok",
		"recommendations":      recs,
		"allocated_reduction":  rollupCostK8sAllocatedReduction(recs),
		"bill_reduction":       costK8sBillUnknown(),
		"capacity_released":    rollupCostK8sCapacityReleased(recs),
		"invents_sku":          false,
		"candidate_sku":        "",
		"executes":             false,
		"worker_can_edit":      false,
		"estimated":            true,
		"list_price_labelled":  true,
		"added_to_cloud_total": false,
		"installs_opencost":    false,
		"note":                 "Allocated reduction, potential bill savings, and capacity released stay separate. Request-only change reports capacity, not cash. Copilot cannot invent SKUs.",
	}, nil
}
