package main

import (
	"strings"
	"testing"
)

func TestAccountCreatedEmailHasSignInLink(t *testing.T) {
	previous := DevOpsFrontendURL
	DevOpsFrontendURL = "http://localhost:3002/"
	t.Cleanup(func() { DevOpsFrontendURL = previous })

	if portalSignInURL() != "http://localhost:3002/login" {
		t.Fatalf("sign-in url = %q", portalSignInURL())
	}
	subject, body := EmailTemplateAccountCreated("ada", portalSignInURL())
	if subject == "" || !strings.Contains(body, "Username: ada") {
		t.Fatalf("template missing username: %q %q", subject, body)
	}
	if !strings.Contains(body, "http://localhost:3002/login") {
		t.Fatalf("template missing sign-in link: %q", body)
	}
	_, unsafeBody := EmailTemplateAccountCreated("ada", "javascript:alert(1)")
	if strings.Contains(unsafeBody, "javascript:") {
		t.Fatal("unsafe sign-in url leaked")
	}
}
