package main

import (
	"testing"
	"time"
)

func TestRequestFilePathsSingleService(t *testing.T) {
	req := &PRRequest{
		ApplicationID: "app-1",
		FilePath:      "teams/web/dev/aws/ec2/app-1/request.json",
		Config:        `{"instance_type":"t3.micro"}`,
	}
	paths := requestFilePaths(req)
	if len(paths) == 0 {
		t.Fatalf("expected at least one path")
	}
	found := false
	for _, path := range paths {
		if path == req.FilePath {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected %s in %v", req.FilePath, paths)
	}
}

func TestBuildRequestLifetimeWithoutDB(t *testing.T) {
	saved := DB
	DB = nil
	defer func() { DB = saved }()

	dev := buildRequestLifetime(&PRRequest{Env: "dev", Status: "completed"}, time.Now())
	if !dev.CanSetLifetime {
		t.Fatalf("dev requests should allow an expiry")
	}
	prod := buildRequestLifetime(&PRRequest{Env: "prod", Status: "completed"}, time.Now())
	if prod.CanSetLifetime {
		t.Fatalf("production requests must not be temporary")
	}
	rejected := buildRequestLifetime(&PRRequest{Env: "dev", Status: "rejected"}, time.Now())
	if rejected.CanSetLifetime {
		t.Fatalf("rejected requests should not get an expiry")
	}
	if empty := buildRequestLifetime(nil, time.Now()); empty.CanSetLifetime || empty.ExpiresAt != nil {
		t.Fatalf("nil request should give an empty lifetime")
	}
}
