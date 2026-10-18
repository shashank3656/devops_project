package main

import (
	"strings"
	"testing"
)

type securityReportMem struct {
	reports  []securityReport
	findings []securityReportFinding
}

func (m *securityReportMem) install() func() {
	previousSave := saveSecurityReport
	previousFind := findSecurityReport
	previousInsert := insertSecurityFinding
	previousLoad := loadSecurityReport
	previousConnection := loadConnectionByID
	saveSecurityReport = func(item securityReport) (securityReport, error) {
		item.ID = len(m.reports) + 1
		m.reports = append(m.reports, item)
		return item, nil
	}
	findSecurityReport = func(connectionID int, repository, commitSHA, adapter string) (securityReport, error) {
		for _, item := range m.reports {
			if item.ConnectionID == connectionID && item.Repository == repository && item.CommitSHA == commitSHA && item.AdapterVersion == adapter {
				item.Findings = m.findingsFor(item.ID)
				return item, nil
			}
		}
		return securityReport{}, nil
	}
	insertSecurityFinding = func(item securityReportFinding) (securityReportFinding, error) {
		item.ID = len(m.findings) + 1
		m.findings = append(m.findings, item)
		return item, nil
	}
	loadSecurityReport = func(id int) (securityReport, error) {
		for _, item := range m.reports {
			if item.ID == id {
				item.Findings = m.findingsFor(item.ID)
				return item, nil
			}
		}
		return securityReport{}, errReportHidden
	}
	loadConnectionByID = func(id int) (connectionContract, error) {
		if id == 7 {
			return connectionContract{ID: 7, ProjectID: 10, Name: "ci", State: "ready", Coverage: "unknown"}, nil
		}
		return connectionContract{}, errReportHidden
	}
	return func() {
		saveSecurityReport = previousSave
		findSecurityReport = previousFind
		insertSecurityFinding = previousInsert
		loadSecurityReport = previousLoad
		loadConnectionByID = previousConnection
	}
}

func (m *securityReportMem) findingsFor(reportID int) []securityReportFinding {
	var items []securityReportFinding
	for _, item := range m.findings {
		if item.ReportID == reportID {
			items = append(items, item)
		}
	}
	return items
}

func securityReportActor(userID int, role string) authzSubject {
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: role, Environments: []string{"*"}}},
	}
}

func validReport() securityReportInput {
	return securityReportInput{
		ProjectID: 99, OrganizationID: 99, ConnectionID: 7,
		Repository: "setuops/api", Branch: "main",
		CommitSHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		Scanner:   "semgrep",
		Findings:  []securityReportFindingInput{{RuleID: "generic-secret", Path: "config.yml", Message: "token found"}},
	}
}

func TestMalformedReportIsRejected(t *testing.T) {
	mem := &securityReportMem{}
	restore := mem.install()
	defer restore()
	malformed := validReport()
	malformed.CommitSHA = "not-a-sha"
	if _, err := ingestSecurityReport(securityReportActor(4, "operator"), malformed); err != errReportInvalid || len(mem.reports) != 0 {
		t.Fatalf("sha err %v rows %d", err, len(mem.reports))
	}
	oversized := validReport()
	oversized.Payload = strings.Repeat("x", maxReportBytes+1)
	if _, err := ingestSecurityReport(securityReportActor(4, "operator"), oversized); err != errReportInvalid || len(mem.reports) != 0 {
		t.Fatalf("size err %v rows %d", err, len(mem.reports))
	}
	wrongAdapter := validReport()
	wrongAdapter.AdapterVersion = "sarif-0"
	if _, err := ingestSecurityReport(securityReportActor(4, "operator"), wrongAdapter); err != errReportInvalid || len(mem.reports) != 0 {
		t.Fatalf("adapter err %v rows %d", err, len(mem.reports))
	}
	if _, err := ingestSecurityReport(securityReportActor(5, "viewer"), validReport()); err != errReportDenied || len(mem.reports) != 0 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.reports))
	}
}

func TestRetriesDeduplicate(t *testing.T) {
	mem := &securityReportMem{}
	restore := mem.install()
	defer restore()
	first, err := ingestSecurityReport(securityReportActor(4, "operator"), validReport())
	if err != nil || first.AdapterVersion != pinnedReportAdapter || first.ProjectID != 10 || first.OrganizationID != pilotOrganizationID || len(first.Findings) != 1 {
		t.Fatalf("first %+v err %v", first, err)
	}
	second, err := ingestSecurityReport(securityReportActor(4, "operator"), validReport())
	if err != nil || second.ID != first.ID || len(mem.reports) != 1 || len(mem.findings) != 1 {
		t.Fatalf("retry %+v rows %d findings %d err %v", second, len(mem.reports), len(mem.findings), err)
	}
}

func TestSecretValuesNeverPersist(t *testing.T) {
	mem := &securityReportMem{}
	restore := mem.install()
	defer restore()
	const secret = "super-secret-value"
	input := validReport()
	input.Findings[0].Message = "leaked " + secret
	input.Findings[0].Secret = secret
	saved, err := ingestSecurityReport(securityReportActor(4, "operator"), input)
	if err != nil || len(saved.Findings) != 1 || strings.Contains(saved.Findings[0].Message, secret) || saved.Findings[0].Message != "leaked "+redactedReportValue {
		t.Fatalf("saved %+v err %v", saved, err)
	}
	for _, finding := range mem.findings {
		if strings.Contains(finding.Message, secret) {
			t.Fatalf("persisted %s", finding.Message)
		}
	}
}
