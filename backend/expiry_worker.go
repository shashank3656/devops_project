package main

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func runExpiryCheckJob(jobID, assetID int) {
	if DB == nil || assetID <= 0 {
		return
	}
	res, err := execContext(`UPDATE expiry_check_jobs SET state = 'running', started_at = CURRENT_TIMESTAMP WHERE id = $1 AND state = 'queued'`, jobID)
	if err != nil {
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return
	}
	row, err := scanExpiryAsset(queryRowContext(expiryAssetSelect+` WHERE id = $1`, assetID))
	if err != nil {
		_, _ = execContext(`UPDATE expiry_check_jobs SET state = 'failed', error_message = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`, jobID, "asset missing")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var obs expiryObservation
	if row.AssetType == "domain" {
		obs = lookupExpiryRDAP(ctx, row.RegisteredDomain)
	} else {
		obs = observeExpiryTLS(ctx, row.Hostname, row.Port)
	}
	applyExpiryObservation(row, obs)
	_, _ = execContext(`UPDATE expiry_check_jobs SET state = 'succeeded', finished_at = CURRENT_TIMESTAMP WHERE id = $1`, jobID)
}

func drainExpiryCheckJobs() {
	if DB == nil {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, asset_id FROM expiry_check_jobs
		WHERE state = 'queued'
		ORDER BY id
		LIMIT 10
	`)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	type job struct{ id, assetID int }
	jobs := []job{}
	for rows.Next() {
		var item job
		if err := rows.Scan(&item.id, &item.assetID); err == nil {
			jobs = append(jobs, item)
		}
	}
	for _, item := range jobs {
		runExpiryCheckJob(item.id, item.assetID)
	}
}

func scheduleExpiryChecks(now time.Time) {
	if DB == nil {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, asset_type, check_every_minutes, last_checked_at
		FROM expiry_assets
		WHERE state <> 'archived'
	`)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var id, every int
		var assetType string
		var last *time.Time
		if err := rows.Scan(&id, &assetType, &every, &last); err != nil {
			continue
		}
		if every <= 0 {
			if assetType == "domain" {
				every = 1440
			} else {
				every = 360
			}
		}
		if last != nil && now.Sub(*last) < time.Duration(every)*time.Minute {
			continue
		}
		_, _ = queueExpiryCheck(id)
	}
}

func notifyExpiryThreshold(asset expiryAssetView, obs expiryObservation) {
	deadline := obs.NotAfter
	if asset.AssetType == "domain" {
		deadline = earliestTime(obs.RegistrarExpires, obs.RegistryExpires)
	}
	key := obs.Assessment
	if deadline != nil && (obs.Assessment == "expiring" || obs.Assessment == "expired") {
		days := remainingExpiryDays(deadline, time.Now().UTC())
		if days != nil {
			matched := 0
			for _, warn := range asset.WarnDays {
				if *days <= warn && warn > matched {
					matched = warn
				}
			}
			if matched > 0 {
				key = fmt.Sprintf("%s:%d", obs.Assessment, matched)
			}
		}
	}
	var last time.Time
	err := queryRowContext(`SELECT last_sent_at FROM expiry_alert_episodes WHERE asset_id = $1 AND threshold_key = $2`, asset.ID, key).Scan(&last)
	if err == nil && time.Since(last) < 20*time.Hour {
		return
	}
	_, _ = execContext(`
		INSERT INTO expiry_alert_episodes (asset_id, threshold_key, last_sent_at)
		VALUES ($1,$2,CURRENT_TIMESTAMP)
		ON CONFLICT (asset_id, threshold_key) DO UPDATE SET last_sent_at = CURRENT_TIMESTAMP
	`, asset.ID, key)
	title := "Certificate or domain needs review"
	if asset.AssetType == "domain" {
		title = "Domain expiry needs review"
	} else {
		title = "Certificate expiry needs review"
	}
	name := asset.DisplayName
	message := fmt.Sprintf("%s is %s. Auto-renew is not proof of completed renewal. A valid TCP connection is not proof of TLS validity.", name, obs.Assessment)
	if strings.EqualFold(obs.Assessment, "unknown") || strings.EqualFold(obs.Assessment, "stale") {
		message = fmt.Sprintf("%s coverage is %s. Missing telemetry stays Unknown.", name, obs.Assessment)
	}
	var projectPtr *int
	if asset.ProjectID > 0 {
		projectPtr = &asset.ProjectID
	}
	_ = dispatchOpsNotification(
		fmt.Sprintf("expiry-asset:%d:%s", asset.ID, key),
		"expiry_tracker_alert",
		title,
		message,
		nil,
		projectPtr,
		nil,
		map[string]any{"asset_id": asset.ID, "asset_type": asset.AssetType, "assessment": obs.Assessment},
	)
}

