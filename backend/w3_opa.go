package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
)

type policyRule struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Target    string    `json:"target"`
	Rego      string    `json:"rego"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func normalizePolicyTarget(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "request", "ticket", "request.json":
		return "request"
	default:
		return "change"
	}
}

func persistChangeCost(id int, payload parsedChangeWebhook) {
	if id <= 0 || DB == nil {
		return
	}
	delta := payload.CostDeltaUSD
	after := payload.CostMonthlyAfter
	currency := firstNonEmpty(payload.CostCurrency, "USD")
	if len(payload.InfracostReport) > 0 {
		if report, err := parseInfracostReport(payload.InfracostReport); err == nil {
			if report.HasDiff {
				delta = report.DiffTotalMonthlyCost
			}
			after = report.TotalMonthlyCost
			currency = firstNonEmpty(report.Currency, currency)
		}
	}
	if delta == 0 && after == 0 {
		return
	}
	_, _ = execContext(`
		UPDATE change_requests
		SET cost_delta_usd = $2, cost_monthly_after = $3, cost_currency = $4, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, delta, after, currency)
}

func finalizeChangeCost(id int) {
	if id <= 0 {
		return
	}
	item, err := getChangeRequestByID(id)
	if err != nil || item == nil {
		return
	}
	if item.CostDeltaUSD != 0 || item.CostMonthlyAfter != 0 || item.RequestID == nil {
		return
	}
	req, err := GetPRRequestByID(*item.RequestID)
	if err != nil || req == nil {
		return
	}
	check := buildRequestCostCheck(req)
	if !check.HasInfracost {
		return
	}
	persistChangeCost(id, parsedChangeWebhook{
		CostDeltaUSD:     check.DiffMonthlyCost,
		CostMonthlyAfter: check.MonthlyCost,
		CostCurrency:     firstNonEmpty(check.Currency, "USD"),
	})
}

func applyChangePolicies(id int, payload parsedChangeWebhook) {
	if id <= 0 {
		return
	}
	environment := payload.Environment
	changeType := payload.ChangeType
	service := payload.Service
	repo := payload.Repo
	impact := payload.Impact
	summary := payload.Summary
	cabApproved := false
	if existing, err := getChangeRequestByID(id); err == nil && existing != nil {
		environment = firstNonEmpty(environment, existing.Environment)
		changeType = firstNonEmpty(changeType, existing.ChangeType)
		service = firstNonEmpty(service, existing.Service)
		repo = firstNonEmpty(repo, existing.Repo)
		impact = firstNonEmpty(impact, existing.Impact)
		summary = firstNonEmpty(summary, existing.Summary)
		cabApproved = strings.EqualFold(existing.CABStatus, "approved") || existing.CABApprovedAt != nil
	}
	input := map[string]any{
		"environment":  environment,
		"change_type":  normalizeChangeType(changeType),
		"service":      service,
		"repo":         repo,
		"weekday":      time.Now().Weekday().String(),
		"cab_approved": cabApproved,
		"public":       strings.Contains(strings.ToLower(impact+summary), "public"),
		"freeze_reason": "",
	}
	if isHighControlEnvironment(environment) {
		input["freeze_reason"] = activeFreezeReason()
	}
	denied := evaluatePolicyRules("change", input)
	status := "pass"
	if len(denied) > 0 {
		status = "fail"
	}
	raw, _ := json.Marshal(denied)
	_, _ = execContext(`
		UPDATE change_requests
		SET policy_status = $2, policy_reasons_json = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, status, string(raw))
	if item, err := getChangeRequestByID(id); err == nil && item != nil {
		publishChangePolicyStatus(*item, denied)
	}
}

func publishChangePolicyStatus(item changeRequestRecord, denied []string) {
	parts := strings.Split(item.Repo, "/")
	if len(parts) != 2 || strings.TrimSpace(item.SHA) == "" || GitHubToken == "" {
		return
	}
	if strings.HasPrefix(item.SHA, "manual-") || strings.HasPrefix(item.SHA, "preview-") || strings.HasPrefix(item.SHA, "flag-") {
		return
	}
	reason := "SetuOps policy passed"
	state := "success"
	if len(denied) > 0 {
		state = "failure"
		reason = denied[0]
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		client, err := newGitHubClient()
		if err != nil {
			return
		}
		status := &github.RepoStatus{
			State:       github.String(state),
			Context:     github.String(policyStatusContext),
			Description: github.String(truncateStatusDescription(reason)),
		}
		_, _, _ = client.Repositories.CreateStatus(ctx, parts[0], parts[1], item.SHA, status)
	}()
}

func evaluatePolicyRules(target string, input map[string]any) []string {
	denied := []string{}
	denied = append(denied, evaluateBuiltinPolicies(target, input)...)
	for _, rule := range listPolicyRules(target, true) {
		if msgs := evaluateRegoDeny(rule.Rego, input); len(msgs) > 0 {
			denied = append(denied, msgs...)
		}
	}
	return denied
}

func evaluateBuiltinPolicies(target string, input map[string]any) []string {
	env := strings.ToLower(stringFromAny(input["environment"]))
	changeType := strings.ToLower(stringFromAny(input["change_type"]))
	weekday := stringFromAny(input["weekday"])
	out := []string{}
	if target == "change" && isHighControlEnvironment(env) {
		if reason := strings.TrimSpace(stringFromAny(input["freeze_reason"])); reason != "" {
			out = append(out, "deployment freeze is active: "+reason)
		}
		if changeType == "standard" && (weekday == "Friday" || weekday == "Saturday") {
			if cab, _ := input["cab_approved"].(bool); !cab {
				out = append(out, "no standard prod change on Friday or Saturday without CAB")
			}
		}
	}
	if target == "request" {
		if pub, _ := input["public"].(bool); pub && isHighControlEnvironment(env) {
			out = append(out, "public exposure is not allowed in this environment")
		}
	}
	return out
}

func evaluateRegoDeny(rego string, input map[string]any) []string {
	blocks := strings.Split(rego, "deny")
	out := []string{}
	for _, block := range blocks[1:] {
		conditions := []string{}
		message := "policy denied"
		for _, line := range strings.Split(block, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "msg") && strings.Contains(trimmed, "\"") {
				if start := strings.Index(trimmed, "\""); start >= 0 {
					if end := strings.LastIndex(trimmed, "\""); end > start {
						message = trimmed[start+1 : end]
					}
				}
			}
			if strings.Contains(trimmed, "input.") && strings.Contains(trimmed, "==") {
				conditions = append(conditions, trimmed)
			}
		}
		if len(conditions) == 0 {
			continue
		}
		matched := true
		for _, cond := range conditions {
			parts := strings.SplitN(cond, "==", 2)
			if len(parts) != 2 {
				matched = false
				break
			}
			key := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(parts[0]), "input."))
			want := strings.Trim(strings.TrimSpace(parts[1]), `"`)
			got := stringFromAny(input[key])
			if boolVal, ok := input[key].(bool); ok {
				got = strconv.FormatBool(boolVal)
			}
			if !strings.EqualFold(got, want) {
				matched = false
				break
			}
		}
		if matched {
			out = append(out, message)
		}
	}
	return out
}

