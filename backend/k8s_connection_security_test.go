package main

import (
	"strings"
	"testing"
)

func TestValidateK8sClusterEndpointRejectsInsecure(t *testing.T) {
	t.Setenv("SESSION_SECRET", "test-secret")
	cases := []struct {
		endpoint string
		ok       bool
	}{
		{"https://abc.gr7.us-west-2.eks.amazonaws.com", true},
		{"http://cluster.example.com", false},
		{"https://127.0.0.1", false},
		{"https://10.0.0.1", false},
	}
	for _, tc := range cases {
		err := validateK8sClusterEndpoint(tc.endpoint)
		if tc.ok && err != nil {
			t.Fatalf("expected ok for %q: %v", tc.endpoint, err)
		}
		if !tc.ok && err == nil {
			t.Fatalf("expected error for %q", tc.endpoint)
		}
	}
}

func TestEncryptK8sCredentialRoundTrip(t *testing.T) {
	t.Setenv("SESSION_SECRET", "test-secret")
	plain := "super-secret-token"
	enc, err := encryptK8sCredential(plain)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(enc, "enc:v1:") {
		t.Fatalf("expected encrypted prefix, got %q", enc)
	}
	out, err := decryptK8sCredential(enc)
	if err != nil || out != plain {
		t.Fatalf("round trip failed: %q err=%v", out, err)
	}
}
