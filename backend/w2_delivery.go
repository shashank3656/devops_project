package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type previewEnvironment struct {
	ID                int        `json:"id"`
	Repo              string     `json:"repo"`
	PRNumber          int        `json:"pr_number"`
	Branch            string     `json:"branch,omitempty"`
	SHA               string     `json:"sha,omitempty"`
	URL               string     `json:"url,omitempty"`
	Status            string     `json:"status"`
	ChangeID          *int       `json:"change_id,omitempty"`
	ChangeNumber      string     `json:"change_number,omitempty"`
	EstimatedCostUSD  float64    `json:"estimated_cost_usd"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	TornDownAt        *time.Time `json:"torn_down_at,omitempty"`
}

func normalizeRolloutStage(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "canary", "1", "1%":
		return "canary"
	case "10", "10%":
		return "10"
	case "50", "50%":
		return "50"
	case "100", "100%", "full":
		return "100"
	default:
		return ""
	}
}

func rolloutPercentForStage(stage string) int {
	switch normalizeRolloutStage(stage) {
	case "canary":
		return 1
	case "10":
		return 10
	case "50":
		return 50
	case "100":
		return 100
	default:
		return 0
	}
}

func persistChangeRollout(id int, payload parsedChangeWebhook) {
	if id <= 0 || DB == nil {
		return
	}
	stage := normalizeRolloutStage(payload.RolloutStage)
	percent := payload.RolloutPercent
	if percent <= 0 {
		percent = rolloutPercentForStage(stage)
	}
	if percent <= 0 && stage == "" {
		if normalizeChangeType(payload.ChangeType) == "preview" || normalizeChangeType(payload.ChangeType) == "flag" {
			stage = "100"
			percent = 100
		} else {
			return
		}
	}
	if percent <= 0 {
		percent = 100
	}
	if percent > 100 {
		percent = 100
	}
	if stage == "" {
		switch {
		case percent <= 1:
			stage = "canary"
		case percent <= 10:
			stage = "10"
		case percent <= 50:
			stage = "50"
		default:
			stage = "100"
		}
	}
	_, _ = execContext(`
		UPDATE change_requests
		SET rollout_stage = $2, rollout_percent = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, stage, percent)
}

func haltChangeRollout(id int, reasons []string) {
	if id <= 0 || DB == nil {
		return
	}
	note := strings.Join(reasons, "; ")
	if note == "" {
		note = "Health watcher halted progressive delivery"
	}
	_, _ = execContext(`
		UPDATE change_requests
		SET rollout_halted = TRUE, rollout_note = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND COALESCE(rollout_percent, 100) < 100
	`, id, note)
}

