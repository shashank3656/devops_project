package main

import (
	"database/sql"
	"strings"
)

type costK8sNode struct {
	Name          string `json:"name"`
	ProviderID    string `json:"provider_id"`
	InstanceID    string `json:"instance_id"`
	InstanceClass string `json:"instance_class,omitempty"`
	Zone          string `json:"zone,omitempty"`
	PurchaseModel string `json:"purchase_model,omitempty"`
}

type costK8sMappedLine struct {
	ResourceID string `json:"resource_id"`
	Service    string `json:"service"`
	Kind       string `json:"kind"`
	Amount     string `json:"amount"`
}

func extractCostK8sInstanceID(providerID string) string {
	value := strings.TrimSpace(providerID)
	if value == "" {
		return ""
	}
	value = strings.ReplaceAll(value, "\\", "/")
	if i := strings.LastIndex(value, "/"); i >= 0 && i+1 < len(value) {
		value = value[i+1:]
	}
	value = strings.TrimSpace(value)
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "i-") && len(value) < 10 {
		return ""
	}
	if len(value) < 4 {
		return ""
	}
	return value
}

func costK8sLineMapsToInstance(line costLineRow, instanceID string) bool {
	id := strings.ToLower(strings.TrimSpace(instanceID))
	resource := strings.ToLower(strings.TrimSpace(line.ResourceID))
	if id == "" || resource == "" || len(id) < 8 {
		return false
	}
	return resource == id || strings.Contains(resource, id)
}

func costK8sBilledKind(service string) string {
	value := strings.ToLower(service)
	switch {
	case strings.Contains(value, "gpu"):
		return "gpu"
	case strings.Contains(value, "elastic load") || strings.Contains(value, "data transfer") || strings.Contains(value, "nat gateway") || strings.Contains(value, "vpc"):
		return "network"
	case strings.Contains(value, "elastic block") || strings.Contains(value, "persistent disk") || strings.Contains(value, "blob"):
		return "disk"
	case strings.Contains(value, "eks") || strings.Contains(value, "gke") || strings.Contains(value, "aks") || strings.Contains(value, "control plane"):
		return "control_plane"
	case strings.Contains(value, "elastic compute") || strings.Contains(value, "virtual machine") || strings.Contains(value, "compute engine"):
		return "compute"
	default:
		return "other"
	}
}

func costK8sIdleName(namespace, name, kind string) bool {
	joined := strings.ToLower(strings.TrimSpace(namespace) + " " + strings.TrimSpace(name) + " " + strings.TrimSpace(kind))
	return strings.Contains(joined, "__idle__") || strings.TrimSpace(strings.ToLower(namespace)) == "idle" || strings.Contains(joined, "idle-cost")
}

func costK8sSharedName(namespace, kind string) bool {
	ns := strings.ToLower(strings.TrimSpace(namespace))
	k := strings.ToLower(strings.TrimSpace(kind))
	return ns == "kube-system" || ns == "__shared__" || k == "daemonset"
}

func addCostOptional(left, right *string) *string {
	if left == nil && right == nil {
		return nil
	}
	sum := addCostAmounts(optionalCostAmount(left), optionalCostAmount(right))
	return &sum
}

func optionalCostAmount(value *string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return "0." + strings.Repeat("0", costMoneyScale)
	}
	parsed, err := parseCostAmount(*value)
	if err != nil {
		return "0." + strings.Repeat("0", costMoneyScale)
	}
	return parsed
}

func distributeCostK8sIdle(workload, idle, shared, unallocated string, distribute bool) (string, string, string, string, string) {
	zero := "0." + strings.Repeat("0", costMoneyScale)
	if workload == "" {
		workload = zero
	}
	if idle == "" {
		idle = zero
	}
	if shared == "" {
		shared = zero
	}
	if unallocated == "" {
		unallocated = zero
	}
	total := addCostAmounts(addCostAmounts(workload, idle), addCostAmounts(shared, unallocated))
	if !distribute {
		return workload, idle, shared, unallocated, total
	}
	idleParsed, _ := parseCostAmount(idle)
	workParsed, _ := parseCostAmount(workload)
	if idleParsed == zero || workParsed == zero {
		return workload, idle, shared, unallocated, total
	}
	nextWorkload := addCostAmounts(workload, idle)
	nextTotal := addCostAmounts(addCostAmounts(nextWorkload, zero), addCostAmounts(shared, unallocated))
	if nextTotal != total {
		return workload, idle, shared, unallocated, total
	}
	return nextWorkload, zero, shared, unallocated, total
}

