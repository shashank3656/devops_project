package main

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/to"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/compute/armcompute/v6"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/monitor/armmonitor"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/network/armnetwork/v6"
)

// azureCredentialFor returns the right azcore.TokenCredential for the chosen
// auth method. Anything not requiring user input falls back to
// DefaultAzureCredential which will pick up managed identity / WIF / env.
func azureCredentialFor(creds CloudCredentials) (azcore.TokenCredential, error) {
	switch creds.AuthMethod {
	case "azure_sp_secret":
		return azidentity.NewClientSecretCredential(creds.AzureTenantID, creds.AzureClientID, creds.AzureClientSecret, nil)
	case "azure_sp_cert":
		certs, key, err := parseAzureClientCert([]byte(creds.AzureClientCert))
		if err != nil {
			return nil, fmt.Errorf("parse client cert: %w", err)
		}
		return azidentity.NewClientCertificateCredential(creds.AzureTenantID, creds.AzureClientID, certs, key, nil)
	case "azure_managed_identity":
		return azidentity.NewManagedIdentityCredential(nil)
	case "azure_oidc_wif":
		return azidentity.NewDefaultAzureCredential(nil)
	default:
		return nil, fmt.Errorf("unsupported azure auth_method: %s", creds.AuthMethod)
	}
}

// parseAzureClientCert accepts a PEM bundle holding both the certificate(s)
// and the private key. It returns the parsed x509 cert chain and the PKCS#1
// or PKCS#8 RSA key the SDK expects.
func parseAzureClientCert(pemData []byte) ([]*x509.Certificate, any, error) {
	var (
		certs []*x509.Certificate
		key   any
	)
	rest := pemData
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		switch block.Type {
		case "CERTIFICATE":
			c, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return nil, nil, err
			}
			certs = append(certs, c)
		case "PRIVATE KEY":
			k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
			if err != nil {
				return nil, nil, err
			}
			key = k
		case "RSA PRIVATE KEY":
			k, err := x509.ParsePKCS1PrivateKey(block.Bytes)
			if err != nil {
				return nil, nil, err
			}
			key = k
		}
	}
	if len(certs) == 0 || key == nil {
		return nil, nil, errors.New("PEM bundle missing certificate or private key")
	}
	return certs, key, nil
}

func testAzureConnection(ctx context.Context, creds CloudCredentials) (string, error) {
	if strings.TrimSpace(creds.AzureSubscription) == "" {
		return "", errors.New("azure_subscription_id required")
	}
	cred, err := azureCredentialFor(creds)
	if err != nil {
		return "", err
	}
	// Compute client list of resource SKUs is a cheap auth probe.
	client, err := armcompute.NewVirtualMachinesClient(creds.AzureSubscription, cred, nil)
	if err != nil {
		return "", err
	}
	pager := client.NewListAllPager(nil)
	if pager.More() {
		_, err := pager.NextPage(ctx)
		if err != nil {
			return "", err
		}
	}
	return fmt.Sprintf("subscription=%s auth=%s", creds.AzureSubscription, creds.AuthMethod), nil
}

