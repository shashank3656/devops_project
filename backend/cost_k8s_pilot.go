package main

import (
	"fmt"
	"strings"
	"time"
)

func costK8sEnvironmentIsNonprod(env string) bool {
	value := strings.ToLower(strings.TrimSpace(env))
	value = strings.ReplaceAll(value, "_", "-")
	switch value {
	case "nonprod", "non-prod", "nonproduction", "non-production",
		"dev", "development", "staging", "stage", "test", "qa", "uat", "sandbox", "preview":
		return true
	default:
		return false
	}
}

func costK8sWorkerActionAllowed(action string) bool {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "restart", "scale", "resume", "drain", "delete", "exec", "terminal", "patch", "apply":
		return false
	default:
		return false
	}
}

func costK8sWorkerCanEditForAccess(_ string) bool {
	return false
}

func costK8sCollectorHealthAfterRestart(stored string, lastIngested *time.Time) string {
	health := costK8sCollectorHealth(stored)
	if lastIngested == nil {
		return "unknown"
	}
	if health == "current" && time.Since(lastIngested.UTC()) > costStaleAfter {
		return "unknown"
	}
	if health != "current" {
		return "unknown"
	}
	return health
}

func costK8sPilotOverhead() map[string]any {
	return map[string]any{
		"status":            "unknown",
		"display":           "Unknown",
		"installs_opencost": false,
		"note":              "Collector overhead is not measured by this product. Missing overhead stays Unknown, never Healthy. This product does not install OpenCost.",
	}
}

func costK8sPilotRestart(item *costK8sBinding) map[string]any {
	health := "unknown"
	if item != nil {
		health = costK8sCollectorHealthAfterRestart(item.CollectorHealth, item.LastIngestedAt)
	}
	return map[string]any{
		"collector_health":    health,
		"workloads_restarted": false,
		"worker_can_edit":     false,
		"note":                "A collector restart is Unknown, never Healthy. This worker cannot restart, scale, or drain workloads.",
	}
}

func costK8sPilotAccess() map[string]any {
	return map[string]any{
		"page_grant":      "cost",
		"section":         "cost",
		"worker_can_edit": false,
		"k8s_write":       false,
		"note":            "The Cost section and page grant are required. Kubernetes write is not permission to edit workloads from Cost.",
	}
}

func buildCostK8sPilot(item *costK8sBinding) map[string]any {
	env := ""
	if item != nil {
		env = item.Environment
	}
	return map[string]any{
		"scope":             "nonproduction",
		"max_clusters":      1,
		"read_only":         true,
		"environment_ok":    costK8sEnvironmentIsNonprod(env),
		"worker_can_edit":   false,
		"installs_opencost": false,
		"overhead":          costK8sPilotOverhead(),
		"restart":           costK8sPilotRestart(item),
		"access":            costK8sPilotAccess(),
		"note":              "The Kubernetes Cost pilot is one nonproduction cluster, read-only. Collector failure is Unknown, never Healthy. The worker cannot edit workloads.",
	}
}

func costK8sPilotBindLimit(existing []costK8sBinding, incomingConnectionID int) error {
	for _, item := range existing {
		if item.K8sConnectionID == incomingConnectionID {
			return nil
		}
	}
	if len(existing) >= 1 {
		return fmt.Errorf("the Kubernetes Cost pilot is limited to one nonproduction cluster")
	}
	return nil
}
