package main

import "testing"

type coverageMem struct {
	native []nativeFinding
	gaps   []coverageGap
}

func (m *coverageMem) install() func() {
	previousSaveNative := saveNativeFinding
	previousFindNative := findNativeFinding
	previousListNative := listNativeFindings
	previousSaveGap := saveCoverageGap
	previousListGaps := listCoverageGaps
	previousResults := listCoverageResults
	saveNativeFinding = func(item nativeFinding) (nativeFinding, error) {
		item.ID = len(m.native) + 1
		m.native = append(m.native, item)
		return item, nil
	}
	findNativeFinding = func(projectID int, source, sourceFindingID string) (nativeFinding, error) {
		for _, item := range m.native {
			if item.ProjectID == projectID && item.Source == source && item.SourceFindingID == sourceFindingID {
				return item, nil
			}
		}
		return nativeFinding{}, nil
	}
	listNativeFindings = func(projectID int, accountID string) ([]nativeFinding, error) {
		var items []nativeFinding
		for _, item := range m.native {
			if item.ProjectID == projectID && item.AccountID == accountID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	saveCoverageGap = func(item coverageGap) (coverageGap, error) {
		item.ID = len(m.gaps) + 1
		m.gaps = append(m.gaps, item)
		return item, nil
	}
	listCoverageGaps = func(projectID int, accountID string) ([]coverageGap, error) {
		var items []coverageGap
		for _, item := range m.gaps {
			if item.ProjectID == projectID && item.AccountID == accountID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	listCoverageResults = func(int, string) (map[string]string, error) {
		return map[string]string{"iam_root_mfa": "pass"}, nil
	}
	return func() {
		saveNativeFinding = previousSaveNative
		findNativeFinding = previousFindNative
		listNativeFindings = previousListNative
		saveCoverageGap = previousSaveGap
		listCoverageGaps = previousListGaps
		listCoverageResults = previousResults
	}
}

func TestCoverageDenominatorExcludesUnknown(t *testing.T) {
	pack := initialPolicyPack()
	domains := map[string]bool{}
	for _, check := range pack.Checks {
		domains[check.Domain] = check.Rationale != "" && check.Severity != ""
	}
	if pack.Certified || pack.Version != policyPackVersion || len(pack.Checks) != 5 || !domains["iam"] || !domains["network"] || !domains["storage"] || !domains["database"] || !domains["logging"] {
		t.Fatalf("pack %+v", pack)
	}
	report := summarizeCoverage(10, "123456789012", map[string]string{"iam_root_mfa": "pass"}, nil, nil)
	if report.Passed != 1 || report.Unknown != 4 || report.Denominator != 5 || report.Passed == report.Denominator || report.CoverageState != "unknown" || report.CoverageState == "healthy" || report.Certified {
		t.Fatalf("report %+v", report)
	}
}

func TestExternalAccessKeepsAttribution(t *testing.T) {
	mem := &coverageMem{}
	restore := mem.install()
	defer restore()
	input := nativeFinding{
		ProjectID: 10, AccountID: "123456789012", Region: "us-east-1",
		Source: "aws-access-analyzer", SourceFindingID: "ext-1",
		AnalyzerARN: "arn:aws:access-analyzer:us-east-1:123456789012:analyzer/setuops",
		FindingType: "external-access", ResourceID: "arn:aws:s3:::logs",
	}
	first, err := importNativeFinding(scanOperator(), input)
	if err != nil || first.Source != "aws-access-analyzer" || first.AnalyzerARN == "" || first.SourceFindingID != "ext-1" || first.CheckID != "s3_bucket_public" {
		t.Fatalf("first %+v err %v", first, err)
	}
	second, err := importNativeFinding(scanOperator(), input)
	if err != nil || second.ID != first.ID || len(mem.native) != 1 || second.AnalyzerARN != first.AnalyzerARN {
		t.Fatalf("retry %+v rows %d err %v", second, len(mem.native), err)
	}
	rejected := input
	rejected.Source = "prowler"
	rejected.SourceFindingID = "other"
	if _, err := importNativeFinding(scanOperator(), rejected); err != errCoverageInvalid || len(mem.native) != 1 {
		t.Fatalf("source err %v rows %d", err, len(mem.native))
	}
	if _, err := importNativeFinding(scanViewer(), input); err != errCoverageDenied || len(mem.native) != 1 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.native))
	}
}

func TestInaccessibleRegionsAreVisible(t *testing.T) {
	mem := &coverageMem{}
	restore := mem.install()
	defer restore()
	region, err := recordCoverageGap(scanOperator(), coverageGap{
		ProjectID: 10, AccountID: "123456789012", Region: "EU-WEST-1", State: "inaccessible", Reason: "access denied",
	})
	if err != nil || region.Region != "eu-west-1" {
		t.Fatalf("region %+v err %v", region, err)
	}
	skipped, err := recordCoverageGap(scanOperator(), coverageGap{
		ProjectID: 10, AccountID: "123456789012", Region: "us-east-1", CheckID: "cloudtrail_enabled", State: "skipped", Reason: "not scheduled",
	})
	if err != nil || skipped.CheckID != "cloudtrail_enabled" {
		t.Fatalf("skipped %+v err %v", skipped, err)
	}
	if _, err := recordCoverageGap(scanViewer(), coverageGap{
		ProjectID: 10, AccountID: "123456789012", Region: "ap-south-1", State: "inaccessible", Reason: "access denied",
	}); err != errCoverageDenied || len(mem.gaps) != 2 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.gaps))
	}
	report, err := accountCoverage(scanOperator(), 10, "123456789012")
	if err != nil || len(report.InaccessibleRegions) != 1 || report.InaccessibleRegions[0].Region != "eu-west-1" || len(report.SkippedChecks) != 1 || report.SkippedChecks[0] != "cloudtrail_enabled" || report.Passed != 1 || report.Unknown != 3 || report.CoverageState != "unknown" {
		t.Fatalf("report %+v err %v", report, err)
	}
}