func createExpiryRenewalCase(assetID, userID int, changeRef, note, state string) (expiryAssetView, error) {
	if _, err := getExpiryAsset(assetID, userID, true); err != nil {
		return expiryAssetView{}, err
	}
	state = strings.ToLower(strings.TrimSpace(state))
	if state == "" {
		state = "assigned"
	}
	allowed := map[string]bool{"open": true, "assigned": true, "renewal_in_progress": true, "awaiting_verification": true}
	if !allowed[state] {
		return expiryAssetView{}, errOncallInvalid
	}
	_, err := execContext(`
		INSERT INTO expiry_renewal_cases (asset_id, state, change_ref, note, created_by)
		VALUES ($1,$2,$3,$4,$5)
	`, assetID, state, strings.TrimSpace(changeRef), strings.TrimSpace(note), userID)
	if err != nil {
		return expiryAssetView{}, err
	}
	_, _ = execContext(`UPDATE expiry_assets SET renewal_state = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, assetID, state)
	return getExpiryAsset(assetID, userID, true)
}

func verifyExpiryRenewal(assetID, userID int) (expiryAssetView, error) {
	asset, err := getExpiryAsset(assetID, userID, true)
	if err != nil {
		return expiryAssetView{}, err
	}
	if asset.Latest == nil {
		return expiryAssetView{}, fmt.Errorf("a fresh observation is required before verification")
	}
	obs := *asset.Latest
	if obs.Manual {
		return expiryAssetView{}, fmt.Errorf("manual evidence cannot mark renewal verified")
	}
	if asset.AssetType == "certificate" {
		if !obs.HostnameOK || !obs.ChainOK || obs.NotAfter == nil || !obs.NotAfter.After(time.Now().UTC().Add(48*time.Hour)) {
			return expiryAssetView{}, fmt.Errorf("the currently served certificate does not prove a completed renewal")
		}
	} else {
		if obs.AutoRenew != nil && *obs.AutoRenew && obs.RegistrarExpires != nil && obs.RegistrarExpires.Before(time.Now().UTC().Add(48*time.Hour)) {
			return expiryAssetView{}, fmt.Errorf("auto-renew is not evidence of a completed domain renewal")
		}
		deadline := earliestTime(obs.RegistrarExpires, obs.RegistryExpires)
		if deadline == nil || !deadline.After(time.Now().UTC().Add(48*time.Hour)) {
			return expiryAssetView{}, fmt.Errorf("fresh registrar evidence does not show a completed renewal")
		}
	}
	var obsID int
	_ = queryRowContext(`SELECT id FROM expiry_observations WHERE asset_id = $1 ORDER BY observed_at DESC, id DESC LIMIT 1`, assetID).Scan(&obsID)
	_, _ = execContext(`
		INSERT INTO expiry_renewal_cases (asset_id, state, note, created_by, verified_observation_id)
		VALUES ($1, 'verified', 'Verified from a fresh observation.', $2, $3)
	`, assetID, userID, obsID)
	_, _ = execContext(`UPDATE expiry_assets SET renewal_state = 'verified', assessment = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, assetID, obs.Assessment)
	return getExpiryAsset(assetID, userID, true)
}

func archiveExpiryAsset(assetID, userID int, reason string) (expiryAssetView, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return expiryAssetView{}, fmt.Errorf("an archive reason is required")
	}
	asset, err := getExpiryAsset(assetID, userID, false)
	if err != nil {
		return expiryAssetView{}, err
	}
	_, err = execContext(`UPDATE expiry_assets SET state = 'archived', archived_reason = $2, renewal_state = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, assetID, reason)
	if err != nil {
		return expiryAssetView{}, err
	}
	asset.State = "archived"
	return asset, nil
}

func startExpiryAssetWorker() {
	go func() {
		ticker := time.NewTicker(2 * time.Minute)
		defer ticker.Stop()
		scheduleExpiryChecks(time.Now().UTC())
		drainExpiryCheckJobs()
		for range ticker.C {
			scheduleExpiryChecks(time.Now().UTC())
			drainExpiryCheckJobs()
		}
	}()
}
