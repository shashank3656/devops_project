package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

var (
	errTemplateHidden  = errors.New("template request not found")
	errTemplateDenied  = errors.New("template request is not permitted")
	errTemplateInvalid = errors.New("template request is invalid")
)

var templateRequestFields = map[string]struct{}{
	"project_id":        {},
	"template_key":      {},
	"schema_version":    {},
	"generator_version": {},
	"module_version":    {},
	"region":            {},
	"bucket_name":       {},
	"environment":       {},
	"storage_class":     {},
}

type templateRequestRecord struct {
	ID               int    `json:"id"`
	ProjectID        int    `json:"project_id"`
	TemplateKey      string `json:"template_key"`
	SchemaVersion    int    `json:"schema_version"`
	GeneratorVersion string `json:"generator_version"`
	ModuleVersion    string `json:"module_version"`
	Region           string `json:"region"`
	BucketName       string `json:"bucket_name"`
	Environment      string `json:"environment"`
	StorageClass     string `json:"storage_class"`
	Status           string `json:"status"`
}

type templateCertification struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	TemplateKey string `json:"template_key"`
	Status      string `json:"status"`
	Reason      string `json:"reason"`
	Region      string `json:"region"`
	BucketName  string `json:"bucket_name"`
}

type templateCatalogEntry struct {
	Provider     string `json:"provider"`
	Service      string `json:"service"`
	TemplateKey  string `json:"template_key"`
	State        string `json:"state"`
	Reason       string `json:"reason"`
	SupportLabel string `json:"support_label"`
}

var (
	saveTemplateRequest         = saveTemplateRequestToDB
	findTemplateRequest         = findTemplateRequestFromDB
	saveTemplateCertification   = saveTemplateCertificationToDB
	loadTemplateCertification   = loadTemplateCertificationFromDB
	templateSandboxObservations = listSandboxObservations
)

func acceptTemplateRequest(subject authzSubject, raw map[string]interface{}) (templateRequestRecord, error) {
	record, err := templateRecordFromRaw(raw)
	if err != nil {
		return templateRequestRecord{}, err
	}
	if !mappingAllowed(subject, record.ProjectID, authzRead) {
		return templateRequestRecord{}, errTemplateHidden
	}
	if !mappingAllowed(subject, record.ProjectID, authzWrite) {
		return templateRequestRecord{}, errTemplateDenied
	}
	if _, err := pinTemplateContract(templateVersionPin{
		TemplateKey: record.TemplateKey, SchemaVersion: record.SchemaVersion,
		GeneratorVersion: record.GeneratorVersion, ModuleVersion: record.ModuleVersion,
	}); err != nil {
		return templateRequestRecord{}, err
	}
	if existing, ok := findTemplateRequest(record); ok {
		return existing, nil
	}
	record.Status = "intent"
	return saveTemplateRequest(record)
}

func certifySelectedTemplate(subject authzSubject, raw map[string]interface{}) (templateCertification, error) {
	record, err := templateRecordFromRaw(raw)
	if err != nil {
		return templateCertification{}, err
	}
	if !mappingAllowed(subject, record.ProjectID, authzRead) {
		return templateCertification{}, errTemplateHidden
	}
	if !mappingAllowed(subject, record.ProjectID, authzWrite) {
		return templateCertification{}, errTemplateDenied
	}
	if _, err := pinTemplateContract(templateVersionPin{
		TemplateKey: record.TemplateKey, SchemaVersion: record.SchemaVersion,
		GeneratorVersion: record.GeneratorVersion, ModuleVersion: record.ModuleVersion,
	}); err != nil {
		return templateCertification{}, err
	}
	rendered, err := renderCloudStorageTemplate(record.Region, record.BucketName, record.StorageClass)
	if err != nil {
		return templateCertification{}, err
	}
	verified, err := verifySandboxProvision(record.Environment, rendered, record.Region, record.BucketName, "9c7c3a7a", templateSandboxObservations())
	if err != nil {
		return templateCertification{}, err
	}
	if verified.Status != "provisioned" {
		verified.Status = "unavailable"
	}
	item := templateCertification{
		ProjectID: record.ProjectID, TemplateKey: record.TemplateKey,
		Status: verified.Status, Reason: verified.Reason, Region: record.Region, BucketName: record.BucketName,
	}
	return saveTemplateCertification(item)
}

func templateCatalog(provider, service string, projectID int) templateCatalogEntry {
	provider = strings.ToLower(strings.TrimSpace(provider))
	service = strings.ToLower(strings.TrimSpace(service))
	key := provider + "/" + service
	if service == "storage" && provider == "gcp" {
		key = supportedTemplateKey
	}
	if key != supportedTemplateKey {
		return templateCatalogEntry{
			Provider: provider, Service: service, TemplateKey: key,
			State: "unavailable", Reason: "uncertified provider combination", SupportLabel: "Unavailable",
		}
	}
	evidence, ok := loadTemplateCertification(projectID, supportedTemplateKey)
	if !ok || evidence.Status != "provisioned" {
		reason := "sandbox certification has no observed resource"
		if ok && evidence.Reason != "" {
			reason = evidence.Reason
		}
		return templateCatalogEntry{
			Provider: "gcp", Service: "storage", TemplateKey: supportedTemplateKey,
			State: "unavailable", Reason: reason, SupportLabel: "Unavailable",
		}
	}
	return templateCatalogEntry{
		Provider: "gcp", Service: "storage", TemplateKey: supportedTemplateKey,
		State: "certified", Reason: evidence.Reason, SupportLabel: "Certified",
	}
}

