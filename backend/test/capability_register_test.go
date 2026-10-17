package main

import "testing"

func TestInheritedCapabilityInventoryRecordsRevision(t *testing.T) {
	items := inheritedCapabilityInventory("9c7c3a7a", "local Go test runner")
	if len(items) == 0 {
		t.Fatal("inventory is empty")
	}
	seen := map[capabilityMode]bool{}
	for _, item := range items {
		if item.Revision != "9c7c3a7a" || item.Environment == "" || item.Route == "" {
			t.Fatalf("missing evidence: %+v", item)
		}
		switch item.Mode {
		case capabilityLive, capabilityDemo, capabilityUnavailable:
			seen[item.Mode] = true
		default:
			t.Fatalf("unknown mode %q", item.Mode)
		}
		switch item.Name {
		case "Cloud inventory", "Golden path catalog", "Cost estimate":
			if item.Mode != capabilityDemo {
				t.Fatalf("%s must stay demo", item.Name)
			}
		case "Kubernetes overview", "GitHub connectivity", "Copilot model", "Security findings", "Sandbox provisioning", "Preview environment list":
			if item.Mode != capabilityUnavailable {
				t.Fatalf("%s has no recorded provider", item.Name)
			}
		}
	}
	if len(items) < 18 {
		t.Fatalf("route groups still missing: %d", len(items))
	}
	if !seen[capabilityLive] || !seen[capabilityDemo] || !seen[capabilityUnavailable] {
		t.Fatalf("inventory must separate live, demo, and unavailable: %+v", seen)
	}
}
