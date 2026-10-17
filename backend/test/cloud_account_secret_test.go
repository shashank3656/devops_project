package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCloudAccountSecretIsSealedAndOmitted(t *testing.T) {
	t.Setenv("SESSION_SECRET", "test-secret")
	const plain = "arn:aws:iam::111122223333:role/SetuOpsTrust"
	sealed, err := sealCloudSecret(plain)
	if err != nil {
		t.Fatal(err)
	}
	if sealed == plain || !cloudSecretIsSealed(sealed) {
		t.Fatalf("secret was not sealed")
	}
	opened, err := openCloudSecret(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if opened != plain {
		t.Fatal("sealed secret did not round-trip")
	}
	item := cloudAccountRecord{
		Provider: "aws", AccountID: "111122223333", DisplayName: "Platform",
		RoleARNSet: true, ExternalIDSet: true, SecretRefSet: true, CredentialsEncrypted: true,
	}
	raw, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if strings.Contains(body, plain) || strings.Contains(body, sealed) || strings.Contains(body, `"role_arn"`) {
		t.Fatalf("response exposed a trust secret: %s", body)
	}
	if !strings.Contains(body, `"account_id":"111122223333"`) || !strings.Contains(body, `"credentials_encrypted":true`) {
		t.Fatalf("response dropped the entered account fields: %s", body)
	}
}
