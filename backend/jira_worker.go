package main

import (
	"log"
	"time"
)

func startJiraWorkerScheduler() {
	go func() {
		time.Sleep(12 * time.Second)
		runJiraWorkerCycle()
		ops := time.NewTicker(15 * time.Second)
		refresh := time.NewTicker(5 * time.Minute)
		remediate := time.NewTicker(10 * time.Minute)
		defer ops.Stop()
		defer refresh.Stop()
		defer remediate.Stop()
		for {
			select {
			case <-ops.C:
				runJiraWorkerCycle()
			case <-refresh.C:
				runJiraLinkedRefresh()
				runJiraWebhookRenewal()
			case <-remediate.C:
				runJiraRemediationCycle()
			}
		}
	}()
}

func runJiraWorkerCycle() {
	if DB == nil {
		return
	}
	reclaimStaleJiraOperations()
	ids, err := listDueJiraOperations(20)
	if err != nil {
		log.Printf("[jira] list operations failed")
		return
	}
	for _, id := range ids {
		processJiraOperation(id)
	}
}

func runJiraLinkedRefresh() {
	if DB == nil {
		return
	}
	conns, err := listEnabledJiraConnections()
	if err != nil {
		return
	}
	for _, conn := range conns {
		issues, err := listLinkedJiraIssueIDs(conn.ID)
		if err != nil {
			continue
		}
		for _, issue := range issues {
			_, _ = enqueueJiraIssueRefresh(conn.ID, 0, issue.CloudID, issue.IssueID, "scheduled_reconciliation")
		}
	}
}
