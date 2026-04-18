package main

import (
	"encoding/json"
	"testing"
)

func TestMergeStorageBucketRequestContentAppendsNewBucket(t *testing.T) {
	existing := []byte(`{
	  "team": "platform",
	  "env": "dev",
	  "cloud": "gcp",
	  "service": "cloud-storage",
	  "config": {
	    "bucket_name": "team-dev-assets",
	    "region": "asia-east2",
	    "storage_class": "STANDARD",
	    "encryption_type": "Google-managed"
	  }
	}`)
	newContent := []byte(`{
	  "team": "platform",
	  "env": "dev",
	  "cloud": "gcp",
	  "service": "cloud-storage",
	  "config": {
	    "bucket_name": "team-dev-logs",
	    "region": "us-central1",
	    "storage_class": "NEARLINE",
	    "encryption_type": "Google-managed"
	  }
	}`)

	merged, err := mergeStorageBucketRequestContent(existing, newContent)
	if err != nil {
		t.Fatalf("mergeStorageBucketRequestContent returned error: %v", err)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(merged, &payload); err != nil {
		t.Fatalf("merged payload is invalid JSON: %v", err)
	}

	config, _ := payload["config"].(map[string]interface{})
	if got := stringValue(config["bucket_name"]); got != "team-dev-logs" {
		t.Fatalf("config.bucket_name = %q, want team-dev-logs", got)
	}

	rawBuckets, _ := config["buckets"].([]interface{})
	if len(rawBuckets) != 2 {
		t.Fatalf("len(config.buckets) = %d, want 2", len(rawBuckets))
	}

	names := make([]string, 0, len(rawBuckets))
	for _, item := range rawBuckets {
		entry, _ := item.(map[string]interface{})
		names = append(names, stringValue(entry["bucket_name"]))
	}

	if names[0] != "team-dev-assets" || names[1] != "team-dev-logs" {
		t.Fatalf("bucket names = %v, want [team-dev-assets team-dev-logs]", names)
	}
}

func TestMergeStorageBucketRequestContentUpdatesExistingBucket(t *testing.T) {
	existing := []byte(`{
	  "cloud": "gcp",
	  "service": "cloud-storage",
	  "config": {
	    "bucket_name": "team-dev-assets",
	    "region": "asia-east2",
	    "storage_class": "STANDARD"
	  }
	}`)
	newContent := []byte(`{
	  "cloud": "gcp",
	  "service": "cloud-storage",
	  "config": {
	    "bucket_name": "team-dev-assets",
	    "region": "us-central1",
	    "storage_class": "NEARLINE"
	  }
	}`)

	merged, err := mergeStorageBucketRequestContent(existing, newContent)
	if err != nil {
		t.Fatalf("mergeStorageBucketRequestContent returned error: %v", err)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(merged, &payload); err != nil {
		t.Fatalf("merged payload is invalid JSON: %v", err)
	}

	config, _ := payload["config"].(map[string]interface{})
	rawBuckets, _ := config["buckets"].([]interface{})
	if len(rawBuckets) != 1 {
		t.Fatalf("len(config.buckets) = %d, want 1", len(rawBuckets))
	}

	entry, _ := rawBuckets[0].(map[string]interface{})
	if got := stringValue(entry["region"]); got != "us-central1" {
		t.Fatalf("bucket region = %q, want us-central1", got)
	}
	if got := stringValue(entry["storage_class"]); got != "NEARLINE" {
		t.Fatalf("bucket storage_class = %q, want NEARLINE", got)
	}
}

func TestShouldMarkRequestCompletedFromCIStatus(t *testing.T) {
	cases := []struct {
		status string
		want   bool
	}{
		{status: "plan_success", want: false},
		{status: "apply_success", want: true},
		{status: "merge-success", want: true},
		{status: "merge pipeline success", want: true},
		{status: "completed", want: true},
		{status: "cost_ready", want: false},
	}

	for _, tc := range cases {
		if got := shouldMarkRequestCompletedFromCIStatus(tc.status); got != tc.want {
			t.Fatalf("shouldMarkRequestCompletedFromCIStatus(%q) = %t, want %t", tc.status, got, tc.want)
		}
	}
}

func TestBuildBundledRequestFilesSplitsByEnvironment(t *testing.T) {
	baseFilePath := "project/setuops/devteam/gcp/envs/dev/storage/app1234567/request.json"
	content := []byte(`{
	  "project_id": 12,
	  "team": "devteam",
	  "env": "dev",
	  "cloud": "gcp",
	  "service": "storage",
	  "config": {
	    "bundle_mode": true,
	    "service_bundle": [
	      {
	        "env": "dev",
	        "cloud": "gcp",
	        "service": "storage",
	        "normalized_service": "cloud-storage",
	        "display_name": "Cloud Storage Bucket",
	        "config": {
	          "bucket_name": "setup-ops-terraform-dev",
	          "region": "asia-east2",
	          "storage_class": "STANDARD"
	        }
	      },
	      {
	        "env": "uat",
	        "cloud": "gcp",
	        "service": "storage",
	        "normalized_service": "cloud-storage",
	        "display_name": "Cloud Storage Bucket",
	        "config": {
	          "bucket_name": "setup-ops-terraform-uat",
	          "region": "asia-east2",
	          "storage_class": "STANDARD"
	        }
	      }
	    ]
	  }
	}`)

	files, err := buildBundledRequestFiles(baseFilePath, content)
	if err != nil {
		t.Fatalf("buildBundledRequestFiles returned error: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("len(files) = %d, want 2", len(files))
	}

	devPath := "project/setuops/devteam/gcp/envs/dev/storage/app1234567/request.json"
	uatPath := "project/setuops/devteam/gcp/envs/uat/storage/app1234567/request.json"
	if _, ok := files[devPath]; !ok {
		t.Fatalf("expected dev file %q to be generated", devPath)
	}
	if _, ok := files[uatPath]; !ok {
		t.Fatalf("expected uat file %q to be generated", uatPath)
	}

	var devPayload map[string]interface{}
	if err := json.Unmarshal(files[devPath], &devPayload); err != nil {
		t.Fatalf("dev payload invalid JSON: %v", err)
	}
	if got := stringValue(devPayload["env"]); got != "dev" {
		t.Fatalf("dev payload env = %q, want dev", got)
	}
	devConfig, _ := devPayload["config"].(map[string]interface{})
	if got := stringValue(devConfig["bucket_name"]); got != "setup-ops-terraform-dev" {
		t.Fatalf("dev config bucket_name = %q, want setup-ops-terraform-dev", got)
	}

	var uatPayload map[string]interface{}
	if err := json.Unmarshal(files[uatPath], &uatPayload); err != nil {
		t.Fatalf("uat payload invalid JSON: %v", err)
	}
	if got := stringValue(uatPayload["env"]); got != "uat" {
		t.Fatalf("uat payload env = %q, want uat", got)
	}
	uatConfig, _ := uatPayload["config"].(map[string]interface{})
	if got := stringValue(uatConfig["bucket_name"]); got != "setup-ops-terraform-uat" {
		t.Fatalf("uat config bucket_name = %q, want setup-ops-terraform-uat", got)
	}
}

func TestBuildBundledRequestFilesBuildsSingleFileForSameTarget(t *testing.T) {
	baseFilePath := "project/setuops/devteam/gcp/envs/dev/storage/app1234567/request.json"
	content := []byte(`{
	  "project_id": 12,
	  "team": "devteam",
	  "env": "dev",
	  "cloud": "gcp",
	  "service": "storage",
	  "config": {
	    "bundle_mode": true,
	    "service_bundle": [
	      {
	        "env": "dev",
	        "cloud": "gcp",
	        "service": "storage",
	        "normalized_service": "cloud-storage",
	        "display_name": "Cloud Storage Bucket",
	        "config": {
	          "bucket_name": "setup-ops-terraform-dev",
	          "region": "asia-east2",
	          "storage_class": "STANDARD"
	        }
	      },
	      {
	        "env": "dev",
	        "cloud": "gcp",
	        "service": "storage",
	        "normalized_service": "cloud-storage",
	        "display_name": "Cloud Storage Bucket",
	        "config": {
	          "bucket_name": "setup-ops-terraform-dev-logs",
	          "region": "asia-east2",
	          "storage_class": "NEARLINE"
	        }
	      }
	    ]
	  }
	}`)

	files, err := buildBundledRequestFiles(baseFilePath, content)
	if err != nil {
		t.Fatalf("buildBundledRequestFiles returned error: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("len(files) = %d, want 1", len(files))
	}

	groupedPath := "project/setuops/devteam/gcp/envs/dev/storage/app1234567/request.json"
	groupedContent, ok := files[groupedPath]
	if !ok {
		t.Fatalf("expected grouped file %q to be generated", groupedPath)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(groupedContent, &payload); err != nil {
		t.Fatalf("grouped payload invalid JSON: %v", err)
	}

	config, _ := payload["config"].(map[string]interface{})
	rawBuckets, _ := config["buckets"].([]interface{})
	if len(rawBuckets) != 2 {
		t.Fatalf("len(config.buckets) = %d, want 2", len(rawBuckets))
	}
}
