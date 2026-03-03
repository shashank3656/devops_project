package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type CostRiskSignal struct {
	Severity string `json:"severity"`
	Category string `json:"category"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`
}

type CostRiskPreview struct {
	CostLink         string           `json:"cost_link"`
	EstimatedBand    string           `json:"estimated_band"`
	EstimatedMonthly string           `json:"estimated_monthly"`
	EstimateBasis    string           `json:"estimate_basis"`
	RiskLevel        string           `json:"risk_level"`
	Summary          string           `json:"summary"`
	Signals          []CostRiskSignal `json:"signals"`
}

type ProjectCostRiskSummary struct {
	OverallRisk        string           `json:"overall_risk"`
	EstimatedBand      string           `json:"estimated_band"`
	EstimatedMonthly   string           `json:"estimated_monthly"`
	EstimateBasis      string           `json:"estimate_basis"`
	Summary            string           `json:"summary"`
	RequestCount       int              `json:"request_count"`
	PendingReviewCount int              `json:"pending_review_count"`
	HighRiskCount      int              `json:"high_risk_count"`
	MediumRiskCount    int              `json:"medium_risk_count"`
	Signals            []CostRiskSignal `json:"signals"`
}

type previewFlags struct {
	sensitive          bool
	publicExposure     bool
	openIngress        bool
	broadIAM           bool
	encryptionDisabled bool
}

func getCostCalculatorLink(cloud, service string) string {
	normalizedCloud := strings.ToLower(strings.TrimSpace(cloud))
	normalizedService := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(service), " ", "-"))
	switch normalizedCloud {
	case "aws":
		if normalizedService != "" {
			return "https://calculator.aws/#/estimate?service=" + normalizedService
		}
		return "https://calculator.aws/"
	case "gcp":
		return "https://cloud.google.com/products/calculator"
	case "azure":
		return "https://azure.microsoft.com/en-us/pricing/calculator/"
	default:
		return "https://calculator.aws/"
	}
}

func estimateCostFootprint(cloud, service, env, priority string) (band string, monthly string, basis string) {
	score := 1
	serviceKey := strings.ToLower(strings.TrimSpace(service))
	envKey := strings.ToLower(strings.TrimSpace(env))
	priorityKey := strings.ToLower(strings.TrimSpace(priority))

	switch {
	case strings.Contains(serviceKey, "eks"),
		strings.Contains(serviceKey, "gke"),
		strings.Contains(serviceKey, "aks"),
		strings.Contains(serviceKey, "kubernetes"),
		strings.Contains(serviceKey, "cluster"),
		strings.Contains(serviceKey, "redshift"),
		strings.Contains(serviceKey, "bigquery"),
		strings.Contains(serviceKey, "databricks"),
		strings.Contains(serviceKey, "kafka"),
		strings.Contains(serviceKey, "spark"):
		score += 4
	case strings.Contains(serviceKey, "rds"),
		strings.Contains(serviceKey, "sql"),
		strings.Contains(serviceKey, "postgres"),
		strings.Contains(serviceKey, "mysql"),
		strings.Contains(serviceKey, "oracle"),
		strings.Contains(serviceKey, "elasticache"),
		strings.Contains(serviceKey, "redis"),
		strings.Contains(serviceKey, "search"),
		strings.Contains(serviceKey, "mongodb"):
		score += 3
	case strings.Contains(serviceKey, "ec2"),
		strings.Contains(serviceKey, "vm"),
		strings.Contains(serviceKey, "compute"),
		strings.Contains(serviceKey, "app"),
		strings.Contains(serviceKey, "lambda"),
		strings.Contains(serviceKey, "function"),
		strings.Contains(serviceKey, "container"):
		score += 2
	case strings.Contains(serviceKey, "storage"),
		strings.Contains(serviceKey, "bucket"),
		strings.Contains(serviceKey, "queue"),
		strings.Contains(serviceKey, "secret"),
		strings.Contains(serviceKey, "iam"),
		strings.Contains(serviceKey, "dns"),
		strings.Contains(serviceKey, "cdn"):
		score += 1
	}

	switch envKey {
	case "prod", "production":
		score += 2
	case "staging", "stage", "qa":
		score += 1
	}

	switch priorityKey {
	case "critical":
		score += 2
	case "high":
		score += 1
	}

	switch {
	case score <= 2:
		return "Low", "$25-$100/mo", "Lightweight service footprint"
	case score == 3:
		return "Moderate", "$100-$400/mo", "Standard runtime with moderate infra usage"
	case score <= 5:
		return "Elevated", "$400-$1.5k/mo", "Stateful or scaled service footprint"
	default:
		return "High", "$1.5k+/mo", "Production-scale platform or data workload"
	}
}