func setChangeRollout(id int, stage string) (*changeRequestRecord, error) {
	stage = normalizeRolloutStage(stage)
	if stage == "" {
		return nil, fmt.Errorf("rollout stage must be canary, 10, 50, or 100")
	}
	percent := rolloutPercentForStage(stage)
	_, err := execContext(`
		UPDATE change_requests
		SET rollout_stage = $2, rollout_percent = $3, rollout_halted = FALSE, rollout_note = '', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, stage, percent)
	if err != nil {
		return nil, err
	}
	item, err := getChangeRequestByID(id)
	if err == nil && item != nil {
		go FireOutboundWebhooks("change.updated", map[string]interface{}{
			"change_id":       item.ID,
			"change_number":   item.ChangeNumber,
			"rollout_stage":   item.RolloutStage,
			"rollout_percent": item.RolloutPercent,
		})
	}
	return item, err
}

func previewHourlyUSD() float64 {
	if raw := strings.TrimSpace(os.Getenv("PREVIEW_HOURLY_USD")); raw != "" {
		if parsed, err := strconv.ParseFloat(raw, 64); err == nil && parsed > 0 {
			return parsed
		}
	}
	return 0.25
}

func previewURLFor(repo string, pr int, branch string) string {
	template := strings.TrimSpace(os.Getenv("PREVIEW_URL_TEMPLATE"))
	if template == "" {
		slug := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(repo), "/", "-"))
		return fmt.Sprintf("https://pr-%d.%s.preview.local", pr, slug)
	}
	out := template
	out = strings.ReplaceAll(out, "{pr}", strconv.Itoa(pr))
	out = strings.ReplaceAll(out, "{repo}", repo)
	out = strings.ReplaceAll(out, "{branch}", branch)
	return out
}

func estimatePreviewCost(created time.Time, tornDown *time.Time) float64 {
	end := time.Now()
	if tornDown != nil {
		end = *tornDown
	}
	hours := end.Sub(created).Hours()
	if hours < 1 {
		hours = 1
	}
	return hours * previewHourlyUSD()
}

func upsertPreviewFromPullRequest(owner, repo string, pr map[string]interface{}, action string) *previewEnvironment {
	if DB == nil {
		return nil
	}
	number := intFromAny(pr["number"])
	if number <= 0 || owner == "" || repo == "" {
		return nil
	}
	fullRepo := owner + "/" + repo
	branch := ""
	sha := ""
	if head, ok := pr["head"].(map[string]interface{}); ok {
		branch = stringFromAny(head["ref"])
		sha = stringFromAny(head["sha"])
	}
	title := firstNonEmpty(stringFromAny(pr["title"]), fmt.Sprintf("Preview PR #%d", number))
	author := ""
	if user, ok := pr["user"].(map[string]interface{}); ok {
		author = stringFromAny(user["login"])
	}
	htmlURL := stringFromAny(pr["html_url"])
	merged, _ := pr["merged"].(bool)
	closed := action == "closed" || action == "merged" || merged
	if closed {
		return teardownPreview(fullRepo, number)
	}
	if action != "opened" && action != "synchronize" && action != "reopened" && action != "ready_for_review" {
		return nil
	}
	url := previewURLFor(fullRepo, number, branch)
	payload := parsedChangeWebhook{
		Repo:           fullRepo,
		SHA:            fmt.Sprintf("preview-%d", number),
		PreviousSHA:    sha,
		PRNumber:       number,
		PRURL:          htmlURL,
		Title:          "Preview: " + title,
		Author:         author,
		Service:        repo,
		Environment:    "preview",
		ChangeType:     "preview",
		Status:         "implementing",
		WatchMinutes:   240,
		PreviewURL:     url,
		RolloutStage:   "100",
		RolloutPercent: 100,
	}
	item, _, err := upsertChangeRequest(payload)
	if err != nil || item == nil {
		return nil
	}
	cost := estimatePreviewCost(time.Now(), nil)
	var id int
	err = queryRowContext(`
		INSERT INTO preview_environments (repo, pr_number, branch, sha, url, status, change_id, estimated_cost_usd, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'live', $6, $7, CURRENT_TIMESTAMP)
		ON CONFLICT (LOWER(repo), pr_number)
		DO UPDATE SET branch = EXCLUDED.branch, sha = EXCLUDED.sha, url = EXCLUDED.url, status = 'live',
		              change_id = EXCLUDED.change_id, estimated_cost_usd = EXCLUDED.estimated_cost_usd,
		              torn_down_at = NULL, updated_at = CURRENT_TIMESTAMP
		RETURNING id
	`, fullRepo, number, branch, sha, url, item.ID, cost).Scan(&id)
	if err != nil {
		return nil
	}
	return getPreviewEnvironment(id)
}

func teardownPreview(repo string, prNumber int) *previewEnvironment {
	if DB == nil {
		return nil
	}
	var id, changeID int
	var created time.Time
	err := queryRowContext(`
		SELECT id, COALESCE(change_id,0), created_at
		FROM preview_environments
		WHERE LOWER(repo) = LOWER($1) AND pr_number = $2
	`, repo, prNumber).Scan(&id, &changeID, &created)
	if err != nil {
		return nil
	}
	now := time.Now()
	cost := estimatePreviewCost(created, &now)
	_, _ = execContext(`
		UPDATE preview_environments
		SET status = 'torn_down', estimated_cost_usd = $2, torn_down_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, cost)
	if changeID > 0 {
		_, _ = transitionChangeStatus(changeID, "cancelled")
	}
	return getPreviewEnvironment(id)
}

func getPreviewEnvironment(id int) *previewEnvironment {
	items := listPreviewEnvironments(0)
	for i := range items {
		if items[i].ID == id {
			return &items[i]
		}
	}
	return nil
}

