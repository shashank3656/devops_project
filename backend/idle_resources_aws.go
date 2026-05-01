package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	awsv2 "github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	awscreds "github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	cwclient "github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	cwtypes "github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	ec2client "github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	ecclient "github.com/aws/aws-sdk-go-v2/service/elasticache"
	elbclient "github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2"
	elbtypes "github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2/types"
	lambdaclient "github.com/aws/aws-sdk-go-v2/service/lambda"
	rdsclient "github.com/aws/aws-sdk-go-v2/service/rds"
	rdstypes "github.com/aws/aws-sdk-go-v2/service/rds/types"
	s3client "github.com/aws/aws-sdk-go-v2/service/s3"
	stsclient "github.com/aws/aws-sdk-go-v2/service/sts"
)

// awsConfigForAccount builds an aws.Config that honours the account's
// auth_method. All four supported methods are wired here.
func awsConfigForAccount(ctx context.Context, region string, creds CloudCredentials) (awsv2.Config, error) {
	switch creds.AuthMethod {
	case "aws_keys":
		return awsconfig.LoadDefaultConfig(ctx,
			awsconfig.WithRegion(region),
			awsconfig.WithCredentialsProvider(awscreds.NewStaticCredentialsProvider(
				creds.AWSAccessKeyID, creds.AWSSecretAccessKey, creds.AWSSessionToken,
			)),
		)
	case "aws_assume_role":
		base, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
		if err != nil {
			return awsv2.Config{}, err
		}
		stsClient := stsclient.NewFromConfig(base)
		provider := stscreds.NewAssumeRoleProvider(stsClient, creds.AWSRoleARN, func(o *stscreds.AssumeRoleOptions) {
			o.RoleSessionName = "infra-idle-scanner"
			if creds.AWSExternalID != "" {
				o.ExternalID = awsv2.String(creds.AWSExternalID)
			}
		})
		base.Credentials = awsv2.NewCredentialsCache(provider)
		return base, nil
	case "aws_profile":
		return awsconfig.LoadDefaultConfig(ctx,
			awsconfig.WithRegion(region),
			awsconfig.WithSharedConfigProfile(creds.AWSProfile),
		)
	case "aws_instance_role":
		return awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	default:
		return awsv2.Config{}, fmt.Errorf("unsupported aws auth_method: %s", creds.AuthMethod)
	}
}

// testAWSConnection performs a minimal STS GetCallerIdentity to confirm the
// supplied credentials work and returns the account ID + ARN.
func testAWSConnection(ctx context.Context, region string, creds CloudCredentials) (string, error) {
	cfg, err := awsConfigForAccount(ctx, region, creds)
	if err != nil {
		return "", err
	}
	out, err := stsclient.NewFromConfig(cfg).GetCallerIdentity(ctx, &stsclient.GetCallerIdentityInput{})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("account=%s arn=%s", awsv2.ToString(out.Account), awsv2.ToString(out.Arn)), nil
}

