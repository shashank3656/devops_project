package main

import (
	"testing"
	"time"
)

func TestPipelineLabelForChange(t *testing.T) {
	if pipelineLabelForChange(changeRequestRecord{Status: "implemented"}) != "Unknown" {
		t.Fatal("missing pipeline URL stays Unknown")
	}
	if pipelineLabelForChange(changeRequestRecord{PipelineURL: "https://example.invalid/run/1", Status: "failed"}) != "Failed" {
		t.Fatal("failed stays Failed")
	}
	if pipelineLabelForChange(changeRequestRecord{PipelineURL: "https://example.invalid/run/1", Status: "implementing"}) != "Running" {
		t.Fatal("implementing is Running")
	}
	if pipelineLabelForChange(changeRequestRecord{PipelineURL: "https://example.invalid/run/1", Status: "implemented"}) != "Succeeded" {
		t.Fatal("implemented is Succeeded")
	}
}

func TestPipelineFreshnessMarksStaleRunning(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	created := now.Add(-20 * 24 * time.Hour)
	updated := now.Add(-11 * 24 * time.Hour)
	minutes, known, lastChecked, stale := pipelineFreshness(changeRequestRecord{
		CreatedAt: created,
		UpdatedAt: updated,
	}, "Running", now)
	if !known || !stale {
		t.Fatalf("expected known stale running pipeline, got known=%v stale=%v", known, stale)
	}
	if minutes < 11*24*60 {
		t.Fatalf("expected elapsed duration from created, got %d", minutes)
	}
	if !lastChecked.Equal(updated) {
		t.Fatalf("last checked should be updated_at, got %s", lastChecked)
	}
}

func TestListPipelineCatalogWithoutDB(t *testing.T) {
	saved := DB
	DB = nil
	defer func() { DB = saved }()
	if got := listPipelineCatalog(0, "", "", 0); got == nil || len(got) != 0 {
		t.Fatalf("expected empty catalog, got %#v", got)
	}
}

func TestPipelineCatalogIncludesVerification(t *testing.T) {
	item := changeRequestRecord{
		ID:            8,
		ChangeNumber:  "CHG8",
		Status:        "monitoring",
		PipelineURL:   "https://example.invalid/run/8",
		Environment:   "prod",
		Baseline:      &serviceMetrics{P95Ms: 100, ErrorRatio: 0.01, Saturation: 0.2},
		LatestMetrics: &serviceMetrics{P95Ms: 400, ErrorRatio: 0.012, Saturation: 0.2},
	}
	got := buildListedDeploymentVerification(item)
	if got.State != "degraded" {
		t.Fatalf("listed verification should still surface degraded latency, got %s", got.State)
	}
}

func TestPipelineMatchesRepo(t *testing.T) {
	if !pipelineMatchesRepo("acme/infra-live", "acme/infra-live") {
		t.Fatal("exact owner/name")
	}
	if !pipelineMatchesRepo("acme/infra-live", "infra-live") {
		t.Fatal("repo name should match owner/name")
	}
	if pipelineMatchesRepo("acme/infra-live", "other/repo") {
		t.Fatal("different repo should not match")
	}
}