func BuildCostRiskPreview(req *PRRequest) *CostRiskPreview {
	if req == nil {
		return nil
	}

	band, monthly, basis := estimateCostFootprint(req.Cloud, req.Service, req.Env, req.Priority)
	signals := collectCostRiskSignals(req)
	riskLevel := deriveRiskLevel(signals)
	summary := buildCostRiskSummary(riskLevel, len(signals), req)

	return &CostRiskPreview{
		CostLink:         getCostCalculatorLink(req.Cloud, req.Service),
		EstimatedBand:    band,
		EstimatedMonthly: monthly,
		EstimateBasis:    basis,
		RiskLevel:        riskLevel,
		Summary:          summary,
		Signals:          signals,
	}
}

func BuildProjectCostRiskSummary(project *ProjectCatalog, requests []PRRequest) *ProjectCostRiskSummary {
	if project == nil {
		return nil
	}

	previews := make([]*CostRiskPreview, 0, len(requests))
	pendingReviewCount := 0
	highRiskCount := 0
	mediumRiskCount := 0
	highestBandRank := 0

	for index := range requests {
		req := requests[index]
		preview := BuildCostRiskPreview(&req)
		if preview == nil {
			continue
		}
		previews = append(previews, preview)
		if isPendingReviewStatus(req.Status) {
			pendingReviewCount++
		}
		switch preview.RiskLevel {
		case "high":
			highRiskCount++
		case "medium":
			mediumRiskCount++
		}
		if rank := costBandRank(preview.EstimatedBand); rank > highestBandRank {
			highestBandRank = rank
		}
	}

	estimateBasis := fmt.Sprintf("Based on %d tracked request%s in this project.", len(requests), map[bool]string{true: "", false: "s"}[len(requests) == 1])
	if len(previews) == 0 {
		previews = buildCatalogDerivedProjectPreviews(project)
		estimateBasis = "No request history yet. Summary is inferred from the configured project service catalog."
		for _, preview := range previews {
			if rank := costBandRank(preview.EstimatedBand); rank > highestBandRank {
				highestBandRank = rank
			}
		}
	}
	if len(previews) == 0 {
		return nil
	}

	overallRisk := "low"
	signalCounts := make(map[string]int, len(previews)*2)
	signalMeta := make(map[string]CostRiskSignal, len(previews)*2)
	for _, preview := range previews {
		if riskLevelRank(preview.RiskLevel) > riskLevelRank(overallRisk) {
			overallRisk = preview.RiskLevel
		}
		for _, signal := range preview.Signals {
			key := signal.Category + "::" + signal.Title
			signalCounts[key]++
			existing, ok := signalMeta[key]
			if !ok || signalSeverityRank(signal.Severity) > signalSeverityRank(existing.Severity) {
				signalMeta[key] = signal
			}
		}
	}

	type signalCount struct {
		key   string
		count int
	}
	orderedSignals := make([]signalCount, 0, len(signalCounts))
	for key, count := range signalCounts {
		orderedSignals = append(orderedSignals, signalCount{key: key, count: count})
	}
	sort.Slice(orderedSignals, func(i, j int) bool {
		if orderedSignals[i].count == orderedSignals[j].count {
			left := signalMeta[orderedSignals[i].key]
			right := signalMeta[orderedSignals[j].key]
			if signalSeverityRank(left.Severity) == signalSeverityRank(right.Severity) {
				return left.Title < right.Title
			}
			return signalSeverityRank(left.Severity) > signalSeverityRank(right.Severity)
		}
		return orderedSignals[i].count > orderedSignals[j].count
	})

	signals := make([]CostRiskSignal, 0, 4)
	for _, entry := range orderedSignals {
		if len(signals) >= 4 {
			break
		}
		signal := signalMeta[entry.key]
		signal.Detail = fmt.Sprintf("Observed in %d project request%s or derived service checks.", entry.count, map[bool]string{true: "", false: "s"}[entry.count == 1])
		signals = append(signals, signal)
	}
	if len(signals) == 0 {
		signals = append(signals, CostRiskSignal{
			Severity: "low",
			Category: "baseline",
			Title:    "No major risk signals",
			Detail:   "Current project scope does not trigger major heuristic warnings, but ownership and rollout review should still happen.",
		})
	}

	estimatedBand, estimatedMonthly := costBandFromRank(highestBandRank)
	if estimatedBand == "" {
		estimatedBand = "Low"
		estimatedMonthly = "$25-$100/mo"
	}

	summary := fmt.Sprintf(
		"%d tracked request%s, %d pending review, %d high-risk workload%s. Highest observed cost band is %s.",
		len(requests),
		map[bool]string{true: "", false: "s"}[len(requests) == 1],
		pendingReviewCount,
		highRiskCount,
		map[bool]string{true: "", false: "s"}[highRiskCount == 1],
		estimatedBand,
	)
	if len(requests) == 0 {
		summary = fmt.Sprintf("No request history yet. Current risk is inferred from the configured service catalog, with %s as the highest estimated workload band.", estimatedBand)
	}

	return &ProjectCostRiskSummary{
		OverallRisk:        overallRisk,
		EstimatedBand:      estimatedBand,
		EstimatedMonthly:   estimatedMonthly,
		EstimateBasis:      estimateBasis,
		Summary:            summary,
		RequestCount:       len(requests),
		PendingReviewCount: pendingReviewCount,
		HighRiskCount:      highRiskCount,
		MediumRiskCount:    mediumRiskCount,
		Signals:            signals,
	}
}

