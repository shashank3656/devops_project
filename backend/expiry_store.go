package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type expiryAssetView struct {
	ID                 int                 `json:"id"`
	AssetType          string              `json:"asset_type"`
	DisplayName        string              `json:"display_name"`
	Hostname           string              `json:"hostname,omitempty"`
	Port               int                 `json:"port,omitempty"`
	RegisteredDomain   string              `json:"registered_domain,omitempty"`
	OriginalInput      string              `json:"original_input"`
	ProjectID          int                 `json:"project_id"`
	ServiceName        string              `json:"service_name"`
	Environment        string              `json:"environment"`
	TeamID             int                 `json:"team_id"`
	OwnerName          string              `json:"owner_name"`
	RunbookURL         string              `json:"runbook_url,omitempty"`
	WarnDays           []int               `json:"warn_days"`
	CheckEveryMinutes  int                 `json:"check_every_minutes"`
	Collector          string              `json:"collector"`
	State              string              `json:"state"`
	Assessment         string              `json:"assessment"`
	RenewalState       string              `json:"renewal_state"`
	Version            int                 `json:"version"`
	LastCheckedAt      *time.Time          `json:"last_checked_at,omitempty"`
	CertificateExpires *time.Time          `json:"certificate_expires_at,omitempty"`
	RegistrarExpires   *time.Time          `json:"registrar_expires_at,omitempty"`
	RegistryExpires    *time.Time          `json:"registry_expires_at,omitempty"`
	RemainingDays      *int                `json:"remaining_days,omitempty"`
	Issuer             string              `json:"issuer,omitempty"`
	Fingerprint        string              `json:"fingerprint,omitempty"`
	AutoRenew          *bool               `json:"auto_renew,omitempty"`
	Coverage           string              `json:"coverage"`
	Latest             *expiryObservation  `json:"latest,omitempty"`
	Observations       []expiryObservation `json:"observations,omitempty"`
	RenewalCases       []expiryRenewalCase `json:"renewal_cases,omitempty"`
}

type expiryRenewalCase struct {
	ID                    int       `json:"id"`
	State                 string    `json:"state"`
	ChangeRef             string    `json:"change_ref"`
	Note                  string    `json:"note"`
	VerifiedObservationID int       `json:"verified_observation_id,omitempty"`
	CreatedAt             time.Time `json:"created_at"`
}

type expirySummary struct {
	ExpiredInvalid int `json:"expired_invalid"`
	Due            int `json:"due"`
	Unassigned     int `json:"unassigned"`
	UnknownStale   int `json:"unknown_stale"`
	Certificates   int `json:"certificates"`
	Domains        int `json:"domains"`
}

func expiryAssetVisible(projectID, userID int, visible map[int]struct{}) bool {
	if projectID <= 0 {
		return userID > 0
	}
	_, ok := visible[projectID]
	return ok
}

func scanExpiryAsset(scanner interface{ Scan(dest ...any) error }) (expiryAssetView, error) {
	var row expiryAssetView
	var warn string
	var last sql.NullTime
	err := scanner.Scan(
		&row.ID, &row.AssetType, &row.DisplayName, &row.Hostname, &row.Port, &row.RegisteredDomain, &row.OriginalInput,
		&row.ProjectID, &row.ServiceName, &row.Environment, &row.TeamID, &row.OwnerName, &row.RunbookURL, &warn,
		&row.CheckEveryMinutes, &row.Collector, &row.State, &row.Assessment, &row.RenewalState, &row.Version, &last,
	)
	if err != nil {
		return expiryAssetView{}, err
	}
	row.WarnDays = parseWarnDays(warn)
	if last.Valid {
		row.LastCheckedAt = &last.Time
	}
	if strings.TrimSpace(row.OwnerName) == "" {
		row.OwnerName = "Unknown"
	}
	row.Coverage = "Hosted collector. One observation point does not prove every region."
	return row, nil
}

const expiryAssetSelect = `
	SELECT id, asset_type, display_name, hostname, port, registered_domain, original_input,
	       project_id, service_name, environment, team_id, owner_name, runbook_url, warn_days,
	       check_every_minutes, collector, state, assessment, renewal_state, version, last_checked_at
	FROM expiry_assets
`

