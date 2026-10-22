package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type evidenceProtection struct {
	Repo           string   `json:"repo"`
	BaseBranch     string   `json:"base_branch"`
	RequiredChecks []string `json:"required_checks"`
	Onboarded      bool     `json:"onboarded"`
	Summary        string   `json:"summary"`
}

type evidencePack struct {
	From             time.Time             `json:"from"`
	To               time.Time             `json:"to"`
	ProjectID        int                   `json:"project_id,omitempty"`
	Changes          []changeRequestRecord `json:"changes"`
	Incidents        []requestIncident     `json:"incidents"`
	Approvals        []map[string]any      `json:"approvals"`
	Previews         []previewEnvironment  `json:"previews"`
	BranchProtection []evidenceProtection  `json:"branch_protection"`
	Summary          string                `json:"summary"`
}

func buildEvidencePack(projectID int, from, to time.Time) (*evidencePack, error) {
	if to.IsZero() {
		to = time.Now()
	}
	if from.IsZero() {
		from = to.Add(-30 * 24 * time.Hour)
	}
	changes, err := listChangeRequests(projectID, "", "", "")
	if err != nil {
		return nil, err
	}
	incidents, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	inRangeChanges := []changeRequestRecord{}
	for _, item := range changes {
		if item.CreatedAt.Before(from) || item.CreatedAt.After(to) {
			continue
		}
		inRangeChanges = append(inRangeChanges, item)
	}
	inRangeIncidents := []requestIncident{}
	for _, item := range incidents {
		if projectID > 0 && (item.ProjectID == nil || *item.ProjectID != projectID) {
			continue
		}
		if item.CreatedAt.Before(from) || item.CreatedAt.After(to) {
			continue
		}
		inRangeIncidents = append(inRangeIncidents, item)
	}
	approvals := []map[string]any{}
	requests, err := GetPRRequests("", "", "", projectID, "", "", "", 0, 0, nil, 200, 0, "updated_at", "desc", false, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if err == nil {
		for _, req := range requests {
			if !strings.Contains(strings.ToLower(req.Status), "approv") && req.Status != "in_progress" && req.Status != "completed" {
				continue
			}
			approvals = append(approvals, map[string]any{
				"id":     req.ID,
				"status": req.Status,
				"team":   req.Team,
				"env":    req.Env,
				"pr_url": req.PRURL,
			})
		}
	}
	previews := []previewEnvironment{}
	for _, item := range listPreviewEnvironments(100) {
		if item.CreatedAt.Before(from) || item.CreatedAt.After(to) {
			continue
		}
		previews = append(previews, item)
	}
	pack := &evidencePack{
		From:             from,
		To:               to,
		ProjectID:        projectID,
		Changes:          inRangeChanges,
		Incidents:        inRangeIncidents,
		Approvals:        approvals,
		Previews:         previews,
		BranchProtection: listEvidenceBranchProtection(inRangeChanges),
		Summary: fmt.Sprintf("%d changes, %d incidents, %d approvals, %d previews from %s to %s",
			len(inRangeChanges), len(inRangeIncidents), len(approvals), len(previews), from.Format("2006-01-02"), to.Format("2006-01-02")),
	}
	return pack, nil
}

func listEvidenceBranchProtection(changes []changeRequestRecord) []evidenceProtection {
	seen := map[string]struct{}{}
	out := []evidenceProtection{}
	add := func(owner, name, base string) {
		owner, name = normalizeRepoIdentity(owner, name)
		if owner == "" || name == "" {
			return
		}
		key := strings.ToLower(owner + "/" + name)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		if strings.TrimSpace(base) == "" {
			base = "main"
		}
		item := evidenceProtection{
			Repo:           owner + "/" + name,
			BaseBranch:     base,
			RequiredChecks: []string{checkInfragatePlanReview, checkInfragatePolicy},
			Summary:        fmt.Sprintf("%s/%s expects %s and %s on %s", owner, name, checkInfragatePlanReview, checkInfragatePolicy, base),
		}
		if repo, err := getDeployIntelRepo(owner, name); err == nil && repo != nil {
			item.Onboarded = repo.Enabled
			if strings.TrimSpace(repo.BaseBranch) != "" {
				item.BaseBranch = repo.BaseBranch
			}
		}
		out = append(out, item)
	}
	if repos, err := listDeployIntelRepos(); err == nil {
		for _, repo := range repos {
			add(repo.Owner, repo.Name, repo.BaseBranch)
		}
	}
	for _, change := range changes {
		parts := strings.Split(change.Repo, "/")
		if len(parts) == 2 {
			add(parts[0], parts[1], "main")
		}
	}
	return out
}

func evidenceMarkdown(pack evidencePack) string {
	var b strings.Builder
	b.WriteString("# OpsTrellis evidence pack\n\n")
	b.WriteString(pack.Summary + "\n\n")
	b.WriteString("## Changes\n")
	for _, item := range pack.Changes {
		approver := firstNonEmpty(item.CABApprovedByUsername, item.Author, "none")
		b.WriteString(fmt.Sprintf("- %s sha=%s watch=%s approved_by=%s policy=%s cost=%s%.2f status=%s\n",
			item.ChangeNumber, item.SHA, firstNonEmpty(item.WatchResult, changeWatchResult(item)), approver, firstNonEmpty(item.PolicyStatus, "none"), firstNonEmpty(item.CostCurrency, "USD"), item.CostDeltaUSD, item.Status))
	}
	b.WriteString("\n## Incidents\n")
	for _, item := range pack.Incidents {
		b.WriteString(fmt.Sprintf("- %s %s %s %s\n", item.IncidentNumber, item.Severity, item.Status, item.Summary))
	}
	b.WriteString("\n## Approvals\n")
	for _, item := range pack.Approvals {
		b.WriteString(fmt.Sprintf("- #%v %v %v\n", item["id"], item["status"], item["pr_url"]))
	}
	b.WriteString("\n## Branch protection\n")
	for _, item := range pack.BranchProtection {
		onboarded := "not onboarded"
		if item.Onboarded {
			onboarded = "onboarded"
		}
		b.WriteString(fmt.Sprintf("- %s %s %s checks=%s\n", item.Repo, item.BaseBranch, onboarded, strings.Join(item.RequiredChecks, ",")))
	}
	return b.String()
}

func devopsEvidenceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireDevopsUser(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	from := parseFlexibleTime(r.URL.Query().Get("from"))
	to := parseFlexibleTime(r.URL.Query().Get("to"))
	pack, err := buildEvidencePack(projectID, from, to)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to build evidence pack", err)
		return
	}
	if strings.EqualFold(r.URL.Query().Get("format"), "md") {
		w.Header().Set("Content-Type", "text/markdown")
		w.Header().Set("Content-Disposition", "attachment; filename=opstrellis-evidence.md")
		_, _ = w.Write([]byte(evidenceMarkdown(*pack)))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"evidence": pack, "status": "ok"})
}

func adminEvidenceHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	projectID, _ := strconv.Atoi(r.URL.Query().Get("project_id"))
	pack, err := buildEvidencePack(projectID, parseFlexibleTime(r.URL.Query().Get("from")), parseFlexibleTime(r.URL.Query().Get("to")))
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to build evidence pack", err)
		return
	}
	if strings.EqualFold(r.URL.Query().Get("format"), "md") {
		w.Header().Set("Content-Type", "text/markdown")
		w.Header().Set("Content-Disposition", "attachment; filename=opstrellis-evidence.md")
		_, _ = w.Write([]byte(evidenceMarkdown(*pack)))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"evidence": pack, "status": "ok"})
}
