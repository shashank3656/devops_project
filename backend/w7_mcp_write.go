package main

import (
	"fmt"
	"strings"
	"time"
)

func mcpActorCanWrite(userID int, managerOnly bool) error {
	if userID <= 0 {
		return fmt.Errorf("signed-in user required")
	}
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		return fmt.Errorf("user not found")
	}
	if user.Role == "admin" {
		return nil
	}
	if user.UserType != "devops_user" {
		return fmt.Errorf("DevOps access required")
	}
	if !managerOnly {
		return nil
	}
	prof, err := GetDevopsProfile(userID)
	if err != nil || prof == nil || !prof.IsManager {
		return fmt.Errorf("DevOps manager access required")
	}
	return nil
}

func mcpRefuseApply(text string) error {
	if queryAsksToApply(text) {
		return fmt.Errorf("SetuOps will not apply terraform, kubectl, or helm from MCP")
	}
	return nil
}

func mcpCommentIncident(args map[string]any, userID int) (string, error) {
	comment := strings.TrimSpace(firstNonEmpty(stringFromAny(args["comment"]), stringFromAny(args["text"]), stringFromAny(args["note"])))
	if comment == "" {
		return "", fmt.Errorf("comment is required")
	}
	if err := mcpRefuseApply(comment); err != nil {
		return "", err
	}
	if err := mcpActorCanWrite(userID, false); err != nil {
		return "", err
	}
	item, err := lookupIncidentForMCP(intFromAny(args["id"]), firstNonEmpty(stringFromAny(args["incident_number"]), stringFromAny(args["number"])))
	if err != nil {
		return "", err
	}
	author := "operator"
	if user, err := GetUserByID(userID); err == nil && user != nil {
		author = firstNonEmpty(user.Username, author)
	}
	updated, err := appendIncidentOperatorComment(item, author, comment)
	if err != nil {
		return "", err
	}
	return marshalMCP(map[string]any{"incident": updated, "commented": true})
}

func mcpRequestRollback(args map[string]any, userID int) (string, error) {
	reason := strings.TrimSpace(firstNonEmpty(stringFromAny(args["reason"]), stringFromAny(args["comment"]), stringFromAny(args["query"])))
	if err := mcpRefuseApply(reason); err != nil {
		return "", err
	}
	if err := mcpActorCanWrite(userID, true); err != nil {
		return "", err
	}
	incidentID := intFromAny(args["incident_id"])
	if incidentID <= 0 {
		if number := firstNonEmpty(stringFromAny(args["incident_number"]), stringFromAny(args["number"])); number != "" {
			item, err := lookupIncidentForMCP(intFromAny(args["id"]), number)
			if err != nil {
				return "", err
			}
			incidentID = item.ID
		}
	}
	changeID := intFromAny(args["change_id"])
	if changeID <= 0 {
		if number := stringFromAny(args["change_number"]); number != "" {
			item, err := lookupChangeForMCP(0, number)
			if err != nil {
				return "", err
			}
			changeID = item.ID
		}
	}
	if incidentID <= 0 && changeID <= 0 {
		return "", fmt.Errorf("incident_id or change_id is required")
	}
	item, plan, err := executeChangeSHARollback(userID, incidentID, changeID)
	if err != nil {
		return "", err
	}
	return marshalMCP(map[string]any{
		"change":  item,
		"plan":    plan,
		"applied": false,
		"reason":  firstNonEmpty(reason, "MCP requested rollback CHG; SetuOps does not apply the revision."),
	})
}

func appendIncidentOperatorComment(item *requestIncident, author, comment string) (*requestIncident, error) {
	if item == nil || item.ID <= 0 {
		return nil, fmt.Errorf("incident not found")
	}
	if DB == nil {
		return nil, fmt.Errorf("database not available")
	}
	line := fmt.Sprintf("%s @%s: %s", time.Now().UTC().Format(time.RFC3339), firstNonEmpty(author, "operator"), strings.TrimSpace(comment))
	notes := strings.TrimSpace(item.Notes)
	if notes != "" {
		notes = notes + "\n" + line
	} else {
		notes = line
	}
	if _, err := execContext(`UPDATE request_incidents SET notes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, item.ID, notes); err != nil {
		return nil, err
	}
	return getRequestIncidentByID(item.ID)
}