// scanAWSAccount fans out one region at a time across the requested scope. The
// returned slice contains every detected idle resource with its metric snapshot
// + cost estimate baked in. Errors per region are captured into errLog rather
// than aborting the whole scan.
func scanAWSAccount(ctx context.Context, account CloudAccount, creds CloudCredentials, regions []string, scope []string, thresholds idleThresholds, progressCB func(region, service string, count int)) ([]IdleResource, []scanError) {
	all := []IdleResource{}
	errs := []scanError{}
	for _, region := range regions {
		cfg, err := awsConfigForAccount(ctx, region, creds)
		if err != nil {
			errs = append(errs, scanError{Region: region, Service: "config", Message: err.Error()})
			continue
		}
		ec2 := ec2client.NewFromConfig(cfg)
		elb := elbclient.NewFromConfig(cfg)
		rds := rdsclient.NewFromConfig(cfg)
		cw := cwclient.NewFromConfig(cfg)

		if containsString(scope, "ec2") {
			r, err := scanAWSEC2(ctx, region, account.ID, ec2, cw, thresholds)
			if err != nil {
				errs = append(errs, scanError{Region: region, Service: "ec2", Message: err.Error()})
			} else {
				all = append(all, r...)
				progressCB(region, "ec2", len(r))
			}
		}
		if containsString(scope, "ebs") {
			r, err := scanAWSEBS(ctx, region, account.ID, ec2)
			if err != nil {
				errs = append(errs, scanError{Region: region, Service: "ebs", Message: err.Error()})
			} else {
				all = append(all, r...)
				progressCB(region, "ebs", len(r))
			}
		}
		if containsString(scope, "eip") {
			r, err := scanAWSEIP(ctx, region, account.ID, ec2)
			if err != nil {
				errs = append(errs, scanError{Region: region, Service: "eip", Message: err.Error()})
			} else {
				all = append(all, r...)
				progressCB(region, "eip", len(r))
			}
		}
		if containsString(scope, "alb") {
			r, err := scanAWSLoadBalancers(ctx, region, account.ID, elb, cw, thresholds)
			if err != nil {
				errs = append(errs, scanError{Region: region, Service: "alb", Message: err.Error()})
			} else {
				all = append(all, r...)
				progressCB(region, "alb", len(r))
			}
		}
		if containsString(scope, "rds") {
			r, err := scanAWSRDS(ctx, region, account.ID, rds, cw, thresholds)
			if err != nil {
				errs = append(errs, scanError{Region: region, Service: "rds", Message: err.Error()})
			} else {
				all = append(all, r...)
				progressCB(region, "rds", len(r))
			}
		}
		if containsString(scope, "elasticache") {
			ec := ecclient.NewFromConfig(cfg)
			r, err := scanAWSElastiCache(ctx, region, account.ID, ec, cw, thresholds)
			if err != nil {
				errs = append(errs, scanError{Region: region, Service: "elasticache", Message: err.Error()})
			} else {
				all = append(all, r...)
				progressCB(region, "elasticache", len(r))
			}
		}
		if containsString(scope, "lambda") {
			lc := lambdaclient.NewFromConfig(cfg)
			r, err := scanAWSLambda(ctx, region, account.ID, lc, cw, thresholds)
			if err != nil {
				errs = append(errs, scanError{Region: region, Service: "lambda", Message: err.Error()})
			} else {
				all = append(all, r...)
				progressCB(region, "lambda", len(r))
			}
		}

		extras, extraErrs := scanAWSExtras(ctx, region, account.ID, ec2, cw, scope, thresholds, progressCB)
		all = append(all, extras...)
		errs = append(errs, extraErrs...)

		// S3 buckets are global; only scan when configured for the first
		// region we encounter to avoid duplicates.
		if region == regions[0] && containsString(scope, "s3") {
			s3 := s3client.NewFromConfig(cfg)
			r, err := scanAWSS3(ctx, account.ID, s3)
			if err != nil {
				errs = append(errs, scanError{Region: "global", Service: "s3", Message: err.Error()})
			} else {
				all = append(all, r...)
				progressCB("global", "s3", len(r))
			}
		}
	}
	return all, errs
}

// ---------- service scanners ----------

func scanAWSEC2(ctx context.Context, region string, accountID int, ec2 *ec2client.Client, cw *cwclient.Client, th idleThresholds) ([]IdleResource, error) {
	out := []IdleResource{}
	pager := ec2client.NewDescribeInstancesPaginator(ec2, &ec2client.DescribeInstancesInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, res := range page.Reservations {
			for _, inst := range res.Instances {
				if inst.State == nil {
					continue
				}
				state := string(inst.State.Name)
				if state == "terminated" {
					continue
				}
				instID := awsv2.ToString(inst.InstanceId)
				cpu := getAvgCPU(ctx, cw, "AWS/EC2", "InstanceId", instID, th.LookbackDays)
				netIn := getAvgMetric(ctx, cw, "AWS/EC2", "NetworkIn", "InstanceId", instID, th.LookbackDays)
				instType := string(inst.InstanceType)
				cost := awsEC2MonthlyCost(instType)
				idle := state == "stopped" || (state == "running" && cpu >= 0 && cpu < th.IdleCPUPct && netIn < th.IdleNetworkBytes)
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
				reason := fmt.Sprintf("avg CPU %.1f%% over %dd, avg netIn %.0f B/s", cpu, th.LookbackDays, netIn)
				if state == "stopped" {
					reason = "stopped instance still incurring EBS+EIP costs"
				}
				out = append(out, IdleResource{
					AccountID:       accountID,
					Cloud:           "aws",
					Service:         "ec2",
					Region:          region,
					ResourceID:      instID,
					Name:            tagValue(inst.Tags, "Name"),
					Tags:            tagsToMap(inst.Tags),
					State:           state,
					CreatedAtRemote: inst.LaunchTime,
					Metrics: map[string]any{
						"cpu_avg_pct":      cpu,
						"net_in_bytes_avg": netIn,
						"instance_type":    instType,
					},
					CostEstimateUSD: cost,
					Reason:          reason,
					Severity:        severity,
					ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/ec2/home?region=%s#InstanceDetails:instanceId=%s", region, instID),
				})
			}
		}
	}
	return out, nil
}

