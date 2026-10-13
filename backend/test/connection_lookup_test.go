package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConnectionTestHidesSecretsAndOtherProjects(t *testing.T) {
	secretRef := "projects.10.github"
	stored := connectionContract{
		ID: 4, ProjectID: 10, Name: "github", Environment: "dev", SecretRef: secretRef,
	}
	probes := 0
	restore := stubConnectionTest(stored, &probes, connectionIdentityResult{
		Identified: true,
		Capabilities: []connectionCapability{
			{Name: "contents:read", Granted: true},
			{Name: "metadata:read", Granted: false},
		},
	})
	defer restore()

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return connectionGrant(11, "operator"), nil
	}
	recorder := httptest.NewRecorder()
	connectionDetailHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/connections/4/test", nil))
	if recorder.Code != http.StatusNotFound || probes != 0 {
		t.Fatalf("hidden status %d probes %d body %s", recorder.Code, probes, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), secretRef) {
		t.Fatalf("hidden response leaked the secret reference: %s", recorder.Body.String())
	}

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return connectionGrant(10, "viewer"), nil
	}
	recorder = httptest.NewRecorder()
	connectionDetailHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/connections/4/test", nil))
	if recorder.Code != http.StatusForbidden || probes != 0 {
		t.Fatalf("viewer status %d probes %d", recorder.Code, probes)
	}

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return connectionGrant(10, "operator"), nil
	}
	recorder = httptest.NewRecorder()
	connectionDetailHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/connections/4/test", nil))
	body := recorder.Body.String()
	if recorder.Code != http.StatusOK || probes != 1 {
		t.Fatalf("test status %d probes %d body %s", recorder.Code, probes, body)
	}
	if strings.Contains(body, secretRef) || strings.Contains(body, "secret_ref\":") {
		t.Fatalf("test response included a secret reference: %s", body)
	}
	if !strings.Contains(body, `"state":"partial"`) || !strings.Contains(body, `"coverage":"partial"`) {
		t.Fatalf("permission failure was not partial: %s", body)
	}
	if !strings.Contains(body, `"secret_ref_set":true`) {
		t.Fatalf("secret reference flag missing: %s", body)
	}
}

func TestConnectionCredentialLookupStaysServerSide(t *testing.T) {
	current := connectionContract{ID: 4, ProjectID: 10, Name: "github", Environment: "dev", SecretRef: "projects.10.github"}
	credential, err := lookupConnectionCredential(current)
	if err != nil || credential.SecretRef != current.SecretRef {
		t.Fatalf("lookup = %+v err=%v", credential, err)
	}
	raw := current.Public()
	if !raw.SecretRefSet || raw.Name == "" {
		t.Fatalf("public view = %+v", raw)
	}
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	probes := 0
	restore := stubConnectionTest(current, &probes, connectionIdentityResult{})
	defer restore()
	probeConnectionIdentity = func(connectionCredential) (connectionIdentityResult, error) {
		probes++
		return connectionIdentityResult{}, errConnectionUnconfigured
	}
	view, err := testScopedConnection(connectionGrant(10, "operator"), 4, now)
	if err != nil {
		t.Fatal(err)
	}
	if view.State != "unknown" || probes != 1 {
		t.Fatalf("unconfigured test = %+v probes %d", view, probes)
	}
	if view.HealthLabel == "Healthy" || view.HealthLabel != "Unknown" {
		t.Fatalf("unconfigured health label = %s", view.HealthLabel)
	}
}