func splitCostK8sBilled(lines []costLineRow, nodes []costK8sNode, basis string) (mapped, unmapped string, mappedLines, unmappedLines []costK8sMappedLine, kinds map[string]string) {
	basis = normalizeCostBasis(basis)
	zero := "0." + strings.Repeat("0", costMoneyScale)
	mapped, unmapped = zero, zero
	kinds = map[string]string{}
	ids := make([]string, 0, len(nodes))
	for _, node := range nodes {
		if id := extractCostK8sInstanceID(firstNonEmpty(node.InstanceID, node.ProviderID)); id != "" {
			ids = append(ids, id)
		}
	}
	for _, line := range lines {
		amount := line.Actual
		if basis == "amortized" {
			amount = line.Amortized
		}
		if amount == "" {
			amount = line.Amount
		}
		hit := false
		for _, id := range ids {
			if costK8sLineMapsToInstance(line, id) {
				hit = true
				break
			}
		}
		item := costK8sMappedLine{ResourceID: line.ResourceID, Service: line.Service, Kind: costK8sBilledKind(line.Service), Amount: amount}
		if hit {
			mapped = addCostAmounts(mapped, amount)
			mappedLines = append(mappedLines, item)
			if item.Kind == "gpu" || item.Kind == "network" {
				kinds[item.Kind] = "Mapped " + item.Kind + " stays a coverage gap until a dedicated allocation model exists."
			}
		} else {
			unmapped = addCostAmounts(unmapped, amount)
			unmappedLines = append(unmappedLines, item)
		}
	}
	return mapped, unmapped, mappedLines, unmappedLines, kinds
}

func costK8sWindowsLikeForLike(snapshotStart, snapshotEnd, billedStart, billedEnd string) bool {
	snapStart, err1 := costK8sParseTime(snapshotStart)
	snapEnd, err2 := costK8sParseTime(snapshotEnd)
	billStart, err3 := costParseDate(billedStart)
	billEnd, err4 := costParseDate(billedEnd)
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
		return false
	}
	return snapStart.UTC().Format("2006-01-02") == billStart.Format("2006-01-02") && snapEnd.UTC().Format("2006-01-02") == billEnd.Format("2006-01-02")
}

