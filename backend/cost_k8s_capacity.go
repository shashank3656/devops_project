package main

import (
	"fmt"
	"math/big"
	"strconv"
	"strings"
)

type costK8sCapacityView struct {
	Display  string `json:"display"`
	CPU      string `json:"cpu"`
	Memory   string `json:"memory"`
	Coverage string `json:"coverage"`
}

func costK8sBillUnknown() map[string]any {
	return map[string]any{
		"display":              "Unknown",
		"amount":               nil,
		"coverage":             "none",
		"billed":               true,
		"estimated":            false,
		"added_to_cloud_total": false,
	}
}

func costK8sCapacityUnknown() costK8sCapacityView {
	return costK8sCapacityView{Display: "Unknown", CPU: "Unknown", Memory: "Unknown", Coverage: "none"}
}

func parseCostK8sCPUMillis(raw string) (int64, bool) {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" || raw == "needs more data" || raw == "unknown" || raw == "<nil>" {
		return 0, false
	}
	switch {
	case strings.HasSuffix(raw, "m"):
		n, err := strconv.ParseFloat(strings.TrimSuffix(raw, "m"), 64)
		if err != nil || n < 0 {
			return 0, false
		}
		return int64(n), true
	case strings.HasSuffix(raw, "n"):
		n, err := strconv.ParseFloat(strings.TrimSuffix(raw, "n"), 64)
		if err != nil || n < 0 {
			return 0, false
		}
		return int64(n / 1e6), true
	default:
		n, err := strconv.ParseFloat(raw, 64)
		if err != nil || n < 0 {
			return 0, false
		}
		return int64(n * 1000), true
	}
}

func parseCostK8sMemoryMi(raw string) (int64, bool) {
	raw = strings.TrimSpace(raw)
	lower := strings.ToLower(raw)
	if lower == "" || lower == "needs more data" || lower == "unknown" || lower == "<nil>" {
		return 0, false
	}
	mul := 1.0
	switch {
	case strings.HasSuffix(lower, "gi"):
		lower, mul = strings.TrimSuffix(lower, "gi"), 1024
	case strings.HasSuffix(lower, "mi"):
		lower, mul = strings.TrimSuffix(lower, "mi"), 1
	case strings.HasSuffix(lower, "ki"):
		lower, mul = strings.TrimSuffix(lower, "ki"), 1.0/1024
	case strings.HasSuffix(lower, "g"):
		lower, mul = strings.TrimSuffix(lower, "g"), 1024
	case strings.HasSuffix(lower, "m"):
		lower, mul = strings.TrimSuffix(lower, "m"), 1
	default:
		return 0, false
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(lower), 64)
	if err != nil || n < 0 {
		return 0, false
	}
	return int64(n * mul), true
}

func formatCostK8sCPUMillis(millis int64) string {
	return fmt.Sprintf("%dm", millis)
}

func formatCostK8sMemoryMi(mi int64) string {
	return fmt.Sprintf("%dMi", mi)
}

func costK8sMetricSample(view map[string]any) string {
	if view == nil {
		return ""
	}
	if amount, ok := view["amount"].(string); ok {
		return strings.TrimSpace(amount)
	}
	display, _ := view["display"].(string)
	if display == "Needs more data" || display == "Unknown" {
		return ""
	}
	return strings.TrimSpace(display)
}

func costK8sViewAmount(view map[string]any) *string {
	if view == nil {
		return nil
	}
	coverage, _ := view["coverage"].(string)
	amount, _ := view["amount"].(string)
	if coverage != "complete" || strings.TrimSpace(amount) == "" {
		return nil
	}
	copied := strings.TrimSpace(amount)
	return &copied
}

func costK8sAllocatedReduction(allocation *string, complete bool, requestMillis, usageMillis int64, cpuReady bool) map[string]any {
	if !complete || allocation == nil || !cpuReady || requestMillis <= 0 || usageMillis < 0 || usageMillis >= requestMillis {
		return costK8sEstimatedView(nil, false)
	}
	unused := requestMillis - usageMillis
	parsed, err := parseCostAmount(*allocation)
	if err != nil {
		return costK8sEstimatedView(nil, false)
	}
	allocRat, ok := new(big.Rat).SetString(parsed)
	if !ok {
		return costK8sEstimatedView(nil, false)
	}
	frac := new(big.Rat).SetFrac64(unused, requestMillis)
	allocRat.Mul(allocRat, frac)
	reduced := allocRat.FloatString(costMoneyScale)
	return costK8sEstimatedView(&reduced, true)
}