func CanUserSeePortalCostRiskPreview(userID int) bool {
	if userID <= 0 {
		return false
	}
	user, _ := GetUserByID(userID)
	if user != nil && user.IsPortalManager {
		return true
	}
	teams, _ := GetPortalTeamsManagedByUser(userID)
	if len(teams) > 0 {
		return true
	}
	reportees, _ := GetReporteeUserIDs(userID)
	return len(reportees) > 0
}

func collectCostRiskSignals(req *PRRequest) []CostRiskSignal {
	signals := make([]CostRiskSignal, 0, 8)
	appendSignal := func(severity, category, title, detail string) {
		for _, existing := range signals {
			if existing.Title == title {
				return
			}
		}
		signals = append(signals, CostRiskSignal{
			Severity: severity,
			Category: category,
			Title:    title,
			Detail:   detail,
		})
	}

	envKey := strings.ToLower(strings.TrimSpace(req.Env))
	serviceKey := strings.ToLower(strings.TrimSpace(req.Service))
	priorityKey := strings.ToLower(strings.TrimSpace(req.Priority))

	if envKey == "prod" || envKey == "production" {
		appendSignal("high", "environment", "Production target", "This request targets production infrastructure, so approval should verify blast radius and rollback readiness.")
	}

	switch priorityKey {
	case "critical":
		appendSignal("high", "delivery", "Critical priority", "Critical requests compress review time and increase the chance of rushed approval decisions.")
	case "high":
		appendSignal("medium", "delivery", "High priority", "High-priority work should confirm rollback and ownership before approval.")
	}

	if req.DueDate != nil {
		now := time.Now()
		switch {
		case req.DueDate.Before(now):
			appendSignal("high", "delivery", "Past due date", "The requested due date has already passed, which usually indicates approval pressure or a planning gap.")
		case req.DueDate.Before(now.Add(24 * time.Hour)):
			appendSignal("medium", "delivery", "Due within 24 hours", "The request is due soon, so confirm the implementation path is stable before approving.")
		}
	}

	switch {
	case strings.Contains(serviceKey, "rds"),
		strings.Contains(serviceKey, "sql"),
		strings.Contains(serviceKey, "postgres"),
		strings.Contains(serviceKey, "mysql"),
		strings.Contains(serviceKey, "redis"),
		strings.Contains(serviceKey, "search"),
		strings.Contains(serviceKey, "redshift"),
		strings.Contains(serviceKey, "bigquery"):
		appendSignal("medium", "data", "Stateful service", "Database or analytics services typically carry data durability, backup, and migration risk.")
	case strings.Contains(serviceKey, "eks"),
		strings.Contains(serviceKey, "gke"),
		strings.Contains(serviceKey, "aks"),
		strings.Contains(serviceKey, "kubernetes"),
		strings.Contains(serviceKey, "cluster"):
		appendSignal("medium", "platform", "Cluster workload", "Cluster-level services usually affect networking, scaling, and workload scheduling across multiple components.")
	}

	flags := inspectPreviewConfig(req.Config)
	if flags.sensitive {
		appendSignal("medium", "secrets", "Sensitive configuration detected", "The request payload contains secret-like keys, so verify masking, storage, and ownership before approval.")
	}
	if flags.publicExposure {
		appendSignal("high", "exposure", "Public exposure enabled", "The request appears to enable public or internet-facing access.")
	}
	if flags.openIngress {
		appendSignal("high", "network", "Open ingress rule", "The payload includes a wide-open network rule such as 0.0.0.0/0 or ::/0.")
	}
	if flags.broadIAM {
		appendSignal("high", "identity", "Broad IAM scope", "The request appears to grant wildcard actions, admin-level roles, or overly broad principals.")
	}
	if flags.encryptionDisabled {
		appendSignal("medium", "security", "Encryption disabled", "The configuration suggests encryption or transport security is disabled.")
	}

	plan := strings.ToLower(strings.TrimSpace(req.TerraformPlanOutput))
	switch {
	case strings.Contains(plan, "will be destroyed"),
		strings.Contains(plan, "must be replaced"),
		strings.Contains(plan, "destroy and then create replacement"),
		strings.Contains(plan, "-/+"):
		appendSignal("high", "change", "Destructive Terraform plan", "The Terraform output suggests replacement or destruction of existing resources.")
	case strings.Contains(plan, "warning:"),
		strings.Contains(plan, "error:"):
		appendSignal("medium", "change", "Terraform warnings present", "The Terraform output contains warnings or errors that should be reviewed before approval.")
	}

	return signals
}

