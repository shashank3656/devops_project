package main

import (
	"fmt"
	"strings"
	"time"
)

func expiryDefaultReminderWindows() []int {
	return []int{30, 14, 7, 3, 1}
}

func expiryReminderWindows(warnDays []int) []int {
	source := warnDays
	if len(source) == 0 {
		source = expiryDefaultReminderWindows()
	}
	seen := map[int]bool{}
	out := []int{}
	for _, day := range source {
		if day <= 0 || seen[day] {
			continue
		}
		seen[day] = true
		out = append(out, day)
	}
	if len(out) == 0 {
		return expiryDefaultReminderWindows()
	}
	return out
}

func expiryActiveReminder(remainingDays int, expired bool, windows []int) (key string, window int) {
	if expired || remainingDays < 0 {
		return "expired", 0
	}
	matched := 0
	for _, day := range windows {
		if remainingDays <= day && (matched == 0 || day < matched) {
			matched = day
		}
	}
	if matched == 0 {
		return "", 0
	}
	return fmt.Sprintf("expiring:%d", matched), matched
}

func expiryReminderCopy(window int, expired bool) (title, lead string) {
	if expired {
		return "Certificate or domain has expired", "has expired"
	}
	switch window {
	case 30:
		return "Certificate or domain expires in one month", "expires in about one month"
	case 14:
		return "Certificate or domain expires in two weeks", "expires in about two weeks"
	case 7:
		return "Certificate or domain expires in one week", "expires in about one week"
	case 3:
		return "Certificate or domain expires in three days", "expires in about three days"
	case 1:
		return "Certificate or domain expires tomorrow", "expires in about one day"
	default:
		return fmt.Sprintf("Certificate or domain expires in %d days", window), fmt.Sprintf("expires in about %d days", window)
	}
}

func expiryOwnerRecipients(asset expiryAssetView) []int {
	if asset.OwnerUserID > 0 {
		return []int{asset.OwnerUserID}
	}
	ids := []int{}
	if asset.TeamID > 0 {
		if team, err := GetTeamByID(asset.TeamID); err == nil && team != nil {
			if leads, leadErr := GetPortalManagerUserIDsByTeamNameOrSlug(team.Name); leadErr == nil {
				ids = append(ids, leads...)
			}
		}
	}
	if strings.TrimSpace(asset.OwnerName) != "" && !strings.EqualFold(asset.OwnerName, "Unknown") {
		if extra, err := resolveOpsNotificationRecipientsFromOwner(asset.OwnerName); err == nil {
			ids = append(ids, extra...)
		}
	}
	return uniquePositiveIntIDs(ids)
}

func notifyExpiryThreshold(asset expiryAssetView, obs expiryObservation) {
	if strings.EqualFold(asset.State, "archived") || asset.Paused {
		return
	}
	recipients := expiryOwnerRecipients(asset)
	if len(recipients) == 0 {
		return
	}
	deadline := obs.NotAfter
	if asset.AssetType == "domain" {
		deadline = earliestTime(obs.RegistrarExpires, obs.RegistryExpires)
	}
	now := time.Now().UTC()
	key := ""
	window := 0
	expired := false
	if deadline == nil {
		if strings.EqualFold(obs.Assessment, "invalid") {
			key = "invalid"
		} else {
			return
		}
	} else {
		expired = !now.Before(*deadline)
		remaining := 0
		if days := remainingExpiryDays(deadline, now); days != nil {
			remaining = *days
		}
		key, window = expiryActiveReminder(remaining, expired, expiryReminderWindows(asset.WarnDays))
		if key == "" {
			if strings.EqualFold(obs.Assessment, "invalid") {
				key = "invalid"
			} else {
				return
			}
		}
	}
	expiryStamp := "unknown"
	if deadline != nil {
		expiryStamp = deadline.UTC().Format("2006-01-02")
	}
	episode := key + ":" + expiryStamp
	var last time.Time
	err := queryRowContext(`SELECT last_sent_at FROM expiry_alert_episodes WHERE asset_id = $1 AND threshold_key = $2`, asset.ID, episode).Scan(&last)
	if err == nil {
		return
	}
	_, _ = execContext(`
		INSERT INTO expiry_alert_episodes (asset_id, threshold_key, last_sent_at)
		VALUES ($1,$2,CURRENT_TIMESTAMP)
		ON CONFLICT (asset_id, threshold_key) DO NOTHING
	`, asset.ID, episode)

	title, lead := expiryReminderCopy(window, expired || key == "expired")
	if key == "invalid" {
		title = "Certificate is invalid"
		lead = "failed hostname or chain checks"
	}
	name := asset.DisplayName
	if asset.AssetType == "certificate" && asset.Port > 0 {
		name = fmt.Sprintf("%s:%d", asset.DisplayName, asset.Port)
	}
	message := fmt.Sprintf("%s %s. This reminder is sent to the owner. Auto-renew is not proof of completed renewal.", name, lead)
	if obs.AutoRenew != nil && *obs.AutoRenew {
		message += " Registrar auto-renew is reported. Track it, then verify from a fresh served observation."
	}
	if deadline != nil {
		message += " Expires " + deadline.UTC().Format(time.RFC3339) + "."
	}
	var projectPtr *int
	if asset.ProjectID > 0 {
		projectPtr = &asset.ProjectID
	}
	_ = dispatchOpsNotification(
		fmt.Sprintf("expiry-asset:%d:%s", asset.ID, episode),
		"expiry_tracker_alert",
		title,
		message,
		nil,
		projectPtr,
		recipients,
		map[string]any{
			"asset_id":   asset.ID,
			"asset_type": asset.AssetType,
			"assessment": obs.Assessment,
			"threshold":  key,
			"owner_name": asset.OwnerName,
			"owner_id":   asset.OwnerUserID,
		},
	)
}
