package main

import (
	"testing"
	"time"
)

const (
	gateCommit   = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	gateBaseline = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	gateOther    = "cccccccccccccccccccccccccccccccccccccccc"
)

type securityGateMem struct {
	policies  []securityGatePolicy
	decisions []securityGateDecision
	findings  []securityGateFinding
	overrides []securityGateOverride
	audits    []gateAuditRecord
}

func (m *securityGateMem) install() func() {
	previousPolicy := saveGatePolicy
	previousCurrent := findCurrentGatePolicy
	previousDecision := saveGateDecision
	previousFind := findGateDecision
	previousInsert := insertGateFinding
	previousList := listGateFindings
	previousAudit := saveGateAudit
	previousOverride := saveGateOverride
	previousFindOverride := findGateOverride
	previousLoad := loadGateDecisionByID
	saveGatePolicy = func(item securityGatePolicy) (securityGatePolicy, error) {
		item.ID = len(m.policies) + 1
		m.policies = append(m.policies, item)
		return item, nil
	}
	findCurrentGatePolicy = func(projectID int) (securityGatePolicy, error) {
		var current securityGatePolicy
		for _, item := range m.policies {
			if item.ProjectID == projectID && item.Version >= current.Version {
				current = item
			}
		}
		return current, nil
	}
	saveGateDecision = func(item securityGateDecision) (securityGateDecision, error) {
		item.ID = len(m.decisions) + 1
		item.Findings = nil
		m.decisions = append(m.decisions, item)
		return item, nil
	}
	findGateDecision = func(projectID int, repository, commitSHA string, policyVersion int) (securityGateDecision, error) {
		for _, item := range m.decisions {
			if item.ProjectID == projectID && item.Repository == repository && item.CommitSHA == commitSHA && item.PolicyVersion == policyVersion {
				item.Findings = nil
				return item, nil
			}
		}
		return securityGateDecision{}, nil
	}
	insertGateFinding = func(item securityGateFinding) (securityGateFinding, error) {
		item.ID = len(m.findings) + 1
		m.findings = append(m.findings, item)
		return item, nil
	}
	listGateFindings = func(decisionID int) ([]securityGateFinding, error) {
		var items []securityGateFinding
		for _, item := range m.findings {
			if item.DecisionID == decisionID {
				items = append(items, item)
			}
		}
		return items, nil
	}
	saveGateAudit = func(item gateAuditRecord) error {
		m.audits = append(m.audits, item)
		return nil
	}
	saveGateOverride = func(item securityGateOverride) (securityGateOverride, error) {
		item.ID = len(m.overrides) + 1
		m.overrides = append(m.overrides, item)
		return item, nil
	}
	findGateOverride = func(decisionID int) (securityGateOverride, error) {
		for _, item := range m.overrides {
			if item.DecisionID == decisionID {
				return item, nil
			}
		}
		return securityGateOverride{}, nil
	}
	loadGateDecisionByID = func(id int) (securityGateDecision, error) {
		for _, item := range m.decisions {
			if item.ID == id {
				item.Findings = nil
				return item, nil
			}
		}
		return securityGateDecision{}, errGateHidden
	}
	return func() {
		saveGatePolicy = previousPolicy
		findCurrentGatePolicy = previousCurrent
		saveGateDecision = previousDecision
		findGateDecision = previousFind
		insertGateFinding = previousInsert
		listGateFindings = previousList
		saveGateAudit = previousAudit
		saveGateOverride = previousOverride
		findGateOverride = previousFindOverride
		loadGateDecisionByID = previousLoad
	}
}

func gateActor(userID int, role string) authzSubject {
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: role, Environments: []string{"*"}}},
	}
}

