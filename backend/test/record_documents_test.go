package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSanitizeRecordDocumentName(t *testing.T) {
	if got := sanitizeRecordDocumentName("../etc/passwd.pdf"); got != "passwd.pdf" {
		t.Fatalf("path traversal name = %q", got)
	}
	if got := sanitizeRecordDocumentName(`report:.pdf`); !strings.HasSuffix(got, ".pdf") || strings.Contains(got, ":") {
		t.Fatalf("colon name = %q", got)
	}
	if got := sanitizeRecordDocumentName("   "); got != "document" {
		t.Fatalf("empty name = %q", got)
	}
}

func TestRecordDocumentAllowed(t *testing.T) {
	if !recordDocumentAllowed("notes.pdf") {
		t.Fatal("pdf should be allowed")
	}
	if recordDocumentAllowed("payload.exe") {
		t.Fatal("exe should be refused")
	}
}

func TestRecordDocumentStorageKey(t *testing.T) {
	RecordDocsS3Prefix = "Incidents"
	key, err := recordDocumentStorageKey("incident", 12, "runbook.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(key, "Incidents/incident/12/") || !strings.HasSuffix(key, "-runbook.pdf") {
		t.Fatalf("storage key = %q", key)
	}
}

func TestRecordDocumentJSONOmitsStorageKey(t *testing.T) {
	raw, err := json.Marshal(recordDocument{ID: 1, RecordKind: "incident", RecordID: 9, OriginalName: "notes.pdf", storageKey: "Incidents/secret-key"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "secret-key") || strings.Contains(string(raw), "storage") {
		t.Fatalf("storage key leaked: %s", raw)
	}
}

func TestNormalizeRecordDocumentKind(t *testing.T) {
	if got := normalizeRecordDocumentKind("incidents"); got != "incident" {
		t.Fatalf("kind = %q", got)
	}
	if got := normalizeRecordDocumentKind("changes"); got != "change" {
		t.Fatalf("kind = %q", got)
	}
	if got := normalizeRecordDocumentKind("problems"); got != "problem" {
		t.Fatalf("kind = %q", got)
	}
	if got := normalizeRecordDocumentKind("ticket"); got != "" {
		t.Fatalf("unexpected kind = %q", got)
	}
}
