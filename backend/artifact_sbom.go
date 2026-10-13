package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

const pinnedSBOMFormat = "cyclonedx-1.5"

var (
	errSBOMHidden         = errors.New("artifact not found")
	errSBOMDenied         = errors.New("artifact is not permitted")
	errSBOMInvalid        = errors.New("artifact is invalid")
	artifactDigestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

type artifactComponent struct {
	ID      int    `json:"id"`
	SBOMID  int    `json:"sbom_id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	PURL    string `json:"purl"`
}

type artifactSBOM struct {
	ID         int                 `json:"id"`
	ProjectID  int                 `json:"project_id"`
	Digest     string              `json:"digest"`
	Tag        string              `json:"tag"`
	Format     string              `json:"format"`
	State      string              `json:"state"`
	Complete   bool                `json:"complete"`
	Components []artifactComponent `json:"components"`
}

type artifactExposure struct {
	ID          int    `json:"id"`
	ProjectID   int    `json:"project_id"`
	Digest      string `json:"digest"`
	Environment string `json:"environment"`
	AttemptID   int    `json:"attempt_id"`
}

type artifactFinding struct {
	ID             int    `json:"id"`
	ProjectID      int    `json:"project_id"`
	Digest         string `json:"digest"`
	RuleID         string `json:"rule_id"`
	PackageName    string `json:"package_name"`
	PackageVersion string `json:"package_version"`
	PURL           string `json:"purl"`
}

type artifactContext struct {
	ProjectID    int                 `json:"project_id"`
	Digest       string              `json:"digest"`
	Tag          string              `json:"tag"`
	Format       string              `json:"format"`
	State        string              `json:"state"`
	Complete     bool                `json:"complete"`
	Exposure     string              `json:"exposure"`
	Environments []artifactExposure  `json:"environments"`
	Components   []artifactComponent `json:"components"`
	Findings     []artifactFinding   `json:"findings"`
}

type sbomInput struct {
	ProjectID  int
	Digest     string
	Tag        string
	Format     string
	Components []artifactComponent
}

var (
	saveArtifactSBOM        = saveArtifactSBOMToDB
	findArtifactSBOM        = findArtifactSBOMFromDB
	insertArtifactComponent = insertArtifactComponentToDB
	saveArtifactExposure    = saveArtifactExposureToDB
	listArtifactExposures   = listArtifactExposuresFromDB
	saveArtifactFinding     = saveArtifactFindingToDB
	findArtifactFinding     = findArtifactFindingFromDB
	listArtifactFindings    = listArtifactFindingsFromDB
	loadArtifactAttempt     = loadDeploymentAttemptFromDB
)

func recordSBOM(actor authzSubject, input sbomInput) (artifactSBOM, error) {
	if input.ProjectID <= 0 || !mappingAllowed(actor, input.ProjectID, authzRead) {
		return artifactSBOM{}, errSBOMHidden
	}
	if !mappingAllowed(actor, input.ProjectID, authzWrite) {
		return artifactSBOM{}, errSBOMDenied
	}
	normalized, err := normalizeSBOM(input)
	if err != nil {
		return artifactSBOM{}, err
	}
	existing, err := findArtifactSBOM(input.ProjectID, normalized.Digest)
	if err != nil {
		return artifactSBOM{}, err
	}
	if existing.ID > 0 {
		return existing, nil
	}
	components := normalized.Components
	normalized.Components = nil
	saved, err := saveArtifactSBOM(normalized)
	if err != nil {
		return artifactSBOM{}, err
	}
	for _, component := range components {
		component.SBOMID = saved.ID
		stored, err := insertArtifactComponent(component)
		if err != nil {
			return artifactSBOM{}, err
		}
		saved.Components = append(saved.Components, stored)
	}
	return saved, nil
}

func normalizeSBOM(input sbomInput) (artifactSBOM, error) {
	item := artifactSBOM{
		ProjectID: input.ProjectID,
		Digest:    strings.ToLower(strings.TrimSpace(input.Digest)),
		Tag:       strings.TrimSpace(input.Tag),
		Format:    strings.TrimSpace(input.Format),
		State:     "complete",
		Complete:  true,
	}
	if item.Format == "" {
		item.Format = pinnedSBOMFormat
	}
	if !artifactDigestPattern.MatchString(item.Digest) || item.Tag == "" || strings.Contains(item.Tag, "\n") || item.Format != pinnedSBOMFormat {
		return artifactSBOM{}, errSBOMInvalid
	}
	if len(input.Components) == 0 {
		item.State = "incomplete"
		item.Complete = false
		return item, nil
	}
	for _, component := range input.Components {
		component.Name = strings.TrimSpace(component.Name)
		component.Version = strings.TrimSpace(component.Version)
		component.PURL = strings.TrimSpace(component.PURL)
		if component.Name == "" || strings.Contains(component.Name, "\n") {
			return artifactSBOM{}, errSBOMInvalid
		}
		if component.Version == "" || component.PURL == "" {
			item.State = "incomplete"
			item.Complete = false
		}
		item.Components = append(item.Components, artifactComponent{Name: component.Name, Version: component.Version, PURL: component.PURL})
	}
	return item, nil
}

func recordArtifactExposure(actor authzSubject, projectID int, digest, environment string, attemptID int) (artifactExposure, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return artifactExposure{}, errSBOMHidden
	}
	if !mappingAllowed(actor, projectID, authzWrite) {
		return artifactExposure{}, errSBOMDenied
	}
	digest = strings.ToLower(strings.TrimSpace(digest))
	environment = strings.TrimSpace(environment)
	if !artifactDigestPattern.MatchString(digest) || environment == "" {
		return artifactExposure{}, errSBOMInvalid
	}
	sbom, err := findArtifactSBOM(projectID, digest)
	if err != nil || sbom.ID <= 0 {
		return artifactExposure{}, errSBOMHidden
	}
	if attemptID > 0 {
		attempt, err := loadArtifactAttempt(attemptID)
		if err != nil || attempt.ID <= 0 || attempt.ProjectID != projectID {
			return artifactExposure{}, errSBOMHidden
		}
		if attempt.ImageDigest != digest || attempt.Environment != environment {
			return artifactExposure{}, errSBOMInvalid
		}
	}
	for _, existing := range mustListExposures(projectID, digest) {
		if existing.Environment == environment {
			return existing, nil
		}
	}
	return saveArtifactExposure(artifactExposure{ProjectID: projectID, Digest: digest, Environment: environment, AttemptID: attemptID})
}

func recordArtifactFinding(actor authzSubject, finding artifactFinding) (artifactFinding, error) {
	if finding.ProjectID <= 0 || !mappingAllowed(actor, finding.ProjectID, authzRead) {
		return artifactFinding{}, errSBOMHidden
	}
	if !mappingAllowed(actor, finding.ProjectID, authzWrite) {
		return artifactFinding{}, errSBOMDenied
	}
	finding.Digest = strings.ToLower(strings.TrimSpace(finding.Digest))
	finding.RuleID = strings.TrimSpace(finding.RuleID)
	finding.PackageName = strings.TrimSpace(finding.PackageName)
	finding.PackageVersion = strings.TrimSpace(finding.PackageVersion)
	finding.PURL = strings.TrimSpace(finding.PURL)
	if !artifactDigestPattern.MatchString(finding.Digest) || finding.RuleID == "" || finding.PackageName == "" || finding.PURL == "" {
		return artifactFinding{}, errSBOMInvalid
	}
	sbom, err := findArtifactSBOM(finding.ProjectID, finding.Digest)
	if err != nil || sbom.ID <= 0 {
		return artifactFinding{}, errSBOMHidden
	}
	if existing, err := findArtifactFinding(finding.ProjectID, finding.Digest, finding.RuleID, finding.PURL); err != nil {
		return artifactFinding{}, err
	} else if existing.ID > 0 {
		return existing, nil
	}
	return saveArtifactFinding(finding)
}

func artifactExposureContext(actor authzSubject, projectID int, digest string) (artifactContext, error) {
	if projectID <= 0 || !mappingAllowed(actor, projectID, authzRead) {
		return artifactContext{}, errSBOMHidden
	}
	digest = strings.ToLower(strings.TrimSpace(digest))
	sbom, err := findArtifactSBOM(projectID, digest)
	if err != nil || sbom.ID <= 0 {
		return artifactContext{}, errSBOMHidden
	}
	exposures, err := listArtifactExposures(projectID, digest)
	if err != nil {
		return artifactContext{}, err
	}
	findings, err := listArtifactFindings(projectID, digest)
	if err != nil {
		return artifactContext{}, err
	}
	exposure := "unknown"
	if len(exposures) > 0 {
		exposure = "deployed"
	}
	if !sbom.Complete {
		sbom.State = "incomplete"
	}
	return artifactContext{
		ProjectID: projectID, Digest: sbom.Digest, Tag: sbom.Tag, Format: sbom.Format,
		State: sbom.State, Complete: sbom.Complete, Exposure: exposure,
		Environments: exposures, Components: sbom.Components, Findings: findings,
	}, nil
}

func mustListExposures(projectID int, digest string) []artifactExposure {
	items, _ := listArtifactExposures(projectID, digest)
	return items
}

func migrateArtifactSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS artifact_sboms (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			digest VARCHAR(80) NOT NULL,
			tag VARCHAR(128) NOT NULL,
			format VARCHAR(32) NOT NULL,
			state VARCHAR(32) NOT NULL,
			complete BOOLEAN NOT NULL,
			UNIQUE (project_id, digest)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS artifact_components (
			id SERIAL PRIMARY KEY,
			sbom_id INTEGER NOT NULL,
			name VARCHAR(200) NOT NULL,
			version VARCHAR(128) NOT NULL DEFAULT '',
			purl TEXT NOT NULL DEFAULT ''
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS artifact_exposures (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			digest VARCHAR(80) NOT NULL,
			environment VARCHAR(100) NOT NULL,
			attempt_id INTEGER NOT NULL DEFAULT 0,
			UNIQUE (project_id, digest, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS artifact_findings (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			digest VARCHAR(80) NOT NULL,
			rule_id VARCHAR(128) NOT NULL,
			package_name VARCHAR(200) NOT NULL,
			package_version VARCHAR(128) NOT NULL DEFAULT '',
			purl TEXT NOT NULL,
			UNIQUE (project_id, digest, rule_id, purl)
		)
	`)
}

