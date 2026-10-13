package main

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var errConnectionUnconfigured = errors.New("connection test is not configured")

type connectionCredential struct {
	SecretRef string
}

type connectionIdentityResult struct {
	Identified       bool
	PermissionFailed bool
	Capabilities     []connectionCapability
}

var loadConnectionByID = loadConnectionByIDFromDB
var saveConnectionTestResult = saveConnectionTestResultToDB
var probeConnectionIdentity = defaultProbeConnectionIdentity

func defaultProbeConnectionIdentity(connectionCredential) (connectionIdentityResult, error) {
	return connectionIdentityResult{}, errConnectionUnconfigured
}

func lookupConnectionCredential(current connectionContract) (connectionCredential, error) {
	ref := strings.TrimSpace(current.SecretRef)
	if ref == "" {
		return connectionCredential{}, nil
	}
	return connectionCredential{SecretRef: ref}, nil
}

func testScopedConnection(subject authzSubject, id int, now time.Time) (connectionContractView, error) {
	current, err := loadConnectionByID(id)
	if err != nil || current.ID <= 0 || current.ProjectID <= 0 {
		return connectionContractView{}, errConnectionHidden
	}
	environment := current.Environment
	if strings.TrimSpace(environment) == "" {
		environment = "*"
	}
	if !catalogEnvironmentsAllowed(subject, current.ProjectID, []string{environment}, authzRead) {
		return connectionContractView{}, errConnectionHidden
	}
	if !catalogEnvironmentsAllowed(subject, current.ProjectID, []string{environment}, authzWrite) {
		return connectionContractView{}, errConnectionDenied
	}
	if current.Disabled {
		return connectionContractView{}, errConnectionDisabled
	}
	credential, err := lookupConnectionCredential(current)
	if err != nil {
		return connectionContractView{}, redactConnectionSecret(err, current.SecretRef)
	}
	result, probeErr := probeConnectionIdentity(credential)
	if probeErr != nil && !errors.Is(probeErr, errConnectionUnconfigured) {
		return connectionContractView{}, redactConnectionSecret(probeErr, current.SecretRef, credential.SecretRef)
	}
	obs := connectionObservation{
		ProjectID:        current.ProjectID,
		Name:             current.Name,
		Environment:      environment,
		SecretRef:        current.SecretRef,
		ObservedAt:       now,
		Capabilities:     result.Capabilities,
		PermissionFailed: result.PermissionFailed,
	}
	missing := missingConnectionPermissions(obs)
	if len(missing) > 0 {
		obs.PermissionFailed = true
		obs.HasSuccess = current.HasSuccess
		obs.LastSuccess = current.LastSuccess
	} else if probeErr == nil && result.Identified {
		obs.HasSuccess = true
		obs.LastSuccess = now
	}
	contract, err := evaluateConnectionContract(obs)
	if err != nil {
		return connectionContractView{}, redactConnectionSecret(err, current.SecretRef)
	}
	contract.ID = current.ID
	contract.Disabled = current.Disabled
	if len(contract.MissingPermissions) > 0 {
		contract.LastError = "missing permission: " + strings.Join(contract.MissingPermissions, ", ")
	} else if errors.Is(probeErr, errConnectionUnconfigured) {
		contract.LastError = errConnectionUnconfigured.Error()
	}
	saved, err := saveConnectionTestResult(contract)
	if err != nil {
		return connectionContractView{}, redactConnectionSecret(err, current.SecretRef)
	}
	return saved.Public(), nil
}

func redactConnectionSecret(err error, secrets ...string) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	for _, secret := range secrets {
		secret = strings.TrimSpace(secret)
		if secret == "" {
			continue
		}
		message = strings.ReplaceAll(message, secret, "[redacted]")
	}
	return errors.New(message)
}

func connectionDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, errCatalogUnauthorized.Error(), nil)
		return
	}
	id, action, ok := parseConnectionPath(r.URL.Path)
	if !ok || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid connection id", nil)
		return
	}
	switch {
	case action == "" && r.Method == http.MethodGet:
		current, err := loadConnectionByID(id)
		if err != nil || current.ID <= 0 {
			writeConnectionError(w, r, errConnectionHidden)
			return
		}
		if !catalogEnvironmentsAllowed(subject, current.ProjectID, []string{current.Environment}, authzRead) {
			writeConnectionError(w, r, errConnectionHidden)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"connection": current.Public(), "status": "ok"})
	case action == "test" && r.Method == http.MethodPost:
		view, err := testScopedConnection(subject, id, time.Now().UTC())
		if err != nil {
			writeConnectionError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"connection": view, "status": "ok"})
	case action == "disable" && r.Method == http.MethodPost:
		view, err := disableConnection(subject, id)
		if err != nil {
			writeConnectionError(w, r, err)
			return
		}
		_ = writeJSONResponse(w, http.StatusOK, map[string]any{"connection": view, "status": "ok"})
	default:
		writeMethodNotAllowed(w, r)
	}
}

func parseConnectionPath(path string) (int, string, bool) {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/connections/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || parts[0] == "" {
		return 0, "", false
	}
	id, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, "", false
	}
	if len(parts) == 1 {
		return id, "", true
	}
	if len(parts) == 2 && (parts[1] == "test" || parts[1] == "disable") {
		return id, parts[1], true
	}
	return 0, "", false
}

func writeConnectionError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errConnectionHidden):
		writeAPIError(w, r, http.StatusNotFound, errConnectionHidden.Error(), nil)
	case errors.Is(err, errConnectionDenied):
		writeAPIError(w, r, http.StatusForbidden, errConnectionDenied.Error(), nil)
	case errors.Is(err, errConnectionSecret):
		writeAPIError(w, r, http.StatusBadRequest, errConnectionSecret.Error(), nil)
	case errors.Is(err, errConnectionDisabled):
		writeAPIError(w, r, http.StatusConflict, errConnectionDisabled.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}