func scanAWSEBS(ctx context.Context, region string, accountID int, ec2 *ec2client.Client) ([]IdleResource, error) {
	out := []IdleResource{}
	pager := ec2client.NewDescribeVolumesPaginator(ec2, &ec2client.DescribeVolumesInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, v := range page.Volumes {
			if v.State == ec2types.VolumeStateInUse && len(v.Attachments) > 0 {
				continue
			}
			size := int32(0)
			if v.Size != nil {
				size = *v.Size
			}
			cost := awsEBSMonthlyCost(string(v.VolumeType), size)
			severity := "low"
			if cost >= 50 {
				severity = "medium"
			}
			if cost >= 200 {
				severity = "high"
			}
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "aws",
				Service:         "ebs",
				Region:          region,
				ResourceID:      awsv2.ToString(v.VolumeId),
				Name:            tagValue(v.Tags, "Name"),
				Tags:            tagsToMap(v.Tags),
				State:           string(v.State),
				CreatedAtRemote: v.CreateTime,
				Metrics: map[string]any{
					"size_gb": size,
					"type":    string(v.VolumeType),
				},
				CostEstimateUSD: cost,
				Reason:          "Unattached EBS volume",
				Severity:        severity,
				ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/ec2/home?region=%s#VolumeDetails:volumeId=%s", region, awsv2.ToString(v.VolumeId)),
			})
		}
	}
	return out, nil
}

func scanAWSEIP(ctx context.Context, region string, accountID int, ec2 *ec2client.Client) ([]IdleResource, error) {
	out := []IdleResource{}
	resp, err := ec2.DescribeAddresses(ctx, &ec2client.DescribeAddressesInput{})
	if err != nil {
		return out, err
	}
	for _, a := range resp.Addresses {
		if a.AssociationId != nil && *a.AssociationId != "" {
			continue
		}
		// Unassociated EIP costs ~$3.6/mo (us-east-1 reference)
		cost := 3.6
		out = append(out, IdleResource{
			AccountID:  accountID,
			Cloud:      "aws",
			Service:    "eip",
			Region:     region,
			ResourceID: awsv2.ToString(a.AllocationId),
			Name:       awsv2.ToString(a.PublicIp),
			Tags:       tagsToMap(a.Tags),
			State:      "unassociated",
			Metrics: map[string]any{
				"public_ip": awsv2.ToString(a.PublicIp),
			},
			CostEstimateUSD: cost,
			Reason:          "Unassociated Elastic IP",
			Severity:        "low",
			ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/ec2/home?region=%s#Addresses:public-ip=%s", region, awsv2.ToString(a.PublicIp)),
		})
	}
	return out, nil
}