func reconcileCostK8s(nodes []costK8sNode, identities []costK8sIdentity, idle, shared, unallocated *string, lines []costLineRow, billedCoverage, basis, currency string, billedStart, billedEnd, snapshotStart, snapshotEnd string, snapshotComplete, distributeIdle bool) map[string]any {
	basis = normalizeCostBasis(basis)
	currency = normalizeCostCurrency(currency)
	mapped, unmapped, mappedLines, _, gaps := splitCostK8sBilled(lines, nodes, basis)
	workload := (*string)(nil)
	idleAmt, sharedAmt := idle, shared
	unallocAmt := unallocated
	for _, item := range identities {
		switch {
		case costK8sIdleName(item.Namespace, item.PodName, item.ControllerKind):
			idleAmt = addCostOptional(idleAmt, item.AllocationTotal)
		case costK8sSharedName(item.Namespace, item.ControllerKind):
			sharedAmt = addCostOptional(sharedAmt, item.AllocationTotal)
		default:
			workload = addCostOptional(workload, item.AllocationTotal)
		}
	}
	w := optionalCostAmount(workload)
	i := optionalCostAmount(idleAmt)
	s := optionalCostAmount(sharedAmt)
	u := optionalCostAmount(unallocAmt)
	w, i, s, u, estTotal := distributeCostK8sIdle(w, i, s, u, distributeIdle)
	like := costK8sWindowsLikeForLike(snapshotStart, snapshotEnd, billedStart, billedEnd)
	billedComplete := billedCoverage == "complete" && len(lines) > 0
	estimatedComplete := snapshotComplete && (workload != nil || idleAmt != nil || sharedAmt != nil || unallocAmt != nil)
	residualCoverage := "none"
	if billedComplete && estimatedComplete && like {
		residualCoverage = "complete"
	}
	reconciled := "unknown"
	if billedComplete && snapshotComplete && like && len(mappedLines) > 0 {
		reconciled = "ready"
	}
	note := "Kubernetes billed spend is a breakdown of the parent cloud bill. It is never added again. Estimated/list price is not the invoice. Unmapped billed resources stay on the parent ledger."
	if !like {
		note = "Snapshot window and billed window are not like-for-like. Residual stays Needs more data. " + note
	}
	unsupported := []string{}
	for _, msg := range gaps {
		unsupported = append(unsupported, msg)
	}
	cloudTotal := ""
	for _, line := range lines {
		amount := line.Actual
		if basis == "amortized" {
			amount = line.Amortized
		}
		cloudTotal = addCostAmounts(cloudTotal, amount)
	}
	if combineCloudAndKubernetesTotal(cloudTotal, mapped) != cloudTotal {
		note = "Cluster billed amounts must not be added to the cloud total."
	}
	return map[string]any{
		"status":                "ok",
		"basis":                 basis,
		"currency":              currency,
		"distribute_idle":       distributeIdle,
		"billing_reconciled":    costK8sLamp(reconciled),
		"like_for_like":         like,
		"added_to_cloud_total":  false,
		"installs_opencost":     false,
		"worker_can_edit":       false,
		"billed_mapped":         costMoneyView(costCoverage(len(mappedLines) > 0, billedComplete && like), mapped, currency, basis),
		"billed_unmapped":       costMoneyView(costCoverage(len(lines) > 0, billedComplete), unmapped, currency, basis),
		"estimated_workload":    costK8sEstimatedView(ptrIfAmount(w, workload != nil || distributeIdle), snapshotComplete),
		"estimated_idle":        costK8sEstimatedView(ptrIfAmount(i, idleAmt != nil || distributeIdle), snapshotComplete),
		"estimated_shared":      costK8sEstimatedView(ptrIfAmount(s, sharedAmt != nil), snapshotComplete),
		"estimated_unallocated": costK8sEstimatedView(ptrIfAmount(u, unallocAmt != nil), snapshotComplete),
		"estimated_total":       costK8sEstimatedView(ptrIfAmount(estTotal, workload != nil || idleAmt != nil || sharedAmt != nil || unallocAmt != nil), snapshotComplete),
		"idle_share":            costK8sIdleShare(ptrIfAmount(i, idleAmt != nil || distributeIdle), ptrIfAmount(estTotal, workload != nil || idleAmt != nil || sharedAmt != nil || unallocAmt != nil), snapshotComplete),
		"list_price_labelled":   true,
		"residual":              costMoneyView(residualCoverage, subCostAmounts(mapped, estTotal), currency, basis),
		"mapped_resources":      mappedLines,
		"unsupported_gaps":      unsupported,
		"node_count":            len(nodes),
		"mapped_resource_count": len(mappedLines),
		"note":                  note,
	}
}

func ptrIfAmount(amount string, present bool) *string {
	if !present {
		return nil
	}
	copied := amount
	return &copied
}

func parseCostK8sNodes(raw []map[string]any) []costK8sNode {
	out := []costK8sNode{}
	for _, row := range raw {
		provider := costRawString(row, "provider_id", "providerID", "spec.providerID")
		instance := extractCostK8sInstanceID(firstNonEmpty(costRawString(row, "instance_id", "instanceID"), provider))
		out = append(out, costK8sNode{
			Name:          costRawString(row, "name", "node", "node_name"),
			ProviderID:    provider,
			InstanceID:    instance,
			InstanceClass: costRawString(row, "instance_class", "instanceType", "instance_type"),
			Zone:          costRawString(row, "zone", "failure-domain.beta.kubernetes.io/zone"),
			PurchaseModel: strings.ToLower(costRawString(row, "purchase_model", "capacityType", "capacity_type")),
		})
	}
	return out
}