// scanAzureAccount inspects VMs, Disks, Public IPs and Load Balancers for the
// configured subscription. The "regions" slice is treated as a tag filter; any
// region matching is returned. Empty regions = include everything.
func scanAzureAccount(ctx context.Context, account CloudAccount, creds CloudCredentials, regions []string, scope []string, thresholds idleThresholds, progressCB func(region, service string, count int)) ([]IdleResource, []scanError) {
	out := []IdleResource{}
	errs := []scanError{}

	if strings.TrimSpace(creds.AzureSubscription) == "" {
		return out, []scanError{{Region: "all", Service: "azure", Message: "azure_subscription_id missing"}}
	}
	cred, err := azureCredentialFor(creds)
	if err != nil {
		return out, []scanError{{Region: "all", Service: "azure", Message: err.Error()}}
	}
	regionAllowed := func(loc string) bool {
		if len(regions) == 0 {
			return true
		}
		for _, r := range regions {
			if strings.EqualFold(strings.TrimSpace(r), strings.TrimSpace(loc)) {
				return true
			}
		}
		return false
	}

	monitorClient, _ := armmonitor.NewMetricsClient(creds.AzureSubscription, cred, nil)

	if containsString(scope, "vm") {
		r, err := scanAzureVMs(ctx, account.ID, creds.AzureSubscription, cred, monitorClient, regionAllowed, thresholds)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "vm", Message: err.Error()})
		} else {
			out = append(out, r...)
			progressCB("all", "vm", len(r))
		}
	}
	if containsString(scope, "disk") {
		r, err := scanAzureDisks(ctx, account.ID, creds.AzureSubscription, cred, regionAllowed)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "disk", Message: err.Error()})
		} else {
			out = append(out, r...)
			progressCB("all", "disk", len(r))
		}
	}
	if containsString(scope, "public_ip") {
		r, err := scanAzurePublicIPs(ctx, account.ID, creds.AzureSubscription, cred, regionAllowed)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "public_ip", Message: err.Error()})
		} else {
			out = append(out, r...)
			progressCB("all", "public_ip", len(r))
		}
	}
	if containsString(scope, "loadbalancer") {
		r, err := scanAzureLoadBalancers(ctx, account.ID, creds.AzureSubscription, cred, monitorClient, regionAllowed, thresholds)
		if err != nil {
			errs = append(errs, scanError{Region: "all", Service: "loadbalancer", Message: err.Error()})
		} else {
			out = append(out, r...)
			progressCB("all", "loadbalancer", len(r))
		}
	}

	extras, extraErrs := scanAzureExtras(ctx, account.ID, creds.AzureSubscription, cred, monitorClient, regionAllowed, scope, thresholds, progressCB)
	out = append(out, extras...)
	errs = append(errs, extraErrs...)

	return out, errs
}

// ---------- service scanners ----------

func scanAzureVMs(ctx context.Context, accountID int, subID string, cred azcore.TokenCredential, mon *armmonitor.MetricsClient, regionAllowed func(string) bool, th idleThresholds) ([]IdleResource, error) {
	client, err := armcompute.NewVirtualMachinesClient(subID, cred, nil)
	if err != nil {
		return nil, err
	}
	out := []IdleResource{}
	pager := client.NewListAllPager(&armcompute.VirtualMachinesClientListAllOptions{StatusOnly: to.Ptr("true")})
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, vm := range page.Value {
			if vm == nil || vm.Location == nil || !regionAllowed(*vm.Location) {
				continue
			}
			vmID := safeStr(vm.ID)
			vmName := safeStr(vm.Name)
			powerState := azureVMPowerState(vm)
			cpu := getAzureMetric(ctx, mon, vmID, "Percentage CPU", "Average", th.LookbackDays)
			netIn := getAzureMetric(ctx, mon, vmID, "Network In Total", "Average", th.LookbackDays)
			vmSize := ""
			if vm.Properties != nil && vm.Properties.HardwareProfile != nil && vm.Properties.HardwareProfile.VMSize != nil {
				vmSize = string(*vm.Properties.HardwareProfile.VMSize)
			}
			cost := azureVMMonthlyCost(vmSize)
			idle := strings.Contains(strings.ToLower(powerState), "stopped") ||
				(strings.Contains(strings.ToLower(powerState), "running") && cpu >= 0 && cpu < th.IdleCPUPct && netIn < th.IdleNetworkBytes)
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
			reason := fmt.Sprintf("avg CPU %.1f%%, netIn %.0f B/s over %dd", cpu, netIn, th.LookbackDays)
			if strings.Contains(strings.ToLower(powerState), "stopped") {
				reason = "Stopped (deallocated) but still incurring disk costs"
			}
			out = append(out, IdleResource{
				AccountID:  accountID,
				Cloud:      "azure",
				Service:    "vm",
				Region:     safeStr(vm.Location),
				ResourceID: vmID,
				Name:       vmName,
				Tags:       azureTagsToMap(vm.Tags),
				State:      powerState,
				Metrics: map[string]any{
					"cpu_avg_pct":      cpu,
					"net_in_bytes_avg": netIn,
					"vm_size":          vmSize,
				},
				CostEstimateUSD: cost,
				Reason:          reason,
				Severity:        severity,
				ConsoleURL:      azurePortalURL(vmID),
			})
		}
	}
	return out, nil
}

