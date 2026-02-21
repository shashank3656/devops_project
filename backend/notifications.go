package main

import (
	"log"
	"os"
	"strconv"
)

// NotifyRequestApproved notifies the request creator that the request was approved (moved to DevOps or similar).
func NotifyRequestApproved(req *PRRequest, message string) {
	if req == nil || req.CreatedBy == nil || *req.CreatedBy <= 0 {
		return
	}
	reqID := req.ID
	_ = InsertUserNotification(*req.CreatedBy, &reqID, "approved", message)
	sendNotificationEmailIfConfigured(*req.CreatedBy, "Request approved", message)
	NotifySlackRequestApproved(req, "")
}

// NotifyRequestRejected notifies the request creator that the request was rejected.
func NotifyRequestRejected(req *PRRequest, reason string) {
	if req == nil || req.CreatedBy == nil || *req.CreatedBy <= 0 {
		return
	}
	msg := "Your request #" + strconv.Itoa(req.ID) + " was rejected."
	if reason != "" {
		msg += " Reason: " + reason
	}
	reqID := req.ID
	_ = InsertUserNotification(*req.CreatedBy, &reqID, "rejected", msg)
	sendNotificationEmailIfConfigured(*req.CreatedBy, "Request rejected", msg)
	NotifySlackRequestRejected(req, reason)
}

// NotifyPRCreated notifies the request creator that a PR was created for their request.
func NotifyPRCreated(req *PRRequest, prURL string) {
	if req == nil || req.CreatedBy == nil || *req.CreatedBy <= 0 {
		return
	}
	msg := "Request #" + strconv.Itoa(req.ID) + " was approved and a PR was created."
	if prURL != "" {
		msg += " PR: " + prURL
	}
	reqID := req.ID
	_ = InsertUserNotification(*req.CreatedBy, &reqID, "pr_created", msg)
	sendNotificationEmailIfConfigured(*req.CreatedBy, "PR created", msg)
	NotifySlackPRCreated(req, prURL)
}

// NotifyTicketAssigned notifies the assignee that a ticket was assigned to them.
func NotifyTicketAssigned(req *PRRequest, assigneeID int) {
	if req == nil || assigneeID <= 0 {
		return
	}
	msg := "Ticket #" + strconv.Itoa(req.ID) + " (" + req.Team + "/" + req.Env + ", " + req.Cloud + " " + req.Service + ") was assigned to you."
	reqID := req.ID
	_ = InsertUserNotification(assigneeID, &reqID, "assigned", msg)
	sendNotificationEmailIfConfigured(assigneeID, "Ticket assigned", msg)
}

// sendNotificationEmailIfConfigured sends an email if SMTP is configured (env: SMTP_HOST or similar). No-op for now; hook for future.
func sendNotificationEmailIfConfigured(userID int, subject, body string) {
	// TODO: when SMTP is configured (e.g. SMTP_HOST), load user email and send
	_ = userID
	_ = subject
	_ = body
	if os.Getenv("SMTP_HOST") != "" {
		user, err := GetUserByID(userID)
		if err != nil || user == nil || user.Email == "" {
			return
		}
		log.Printf("[Email] Would send to %s: %s - %s", user.Email, subject, body)
	}
}
