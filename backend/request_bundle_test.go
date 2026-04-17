package main

import "testing"

func TestCanonicalizeRequestBundlePayloadNestedConfig(t *testing.T) {
	payload := InfraRequest{
		"team":    "platform",
		"env":     "dev",
		"cloud":   "gcp",
		"service": "cloud-storage",
		"config": map[string]interface{}{
			"service_bundle": []interface{}{
				map[string]interface{}{
					"cloud":              "gcp",
					"service":            "cloud-storage",
					"normalized_service": "cloud-storage",
					"display_name":       "Cloud Storage Bucket",
					"config": map[string]interface{}{
						"bucket_name": "team-dev-bucket",
					},
				},
				map[string]interface{}{
					"cloud":              "gcp",
					"service":            "cloud-sql",
					"normalized_service": "cloud-sql",
					"display_name":       "Cloud SQL",
					"config": map[string]interface{}{
						"instance_name": "team-dev-sql",
					},
				},
			},
		},
	}

	entries, err := canonicalizeRequestBundlePayload(payload)
	if err != nil {
		t.Fatalf("canonicalizeRequestBundlePayload() error = %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("canonicalizeRequestBundlePayload() entries = %d, want 2", len(entries))
	}

	if got := payload["cloud"]; got != "gcp" {
		t.Fatalf("payload cloud = %v, want gcp", got)
	}
	if got := payload["service"]; got != "cloud-storage" {
		t.Fatalf("payload service = %v, want cloud-storage", got)
	}

	config, ok := payload["config"].(map[string]interface{})
	if !ok {
		t.Fatal("payload config should remain a map")
	}
	if got, _ := config["bundle_mode"].(bool); !got {
		t.Fatal("config bundle_mode should be true")
	}
	if _, ok := config["bundle_summary"].(*RequestBundleSummary); !ok {
		t.Fatal("config bundle_summary should be set")
	}
}

func TestExtractServiceBundleEntriesFromConfigNestedConfig(t *testing.T) {
	raw := `{
		"project_id": 12,
		"team": "platform",
		"env": "dev",
		"cloud": "gcp",
		"service": "cloud-storage",
		"config": {
			"bundle_mode": true,
			"service_bundle": [
				{
					"cloud": "gcp",
					"service": "cloud-storage",
					"display_name": "Cloud Storage Bucket",
					"config": {"bucket_name": "team-dev-bucket"}
				},
				{
					"cloud": "gcp",
					"service": "cloud-sql",
					"display_name": "Cloud SQL",
					"config": {"instance_name": "team-dev-sql"}
				}
			]
		}
	}`

	entries, err := extractServiceBundleEntriesFromConfig(raw)
	if err != nil {
		t.Fatalf("extractServiceBundleEntriesFromConfig() error = %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("extractServiceBundleEntriesFromConfig() entries = %d, want 2", len(entries))
	}
	if entries[1].Service != "cloud-sql" {
		t.Fatalf("second service = %q, want %q", entries[1].Service, "cloud-sql")
	}
}