func loadCostK8sSnapshotEstimates(snapshotID int) (idle, shared, unallocated *string) {
	if DB == nil || snapshotID <= 0 {
		return nil, nil, nil
	}
	var a, b, c sql.NullString
	err := DB.QueryRow(`SELECT idle_estimated, shared_estimated, unallocated_estimated FROM cost_k8s_snapshots WHERE id = $1`, snapshotID).Scan(&a, &b, &c)
	if err != nil {
		return nil, nil, nil
	}
	if a.Valid {
		idle = &a.String
	}
	if b.Valid {
		shared = &b.String
	}
	if c.Valid {
		unallocated = &c.String
	}
	return idle, shared, unallocated
}

func loadCostK8sNodes(snapshotID int) ([]costK8sNode, error) {
	if DB == nil {
		return []costK8sNode{}, nil
	}
	rows, err := DB.Query(`
		SELECT COALESCE(node_name,''), COALESCE(provider_id,''), COALESCE(instance_id,''),
		       COALESCE(instance_class,''), COALESCE(zone,''), COALESCE(purchase_model,'')
		  FROM cost_k8s_nodes WHERE snapshot_id = $1 ORDER BY node_name, instance_id
	`, snapshotID)
	if err != nil {
		if isMissingDatabaseRelation(err, "cost_k8s_nodes") {
			return []costK8sNode{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []costK8sNode{}
	for rows.Next() {
		var item costK8sNode
		if err := rows.Scan(&item.Name, &item.ProviderID, &item.InstanceID, &item.InstanceClass, &item.Zone, &item.PurchaseModel); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}

func loadLatestCostLinesByConnection(connectionID int, basis string) ([]costLineRow, string, string, string, error) {
	if connectionID <= 0 {
		return []costLineRow{}, "none", "", "", nil
	}
	rev, start, end, complete, err := latestCostRevision(connectionID)
	if err != nil {
		return nil, "none", "", "", err
	}
	if rev == 0 {
		return []costLineRow{}, "none", "", "", nil
	}
	lines, err := loadCostLines([]int{connectionID}, map[int]int{connectionID: rev}, basis, costLineQuery{})
	if err != nil {
		return nil, "none", "", "", err
	}
	coverage := costCoverage(len(lines) > 0, complete)
	return lines, coverage, start.Format("2006-01-02"), end.Format("2006-01-02"), nil
}

func buildCostK8sReconciliation(userID, bindingID int, basis string, distributeIdle bool) (map[string]any, error) {
	item, err := getCostK8sBinding(userID, bindingID)
	if err != nil {
		return nil, err
	}
	snapshots, err := listCostK8sSnapshots(bindingID)
	if err != nil {
		return nil, err
	}
	if len(snapshots) == 0 {
		return map[string]any{
			"status":               "ok",
			"billing_reconciled":   "unknown",
			"added_to_cloud_total": false,
			"note":                 "No snapshot yet. Billing reconciled stays Unknown. Cluster spend is not added to the cloud total.",
		}, nil
	}
	latest := snapshots[0]
	for _, snap := range snapshots {
		if !snap.Stale {
			latest = snap
			break
		}
	}
	nodes, err := loadCostK8sNodes(latest.ID)
	if err != nil {
		return nil, err
	}
	identities, err := listCostK8sIdentities(latest.ID)
	if err != nil {
		return nil, err
	}
	if latest.IdleEstimated == nil && latest.SharedEstimated == nil && latest.UnallocatedEstimated == nil {
		latest.IdleEstimated, latest.SharedEstimated, latest.UnallocatedEstimated = loadCostK8sSnapshotEstimates(latest.ID)
	}
	lines, billedCoverage, billedStart, billedEnd, err := loadLatestCostLinesByConnection(item.CostConnectionID, basis)
	if err != nil {
		return nil, err
	}
	result := reconcileCostK8s(nodes, identities, latest.IdleEstimated, latest.SharedEstimated, latest.UnallocatedEstimated, lines, billedCoverage, basis, "USD", billedStart, billedEnd, latest.WindowStart, latest.WindowEnd, latest.Complete, distributeIdle)
	result["cluster"] = item
	result["snapshot"] = latest
	if lamp, _ := result["billing_reconciled"].(string); lamp != "" {
		_, _ = DB.Exec(`UPDATE cost_k8s_bindings SET billing_reconciled = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, bindingID, lamp)
		item.BillingReconciled = lamp
		result["cluster"] = item
	}
	return result, nil
}
