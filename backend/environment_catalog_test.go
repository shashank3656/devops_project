package main

import "testing"

func TestInferEnvironmentType(t *testing.T) {
	cases := map[string]string{
		"dev":        "dev",
		"production": "prod",
		"uat":        "uat",
		"preview-42": "preview",
		"custom":     "other",
	}
	for input, want := range cases {
		if got := inferEnvironmentType(input); got != want {
			t.Fatalf("inferEnvironmentType(%q) = %q, want %q", input, got, want)
		}
	}
}