func costK8sCapacityReleased(requestCPU, usageCPU, requestMem, usageMem string) costK8sCapacityView {
	view := costK8sCapacityUnknown()
	cpuReady, memReady := false, false
	cpuUnused, memUnused := int64(0), int64(0)
	if req, reqOK := parseCostK8sCPUMillis(requestCPU); reqOK {
		if use, useOK := parseCostK8sCPUMillis(usageCPU); useOK {
			cpuReady = true
			if req > use {
				cpuUnused = req - use
			}
			view.CPU = formatCostK8sCPUMillis(cpuUnused)
		}
	}
	if req, reqOK := parseCostK8sMemoryMi(requestMem); reqOK {
		if use, useOK := parseCostK8sMemoryMi(usageMem); useOK {
			memReady = true
			if req > use {
				memUnused = req - use
			}
			view.Memory = formatCostK8sMemoryMi(memUnused)
		}
	}
	if !cpuReady && !memReady {
		return costK8sCapacityUnknown()
	}
	view.Coverage = "complete"
	parts := []string{}
	if cpuReady {
		parts = append(parts, view.CPU+" CPU")
	}
	if memReady {
		parts = append(parts, view.Memory+" memory")
	}
	view.Display = strings.Join(parts, " · ")
	return view
}

func costK8sRequestOnlySplit(requestCPU, usageCPU, requestMem, usageMem string, allocation *string, complete bool) (kind string, capacity costK8sCapacityView, allocated, billed map[string]any) {
	capacity = costK8sCapacityReleased(requestCPU, usageCPU, requestMem, usageMem)
	_, cpuReady := parseCostK8sCPUMillis(usageCPU)
	reqMillis, reqOK := parseCostK8sCPUMillis(requestCPU)
	useMillis, useOK := parseCostK8sCPUMillis(usageCPU)
	allocated = costK8sAllocatedReduction(allocation, complete, reqMillis, useMillis, reqOK && useOK && cpuReady)
	billed = costK8sBillUnknown()
	kind = "request_only"
	if capacity.Coverage != "complete" {
		kind = "needs_more_data"
	}
	return kind, capacity, allocated, billed
}

func costK8sIdleSplit(idle *string, complete bool) (capacity costK8sCapacityView, allocated, billed map[string]any) {
	return costK8sCapacityUnknown(), costK8sEstimatedView(idle, complete && idle != nil), costK8sBillUnknown()
}

func rollupCostK8sAllocatedReduction(recs []costK8sRecommendation) map[string]any {
	var total *string
	for _, rec := range recs {
		if rec.ChangeKind == "idle_list_price" {
			continue
		}
		amount := costK8sViewAmount(rec.AllocationReduction)
		if amount == nil {
			return costK8sEstimatedView(nil, false)
		}
		if total == nil {
			copied := *amount
			total = &copied
			continue
		}
		sum := addCostAmounts(*total, *amount)
		total = &sum
	}
	if total == nil {
		return costK8sEstimatedView(nil, false)
	}
	return costK8sEstimatedView(total, true)
}

func rollupCostK8sCapacityReleased(recs []costK8sRecommendation) costK8sCapacityView {
	cpu, mem := int64(0), int64(0)
	cpuOK, memOK := true, true
	sawCPU, sawMem := false, false
	for _, rec := range recs {
		if rec.ChangeKind == "idle_list_price" {
			continue
		}
		if rec.CapacityReleased.Coverage != "complete" {
			return costK8sCapacityUnknown()
		}
		if rec.CapacityReleased.CPU != "Unknown" && rec.CapacityReleased.CPU != "" {
			millis, ok := parseCostK8sCPUMillis(rec.CapacityReleased.CPU)
			if !ok {
				cpuOK = false
			} else {
				cpu += millis
				sawCPU = true
			}
		}
		if rec.CapacityReleased.Memory != "Unknown" && rec.CapacityReleased.Memory != "" {
			mi, ok := parseCostK8sMemoryMi(rec.CapacityReleased.Memory)
			if !ok {
				memOK = false
			} else {
				mem += mi
				sawMem = true
			}
		}
	}
	if (!sawCPU && !sawMem) || !cpuOK || !memOK {
		return costK8sCapacityUnknown()
	}
	view := costK8sCapacityView{Coverage: "complete", CPU: "Unknown", Memory: "Unknown"}
	parts := []string{}
	if sawCPU {
		view.CPU = formatCostK8sCPUMillis(cpu)
		parts = append(parts, view.CPU+" CPU")
	}
	if sawMem {
		view.Memory = formatCostK8sMemoryMi(mem)
		parts = append(parts, view.Memory+" memory")
	}
	view.Display = strings.Join(parts, " · ")
	return view
}

func collectCostK8sCapacityCalculations(userID int) []costCalculation {
	if DB == nil {
		return nil
	}
	bindings, err := listCostK8sBindings(userID)
	if err != nil {
		return nil
	}
	out := []costCalculation{}
	for _, binding := range bindings {
		payload, optErr := buildCostK8sOptimization(binding.ID)
		if optErr != nil {
			continue
		}
		recs, _ := payload["recommendations"].([]costK8sRecommendation)
		for _, rec := range recs {
			amount := ""
			coverage := "incomplete"
			if value := costK8sViewAmount(rec.BillReduction); value != nil {
				amount = *value
				coverage = "complete"
			}
			out = append(out, costCalculation{
				CalcID:     rec.CalcID,
				Kind:       "k8s_" + rec.ChangeKind,
				ResourceID: rec.WorkloadKey,
				Coverage:   coverage,
				Amount:     amount,
				Note:       rec.Calculation,
			})
		}
	}
	return out
}
