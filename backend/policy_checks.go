package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Policy and security scan results (Checkov, tfsec, OPA/conftest) posted by CI
// to /api/webhooks/ci as "policy_reports": [{"tool": "checkov", "report": <native JSON>}].
// Critical and high findings block the merge through the infragate/policy commit status.

const (
	policyStatusContext  = "infragate/policy"
	maxPolicyFindings    = 80
	maxPolicyReportBytes = 4 << 20
)

type policyFinding struct {
	Rule     string `json:"rule"`
	Severity string `json:"severity"`
	Resource string `json:"resource,omitempty"`
	Message  string `json:"message"`
	File     string `json:"file,omitempty"`
}

type policyToolResult struct {
	Tool      string          `json:"tool"`
	Passed    int             `json:"passed"`
	Failed    int             `json:"failed"`
	Blocking  int             `json:"blocking"`
	Findings  []policyFinding `json:"findings"`
	Truncated bool            `json:"truncated"`
	UpdatedAt *time.Time      `json:"updated_at,omitempty"`
}

type policyCheckSummary struct {
	State    string             `json:"state"` // none, pass, warn, fail
	Passed   int                `json:"passed"`
	Failed   int                `json:"failed"`
	Blocking int                `json:"blocking"`
	Tools    []policyToolResult `json:"tools"`
}

type policyReportInput struct {
	Tool   string          `json:"tool"`
	Report json.RawMessage `json:"report"`
}

var policySeverityRank = map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4, "unknown": 5}

func normalizePolicySeverity(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case "critical", "high", "medium", "low", "info":
		return value
	case "error":
		return "high"
	case "warning", "warn", "moderate":
		return "medium"
	case "note", "informational":
		return "info"
	case "", "null", "none":
		return "unknown"
	}
	return "unknown"
}

func policySeverityBlocks(severity string) bool {
	return severity == "critical" || severity == "high"
}

func parseCheckovReport(raw json.RawMessage) (policyToolResult, error) {
	type checkovCheck struct {
		CheckID   string  `json:"check_id"`
		CheckName string  `json:"check_name"`
		Resource  string  `json:"resource"`
		FilePath  string  `json:"file_path"`
		Severity  *string `json:"severity"`
	}
	type checkovRun struct {
		Results struct {
			PassedChecks []json.RawMessage `json:"passed_checks"`
			FailedChecks []checkovCheck    `json:"failed_checks"`
		} `json:"results"`
		Summary struct {
			Passed int `json:"passed"`
			Failed int `json:"failed"`
		} `json:"summary"`
	}
	runs := []checkovRun{}
	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(trimmed, "[") {
		if err := json.Unmarshal(raw, &runs); err != nil {
			return policyToolResult{}, err
		}
	} else {
		var run checkovRun
		if err := json.Unmarshal(raw, &run); err != nil {
			return policyToolResult{}, err
		}
		runs = append(runs, run)
	}
	result := policyToolResult{Tool: "checkov"}
	for _, run := range runs {
		passed := len(run.Results.PassedChecks)
		if run.Summary.Passed > passed {
			passed = run.Summary.Passed
		}
		result.Passed += passed
		for _, check := range run.Results.FailedChecks {
			severity := "unknown"
			if check.Severity != nil {
				severity = normalizePolicySeverity(*check.Severity)
			}
			result.Findings = append(result.Findings, policyFinding{
				Rule: check.CheckID, Severity: severity, Resource: check.Resource, Message: check.CheckName, File: check.FilePath,
			})
		}
	}
	return result, nil
}

func parseTfsecReport(raw json.RawMessage) (policyToolResult, error) {
	var report struct {
		Results []struct {
			RuleID          string `json:"rule_id"`
			LongID          string `json:"long_id"`
			RuleDescription string `json:"rule_description"`
			Description     string `json:"description"`
			Severity        string `json:"severity"`
			Resource        string `json:"resource"`
			Location        struct {
				Filename string `json:"filename"`
			} `json:"location"`
		} `json:"results"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		return policyToolResult{}, err
	}
	result := policyToolResult{Tool: "tfsec"}
	for _, item := range report.Results {
		rule := item.LongID
		if rule == "" {
			rule = item.RuleID
		}
		message := item.Description
		if message == "" {
			message = item.RuleDescription
		}
		result.Findings = append(result.Findings, policyFinding{
			Rule: rule, Severity: normalizePolicySeverity(item.Severity), Resource: item.Resource, Message: message, File: item.Location.Filename,
		})
	}
	return result, nil
}

func parseConftestReport(raw json.RawMessage) (policyToolResult, error) {
	type conftestResult struct {
		Msg      string                 `json:"msg"`
		Metadata map[string]interface{} `json:"metadata"`
	}
	var report []struct {
		Filename  string           `json:"filename"`
		Namespace string           `json:"namespace"`
		Successes int              `json:"successes"`
		Failures  []conftestResult `json:"failures"`
		Warnings  []conftestResult `json:"warnings"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		return policyToolResult{}, err
	}
	result := policyToolResult{Tool: "opa"}
	add := func(file, namespace string, item conftestResult, severity string) {
		rule := namespace
		if query, ok := item.Metadata["query"].(string); ok && query != "" {
			rule = query
		}
		result.Findings = append(result.Findings, policyFinding{Rule: rule, Severity: severity, Message: item.Msg, File: file})
	}
	for _, file := range report {
		result.Passed += file.Successes
		for _, failure := range file.Failures {
			add(file.Filename, file.Namespace, failure, "high")
		}
		for _, warning := range file.Warnings {
			add(file.Filename, file.Namespace, warning, "medium")
		}
	}
	return result, nil
}