func scanAWSLoadBalancers(ctx context.Context, region string, accountID int, elb *elbclient.Client, cw *cwclient.Client, th idleThresholds) ([]IdleResource, error) {
	out := []IdleResource{}
	pager := elbclient.NewDescribeLoadBalancersPaginator(elb, &elbclient.DescribeLoadBalancersInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, lb := range page.LoadBalancers {
			arn := awsv2.ToString(lb.LoadBalancerArn)
			lbDim := strings.TrimPrefix(arnTail(arn), "loadbalancer/")
			metricNS := "AWS/ApplicationELB"
			metricName := "RequestCount"
			if lb.Type == elbtypes.LoadBalancerTypeEnumNetwork {
				metricNS = "AWS/NetworkELB"
				metricName = "ActiveFlowCount"
			}
			req := getSumMetric(ctx, cw, metricNS, metricName, "LoadBalancer", lbDim, th.LookbackDays)
			if req >= th.IdleLBRequests {
				continue
			}
			cost := awsLBMonthlyCost(string(lb.Type))
			severity := "low"
			if cost >= 30 {
				severity = "medium"
			}
			if cost >= 100 {
				severity = "high"
			}
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "aws",
				Service:         "alb",
				Region:          region,
				ResourceID:      arn,
				Name:            awsv2.ToString(lb.LoadBalancerName),
				Tags:            map[string]string{},
				State:           string(lb.State.Code),
				CreatedAtRemote: lb.CreatedTime,
				Metrics: map[string]any{
					"requests_total":  req,
					"type":            string(lb.Type),
					"scheme":          string(lb.Scheme),
				},
				CostEstimateUSD: cost,
				Reason:          fmt.Sprintf("%.0f total requests over %dd", req, th.LookbackDays),
				Severity:        severity,
				ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/ec2/home?region=%s#LoadBalancers:search=%s", region, awsv2.ToString(lb.LoadBalancerName)),
			})
		}
	}
	return out, nil
}

func scanAWSRDS(ctx context.Context, region string, accountID int, rds *rdsclient.Client, cw *cwclient.Client, th idleThresholds) ([]IdleResource, error) {
	out := []IdleResource{}
	pager := rdsclient.NewDescribeDBInstancesPaginator(rds, &rdsclient.DescribeDBInstancesInput{})
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, db := range page.DBInstances {
			id := awsv2.ToString(db.DBInstanceIdentifier)
			cls := awsv2.ToString(db.DBInstanceClass)
			conns := getAvgMetric(ctx, cw, "AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", id, th.LookbackDays)
			cpu := getAvgCPU(ctx, cw, "AWS/RDS", "DBInstanceIdentifier", id, th.LookbackDays)
			if conns >= th.IdleConnections && cpu >= th.IdleCPUPct {
				continue
			}
			cost := awsRDSMonthlyCost(cls)
			severity := "low"
			switch {
			case cost >= 300:
				severity = "high"
			case cost >= 80:
				severity = "medium"
			}
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "aws",
				Service:         "rds",
				Region:          region,
				ResourceID:      id,
				Name:            id,
				Tags:            map[string]string{},
				State:           awsv2.ToString(db.DBInstanceStatus),
				CreatedAtRemote: db.InstanceCreateTime,
				Metrics: map[string]any{
					"connections_avg":   conns,
					"cpu_avg_pct":       cpu,
					"instance_class":    cls,
					"engine":            awsv2.ToString(db.Engine),
				},
				CostEstimateUSD: cost,
				Reason:          fmt.Sprintf("avg %.1f conns, %.1f%% CPU over %dd", conns, cpu, th.LookbackDays),
				Severity:        severity,
				ConsoleURL:      fmt.Sprintf("https://console.aws.amazon.com/rds/home?region=%s#database:id=%s", region, id),
			})
		}
	}
	return out, nil
}

// ---------- CloudWatch helpers ----------

func getAvgCPU(ctx context.Context, cw *cwclient.Client, ns, dimName, dimVal string, days int) float64 {
	return getMetric(ctx, cw, ns, "CPUUtilization", dimName, dimVal, days, cwtypes.StatisticAverage)
}

func getAvgMetric(ctx context.Context, cw *cwclient.Client, ns, name, dimName, dimVal string, days int) float64 {
	return getMetric(ctx, cw, ns, name, dimName, dimVal, days, cwtypes.StatisticAverage)
}

func getSumMetric(ctx context.Context, cw *cwclient.Client, ns, name, dimName, dimVal string, days int) float64 {
	return getMetric(ctx, cw, ns, name, dimName, dimVal, days, cwtypes.StatisticSum)
}

