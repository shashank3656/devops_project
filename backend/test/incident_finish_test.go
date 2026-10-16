package main

import "testing"

func TestIncidentFinishStatus(t *testing.T) {
	status, note, ok := incidentFinishStatus("close")
	if !ok || status != "closed" || note != "Closed." {
		t.Fatalf("close = %q %q %v", status, note, ok)
	}
	status, note, ok = incidentFinishStatus("cancel")
	if !ok || status != "cancelled" || note != "Cancelled." {
		t.Fatalf("cancel = %q %q %v", status, note, ok)
	}
	if _, _, ok = incidentFinishStatus("rollback"); ok {
		t.Fatal("rollback should stay on its own route")
	}
}
