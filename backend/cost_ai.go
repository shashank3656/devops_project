package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var (
	costAIEmailPattern     = regexp.MustCompile(`(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b`)
	costAIArnPattern       = regexp.MustCompile(`(?i)\barn:[a-z0-9\-]+:[a-z0-9\-]+:[^:\s]*:\d{12}:\S+`)
	costAIAccountPattern   = regexp.MustCompile(`\b\d{12}\b`)
	costAIInstancePattern  = regexp.MustCompile(`(?i)\b(?:i|vol|snap|ami|sg|subnet|vpc|eks|arn)-[0-9a-z]{6,}\b`)
	costAIAccessKeyPattern = regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`)
	costAIJWTPattern       = regexp.MustCompile(`\beyJ[A-Za-z0-9_\-]+=*\.[A-Za-z0-9_\-]+=*\.[A-Za-z0-9_\-]+=*`)
	costAISecretKVPattern  = regexp.MustCompile(`(?i)\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|kubeconfig|bearer|external[_-]?id|role[_-]?arn|iam[_-]?role|assume[_-]?role|aws_secret_access_key)\b\s*[:=]\s*\S+`)
	costAIRedacted         = "[redacted]"
)

var costAIDroppedKeys = map[string]struct{}{
	"password":              {},
	"passwd":                {},
	"secret":                {},
	"token":                 {},
	"api_key":               {},
	"apikey":                {},
	"access_key":            {},
	"aws_secret_access_key": {},
	"private_key":           {},
	"pem":                   {},
	"kubeconfig":            {},
	"credentials":           {},
	"credential":            {},
	"role_arn":              {},
	"rolearn":               {},
	"role_name":             {},
	"iam_role":              {},
	"assume_role":           {},
	"external_id":           {},
	"account_id":            {},
	"cloud_account_id":      {},
	"auth":                  {},
	"authorization":         {},
	"cookie":                {},
	"session":               {},
	"email":                 {},
	"emails":                {},
	"username":              {},
	"resource_id":           {},
	"rbac_yaml":             {},
	"kubeconfig_yaml":       {},
}

func costAIPolicy() map[string]any {
	return map[string]any{
		"shares":       []string{"CALC-COST IDs", "finding family", "coverage", "labelled amounts"},
		"never_shares": []string{"cloud account IDs", "role names", "role ARNs", "passwords", "tokens", "kubeconfigs", "emails", "people names", "resource ARNs"},
		"note":         "Cost suggestions use stored calculation IDs. Copilot never receives cloud account details, passwords, role names, or other secrets.",
	}
}

func redactSensitiveForAI(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	text = costAISecretKVPattern.ReplaceAllString(text, costAIRedacted)
	text = costAIArnPattern.ReplaceAllString(text, costAIRedacted)
	text = costAIJWTPattern.ReplaceAllString(text, costAIRedacted)
	text = costAIAccessKeyPattern.ReplaceAllString(text, costAIRedacted)
	text = costAIEmailPattern.ReplaceAllString(text, costAIRedacted)
	text = costAIInstancePattern.ReplaceAllString(text, costAIRedacted)
	text = costAIAccountPattern.ReplaceAllString(text, costAIRedacted)
	return text
}

func costAIDropKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "-", "_"))
	_, ok := costAIDroppedKeys[normalized]
	return ok
}

func sanitizeValueForAI(value any) any {
	switch typed := value.(type) {
	case string:
		return redactSensitiveForAI(typed)
	case map[string]any:
		return sanitizeCopilotContext(typed)
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, sanitizeValueForAI(item))
		}
		return out
	default:
		return value
	}
}

func sanitizeCopilotContext(context map[string]any) map[string]any {
	if len(context) == 0 {
		return map[string]any{}
	}
	out := map[string]any{}
	for key, value := range context {
		if costAIDropKey(key) {
			continue
		}
		out[key] = sanitizeValueForAI(value)
	}
	return out
}

func sanitizeCopilotForModel(body copilotRequest) copilotRequest {
	body.Query = redactSensitiveForAI(body.Query)
	body.Title = redactSensitiveForAI(body.Title)
	body.Path = redactSensitiveForAI(body.Path)
	body.Portal = strings.TrimSpace(body.Portal)
	body.Context = sanitizeCopilotContext(body.Context)
	return body
}

func copilotModelUserContent(body copilotRequest) string {
	body = sanitizeCopilotForModel(body)
	contextJSON, _ := json.Marshal(body.Context)
	return fmt.Sprintf("Portal: %s\nPage: %s %s\nQuestion: %s\nContext: %s", body.Portal, body.Title, body.Path, body.Query, string(contextJSON))
}

func copilotCostSystemPrompt() string {
	return "You are the OpsTrellis Cost analysis assistant, not Help. Answer only from the provided Cost calculation citations. For each recommendation name the billed scope, period, source (labelled CUR 2.0), and CALC-COST ID. Never invent dollar amounts or SKUs that are not on a calculation ID. Never apply Terraform, Helm, or cluster changes. Never ask for or repeat cloud account IDs, IAM role names, passwords, tokens, ARNs, kubeconfigs, emails, or people names. Refreshing the page does not pull newer provider billing."
}

func costAISafeSource(item costCalculation) groundedSource {
	return costAISafeSourceForWindow(item, "", "", "actual")
}

func costAISafeSourceForWindow(item costCalculation, windowStart, windowEnd, basis string) groundedSource {
	amount := "Unknown"
	if item.Coverage == "complete" && strings.TrimSpace(item.Amount) != "" {
		amount = formatCostDisplay(item.Amount, "USD")
	}
	family := costFindingFamily(item.Kind)
	if family == "other" {
		family = "cost"
	}
	period := "Unknown window"
	if strings.TrimSpace(windowStart) != "" && strings.TrimSpace(windowEnd) != "" {
		period = windowStart + " to " + windowEnd
	}
	if strings.TrimSpace(basis) == "" {
		basis = "actual"
	}
	body := strings.TrimSpace(strings.Join([]string{
		item.CalcID,
		"kind " + item.Kind,
		"scope billed AWS CUR for projects you can see",
		"period " + period,
		"basis " + basis,
		"source labelled CUR 2.0",
		"coverage " + item.Coverage,
		"amount " + amount,
	}, " "))
	return groundedSource{
		Kind:    "cost_calculation",
		Number:  item.CalcID,
		Title:   item.Kind,
		Href:    citationHRef("cost_calculation", 0, item.CalcID),
		Service: family,
		Body:    body,
	}
}

func costAISafeSourceLeaks(source groundedSource) bool {
	blob := strings.Join([]string{source.Number, source.Title, source.Href, source.Service, source.Body}, " ")
	if costAIAccountPattern.MatchString(blob) || costAIArnPattern.MatchString(blob) || costAIInstancePattern.MatchString(blob) {
		return true
	}
	lower := strings.ToLower(blob)
	return strings.Contains(lower, "password") || strings.Contains(lower, "role_arn") || strings.Contains(lower, "kubeconfig")
}

type costAIProof struct {
	Status          string `json:"status"`
	DroppedKeyCount int    `json:"dropped_key_count"`
	RedactedCount   int    `json:"redacted_count"`
	CalcIDsPresent  bool   `json:"calc_ids_present"`
	CostPath        bool   `json:"cost_path"`
	CreatedAt       string `json:"created_at,omitempty"`
}

func costAIProofFromRequest(body copilotRequest) costAIProof {
	originalKeys := 0
	dropped := 0
	if body.Context != nil {
		originalKeys = len(body.Context)
	}
	sanitized := sanitizeCopilotForModel(body)
	if body.Context != nil {
		dropped = originalKeys - len(sanitized.Context)
		if dropped < 0 {
			dropped = 0
		}
	}
	before := strings.Join([]string{body.Query, body.Title, body.Path, mustJSON(body.Context)}, " ")
	after := copilotModelUserContent(body)
	redacted := strings.Count(after, costAIRedacted)
	if redactSensitiveForAI(before) != strings.TrimSpace(before) && redacted == 0 {
		redacted = 1
	}
	status := "safe"
	if dropped > 0 || redacted > 0 {
		status = "blocked"
	}
	path := strings.ToLower(body.Path + " " + body.Query + " " + body.Title)
	return costAIProof{
		Status:          status,
		DroppedKeyCount: dropped,
		RedactedCount:   redacted,
		CalcIDsPresent:  strings.Contains(strings.ToUpper(after), "CALC-COST-"),
		CostPath:        strings.Contains(path, "/cost") || costQueryRelated(body.Query+" "+body.Title),
	}
}

func mustJSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func recordCostAIProof(userID int, body copilotRequest) {
	proof := costAIProofFromRequest(body)
	if !proof.CostPath {
		return
	}
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		INSERT INTO cost_ai_proofs (user_id, status, dropped_key_count, redacted_count, calc_ids_present, cost_path)
		VALUES ($1,$2,$3,$4,$5,TRUE)
	`, userID, proof.Status, proof.DroppedKeyCount, proof.RedactedCount, proof.CalcIDsPresent)
}

