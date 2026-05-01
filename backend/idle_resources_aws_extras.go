package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	awsv2 "github.com/aws/aws-sdk-go-v2/aws"
	cwclient "github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	cwtypes "github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	ec2client "github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	ecclient "github.com/aws/aws-sdk-go-v2/service/elasticache"
	lambdaclient "github.com/aws/aws-sdk-go-v2/service/lambda"
	s3client "github.com/aws/aws-sdk-go-v2/service/s3"
)

// scanAWSExtras dispatches the additional service scanners. Called from
// scanAWSAccount once per region after the core services run.
func scanAWSExtras(ctx context.Context, region string, accountID int, ec2 *ec2client.Client, cw *cwclient.Client, scope []string, thresholds idleThresholds, progressCB func(region, service string, count int)) ([]IdleResource, []scanError) {
	all := []IdleResource{}
	errs := []scanError{}

	if containsString(scope, "natgw") {
		r, err := scanAWSNatGateways(ctx, region, accountID, ec2, cw, thresholds)
		if err != nil {
			errs = append(errs, scanError{Region: region, Service: "natgw", Message: err.Error()})
		} else {
			all = append(all, r...)
			progressCB(region, "natgw", len(r))
		}
	}
	if containsString(scope, "snapshots") {
		r, err := scanAWSSnapshots(ctx, region, accountID, ec2)
		if err != nil {
			errs = append(errs, scanError{Region: region, Service: "snapshots", Message: err.Error()})
		} else {
			all = append(all, r...)
			progressCB(region, "snapshots", len(r))
		}
	}
	return all, errs
}

func scanAWSNatGateways(ctx context.Context, region string, accountID int, ec2 *ec2client.Client, cw *cwclient.Client, th idleThresholds) ([]IdleResource, error) {
	out := []IdleResource{}
	pager := ec2client.NewDescribeNatGatewaysPaginator(ec2, &ec2client.DescribeNatGatewaysInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, n := range page.NatGateways {
			if n.State != ec2types.NatGatewayStateAvailable {
				continue
			}
			ngID := awsv2.ToString(n.NatGatewayId)
			bytesOut := getMetric(ctx, cw, "AWS/NATGateway", "BytesOutToDestination", "NatGatewayId", ngID, th.LookbackDays, cwtypes.StatisticSum)
			if bytesOut > th.IdleNetworkBytes*float64(th.LookbackDays)*86400 { // active enough
				continue
			}
			cost := 32.0 // ~$0.045/h NAT GW hourly fee
			severity := "medium"
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "aws",
				Service:         "natgw",
				Region:          region,
				ResourceID:      ngID,
				Name:            tagValue(n.Tags, "Name"),
				Tags:            tagsToMap(n.Tags),
				State:           string(n.State),
				CreatedAtRemote: n.CreateTime,
				Metrics:         map[string]any{"bytes_out_total": bytesOut},
				CostEstimateUSD: cost,
				Reason:          fmt.Sprintf("%.0f bytes out over %dd", bytesOut, th.LookbackDays),
				Severity:        severity,
				ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/vpc/home?region=%s#NatGateway:natGatewayId=%s", region, ngID),
			})
		}
	}
	return out, nil
}

func scanAWSSnapshots(ctx context.Context, region string, accountID int, ec2 *ec2client.Client) ([]IdleResource, error) {
	out := []IdleResource{}
	stale := time.Now().AddDate(0, -3, 0)
	pager := ec2client.NewDescribeSnapshotsPaginator(ec2, &ec2client.DescribeSnapshotsInput{
		OwnerIds: []string{"self"},
	})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, snap := range page.Snapshots {
			if snap.StartTime == nil || snap.StartTime.After(stale) {
				continue
			}
			sizeGB := int32(0)
			if snap.VolumeSize != nil {
				sizeGB = *snap.VolumeSize
			}
			cost := float64(sizeGB) * 0.05 // $0.05/GB-mo standard EBS snapshot
			severity := "low"
			if cost >= 50 {
				severity = "medium"
			}
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "aws",
				Service:         "snapshots",
				Region:          region,
				ResourceID:      awsv2.ToString(snap.SnapshotId),
				Name:            tagValue(snap.Tags, "Name"),
				Tags:            tagsToMap(snap.Tags),
				State:           string(snap.State),
				CreatedAtRemote: snap.StartTime,
				Metrics:         map[string]any{"size_gb": sizeGB, "volume_id": awsv2.ToString(snap.VolumeId)},
				CostEstimateUSD: cost,
				Reason:          fmt.Sprintf("Snapshot older than 90 days (%.0f GB)", float64(sizeGB)),
				Severity:        severity,
				ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/ec2/home?region=%s#SnapshotDetails:snapshotId=%s", region, awsv2.ToString(snap.SnapshotId)),
			})
		}
	}
	return out, nil
}