func listPolicyRules(target string, enabledOnly bool) []policyRule {
	if DB == nil {
		return nil
	}
	query := `SELECT id, name, target, COALESCE(rego,''), enabled, created_at, updated_at FROM policy_rules`
	args := []any{}
	where := []string{}
	if target != "" {
		args = append(args, normalizePolicyTarget(target))
		where = append(where, fmt.Sprintf("target = $%d", len(args)))
	}
	if enabledOnly {
		where = append(where, "enabled = TRUE")
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY id"
	rows, cancel, err := queryRowsWithTimeout(query, args...)
	if err != nil {
		return nil
	}
	defer cancel()
	defer rows.Close()
	out := []policyRule{}
	for rows.Next() {
		var item policyRule
		if err := rows.Scan(&item.ID, &item.Name, &item.Target, &item.Rego, &item.Enabled, &item.CreatedAt, &item.UpdatedAt); err != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

func savePolicyRule(item policyRule) (*policyRule, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	item.Name = strings.TrimSpace(item.Name)
	item.Rego = strings.TrimSpace(item.Rego)
	item.Target = normalizePolicyTarget(item.Target)
	if item.Name == "" || item.Rego == "" {
		return nil, fmt.Errorf("name and rego are required")
	}
	if item.ID > 0 {
		_, err := execContext(`UPDATE policy_rules SET name=$2, target=$3, rego=$4, enabled=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, item.ID, item.Name, item.Target, item.Rego, item.Enabled)
		if err != nil {
			return nil, err
		}
		return &item, nil
	}
	err := queryRowContext(`INSERT INTO policy_rules (name, target, rego, enabled) VALUES ($1,$2,$3,$4) RETURNING id, created_at, updated_at`, item.Name, item.Target, item.Rego, item.Enabled).Scan(&item.ID, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func devopsPoliciesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method == "GET" {
		if _, ok := requireDevopsUser(w, r); !ok {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"policies": listPolicyRules(r.URL.Query().Get("target"), false), "status": "ok"})
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	var item policyRule
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid payload", err)
		return
	}
	item.Enabled = true
	saved, err := savePolicyRule(item)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"policy": saved, "status": "ok"})
}

func evaluateAndPublishRequestPolicy(req *PRRequest) {
	if req == nil {
		return
	}
	input := map[string]any{
		"environment": req.Env,
		"cloud":       req.Cloud,
		"service":     req.Service,
		"team":        req.Team,
		"weekday":     time.Now().Weekday().String(),
		"public":      strings.Contains(strings.ToLower(req.Service+req.Cloud), "public"),
	}
	denied := evaluatePolicyRules("request", input)
	if len(denied) == 0 {
		publishRequestCommitStatus(req, policyStatusContext, "success", "SetuOps policy passed")
		return
	}
	publishRequestCommitStatus(req, policyStatusContext, "failure", denied[0])
}
