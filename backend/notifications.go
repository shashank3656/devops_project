package main

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
)

// NotifyRequestApproved notifies the request creator that the request was approved (moved to DevOps or similar).
func NotifyRequestApproved(req *PRRequest, message string) {
	if req == nil || req.CreatedBy == nil || *req.CreatedBy <= 0 {
		return
	}
	reqID := req.ID
	_ = InsertUserNotification(*req.CreatedBy, &reqID, req.ProjectID, "approved", message)
	sendNotificationEmailIfConfigured(*req.CreatedBy, "approved", "Request approved", message)
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
	_ = InsertUserNotification(*req.CreatedBy, &reqID, req.ProjectID, "rejected", msg)
	sendNotificationEmailIfConfigured(*req.CreatedBy, "rejected", "Request rejected", msg)
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
		_ = InsertUserNotification(*req.CreatedBy, &reqID, req.ProjectID, "pr_created", msg)
		sendNotificationEmailIfConfigured(*req.CreatedBy, "pr_created", "PR created", msg)
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
	_ = InsertUserNotification(targetID, &reqID, req.ProjectID, "sla_breach", msg)
	sendNotificationEmailIfConfigured(targetID, "sla_breach", "SLA breach: Request overdue", msg)
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
	_ = InsertUserNotification(assigneeID, &reqID, req.ProjectID, "assigned", msg)
	sendNotificationEmailIfConfigured(assigneeID, "assigned", "Ticket assigned", msg)
}

func NotifyProjectAssigned(userID int, project *ProjectCatalog, environments []string) {
	if userID <= 0 || project == nil {
		return
	}
	msg := fmt.Sprintf("You now have access to project %s (%s).", project.Name, project.Code)
	if len(environments) > 0 {
		msg += " Allowed environments: " + strings.Join(environments, ", ") + "."
	}
	_ = InsertUserNotification(userID, nil, &project.ID, "project_assigned", msg)
	sendNotificationEmailIfConfigured(userID, "project_assigned", "Project access granted", msg)
}

func NotifyProjectAccessUpdated(userID int, project *ProjectCatalog, environments []string) {
	if userID <= 0 || project == nil {
		return
	}
	msg := fmt.Sprintf("Your environment access changed for project %s (%s).", project.Name, project.Code)
	if len(environments) > 0 {
		msg += " Current environments: " + strings.Join(environments, ", ") + "."
	}
	_ = InsertUserNotification(userID, nil, &project.ID, "project_access_updated", msg)
	sendNotificationEmailIfConfigured(userID, "project_access_updated", "Project access updated", msg)
}

func NotifyProjectAccessRemoved(userID int, project *ProjectCatalog, environments []string) {
	if userID <= 0 || project == nil {
		return
	}
	msg := fmt.Sprintf("Your access was removed from project %s (%s).", project.Name, project.Code)
	if len(environments) > 0 {
		msg += " Removed environments: " + strings.Join(environments, ", ") + "."
	}
	_ = InsertUserNotification(userID, nil, &project.ID, "project_access_removed", msg)
	sendNotificationEmailIfConfigured(userID, "project_access_removed", "Project access removed", msg)
}

func NotifyProjectCatalogUpdated(userID int, project *ProjectCatalog) {
	if userID <= 0 || project == nil {
		return
	}
	msg := fmt.Sprintf("Project %s (%s) was updated. Review the latest environments, services, and approval rules before raising new requests.", project.Name, project.Code)
	_ = InsertUserNotification(userID, nil, &project.ID, "project_catalog_updated", msg)
	sendNotificationEmailIfConfigured(userID, "project_catalog_updated", "Project catalog updated", msg)
}

// sendNotificationEmailIfConfigured sends an email if SMTP is configured and user has not disabled this notification type.
func sendNotificationEmailIfConfigured(userID int, kind, subject, body string) {
	if !UserWantsEmailForKind(userID, kind) {
		log.Printf("[Email] Skipping %s email for userID=%d (user preference)", kind, userID)
		return
	}
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
	log.Printf("[Email] Queueing %s notification to userID=%d email=%s subject=%q", kind, userID, user.Email, subject)
	enqueueJob("notification_email", NotificationEmailJob{
		UserID:  userID,
		Kind:    kind,
		Subject: subject,
		Body:    body,
	})
}
