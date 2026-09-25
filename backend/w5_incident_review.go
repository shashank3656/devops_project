package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type incidentReviewDraft struct {
	Generated         bool   `json:"generated"`
	ImpactSummary     string `json:"impact_summary"`
	RootCause         string `json:"root_cause"`
	DetectionSummary  string `json:"detection_summary"`
	MitigationSummary string `json:"mitigation_summary"`
	CorrectiveActions string `json:"corrective_actions"`
	ReviewNotes       string `json:"review_notes"`
	CausedByChange    string `json:"caused_by_change,omitempty"`
	PreviousSHA       string `json:"previous_sha,omitempty"`
	WatchResult       string `json:"watch_result,omitempty"`
	AcknowledgedBy    string `json:"acknowledged_by,omitempty"`
}

func buildIncidentReview(incident requestIncident) incidentReviewDraft {
	draft := incidentReviewDraft{Generated: true}
	ref := firstNonEmpty(incident.IncidentNumber, formatIncidentNumber(incident.ID))
	service := firstNonEmpty(incident.Service, incident.RequestService)
	env := firstNonEmpty(incident.Environment, incident.RequestEnv)
	draft.ImpactSummary = fmt.Sprintf("%s · %s in %s. Status %s. Source %s.",
		ref,
		firstNonEmpty(incident.Summary, "incident"),
		firstNonEmpty(env, "unspecified env"),
		incident.Status,
		firstNonEmpty(incident.Source, "ticket"),
	)
	var change *changeRequestRecord
	if incident.SuspectedChangeID != nil && *incident.SuspectedChangeID > 0 {
		change, _ = getChangeRequestByID(*incident.SuspectedChangeID)
	}
	if change != nil {
		draft.CausedByChange = firstNonEmpty(change.ChangeNumber, fmt.Sprintf("CHG%07d", change.ID))
		draft.PreviousSHA = strings.TrimSpace(change.PreviousSHA)
		draft.WatchResult = firstNonEmpty(change.WatchResult, changeWatchResult(*change))
		draft.RootCause = fmt.Sprintf("Linked change %s (%s @ %s) watch_result=%s.", draft.CausedByChange, firstNonEmpty(change.Repo, change.Service), change.SHA, draft.WatchResult)
		if draft.PreviousSHA != "" {
			draft.RootCause += " Previous SHA " + draft.PreviousSHA + "."
		}
	} else {
		draft.RootCause = "No linked Change Request. Review the alert fingerprint and incident notes."
	}
	parts := []string{}
	if src := firstNonEmpty(incident.AlertSource, incident.Source); src != "" {
		parts = append(parts, src)
	}
	if incident.Fingerprint != "" {
		parts = append(parts, "fingerprint "+incident.Fingerprint)
	}
	if change != nil {
		if samples, err := listWatchSamples(change.ID, time.Time{}); err == nil && len(samples) > 0 {
			latest := samples[0]
			parts = append(parts, fmt.Sprintf("latest watch p95=%.0fms error=%.3f", latest.P95Ms, latest.ErrorRatio))
		}
	}
	draft.DetectionSummary = strings.Join(parts, " · ")
	if draft.DetectionSummary == "" {
		draft.DetectionSummary = "Opened from the incident catalog."
	}
	draft.AcknowledgedBy = strings.TrimSpace(incident.OwnerUsername)
	if draft.AcknowledgedBy != "" {
		draft.MitigationSummary = "Owner " + draft.AcknowledgedBy + " is assigned."
	} else {
		draft.MitigationSummary = "No owner assigned yet."
	}
	if strings.TrimSpace(incident.StatusNote) != "" {
		draft.MitigationSummary += " " + strings.TrimSpace(incident.StatusNote)
	}
	if strings.TrimSpace(incident.Notes) != "" {
		draft.MitigationSummary = strings.TrimSpace(draft.MitigationSummary + "\n" + incident.Notes)
	}
	actions := []string{}
	if change != nil && draft.PreviousSHA != "" {
		actions = append(actions, "Confirm rollback to "+draft.PreviousSHA+" if still needed.")
	}
	if guides := matchRunbooksForService(incident.ProjectID, service); len(guides) > 0 {
		actions = append(actions, "Follow runbook: "+guides[0].Title)
	}
	actions = append(actions, "Close the linked CHG only after this INC is resolved.")
	draft.CorrectiveActions = strings.Join(actions, "\n")
	var request *PRRequest
	if incident.RequestID > 0 {
		request, _ = GetPRRequestByID(incident.RequestID)
	}
	timeline := buildIncidentWorkspaceTimeline(incident, request, nil, nil)
	if len(timeline) > 0 {
		var b strings.Builder
		for _, event := range timeline {
			b.WriteString(event.Timestamp.Format(time.RFC3339))
			b.WriteString(" · ")
			b.WriteString(event.Title)
			if strings.TrimSpace(event.Detail) != "" {
				b.WriteString(": ")
				b.WriteString(strings.TrimSpace(event.Detail))
			}
			b.WriteString("\n")
		}
		draft.ReviewNotes = strings.TrimSpace(b.String())
	}
	return draft
}

