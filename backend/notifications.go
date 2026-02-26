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
	NotifyTeamsRequestApproved(req, "")
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
	NotifyTeamsRequestRejected(req, reason)
}

// NotifyPRCreated notifies the request creator that a PR was created for their request.
// Slack/Teams are always sent (for channel visibility) even when creator is nil.
func NotifyPRCreated(req *PRRequest, prURL string) {
	if req == nil {
		return
	}
	if req.CreatedBy != nil && *req.CreatedBy > 0 {
		msg := "Request #" + strconv.Itoa(req.ID) + " was approved and a PR was created."
		if prURL != "" {
			msg += " PR: " + prURL
		}
		reqID := req.ID
		_ = InsertUserNotification(*req.CreatedBy, &reqID, "pr_created", msg)
		sendNotificationEmailIfConfigured(*req.CreatedBy, "PR created", msg)
	}
	NotifySlackPRCreated(req, prURL)
	NotifyTeamsPRCreated(req, prURL)
}

// NotifySLABreach notifies the assignee (or creator) when a request exceeds SLA (overdue or due in 24h)
func NotifySLABreach(req *PRRequest) {
	if req == nil {
		return
	}
	targetID := 0
	if req.AssignedTo != nil && *req.AssignedTo > 0 {
		targetID = *req.AssignedTo
	} else if req.CreatedBy != nil && *req.CreatedBy > 0 {
		targetID = *req.CreatedBy
	}
	if targetID <= 0 {
		return
	}
	msg := "Request #" + strconv.Itoa(req.ID) + " is overdue or due within 24h. Team: " + req.Team + " | " + req.Cloud + " " + req.Service
	reqID := req.ID
	_ = InsertUserNotification(targetID, &reqID, "sla_breach", msg)
	sendNotificationEmailIfConfigured(targetID, "SLA breach: Request overdue", msg)
	NotifySlackSLABreach(req)
	NotifyTeamsSLABreach(req, targetID)
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

// sendNotificationEmailIfConfigured sends an email if SMTP is configured (env: SMTP_HOST).
func sendNotificationEmailIfConfigured(userID int, subject, body string) {
	if os.Getenv("SMTP_HOST") == "" {
		log.Printf("[Email] Skipping notification (SMTP_HOST not set) userID=%d subject=%q", userID, subject)
		return
	}
	user, err := GetUserByID(userID)
	if err != nil {
		log.Printf("[Email] GetUserByID failed userID=%d: %v", userID, err)
		return
	}
	if user == nil || user.Email == "" {
		log.Printf("[Email] Skipping notification - user %d has no email", userID)
		return
	}
	log.Printf("[Email] Sending notification to userID=%d email=%s subject=%q", userID, user.Email, subject)
	if err := SendEmail(user.Email, subject, body); err != nil {
		log.Printf("[Email] Failed to send to %s: %v", user.Email, err)
	}
}