func listCostAIProofs(userID int) []costAIProof {
	if DB == nil || userID <= 0 {
		return []costAIProof{}
	}
	rows, err := DB.Query(`
		SELECT status, dropped_key_count, redacted_count, calc_ids_present, cost_path, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		  FROM cost_ai_proofs
		 WHERE user_id = $1
		 ORDER BY created_at DESC, id DESC
		 LIMIT 20
	`, userID)
	if err != nil {
		return []costAIProof{}
	}
	defer rows.Close()
	out := []costAIProof{}
	for rows.Next() {
		var item costAIProof
		if err := rows.Scan(&item.Status, &item.DroppedKeyCount, &item.RedactedCount, &item.CalcIDsPresent, &item.CostPath, &item.CreatedAt); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

func costAIProofSummary(items []costAIProof) map[string]any {
	safe, blocked := 0, 0
	dropped := 0
	for _, item := range items {
		if item.Status == "blocked" {
			blocked++
		} else {
			safe++
		}
		dropped += item.DroppedKeyCount
	}
	return map[string]any{
		"safe":              safe,
		"blocked":           blocked,
		"dropped_key_count": dropped,
		"proofs":            items,
		"note":              "Proofs store counts only. Prompts, account IDs, passwords, and role names are never saved.",
	}
}
