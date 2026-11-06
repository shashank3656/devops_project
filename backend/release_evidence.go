package main

import (
	"encoding/json"
	"strings"
	"sync"
	"time"
)

type releaseEvidenceSnapshot struct {
	SHA               string `json:"sha"`
	CapturedAt        string `json:"captured_at,omitempty"`
	Decision          string `json:"decision,omitempty"`
	Approvals         string `json:"approvals,omitempty"`
	Checks            string `json:"checks,omitempty"`
	Security          string `json:"security,omitempty"`
	Window            string `json:"window,omitempty"`
	Rollback          string `json:"rollback,omitempty"`
	Invalidated       bool   `json:"invalidated"`
	InvalidatedReason string `json:"invalidated_reason,omitempty"`
}

var releaseEvidenceColumnOnce sync.Once

func ensureReleaseEvidenceColumn() {
	releaseEvidenceColumnOnce.Do(func() {
		if DB == nil {
			return
		}
		_, _ = DB.Exec(`ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS release_evidence_json TEXT NOT NULL DEFAULT ''`)
	})
}

func readinessCheckText(ready *releaseReadiness, key string) string {
	if ready == nil {
		return "Unknown"
	}
	for _, check := range ready.Checks {
		if check.Key != key {
			continue
		}
		return firstNonEmpty(check.Detail, check.State, "Unknown")
	}
	return "Unknown"
}

func captureReleaseEvidence(item changeRequestRecord) releaseEvidenceSnapshot {
	ready := buildChangeReleaseReadiness(item)
	approvals := make([]string, 0, 2)
	if name := strings.TrimSpace(item.CABApprovedByUsername); name != "" {
		approvals = append(approvals, name)
	}
	if name := strings.TrimSpace(item.AssigneeUsername); name != "" {
		approvals = append(approvals, "assigned "+name)
	}
	captured := time.Now().UTC().Format(time.RFC3339)
	if item.CABApprovedAt != nil && !item.CABApprovedAt.IsZero() {
		captured = item.CABApprovedAt.UTC().Format(time.RFC3339)
	}
	return releaseEvidenceSnapshot{
		SHA:        strings.TrimSpace(item.SHA),
		CapturedAt: captured,
		Decision:   firstNonEmpty(item.CABStatus, item.Status, "recorded"),
		Approvals:  firstNonEmpty(strings.Join(approvals, ", "), "No named approver"),
		Checks:     readinessCheckText(ready, "ci"),
		Security:   readinessCheckText(ready, "security"),
		Window:     readinessCheckText(ready, "window"),
		Rollback:   readinessCheckText(ready, "rollback"),
	}
}

func applyEvidenceInvalidation(snap *releaseEvidenceSnapshot, currentSHA string) {
	if snap == nil {
		return
	}
	if evidenceCommitMoved(currentSHA, snap.SHA) {
		snap.Invalidated = true
		snap.InvalidatedReason = "A newer commit replaced the recorded SHA. Re-evaluate this evidence."
		return
	}
	snap.Invalidated = false
	snap.InvalidatedReason = ""
}

func persistReleaseEvidence(id int, snap releaseEvidenceSnapshot) error {
	if DB == nil || id <= 0 {
		return nil
	}
	ensureReleaseEvidenceColumn()
	raw, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	_, err = execContext(`UPDATE change_requests SET release_evidence_json = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, string(raw))
	return err
}

func attachReleaseEvidence(item *changeRequestRecord) {
	if item == nil || DB == nil {
		return
	}
	ensureReleaseEvidenceColumn()
	var raw string
	if err := queryRowContext(`SELECT COALESCE(release_evidence_json, '') FROM change_requests WHERE id = $1`, item.ID).Scan(&raw); err != nil {
		return
	}
	if strings.TrimSpace(raw) == "" {
		return
	}
	var snap releaseEvidenceSnapshot
	if err := json.Unmarshal([]byte(raw), &snap); err != nil {
		return
	}
	applyEvidenceInvalidation(&snap, item.SHA)
	item.ReleaseEvidence = &snap
}
