package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	compute "cloud.google.com/go/compute/apiv1"
	"cloud.google.com/go/compute/apiv1/computepb"
	monitoring "cloud.google.com/go/monitoring/apiv3/v2"
	"cloud.google.com/go/monitoring/apiv3/v2/monitoringpb"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
	"google.golang.org/genproto/googleapis/api/metric"
	monitoredres "google.golang.org/genproto/googleapis/api/monitoredres"
	durationpb "google.golang.org/protobuf/types/known/durationpb"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
)

// gcpClientOptions converts the user-provided credentials into the
// google.api option list. SA JSON and WIF JSON are both accepted as raw
// blobs; metadata uses the host's identity.
func gcpClientOptions(creds CloudCredentials) ([]option.ClientOption, error) {
	switch creds.AuthMethod {
	case "gcp_sa_json":
		if strings.TrimSpace(creds.GCPServiceAccountJSON) == "" {
			return nil, errors.New("gcp_service_account_json is empty")
		}
		return []option.ClientOption{option.WithCredentialsJSON([]byte(creds.GCPServiceAccountJSON))}, nil
	case "gcp_wif":
		if strings.TrimSpace(creds.GCPWIFConfig) == "" {
			return nil, errors.New("gcp_wif_config_json is empty")
		}
		return []option.ClientOption{option.WithCredentialsJSON([]byte(creds.GCPWIFConfig))}, nil
	case "gcp_metadata":
		return []option.ClientOption{}, nil
	default:
		return nil, fmt.Errorf("unsupported gcp auth_method: %s", creds.AuthMethod)
	}
}

func testGCPConnection(ctx context.Context, creds CloudCredentials) (string, error) {
	if strings.TrimSpace(creds.GCPProjectID) == "" {
		return "", errors.New("gcp_project_id required")
	}
	opts, err := gcpClientOptions(creds)
	if err != nil {
		return "", err
	}
	client, err := compute.NewInstancesRESTClient(ctx, opts...)
	if err != nil {
		return "", err
	}
	defer client.Close()
	// AggregatedList is a cheap probe across all zones.
	it := client.AggregatedList(ctx, &computepb.AggregatedListInstancesRequest{
		Project:    creds.GCPProjectID,
		MaxResults: ptrUint32(1),
	})
	if _, err := it.Next(); err != nil && !errors.Is(err, iterator.Done) {
		return "", err
	}
	return fmt.Sprintf("project=%s auth=%s", creds.GCPProjectID, creds.AuthMethod), nil
}

// scanGCPAccount runs Compute / Disks / Addresses scans. The GCP equivalent
// of regions are zones (compute uses zones for instances/disks, regions for
// addresses). We treat the user's regions slice as a region prefix filter.
func scanGCPAccount(ctx context.Context, account CloudAccount, creds CloudCredentials, regions []string, scope []string, thresholds idleThresholds, progressCB func(region, service string, count int)) ([]IdleResource, []scanError) {
	out := []IdleResource{}
	errs := []scanError{}
	if strings.TrimSpace(creds.GCPProjectID) == "" {
		return out, []scanError{{Region: "all", Service: "gcp", Message: "gcp_project_id missing"}}
	}
	opts, err := gcpClientOptions(creds)
	if err != nil {
		return out, []scanError{{Region: "all", Service: "gcp", Message: err.Error()}}
	}
	regionAllowed := func(zoneOrRegion string) bool {
		if len(regions) == 0 {
			return true
		}
		for _, r := range regions {
			r = strings.TrimSpace(r)
			if r == "" {
				continue
			}
			if strings.HasPrefix(zoneOrRegion, r) {
				return true
			}
		}
		return false
	}

	if containsString(scope, "compute") {
		r, err := scanGCPInstances(ctx, account.ID, creds.GCPProjectID, opts, regionAllowed, thresholds)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "compute", Message: err.Error()})
		} else {
			out = append(out, r...)
			progressCB("all", "compute", len(r))
		}
	}
	if containsString(scope, "disk") {
		r, err := scanGCPDisks(ctx, account.ID, creds.GCPProjectID, opts, regionAllowed)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "disk", Message: err.Error()})
		} else {
			out = append(out, r...)
			progressCB("all", "disk", len(r))
		}
	}
	if containsString(scope, "address") {
		r, err := scanGCPAddresses(ctx, account.ID, creds.GCPProjectID, opts, regionAllowed)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "address", Message: err.Error()})
		} else {
			out = append(out, r...)
			progressCB("all", "address", len(r))
		}
	}

	extras, extraErrs := scanGCPExtras(ctx, account, creds.GCPProjectID, opts, regionAllowed, scope, progressCB)
	out = append(out, extras...)
	errs = append(errs, extraErrs...)

	return out, errs
}