func inspectPreviewConfig(raw string) previewFlags {
	flags := previewFlags{}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return flags
	}

	var value interface{}
	if err := json.Unmarshal([]byte(trimmed), &value); err != nil {
		inspectPreviewText(trimmed, &flags)
		return flags
	}

	walkPreviewValue("", value, &flags)
	return flags
}

func walkPreviewValue(path string, value interface{}, flags *previewFlags) {
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, item := range typed {
			nextPath := strings.ToLower(key)
			if path != "" {
				nextPath = path + "." + nextPath
			}
			inspectPreviewPair(nextPath, item, flags)
			walkPreviewValue(nextPath, item, flags)
		}
	case []interface{}:
		for _, item := range typed {
			walkPreviewValue(path, item, flags)
		}
	case string:
		inspectPreviewText(typed, flags)
	case bool:
		inspectPreviewBool(path, typed, flags)
	default:
		inspectPreviewText(fmt.Sprint(typed), flags)
	}
}

func inspectPreviewPair(path string, value interface{}, flags *previewFlags) {
	lowerPath := strings.ToLower(path)
	if isSecretLikeKey(lowerPath) {
		flags.sensitive = true
	}

	switch typed := value.(type) {
	case bool:
		inspectPreviewBool(lowerPath, typed, flags)
	case string:
		lowerValue := strings.ToLower(strings.TrimSpace(typed))
		if (strings.Contains(lowerPath, "public") || strings.Contains(lowerPath, "internet") || strings.Contains(lowerPath, "exposure")) &&
			(lowerValue == "true" || lowerValue == "enabled" || lowerValue == "yes") {
			flags.publicExposure = true
		}
		if (strings.Contains(lowerPath, "encrypt") || strings.Contains(lowerPath, "kms") || strings.Contains(lowerPath, "ssl")) &&
			(lowerValue == "false" || lowerValue == "disabled" || lowerValue == "none") {
			flags.encryptionDisabled = true
		}
		if (strings.Contains(lowerPath, "action") || strings.Contains(lowerPath, "principal") || strings.Contains(lowerPath, "role") || strings.Contains(lowerPath, "policy")) &&
			(strings.Contains(lowerValue, "*") || strings.Contains(lowerValue, "administrator") || strings.Contains(lowerValue, "owner")) {
			flags.broadIAM = true
		}
		if strings.Contains(lowerPath, "cidr") || strings.Contains(lowerPath, "ingress") || strings.Contains(lowerPath, "source_range") {
			if strings.Contains(lowerValue, "0.0.0.0/0") || strings.Contains(lowerValue, "::/0") {
				flags.openIngress = true
			}
		}
	}
}

