package main

import (
	"strings"
	"testing"
)

func TestRunChatOpsCommandHelp(t *testing.T) {
	got := runChatOpsCommand("")
	if !strings.Contains(got, "approve") || !strings.Contains(got, "freeze") {
		t.Fatalf("unexpected help text: %s", got)
	}
}

func TestRunChatOpsCommandUnknown(t *testing.T) {
	got := runChatOpsCommand("not-a-command")
	if !strings.Contains(got, "Commands:") {
		t.Fatalf("unexpected reply: %s", got)
	}
}

func TestRunChatOpsRollbackHint(t *testing.T) {
	got := runChatOpsCommand("rollback 42")
	if !strings.Contains(got, "42") {
		t.Fatalf("expected request id in rollback reply, got %s", got)
	}
}