// ---------- service scanners ----------

func scanGCPInstances(ctx context.Context, accountID int, project string, opts []option.ClientOption, regionAllowed func(string) bool, th idleThresholds) ([]IdleResource, error) {
	client, err := compute.NewInstancesRESTClient(ctx, opts...)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	mon, monErr := monitoring.NewMetricClient(ctx, opts...)
	if monErr == nil {
		defer mon.Close()
	}

	out := []IdleResource{}
	it := client.AggregatedList(ctx, &computepb.AggregatedListInstancesRequest{Project: project})
	for {
		pair, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return out, err
		}
		zone := strings.TrimPrefix(pair.Key, "zones/")
		if !regionAllowed(zone) {
			continue
		}
		if pair.Value == nil {
			continue
		}
		for _, inst := range pair.Value.Instances {
			if inst == nil {
				continue
			}
			status := strings.ToLower(gcpStr(inst.Status))
			cpu := -1.0
			if mon != nil && inst.Id != nil {
				cpu = getGCPInstanceCPU(ctx, mon, project, fmt.Sprintf("%d", *inst.Id), th.LookbackDays)
			}
			machineType := lastSegment(gcpStr(inst.MachineType))
			cost := gcpVMMonthlyCost(machineType)
			idle := status == "terminated" || status == "stopped" ||
				(status == "running" && cpu >= 0 && cpu < th.IdleCPUPct)
			if !idle {
				continue
			}
			severity := "low"
			switch {
			case cost >= 200:
				severity = "high"
			case cost >= 50:
				severity = "medium"
			}
			reason := fmt.Sprintf("avg CPU %.1f%% over %dd", cpu, th.LookbackDays)
			if status != "running" {
				reason = "Instance not running but disks still incurring cost"
			}
			out = append(out, IdleResource{
				AccountID:  accountID,
				Cloud:      "gcp",
				Service:    "compute",
				Region:     zone,
				ResourceID: gcpStr(inst.SelfLink),
				Name:       gcpStr(inst.Name),
				Tags:       gcpLabelsToMap(inst.Labels),
				State:      status,
				Metrics: map[string]any{
					"cpu_avg_pct":  cpu,
					"machine_type": machineType,
				},
				CostEstimateUSD: cost,
				Reason:          reason,
				Severity:        severity,
				ConsoleURL: fmt.Sprintf("https://console.cloud.google.com/compute/instancesDetail/zones/%s/instances/%s?project=%s",
					zone, gcpStr(inst.Name), project),
			})
		}
	}
	return out, nil
}

func scanGCPDisks(ctx context.Context, accountID int, project string, opts []option.ClientOption, regionAllowed func(string) bool) ([]IdleResource, error) {
	client, err := compute.NewDisksRESTClient(ctx, opts...)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	out := []IdleResource{}
	it := client.AggregatedList(ctx, &computepb.AggregatedListDisksRequest{Project: project})
	for {
		pair, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return out, err
		}
		zone := strings.TrimPrefix(pair.Key, "zones/")
		if !regionAllowed(zone) {
			continue
		}
		if pair.Value == nil {
			continue
		}
		for _, d := range pair.Value.Disks {
			if d == nil || len(d.Users) > 0 {
				continue
			}
			sizeGB := int64(0)
			if d.SizeGb != nil {
				sizeGB = *d.SizeGb
			}
			diskType := lastSegment(gcpStr(d.Type))
			cost := gcpDiskMonthlyCost(diskType, sizeGB)
			severity := "low"
			if cost >= 50 {
				severity = "medium"
			}
			if cost >= 200 {
				severity = "high"
			}
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "gcp",
				Service:         "disk",
				Region:          zone,
				ResourceID:      gcpStr(d.SelfLink),
				Name:            gcpStr(d.Name),
				Tags:            gcpLabelsToMap(d.Labels),
				State:           "unattached",
				Metrics:         map[string]any{"size_gb": sizeGB, "type": diskType},
				CostEstimateUSD: cost,
				Reason:          "Unattached persistent disk",
				Severity:        severity,
				ConsoleURL: fmt.Sprintf("https://console.cloud.google.com/compute/disksDetail/zones/%s/disks/%s?project=%s",
					zone, gcpStr(d.Name), project),
			})
		}
	}
	return out, nil
}

