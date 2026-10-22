package main

import "testing"

type scanMem struct {
	items []scanProfile
}

func (m *scanMem) install() func() {
	previousSave := saveScanProfile
	previousLoad := loadScanProfile
	previousAbort := abortScanProfile
	saveScanProfile = func(item scanProfile) (scanProfile, error) {
		item.ID = len(m.items) + 1
		item.ReadOnly = true
		item.State = "ready"
		m.items = append(m.items, item)
		return item, nil
	}
	loadScanProfile = func(id int) (scanProfile, error) {
		for _, item := range m.items {
			if item.ID == id {
				return item, nil
			}
		}
		return scanProfile{}, errScanHidden
	}
	abortScanProfile = func(id int) error {
		for index := range m.items {
			if m.items[index].ID == id {
				m.items[index].State = "aborted"
			}
		}
		return nil
	}
	return func() {
		saveScanProfile = previousSave
		loadScanProfile = previousLoad
		abortScanProfile = previousAbort
	}
}

func scanOperator() authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "operator", Environments: []string{"*"}}},
	}
}

func scanViewer() authzSubject {
	return authzSubject{
		UserID: 5, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "viewer", Environments: []string{"*"}}},
	}
}

func readyProfile() scanProfile {
	return scanProfile{
		ProjectID: 10, AccountID: "123456789012", Region: "us-east-1",
		RoleARN: "arn:aws:iam::123456789012:role/OpsTrellisScan",
		Actions: []string{"ec2:DescribeInstances", "sts:GetCallerIdentity"},
	}
}

func TestAccountIdentityMismatchAborts(t *testing.T) {
	mem := &scanMem{}
	restore := mem.install()
	defer restore()
	mismatched := readyProfile()
	mismatched.RoleARN = "arn:aws:iam::210987654321:role/OpsTrellisScan"
	if _, err := prepareScanProfile(scanOperator(), mismatched); err != errScanIdentity || len(mem.items) != 0 {
		t.Fatalf("arn mismatch err %v rows %d", err, len(mem.items))
	}
	writable := readyProfile()
	writable.Actions = []string{"s3:PutObject"}
	if _, err := prepareScanProfile(scanOperator(), writable); err != errScanWrite || len(mem.items) != 0 {
		t.Fatalf("write err %v rows %d", err, len(mem.items))
	}
	if _, err := prepareScanProfile(scanViewer(), readyProfile()); err != errScanDenied || len(mem.items) != 0 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.items))
	}
	saved, err := prepareScanProfile(scanOperator(), readyProfile())
	if err != nil || !saved.ReadOnly || saved.State != "ready" || saved.AccountID != "123456789012" {
		t.Fatalf("saved %+v err %v", saved, err)
	}
	matched, err := assumeScanProfile(scanOperator(), saved.ID, "123456789012")
	if err != nil || matched.Aborted || !matched.CredentialsIssued || matched.TemporaryCredential != "" || matched.ExpiresAt == "" {
		t.Fatalf("matched %+v err %v", matched, err)
	}
	assumed, err := assumeScanProfile(scanOperator(), saved.ID, "999999999999")
	if err != errScanIdentity || !assumed.Aborted || assumed.CredentialsIssued || assumed.TemporaryCredential != "" || mem.items[0].State != "aborted" {
		t.Fatalf("assume %+v err %v state %s", assumed, err, mem.items[0].State)
	}
	again, err := assumeScanProfile(scanOperator(), saved.ID, "123456789012")
	if err != errScanIdentity || again.CredentialsIssued || again.TemporaryCredential != "" {
		t.Fatalf("after abort %+v err %v", again, err)
	}
}
