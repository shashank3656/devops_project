package main

import (
	"testing"
	"time"
)

func TestOncallRosterUserRotatesByDay(t *testing.T) {
	roster := []int{4, 9, 2}
	if got := oncallRosterUser(roster, 1); got != 4 {
		t.Fatalf("day 1 = %d", got)
	}
	if got := oncallRosterUser(roster, 2); got != 9 {
		t.Fatalf("day 2 = %d", got)
	}
	if got := oncallRosterUser(roster, 3); got != 2 {
		t.Fatalf("day 3 = %d", got)
	}
	if got := oncallRosterUser(roster, 4); got != 4 {
		t.Fatalf("day 4 = %d", got)
	}
	if got := oncallRosterUser(nil, 1); got != 0 {
		t.Fatalf("empty = %d", got)
	}
}

func TestOncallProjectDayKeepsEachTeam(t *testing.T) {
	teams := []oncallProjectTeam{{ID: 1, Name: "Platform"}, {ID: 2, Name: "App"}}
	series := [][]oncallDutyDay{
		{{Date: "2026-10-01", Label: "1 Oct", Weekday: "Thursday", UserID: 4, Name: "Alex", Status: "scheduled"}},
		{{Date: "2026-10-01", Label: "1 Oct", Weekday: "Thursday", UserID: 9, Name: "Priya", Status: "pending", CoverUser: 3, CoverName: "Sam"}},
	}
	days := assembleOncallProjectDays(teams, series)
	if len(days) != 1 || len(days[0].Teams) != 2 {
		t.Fatalf("days = %#v", days)
	}
	if days[0].Teams[0].TeamName != "Platform" || days[0].Teams[0].UserID != 4 {
		t.Fatalf("platform = %#v", days[0].Teams[0])
	}
	if shiftFromDutyDay(oncallProjectTeam{ID: 1, Name: "Platform"}, oncallDutyDay{UserID: 4, Name: "Alex", BackupUserID: 9, BackupName: "Priya"}).BackupUserID != 9 {
		t.Fatal("shift should keep backup")
	}
	if days[0].Teams[1].TeamID != 2 || days[0].Teams[1].Status != "pending" || days[0].Teams[1].CoverUser != 3 {
		t.Fatalf("app = %#v", days[0].Teams[1])
	}
}

func TestOncallCoverIntervalAppliesWithoutRewritingRotation(t *testing.T) {
	row := oncallCoverRow{Date: "2026-10-30", EndDate: "2026-11-02", Status: "approved", FromUserID: 4, ToUserID: 9}
	if !oncallCoverCoversDate(row, "2026-10-30") || !oncallCoverCoversDate(row, "2026-11-02") || oncallCoverCoversDate(row, "2026-11-03") {
		t.Fatalf("interval overlay = %#v", row)
	}
	single := oncallCoverRow{Date: "2026-10-31", Status: "pending"}
	if !oncallCoverCoversDate(single, "2026-10-31") || oncallCoverCoversDate(single, "2026-11-01") {
		t.Fatalf("single-day overlay = %#v", single)
	}
}

func TestOncallWeeklyAssignmentUsesWeekday(t *testing.T) {
	schedule := &oncallSchedule{Days: []oncallScheduleDay{
		{Day: "friday", UserID: 4, BackupUserID: 9},
		{Day: "saturday", UserID: 2},
	}}
	if !oncallScheduleHasAssignment(schedule) {
		t.Fatal("assigned weekly schedule should count")
	}
	primary, backup := oncallScheduleAssignment(schedule, time.Friday)
	if primary != 4 || backup != 9 {
		t.Fatalf("friday = %d/%d", primary, backup)
	}
	primary, backup = oncallScheduleAssignment(schedule, time.Sunday)
	if primary != 0 || backup != 0 {
		t.Fatalf("sunday = %d/%d", primary, backup)
	}
}