func scanGCPAddresses(ctx context.Context, accountID int, project string, opts []option.ClientOption, regionAllowed func(string) bool) ([]IdleResource, error) {
	client, err := compute.NewAddressesRESTClient(ctx, opts...)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	out := []IdleResource{}
	it := client.AggregatedList(ctx, &computepb.AggregatedListAddressesRequest{Project: project})
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
		for _, a := range pair.Value.Addresses {
			if a == nil {
				continue
			}
			if strings.EqualFold(gcpStr(a.Status), "IN_USE") {
				continue
			}
			cost := 7.3 // ~$0.01/hr for unused static IP
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "gcp",
				Service:         "address",
				Region:          region,
				ResourceID:      gcpStr(a.SelfLink),
				Name:            gcpStr(a.Name),
				Tags:            map[string]string{},
				State:           strings.ToLower(gcpStr(a.Status)),
				Metrics:         map[string]any{"address": gcpStr(a.Address)},
				CostEstimateUSD: cost,
				Reason:          "Reserved static IP not in use",
				Severity:        "low",
				ConsoleURL: fmt.Sprintf("https://console.cloud.google.com/networking/addresses/list?project=%s", project),
			})
		}
	}
	return out, nil
}

// ---------- monitoring ----------

func getGCPInstanceCPU(ctx context.Context, client *monitoring.MetricClient, project, instanceID string, days int) float64 {
	end := time.Now()
	start := end.AddDate(0, 0, -days)
	filter := fmt.Sprintf(`metric.type="compute.googleapis.com/instance/cpu/utilization" AND resource.labels.instance_id="%s"`, instanceID)
	it := client.ListTimeSeries(ctx, &monitoringpb.ListTimeSeriesRequest{
		Name:   "projects/" + project,
		Filter: filter,
		Interval: &monitoringpb.TimeInterval{
			StartTime: timestamppb.New(start),
			EndTime:   timestamppb.New(end),
		},
		View: monitoringpb.ListTimeSeriesRequest_FULL,
		Aggregation: &monitoringpb.Aggregation{
			AlignmentPeriod:    durationFromSeconds(86400),
			PerSeriesAligner:   monitoringpb.Aggregation_ALIGN_MEAN,
			CrossSeriesReducer: monitoringpb.Aggregation_REDUCE_MEAN,
		},
	})
	count := 0
	total := 0.0
	for {
		ts, err := it.Next()
		if err == iterator.Done || err != nil {
			break
		}
		for _, p := range ts.Points {
			if p == nil || p.Value == nil {
				continue
			}
			if v, ok := p.Value.Value.(*monitoringpb.TypedValue_DoubleValue); ok {
				total += v.DoubleValue * 100 // utilization is 0-1, scale to %
				count++
			}
		}
	}
	if count == 0 {
		return -1
	}
	return total / float64(count)
}

// _ keeps imports referenced in case future scanners need them.
var (
	_ = metric.Metric{}
	_ = monitoredres.MonitoredResource{}
)

// ---------- helpers ----------

func gcpLabelsToMap(labels map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range labels {
		out[k] = v
	}
	return out
}

func gcpStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func ptrUint32(v uint32) *uint32 { return &v }

func durationFromSeconds(seconds int64) *durationpb.Duration {
	return durationpb.New(time.Duration(seconds) * time.Second)
}

func lastSegment(s string) string {
	if i := strings.LastIndex(s, "/"); i >= 0 {
		return s[i+1:]
	}
	return s
}

func gcpVMMonthlyCost(machineType string) float64 {
	prices := map[string]float64{
		"e2-micro":      6.5,
		"e2-small":      13.0,
		"e2-medium":     26.0,
		"e2-standard-2": 49.0,
		"e2-standard-4": 98.0,
		"e2-standard-8": 196.0,
		"n2-standard-2": 71.0,
		"n2-standard-4": 142.0,
		"n2-standard-8": 284.0,
		"n2-highmem-2":  96.0,
		"c2-standard-4": 167.0,
	}
	if v, ok := prices[machineType]; ok {
		return v
	}
	return 60.0
}

func gcpDiskMonthlyCost(diskType string, sizeGB int64) float64 {
	perGB := 0.04
	tlc := strings.ToLower(diskType)
	switch {
	case strings.Contains(tlc, "ssd"):
		perGB = 0.17
	case strings.Contains(tlc, "balanced"):
		perGB = 0.10
	case strings.Contains(tlc, "extreme"):
		perGB = 0.125
	}
	return float64(sizeGB) * perGB
}
