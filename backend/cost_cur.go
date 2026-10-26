package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	costBackfillMonths = 13
	costMaxImportLines = 2000
	costStaleAfter     = 36 * time.Hour
)

func costParseDate(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, fmt.Errorf("date is required")
	}
	if len(raw) >= 10 {
		raw = raw[:10]
	}
	parsed, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("date must be YYYY-MM-DD")
	}
	return parsed.UTC(), nil
}

func costNormalizeKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "backfill":
		return "backfill"
	case "correction":
		return "correction"
	case "fixture":
		return "fixture"
	default:
		return "import"
	}
}

func costSanitizeLabel(raw string) (string, error) {
	label := strings.TrimSpace(raw)
	if strings.Contains(label, "@") {
		return "", fmt.Errorf("label cannot include an email")
	}
	if len(label) > 120 {
		label = strings.TrimSpace(label[:120])
	}
	return label, nil
}

func costWindowAllowed(start, end, now time.Time) error {
	if start.IsZero() || end.IsZero() {
		return fmt.Errorf("window start and end are required")
	}
	if end.Before(start) {
		return fmt.Errorf("window end is before start")
	}
	earliest := time.Date(now.UTC().Year(), now.UTC().Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -costBackfillMonths, 0)
	if start.Before(earliest) {
		return fmt.Errorf("backfill is limited to %d months", costBackfillMonths)
	}
	if start.After(now.UTC().Add(24 * time.Hour)) {
		return fmt.Errorf("window start cannot be in the future")
	}
	return nil
}

func costFreshnessDetail(connections []costConnection, now time.Time) map[string]any {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	now = now.UTC()
	billedThrough := ""
	var lastIngest *time.Time
	for _, conn := range connections {
		if conn.WindowComplete != nil && *conn.WindowComplete && strings.TrimSpace(conn.WindowEnd) != "" {
			if conn.WindowEnd > billedThrough {
				billedThrough = conn.WindowEnd
			}
		}
		if conn.LastIngestedAt != nil && (lastIngest == nil || conn.LastIngestedAt.After(*lastIngest)) {
			lastIngest = conn.LastIngestedAt
		}
	}
	lastIngestValue := any(nil)
	if lastIngest != nil {
		lastIngestValue = lastIngest.UTC().Format(time.RFC3339)
	}
	billedValue := any(nil)
	if billedThrough != "" {
		billedValue = billedThrough
	}
	return map[string]any{
		"billed_through":                  billedValue,
		"last_successful_ingestion":       lastIngestValue,
		"last_dashboard_refresh":          now.Format(time.RFC3339),
		"page_refresh_is_not_new_billing": true,
		"note":                            "Refreshing this page does not pull newer provider billing data.",
	}
}

func costPilotScope() map[string]any {
	return map[string]any{
		"label":                      "AWS CUR 2.0 labelled import",
		"mode":                       "manual",
		"note":                       "Pilot: paste a labelled CUR 2.0 export or ingest a sample bill. This product does not store billing credentials and does not pull CUR from AWS automatically.",
		"stores_billing_credentials": false,
		"automated_collection":       false,
	}
}

func costCollectionView(conn costConnection) map[string]any {
	lastSuccess := any(nil)
	if conn.LastIngestedAt != nil {
		lastSuccess = conn.LastIngestedAt.UTC().Format(time.RFC3339)
	}
	testStatus := strings.TrimSpace(conn.LastTestStatus)
	if testStatus == "" {
		testStatus = "unknown"
	}
	retry := "idle"
	if testStatus == "failed" {
		retry = "waiting for operator"
	}
	source := strings.TrimSpace(conn.BillingSource)
	if source == "" {
		source = "aws_cur_2"
	}
	return map[string]any{
		"connection_id": conn.ID,
		"source":        source,
		"configuration": source + " labelled import",
		"mode":          "manual",
		"schedule":      "On demand",
		"next_run":      "Not scheduled",
		"retry_status":  retry,
		"last_success":  lastSuccess,
		"connection_test": map[string]any{
			"status":    testStatus,
			"tested_at": timeOrNil(conn.LastTestAt),
			"note":      firstNonEmpty(conn.LastTestNote, "Test reads stored billed data. It does not pull newer provider billing."),
		},
	}
}

func timeOrNil(value *time.Time) any {
	if value == nil || value.IsZero() {
		return nil
	}
	return value.UTC().Format(time.RFC3339)
}

func costFreshness(last *time.Time, windowEnd time.Time, complete bool, now time.Time) string {
	if last == nil || last.IsZero() {
		return "unknown"
	}
	now = now.UTC()
	coversNow := windowEnd.IsZero() || !windowEnd.Before(now.Truncate(24*time.Hour))
	if coversNow && now.Sub(last.UTC()) > costStaleAfter {
		return "stale"
	}
	if !complete && coversNow {
		return "current"
	}
	return "current"
}

