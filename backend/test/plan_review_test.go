package main

import "testing"

const samplePlan = "\x1b[1mTerraform will perform the following actions:\x1b[0m\n\n" +
	"  # aws_db_instance.main must be replaced\n" +
	"-/+ resource \"aws_db_instance\" \"main\" {\n  }\n\n" +
	"  # aws_s3_bucket.logs will be destroyed\n" +
	"  - resource \"aws_s3_bucket\" \"logs\" {\n  }\n\n" +
	"  # aws_security_group.web will be updated in-place\n" +
	"  ~ resource \"aws_security_group\" \"web\" {\n  }\n\n" +
	"  # module.net.aws_subnet.private[\"a\"] will be created\n" +
	"  + resource \"aws_subnet\" \"private\" {\n  }\n\n" +
	"Plan: 2 to add, 1 to change, 2 to destroy.\n"

func TestParseTerraformPlanCountsAndOrder(t *testing.T) {
	review := parseTerraformPlan(samplePlan)
	if !review.HasPlan || review.NoChanges {
		t.Fatalf("expected a plan with changes, got %+v", review)
	}
	if review.Add != 2 || review.Change != 1 || review.Destroy != 2 || review.Replace != 1 || review.DestroyOnly != 1 {
		t.Fatalf("unexpected counts: %+v", review)
	}
	if len(review.Changes) != 4 {
		t.Fatalf("expected 4 changes, got %d", len(review.Changes))
	}
	if review.Changes[0].Action != "destroy" || review.Changes[0].Address != "aws_s3_bucket.logs" {
		t.Fatalf("destroys should sort first, got %+v", review.Changes[0])
	}
	if review.Changes[3].Address != `module.net.aws_subnet.private["a"]` {
		t.Fatalf("module addresses should be kept intact, got %q", review.Changes[3].Address)
	}
}

func TestParseTerraformPlanNoChanges(t *testing.T) {
	review := parseTerraformPlan("No changes. Your infrastructure matches the configuration.")
	if !review.HasPlan || !review.NoChanges || planDestroysResources(review) {
		t.Fatalf("expected a no-op plan, got %+v", review)
	}
}

func TestParseTerraformPlanWithoutSummaryLine(t *testing.T) {
	review := parseTerraformPlan("  # aws_instance.api will be destroyed\n")
	if review.Destroy != 1 || review.DestroyOnly != 1 {
		t.Fatalf("expected destroy counted from header, got %+v", review)
	}
}

func TestPlanReviewStatusRequiresAckOnlyForProdDeletes(t *testing.T) {
	review := parseTerraformPlan(samplePlan)
	review.RequiresAck = true
	state, description := planReviewStatusFor(review)
	if state != "pending" || description != "Prod plan: 1 destroyed, 1 replaced. Acknowledge in OpsTrellis to merge." {
		t.Fatalf("got %q %q", state, description)
	}
	review.Acknowledged = true
	review.AcknowledgedBy = "maya"
	if state, _ := planReviewStatusFor(review); state != "success" {
		t.Fatalf("acknowledged plan should pass, got %q", state)
	}
	review.RequiresAck = false
	review.Acknowledged = false
	if state, _ := planReviewStatusFor(review); state != "success" {
		t.Fatalf("non-prod plan should pass, got %q", state)
	}
	if state, _ := planReviewStatusFor(planReview{}); state != "" {
		t.Fatalf("no plan should publish nothing, got %q", state)
	}
}