func scanAWSElastiCache(ctx context.Context, region string, accountID int, ec *ecclient.Client, cw *cwclient.Client, th idleThresholds) ([]IdleResource, error) {
	out := []IdleResource{}
	pager := ecclient.NewDescribeCacheClustersPaginator(ec, &ecclient.DescribeCacheClustersInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, c := range page.CacheClusters {
			id := awsv2.ToString(c.CacheClusterId)
			cls := awsv2.ToString(c.CacheNodeType)
			cpu := getMetric(ctx, cw, "AWS/ElastiCache", "CPUUtilization", "CacheClusterId", id, th.LookbackDays, cwtypes.StatisticAverage)
			conns := getMetric(ctx, cw, "AWS/ElastiCache", "CurrConnections", "CacheClusterId", id, th.LookbackDays, cwtypes.StatisticAverage)
			if cpu >= th.IdleCPUPct && conns >= th.IdleConnections {
				continue
			}
			cost := elastiCacheMonthlyCost(cls)
			severity := "low"
			if cost >= 100 {
				severity = "medium"
			}
			if cost >= 300 {
				severity = "high"
			}
			out = append(out, IdleResource{
				AccountID:  accountID,
				Cloud:      "aws",
				Service:    "elasticache",
				Region:     region,
				ResourceID: id,
				Name:       id,
				Tags:       map[string]string{},
				State:      awsv2.ToString(c.CacheClusterStatus),
				Metrics: map[string]any{
					"cpu_avg_pct":     cpu,
					"connections_avg": conns,
					"node_type":       cls,
					"engine":          awsv2.ToString(c.Engine),
				},
				CostEstimateUSD: cost,
				Reason:          fmt.Sprintf("avg %.1f%% CPU, %.1f conns over %dd", cpu, conns, th.LookbackDays),
				Severity:        severity,
				ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/elasticache/home?region=%s#redis-detail:id=%s", region, id),
			})
		}
	}
	return out, nil
}

func scanAWSLambda(ctx context.Context, region string, accountID int, lc *lambdaclient.Client, cw *cwclient.Client, th idleThresholds) ([]IdleResource, error) {
	out := []IdleResource{}
	pager := lambdaclient.NewListFunctionsPaginator(lc, &lambdaclient.ListFunctionsInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, fn := range page.Functions {
			name := awsv2.ToString(fn.FunctionName)
			invocations := getMetric(ctx, cw, "AWS/Lambda", "Invocations", "FunctionName", name, 30, cwtypes.StatisticSum)
			if invocations > 0 {
				continue
			}
			memMB := int32(128)
			if fn.MemorySize != nil {
				memMB = *fn.MemorySize
			}
			// Storage cost ($0.0000000017/MB-ms is invocation-based; the
			// "waste" here is just the maintenance overhead. We surface it
			// as low cost but high cleanup value.)
			cost := 0.5
			out = append(out, IdleResource{
				AccountID:  accountID,
				Cloud:      "aws",
				Service:    "lambda",
				Region:     region,
				ResourceID: awsv2.ToString(fn.FunctionArn),
				Name:       name,
				Tags:       map[string]string{},
				State:      string(fn.State),
				Metrics:    map[string]any{"invocations_30d": invocations, "memory_mb": memMB, "runtime": string(fn.Runtime)},
				CostEstimateUSD: cost,
				Reason:          "Zero invocations in last 30 days",
				Severity:        "low",
				ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/lambda/home?region=%s#/functions/%s", region, name),
			})
		}
	}
	return out, nil
}

func scanAWSS3(ctx context.Context, accountID int, s3 *s3client.Client) ([]IdleResource, error) {
	out := []IdleResource{}
	resp, err := s3.ListBuckets(ctx, &s3client.ListBucketsInput{})
	if err != nil {
		return out, err
	}
	stale := time.Now().AddDate(0, -6, 0)
	for _, b := range resp.Buckets {
		name := awsv2.ToString(b.Name)
		if b.CreationDate == nil || b.CreationDate.After(stale) {
			continue
		}
		// Probe head bucket to ensure access; skip on error to avoid noise.
		loc, err := s3.GetBucketLocation(ctx, &s3client.GetBucketLocationInput{Bucket: awsv2.String(name)})
		region := "us-east-1"
		if err == nil && loc.LocationConstraint != "" {
			region = string(loc.LocationConstraint)
		}
		// We don't have CloudTrail wiring here; instead, surface "old empty
		// or under-used" buckets by checking if they're empty.
		head, err := s3.ListObjectsV2(ctx, &s3client.ListObjectsV2Input{Bucket: awsv2.String(name), MaxKeys: awsv2.Int32(1)})
		if err != nil {
			continue
		}
		if head.KeyCount != nil && *head.KeyCount > 0 {
			continue
		}
		out = append(out, IdleResource{
			AccountID:       accountID,
			Cloud:           "aws",
			Service:         "s3",
			Region:          region,
			ResourceID:      "arn:aws:s3:::" + name,
			Name:            name,
			Tags:            map[string]string{},
			State:           "empty",
			CreatedAtRemote: b.CreationDate,
			Metrics:         map[string]any{"object_count_sample": 0},
			CostEstimateUSD: 0.5, // bucket overhead minimum
			Reason:          "Empty bucket older than 6 months",
			Severity:        "low",
			ConsoleURL:      fmt.Sprintf("https://s3.console.aws.amazon.com/s3/buckets/%s", name),
		})
	}
	return out, nil
}

// ---------- pricing helpers ----------

func elastiCacheMonthlyCost(nodeType string) float64 {
	prices := map[string]float64{
		"cache.t3.micro":   12.0,
		"cache.t3.small":   24.0,
		"cache.t3.medium":  47.0,
		"cache.m6g.large":  82.0,
		"cache.m6g.xlarge": 164.0,
		"cache.r6g.large":  130.0,
	}
	if v, ok := prices[strings.ToLower(nodeType)]; ok {
		return v
	}
	return 60.0
}
