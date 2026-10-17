package main

import (
	"strings"
	"testing"
	"time"
)

type approvalMem struct {
	items      []approvalSubject
	executions int
}

func (m *approvalMem) install() func() {
	previousSave := saveApprovalSubject
	previousLoad := loadApprovalSubject
	previousInvalidate := invalidateApproval
	previousExecution := savePromotionExecution
	saveApprovalSubject = func(item approvalSubject) (approvalSubject, error) {
		item.ID = len(m.items) + 1
		item.State = "approved"
		m.items = append(m.items, item)
		return item, nil
	}
	loadApprovalSubject = func(id int) (approvalSubject, error) {
		for _, item := range m.items {
			if item.ID == id {
				return item, nil
			}
		}
		return approvalSubject{}, errApprovalHidden
	}
	invalidateApproval = func(id int) error {
		for index := range m.items {
			if m.items[index].ID == id {
				m.items[index].State = "invalidated"
			}
		}
		return nil
	}
	savePromotionExecution = func(item promotionExecution) (promotionExecution, error) {
		m.executions++
		item.ID = m.executions
		return item, nil
	}
	return func() {
		saveApprovalSubject = previousSave
		loadApprovalSubject = previousLoad
		invalidateApproval = previousInvalidate
		savePromotionExecution = previousExecution
	}
}

func approvalOperator() authzSubject {
	return authzSubject{
		UserID: 4, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "operator", Environments: []string{"*"}}},
	}
}

func approvalViewer() authzSubject {
	return authzSubject{
		UserID: 5, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: "viewer", Environments: []string{"*"}}},
	}
}

func exactApproval() approvalSubject {
	return approvalSubject{
		ProjectID: 10, CommitHash: "abc123", PlanHash: "plan-1", Environment: "prod",
		TemplateKey: supportedTemplateKey, SchemaVersion: 1, GeneratorVersion: "hcl-1", ModuleVersion: "1.0.0",
	}
}

func TestChangedPlanCannotReuseApproval(t *testing.T) {
	mem := &approvalMem{}
	restore := mem.install()
	defer restore()
	saved, err := recordApprovalSubject(approvalOperator(), exactApproval())
	if err != nil || saved.State != "approved" || saved.SubjectHash == "" || saved.PlanHash != "plan-1" {
		t.Fatalf("record %+v err %v", saved, err)
	}
	changed := exactApproval()
	changed.PlanHash = "plan-2"
	reused, err := reuseApprovalSubject(approvalOperator(), saved.ID, changed)
	if err != errApprovalInvalidated || reused.State != "invalidated" || changed.PlanHash != "plan-2" || mem.executions != 0 {
		t.Fatalf("reuse %+v err %v executions %d", reused, err, mem.executions)
	}
	if _, err := recordApprovalSubject(approvalViewer(), exactApproval()); err != errApprovalDenied || len(mem.items) != 1 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.items))
	}
}

func TestProductionUnknownPolicyIsExplicit(t *testing.T) {
	decision := promotionPreflight("prod", "unknown", "approved", "fresh", "verified")
	policyUnknown := false
	for _, gate := range decision.Gates {
		if gate.Name == "policy" && gate.State == "unknown" && gate.Reason == "production policy is unknown" {
			policyUnknown = true
		}
		if gate.State == "unknown" && gate.Reason == "policy allows promotion" {
			t.Fatalf("unknown policy was treated as a pass: %+v", decision)
		}
	}
	if !policyUnknown || decision.Decision != "unknown" || decision.ExecutionRequested {
		t.Fatalf("decision %+v", decision)
	}
	stale := promotionPreflight("prod", "allow", "invalidated", "stale", "unverified")
	if stale.Decision != "fail" || len(stale.Blockers) < 2 {
		t.Fatalf("stale decision %+v", stale)
	}
}

func TestDeclinedPromotionCreatesNoExecution(t *testing.T) {
	mem := &approvalMem{}
	restore := mem.install()
	defer restore()
	saved, err := recordApprovalSubject(approvalOperator(), exactApproval())
	if err != nil {
		t.Fatal(err)
	}
	changed := exactApproval()
	changed.PlanHash = "plan-2"
	if _, err := releasePromotion(approvalOperator(), saved.ID, changed, "allow", "fresh", "verified"); err != errPromotionDeclined || mem.executions != 0 {
		t.Fatalf("declined err %v executions %d", err, mem.executions)
	}
	fresh := exactApproval()
	released, err := recordApprovalSubject(approvalOperator(), fresh)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := releasePromotion(approvalOperator(), released.ID, fresh, "unknown", "stale", "unverified"); err != errPromotionDeclined || mem.executions != 0 || mem.items[len(mem.items)-1].State != "approved" {
		t.Fatalf("blocked err %v executions %d state %s", err, mem.executions, mem.items[len(mem.items)-1].State)
	}
	execution, err := releasePromotion(approvalOperator(), released.ID, fresh, "allow", "fresh", "verified")
	if err != nil || execution.ID != 1 || mem.executions != 1 || execution.ApprovalID != released.ID {
		t.Fatalf("release %+v err %v executions %d", execution, err, mem.executions)
	}
}