func generateIncidentReview(incident requestIncident, updatedBy int) (*incidentPostmortemRecord, incidentReviewDraft, error) {
	draft := buildIncidentReview(incident)
	existing, err := getIncidentPostmortem(incident.ID)
	if err != nil {
		return nil, draft, err
	}
	status := "draft"
	impact := draft.ImpactSummary
	root := draft.RootCause
	detection := draft.DetectionSummary
	mitigation := draft.MitigationSummary
	actions := draft.CorrectiveActions
	notes := draft.ReviewNotes
	owner := incident.OwnerUserID
	if existing != nil {
		if strings.EqualFold(existing.Status, "completed") {
			return existing, draft, nil
		}
		status = firstNonEmpty(existing.Status, status)
		if strings.TrimSpace(existing.ImpactSummary) != "" {
			impact = existing.ImpactSummary
		}
		if strings.TrimSpace(existing.RootCause) != "" {
			root = existing.RootCause
		}
		if strings.TrimSpace(existing.DetectionSummary) != "" {
			detection = existing.DetectionSummary
		}
		if strings.TrimSpace(existing.MitigationSummary) != "" {
			mitigation = existing.MitigationSummary
		}
		if strings.TrimSpace(existing.CorrectiveActions) != "" {
			actions = existing.CorrectiveActions
		}
		if strings.TrimSpace(existing.ReviewNotes) != "" {
			notes = existing.ReviewNotes
		}
		if existing.FollowUpOwnerUserID != nil {
			owner = existing.FollowUpOwnerUserID
		}
	}
	record, err := upsertIncidentPostmortem(incident, status, impact, root, detection, mitigation, actions, owner, notes, updatedBy)
	return record, draft, err
}

func incidentReviewPayload(item *requestIncident) (incidentReviewDraft, *incidentPostmortemRecord) {
	if item == nil {
		return incidentReviewDraft{}, nil
	}
	postmortem, _ := getIncidentPostmortem(item.ID)
	return buildIncidentReview(*item), postmortem
}

func handleIncidentReviewRoute(w http.ResponseWriter, r *http.Request, managerID, id int) bool {
	if r.Method == http.MethodGet {
		item, err := getRequestIncidentByID(id)
		if err != nil || item == nil {
			writeAPIError(w, r, http.StatusNotFound, "incident not found", err)
			return true
		}
		review, postmortem := incidentReviewPayload(item)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"incident":   item,
			"review":     review,
			"postmortem": postmortem,
			"status":     "ok",
		})
		return true
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return true
	}
	item, err := getRequestIncidentByID(id)
	if err != nil || item == nil {
		writeAPIError(w, r, http.StatusNotFound, "incident not found", err)
		return true
	}
	postmortem, review, err := generateIncidentReview(*item, managerID)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return true
	}
	AppendAuditLog(&managerID, "incident_review_generate", "request_incident", strconv.Itoa(id), item.IncidentNumber)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"incident":   item,
		"review":     review,
		"postmortem": postmortem,
		"status":     "ok",
	})
	return true
}
