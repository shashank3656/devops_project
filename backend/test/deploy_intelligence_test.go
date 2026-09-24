package main

import "testing"

func TestIsProductionBaseBranch(t *testing.T) {
	for _, branch := range []string{"main", "MAIN", "master", "prod", "production"} {
		if !isProductionBaseBranch(branch) {
			t.Fatalf("expected production base for %q", branch)
		}
	}
	if isProductionBaseBranch("develop") || isProductionBaseBranch("release/1.0") {
		t.Fatalf("feature branches should not count as production base")
	}
}

func TestParseRepositoryFromWebhook(t *testing.T) {
	owner, name := parseRepositoryFromWebhook(map[string]interface{}{
		"repository": map[string]interface{}{
			"full_name": "acme/infra-live",
			"name":      "infra-live",
			"owner":     map[string]interface{}{"login": "acme"},
		},
	})
	if owner != "acme" || name != "infra-live" {
		t.Fatalf("got %s/%s", owner, name)
	}
}
