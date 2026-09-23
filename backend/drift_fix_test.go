package main

import (
	"encoding/json"
	"testing"
)

func TestAlignVersionMarkersCopiesSharedVersions(t *testing.T) {
	baseline := `{"image_tag":"v2.4.0","engine_version":"15.4","instance_type":"t3.small","containers":[{"image":"api:2.4"}]}`
	target := `{"image_tag":"v2.1.0","engine_version":"15.4","instance_type":"m5.large","containers":[{"image":"api:2.1"}],"chart_version":"1.0"}`

	config, changes, err := alignVersionMarkers(baseline, target)
	if err != nil {
		t.Fatalf("alignVersionMarkers: %v", err)
	}
	if len(changes) != 2 {
		t.Fatalf("got %d changes, want 2: %+v", len(changes), changes)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal([]byte(config), &decoded); err != nil {
		t.Fatalf("result is not JSON: %v", err)
	}
	if decoded["image_tag"] != "v2.4.0" {
		t.Errorf("image_tag = %v, want v2.4.0", decoded["image_tag"])
	}
	if decoded["instance_type"] != "m5.large" {
		t.Errorf("non-version field changed: instance_type = %v", decoded["instance_type"])
	}
	if decoded["chart_version"] != "1.0" {
		t.Errorf("target-only version was touched: chart_version = %v", decoded["chart_version"])
	}
	image := decoded["containers"].([]interface{})[0].(map[string]interface{})["image"]
	if image != "api:2.4" {
		t.Errorf("containers[0].image = %v, want api:2.4", image)
	}
}

func TestAlignVersionMarkersNoDrift(t *testing.T) {
	config := `{"image_tag":"v1"}`
	_, changes, err := alignVersionMarkers(config, config)
	if err != nil || len(changes) != 0 {
		t.Fatalf("expected no changes, got %v, %v", changes, err)
	}
}

func TestParseFlattenedPath(t *testing.T) {
	steps, ok := parseFlattenedPath("a.b[2].c")
	if !ok || len(steps) != 4 || !steps[2].isIdx || steps[2].index != 2 || steps[3].key != "c" {
		t.Fatalf("unexpected steps: %+v", steps)
	}
	if _, ok := parseFlattenedPath("a..b"); ok {
		t.Fatal("empty segment should be rejected")
	}
}
