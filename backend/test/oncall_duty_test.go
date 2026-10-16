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
