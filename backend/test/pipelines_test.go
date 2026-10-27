package main

import "testing"

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

func TestListPipelineCatalogWithoutDB(t *testing.T) {
	saved := DB
	DB = nil
	defer func() { DB = saved }()
	if got := listPipelineCatalog(); got == nil || len(got) != 0 {
		t.Fatalf("expected empty catalog, got %#v", got)
	}
}