func TestDisableConnectionKeepsEvidenceAndStopsTests(t *testing.T) {
	secretRef := "projects.10.github"
	last := time.Date(2026, 10, 12, 8, 0, 0, 0, time.UTC)
	stored := connectionContract{
		ID: 4, ProjectID: 10, Name: "github", Environment: "dev",
		SecretRef: secretRef, State: "partial", Coverage: "partial",
		HasSuccess: true, LastSuccess: last,
		MissingPermissions: []string{"metadata:read"},
		LastError:          "missing permission: metadata:read",
	}
	probes := 0
	saves := 0
	previousLoad := loadConnectionByID
	previousSave := saveConnectionTestResult
	previousDisable := saveConnectionDisabled
	previousProbe := probeConnectionIdentity
	previousRecords := loadConnectionRecords
	previousSubject := catalogSubjectFromRequest
	defer func() {
		loadConnectionByID = previousLoad
		saveConnectionTestResult = previousSave
		saveConnectionDisabled = previousDisable
		probeConnectionIdentity = previousProbe
		loadConnectionRecords = previousRecords
		catalogSubjectFromRequest = previousSubject
	}()
	loadConnectionByID = func(id int) (connectionContract, error) {
		if id != stored.ID {
			return connectionContract{}, errConnectionHidden
		}
		return stored, nil
	}
	saveConnectionDisabled = func(connectionContract) (connectionContract, error) {
		saves++
		stored.Disabled = true
		return stored, nil
	}
	saveConnectionTestResult = func(contract connectionContract) (connectionContract, error) {
		t.Fatal("a disabled connection saved a new test result")
		return contract, nil
	}
	probeConnectionIdentity = func(connectionCredential) (connectionIdentityResult, error) {
		probes++
		return connectionIdentityResult{Identified: true}, nil
	}

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return connectionGrant(10, "viewer"), nil
	}
	recorder := httptest.NewRecorder()
	connectionDetailHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/connections/4/disable", nil))
	if recorder.Code != http.StatusForbidden || saves != 0 || stored.Disabled {
		t.Fatalf("viewer disable status %d saves %d disabled %v body %s", recorder.Code, saves, stored.Disabled, recorder.Body.String())
	}

	catalogSubjectFromRequest = func(*http.Request) (authzSubject, error) {
		return connectionGrant(10, "operator"), nil
	}
	recorder = httptest.NewRecorder()
	connectionDetailHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/connections/4/disable", nil))
	body := recorder.Body.String()
	if recorder.Code != http.StatusOK || saves != 1 {
		t.Fatalf("disable status %d saves %d body %s", recorder.Code, saves, body)
	}
	if !stored.Disabled || !stored.LastSuccess.Equal(last) || len(stored.MissingPermissions) != 1 || stored.SecretRef != secretRef {
		t.Fatalf("disable changed evidence: %+v", stored)
	}
	if strings.Contains(body, secretRef) || strings.Contains(body, `"health_label":"Healthy"`) {
		t.Fatalf("disable view leaked or labeled healthy: %s", body)
	}
	if !strings.Contains(body, `"health_label":"Partial"`) || !strings.Contains(body, `"disabled":true`) {
		t.Fatalf("health view: %s", body)
	}

	_, err := testScopedConnection(connectionGrant(10, "operator"), 4, time.Now().UTC())
	if !errors.Is(err, errConnectionDisabled) || probes != 0 {
		t.Fatalf("disabled test err %v probes %d", err, probes)
	}
	if !stored.LastSuccess.Equal(last) || stored.SecretRef != secretRef {
		t.Fatalf("stopped test changed evidence: %+v", stored)
	}

	loadConnectionRecords = func() ([]connectionContract, error) {
		return []connectionContract{
			stored,
			{ID: 9, ProjectID: 11, Name: "hidden", Environment: "dev", SecretRef: "projects.11.github", State: "healthy", Coverage: "full"},
		}, nil
	}
	recorder = httptest.NewRecorder()
	connectionListHandler(recorder, httptest.NewRequest(http.MethodGet, "/api/connections", nil))
	listBody := recorder.Body.String()
	if recorder.Code != http.StatusOK {
		t.Fatalf("list %d %s", recorder.Code, listBody)
	}
	if strings.Contains(listBody, "projects.11.github") || strings.Contains(listBody, secretRef) || strings.Contains(listBody, "hidden") {
		t.Fatalf("list leaked another project or a secret reference: %s", listBody)
	}
	if !strings.Contains(listBody, `"health_label":"Partial"`) || strings.Contains(listBody, `"health_label":"Healthy"`) {
		t.Fatalf("list health label: %s", listBody)
	}
}

func TestConnectionHealthLabelsStayDistinct(t *testing.T) {
	for _, state := range []string{"partial", "stale", "unknown"} {
		if connectionHealthLabel(state) == "Healthy" {
			t.Fatalf("%s labeled Healthy", state)
		}
	}
	if connectionHealthLabel("healthy") != "Healthy" {
		t.Fatal("healthy label")
	}
}

func stubConnectionTest(stored connectionContract, probes *int, result connectionIdentityResult) func() {
	previousLoad := loadConnectionByID
	previousSave := saveConnectionTestResult
	previousProbe := probeConnectionIdentity
	previousSubject := catalogSubjectFromRequest
	loadConnectionByID = func(id int) (connectionContract, error) {
		if id != stored.ID {
			return connectionContract{}, errConnectionHidden
		}
		return stored, nil
	}
	saveConnectionTestResult = func(contract connectionContract) (connectionContract, error) {
		contract.SecretRef = stored.SecretRef
		stored = contract
		return contract, nil
	}
	probeConnectionIdentity = func(cred connectionCredential) (connectionIdentityResult, error) {
		*probes++
		if cred.SecretRef == "" {
			return connectionIdentityResult{}, errors.New("credential lookup was empty")
		}
		return result, nil
	}
	return func() {
		loadConnectionByID = previousLoad
		saveConnectionTestResult = previousSave
		probeConnectionIdentity = previousProbe
		catalogSubjectFromRequest = previousSubject
	}
}