func attachLatestObservation(row *expiryAssetView) {
	obs, err := latestExpiryObservation(row.ID)
	if err != nil {
		row.Assessment = "unknown"
		return
	}
	if obs == nil {
		row.Assessment = "unknown"
		row.Coverage = "No observation yet. Coverage is Unknown."
		return
	}
	row.Latest = obs
	row.Issuer = obs.Issuer
	row.Fingerprint = obs.LeafFingerprint
	row.CertificateExpires = obs.NotAfter
	row.RegistrarExpires = obs.RegistrarExpires
	row.RegistryExpires = obs.RegistryExpires
	row.AutoRenew = obs.AutoRenew
	deadline := obs.NotAfter
	if row.AssetType == "domain" {
		deadline = earliestTime(obs.RegistrarExpires, obs.RegistryExpires)
	}
	row.RemainingDays = remainingExpiryDays(deadline, time.Now().UTC())
	if row.LastCheckedAt != nil && time.Since(*row.LastCheckedAt) > staleExpiryAge(row.AssetType, row.CheckEveryMinutes) {
		if row.Assessment == "valid" || row.Assessment == "expiring" {
			row.Assessment = "stale"
		}
	}
}

func earliestTime(values ...*time.Time) *time.Time {
	var earliest *time.Time
	for _, value := range values {
		if value == nil {
			continue
		}
		if earliest == nil || value.Before(*earliest) {
			earliest = value
		}
	}
	return earliest
}

func staleExpiryAge(assetType string, every int) time.Duration {
	if every <= 0 {
		if assetType == "domain" {
			every = 1440
		} else {
			every = 360
		}
	}
	return time.Duration(every*3) * time.Minute
}

func latestExpiryObservation(assetID int) (*expiryObservation, error) {
	row := queryRowContext(`
		SELECT source, observed_at, observation_point, leaf_fingerprint, issuer, sans, not_before, not_after, chain_not_after,
		       hostname_ok, chain_ok, assessment, error_class, detail, registrar_expires_at, registry_expires_at, auto_renew, manual, raw_summary
		FROM expiry_observations WHERE asset_id = $1 ORDER BY observed_at DESC, id DESC LIMIT 1
	`, assetID)
	obs, err := scanExpiryObservation(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &obs, nil
}

func scanExpiryObservation(scanner interface{ Scan(dest ...any) error }) (expiryObservation, error) {
	var obs expiryObservation
	var notBefore, notAfter, chain, registrar, registry sql.NullTime
	var auto sql.NullBool
	err := scanner.Scan(
		&obs.Source, &obs.ObservedAt, &obs.ObservationPoint, &obs.LeafFingerprint, &obs.Issuer, &obs.SANs,
		&notBefore, &notAfter, &chain, &obs.HostnameOK, &obs.ChainOK, &obs.Assessment, &obs.ErrorClass, &obs.Detail,
		&registrar, &registry, &auto, &obs.Manual, &obs.RawSummary,
	)
	if err != nil {
		return expiryObservation{}, err
	}
	if notBefore.Valid {
		obs.NotBefore = &notBefore.Time
	}
	if notAfter.Valid {
		obs.NotAfter = &notAfter.Time
	}
	if chain.Valid {
		obs.ChainNotAfter = &chain.Time
	}
	if registrar.Valid {
		obs.RegistrarExpires = &registrar.Time
	}
	if registry.Valid {
		obs.RegistryExpires = &registry.Time
	}
	if auto.Valid {
		value := auto.Bool
		obs.AutoRenew = &value
	}
	return obs, nil
}

func listExpiryAssets(userID int, assetType, assessment string) ([]expiryAssetView, expirySummary, error) {
	summary := expirySummary{}
	if DB == nil {
		return []expiryAssetView{}, summary, nil
	}
	query := expiryAssetSelect + ` WHERE state <> 'archived'`
	args := []any{}
	if assetType == "certificate" || assetType == "domain" {
		args = append(args, assetType)
		query += fmt.Sprintf(` AND asset_type = $%d`, len(args))
	}
	if strings.TrimSpace(assessment) != "" {
		args = append(args, strings.TrimSpace(assessment))
		query += fmt.Sprintf(` AND assessment = $%d`, len(args))
	}
	query += ` ORDER BY CASE assessment WHEN 'expired' THEN 0 WHEN 'invalid' THEN 1 WHEN 'expiring' THEN 2 WHEN 'stale' THEN 3 WHEN 'unknown' THEN 4 ELSE 5 END, id DESC LIMIT 300`
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		return nil, summary, err
	}
	defer cancel()
	defer rows.Close()
	visible := projectIDSet(visibleProjectIDsForUser(userID))
	out := []expiryAssetView{}
	for rows.Next() {
		row, err := scanExpiryAsset(rows)
		if err != nil {
			return nil, summary, err
		}
		if !expiryAssetVisible(row.ProjectID, userID, visible) {
			continue
		}
		attachLatestObservation(&row)
		if row.AssetType == "certificate" {
			summary.Certificates++
		} else {
			summary.Domains++
		}
		switch row.Assessment {
		case "expired", "invalid":
			summary.ExpiredInvalid++
		case "expiring":
			summary.Due++
		case "unknown", "stale":
			summary.UnknownStale++
		}
		if strings.EqualFold(row.OwnerName, "Unknown") {
			summary.Unassigned++
		}
		out = append(out, row)
	}
	return out, summary, rows.Err()
}

