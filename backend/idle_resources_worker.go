package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"
)

// runIdleScan orchestrates one scan end-to-end. It runs in its own goroutine
// (one per scan), updates progress in the DB so the UI can poll, and finalises
// totals + AI ranking on completion. Failures bubble into the scan record so
// they remain visible long after the goroutine exits.
func runIdleScan(scanID, accountID, actorID int) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	now := time.Now()
	startUpd := scanUpdate{Status: stringPtr("running"), StartedAt: &now}
	if err := updateIdleScan(ctx, scanID, startUpd); err != nil {
		log.Printf("idle-scan %d: failed to mark running: %v", scanID, err)
		return
	}

	scan, err := getIdleScan(ctx, scanID)
	if err != nil || scan == nil {
		log.Printf("idle-scan %d: lookup failed: %v", scanID, err)
		_ = setScanCompletion(ctx, scanID, nil, "failed", "scan record missing")
		return
	}
	account, err := getCloudAccount(ctx, accountID)
	if err != nil || account == nil {
		_ = setScanCompletion(ctx, scanID, nil, "failed", "cloud account missing")
		return
	}
	creds, err := loadCloudCredentials(ctx, accountID)
	if err != nil {
		_ = setScanCompletion(ctx, scanID, nil, "failed", "decrypt credentials: "+err.Error())
		return
	}

	thresholds := defaultIdleThresholds()
	if len(scan.Thresholds) > 0 {
		_ = json.Unmarshal(scan.Thresholds, &thresholds)
	}

	progress := map[string]any{}
	progressMu := sync.Mutex{}
	push := func(region, service string, count int) {
		progressMu.Lock()
		defer progressMu.Unlock()
		progress[fmt.Sprintf("%s/%s", region, service)] = count
		body, _ := json.Marshal(progress)
		_ = updateIdleScan(ctx, scanID, scanUpdate{Progress: body})
	}

	var (
		resources []IdleResource
		errs      []scanError
	)
	switch account.Cloud {
	case "aws":
		resources, errs = scanAWSAccount(ctx, *account, creds, scan.Regions, scan.Scope, thresholds, push)
	case "azure":
		resources, errs = scanAzureAccount(ctx, *account, creds, scan.Regions, scan.Scope, thresholds, push)
	case "gcp":
		resources, errs = scanGCPAccount(ctx, *account, creds, scan.Regions, scan.Scope, thresholds, push)
	default:
		_ = setScanCompletion(ctx, scanID, nil, "failed", "unsupported cloud: "+account.Cloud)
		return
	}

	if exceptions, err := loadExceptionSet(ctx, accountID); err == nil {
		resources = applyExceptionsFilter(resources, exceptions)
	}

	if err := insertIdleResources(ctx, scanID, accountID, account.Cloud, resources); err != nil {
		log.Printf("idle-scan %d: insert resources: %v", scanID, err)
	}

	totals := map[string]any{
		"resources_found":   len(resources),
		"monthly_waste_usd": sumMonthlyCost(resources),
		"by_service":        groupByService(resources),
	}
	if errBody, _ := json.Marshal(errs); len(errs) > 0 {
		_ = updateIdleScan(ctx, scanID, scanUpdate{ErrorLog: errBody})
	}

	if rawURL := uploadIdleScanArtifact(scanID, account.Cloud, resources, errs); rawURL != "" {
		_ = updateIdleScan(ctx, scanID, scanUpdate{RawArtifactURL: &rawURL})
	}

	provider := scan.AIProvider
	model := scan.AIModel
	if provider == "" {
		provider = account.AIProvider
	}
	if model == "" {
		model = account.AIModel
	}
	if provider == "" {
		settings, _ := getIdleSettings(ctx)
		provider = settings.DefaultAIProvider
		if model == "" {
			model = settings.DefaultAIModel
		}
	}

	freshResources, err := listIdleResourcesByScan(ctx, scanID, resourceFilters{Limit: 5000})
	if err != nil {
		log.Printf("idle-scan %d: reload resources: %v", scanID, err)
	}
	if ranks, err := rankIdleResources(ctx, scanID, provider, model, freshResources, actorID); err != nil {
		log.Printf("idle-scan %d: ai ranking failed: %v", scanID, err)
		_ = applyAIRanksToResources(ctx, scanID, ranks)
	} else {
		_ = applyAIRanksToResources(ctx, scanID, ranks)
	}

	finalStatus := "complete"
	if len(errs) > 0 {
		finalStatus = "complete_with_errors"
	}
	_ = setScanCompletion(ctx, scanID, totals, finalStatus, "")
	writeIdleAudit(ctx, accountID, scanID, actorID, "scan_completed", totals)
}

func sumMonthlyCost(resources []IdleResource) float64 {
	total := 0.0
	for _, r := range resources {
		total += r.CostEstimateUSD
	}
	return total
}

func groupByService(resources []IdleResource) map[string]map[string]any {
	grouped := map[string]map[string]any{}
	for _, r := range resources {
		bucket, ok := grouped[r.Service]
		if !ok {
			bucket = map[string]any{"count": 0, "monthly_usd": 0.0}
		}
		bucket["count"] = bucket["count"].(int) + 1
		bucket["monthly_usd"] = bucket["monthly_usd"].(float64) + r.CostEstimateUSD
		grouped[r.Service] = bucket
	}
	return grouped
}

func stringPtr(s string) *string { return &s }
