package main

import "testing"

func TestBuildOncallPersonLoadsCountsHours(t *testing.T) {
	days := map[string]int{"monday": 2, "tuesday": 2, "wednesday": 3, "thursday": 3, "friday": 3, "saturday": 4, "sunday": 4}
	backup := map[string]int{"monday": 3, "saturday": 2}
	people := buildOncallPersonLoads(days, backup, map[int]string{2: "Ada", 3: "Kai", 4: "Noor"}, map[int]int{2: 1, 4: 4}, []int{2, 3, 4})
	if len(people) != 3 {
		t.Fatalf("people = %#v", people)
	}
	byID := map[int]oncallPersonLoad{}
	for _, person := range people {
		byID[person.UserID] = person
	}
	if byID[2].AssignedHours != 48 || byID[2].OvernightHours != 16 || byID[2].WeekendHours != 0 || byID[2].IncidentCount != 1 {
		t.Fatalf("ada = %#v", byID[2])
	}
	if byID[4].WeekendHours != 48 || byID[4].IncidentCount != 4 {
		t.Fatalf("noor = %#v", byID[4])
	}
	if people[0].UserID != 3 || people[1].UserID != 4 {
		t.Fatalf("weekday hours first, then incident load: %#v", people)
	}
}

func TestSuggestFairerOncallDaysSpreadsPrimaries(t *testing.T) {
	days := map[string]int{"monday": 2, "tuesday": 2, "wednesday": 2, "thursday": 2, "friday": 2, "saturday": 2, "sunday": 2}
	backup := map[string]int{"monday": 3}
	suggested, note := suggestFairerOncallDays(days, backup, []int{2, 3})
	counts := map[int]int{}
	for _, day := range oncallWeekdays {
		counts[suggested[day]]++
		if suggested[day] == 0 {
			t.Fatalf("uncovered suggestion on %s", day)
		}
		if day == "monday" && suggested[day] == 3 {
			t.Fatal("monday primary must stay different from backup")
		}
	}
	if counts[2] < 3 || counts[3] < 3 {
		t.Fatalf("uneven suggestion %v note %s", suggested, note)
	}
	if note == "" {
		t.Fatal("expected a review note")
	}
}

func TestSuggestFairerOncallDaysNeedsPeople(t *testing.T) {
	_, note := suggestFairerOncallDays(nil, nil, nil)
	if note == "" {
		t.Fatal("empty team needs a note")
	}
}
