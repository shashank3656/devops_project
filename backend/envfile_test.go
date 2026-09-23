package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestApplyEnvFileDoesNotOverrideExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("DB_USER=fromfile\nDATABASE_URL=postgres://fromfile\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DB_USER", "already")
	preexisting := map[string]struct{}{"DB_USER": {}}
	applied, err := applyEnvFile(path, preexisting)
	if err != nil {
		t.Fatal(err)
	}
	if applied != 1 {
		t.Fatalf("applied = %d, want 1", applied)
	}
	if got := os.Getenv("DB_USER"); got != "already" {
		t.Fatalf("DB_USER = %q, want already", got)
	}
	if got := os.Getenv("DATABASE_URL"); got != "postgres://fromfile" {
		t.Fatalf("DATABASE_URL = %q", got)
	}
}
