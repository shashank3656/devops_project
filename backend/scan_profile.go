package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var (
	errScanHidden   = errors.New("scan profile not found")
	errScanDenied   = errors.New("scan profile is not permitted")
	errScanInvalid  = errors.New("scan profile is invalid")
	errScanIdentity = errors.New("account identity mismatch aborts")
	errScanWrite    = errors.New("scanner write access is not permitted")
	scanRolePattern = regexp.MustCompile(`^arn:aws:iam::(\d{12}):role/[A-Za-z0-9+=,.@_-]{1,64}$`)
)

type scanProfile struct {
	ID        int      `json:"id"`
	ProjectID int      `json:"project_id"`
	AccountID string   `json:"account_id"`
	RoleARN   string   `json:"role_arn"`
	Region    string   `json:"region"`
	ReadOnly  bool     `json:"read_only"`
	Actions   []string `json:"actions"`
	State     string   `json:"state"`
}

type scanAssumption struct {
	ProfileID           int    `json:"profile_id"`
	AccountID           string `json:"account_id"`
	Aborted             bool   `json:"aborted"`
	CredentialsIssued   bool   `json:"credentials_issued"`
	TemporaryCredential string `json:"temporary_credential,omitempty"`
	ExpiresAt           string `json:"expires_at,omitempty"`
}

var (
	saveScanProfile  = saveScanProfileToDB
	loadScanProfile  = loadScanProfileFromDB
	abortScanProfile = abortScanProfileInDB
)

func prepareScanProfile(actor authzSubject, item scanProfile) (scanProfile, error) {
	item.AccountID = strings.TrimSpace(item.AccountID)
	item.RoleARN = strings.TrimSpace(item.RoleARN)
	item.Region = strings.TrimSpace(item.Region)
	if item.ProjectID <= 0 || item.Region == "" || !regexp.MustCompile(`^\d{12}$`).MatchString(item.AccountID) {
		return scanProfile{}, errScanInvalid
	}
	if !mappingAllowed(actor, item.ProjectID, authzRead) {
		return scanProfile{}, errScanHidden
	}
	if !mappingAllowed(actor, item.ProjectID, authzWrite) {
		return scanProfile{}, errScanDenied
	}
	match := scanRolePattern.FindStringSubmatch(item.RoleARN)
	if match == nil {
		return scanProfile{}, errScanInvalid
	}
	if match[1] != item.AccountID {
		return scanProfile{}, errScanIdentity
	}
	if !scanActionsReadOnly(item.Actions) {
		return scanProfile{}, errScanWrite
	}
	item.ReadOnly = true
	item.State = "ready"
	return saveScanProfile(item)
}

func scanActionsReadOnly(actions []string) bool {
	if len(actions) == 0 {
		return false
	}
	for _, action := range actions {
		action = strings.TrimSpace(action)
		switch {
		case strings.HasPrefix(action, "sts:Get"),
			strings.HasPrefix(action, "ec2:Describe"),
			strings.HasPrefix(action, "s3:Get"),
			strings.HasPrefix(action, "s3:List"),
			strings.HasPrefix(action, "iam:Get"),
			strings.HasPrefix(action, "iam:List"):
			continue
		default:
			return false
		}
	}
	return true
}

func assumeScanProfile(actor authzSubject, profileID int, observedAccount string) (scanAssumption, error) {
	saved, err := loadScanProfile(profileID)
	if err != nil || saved.ID <= 0 {
		return scanAssumption{}, errScanHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzRead) {
		return scanAssumption{}, errScanHidden
	}
	if !mappingAllowed(actor, saved.ProjectID, authzWrite) {
		return scanAssumption{}, errScanDenied
	}
	observedAccount = strings.TrimSpace(observedAccount)
	if observedAccount == "" || observedAccount != saved.AccountID || !saved.ReadOnly || saved.State == "aborted" {
		_ = abortScanProfile(saved.ID)
		return scanAssumption{ProfileID: saved.ID, AccountID: saved.AccountID, Aborted: true, CredentialsIssued: false}, errScanIdentity
	}
	return scanAssumption{
		ProfileID: saved.ID, AccountID: saved.AccountID, Aborted: false,
		CredentialsIssued: true, ExpiresAt: time.Now().UTC().Add(15 * time.Minute).Format(time.RFC3339),
	}, nil
}

func migrateScanProfileSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS scan_profiles (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			account_id VARCHAR(12) NOT NULL,
			role_arn VARCHAR(256) NOT NULL,
			region VARCHAR(64) NOT NULL,
			read_only BOOLEAN NOT NULL DEFAULT TRUE,
			actions TEXT NOT NULL DEFAULT '',
			state VARCHAR(32) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func saveScanProfileToDB(item scanProfile) (scanProfile, error) {
	if DB == nil {
		return scanProfile{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO scan_profiles (project_id, account_id, role_arn, region, read_only, actions, state)
		VALUES ($1, $2, $3, $4, TRUE, $5, 'ready') RETURNING id
	`, item.ProjectID, item.AccountID, item.RoleARN, item.Region, strings.Join(item.Actions, ",")).Scan(&item.ID)
	if err != nil {
		return scanProfile{}, err
	}
	item.ReadOnly = true
	item.State = "ready"
	return item, nil
}

func loadScanProfileFromDB(id int) (scanProfile, error) {
	if DB == nil || id <= 0 {
		return scanProfile{}, errScanHidden
	}
	var item scanProfile
	var actions string
	err := DB.QueryRow(`
		SELECT id, project_id, account_id, role_arn, region, read_only, actions, state
		FROM scan_profiles WHERE id = $1
	`, id).Scan(&item.ID, &item.ProjectID, &item.AccountID, &item.RoleARN, &item.Region, &item.ReadOnly, &actions, &item.State)
	if err != nil {
		return scanProfile{}, errScanHidden
	}
	if actions != "" {
		item.Actions = strings.Split(actions, ",")
	}
	return item, nil
}

func abortScanProfileInDB(id int) error {
	if DB == nil {
		return errInboxStored
	}
	_, err := DB.Exec(`UPDATE scan_profiles SET state = 'aborted' WHERE id = $1`, id)
	return err
}

func scanProfileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var item scanProfile
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeScanError(w, r, errScanInvalid)
		return
	}
	saved, err := prepareScanProfile(actor, item)
	if err != nil {
		writeScanError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func scanAssumeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body struct {
		ProfileID       int    `json:"profile_id"`
		ObservedAccount string `json:"observed_account"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeScanError(w, r, errScanInvalid)
		return
	}
	result, err := assumeScanProfile(actor, body.ProfileID, body.ObservedAccount)
	if err != nil {
		writeScanError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, result)
}

func writeScanError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errScanHidden):
		writeAPIError(w, r, http.StatusNotFound, errScanHidden.Error(), nil)
	case errors.Is(err, errScanDenied):
		writeAPIError(w, r, http.StatusForbidden, errScanDenied.Error(), nil)
	case errors.Is(err, errScanIdentity):
		writeAPIError(w, r, http.StatusConflict, errScanIdentity.Error(), nil)
	case errors.Is(err, errScanBounded):
		writeAPIError(w, r, http.StatusConflict, errScanBounded.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
	}
}