func templateRecordFromRaw(raw map[string]interface{}) (templateRequestRecord, error) {
	for key := range raw {
		if _, ok := templateRequestFields[key]; !ok {
			return templateRequestRecord{}, fmt.Errorf("unknown field %s", key)
		}
	}
	projectID, ok := templateWholeNumber(raw["project_id"])
	if !ok || projectID <= 0 {
		return templateRequestRecord{}, fmt.Errorf("project is required")
	}
	schemaVersion, ok := templateWholeNumber(raw["schema_version"])
	if !ok {
		return templateRequestRecord{}, fmt.Errorf("schema version is required")
	}
	record := templateRequestRecord{
		ProjectID:        projectID,
		TemplateKey:      strings.TrimSpace(templateString(raw["template_key"])),
		SchemaVersion:    schemaVersion,
		GeneratorVersion: strings.TrimSpace(templateString(raw["generator_version"])),
		ModuleVersion:    strings.TrimSpace(templateString(raw["module_version"])),
		Region:           strings.TrimSpace(templateString(raw["region"])),
		BucketName:       strings.TrimSpace(templateString(raw["bucket_name"])),
		Environment:      strings.TrimSpace(templateString(raw["environment"])),
		StorageClass:     strings.TrimSpace(templateString(raw["storage_class"])),
	}
	if record.Region == "" || record.BucketName == "" || record.Environment == "" {
		return templateRequestRecord{}, fmt.Errorf("region, bucket_name, and environment are required")
	}
	return record, nil
}

func templateWholeNumber(value interface{}) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case float64:
		if typed != float64(int(typed)) {
			return 0, false
		}
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			return 0, false
		}
		return int(parsed), true
	default:
		return 0, false
	}
}

func templateString(value interface{}) string {
	text, _ := value.(string)
	return text
}

func saveTemplateRequestToDB(record templateRequestRecord) (templateRequestRecord, error) {
	if DB == nil {
		return templateRequestRecord{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO template_requests (
			project_id, template_key, schema_version, generator_version, module_version, region, bucket_name, environment, storage_class, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'intent')
		RETURNING id
	`, record.ProjectID, record.TemplateKey, record.SchemaVersion, record.GeneratorVersion, record.ModuleVersion, record.Region, record.BucketName, record.Environment, record.StorageClass).Scan(&record.ID)
	if err != nil {
		return templateRequestRecord{}, err
	}
	record.Status = "intent"
	return record, nil
}

func findTemplateRequestFromDB(record templateRequestRecord) (templateRequestRecord, bool) {
	if DB == nil {
		return templateRequestRecord{}, false
	}
	err := DB.QueryRow(`
		SELECT id, project_id, template_key, schema_version, generator_version, module_version, region, bucket_name, environment, storage_class, status
		FROM template_requests
		WHERE project_id = $1 AND template_key = $2 AND schema_version = $3 AND generator_version = $4 AND module_version = $5
			AND region = $6 AND bucket_name = $7 AND environment = $8 AND storage_class = $9
		ORDER BY id
		LIMIT 1
	`, record.ProjectID, record.TemplateKey, record.SchemaVersion, record.GeneratorVersion, record.ModuleVersion, record.Region, record.BucketName, record.Environment, record.StorageClass).Scan(
		&record.ID, &record.ProjectID, &record.TemplateKey, &record.SchemaVersion, &record.GeneratorVersion, &record.ModuleVersion, &record.Region, &record.BucketName, &record.Environment, &record.StorageClass, &record.Status,
	)
	return record, err == nil
}

func saveTemplateCertificationToDB(item templateCertification) (templateCertification, error) {
	if DB == nil {
		return templateCertification{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO template_certifications (project_id, template_key, status, reason, region, bucket_name)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, item.ProjectID, item.TemplateKey, item.Status, item.Reason, item.Region, item.BucketName).Scan(&item.ID)
	return item, err
}

func loadTemplateCertificationFromDB(projectID int, templateKey string) (templateCertification, bool) {
	if DB == nil {
		return templateCertification{}, false
	}
	var item templateCertification
	err := DB.QueryRow(`
		SELECT id, project_id, template_key, status, reason, region, bucket_name
		FROM template_certifications
		WHERE project_id = $1 AND template_key = $2
		ORDER BY id DESC
		LIMIT 1
	`, projectID, templateKey).Scan(&item.ID, &item.ProjectID, &item.TemplateKey, &item.Status, &item.Reason, &item.Region, &item.BucketName)
	return item, err == nil
}

func templateRequestsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	raw := map[string]interface{}{}
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil {
		writeTemplateError(w, r, errTemplateInvalid)
		return
	}
	record, err := acceptTemplateRequest(subject, raw)
	if err != nil {
		writeTemplateError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, record)
}

func templateCertifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	raw := map[string]interface{}{}
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil {
		writeTemplateError(w, r, errTemplateInvalid)
		return
	}
	item, err := certifySelectedTemplate(subject, raw)
	if err != nil {
		writeTemplateError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, item)
}

func templateCatalogHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	if projectID > 0 && !mappingAllowed(subject, projectID, authzRead) {
		writeTemplateError(w, r, errTemplateHidden)
		return
	}
	entry := templateCatalog(r.URL.Query().Get("provider"), r.URL.Query().Get("service"), projectID)
	_ = writeJSONResponse(w, http.StatusOK, entry)
}

func writeTemplateError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errTemplateHidden):
		writeAPIError(w, r, http.StatusNotFound, errTemplateHidden.Error(), nil)
	case errors.Is(err, errTemplateDenied):
		writeAPIError(w, r, http.StatusForbidden, errTemplateDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}
