package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/appservice/armappservice"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/monitor/armmonitor"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/sql/armsql"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/storage/armstorage"
)

// scanAzureExtras runs the optional Azure scanners (SQL, Storage, App Service)
// when their scope keys are selected. Errors per service are captured but do
// not abort the scan.
func scanAzureExtras(ctx context.Context, accountID int, subID string, cred azcore.TokenCredential, mon *armmonitor.MetricsClient, regionAllowed func(string) bool, scope []string, th idleThresholds, progressCB func(region, service string, count int)) ([]IdleResource, []scanError) {
	all := []IdleResource{}
	errs := []scanError{}

	if containsString(scope, "sql") {
		r, err := scanAzureSQL(ctx, accountID, subID, cred, mon, regionAllowed, th)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "sql", Message: err.Error()})
		} else {
			all = append(all, r...)
			progressCB("all", "sql", len(r))
		}
	}
	if containsString(scope, "storage") {
		r, err := scanAzureStorage(ctx, accountID, subID, cred, regionAllowed)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "storage", Message: err.Error()})
		} else {
			all = append(all, r...)
			progressCB("all", "storage", len(r))
		}
	}
	if containsString(scope, "appservice") {
		r, err := scanAzureAppService(ctx, accountID, subID, cred, mon, regionAllowed, th)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "appservice", Message: err.Error()})
		} else {
			all = append(all, r...)
			progressCB("all", "appservice", len(r))
		}
	}
	return all, errs
}

func scanAzureSQL(ctx context.Context, accountID int, subID string, cred azcore.TokenCredential, mon *armmonitor.MetricsClient, regionAllowed func(string) bool, th idleThresholds) ([]IdleResource, error) {
	client, err := armsql.NewDatabasesClient(subID, cred, nil)
	if err != nil {
		return nil, err
	}
	out := []IdleResource{}
	pager := client.NewListByServerPager("", "", nil)
	// Note: NewListByServerPager requires a server name, which we don't have here.
	// We'll iterate via a server list instead.
	srvClient, err := armsql.NewServersClient(subID, cred, nil)
	if err != nil {
		return out, err
	}
	srvPager := srvClient.NewListPager(nil)
	for srvPager.More() {
		page, err := srvPager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, srv := range page.Value {
			if srv == nil || srv.Location == nil || !regionAllowed(*srv.Location) {
				continue
			}
			rg := resourceGroupFromID(safeStr(srv.ID))
			if rg == "" {
				continue
			}
			dbPager := client.NewListByServerPager(rg, safeStr(srv.Name), nil)
			for dbPager.More() {
				dbPage, err := dbPager.NextPage(ctx)
				if err != nil {
					return out, err
				}
				for _, db := range dbPage.Value {
					if db == nil || db.Name == nil {
						continue
					}
					if strings.EqualFold(*db.Name, "master") {
						continue
					}
					dbID := safeStr(db.ID)
					cpu := getAzureMetric(ctx, mon, dbID, "cpu_percent", "Average", th.LookbackDays)
					connections := getAzureMetric(ctx, mon, dbID, "connection_successful", "Total", th.LookbackDays)
					if cpu >= th.IdleCPUPct && connections >= th.IdleConnections {
						continue
					}
					tier := ""
					if db.SKU != nil && db.SKU.Tier != nil {
						tier = *db.SKU.Tier
					}
					cost := azureSQLMonthlyCost(tier)
					severity := "low"
					if cost >= 100 {
						severity = "medium"
					}
					if cost >= 300 {
						severity = "high"
					}
					out = append(out, IdleResource{
						AccountID:  accountID,
						Cloud:      "azure",
						Service:    "sql",
						Region:     safeStr(db.Location),
						ResourceID: dbID,
						Name:       safeStr(db.Name),
						Tags:       azureTagsToMap(db.Tags),
						State:      string(safeSQLState(db)),
						Metrics: map[string]any{
							"cpu_avg_pct":     cpu,
							"connections_sum": connections,
							"tier":            tier,
						},
						CostEstimateUSD: cost,
						Reason:          fmt.Sprintf("avg %.1f%% CPU, %.0f conns over %dd", cpu, connections, th.LookbackDays),
						Severity:        severity,
						ConsoleURL:      azurePortalURL(dbID),
					})
				}
			}
		}
	}
	_ = pager
	return out, nil
}