func TestUnavailableScanNeverReportsPass(t *testing.T) {
	mem := &securityGateMem{}
	defer mem.install()()
	policy, err := recordGatePolicy(gateActor(4, "operator"), 10, "", "high")
	if err != nil || policy.Mode != pinnedGateMode || policy.Threshold != "high" || policy.Version != 1 {
		t.Fatalf("policy %+v err %v", policy, err)
	}
	if _, err := recordGatePolicy(gateActor(4, "operator"), 10, "all-findings", "high"); err != errGateInvalid || len(mem.policies) != 1 {
		t.Fatalf("mode policies %d err %v", len(mem.policies), err)
	}
	passed, err := publishGateSummary(gateActor(4, "operator"), gateSummaryInput{
		ProjectID: 10, Repository: "app", CommitSHA: gateCommit, BaselineSHA: gateBaseline, ScanState: "available",
		Findings: []securityGateFinding{{RuleID: "old", Path: "main.go", Severity: "critical"}},
		Baseline: []securityGateFinding{{RuleID: "old", Path: "main.go", Severity: "critical"}},
	})
	if err != nil || !passed.Pass || passed.Decision != "pass" || passed.Findings[0].Classification != "baseline" {
		t.Fatalf("passed %+v err %v", passed, err)
	}
	unavailable := []struct{ state, sha string }{
		{"unavailable", gateOther},
		{"partial", "dddddddddddddddddddddddddddddddddddddddd"},
		{"", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},
	}
	for _, item := range unavailable {
		decision, err := publishGateSummary(gateActor(4, "operator"), gateSummaryInput{
			ProjectID: 10, Repository: "app", CommitSHA: item.sha, BaselineSHA: gateBaseline, ScanState: item.state,
			Findings: []securityGateFinding{{RuleID: "new", Path: "main.go", Severity: "critical"}},
		})
		if err != nil || decision.Pass || decision.Decision != "unknown" || decision.Reason != "unavailable scan" {
			t.Fatalf("state %q decision %+v err %v", item.state, decision, err)
		}
	}
	if _, err := publishGateSummary(gateActor(5, "viewer"), gateSummaryInput{
		ProjectID: 10, Repository: "app", CommitSHA: gateCommit, ScanState: "available",
	}); err != errGateDenied {
		t.Fatalf("viewer err %v", err)
	}
	if _, err := publishGateSummary(gateActor(4, "operator"), gateSummaryInput{
		ProjectID: 11, Repository: "app", CommitSHA: gateCommit, ScanState: "unavailable",
	}); err != errGateHidden || len(mem.decisions) != 4 {
		t.Fatalf("hidden decisions %d err %v", len(mem.decisions), err)
	}
}

func TestFindingsLinkToExactRevision(t *testing.T) {
	mem := &securityGateMem{}
	defer mem.install()()
	if _, err := recordGatePolicy(gateActor(4, "operator"), 10, "", "high"); err != nil {
		t.Fatal(err)
	}
	first, err := publishGateSummary(gateActor(4, "operator"), gateSummaryInput{
		ProjectID: 10, Repository: "app", CommitSHA: gateCommit, BaselineSHA: gateBaseline, ScanState: "available",
		Findings: []securityGateFinding{
			{RuleID: "new", Path: "main.go", Severity: "high"},
			{RuleID: "old", Path: "lib.go", Severity: "critical"},
		},
		Baseline: []securityGateFinding{{RuleID: "old", Path: "lib.go", Severity: "critical"}},
	})
	if err != nil || first.Decision != "fail" || len(first.Findings) != 2 {
		t.Fatalf("first %+v err %v", first, err)
	}
	for _, finding := range first.Findings {
		if finding.CommitSHA != gateCommit || finding.CommitSHA == gateBaseline {
			t.Fatalf("finding %+v", finding)
		}
	}
	if first.Findings[0].Classification != "new" || first.Findings[1].Classification != "baseline" {
		t.Fatalf("classes %+v", first.Findings)
	}
	again, err := publishGateSummary(gateActor(4, "operator"), gateSummaryInput{
		ProjectID: 10, Repository: "app", CommitSHA: gateCommit, BaselineSHA: gateBaseline, ScanState: "available",
		Findings: []securityGateFinding{{RuleID: "other", Path: "next.go", Severity: "critical"}},
	})
	if err != nil || again.ID != first.ID || len(mem.decisions) != 1 || len(mem.findings) != 2 {
		t.Fatalf("again %+v decisions %d findings %d err %v", again, len(mem.decisions), len(mem.findings), err)
	}
	second, err := publishGateSummary(gateActor(4, "operator"), gateSummaryInput{
		ProjectID: 10, Repository: "app", CommitSHA: gateOther, BaselineSHA: gateBaseline, ScanState: "available",
		Findings: []securityGateFinding{{RuleID: "new", Path: "main.go", Severity: "low"}},
	})
	if err != nil || second.ID == first.ID || second.CommitSHA != gateOther || second.Findings[0].CommitSHA != gateOther || second.Decision != "pass" {
		t.Fatalf("second %+v err %v", second, err)
	}
}