func saveArtifactSBOMToDB(item artifactSBOM) (artifactSBOM, error) {
	if DB == nil {
		return artifactSBOM{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO artifact_sboms (project_id, digest, tag, format, state, complete)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, item.ProjectID, item.Digest, item.Tag, item.Format, item.State, item.Complete).Scan(&item.ID)
	return item, err
}

func findArtifactSBOMFromDB(projectID int, digest string) (artifactSBOM, error) {
	if DB == nil {
		return artifactSBOM{}, nil
	}
	var item artifactSBOM
	err := DB.QueryRow(`
		SELECT id, project_id, digest, tag, format, state, complete
		FROM artifact_sboms WHERE project_id = $1 AND digest = $2
	`, projectID, digest).Scan(&item.ID, &item.ProjectID, &item.Digest, &item.Tag, &item.Format, &item.State, &item.Complete)
	if err != nil {
		return artifactSBOM{}, nil
	}
	item.Components, _ = listArtifactComponentsFromDB(item.ID)
	return item, nil
}

func insertArtifactComponentToDB(item artifactComponent) (artifactComponent, error) {
	if DB == nil {
		return artifactComponent{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO artifact_components (sbom_id, name, version, purl) VALUES ($1,$2,$3,$4) RETURNING id
	`, item.SBOMID, item.Name, item.Version, item.PURL).Scan(&item.ID)
	return item, err
}

func listArtifactComponentsFromDB(sbomID int) ([]artifactComponent, error) {
	rows, err := DB.Query(`SELECT id, sbom_id, name, version, purl FROM artifact_components WHERE sbom_id = $1 ORDER BY id`, sbomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []artifactComponent
	for rows.Next() {
		var item artifactComponent
		if err := rows.Scan(&item.ID, &item.SBOMID, &item.Name, &item.Version, &item.PURL); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveArtifactExposureToDB(item artifactExposure) (artifactExposure, error) {
	if DB == nil {
		return artifactExposure{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO artifact_exposures (project_id, digest, environment, attempt_id)
		VALUES ($1,$2,$3,$4) RETURNING id
	`, item.ProjectID, item.Digest, item.Environment, item.AttemptID).Scan(&item.ID)
	return item, err
}

func listArtifactExposuresFromDB(projectID int, digest string) ([]artifactExposure, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, digest, environment, attempt_id
		FROM artifact_exposures WHERE project_id = $1 AND digest = $2 ORDER BY id
	`, projectID, digest)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []artifactExposure
	for rows.Next() {
		var item artifactExposure
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Digest, &item.Environment, &item.AttemptID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func saveArtifactFindingToDB(item artifactFinding) (artifactFinding, error) {
	if DB == nil {
		return artifactFinding{}, errInboxStored
	}
	err := DB.QueryRow(`
		INSERT INTO artifact_findings (project_id, digest, rule_id, package_name, package_version, purl)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, item.ProjectID, item.Digest, item.RuleID, item.PackageName, item.PackageVersion, item.PURL).Scan(&item.ID)
	return item, err
}

func findArtifactFindingFromDB(projectID int, digest, ruleID, purl string) (artifactFinding, error) {
	if DB == nil {
		return artifactFinding{}, nil
	}
	var item artifactFinding
	err := DB.QueryRow(`
		SELECT id, project_id, digest, rule_id, package_name, package_version, purl
		FROM artifact_findings WHERE project_id = $1 AND digest = $2 AND rule_id = $3 AND purl = $4
	`, projectID, digest, ruleID, purl).Scan(&item.ID, &item.ProjectID, &item.Digest, &item.RuleID, &item.PackageName, &item.PackageVersion, &item.PURL)
	if err != nil {
		return artifactFinding{}, nil
	}
	return item, nil
}

func listArtifactFindingsFromDB(projectID int, digest string) ([]artifactFinding, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`
		SELECT id, project_id, digest, rule_id, package_name, package_version, purl
		FROM artifact_findings WHERE project_id = $1 AND digest = $2 ORDER BY id
	`, projectID, digest)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []artifactFinding
	for rows.Next() {
		var item artifactFinding
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.Digest, &item.RuleID, &item.PackageName, &item.PackageVersion, &item.PURL); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func sbomHandler(w http.ResponseWriter, r *http.Request) {
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
		ProjectID  int                 `json:"project_id"`
		Digest     string              `json:"digest"`
		Tag        string              `json:"tag"`
		Format     string              `json:"format"`
		Components []artifactComponent `json:"components"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSBOMError(w, r, errSBOMInvalid)
		return
	}
	saved, err := recordSBOM(actor, sbomInput{
		ProjectID: body.ProjectID, Digest: body.Digest, Tag: body.Tag, Format: body.Format, Components: body.Components,
	})
	if err != nil {
		writeSBOMError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func artifactExposureHandler(w http.ResponseWriter, r *http.Request) {
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
		ProjectID   int    `json:"project_id"`
		Digest      string `json:"digest"`
		Environment string `json:"environment"`
		AttemptID   int    `json:"attempt_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSBOMError(w, r, errSBOMInvalid)
		return
	}
	saved, err := recordArtifactExposure(actor, body.ProjectID, body.Digest, body.Environment, body.AttemptID)
	if err != nil {
		writeSBOMError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func artifactFindingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	var body artifactFinding
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeSBOMError(w, r, errSBOMInvalid)
		return
	}
	saved, err := recordArtifactFinding(actor, body)
	if err != nil {
		writeSBOMError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusCreated, saved)
}

func artifactContextHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r)
		return
	}
	actor, err := catalogSubjectFromRequest(r)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", nil)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	saved, err := artifactExposureContext(actor, projectID, r.URL.Query().Get("digest"))
	if err != nil {
		writeSBOMError(w, r, err)
		return
	}
	_ = writeJSONResponse(w, http.StatusOK, saved)
}

func writeSBOMError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errSBOMHidden):
		writeAPIError(w, r, http.StatusNotFound, errSBOMHidden.Error(), nil)
	case errors.Is(err, errSBOMDenied):
		writeAPIError(w, r, http.StatusForbidden, errSBOMDenied.Error(), nil)
	default:
		writeAPIError(w, r, http.StatusBadRequest, errSBOMInvalid.Error(), nil)
	}
}
