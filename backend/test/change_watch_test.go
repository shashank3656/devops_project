package main

import (
	"testing"
	"time"
)

func TestDetectWatchBreachesUsesRelativeAndSLO(t *testing.T) {
	baseline := serviceMetrics{P95Ms: 200, ErrorRatio: 0.002, Saturation: 0.4}
	hot := serviceMetrics{P95Ms: 400, ErrorRatio: 0.002, Saturation: 0.4}
	if reasons := detectWatchBreaches(&baseline, hot, nil); len(reasons) == 0 {
		t.Fatal("p95 400ms vs 200ms baseline should open a regression without an SLO")
	}
	slo := &serviceSLO{LatencyP95Ms: 2000}
	if reasons := detectWatchBreaches(&baseline, hot, slo); len(reasons) != 0 {
		t.Fatalf("400ms on a 2s SLO should be noise, got %v", reasons)
	}
	errors := serviceMetrics{P95Ms: 200, ErrorRatio: 0.03, Saturation: 0.4}
	if reasons := detectWatchBreaches(&baseline, errors, nil); len(reasons) == 0 {
		t.Fatal("error ratio +1pp should breach")
	}
}

func TestDecideWatchOutcomeClosesCleanWindow(t *testing.T) {
	until := time.Now().Add(-time.Minute)
	item := changeRequestRecord{Status: "monitoring", WatchUntil: &until}
	decision := decideWatchOutcome(item, nil, nil, time.Now(), false, nil)
	if !decision.CloseChange || decision.FailChange {
		t.Fatalf("clean expired watch should close: %+v", decision)
	}
	failed := decideWatchOutcome(item, nil, nil, time.Now(), true, nil)
	if !failed.FailChange {
		t.Fatal("expired watch with open regression should fail the change")
	}
}

func TestErrorBudgetBurnsAfterRepeatedBreaches(t *testing.T) {
	slo := serviceSLO{Service: "payments-api", Environment: "prod", ErrorRatio: 0.01, FreezeOnBudget: true}
	samples := []serviceMetrics{
		{ErrorRatio: 0.05},
		{ErrorRatio: 0.04},
		{ErrorRatio: 0.03},
		{ErrorRatio: 0.06},
	}
	budget := computeErrorBudget(slo, samples)
	if !budget.Burned || budget.BudgetRemaining != 0 {
		t.Fatalf("expected burned budget, got %+v", budget)
	}
	if sloBudget := computeErrorBudget(slo, []serviceMetrics{{ErrorRatio: 0.001}, {ErrorRatio: 0.002}}); sloBudget.Burned {
		t.Fatal("healthy samples should not burn the budget")
	}
}

func TestParseChangeWebhookMetrics(t *testing.T) {
	payload, err := parseChangeWebhookJSON([]byte(`{
		"repo":"acme/payments-api",
		"sha":"abc123",
		"environment":"prod",
		"metrics":{"p95_ms":180,"error_ratio":0.4,"saturation":42}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if payload.Metrics == nil || payload.Metrics.P95Ms != 180 {
		t.Fatalf("metrics = %+v", payload.Metrics)
	}
	if payload.Metrics.ErrorRatio != 0.4 {
		t.Fatalf("error ratio should stay a fraction, got %v", payload.Metrics.ErrorRatio)
	}
	if payload.Metrics.Saturation != 0.42 {
		t.Fatalf("saturation percent should normalize, got %v", payload.Metrics.Saturation)
	}
}