func scanAzureDisks(ctx context.Context, accountID int, subID string, cred azcore.TokenCredential, regionAllowed func(string) bool) ([]IdleResource, error) {
	client, err := armcompute.NewDisksClient(subID, cred, nil)
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
		for _, d := range page.Value {
			if d == nil || d.Location == nil || !regionAllowed(*d.Location) {
				continue
			}
			if d.ManagedBy != nil && *d.ManagedBy != "" {
				continue // attached
			}
			sizeGB := int32(0)
			tier := ""
			if d.Properties != nil {
				if d.Properties.DiskSizeGB != nil {
					sizeGB = *d.Properties.DiskSizeGB
				}
			}
			if d.SKU != nil && d.SKU.Name != nil {
				tier = string(*d.SKU.Name)
			}
			cost := azureDiskMonthlyCost(tier, sizeGB)
			severity := "low"
			if cost >= 50 {
				severity = "medium"
			}
			if cost >= 200 {
				severity = "high"
			}
			out = append(out, IdleResource{
				AccountID:  accountID,
				Cloud:      "azure",
				Service:    "disk",
				Region:     safeStr(d.Location),
				ResourceID: safeStr(d.ID),
				Name:       safeStr(d.Name),
				Tags:       azureTagsToMap(d.Tags),
				State:      "unattached",
				Metrics:    map[string]any{"size_gb": sizeGB, "tier": tier},
				CostEstimateUSD: cost,
				Reason:          "Unattached managed disk",
				Severity:        severity,
				ConsoleURL:      azurePortalURL(safeStr(d.ID)),
			})
		}
	}
	return out, nil
}

func scanAzurePublicIPs(ctx context.Context, accountID int, subID string, cred azcore.TokenCredential, regionAllowed func(string) bool) ([]IdleResource, error) {
	client, err := armnetwork.NewPublicIPAddressesClient(subID, cred, nil)
	if err != nil {
		return nil, err
	}
	out := []IdleResource{}
	pager := client.NewListAllPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, ip := range page.Value {
			if ip == nil || ip.Location == nil || !regionAllowed(*ip.Location) {
				continue
			}
			associated := ip.Properties != nil && ip.Properties.IPConfiguration != nil && ip.Properties.IPConfiguration.ID != nil && *ip.Properties.IPConfiguration.ID != ""
			if associated {
				continue
			}
			cost := 3.6 // ~$0.005/hr standard SKU static
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "azure",
				Service:         "public_ip",
				Region:          safeStr(ip.Location),
				ResourceID:      safeStr(ip.ID),
				Name:            safeStr(ip.Name),
				Tags:            azureTagsToMap(ip.Tags),
				State:           "unassociated",
				Metrics:         map[string]any{"ip_address": safeStrFromProps(ip)},
				CostEstimateUSD: cost,
				Reason:          "Unassociated public IP",
				Severity:        "low",
				ConsoleURL:      azurePortalURL(safeStr(ip.ID)),
			})
		}
	}
	return out, nil
}

func scanAzureLoadBalancers(ctx context.Context, accountID int, subID string, cred azcore.TokenCredential, mon *armmonitor.MetricsClient, regionAllowed func(string) bool, th idleThresholds) ([]IdleResource, error) {
	client, err := armnetwork.NewLoadBalancersClient(subID, cred, nil)
	if err != nil {
		return nil, err
	}
	out := []IdleResource{}
	pager := client.NewListAllPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return out, err
		}
		for _, lb := range page.Value {
			if lb == nil || lb.Location == nil || !regionAllowed(*lb.Location) {
				continue
			}
			lbID := safeStr(lb.ID)
			bytesIn := getAzureMetric(ctx, mon, lbID, "ByteCount", "Total", th.LookbackDays)
			if bytesIn >= th.IdleLBRequests*1024 { // crude proxy: bytes vs request count
				continue
			}
			cost := 18.0
			out = append(out, IdleResource{
				AccountID:       accountID,
				Cloud:           "azure",
				Service:         "loadbalancer",
				Region:          safeStr(lb.Location),
				ResourceID:      lbID,
				Name:            safeStr(lb.Name),
				Tags:            azureTagsToMap(lb.Tags),
				State:           "active",
				Metrics:         map[string]any{"bytes_total": bytesIn},
				CostEstimateUSD: cost,
				Reason:          fmt.Sprintf("%.0f bytes total over %dd", bytesIn, th.LookbackDays),
				Severity:        "low",
				ConsoleURL:      azurePortalURL(lbID),
			})
		}
	}
	return out, nil
}

