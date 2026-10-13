package main

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

const connectionFreshWindow = 24 * time.Hour

var connectionSecretRefPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

var (
	errConnectionHidden   = errors.New("connection not found")
	errConnectionDenied   = errors.New("connection scope denied")
	errConnectionSecret   = errors.New("secret values are not stored")
	errConnectionDisabled = errors.New("connection is disabled")
)

type connectionCapability struct {
	Name    string
	Granted bool
}

type connectionObservation struct {
	ProjectID        int
	Name             string
	Environment      string
	SecretRef        string
	SecretValue      string
	LastSuccess      time.Time
	HasSuccess       bool
	PermissionFailed bool
	Capabilities     []connectionCapability
	ObservedAt       time.Time
}

type connectionContract struct {
	ID                 int
	ProjectID          int
	Name               string
	Environment        string
	SecretRef          string
	State              string
	Coverage           string
	LastSuccess        time.Time
	HasSuccess         bool
	MissingPermissions []string
	Disabled           bool
	LastError          string
}

type connectionContractView struct {
	ID                 int       `json:"id"`
	ProjectID          int       `json:"project_id"`
	Name               string    `json:"name"`
	Environment        string    `json:"environment"`
	State              string    `json:"state"`
	Coverage           string    `json:"coverage"`
	SecretRefSet       bool      `json:"secret_ref_set"`
	LastSuccess        time.Time `json:"last_success,omitempty"`
	MissingPermissions []string  `json:"missing_permissions"`
	Disabled           bool      `json:"disabled"`
	LastError          string    `json:"last_error,omitempty"`
	HealthLabel        string    `json:"health_label"`
}

func evaluateConnectionContract(obs connectionObservation) (connectionContract, error) {
	if strings.TrimSpace(obs.SecretValue) != "" {
		return connectionContract{}, errConnectionSecret
	}
	ref := strings.TrimSpace(obs.SecretRef)
	if ref != "" && !connectionSecretRefPattern.MatchString(ref) {
		return connectionContract{}, errors.New("secret reference is invalid")
	}
	name := strings.TrimSpace(obs.Name)
	if obs.ProjectID <= 0 {
		return connectionContract{}, errors.New("project_id is required")
	}
	if name == "" {
		return connectionContract{}, errors.New("connection name is required")
	}
	environment := strings.ToLower(strings.TrimSpace(obs.Environment))
	if environment == "" {
		environment = "*"
	}
	missing := missingConnectionPermissions(obs)
	contract := connectionContract{
		ProjectID:          obs.ProjectID,
		Name:               name,
		Environment:        environment,
		SecretRef:          ref,
		LastSuccess:        obs.LastSuccess,
		HasSuccess:         obs.HasSuccess,
		MissingPermissions: missing,
	}
	switch {
	case len(missing) > 0:
		contract.State = "partial"
		contract.Coverage = "partial"
	case ref == "" || !obs.HasSuccess || obs.LastSuccess.IsZero():
		contract.State = "unknown"
		contract.Coverage = "unknown"
	case connectionIsStale(obs, connectionFreshWindow):
		contract.State = "stale"
		contract.Coverage = "full"
	default:
		contract.State = "healthy"
		contract.Coverage = "full"
	}
	return contract, nil
}

func missingConnectionPermissions(obs connectionObservation) []string {
	missing := []string{}
	if obs.PermissionFailed {
		missing = append(missing, "permission")
	}
	for _, capability := range obs.Capabilities {
		name := strings.TrimSpace(capability.Name)
		if name == "" || capability.Granted {
			continue
		}
		missing = append(missing, name)
	}
	return missing
}

func connectionIsStale(obs connectionObservation, window time.Duration) bool {
	if !obs.HasSuccess || obs.LastSuccess.IsZero() {
		return false
	}
	observed := obs.ObservedAt
	if observed.IsZero() {
		observed = time.Now()
	}
	if window <= 0 {
		window = connectionFreshWindow
	}
	return observed.Sub(obs.LastSuccess) > window
}

func (contract connectionContract) Public() connectionContractView {
	view := connectionContractView{
		ID:                 contract.ID,
		ProjectID:          contract.ProjectID,
		Name:               contract.Name,
		Environment:        contract.Environment,
		State:              contract.State,
		Coverage:           contract.Coverage,
		SecretRefSet:       contract.SecretRef != "",
		MissingPermissions: append([]string{}, contract.MissingPermissions...),
		Disabled:           contract.Disabled,
		LastError:          contract.LastError,
		HealthLabel:        connectionHealthLabel(contract.State),
	}
	if contract.HasSuccess && !contract.LastSuccess.IsZero() {
		view.LastSuccess = contract.LastSuccess
	}
	if view.MissingPermissions == nil {
		view.MissingPermissions = []string{}
	}
	return view
}

func connectionHealthLabel(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "healthy":
		return "Healthy"
	case "partial":
		return "Partial"
	case "stale":
		return "Stale"
	default:
		return "Unknown"
	}
}

func recordConnectionContract(subject authzSubject, obs connectionObservation) (connectionContractView, error) {
	environment := strings.ToLower(strings.TrimSpace(obs.Environment))
	if environment == "" {
		environment = "*"
	}
	if !catalogEnvironmentsAllowed(subject, obs.ProjectID, []string{environment}, authzRead) {
		return connectionContractView{}, errConnectionHidden
	}
	if !catalogEnvironmentsAllowed(subject, obs.ProjectID, []string{environment}, authzWrite) {
		return connectionContractView{}, errConnectionDenied
	}
	contract, err := evaluateConnectionContract(obs)
	if err != nil {
		return connectionContractView{}, err
	}
	return contract.Public(), nil
}

func migrateConnectionContractSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS connection_contracts (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			name VARCHAR(200) NOT NULL,
			secret_ref VARCHAR(128) NOT NULL DEFAULT '',
			state VARCHAR(32) NOT NULL,
			coverage VARCHAR(32) NOT NULL,
			environment VARCHAR(100) NOT NULL DEFAULT '*',
			last_success_at TIMESTAMP,
			missing_permissions TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (project_id, name)
		)
	`)
	_, _ = DB.Exec(`ALTER TABLE connection_contracts ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE`)
	_, _ = DB.Exec(`ALTER TABLE connection_contracts ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT ''`)
}
