package main

import (
	"strings"
	"testing"
	"time"
)

func TestDeploymentVerificationMissingTelemetryIsInconclusive(t *testing.T) {
	lookupChangeAvailability = func(changeRequestRecord, time.Time, time.Time) (*availabilitySample, *availabilitySample) {
		return nil, nil
	}
	t.Cleanup(func() { lookupChangeAvailability = lookupChangeAvailabilityFromDB })

	got := buildChangeDeploymentVerification(changeRequestRecord{
		Status:      "monitoring",
		Environment: "prod",
		SHA:         "abc1234",
	})
	if got.State != "inconclusive" || got.Label != "Inconclusive" {
		t.Fatalf("missing telemetry must stay Inconclusive, got %s %s", got.State, got.Label)
	}
	if got.State == "healthy" {
		t.Fatal("missing telemetry is never Healthy")
	}
}

func TestDeploymentVerificationHealthyRequiresAllSignals(t *testing.T) {
	lookupChangeAvailability = func(changeRequestRecord, time.Time, time.Time) (*availabilitySample, *availabilitySample) {
		return &availabilitySample{BPS: 9990, Quality: qualityValid, State: measureHealthy, Coverage: 9000},
			&availabilitySample{BPS: 9985, Quality: qualityValid, State: measureHealthy, Coverage: 9000}
	}
	t.Cleanup(func() { lookupChangeAvailability = lookupChangeAvailabilityFromDB })

	got := buildChangeDeploymentVerification(changeRequestRecord{
		Status:      "monitoring",
		Environment: "prod",
		SHA:         "abc1234",
		Baseline:    &serviceMetrics{P95Ms: 120, ErrorRatio: 0.01, Saturation: 0.2},
		LatestMetrics: &serviceMetrics{P95Ms: 130, ErrorRatio: 0.012, Saturation: 0.21},
	})
	if got.State != "healthy" || got.Label != "Healthy" {
		t.Fatalf("complete comparable samples should be Healthy, got %s %s %#v", got.State, got.Label, got.Reasons)
	}
}

func TestDeploymentVerificationDegradedLatency(t *testing.T) {
	lookupChangeAvailability = func(changeRequestRecord, time.Time, time.Time) (*availabilitySample, *availabilitySample) {
		return &availabilitySample{BPS: 9990, Quality: qualityValid, State: measureHealthy, Coverage: 9000},
			&availabilitySample{BPS: 9980, Quality: qualityValid, State: measureHealthy, Coverage: 9000}
	}
	t.Cleanup(func() { lookupChangeAvailability = lookupChangeAvailabilityFromDB })

	got := buildChangeDeploymentVerification(changeRequestRecord{
		Status:      "monitoring",
		Environment: "prod",
		Baseline:    &serviceMetrics{P95Ms: 100, ErrorRatio: 0.01, Saturation: 0.2},
		LatestMetrics: &serviceMetrics{P95Ms: 400, ErrorRatio: 0.011, Saturation: 0.21},
	})
	if got.State != "degraded" || got.Label != "Degraded" {
		t.Fatalf("latency regression must be Degraded, got %s %s", got.State, got.Label)
	}
}

func TestDeploymentVerificationInvalidAvailabilityStaysInconclusive(t *testing.T) {
	lookupChangeAvailability = func(changeRequestRecord, time.Time, time.Time) (*availabilitySample, *availabilitySample) {
		return &availabilitySample{BPS: 9990, Quality: qualityValid, State: measureHealthy, Coverage: 9000},
			&availabilitySample{BPS: 0, Quality: qualityInvalid, State: measureQueryFailed, Coverage: 0}
	}
	t.Cleanup(func() { lookupChangeAvailability = lookupChangeAvailabilityFromDB })

	got := buildChangeDeploymentVerification(changeRequestRecord{
		Status:      "resolved",
		Baseline:    &serviceMetrics{P95Ms: 100, ErrorRatio: 0.01, Saturation: 0.2},
		LatestMetrics: &serviceMetrics{P95Ms: 110, ErrorRatio: 0.01, Saturation: 0.2},
	})
	if got.State != "inconclusive" {
		t.Fatalf("invalid availability must stay Inconclusive, got %s", got.State)
	}
}

func TestListedDeploymentVerificationNeverHealthyWithoutAvailability(t *testing.T) {
	got := buildListedDeploymentVerification(changeRequestRecord{
		Status:        "monitoring",
		Environment:   "prod",
		Baseline:      &serviceMetrics{P95Ms: 100, ErrorRatio: 0.01, Saturation: 0.2},
		LatestMetrics: &serviceMetrics{P95Ms: 110, ErrorRatio: 0.01, Saturation: 0.2},
	})
	if got.State == "healthy" {
		t.Fatal("listed verification without availability samples is never Healthy")
	}
	if got.State != "inconclusive" {
		t.Fatalf("got %s", got.State)
	}
}

func TestScheduledChangeIsNotHealthy(t *testing.T) {
	lookupChangeAvailability = func(changeRequestRecord, time.Time, time.Time) (*availabilitySample, *availabilitySample) {
		return &availabilitySample{BPS: 9990, Quality: qualityValid, State: measureHealthy, Coverage: 9000},
			&availabilitySample{BPS: 9990, Quality: qualityValid, State: measureHealthy, Coverage: 9000}
	}
	t.Cleanup(func() { lookupChangeAvailability = lookupChangeAvailabilityFromDB })

	got := buildChangeDeploymentVerification(changeRequestRecord{
		Status:      "scheduled",
		Baseline:    &serviceMetrics{P95Ms: 100, ErrorRatio: 0.01, Saturation: 0.2},
		LatestMetrics: &serviceMetrics{P95Ms: 100, ErrorRatio: 0.01, Saturation: 0.2},
	})
	if got.State == "healthy" {
		t.Fatal("a change that has not deployed is never Healthy")
	}
	if !strings.Contains(strings.ToLower(got.Label), "inconclusive") {
		t.Fatalf("got %s", got.Label)
	}
}
