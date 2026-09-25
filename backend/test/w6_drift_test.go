package main

import "testing"

func TestImageMarker(t *testing.T) {
	if imageMarker("registry.internal/app/api:prod") != "prod" {
		t.Fatal("tag")
	}
	if imageMarker("registry.internal/app/api@sha256:deadbeef") != "sha256:deadbeef" {
		t.Fatal("digest")
	}
}

func TestCompareLiveChangeDrift(t *testing.T) {
	synced := compareLiveChangeDrift("registry.internal/app/api:abc123def456", "abc123def4567890", "", "prod")
	if !synced.Compared || synced.Drifted {
		t.Fatalf("%+v", synced)
	}
	digest := compareLiveChangeDrift("img@sha256:deadbeef", "", "sha256:deadbeef", "prod")
	if digest.Drifted {
		t.Fatalf("%+v", digest)
	}
	drifted := compareLiveChangeDrift("registry.internal/app/api:prod", "abc123def4567890", "", "prod")
	if !drifted.Drifted || !drifted.Compared {
		t.Fatalf("%+v", drifted)
	}
	empty := compareLiveChangeDrift("", "abc", "", "prod")
	if empty.Compared || empty.Drifted {
		t.Fatalf("%+v", empty)
	}
}
