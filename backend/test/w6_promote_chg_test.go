package main

import "testing"

func TestIsWatchableChangeType(t *testing.T) {
	if !isWatchableChangeType("standard") || !isWatchableChangeType("normal") {
		t.Fatal("standard/normal should be watchable")
	}
	if isWatchableChangeType("preview") || isWatchableChangeType("flag") {
		t.Fatal("preview/flag should not be the hop SHA source")
	}
}

func TestBuildPromotionHopPayload(t *testing.T) {
	dev := buildPromotionHopPayload("preview", "dev", "checkout", "acme/api", "abc123", "prev", 9, 3)
	if dev.SHA != "abc123" || dev.Environment != "dev" || dev.PreviousSHA != "prev" {
		t.Fatalf("%+v", dev)
	}
	if dev.ChangeType != "standard" || dev.RequestID != 9 {
		t.Fatalf("%+v", dev)
	}
	prod := buildPromotionHopPayload("uat", "prod", "checkout", "acme/api", "abc123", "prev", 10, 3)
	if prod.ChangeType != "normal" {
		t.Fatalf("prod hop should use normal so CAB stays, got %s", prod.ChangeType)
	}
}

func TestLastWatchableChangeEmpty(t *testing.T) {
	if lastWatchableChange("acme/api", "checkout", "dev") != nil {
		t.Fatal("empty catalog")
	}
}

func TestPromotionHopNotice(t *testing.T) {
	if got := promotionHopNotice("uat", nil); got != "Request created for uat. Edit and submit from History." {
		t.Fatalf("%s", got)
	}
	if got := promotionHopNotice("prod", &changeRequestRecord{ChangeNumber: "CHG0000042"}); got != "Request created for prod as CHG0000042. Edit and submit from History." {
		t.Fatalf("%s", got)
	}
}
