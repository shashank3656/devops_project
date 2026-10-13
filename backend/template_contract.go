package main

import (
	"fmt"
	"strings"
)

type templateModuleContract struct {
	TemplateKey      string
	SchemaVersion    int
	GeneratorVersion string
	ModuleVersion    string
	ModuleSource     string
}

type templateVersionPin struct {
	TemplateKey      string
	SchemaVersion    int
	GeneratorVersion string
	ModuleVersion    string
}

var pinnedTemplateContract = templateModuleContract{
	TemplateKey:      supportedTemplateKey,
	SchemaVersion:    1,
	GeneratorVersion: "hcl-1",
	ModuleVersion:    "1.0.0",
	ModuleSource:     "git::https://example.invalid/modules/gcp/cloud-storage?ref=v1.0.0",
}

func pinTemplateContract(input templateVersionPin) (templateModuleContract, error) {
	key := strings.TrimSpace(input.TemplateKey)
	generator := strings.TrimSpace(input.GeneratorVersion)
	module := strings.TrimSpace(input.ModuleVersion)
	if key == "" {
		return templateModuleContract{}, fmt.Errorf("template key is required")
	}
	if key != pinnedTemplateContract.TemplateKey {
		return templateModuleContract{}, fmt.Errorf("unsupported template %s", key)
	}
	if input.SchemaVersion <= 0 {
		return templateModuleContract{}, fmt.Errorf("schema version is required")
	}
	if generator == "" {
		return templateModuleContract{}, fmt.Errorf("generator version is required")
	}
	if module == "" {
		return templateModuleContract{}, fmt.Errorf("module version is required")
	}
	if input.SchemaVersion != pinnedTemplateContract.SchemaVersion {
		return templateModuleContract{}, fmt.Errorf("schema version %d is not pinned", input.SchemaVersion)
	}
	if generator != pinnedTemplateContract.GeneratorVersion {
		return templateModuleContract{}, fmt.Errorf("generator version %s is not pinned", generator)
	}
	if module != pinnedTemplateContract.ModuleVersion {
		return templateModuleContract{}, fmt.Errorf("module version %s is not pinned", module)
	}
	return pinnedTemplateContract, nil
}

func migrateTemplateContractSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS template_versions (
			id SERIAL PRIMARY KEY,
			template_key VARCHAR(120) NOT NULL UNIQUE,
			schema_version INTEGER NOT NULL,
			generator_version VARCHAR(64) NOT NULL,
			module_version VARCHAR(64) NOT NULL,
			module_source VARCHAR(300) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		INSERT INTO template_versions (template_key, schema_version, generator_version, module_version, module_source)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (template_key) DO NOTHING
	`, pinnedTemplateContract.TemplateKey, pinnedTemplateContract.SchemaVersion, pinnedTemplateContract.GeneratorVersion, pinnedTemplateContract.ModuleVersion, pinnedTemplateContract.ModuleSource)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS template_requests (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			template_key VARCHAR(120) NOT NULL,
			schema_version INTEGER NOT NULL,
			generator_version VARCHAR(64) NOT NULL,
			module_version VARCHAR(64) NOT NULL,
			region VARCHAR(120) NOT NULL,
			bucket_name VARCHAR(200) NOT NULL,
			environment VARCHAR(64) NOT NULL,
			storage_class VARCHAR(64) NOT NULL DEFAULT '',
			status VARCHAR(32) NOT NULL DEFAULT 'intent',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS template_certifications (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			template_key VARCHAR(120) NOT NULL,
			status VARCHAR(32) NOT NULL,
			reason TEXT NOT NULL,
			region VARCHAR(120) NOT NULL,
			bucket_name VARCHAR(200) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}