func inspectPreviewBool(path string, value bool, flags *previewFlags) {
	if value && (strings.Contains(path, "public") || strings.Contains(path, "internet") || strings.Contains(path, "exposure") || strings.Contains(path, "assign_public_ip")) {
		flags.publicExposure = true
	}
	if !value && (strings.Contains(path, "encrypt") || strings.Contains(path, "kms") || strings.Contains(path, "ssl")) {
		flags.encryptionDisabled = true
	}
}

func inspectPreviewText(value string, flags *previewFlags) {
	lower := strings.ToLower(value)
	if strings.Contains(lower, "0.0.0.0/0") || strings.Contains(lower, "::/0") {
		flags.openIngress = true
	}
	if strings.Contains(lower, "\"public\"") || strings.Contains(lower, "publicly_accessible") {
		flags.publicExposure = true
	}
	if strings.Contains(lower, "\"action\":\"*\"") || strings.Contains(lower, "\"action\": \"*\"") || strings.Contains(lower, "administratoraccess") {
		flags.broadIAM = true
	}
}

func isSecretLikeKey(path string) bool {
	lower := strings.ToLower(path)
	secretKeys := []string{
		"password",
		"secret",
		"token",
		"api_key",
		"apikey",
		"access_key",
		"secret_key",
		"private_key",
		"authorization",
	}
	for _, key := range secretKeys {
		if strings.Contains(lower, key) {
			return true
		}
	}
	return false
}

func deriveRiskLevel(signals []CostRiskSignal) string {
	maxScore := 0
	for _, signal := range signals {
		score := 1
		switch signal.Severity {
		case "high":
			score = 3
		case "medium":
			score = 2
		}
		if score > maxScore {
			maxScore = score
		}
	}

	switch {
	case maxScore >= 3:
		return "high"
	case maxScore == 2:
		return "medium"
	default:
		return "low"
	}
}

func buildCatalogDerivedProjectPreviews(project *ProjectCatalog) []*CostRiskPreview {
	if project == nil || len(project.Services) == 0 {
		return nil
	}
	representativeEnv := "dev"
	for _, environment := range project.Environments {
		switch environment {
		case "prod", "production":
			representativeEnv = environment
			goto build
		case "uat", "qa", "stage", "staging":
			representativeEnv = environment
		}
	}
build:
	previews := make([]*CostRiskPreview, 0, len(project.Services))
	for _, service := range project.Services {
		req := PRRequest{
			Env:      representativeEnv,
			Cloud:    service.Cloud,
			Service:  service.Service,
			Priority: "medium",
		}
		if preview := BuildCostRiskPreview(&req); preview != nil {
			previews = append(previews, preview)
		}
	}
	return previews
}

func signalSeverityRank(severity string) int {
	switch severity {
	case "high":
		return 3
	case "medium":
		return 2
	default:
		return 1
	}
}

func riskLevelRank(level string) int {
	switch level {
	case "high":
		return 3
	case "medium":
		return 2
	default:
		return 1
	}
}

func costBandRank(band string) int {
	switch strings.ToLower(strings.TrimSpace(band)) {
	case "high":
		return 4
	case "elevated":
		return 3
	case "moderate":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

func costBandFromRank(rank int) (band string, monthly string) {
	switch rank {
	case 4:
		return "High", "$1.5k+/mo"
	case 3:
		return "Elevated", "$400-$1.5k/mo"
	case 2:
		return "Moderate", "$100-$400/mo"
	case 1:
		return "Low", "$25-$100/mo"
	default:
		return "", ""
	}
}

func isPendingReviewStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "pending_approval", "pending_devops_approval", "pending_user_manager_approval":
		return true
	default:
		return false
	}
}

func buildCostRiskSummary(riskLevel string, signalCount int, req *PRRequest) string {
	switch {
	case signalCount == 0:
		return "No major risk heuristics were triggered. Review ownership, rollback, and service defaults before approval."
	case riskLevel == "high":
		return fmt.Sprintf("%d notable risk signals detected for this %s request. Review exposure, permissions, and rollout safety before approving.", signalCount, strings.TrimSpace(req.Service))
	case riskLevel == "medium":
		return fmt.Sprintf("%d review signals detected. Validate service defaults, data handling, and timing before approval.", signalCount)
	default:
		return fmt.Sprintf("%d low-severity review signal%s detected. Final approval should still verify expected cost and scope.", signalCount, map[bool]string{true: "", false: "s"}[signalCount == 1])
	}
}