// parseGenericPolicyReport accepts the SetuOps shape for tools without a native parser.
func parseGenericPolicyReport(tool string, raw json.RawMessage) (policyToolResult, error) {
	var report struct {
		Passed   int             `json:"passed"`
		Findings []policyFinding `json:"findings"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		return policyToolResult{}, err
	}
	result := policyToolResult{Tool: tool, Passed: report.Passed}
	for _, finding := range report.Findings {
		finding.Severity = normalizePolicySeverity(finding.Severity)
		result.Findings = append(result.Findings, finding)
	}
	return result, nil
}

func parsePolicyReport(input policyReportInput) (policyToolResult, error) {
	tool := strings.ToLower(strings.TrimSpace(input.Tool))
	if tool == "" {
		return policyToolResult{}, fmt.Errorf("policy report is missing a tool name")
	}
	if len(input.Report) == 0 || len(input.Report) > maxPolicyReportBytes {
		return policyToolResult{}, fmt.Errorf("%s report is empty or too large", tool)
	}
	var (
		result policyToolResult
		err    error
	)
	switch tool {
	case "checkov":
		result, err = parseCheckovReport(input.Report)
	case "tfsec", "trivy-config":
		result, err = parseTfsecReport(input.Report)
		result.Tool = tool
	case "opa", "conftest":
		result, err = parseConftestReport(input.Report)
	default:
		if len(tool) > 40 {
			tool = tool[:40]
		}
		result, err = parseGenericPolicyReport(tool, input.Report)
	}
	if err != nil {
		return policyToolResult{}, fmt.Errorf("could not read %s report: %w", tool, err)
	}
	finalizePolicyResult(&result)
	return result, nil
}

func finalizePolicyResult(result *policyToolResult) {
	sort.SliceStable(result.Findings, func(i, j int) bool {
		return policySeverityRank[result.Findings[i].Severity] < policySeverityRank[result.Findings[j].Severity]
	})
	result.Failed = len(result.Findings)
	result.Blocking = 0
	for _, finding := range result.Findings {
		if policySeverityBlocks(finding.Severity) {
			result.Blocking++
		}
	}
	if len(result.Findings) > maxPolicyFindings {
		result.Findings = result.Findings[:maxPolicyFindings]
		result.Truncated = true
	}
	if result.Findings == nil {
		result.Findings = []policyFinding{}
	}
}

func savePolicyResult(requestID int, result policyToolResult) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	findings, err := json.Marshal(result.Findings)
	if err != nil {
		return err
	}
	_, err = execContext(`
		INSERT INTO pr_request_policy_checks (request_id, tool, passed, failed, blocking, truncated, findings, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
		ON CONFLICT (request_id, tool) DO UPDATE SET
			passed = EXCLUDED.passed, failed = EXCLUDED.failed, blocking = EXCLUDED.blocking,
			truncated = EXCLUDED.truncated, findings = EXCLUDED.findings, updated_at = CURRENT_TIMESTAMP
	`, requestID, result.Tool, result.Passed, result.Failed, result.Blocking, result.Truncated, string(findings))
	return err
}

func buildPolicyCheckSummary(requestID int) policyCheckSummary {
	summary := policyCheckSummary{State: "none", Tools: []policyToolResult{}}
	if DB == nil || requestID <= 0 {
		return summary
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT tool, passed, failed, blocking, truncated, findings, updated_at
		  FROM pr_request_policy_checks WHERE request_id = $1 ORDER BY tool
	`, requestID)
	if err != nil {
		return summary
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var result policyToolResult
		var findings string
		var updatedAt sql.NullTime
		if err := rows.Scan(&result.Tool, &result.Passed, &result.Failed, &result.Blocking, &result.Truncated, &findings, &updatedAt); err != nil {
			continue
		}
		if err := json.Unmarshal([]byte(findings), &result.Findings); err != nil || result.Findings == nil {
			result.Findings = []policyFinding{}
		}
		if updatedAt.Valid {
			value := updatedAt.Time
			result.UpdatedAt = &value
		}
		summary.Passed += result.Passed
		summary.Failed += result.Failed
		summary.Blocking += result.Blocking
		summary.Tools = append(summary.Tools, result)
	}
	switch {
	case len(summary.Tools) == 0:
		summary.State = "none"
	case summary.Blocking > 0:
		summary.State = "fail"
	case summary.Failed > 0:
		summary.State = "warn"
	default:
		summary.State = "pass"
	}
	return summary
}

func policyStatusFor(summary policyCheckSummary) (string, string) {
	switch summary.State {
	case "fail":
		return "failure", fmt.Sprintf("%d critical/high policy findings. Fix them or add an inline skip with a reason.", summary.Blocking)
	case "warn":
		return "success", fmt.Sprintf("%d lower-severity policy findings to review.", summary.Failed)
	case "pass":
		return "success", fmt.Sprintf("All %d policy checks passed.", summary.Passed)
	}
	return "", ""
}

// ingestPolicyReports stores every report it can parse and returns the parse errors for the rest.
func ingestPolicyReports(req *PRRequest, reports []policyReportInput) []string {
	problems := make([]string, 0)
	stored := 0
	for _, input := range reports {
		result, err := parsePolicyReport(input)
		if err != nil {
			problems = append(problems, err.Error())
			continue
		}
		if err := savePolicyResult(req.ID, result); err != nil {
			problems = append(problems, fmt.Sprintf("could not save %s results", result.Tool))
			continue
		}
		stored++
	}
	if stored > 0 {
		reqCopy := *req
		go func() {
			state, description := policyStatusFor(buildPolicyCheckSummary(reqCopy.ID))
			publishRequestCommitStatus(&reqCopy, policyStatusContext, state, description)
		}()
	}
	return problems
}