func costPayloadHasSecret(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			lower := strings.ToLower(strings.TrimSpace(key))
			if strings.Contains(lower, "secret") || strings.Contains(lower, "password") ||
				strings.Contains(lower, "private_key") || lower == "pem" ||
				strings.Contains(lower, "access_key") || strings.Contains(lower, "authorization") ||
				lower == "token" || strings.HasSuffix(lower, "_token") {
				return true
			}
			if costPayloadHasSecret(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if costPayloadHasSecret(child) {
				return true
			}
		}
	}
	return false
}

func costRawString(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			switch typed := value.(type) {
			case string:
				if strings.TrimSpace(typed) != "" {
					return strings.TrimSpace(typed)
				}
			case json.Number:
				return typed.String()
			case float64:
				return strconv.FormatFloat(typed, 'f', -1, 64)
			case int:
				return strconv.Itoa(typed)
			}
		}
	}
	return ""
}

func costRawAmount(raw map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		if _, ok := raw[key]; !ok {
			continue
		}
		text := costRawString(raw, key)
		if text == "" {
			continue
		}
		parsed, err := parseCostAmount(text)
		if err != nil {
			continue
		}
		return parsed, true
	}
	return "", false
}

func mapCUR2Line(raw map[string]any, accountID string) (costLineRow, error) {
	actual, hasActual := costRawAmount(raw, "line_item_unblended_cost", "line_item_net_unblended_cost", "actual_amount")
	amortized, hasAmortized := costRawAmount(raw, "line_item_net_amortized_cost", "line_item_amortized_cost", "reservation_effective_cost", "savings_plan_savings_plan_effective_cost", "amortized_amount")
	if !hasActual && !hasAmortized {
		return costLineRow{}, fmt.Errorf("CUR line is missing billed amounts")
	}
	if !hasActual {
		actual = amortized
	}
	if !hasAmortized {
		amortized = actual
	}
	usage := costRawString(raw, "line_item_usage_start_date", "usage_date", "bill_billing_period_start_date")
	if len(usage) >= 10 {
		usage = usage[:10]
	}
	lineAccount := costRawString(raw, "line_item_usage_account_id", "line_item_usage_accountid", "account_id")
	if lineAccount == "" {
		lineAccount = accountID
	}
	if costDemoAccountID(lineAccount) {
		return costLineRow{}, fmt.Errorf("demo cloud accounts cannot be used for Cost")
	}
	if accountID != "" && lineAccount != accountID {
		return costLineRow{}, fmt.Errorf("CUR usage account does not match the Cost connection")
	}
	currency := normalizeCostCurrency(costRawString(raw, "line_item_currency_code", "currency"))
	return costLineRow{
		Service:     costRawString(raw, "product_servicename", "product_product_name", "line_item_product_code", "service"),
		Region:      costRawString(raw, "product_region", "product_region_code", "region"),
		AccountID:   lineAccount,
		ResourceID:  costRawString(raw, "line_item_resource_id", "resource_id", "identity_line_item_id"),
		TeamSlug:    costRawString(raw, "resource_tags_user_team", "team_slug"),
		ProjectCode: costRawString(raw, "resource_tags_user_project", "project_code"),
		UsageDate:   usage,
		Actual:      actual,
		Amortized:   amortized,
		Currency:    currency,
		Amount:      actual,
	}, nil
}

func mapCUR2Lines(raw []map[string]any, accountID string) ([]costLineRow, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("CUR export has no lines")
	}
	if len(raw) > costMaxImportLines {
		return nil, fmt.Errorf("CUR export exceeds %d lines", costMaxImportLines)
	}
	out := make([]costLineRow, 0, len(raw))
	for i, row := range raw {
		if costPayloadHasSecret(row) {
			return nil, fmt.Errorf("CUR export cannot include secrets")
		}
		line, err := mapCUR2Line(row, accountID)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", i+1, err)
		}
		if strings.TrimSpace(line.Service) == "" {
			return nil, fmt.Errorf("line %d is missing a service", i+1)
		}
		out = append(out, line)
	}
	return out, nil
}

func costExportFingerprint(accountID, windowStart, windowEnd string, complete bool, lines []costLineRow) string {
	sum := sha256.New()
	_, _ = fmt.Fprintf(sum, "aws_cur_2|%s|%s|%s|%t\n", accountID, windowStart, windowEnd, complete)
	for _, line := range lines {
		_, _ = fmt.Fprintf(sum, "%s|%s|%s|%s|%s|%s|%s|%s\n",
			line.UsageDate, line.Service, line.Region, line.AccountID, line.ResourceID, line.Actual, line.Amortized, line.Currency)
	}
	return fmt.Sprintf("cur2-%x", sum.Sum(nil))
}
