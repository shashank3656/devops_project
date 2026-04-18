package main

import "testing"

func TestCanonicalizeRequestBundlePayloadNestedConfig(t *testing.T) {
	payload := InfraRequest{
		"team":    "platform",
		"env":     "dev",
		"cloud":   "gcp",
		"service": "storage",
		"config": map[string]interface{}{
			"bucket_name": "team-dev-bucket",
			"service_bundle": []interface{}{
				map[string]interface{}{
					"env":                "dev",
					"cloud":              "gcp",
					"service":            "storage",
					"normalized_service": "cloud-storage",
					"display_name":       "Cloud Storage Bucket",
					"config": map[string]interface{}{
						"bucket_name": "team-dev-bucket",
					},
				},
				map[string]interface{}{
					"env":                "dev",
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
	if _, ok := config["bucket_name"]; ok {
		t.Fatal("config bucket_name should be pruned when service_bundle is present")
	}
	rawBundle, ok := config["service_bundle"].([]ServiceBundleEntry)
	if !ok || len(rawBundle) != 2 {
		t.Fatal("config service_bundle should be normalized into []ServiceBundleEntry")
	}
	if rawBundle[0].Service != "cloud-storage" {
		t.Fatalf("primary bundled service = %q, want %q", rawBundle[0].Service, "cloud-storage")
	}
	if rawBundle[0].Env != "dev" {
		t.Fatalf("primary bundled env = %q, want %q", rawBundle[0].Env, "dev")
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

func TestNormalizeRequestServiceKey(t *testing.T) {
	cases := []struct {
		cloud   string
		service string
		want    string
	}{
		{cloud: "gcp", service: "storage", want: "cloud-storage"},
		{cloud: "gcp", service: "cloudsql", want: "cloud-sql"},
		{cloud: "gcp", service: "compute", want: "compute-engine"},
		{cloud: "aws", service: "s3", want: "s3"},
	}

	for _, tc := range cases {
		if got := normalizeRequestServiceKey(tc.cloud, tc.service); got != tc.want {
			t.Fatalf("normalizeRequestServiceKey(%q, %q) = %q, want %q", tc.cloud, tc.service, got, tc.want)
		}
	}
}
