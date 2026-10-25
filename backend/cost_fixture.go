package main

import (
	"fmt"
	"time"
)

type costFixtureLine struct {
	Service     string
	Region      string
	ResourceID  string
	TeamSlug    string
	ProjectCode string
	Actual      string
	Amortized   string
}

func costFixtureLines() []costFixtureLine {
	return []costFixtureLine{
		{Service: "Amazon Elastic Compute Cloud", Region: "us-east-1", ResourceID: "i-0costc1api01", TeamSlug: "platform-team", ProjectCode: "", Actual: "410.250000", Amortized: "380.100000"},
		{Service: "Amazon Relational Database Service", Region: "us-east-1", ResourceID: "db-cost-c1", TeamSlug: "platform-team", ProjectCode: "", Actual: "220.000000", Amortized: "198.500000"},
		{Service: "Amazon Simple Storage Service", Region: "us-east-1", ResourceID: "cost-c1-logs", TeamSlug: "", ProjectCode: "", Actual: "41.800000", Amortized: "41.800000"},
	}
}

func importCostFixture(userID, connectionID int, complete bool) (*costExportResult, error) {
	conn, err := getCostConnection(userID, connectionID)
	if err != nil || conn == nil {
		return nil, fmt.Errorf("cost connection not found")
	}
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	lines := make([]costLineRow, 0, 3)
	for _, line := range costFixtureLines() {
		lines = append(lines, costLineRow{
			Service:     line.Service,
			Region:      line.Region,
			AccountID:   conn.AccountID,
			ResourceID:  line.ResourceID,
			TeamSlug:    line.TeamSlug,
			ProjectCode: line.ProjectCode,
			UsageDate:   start.Format("2006-01-02"),
			Actual:      line.Actual,
			Amortized:   line.Amortized,
			Currency:    "USD",
		})
	}
	label := "CUR fixture September 2026"
	if !complete {
		label = "Incomplete CUR fixture September 2026"
	}
	return persistCostExport(costExportIn{
		UserID:       userID,
		ConnectionID: connectionID,
		Source:       "fixture",
		Kind:         "fixture",
		Label:        label,
		WindowStart:  start,
		WindowEnd:    end,
		Complete:     complete,
		Lines:        lines,
		Now:          time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC),
	})
}
