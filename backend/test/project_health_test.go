package main

import "testing"

func TestDoraBandThresholds(t *testing.T) {
	cases := []struct {
		key     string
		value   float64
		samples int
		want    string
	}{
		{"deploy_frequency", 10, 40, "elite"},
		{"deploy_frequency", 2, 8, "high"},
		{"deploy_frequency", 0.1, 1, "low"},
		{"lead_time", 5, 3, "elite"},
		{"lead_time", 800, 3, "low"},
		{"change_failure_rate", 12, 10, "medium"},
		{"time_to_restore", 0.5, 2, "elite"},
		{"lead_time", 0, 0, "none"},
	}
	for _, tc := range cases {
		if got := doraBand(tc.key, tc.value, tc.samples); got != tc.want {
			t.Errorf("doraBand(%s, %v) = %s, want %s", tc.key, tc.value, got, tc.want)
		}
	}
}

func TestBuildDoraMetrics(t *testing.T) {
	current := doraWindow{deployments: 30, leadHours: []float64{2, 10, 4}, failures: 3, recoveryHours: []float64{1, 3}}
	previous := doraWindow{deployments: 15, leadHours: []float64{20}, failures: 0}
	metrics := buildDoraMetrics(current, previous, 30)
	byKey := map[string]doraMetric{}
	for _, metric := range metrics {
		byKey[metric.Key] = metric
	}
	if got := byKey["deploy_frequency"].Value; got != 7 {
		t.Errorf("deploy frequency = %v, want 7 per week", got)
	}
	if got := byKey["lead_time"].Value; got != 4 {
		t.Errorf("lead time median = %v, want 4", got)
	}
	if got := byKey["change_failure_rate"].Value; got != 10 {
		t.Errorf("change failure rate = %v, want 10", got)
	}
	if got := byKey["time_to_restore"].Value; got != 2 {
		t.Errorf("time to restore median = %v, want 2", got)
	}
	if got := byKey["time_to_restore"].Previous; got != 0 {
		t.Errorf("previous time to restore = %v, want 0 with no samples", got)
	}
}
