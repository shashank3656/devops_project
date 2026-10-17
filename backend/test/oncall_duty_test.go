package main

import "testing"

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
	if days[0].Teams[1].TeamID != 2 || days[0].Teams[1].Status != "pending" || days[0].Teams[1].CoverUser != 3 {
		t.Fatalf("app = %#v", days[0].Teams[1])
	}
}