// ---------- helpers ----------

func azureVMPowerState(vm *armcompute.VirtualMachine) string {
	if vm == nil || vm.Properties == nil || vm.Properties.InstanceView == nil {
		return "unknown"
	}
	for _, s := range vm.Properties.InstanceView.Statuses {
		if s == nil || s.Code == nil {
			continue
		}
		if strings.HasPrefix(*s.Code, "PowerState/") {
			return strings.TrimPrefix(*s.Code, "PowerState/")
		}
	}
	return "unknown"
}

func azureTagsToMap(tags map[string]*string) map[string]string {
	m := map[string]string{}
	for k, v := range tags {
		if v == nil {
			continue
		}
		m[k] = *v
	}
	return m
}

func azurePortalURL(resourceID string) string {
	if resourceID == "" {
		return ""
	}
	return "https://portal.azure.com/#@/resource" + resourceID + "/overview"
}

func safeStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func safeStrFromProps(ip *armnetwork.PublicIPAddress) string {
	if ip == nil || ip.Properties == nil || ip.Properties.IPAddress == nil {
		return ""
	}
	return *ip.Properties.IPAddress
}

// getAzureMetric queries Azure Monitor and averages or sums the values across
// the lookback window. Returns -1 on any error so callers can treat it as
// "unknown" rather than 0.
func getAzureMetric(ctx context.Context, client *armmonitor.MetricsClient, resourceURI, metric, aggregation string, days int) float64 {
	if client == nil || resourceURI == "" {
		return -1
	}
	end := time.Now().UTC()
	start := end.AddDate(0, 0, -days)
	ts := start.Format(time.RFC3339) + "/" + end.Format(time.RFC3339)
	resp, err := client.List(ctx, resourceURI, &armmonitor.MetricsClientListOptions{
		Timespan:    to.Ptr(ts),
		Interval:    to.Ptr("P1D"),
		Metricnames: to.Ptr(metric),
		Aggregation: to.Ptr(aggregation),
	})
	if err != nil || resp.Value == nil {
		return -1
	}
	count := 0
	total := 0.0
	for _, m := range resp.Value {
		for _, ts := range m.Timeseries {
			for _, d := range ts.Data {
				if d == nil {
					continue
				}
				val := 0.0
				switch strings.ToLower(aggregation) {
				case "total":
					if d.Total != nil {
						val = *d.Total
					}
				default:
					if d.Average != nil {
						val = *d.Average
					}
				}
				total += val
				count++
			}
		}
	}
	if count == 0 {
		return -1
	}
	if strings.EqualFold(aggregation, "Total") {
		return total
	}
	return total / float64(count)
}

// ---------- pricing tables (USD/month, eastus reference) ----------

func azureVMMonthlyCost(size string) float64 {
	prices := map[string]float64{
		"Standard_B1s":      7.6,
		"Standard_B2s":      30.4,
		"Standard_B4ms":     121.0,
		"Standard_D2s_v5":   72.0,
		"Standard_D4s_v5":   144.0,
		"Standard_D8s_v5":   288.0,
		"Standard_E2s_v5":   90.0,
		"Standard_E4s_v5":   180.0,
		"Standard_F2s_v2":   62.0,
		"Standard_F4s_v2":   124.0,
	}
	if v, ok := prices[size]; ok {
		return v
	}
	return 60.0
}

func azureDiskMonthlyCost(tier string, sizeGB int32) float64 {
	perGB := 0.05
	tlc := strings.ToLower(tier)
	switch {
	case strings.Contains(tlc, "premium"):
		perGB = 0.135
	case strings.Contains(tlc, "ultrassd"):
		perGB = 0.28
	case strings.Contains(tlc, "standardssd"):
		perGB = 0.075
	case strings.Contains(tlc, "standard"):
		perGB = 0.05
	}
	return float64(sizeGB) * perGB
}