func TestAuditedExceptionExpiresAndStaysExplicit(t *testing.T) {
	mem := &approvalMem{}
	restore := mem.install()
	defer restore()
	var exceptions []promotionException
	audits := 0
	previousSave := savePromotionException
	previousList := listPromotionExceptions
	previousClock := promotionClock
	now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	promotionClock = func() time.Time { return now }
	savePromotionException = func(item promotionException) (promotionException, error) {
		item.ID = len(exceptions) + 1
		exceptions = append(exceptions, item)
		audits++
		return item, nil
	}
	listPromotionExceptions = func(id int) ([]promotionException, error) {
		var rows []promotionException
		for _, item := range exceptions {
			if item.ApprovalID == id {
				rows = append(rows, item)
			}
		}
		return rows, nil
	}
	defer func() {
		savePromotionException = previousSave
		listPromotionExceptions = previousList
		promotionClock = previousClock
	}()
	saved, err := recordApprovalSubject(approvalOperator(), exactApproval())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := recordPromotionException(approvalOperator(), saved.ID, "policy", "", now.Add(time.Hour)); err != errApprovalInvalid || audits != 0 {
		t.Fatalf("blank reason err %v audits %d", err, audits)
	}
	if _, err := recordPromotionException(approvalOperator(), saved.ID, "policy", "ticket 42", now.Add(-time.Minute)); err != errApprovalInvalid || audits != 0 {
		t.Fatalf("expired err %v audits %d", err, audits)
	}
	if _, err := recordPromotionException(approvalViewer(), saved.ID, "policy", "ticket 42", now.Add(time.Hour)); err != errApprovalDenied || audits != 0 {
		t.Fatalf("viewer err %v audits %d", err, audits)
	}
	recorded, err := recordPromotionException(approvalOperator(), saved.ID, "policy", "ticket 42", now.Add(time.Hour))
	if err != nil || recorded.ActorUserID != 4 || recorded.Reason != "ticket 42" || audits != 1 {
		t.Fatalf("record %+v err %v audits %d", recorded, err, audits)
	}
	current := promotionPreflightAt("prod", "unknown", "approved", "fresh", "verified", saved.ID, now)
	if current.Decision != "pass" || current.ExecutionRequested || mem.executions != 0 || !exceptionGate(current, "ticket 42") {
		t.Fatalf("current %+v executions %d", current, mem.executions)
	}
	denied := promotionPreflightAt("prod", "deny", "approved", "fresh", "verified", saved.ID, now)
	if denied.Decision != "fail" {
		t.Fatalf("deny %+v", denied)
	}
	expired := promotionPreflightAt("prod", "unknown", "approved", "fresh", "verified", saved.ID, now.Add(2*time.Hour))
	if expired.Decision != "unknown" || exceptionGate(expired, "ticket 42") {
		t.Fatalf("expired %+v", expired)
	}
	now = now.Add(2 * time.Hour)
	if _, err := releasePromotion(approvalOperator(), saved.ID, exactApproval(), "unknown", "fresh", "verified"); err != errPromotionDeclined || mem.executions != 0 {
		t.Fatalf("late release err %v executions %d", err, mem.executions)
	}
	now = now.Add(-2 * time.Hour)
	execution, err := releasePromotion(approvalOperator(), saved.ID, exactApproval(), "unknown", "fresh", "verified")
	if err != nil || execution.ID != 1 || mem.executions != 1 {
		t.Fatalf("excepted release %+v err %v executions %d", execution, err, mem.executions)
	}
	changed := exactApproval()
	changed.PlanHash = "plan-2"
	if _, err := releasePromotion(approvalOperator(), saved.ID, changed, "unknown", "fresh", "verified"); err != errPromotionDeclined || mem.executions != 1 {
		t.Fatalf("changed plan err %v executions %d", err, mem.executions)
	}
}

func exceptionGate(decision promotionDecision, reason string) bool {
	for _, gate := range decision.Gates {
		if gate.Name == "policy" && gate.State == "exception" && strings.Contains(gate.Reason, reason) {
			return true
		}
	}
	return false
}