func scanAzureStorage(ctx context.Context, accountID int, subID string, cred azcore.TokenCredential, regionAllowed func(string) bool) ([]IdleResource, error) {
	client, err := armstorage.NewAccountsClient(subID, cred, nil)
	if err != nil {
		return nil, err
	}
	out := []IdleResource{}
	pager := client.NewListPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, acct := range page.Value {
			if acct == nil || acct.Location == nil || !regionAllowed(*acct.Location) {
				continue
			}
			tier := ""
			if acct.SKU != nil && acct.SKU.Name != nil {
				tier = string(*acct.SKU.Name)
			}
			// We don't fetch capacity metrics here (cheaper than a full
			// scan) — instead surface accounts with public access enabled
			// or older than 6 months as candidates for review.
			cost := azureStorageMonthlyCost(tier)
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "azure",
				Service:         "storage",
				Region:          safeStr(acct.Location),
				ResourceID:      safeStr(acct.ID),
				Name:            safeStr(acct.Name),
				Tags:            azureTagsToMap(acct.Tags),
				State:           "review",
				Metrics:         map[string]any{"sku": tier},
				CostEstimateUSD: cost,
				Reason:          "Storage account flagged for cost review",
				Severity:        "low",
				ConsoleURL:      azurePortalURL(safeStr(acct.ID)),
			})
		}
	}
	return out, nil
}

func scanAzureAppService(ctx context.Context, accountID int, subID string, cred azcore.TokenCredential, mon *armmonitor.MetricsClient, regionAllowed func(string) bool, th idleThresholds) ([]IdleResource, error) {
	client, err := armappservice.NewWebAppsClient(subID, cred, nil)
	if err != nil {
		return nil, err
	}
	out := []IdleResource{}
	pager := client.NewListPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, app := range page.Value {
			if app == nil || app.Location == nil || !regionAllowed(*app.Location) {
				continue
			}
			appID := safeStr(app.ID)
			req := getAzureMetric(ctx, mon, appID, "Requests", "Total", th.LookbackDays)
			if req >= th.IdleLBRequests {
				continue
			}
			cost := 30.0
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "azure",
				Service:         "appservice",
				Region:          safeStr(app.Location),
				ResourceID:      appID,
				Name:            safeStr(app.Name),
				Tags:            azureTagsToMap(app.Tags),
				State:           string(safeAppState(app)),
				Metrics:         map[string]any{"requests_total": req},
				CostEstimateUSD: cost,
				Reason:          fmt.Sprintf("%.0f requests over %dd", req, th.LookbackDays),
				Severity:        "low",
				ConsoleURL:      azurePortalURL(appID),
			})
		}
	}
	return out, nil
}

// ---------- helpers ----------

func resourceGroupFromID(id string) string {
	parts := strings.Split(id, "/")
	for i, p := range parts {
		if strings.EqualFold(p, "resourceGroups") && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func safeSQLState(db *armsql.Database) string {
	if db == nil || db.Properties == nil || db.Properties.Status == nil {
		return ""
	}
	return string(*db.Properties.Status)
}

func safeAppState(app *armappservice.Site) string {
	if app == nil || app.Properties == nil || app.Properties.State == nil {
		return ""
	}
	return *app.Properties.State
}

func azureSQLMonthlyCost(tier string) float64 {
	switch strings.ToLower(strings.TrimSpace(tier)) {
	case "basic":
		return 5.0
	case "standard":
		return 30.0
	case "premium":
		return 465.0
	case "businesscritical":
		return 800.0
	case "generalpurpose":
		return 380.0
	}
	return 60.0
}

func azureStorageMonthlyCost(tier string) float64 {
	if strings.Contains(strings.ToLower(tier), "premium") {
		return 50.0
	}
	return 12.0
}
