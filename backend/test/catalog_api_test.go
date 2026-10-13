package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestCatalogContextHidesUnauthorizedService(t *testing.T) {
	services := []catalogRecord{
		{ID: 7, ProjectID: 10, Name: "payments", Environments: []string{"dev"}, Teams: []string{"payments"}, Resources: []string{"b/shared-logs"}},
		{ID: 8, ProjectID: 11, Name: "ledger", Environments: []string{"dev"}, Teams: []string{"ledger"}, Resources: []string{"b/shared-logs"}},
	}
	subject := catalogOperator(10)
	view, err := catalogContextFor(services, subject, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Shared) != 1 || len(view.Shared[0].ServiceIDs) != 1 || view.Shared[0].ServiceIDs[0] != 7 {
		t.Fatalf("shared = %+v", view.Shared)
	}
	if _, err := catalogContextFor(services, subject, 8); err != errCatalogHidden {
		t.Fatalf("hidden service err = %v", err)
	}
	listed := listVisibleCatalog(services, subject)
	if len(listed) != 1 || listed[0].ID != 7 {
		t.Fatalf("list = %+v", listed)
	}
}

func TestSharedCatalogResourceOnTwoVisibleServices(t *testing.T) {
	services := []catalogRecord{
		{ID: 7, ProjectID: 10, Name: "payments", Environments: []string{"dev"}, Teams: []string{"payments"}, Resources: []string{"b/shared-logs"}},
		{ID: 8, ProjectID: 10, Name: "ledger", Environments: []string{"dev"}, Teams: []string{"ledger"}, Resources: []string{"b/shared-logs"}},
	}
	view, err := catalogContextFor(services, catalogManager(10), 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Shared) != 1 || len(view.Shared[0].ServiceIDs) != 2 {
		t.Fatalf("shared = %+v", view.Shared)
	}
}

func TestCatalogRenameKeepsResourceLinks(t *testing.T) {
	services := []catalogRecord{{
		ID: 7, ProjectID: 10, Name: "payments", Environments: []string{"dev"}, Teams: []string{"payments"},
		Repos: []string{"acme/payments"}, Resources: []string{"b/shared-logs"},
	}}
	next, err := updateCatalogOwnership(services, catalogManager(10), 7, catalogWrite{Name: "billing"})
	if err != nil {
		t.Fatal(err)
	}
	if next.ID != 7 || next.Name != "billing" || next.Resources[0] != "b/shared-logs" || next.Repos[0] != "acme/payments" {
		t.Fatalf("renamed = %+v", next)
	}
}

