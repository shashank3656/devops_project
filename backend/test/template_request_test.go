package main

import "testing"

type templateMem struct {
	requests []templateRequestRecord
	certs    []templateCertification
}

func (m *templateMem) install() func() {
	previousSave := saveTemplateRequest
	previousFind := findTemplateRequest
	previousCert := saveTemplateCertification
	previousLoad := loadTemplateCertification
	previousObserved := templateSandboxObservations
	saveTemplateRequest = func(record templateRequestRecord) (templateRequestRecord, error) {
		record.ID = len(m.requests) + 1
		record.Status = "intent"
		m.requests = append(m.requests, record)
		return record, nil
	}
	findTemplateRequest = func(record templateRequestRecord) (templateRequestRecord, bool) {
		for _, existing := range m.requests {
			if existing.ProjectID == record.ProjectID && existing.TemplateKey == record.TemplateKey && existing.SchemaVersion == record.SchemaVersion && existing.GeneratorVersion == record.GeneratorVersion && existing.ModuleVersion == record.ModuleVersion && existing.Region == record.Region && existing.BucketName == record.BucketName && existing.Environment == record.Environment && existing.StorageClass == record.StorageClass {
				return existing, true
			}
		}
		return templateRequestRecord{}, false
	}
	saveTemplateCertification = func(item templateCertification) (templateCertification, error) {
		item.ID = len(m.certs) + 1
		m.certs = append(m.certs, item)
		return item, nil
	}
	loadTemplateCertification = func(projectID int, templateKey string) (templateCertification, bool) {
		for index := len(m.certs) - 1; index >= 0; index-- {
			if m.certs[index].ProjectID == projectID && m.certs[index].TemplateKey == templateKey {
				return m.certs[index], true
			}
		}
		return templateCertification{}, false
	}
	templateSandboxObservations = func() []sandboxResource {
		return []sandboxResource{{ResourceID: "i-0a1b2c3d4e5f67890", Region: "asia-east2", DisplayName: "setuops-template-probe"}}
	}
	return func() {
		saveTemplateRequest = previousSave
		findTemplateRequest = previousFind
		saveTemplateCertification = previousCert
		loadTemplateCertification = previousLoad
		templateSandboxObservations = previousObserved
	}
}

func templateOperator() authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "operator", Environments: []string{"*"}}},
	}
}

func templateViewer() authzSubject {
	return authzSubject{
		UserID: 5, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "viewer", Environments: []string{"*"}}},
	}
}

func validTemplateRaw() map[string]interface{} {
	return map[string]interface{}{
		"project_id":        10,
		"template_key":      supportedTemplateKey,
		"schema_version":    1,
		"generator_version": "hcl-1",
		"module_version":    "1.0.0",
		"region":            "asia-east2",
		"bucket_name":       "setuops-template-probe",
		"environment":       "sandbox",
	}
}

func TestTemplateRequestKeepsExactVersions(t *testing.T) {
	mem := &templateMem{}
	restore := mem.install()
	defer restore()
	raw := validTemplateRaw()
	first, err := acceptTemplateRequest(templateOperator(), raw)
	if err != nil || first.ID != 1 || first.SchemaVersion != 1 || first.GeneratorVersion != "hcl-1" || first.ModuleVersion != "1.0.0" || first.Status != "intent" || first.Region != "asia-east2" {
		t.Fatalf("first %+v err %v", first, err)
	}
	second, err := acceptTemplateRequest(templateOperator(), validTemplateRaw())
	if err != nil || second.ID != first.ID || len(mem.requests) != 1 {
		t.Fatalf("duplicate %+v rows %d err %v", second, len(mem.requests), err)
	}
	raw["module_version"] = "9.9.9"
	if _, err := acceptTemplateRequest(templateOperator(), raw); err == nil || len(mem.requests) != 1 || raw["module_version"] != "9.9.9" {
		t.Fatalf("replaced version err %v rows %d", err, len(mem.requests))
	}
}

func TestTemplateRequestRejectsUnknownAndUnauthorized(t *testing.T) {
	mem := &templateMem{}
	restore := mem.install()
	defer restore()
	missing := validTemplateRaw()
	delete(missing, "bucket_name")
	if _, err := acceptTemplateRequest(templateOperator(), missing); err == nil || len(mem.requests) != 0 {
		t.Fatalf("missing bucket err %v rows %d", err, len(mem.requests))
	}
	unknown := validTemplateRaw()
	unknown["fallback_region"] = "us-east-1"
	if _, err := acceptTemplateRequest(templateOperator(), unknown); err == nil || len(mem.requests) != 0 {
		t.Fatalf("unknown field err %v rows %d", err, len(mem.requests))
	}
	all := validTemplateRaw()
	all["project_id"] = 0
	if _, err := acceptTemplateRequest(templateOperator(), all); err == nil || len(mem.requests) != 0 {
		t.Fatalf("all projects err %v rows %d", err, len(mem.requests))
	}
	if _, err := acceptTemplateRequest(templateViewer(), validTemplateRaw()); err != errTemplateDenied || len(mem.requests) != 0 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.requests))
	}
	other := validTemplateRaw()
	other["project_id"] = 11
	if _, err := acceptTemplateRequest(templateOperator(), other); err != errTemplateHidden || len(mem.requests) != 0 {
		t.Fatalf("other project err %v rows %d", err, len(mem.requests))
	}
}

func TestCertificationStaysUnavailableWithoutAResource(t *testing.T) {
	mem := &templateMem{}
	restore := mem.install()
	defer restore()
	item, err := certifySelectedTemplate(templateOperator(), validTemplateRaw())
	if err != nil || item.Status != "unavailable" || item.Reason == "" || len(mem.certs) != 1 {
		t.Fatalf("certify %+v err %v", item, err)
	}
	entry := templateCatalog("gcp", "storage", 10)
	if entry.State != "unavailable" || entry.SupportLabel != "Unavailable" || entry.SupportLabel == "Certified" {
		t.Fatalf("catalog %+v", entry)
	}
	if _, err := certifySelectedTemplate(templateViewer(), validTemplateRaw()); err != errTemplateDenied || len(mem.certs) != 1 {
		t.Fatalf("viewer certify err %v rows %d", err, len(mem.certs))
	}
	other := templateCatalog("aws", "eks", 10)
	if other.State != "unavailable" || other.Reason != "uncertified provider combination" || other.SupportLabel != "Unavailable" {
		t.Fatalf("uncertified %+v", other)
	}
}