func TestChangedPolicyHasAuditRecord(t *testing.T) {
	mem := &securityGateMem{}
	defer mem.install()()
	first, err := recordGatePolicy(gateActor(4, "operator"), 10, "", "high")
	if err != nil || first.Version != 1 || len(mem.audits) != 1 || mem.audits[0].Action != "security_gate_policy" || mem.audits[0].Summary != "threshold none to high" {
		t.Fatalf("first %+v audits %+v err %v", first, mem.audits, err)
	}
	same, err := recordGatePolicy(gateActor(4, "operator"), 10, "", "high")
	if err != nil || same.ID != first.ID || len(mem.audits) != 1 {
		t.Fatalf("same %+v audits %d err %v", same, len(mem.audits), err)
	}
	changed, err := recordGatePolicy(gateActor(4, "operator"), 10, "", "critical")
	if err != nil || changed.Version != 2 || changed.ID == first.ID || len(mem.audits) != 2 || mem.audits[1].Summary != "threshold high to critical" {
		t.Fatalf("changed %+v audits %+v err %v", changed, mem.audits, err)
	}
	if _, err := recordGatePolicy(gateActor(5, "viewer"), 10, "", "low"); err != errGateDenied || len(mem.policies) != 2 || len(mem.audits) != 2 {
		t.Fatalf("viewer policies %d audits %d err %v", len(mem.policies), len(mem.audits), err)
	}
	if _, err := recordGatePolicy(gateActor(4, "operator"), 11, "", "low"); err != errGateHidden || len(mem.audits) != 2 {
		t.Fatalf("hidden audits %d err %v", len(mem.audits), err)
	}
	blocked, err := publishGateSummary(gateActor(4, "operator"), gateSummaryInput{
		ProjectID: 10, Repository: "app", CommitSHA: gateCommit, ScanState: "unavailable",
		Findings: []securityGateFinding{{RuleID: "new", Path: "main.go", Severity: "critical"}},
	})
	if err != nil || blocked.Pass || blocked.Decision != "unknown" {
		t.Fatalf("blocked %+v err %v", blocked, err)
	}
	if _, err := recordGateOverride(gateActor(4, "operator"), blocked.ID, "reviewed", time.Now().Add(time.Hour)); err != errGateInvalid || len(mem.overrides) != 0 {
		t.Fatalf("unavailable override err %v overrides %d", err, len(mem.overrides))
	}
	failed, err := publishGateSummary(gateActor(4, "operator"), gateSummaryInput{
		ProjectID: 10, Repository: "app", CommitSHA: gateOther, ScanState: "available",
		Findings: []securityGateFinding{{RuleID: "new", Path: "main.go", Severity: "critical"}},
	})
	if err != nil || failed.Decision != "fail" || failed.PolicyVersion != 2 {
		t.Fatalf("failed %+v err %v", failed, err)
	}
	exception, err := recordGateOverride(gateActor(4, "operator"), failed.ID, "reviewed", time.Now().Add(time.Hour))
	if err != nil || exception.Decision != "exception" || exception.Pass || exception.ExceptionID == 0 {
		t.Fatalf("exception %+v err %v", exception, err)
	}
	if mem.audits[len(mem.audits)-1].Action != "security_gate_override" {
		t.Fatalf("override audit %+v", mem.audits)
	}
	previousClock := gateClock
	gateClock = func() time.Time { return time.Now().Add(2 * time.Hour) }
	defer func() { gateClock = previousClock }()
	expired, err := loadGateSummary(gateActor(5, "viewer"), 10, "app", gateOther)
	if err != nil || expired.Decision != "fail" || expired.Pass || expired.ExceptionID != 0 {
		t.Fatalf("expired %+v err %v", expired, err)
	}
}
