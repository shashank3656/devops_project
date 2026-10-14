package main

import (
	"testing"
	"time"
)

func TestOncallDSTAndOverlappingOverride(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 3, 8, 0, 0, 0, 0, location)
	end := time.Date(2026, 3, 8, 12, 0, 0, 0, location)
	at := time.Date(2026, 3, 8, 1, 30, 0, 0, location)
	version := oncallVersion{
		Timezone: "America/New_York",
		Shifts: []oncallShift{{
			Role: "primary", Name: "Ada", Start: start, End: end,
		}},
	}
	primary := resolveOncall(at, version)
	if primary.State != "responder" || primary.Name != "Ada" || primary.Role != "primary" {
		t.Fatalf("primary resolution = %#v", primary)
	}
	version.Overrides = []oncallOverride{{
		Name: "Kai", Start: at.Add(-time.Minute), End: at.Add(time.Hour), Actor: "manager", Reason: "handover",
	}}
	overridden := resolveOncall(at, version)
	if overridden.State != "responder" || overridden.Name != "Kai" || overridden.Role != "override" {
		t.Fatalf("override resolution = %#v", overridden)
	}
	version.Overrides = append(version.Overrides, oncallOverride{
		Name: "Noor", Start: at.Add(-time.Minute), End: at.Add(time.Hour), Actor: "manager", Reason: "second handover",
	})
	gap := resolveOncall(at, version)
	if gap.State != "gap" || gap.Reason != "overlapping override" || gap.Name != "" {
		t.Fatalf("overlap resolution = %#v", gap)
	}
	version.Overrides = nil
	version.Gaps = []oncallGap{{Start: start, End: end, Reason: "uncovered period"}}
	uncovered := resolveOncall(at, version)
	if uncovered.State != "gap" || uncovered.Reason != "uncovered period" {
		t.Fatalf("uncovered resolution = %#v", uncovered)
	}
}

func TestOncallEscalationAckRaceAndRetry(t *testing.T) {
	episode := oncallEpisode{
		Key:       "incident-8",
		ProjectID: 1,
		Steps: []oncallStep{
			{Key: "incident-8:1", Name: "Ada", State: "queued"},
			{Key: "incident-8:2", Name: "Kai", State: "queued"},
		},
	}
	if err := dispatchOncallStep(&episode, 0, true, true); err != nil {
		t.Fatal(err)
	}
	if episode.Steps[0].State != "sent" || episode.Steps[0].Attempts != 1 || episode.Steps[1].State != "queued" {
		t.Fatalf("first step = %#v", episode.Steps)
	}
	if err := dispatchOncallStep(&episode, 0, true, true); err != nil {
		t.Fatal(err)
	}
	if episode.Steps[0].Attempts != 1 {
		t.Fatalf("retry created another attempt: %#v", episode.Steps[0])
	}
	failOncallDelivery(&episode, 0)
	if episode.Steps[0].State != "failed" || episode.Acknowledged {
		t.Fatalf("failure looked like acknowledgement: %#v", episode)
	}
	episode.Steps[0].State = "sent"
	acknowledgeOncall(&episode)
	if err := dispatchOncallStep(&episode, 1, true, true); err != nil {
		t.Fatal(err)
	}
	if episode.Steps[1].State != "cancelled" || episode.Steps[1].Dispatched {
		t.Fatalf("queued step was dispatched after acknowledgement: %#v", episode.Steps[1])
	}
	if episode.Steps[0].State != "sent" {
		t.Fatalf("sent attempt was dropped: %#v", episode.Steps[0])
	}
	if err := dispatchOncallStep(&episode, 0, false, true); err != errOncallDenied {
		t.Fatalf("revoked member = %v", err)
	}
	if err := dispatchOncallStep(&episode, 0, true, false); err != errOncallHidden {
		t.Fatalf("other project = %v", err)
	}
	if _, ok := oncallPublicName("ada@example.com"); ok {
		t.Fatal("email was accepted as a public name")
	}
}

func TestOncallRestartReplayKeepsOneAttempt(t *testing.T) {
	savedVersions, savedEpisodes := snapshotOncallCoverage()
	t.Cleanup(func() { replaceOncallCoverage(savedVersions, savedEpisodes) })
	replaceOncallCoverage(map[string]oncallVersion{}, map[string]oncallEpisode{})

	episode := oncallEpisode{
		Key:       "incident-restart",
		ProjectID: 1,
		Steps:     []oncallStep{{Key: "incident-restart:1", Name: "Ada", State: "queued"}},
	}
	if err := dispatchStoredEpisode(&episode, true); err != nil {
		t.Fatal(err)
	}
	if episode.Steps[0].Attempts != 1 || episode.Steps[0].State != "sent" {
		t.Fatalf("first dispatch = %#v", episode.Steps[0])
	}
	versions, episodes := snapshotOncallCoverage()
	replaceOncallCoverage(map[string]oncallVersion{}, map[string]oncallEpisode{})
	if _, stillThere := coverageStore.episodes["incident-restart"]; stillThere {
		t.Fatal("restart kept the in-memory episode")
	}
	replaceOncallCoverage(versions, episodes)
	replay := oncallEpisode{Key: "incident-restart", ProjectID: 1}
	if err := dispatchStoredEpisode(&replay, true); err != nil {
		t.Fatal(err)
	}
	if replay.Steps[0].Attempts != 1 || replay.Steps[0].State != "sent" {
		t.Fatalf("replay after restart = %#v", replay.Steps[0])
	}
}

func TestAdvanceStopsAfterAcknowledgement(t *testing.T) {
	episode := oncallEpisode{Steps: []oncallStep{{Key: "a", State: "sent"}, {Key: "b", State: "queued"}}}
	if advanceOncall(&episode) != 1 {
		t.Fatal("expected the next queued step")
	}
	acknowledgeOncall(&episode)
	if advanceOncall(&episode) != -1 {
		t.Fatal("acknowledgement still advanced")
	}
}
