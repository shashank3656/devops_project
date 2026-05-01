package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	gcs "cloud.google.com/go/storage"
	compute "cloud.google.com/go/compute/apiv1"
	"cloud.google.com/go/compute/apiv1/computepb"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"google.golang.org/api/sqladmin/v1"
)

// scanGCPExtras runs the optional GCP scanners. Errors per service are
// captured in the returned slice rather than aborting the scan.
func scanGCPExtras(ctx context.Context, account CloudAccount, project string, opts []option.ClientOption, regionAllowed func(string) bool, scope []string, progressCB func(region, service string, count int)) ([]IdleResource, []scanError) {
	all := []IdleResource{}
	errs := []scanError{}

	if containsString(scope, "cloudsql") {
		r, err := scanGCPCloudSQL(ctx, account.ID, project, opts, regionAllowed)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "cloudsql", Message: err.Error()})
		} else {
			all = append(all, r...)
			progressCB("all", "cloudsql", len(r))
		}
	}
	if containsString(scope, "storage") {
		r, err := scanGCPStorage(ctx, account.ID, project, opts)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "storage", Message: err.Error()})
		} else {
			all = append(all, r...)
			progressCB("all", "storage", len(r))
		}
	}
	if containsString(scope, "loadbalancer") {
		r, err := scanGCPLoadBalancers(ctx, account.ID, project, opts, regionAllowed)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "loadbalancer", Message: err.Error()})
		} else {
			all = append(all, r...)
			progressCB("all", "loadbalancer", len(r))
		}
	}
	return all, errs
}

func scanGCPCloudSQL(ctx context.Context, accountID int, project string, opts []option.ClientOption, regionAllowed func(string) bool) ([]IdleResource, error) {
	svc, err := sqladmin.NewService(ctx, opts...)
	if err != nil {
		return nil, err
	}
	out := []IdleResource{}
	resp, err := svc.Instances.List(project).Do()
	if err != nil {
		return out, err
	}
	for _, inst := range resp.Items {
		if inst == nil || !regionAllowed(inst.Region) {
			continue
		}
		state := strings.ToLower(inst.State)
		// Surface stopped + suspended instances; running ones could be
		// added once we wire monitoring metrics for them.
		if state == "runnable" || state == "running" {
			continue
		}
		tier := inst.Settings.Tier
		cost := gcpCloudSQLMonthlyCost(tier)
		severity := "low"
		if cost >= 100 {
			severity = "medium"
		}
		if cost >= 300 {
			severity = "high"
		}
		out = append(out, IdleResource{
			AccountID:       accountID,
			Cloud:           "gcp",
			Service:         "cloudsql",
			Region:          inst.Region,
			ResourceID:      inst.SelfLink,
			Name:            inst.Name,
			Tags:            map[string]string{},
			State:           state,
			Metrics:         map[string]any{"tier": tier, "database_version": inst.DatabaseVersion},
			CostEstimateUSD: cost,
			Reason:          "Cloud SQL instance not in running state",
			Severity:        severity,
			ConsoleURL:      fmt.Sprintf("https://console.cloud.google.com/sql/instances/%s/overview?project=%s", inst.Name, project),
		})
	}
	return out, nil
}

func scanGCPStorage(ctx context.Context, accountID int, project string, opts []option.ClientOption) ([]IdleResource, error) {
	client, err := gcs.NewClient(ctx, opts...)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	stale := time.Now().AddDate(0, -6, 0)
	out := []IdleResource{}
	it := client.Buckets(ctx, project)
	for {
		b, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return out, err
		}
		if b == nil || b.Created.IsZero() || b.Created.After(stale) {
			continue
		}
		// Probe whether the bucket is empty - empty + old is the cleanest
		// candidate. We don't iterate the full object list; LIMIT 1.
		objIt := client.Bucket(b.Name).Objects(ctx, nil)
		_, err = objIt.Next()
		if err == nil {
			continue // has at least one object
		}
		out = append(out, IdleResource{
			AccountID:       accountID,
			Cloud:           "gcp",
			Service:         "storage",
			Region:          strings.ToLower(b.Location),
			ResourceID:      "gs://" + b.Name,
			Name:            b.Name,
			Tags:            b.Labels,
			State:           "empty",
			CreatedAtRemote: &b.Created,
			Metrics:         map[string]any{"location": b.Location, "storage_class": b.StorageClass},
			CostEstimateUSD: 0.5,
			Reason:          "Empty bucket older than 6 months",
			Severity:        "low",
			ConsoleURL:      fmt.Sprintf("https://console.cloud.google.com/storage/browser/%s?project=%s", b.Name, project),
		})
	}
	return out, nil
}

func scanGCPLoadBalancers(ctx context.Context, accountID int, project string, opts []option.ClientOption, regionAllowed func(string) bool) ([]IdleResource, error) {
	client, err := compute.NewForwardingRulesRESTClient(ctx, opts...)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	out := []IdleResource{}
	it := client.AggregatedList(ctx, &computepb.AggregatedListForwardingRulesRequest{Project: project})
	for {
		pair, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return out, err
		}
		region := strings.TrimPrefix(pair.Key, "regions/")
		if !regionAllowed(region) {
			continue
		}
		if pair.Value == nil {
			continue
		}
		for _, fr := range pair.Value.ForwardingRules {
			if fr == nil {
				continue
			}
			// Treat forwarding rules with empty backend service as
			// candidates worth reviewing.
			backend := gcpStr(fr.Target)
			if backend == "" {
				backend = gcpStr(fr.BackendService)
			}
			if backend != "" {
				continue
			}
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "gcp",
				Service:         "loadbalancer",
				Region:          region,
				ResourceID:      gcpStr(fr.SelfLink),
				Name:            gcpStr(fr.Name),
				Tags:            map[string]string{},
				State:           "no-backend",
				Metrics:         map[string]any{"ip_address": gcpStr(fr.IPAddress)},
				CostEstimateUSD: 18.0,
				Reason:          "Forwarding rule with no active backend",
				Severity:        "low",
				ConsoleURL:      fmt.Sprintf("https://console.cloud.google.com/net-services/loadbalancing/list?project=%s", project),
			})
		}
	}
	return out, nil
}

// ---------- pricing helpers ----------

func gcpCloudSQLMonthlyCost(tier string) float64 {
	tlc := strings.ToLower(tier)
	switch {
	case strings.Contains(tlc, "db-f1-micro"):
		return 8.0
	case strings.Contains(tlc, "db-g1-small"):
		return 26.0
	case strings.Contains(tlc, "db-n1-standard-1"):
		return 50.0
	case strings.Contains(tlc, "db-n1-standard-2"):
		return 100.0
	case strings.Contains(tlc, "db-n1-standard-4"):
		return 200.0
	case strings.Contains(tlc, "db-n1-highmem"):
		return 250.0
	}
	return 60.0
}
