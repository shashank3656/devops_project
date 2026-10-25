package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type expiryDNSRecord struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
	TTL   int    `json:"ttl"`
	Note  string `json:"note"`
}

type expiryDNSProposal struct {
	ID          int               `json:"id"`
	AssetID     int               `json:"asset_id"`
	Records     []expiryDNSRecord `json:"records"`
	ChangeRef   string            `json:"change_ref"`
	State       string            `json:"state"`
	Note        string            `json:"note"`
	LiveWrite   bool              `json:"live_write"`
	CreatedAt   time.Time         `json:"created_at"`
	ConfirmedAt *time.Time        `json:"confirmed_at,omitempty"`
}

func plannedExpiryDNSRecords(asset expiryAssetView) []expiryDNSRecord {
	host := strings.ToLower(strings.TrimSpace(asset.Hostname))
	if host == "" {
		host = strings.ToLower(strings.TrimSpace(asset.RegisteredDomain))
	}
	if host == "" {
		return []expiryDNSRecord{}
	}
	apex := host
	if asset.AssetType == "domain" && asset.RegisteredDomain != "" {
		apex = strings.ToLower(strings.TrimSpace(asset.RegisteredDomain))
	} else if parts := strings.Split(host, "."); len(parts) >= 2 {
		apex = strings.Join(parts[len(parts)-2:], ".")
	}
	records := []expiryDNSRecord{
		{Type: "CAA", Name: apex, Value: `0 issue "letsencrypt.org"`, TTL: 3600, Note: "Suggested issuance policy. This portal does not write DNS."},
		{Type: "CAA", Name: apex, Value: `0 issuewild "letsencrypt.org"`, TTL: 3600, Note: "Suggested wildcard issuance policy. Confirm with the current CA."},
	}
	if asset.AssetType == "certificate" {
		records = append(records, expiryDNSRecord{
			Type:  "TXT",
			Name:  "_acme-challenge." + host,
			Value: "replace-with-acme-token",
			TTL:   60,
			Note:  "Placeholder only. Paste the live ACME token from the CA, then confirm after writing it in DNS.",
		})
	}
	return records
}

func expiryChangeAuthor(userID int) string {
	names := oncallUserNames([]int{userID})
	return oncallKnownName(names, userID)
}

func openExpiryChange(asset expiryAssetView, userID int, title, summary, changeType string) (string, error) {
	env := strings.TrimSpace(asset.Environment)
	if env == "" {
		env = "unspecified"
	}
	service := strings.TrimSpace(asset.ServiceName)
	if service == "" {
		service = asset.DisplayName
	}
	repo := "expiry/" + strings.TrimSpace(asset.DisplayName)
	if repo == "expiry/" {
		repo = fmt.Sprintf("expiry/asset-%d", asset.ID)
	}
	payload := parsedChangeWebhook{
		ProjectID:      asset.ProjectID,
		Service:        service,
		Environment:    env,
		Repo:           repo,
		SHA:            fmt.Sprintf("expiry-%d-%d", asset.ID, time.Now().UTC().UnixNano()),
		Title:          title,
		Author:         expiryChangeAuthor(userID),
		Summary:        summary,
		ChangeType:     changeType,
		Status:         "new",
		Priority:       "medium",
		RiskLevel:      "medium",
		Impact:         "This portal does not renew certificates or write DNS. Apply the change in the registrar or DNS host, then verify from a fresh observation.",
		BackoutPlan:    "Remove any records that were applied in DNS if they should not stay. Auto-renew is not proof of a completed renewal.",
		AssigneeUserID: asset.OwnerUserID,
	}
	item, _, err := upsertChangeRequest(payload)
	if err != nil || item == nil {
		return "", err
	}
	ref := strings.TrimSpace(item.ChangeNumber)
	if ref == "" {
		ref = fmt.Sprintf("CHG%d", item.ID)
	}
	return ref, nil
}

func trackExpiryAutoRenew(assetID, userID int) (expiryAssetView, error) {
	asset, err := getExpiryAsset(assetID, userID, true)
	if err != nil {
		return expiryAssetView{}, err
	}
	if asset.AutoRenew == nil || !*asset.AutoRenew {
		return expiryAssetView{}, fmt.Errorf("registrar auto-renew is not reported on the latest evidence")
	}
	summary := fmt.Sprintf("Track registrar auto-renew for %s. Auto-renew is not proof of completed renewal. A served observation is still required.", asset.DisplayName)
	ref, err := openExpiryChange(asset, userID, "Track auto-renew for "+asset.DisplayName, summary, "standard")
	if err != nil {
		ref = ""
	}
	note := "Registrar auto-renew is reported. This is not verified renewal and not a DNS write."
	item, caseErr := createExpiryRenewalCase(assetID, userID, ref, note, "auto_renew_reported")
	if caseErr != nil {
		return expiryAssetView{}, caseErr
	}
	return item, nil
}