func TestCatalogAPIDeniesHiddenWriteAndAllowsSharedLink(t *testing.T) {
	store := []catalogRecord{}
	saves := 0
	restore := stubCatalogAPI(&store, &saves, catalogManager(10))
	defer restore()

	first := postCatalog(t, "/api/catalog/services", `{"project_id":10,"name":"payments","environments":["dev"],"teams":["payments"]}`, http.StatusCreated)
	second := postCatalog(t, "/api/catalog/services", `{"project_id":10,"name":"ledger","environments":["dev"],"teams":["ledger"]}`, http.StatusCreated)
	postCatalog(t, "/api/catalog/services/"+first+"/resources", `{"resource_id":"b/shared-logs"}`, http.StatusOK)
	postCatalog(t, "/api/catalog/services/"+second+"/resources", `{"resource_id":"b/shared-logs"}`, http.StatusOK)
	postCatalog(t, "/api/catalog/services/"+first+"/resources", `{"resource_id":"b/shared-logs"}`, http.StatusConflict)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/catalog/services/"+first+"/context", nil)
	catalogServiceDetailHandler(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"service_ids":[`) {
		t.Fatalf("context %d %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), first) || !strings.Contains(recorder.Body.String(), second) {
		t.Fatalf("context hid a visible service: %s", recorder.Body.String())
	}

	savesBefore := saves
	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) { return catalogOperator(11), nil }
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/catalog/services/"+first+"/resources", strings.NewReader(`{"resource_id":"b/secret"}`))
	catalogServiceDetailHandler(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("hidden write status %d %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "b/shared-logs") || strings.Contains(recorder.Body.String(), "payments") {
		t.Fatalf("hidden response leaked catalog data: %s", recorder.Body.String())
	}
	if saves != savesBefore {
		t.Fatal("hidden write saved a catalog row")
	}

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) { return catalogViewer(10), nil }
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPatch, "/api/catalog/services/"+first, strings.NewReader(`{"teams":["other"]}`))
	catalogServiceDetailHandler(recorder, request)
	if recorder.Code != http.StatusForbidden || saves != savesBefore {
		t.Fatalf("viewer write status %d saves %d body %s", recorder.Code, saves, recorder.Body.String())
	}
}

func TestCatalogTriageHidesUnauthorizedRelationship(t *testing.T) {
	services := []catalogRecord{
		{ID: 7, ProjectID: 10, Name: "payments", Environments: []string{"dev"}, Teams: []string{"payments"}, Resources: []string{"b/linked"}},
		{ID: 8, ProjectID: 11, Name: "ledger", Environments: []string{"dev"}, Teams: []string{"ledger"}, Resources: []string{"b/hidden-only"}},
	}
	assets := []catalogAsset{
		{ResourceID: "b/linked", DisplayName: "linked bucket", Environment: "dev"},
		{ResourceID: "b/hidden-only", DisplayName: "shared bucket", Environment: "dev"},
		{ResourceID: "b/prod-only", DisplayName: "prod bucket", Environment: "prod"},
	}
	got := catalogTriage(catalogOperator(10), services, assets)
	if len(got) != 1 || got[0].ResourceID != "b/hidden-only" {
		t.Fatalf("triage = %+v", got)
	}

	previousLoad := loadCatalogRecords
	previousAssets := loadCatalogAssets
	previousSubject := catalogSubjectFromRequest
	defer func() {
		loadCatalogRecords = previousLoad
		loadCatalogAssets = previousAssets
		catalogSubjectFromRequest = previousSubject
	}()
	loadCatalogRecords = func() ([]catalogRecord, error) { return services, nil }
	loadCatalogAssets = func() ([]catalogAsset, error) { return assets, nil }
	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) { return catalogOperator(10), nil }
	recorder := httptest.NewRecorder()
	catalogTriageHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/catalog/triage", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("triage status %d %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	if strings.Contains(body, "ledger") || strings.Contains(body, "b/linked") || strings.Contains(body, "b/prod-only") {
		t.Fatalf("triage leaked a hidden or mapped asset: %s", body)
	}
	if !strings.Contains(body, "b/hidden-only") {
		t.Fatalf("triage dropped the unmapped asset: %s", body)
	}
}

func TestCatalogCreateRequiresOwnerAndEnvironment(t *testing.T) {
	store := []catalogRecord{}
	saves := 0
	restore := stubCatalogAPI(&store, &saves, catalogManager(10))
	defer restore()
	postCatalog(t, "/api/catalog/services", `{"project_id":10,"name":"payments","environments":["dev"]}`, http.StatusBadRequest)
	postCatalog(t, "/api/catalog/services", `{"project_id":10,"name":"payments","teams":["payments"]}`, http.StatusBadRequest)
	if saves != 0 {
		t.Fatal("invalid catalog create was saved")
	}
}

func stubCatalogAPI(store *[]catalogRecord, saves *int, subject authzSubject) func() {
	previousLoad := loadCatalogRecords
	previousSave := saveCatalogRecord
	previousSubject := catalogSubjectFromRequest
	loadCatalogRecords = func() ([]catalogRecord, error) {
		return append([]catalogRecord{}, *store...), nil
	}
	saveCatalogRecord = func(item catalogRecord) (catalogRecord, error) {
		*saves++
		if item.ID == 0 {
			next := 1
			for _, existing := range *store {
				if existing.ID >= next {
					next = existing.ID + 1
				}
			}
			item.ID = next
		}
		replaced := false
		for index := range *store {
			if (*store)[index].ID == item.ID {
				(*store)[index] = item
				replaced = true
			}
		}
		if !replaced {
			*store = append(*store, item)
		}
		return item, nil
	}
	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) { return subject, nil }
	return func() {
		loadCatalogRecords = previousLoad
		saveCatalogRecord = previousSave
		catalogSubjectFromRequest = previousSubject
	}
}

func postCatalog(t *testing.T, path, body string, want int) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	if strings.Count(strings.Trim(strings.TrimPrefix(path, "/api/catalog/services"), "/"), "/") == 0 && !strings.Contains(path, "/resources") {
		catalogServicesHandler(recorder, request)
	} else {
		catalogServiceDetailHandler(recorder, request)
	}
	if recorder.Code != want {
		t.Fatalf("%s status %d body %s", path, recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Service struct {
			ID int `json:"id"`
		} `json:"service"`
	}
	_ = json.Unmarshal(recorder.Body.Bytes(), &payload)
	if payload.Service.ID == 0 {
		return ""
	}
	return strconv.Itoa(payload.Service.ID)
}

func catalogOperator(projectID int) authzSubject {
	return authzSubject{
		UserID:         4,
		OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{
			OrganizationID: pilotOrganizationID,
			ProjectID:      projectID,
			Role:           "operator",
			Environments:   []string{"dev"},
		}},
	}
}

func catalogViewer(projectID int) authzSubject {
	subject := catalogOperator(projectID)
	subject.Grants[0].Role = "viewer"
	return subject
}

func catalogManager(projectID int) authzSubject {
	subject := catalogOperator(projectID)
	subject.Grants[0].Role = "manager"
	return subject
}