func listPreviewEnvironments(limit int) []previewEnvironment {
	if DB == nil {
		return nil
	}
	if limit <= 0 {
		limit = 100
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT p.id, p.repo, p.pr_number, COALESCE(p.branch,''), COALESCE(p.sha,''), COALESCE(p.url,''), COALESCE(p.status,''),
		       p.change_id, COALESCE(c.change_number,''), COALESCE(p.estimated_cost_usd,0), p.created_at, p.updated_at, p.torn_down_at
		FROM preview_environments p
		LEFT JOIN change_requests c ON c.id = p.change_id
		ORDER BY p.updated_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil
	}
	defer cancel()
	defer rows.Close()
	out := []previewEnvironment{}
	for rows.Next() {
		var item previewEnvironment
		var changeID sql.NullInt64
		var torn sql.NullTime
		if err := rows.Scan(&item.ID, &item.Repo, &item.PRNumber, &item.Branch, &item.SHA, &item.URL, &item.Status, &changeID, &item.ChangeNumber, &item.EstimatedCostUSD, &item.CreatedAt, &item.UpdatedAt, &torn); err != nil {
			continue
		}
		if changeID.Valid && changeID.Int64 > 0 {
			value := int(changeID.Int64)
			item.ChangeID = &value
		}
		if torn.Valid {
			item.TornDownAt = &torn.Time
		}
		if item.Status == "live" {
			item.EstimatedCostUSD = estimatePreviewCost(item.CreatedAt, item.TornDownAt)
		}
		out = append(out, item)
	}
	return out
}

func previewsForBranch(branch string) []previewEnvironment {
	if strings.TrimSpace(branch) == "" {
		return nil
	}
	out := []previewEnvironment{}
	for _, item := range listPreviewEnvironments(100) {
		if strings.EqualFold(item.Branch, branch) && item.Status == "live" {
			out = append(out, item)
		}
	}
	return out
}

func devopsPreviewsHandler(w http.ResponseWriter, r *http.Request) {
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
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"previews": listPreviewEnvironments(100),
		"status":   "ok",
	})
}

func parseFlagWebhook(body []byte) (parsedChangeWebhook, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return parsedChangeWebhook{}, err
	}
	data, _ := raw["data"].(map[string]interface{})
	if data == nil {
		data = raw
	}
	flag := firstNonEmpty(
		stringFromAny(data["key"]),
		stringFromAny(data["flag"]),
		stringFromAny(data["feature"]),
		stringFromAny(raw["flag_key"]),
	)
	if flag == "" {
		if item, ok := data["item"].(map[string]interface{}); ok {
			flag = firstNonEmpty(stringFromAny(item["name"]), stringFromAny(item["key"]))
		}
	}
	if flag == "" {
		return parsedChangeWebhook{}, fmt.Errorf("flag key is required")
	}
	project := firstNonEmpty(stringFromAny(data["project"]), stringFromAny(raw["project"]), "flags")
	env := firstNonEmpty(stringFromAny(data["environment"]), stringFromAny(raw["environment"]))
	value := firstNonEmpty(stringFromAny(data["value"]), stringFromAny(data["variation"]), stringFromAny(raw["flag_value"]))
	actor := firstNonEmpty(stringFromAny(data["member"]), stringFromAny(raw["user"]), stringFromAny(raw["author"]))
	if member, ok := data["member"].(map[string]interface{}); ok {
		actor = firstNonEmpty(stringFromAny(member["email"]), stringFromAny(member["username"]), actor)
	}
	version := firstNonEmpty(stringFromAny(data["version"]), stringFromAny(raw["eventId"]), strconv.FormatInt(time.Now().Unix(), 10))
	kind := firstNonEmpty(stringFromAny(raw["kind"]), stringFromAny(raw["type"]), stringFromAny(raw["event_type"]), "flag")
	payload := parsedChangeWebhook{
		Repo:           "flags/" + project,
		SHA:            "flag-" + flag + "-" + version,
		Title:          fmt.Sprintf("Flag %s %s", flag, firstNonEmpty(kind, value)),
		Author:         actor,
		Service:        firstNonEmpty(stringFromAny(raw["service"]), project),
		Environment:    env,
		ChangeType:     "flag",
		Status:         "implemented",
		WatchMinutes:   60,
		Summary:        firstNonEmpty(stringFromAny(raw["comment"]), "Feature flag change from "+kind),
		FlagKey:        flag,
		FlagValue:      value,
		RolloutStage:   "100",
		RolloutPercent: 100,
	}
	if payload.Environment == "" {
		payload.Environment = "unspecified"
	}
	return payload, nil
}

func flagWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	body, err := readWebhookBody(r)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	if !inboundWebhookAuthorized(inboundKindChange, r.Header, body) {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid secret", nil)
		return
	}
	payload, err := parseFlagWebhook(body)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	item, created, err := upsertChangeRequest(payload)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "failed to record flag change", err)
		return
	}
	if created {
		go FireOutboundWebhooks("change.created", map[string]interface{}{
			"change_number": item.ChangeNumber,
			"change_type":   item.ChangeType,
			"flag_key":      payload.FlagKey,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":        "ok",
		"created":       created,
		"change":        item,
		"change_number": item.ChangeNumber,
	})
}