func maybeOpenAutoRenewCase(asset expiryAssetView, obs expiryObservation) {
	if asset.ID <= 0 || obs.AutoRenew == nil || !*obs.AutoRenew {
		return
	}
	if !strings.EqualFold(obs.Assessment, "expiring") && !strings.EqualFold(obs.Assessment, "expired") {
		return
	}
	stamp := "unknown"
	deadline := obs.NotAfter
	if asset.AssetType == "domain" {
		deadline = earliestTime(obs.RegistrarExpires, obs.RegistryExpires)
	}
	if deadline != nil {
		stamp = deadline.UTC().Format("2006-01-02")
	}
	ref := "auto-renew:" + stamp
	var existing int
	if queryRowContext(`SELECT id FROM expiry_renewal_cases WHERE asset_id = $1 AND change_ref = $2 LIMIT 1`, asset.ID, ref).Scan(&existing) == nil && existing > 0 {
		return
	}
	_, _ = execContext(`
		INSERT INTO expiry_renewal_cases (asset_id, state, change_ref, note, created_by)
		VALUES ($1,'auto_renew_reported',$2,'Registrar auto-renew is reported. A served observation is still required.',$3)
	`, asset.ID, ref, asset.OwnerUserID)
	_, _ = execContext(`UPDATE expiry_assets SET renewal_state = 'auto_renew_reported', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND renewal_state NOT IN ('verified','archived')`, asset.ID)
}

func listExpiryDNSProposals(assetID int) ([]expiryDNSProposal, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, asset_id, records_json, change_ref, state, note, live_write, created_at, confirmed_at
		FROM expiry_dns_proposals WHERE asset_id = $1 ORDER BY id DESC LIMIT 20
	`, assetID)
	if err != nil {
		return []expiryDNSProposal{}, err
	}
	defer cancel()
	defer rows.Close()
	out := []expiryDNSProposal{}
	for rows.Next() {
		var item expiryDNSProposal
		var raw string
		var confirmed sql.NullTime
		if err := rows.Scan(&item.ID, &item.AssetID, &raw, &item.ChangeRef, &item.State, &item.Note, &item.LiveWrite, &item.CreatedAt, &confirmed); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &item.Records)
		if item.Records == nil {
			item.Records = []expiryDNSRecord{}
		}
		item.LiveWrite = false
		if confirmed.Valid {
			item.ConfirmedAt = &confirmed.Time
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func proposeExpiryDNS(assetID, userID int, note string) (expiryAssetView, error) {
	asset, err := getExpiryAsset(assetID, userID, true)
	if err != nil {
		return expiryAssetView{}, err
	}
	records := plannedExpiryDNSRecords(asset)
	if len(records) == 0 {
		return expiryAssetView{}, errOncallInvalid
	}
	encoded, err := json.Marshal(records)
	if err != nil {
		return expiryAssetView{}, err
	}
	summary := "Proposed DNS records. This portal does not write DNS.\n"
	for _, record := range records {
		summary += fmt.Sprintf("%s %s %s ttl=%d\n", record.Type, record.Name, record.Value, record.TTL)
	}
	ref, _ := openExpiryChange(asset, userID, "DNS records for "+asset.DisplayName, summary, "normal")
	note = strings.TrimSpace(note)
	if note == "" {
		note = "Proposed records only. Apply them in the DNS host, then confirm. Live DNS writes are not performed."
	}
	_, err = execContext(`
		INSERT INTO expiry_dns_proposals (asset_id, records_json, change_ref, state, note, live_write, created_by)
		VALUES ($1,$2,$3,'proposed',$4,FALSE,$5)
	`, assetID, string(encoded), ref, note, userID)
	if err != nil {
		return expiryAssetView{}, err
	}
	return getExpiryAsset(assetID, userID, true)
}

func confirmExpiryDNS(assetID, proposalID, userID int, note string) (expiryAssetView, error) {
	if _, err := getExpiryAsset(assetID, userID, false); err != nil {
		return expiryAssetView{}, err
	}
	note = strings.TrimSpace(note)
	if note == "" {
		return expiryAssetView{}, fmt.Errorf("confirm the records were applied in DNS outside this portal")
	}
	res, err := execContext(`
		UPDATE expiry_dns_proposals
		SET state = 'confirmed_outside', note = $3, confirmed_by = $4, confirmed_at = CURRENT_TIMESTAMP, live_write = FALSE
		WHERE id = $1 AND asset_id = $2 AND state = 'proposed'
	`, proposalID, assetID, note, userID)
	if err != nil {
		return expiryAssetView{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return expiryAssetView{}, errOncallInvalid
	}
	return getExpiryAsset(assetID, userID, true)
}