func loadConnectionByIDFromDB(id int) (connectionContract, error) {
	if DB == nil {
		return connectionContract{}, errors.New("database not available")
	}
	var contract connectionContract
	var secretRef, missing string
	var lastSuccess sql.NullTime
	err := queryRowContext(`
		SELECT id, project_id, name, environment, secret_ref, state, coverage, last_success_at, missing_permissions, disabled, last_error
		FROM connection_contracts
		WHERE id = $1
	`, id).Scan(&contract.ID, &contract.ProjectID, &contract.Name, &contract.Environment, &secretRef, &contract.State, &contract.Coverage, &lastSuccess, &missing, &contract.Disabled, &contract.LastError)
	if err == sql.ErrNoRows {
		return connectionContract{}, errConnectionHidden
	}
	if err != nil {
		if isMissingDatabaseRelation(err, "connection_contracts") {
			return connectionContract{}, errConnectionHidden
		}
		return connectionContract{}, err
	}
	contract.SecretRef = strings.TrimSpace(secretRef)
	contract.Environment = strings.ToLower(strings.TrimSpace(contract.Environment))
	if lastSuccess.Valid {
		contract.LastSuccess = lastSuccess.Time.UTC()
		contract.HasSuccess = true
	}
	if strings.TrimSpace(missing) != "" {
		contract.MissingPermissions = strings.Split(missing, ",")
	}
	return contract, nil
}

func saveConnectionTestResultToDB(contract connectionContract) (connectionContract, error) {
	if DB == nil {
		return connectionContract{}, errors.New("database not available")
	}
	var last any
	if contract.HasSuccess && !contract.LastSuccess.IsZero() {
		last = contract.LastSuccess.UTC()
	}
	_, err := execContext(`
		UPDATE connection_contracts
		SET state = $2, coverage = $3, last_success_at = $4, missing_permissions = $5, last_error = $6, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, contract.ID, contract.State, contract.Coverage, last, strings.Join(contract.MissingPermissions, ","), contract.LastError)
	if err != nil {
		return connectionContract{}, err
	}
	return contract, nil
}

var loadConnectionRecords = loadConnectionRecordsFromDB
var saveConnectionDisabled = saveConnectionDisabledToDB

func listVisibleConnections(subject authzSubject, records []connectionContract) []connectionContractView {
	out := []connectionContractView{}
	for _, record := range records {
		environment := record.Environment
		if strings.TrimSpace(environment) == "" {
			environment = "*"
		}
		if !catalogEnvironmentsAllowed(subject, record.ProjectID, []string{environment}, authzRead) {
			continue
		}
		out = append(out, record.Public())
	}
	return out
}

func disableConnection(subject authzSubject, id int) (connectionContractView, error) {
	current, err := loadConnectionByID(id)
	if err != nil || current.ID <= 0 || current.ProjectID <= 0 {
		return connectionContractView{}, errConnectionHidden
	}
	environment := current.Environment
	if strings.TrimSpace(environment) == "" {
		environment = "*"
	}
	if !catalogEnvironmentsAllowed(subject, current.ProjectID, []string{environment}, authzRead) {
		return connectionContractView{}, errConnectionHidden
	}
	if !catalogEnvironmentsAllowed(subject, current.ProjectID, []string{environment}, authzWrite) {
		return connectionContractView{}, errConnectionDenied
	}
	current.Disabled = true
	saved, err := saveConnectionDisabled(current)
	if err != nil {
		return connectionContractView{}, redactConnectionSecret(err, current.SecretRef)
	}
	return saved.Public(), nil
}

func connectionListHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	subject, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, errCatalogUnauthorized.Error(), nil)
		return
	}
	records, err := loadConnectionRecords()
	if err != nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "connections are unavailable", err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, map[string]any{
		"connections": listVisibleConnections(subject, records),
		"status":      "ok",
	})
}

func loadConnectionRecordsFromDB() ([]connectionContract, error) {
	if DB == nil {
		return nil, errors.New("database not available")
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, project_id, name, environment, secret_ref, state, coverage, last_success_at, missing_permissions, disabled, last_error
		FROM connection_contracts
		ORDER BY id
	`)
	if err != nil {
		if isMissingDatabaseRelation(err, "connection_contracts") {
			return []connectionContract{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []connectionContract{}
	for rows.Next() {
		var contract connectionContract
		var secretRef, missing string
		var lastSuccess sql.NullTime
		if err := rows.Scan(&contract.ID, &contract.ProjectID, &contract.Name, &contract.Environment, &secretRef, &contract.State, &contract.Coverage, &lastSuccess, &missing, &contract.Disabled, &contract.LastError); err != nil {
			return nil, err
		}
		contract.SecretRef = strings.TrimSpace(secretRef)
		contract.Environment = strings.ToLower(strings.TrimSpace(contract.Environment))
		if lastSuccess.Valid {
			contract.LastSuccess = lastSuccess.Time.UTC()
			contract.HasSuccess = true
		}
		if strings.TrimSpace(missing) != "" {
			contract.MissingPermissions = strings.Split(missing, ",")
		}
		out = append(out, contract)
	}
	return out, rows.Err()
}

func saveConnectionDisabledToDB(contract connectionContract) (connectionContract, error) {
	if DB == nil {
		return connectionContract{}, errors.New("database not available")
	}
	_, err := execContext(`UPDATE connection_contracts SET disabled = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, contract.ID)
	if err != nil {
		return connectionContract{}, err
	}
	return contract, nil
}