func getMetric(ctx context.Context, cw *cwclient.Client, ns, name, dimName, dimVal string, days int, stat cwtypes.Statistic) float64 {
	end := time.Now()
	start := end.AddDate(0, 0, -days)
	out, err := cw.GetMetricStatistics(ctx, &cwclient.GetMetricStatisticsInput{
		Namespace:  awsv2.String(ns),
		MetricName: awsv2.String(name),
		StartTime:  &start,
		EndTime:    &end,
		Period:     awsv2.Int32(86400),
		Statistics: []cwtypes.Statistic{stat},
		Dimensions: []cwtypes.Dimension{{Name: awsv2.String(dimName), Value: awsv2.String(dimVal)}},
	})
	if err != nil || len(out.Datapoints) == 0 {
		return -1
	}
	if stat == cwtypes.StatisticSum {
		total := 0.0
		for _, dp := range out.Datapoints {
			total += awsv2.ToFloat64(dp.Sum)
		}
		return total
	}
	avg := 0.0
	for _, dp := range out.Datapoints {
		avg += awsv2.ToFloat64(dp.Average)
	}
	return avg / float64(len(out.Datapoints))
}

// ---------- pricing tables (best-effort starter data, USD/month, us-east-1) ----------

func awsEC2MonthlyCost(instanceType string) float64 {
	prices := map[string]float64{
		"t3.nano":     3.8,
		"t3.micro":    7.6,
		"t3.small":    15.2,
		"t3.medium":   30.4,
		"t3.large":    60.8,
		"t3.xlarge":   121.6,
		"t3.2xlarge":  243.2,
		"m5.large":    70.0,
		"m5.xlarge":   140.0,
		"m5.2xlarge":  280.0,
		"m5.4xlarge":  560.0,
		"c5.large":    62.0,
		"c5.xlarge":   124.0,
		"r5.large":    91.0,
		"r5.xlarge":   182.0,
	}
	if v, ok := prices[strings.ToLower(instanceType)]; ok {
		return v
	}
	return 50.0
}

func awsEBSMonthlyCost(volType string, sizeGB int32) float64 {
	perGB := 0.10
	switch strings.ToLower(volType) {
	case "gp3", "gp2":
		perGB = 0.08
	case "io2", "io1":
		perGB = 0.125
	case "st1":
		perGB = 0.045
	case "sc1":
		perGB = 0.025
	}
	return float64(sizeGB) * perGB
}

func awsLBMonthlyCost(lbType string) float64 {
	switch strings.ToLower(lbType) {
	case "network":
		return 21.0
	case "gateway":
		return 26.0
	default:
		return 16.4
	}
}

func awsRDSMonthlyCost(class string) float64 {
	prices := map[string]float64{
		"db.t3.micro":    13.0,
		"db.t3.small":    26.0,
		"db.t3.medium":   52.0,
		"db.t3.large":    104.0,
		"db.m5.large":    140.0,
		"db.m5.xlarge":   280.0,
		"db.m5.2xlarge":  560.0,
		"db.r5.large":    180.0,
		"db.r5.xlarge":   360.0,
	}
	if v, ok := prices[strings.ToLower(class)]; ok {
		return v
	}
	return 100.0
}

// ---------- tag helpers ----------

func tagValue(tags []ec2types.Tag, key string) string {
	for _, t := range tags {
		if awsv2.ToString(t.Key) == key {
			return awsv2.ToString(t.Value)
		}
	}
	return ""
}

func tagsToMap(tags []ec2types.Tag) map[string]string {
	m := map[string]string{}
	for _, t := range tags {
		m[awsv2.ToString(t.Key)] = awsv2.ToString(t.Value)
	}
	return m
}

func arnTail(arn string) string {
	idx := strings.LastIndex(arn, ":")
	if idx < 0 || idx == len(arn)-1 {
		return arn
	}
	return arn[idx+1:]
}

// ---------- common scanner types ----------

// idleThresholds is the policy applied to classification. Defaults are tuned
// for typical FinOps reviews and can be overridden per-scan via the API.
type idleThresholds struct {
	LookbackDays     int
	IdleCPUPct       float64
	IdleNetworkBytes float64
	IdleConnections  float64
	IdleLBRequests   float64
}

func defaultIdleThresholds() idleThresholds {
	return idleThresholds{
		LookbackDays:     14,
		IdleCPUPct:       5.0,
		IdleNetworkBytes: 1_000_000,
		IdleConnections:  1.0,
		IdleLBRequests:   100.0,
	}
}

type scanError struct {
	Region  string `json:"region"`
	Service string `json:"service"`
	Message string `json:"message"`
}

// _ keeps the rdstypes import live in case future MVP additions (Aurora
// clusters etc.) reach for it; the linter would otherwise complain.
var _ = rdstypes.Endpoint{}