func getExpiryAsset(id, userID int, includeHistory bool) (expiryAssetView, error) {
	if DB == nil || id <= 0 {
		return expiryAssetView{}, errHandoverNotFound
	}
	row, err := scanExpiryAsset(queryRowContext(expiryAssetSelect+` WHERE id = $1`, id))
	if err != nil {
		if err == sql.ErrNoRows {
			return expiryAssetView{}, errHandoverNotFound
		}
		return expiryAssetView{}, err
	}
	visible := projectIDSet(visibleProjectIDsForUser(userID))
	if !expiryAssetVisible(row.ProjectID, userID, visible) {
		return expiryAssetView{}, errHandoverDenied
	}
	attachLatestObservation(&row)
	if includeHistory {
		hist, _ := listExpiryObservations(id)
		row.Observations = hist
		cases, _ := listExpiryRenewalCases(id)
		row.RenewalCases = cases
	}
	return row, nil
}

func listExpiryObservations(assetID int) ([]expiryObservation, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT source, observed_at, observation_point, leaf_fingerprint, issuer, sans, not_before, not_after, chain_not_after,
		       hostname_ok, chain_ok, assessment, error_class, detail, registrar_expires_at, registry_expires_at, auto_renew, manual, raw_summary
		FROM expiry_observations WHERE asset_id = $1 ORDER BY observed_at DESC, id DESC LIMIT 50
	`, assetID)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []expiryObservation{}
	for rows.Next() {
		obs, err := scanExpiryObservation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, obs)
	}
	return out, rows.Err()
}

func listExpiryRenewalCases(assetID int) ([]expiryRenewalCase, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, state, change_ref, note, verified_observation_id, created_at
		FROM expiry_renewal_cases WHERE asset_id = $1 ORDER BY id DESC LIMIT 20
	`, assetID)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []expiryRenewalCase{}
	for rows.Next() {
		var item expiryRenewalCase
		if err := rows.Scan(&item.ID, &item.State, &item.ChangeRef, &item.Note, &item.VerifiedObservationID, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func createExpiryAsset(userID int, assetType, input, service, env, owner, runbook string, projectID, teamID, port int, warn []int, every int) (expiryAssetView, error) {
	assetType = strings.ToLower(strings.TrimSpace(assetType))
	if assetType != "certificate" && assetType != "domain" {
		return expiryAssetView{}, errOncallInvalid
	}
	original := strings.TrimSpace(input)
	if original == "" {
		return expiryAssetView{}, errOncallInvalid
	}
	host := ""
	domain := ""
	if assetType == "certificate" {
		normalized, err := normalizeExpiryHostname(original)
		if err != nil {
			return expiryAssetView{}, err
		}
		if port == 0 {
			port = 443
		}
		if !expiryPortAllowed(port) {
			return expiryAssetView{}, errOncallInvalid
		}
		host = normalized
	} else {
		normalized, err := normalizeRegistrableDomain(original)
		if err != nil {
			return expiryAssetView{}, err
		}
		domain = normalized
		port = 0
		if every == 0 {
			every = 1440
		}
	}
	if every <= 0 {
		every = 360
	}
	if every < 60 {
		every = 60
	}
	if owner == "" {
		owner = "Unknown"
	}
	warnRaw := "30,14,7,3,1"
	if len(warn) > 0 {
		parts := make([]string, 0, len(warn))
		for _, day := range warn {
			if day > 0 {
				parts = append(parts, fmt.Sprintf("%d", day))
			}
		}
		if len(parts) > 0 {
			warnRaw = strings.Join(parts, ",")
		}
	}
	name := host
	if name == "" {
		name = domain
	}
	var id int
	err := queryRowContext(`
		INSERT INTO expiry_assets (
			asset_type, display_name, hostname, port, registered_domain, original_input, project_id, service_name,
			environment, team_id, owner_name, runbook_url, warn_days, check_every_minutes, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING id
	`, assetType, name, host, port, domain, original, projectID, service, env, teamID, owner, runbook, warnRaw, every, userID).Scan(&id)
	if err != nil {
		return expiryAssetView{}, err
	}
	_, _ = queueExpiryCheck(id)
	go drainExpiryCheckJobs()
	return getExpiryAsset(id, userID, false)
}

func queueExpiryCheck(assetID int) (int, error) {
	var existing int
	err := queryRowContext(`SELECT id FROM expiry_check_jobs WHERE asset_id = $1 AND state IN ('queued','running') ORDER BY id DESC LIMIT 1`, assetID).Scan(&existing)
	if err == nil && existing > 0 {
		return existing, nil
	}
	var id int
	err = queryRowContext(`INSERT INTO expiry_check_jobs (asset_id, state) VALUES ($1, 'queued') RETURNING id`, assetID).Scan(&id)
	return id, err
}

func insertExpiryObservation(assetID int, obs expiryObservation) (int, error) {
	var auto any
	if obs.AutoRenew != nil {
		auto = *obs.AutoRenew
	}
	var id int
	err := queryRowContext(`
		INSERT INTO expiry_observations (
			asset_id, source, observed_at, observation_point, leaf_fingerprint, issuer, sans, not_before, not_after, chain_not_after,
			hostname_ok, chain_ok, assessment, error_class, detail, registrar_expires_at, registry_expires_at, auto_renew, manual, raw_summary
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
		RETURNING id
	`, assetID, obs.Source, obs.ObservedAt, obs.ObservationPoint, obs.LeafFingerprint, obs.Issuer, obs.SANs, obs.NotBefore, obs.NotAfter, obs.ChainNotAfter,
		obs.HostnameOK, obs.ChainOK, obs.Assessment, obs.ErrorClass, obs.Detail, obs.RegistrarExpires, obs.RegistryExpires, auto, obs.Manual, obs.RawSummary).Scan(&id)
	return id, err
}

func applyExpiryObservation(asset expiryAssetView, obs expiryObservation) {
	warn := asset.WarnDays
	deadline := obs.NotAfter
	if asset.AssetType == "domain" {
		deadline = earliestTime(obs.RegistrarExpires, obs.RegistryExpires)
	}
	obs.Assessment = classifyExpiryAssessment(asset.AssetType, deadline, obs.HostnameOK, obs.ChainOK, obs.ErrorClass, time.Now().UTC(), warn)
	if asset.LastCheckedAt != nil && obs.NotAfter == nil && obs.RegistrarExpires == nil && obs.RegistryExpires == nil {
		if asset.Assessment == "expired" || asset.Assessment == "expiring" || asset.Assessment == "invalid" {
			obs.Assessment = asset.Assessment
			if obs.Detail == "" {
				obs.Detail = "The latest probe failed. Previous expiry evidence remains visible."
			}
		}
	}
	_, _ = insertExpiryObservation(asset.ID, obs)
	_, _ = execContext(`UPDATE expiry_assets SET assessment = $2, last_checked_at = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, asset.ID, obs.Assessment, obs.ObservedAt)
	notifyExpiryThreshold(asset, obs)
}

func addManualExpiryEvidence(assetID, userID int, expiresAt time.Time, source, note string) error {
	asset, err := getExpiryAsset(assetID, userID, false)
	if err != nil {
		return err
	}
	if source == "" {
		source = "manual"
	}
	obs := expiryObservation{
		Source:           source,
		ObservedAt:       time.Now().UTC(),
		ObservationPoint: "manual",
		Manual:           true,
		Detail:           strings.TrimSpace(note),
		HostnameOK:       true,
		ChainOK:          true,
	}
	if asset.AssetType == "certificate" {
		obs.NotAfter = &expiresAt
	} else {
		obs.RegistrarExpires = &expiresAt
	}
	if obs.Detail == "" {
		obs.Detail = "Manual evidence. Verification is still due from a fresh observation."
	}
	applyExpiryObservation(asset, obs)
	return nil
}
