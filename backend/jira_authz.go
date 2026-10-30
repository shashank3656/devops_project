package main

import "strings"

type jiraViewerAccess struct {
	UserID        int
	IsOwner       bool
	IsAdmin       bool
	CanView       bool
	CanLink       bool
	CanCreate     bool
	CanAdminister bool
}

func jiraUserIsPortalAdmin(userID int) bool {
	if DB == nil || userID <= 0 {
		return false
	}
	u, err := GetUserByID(userID)
	if err != nil || u == nil {
		return false
	}
	role := strings.ToLower(strings.TrimSpace(u.Role))
	return role == "admin" || role == "devops_manager" || u.IsPortalManager
}

func jiraAccessForSpace(userID, spaceID int) (jiraViewerAccess, error) {
	space, err := getJiraSpace(spaceID)
	if err != nil {
		return jiraViewerAccess{}, err
	}
	conn, err := getJiraConnection(space.ConnectionID)
	if err != nil {
		return jiraViewerAccess{}, err
	}
	access := jiraViewerAccess{UserID: userID, IsOwner: conn.OwnerUserID == userID, IsAdmin: jiraUserIsPortalAdmin(userID)}
	if access.IsOwner || access.IsAdmin {
		access.CanView = true
		access.CanLink = true
		access.CanCreate = true
		access.CanAdminister = true
		return access, nil
	}
	teams, err := GetTeamsForUserWithDetails(userID)
	if err != nil {
		return access, err
	}
	teamIDs := map[int]struct{}{}
	for _, team := range teams {
		teamIDs[team.ID] = struct{}{}
	}
	grants, err := listJiraSpaceAccess(spaceID)
	if err != nil {
		return access, err
	}
	for _, grant := range grants {
		if _, ok := teamIDs[grant.TeamID]; !ok {
			continue
		}
		access.CanView = access.CanView || grant.CanView
		access.CanLink = access.CanLink || grant.CanLink
		access.CanCreate = access.CanCreate || grant.CanCreate
		access.CanAdminister = access.CanAdminister || grant.CanAdminister
	}
	if access.CanLink || access.CanCreate || access.CanAdminister {
		access.CanView = true
	}
	return access, nil
}

func jiraCanViewIssue(userID int, issue jiraIssueView, spaceID int) bool {
	access, err := jiraAccessForSpace(userID, spaceID)
	if err != nil {
		return false
	}
	if !access.CanView {
		return false
	}
	if issue.Restricted && !access.IsOwner && !access.CanAdminister {
		return false
	}
	return true
}

func filterVisibleJiraLinks(userID int, links []jiraIssueLinkView) []jiraIssueLinkView {
	out := make([]jiraIssueLinkView, 0, len(links))
	for _, link := range links {
		space, err := findJiraSpaceForIssue(link.Issue.CloudID, link.Issue.IssueID)
		if err != nil {
			continue
		}
		if !jiraCanViewIssue(userID, link.Issue, space.ID) {
			continue
		}
		access, _ := jiraAccessForSpace(userID, space.ID)
		link.CanUnlink = access.CanLink || access.CanAdminister
		out = append(out, link)
	}
	return out
}

func findJiraSpaceForIssue(cloudID, issueID string) (jiraSpace, error) {
	var spaceID int
	err := DB.QueryRow(`SELECT COALESCE(space_id, 0) FROM jira_issues WHERE cloud_id = $1 AND issue_id = $2`, cloudID, issueID).Scan(&spaceID)
	if err != nil || spaceID == 0 {
		return jiraSpace{}, err
	}
	return getJiraSpace(spaceID)
}

func jiraCanManageConnection(userID int, conn jiraConnection) bool {
	return conn.OwnerUserID == userID || jiraUserIsPortalAdmin(userID)
}
