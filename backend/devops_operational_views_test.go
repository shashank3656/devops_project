package main

import "testing"

func TestExtractDriftSignalProfileClassifiesSignals(t *testing.T) {
	profile := extractDriftSignalProfile(`{
		"deploy": {
			"image_tag": "1.25.3",
			"replicas": 3,
			"feature_flag": true,
			"db_password": "vault:secret/data/platform/db"
		}
	}`)

	if profile.InvalidConfig {
		t.Fatalf("expected valid JSON config profile")
	}
	if got := profile.VersionMarkers["deploy.image_tag"]; got != "1.25.3" {
		t.Fatalf("expected deploy.image_tag version marker, got %q", got)
	}
	if len(profile.SecretReferences) != 1 || profile.SecretReferences[0] != "deploy.db_password" {
		t.Fatalf("expected deploy.db_password secret reference, got %#v", profile.SecretReferences)
	}
	if len(profile.VariableKeys) != 2 {
		t.Fatalf("expected 2 variable keys, got %#v", profile.VariableKeys)
	}
	if profile.VariableKeys[0] != "deploy.feature_flag" || profile.VariableKeys[1] != "deploy.replicas" {
		t.Fatalf("unexpected variable keys %#v", profile.VariableKeys)
	}
}

func TestBuildProjectDependencyEdgesCreatesRelationshipTypes(t *testing.T) {
	nodes := []projectDependencyNode{
		{
			ProjectID:   11,
			ProjectName: "Payments API",
			ProjectCode: "PAY",
			Services:    []string{"aws:rds", "aws:redis"},
			Teams:       []string{"platform"},
			Clusters:    []string{"prod-cluster"},
			Clouds:      []string{"aws"},
		},
		{
			ProjectID:   22,
			ProjectName: "Checkout UI",
			ProjectCode: "CHK",
			Services:    []string{"aws:rds", "vercel:edge"},
			Teams:       []string{"platform"},
			Clusters:    []string{"prod-cluster"},
			Clouds:      []string{"aws"},
		},
	}

	edges := buildProjectDependencyEdges(nodes)
	if len(edges) != 4 {
		t.Fatalf("expected 4 dependency edges, got %d", len(edges))
	}

	seenRelationships := map[string]bool{}
	for _, edge := range edges {
		seenRelationships[edge.Relationship] = true
		if edge.SharedCount <= 0 {
			t.Fatalf("expected positive shared count for edge %#v", edge)
		}
	}

	for _, relationship := range []string{"service", "team", "cluster", "cloud"} {
		if !seenRelationships[relationship] {
			t.Fatalf("expected %q relationship edge to be present", relationship)
		}
	}
}
