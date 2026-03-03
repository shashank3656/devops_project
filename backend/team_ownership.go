package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type TeamOwnershipMember struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	UserType string `json:"user_type"`
	Role     string `json:"role"`
}

type TeamOwnershipSummary struct {
	ID                    int                   `json:"id"`
	Name                  string                `json:"name"`
	Slug                  string                `json:"slug"`
	ApplicationID         string                `json:"application_id"`
	TeamType              string                `json:"team_type"`
	DefaultEnv            string                `json:"default_env"`
	DefaultCloud          string                `json:"default_cloud"`
	MemberCount           int                   `json:"member_count"`
	OwnerCount            int                   `json:"owner_count"`
	PortalUserCount       int                   `json:"portal_user_count"`
	DevOpsUserCount       int                   `json:"devops_user_count"`
	AssignedTemplateCount int                   `json:"assigned_template_count"`
	GlobalTemplateCount   int                   `json:"global_template_count"`
	VisibleTemplateCount  int                   `json:"visible_template_count"`
	RequestCount          int                   `json:"request_count"`
	PendingCount          int                   `json:"pending_count"`
	CompletedCount        int                   `json:"completed_count"`
	RejectedCount         int                   `json:"rejected_count"`
	InProgressCount       int                   `json:"in_progress_count"`
	DraftCount            int                   `json:"draft_count"`
	NeedsAttention        bool                  `json:"needs_attention"`
	LastRequestAt         string                `json:"last_request_at,omitempty"`
	Environments          []string              `json:"environments"`
	Clouds                []string              `json:"clouds"`
	OwnerNames            []string              `json:"owner_names"`
	TemplateNames         []string              `json:"template_names"`
	Members               []TeamOwnershipMember `json:"members"`
}

type TeamOwnershipResponse struct {
	Status  string                 `json:"status"`
	Summary map[string]int         `json:"summary"`
	Teams   []TeamOwnershipSummary `json:"teams"`
}

type teamOwnershipRequestAggregate struct {
	RequestCount    int
	PendingCount    int
	CompletedCount  int
	RejectedCount   int
	InProgressCount int
	DraftCount      int
	LastRequestAt   time.Time
	Environments    map[string]bool
	Clouds          map[string]bool
}

func teamOwnershipIsOwner(teamType, role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	if strings.ToLower(strings.TrimSpace(teamType)) == "devops" {
		return role == "lead"
	}
	return role == "manager" || role == "lead"
}

func loadTeamOwnershipMembers() (map[int][]TeamOwnershipMember, error) {
	rows, err := DB.Query(`
		SELECT m.team_id, m.user_id, COALESCE(u.username, ''), COALESCE(u.email, ''), COALESCE(u.user_type, 'portal_user'), COALESCE(m.role, '')
		FROM team_members m
		INNER JOIN users u ON u.id = m.user_id
		ORDER BY m.team_id, u.username
	`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return map[int][]TeamOwnershipMember{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	grouped := make(map[int][]TeamOwnershipMember)
	for rows.Next() {
		var teamID int
		var member TeamOwnershipMember
		if err := rows.Scan(&teamID, &member.UserID, &member.Username, &member.Email, &member.UserType, &member.Role); err != nil {
			return nil, err
		}
		grouped[teamID] = append(grouped[teamID], member)
	}
	return grouped, nil
}

func loadTeamOwnershipRequestAggregates() (map[string]teamOwnershipRequestAggregate, error) {
	rows, err := DB.Query(`
		SELECT COALESCE(team, ''), COALESCE(env, ''), COALESCE(cloud, ''), COALESCE(status, ''), COUNT(*), MAX(updated_at)
		FROM pr_requests
		GROUP BY team, env, cloud, status
	`)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return map[string]teamOwnershipRequestAggregate{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	grouped := make(map[string]teamOwnershipRequestAggregate)
	for rows.Next() {
		var teamKey string
		var env string
		var cloud string
		var status string
		var count int
		var lastUpdated time.Time
		if err := rows.Scan(&teamKey, &env, &cloud, &status, &count, &lastUpdated); err != nil {
			return nil, err
		}
		normalizedTeam := strings.ToLower(strings.TrimSpace(teamKey))
		if normalizedTeam == "" {
			continue
		}
		aggregate := grouped[normalizedTeam]
		aggregate.RequestCount += count
		switch status {
		case "completed":
			aggregate.CompletedCount += count
		case "rejected":
			aggregate.RejectedCount += count
		case "in_progress":
			aggregate.InProgressCount += count
		case "draft":
			aggregate.DraftCount += count
		case "pending_approval", "pending_devops_approval", "pending_user_manager_approval":
			aggregate.PendingCount += count
		}
		if aggregate.Environments == nil {
			aggregate.Environments = make(map[string]bool)
		}
		if aggregate.Clouds == nil {
			aggregate.Clouds = make(map[string]bool)
		}
		if trimmedEnv := strings.TrimSpace(env); trimmedEnv != "" {
			aggregate.Environments[trimmedEnv] = true
		}
		if trimmedCloud := strings.TrimSpace(cloud); trimmedCloud != "" {
			aggregate.Clouds[trimmedCloud] = true
		}
		if aggregate.LastRequestAt.IsZero() || lastUpdated.After(aggregate.LastRequestAt) {
			aggregate.LastRequestAt = lastUpdated
		}
		grouped[normalizedTeam] = aggregate
	}
	return grouped, nil
}

func buildTeamOwnershipSummary() (TeamOwnershipResponse, error) {
	resp := TeamOwnershipResponse{
		Status: "ok",
		Summary: map[string]int{
			"total_teams":          0,
			"portal_teams":         0,
			"devops_teams":         0,
			"total_members":        0,
			"assigned_templates":   0,
			"global_templates":     0,
			"teams_without_owner":  0,
			"teams_needing_action": 0,
		},
		Teams: []TeamOwnershipSummary{},
	}
	if DB == nil {
		return resp, nil
	}

	teams, err := GetTeams()
	if err != nil {
		return resp, err
	}
	membersByTeam, err := loadTeamOwnershipMembers()
	if err != nil {
		return resp, err
	}
	requestAggregates, err := loadTeamOwnershipRequestAggregates()
	if err != nil {
		return resp, err
	}
	templates, err := ListRequestTemplates()
	if err != nil {
		return resp, err
	}

	assignedTemplateNames := make(map[int][]string)
	globalTemplateCount := 0
	for _, template := range templates {
		if template.VisibleToAll || len(template.Teams) == 0 {
			globalTemplateCount++
			continue
		}
		for _, team := range template.Teams {
			assignedTemplateNames[team.ID] = append(assignedTemplateNames[team.ID], template.Name)
		}
	}
	resp.Summary["global_templates"] = globalTemplateCount

	filteredTeams := make([]Team, 0, len(teams))
	for _, team := range teams {
		filteredTeams = append(filteredTeams, team)
	}
	sort.Slice(filteredTeams, func(i, j int) bool {
		if strings.ToLower(filteredTeams[i].TeamType) == strings.ToLower(filteredTeams[j].TeamType) {
			return strings.ToLower(filteredTeams[i].Name) < strings.ToLower(filteredTeams[j].Name)
		}
		return strings.ToLower(filteredTeams[i].TeamType) < strings.ToLower(filteredTeams[j].TeamType)
	})

	for _, team := range filteredTeams {
		resp.Summary["total_teams"]++
		if strings.ToLower(team.TeamType) == "devops" {
			resp.Summary["devops_teams"]++
		} else {
			resp.Summary["portal_teams"]++
		}

		summary := TeamOwnershipSummary{
			ID:                   team.ID,
			Name:                 team.Name,
			Slug:                 team.Slug,
			ApplicationID:        team.ApplicationID,
			TeamType:             team.TeamType,
			DefaultEnv:           team.DefaultEnv,
			DefaultCloud:         team.DefaultCloud,
			GlobalTemplateCount:  0,
			VisibleTemplateCount: 0,
			Environments:         []string{},
			Clouds:               []string{},
			OwnerNames:           []string{},
			TemplateNames:        []string{},
			Members:              membersByTeam[team.ID],
		}

		for _, member := range summary.Members {
			summary.MemberCount++
			resp.Summary["total_members"]++
			switch strings.ToLower(strings.TrimSpace(member.UserType)) {
			case "devops_user":
				summary.DevOpsUserCount++
			default:
				summary.PortalUserCount++
			}
			if teamOwnershipIsOwner(team.TeamType, member.Role) {
				summary.OwnerCount++
				summary.OwnerNames = append(summary.OwnerNames, member.Username)
			}
		}

		summary.TemplateNames = append(summary.TemplateNames, assignedTemplateNames[team.ID]...)
		sort.Strings(summary.TemplateNames)
		summary.AssignedTemplateCount = len(summary.TemplateNames)
		resp.Summary["assigned_templates"] += summary.AssignedTemplateCount
		if strings.ToLower(team.TeamType) == "portal" {
			summary.GlobalTemplateCount = globalTemplateCount
		}
		summary.VisibleTemplateCount = summary.AssignedTemplateCount + summary.GlobalTemplateCount

		requestKeys := []string{strings.ToLower(strings.TrimSpace(team.Name))}
		if slugKey := strings.ToLower(strings.TrimSpace(team.Slug)); slugKey != "" && slugKey != requestKeys[0] {
			requestKeys = append(requestKeys, slugKey)
		}
		seenEnvironments := make(map[string]bool)
		seenClouds := make(map[string]bool)
		for _, requestKey := range requestKeys {
			aggregate, ok := requestAggregates[requestKey]
			if !ok {
				continue
			}
			summary.RequestCount += aggregate.RequestCount
			summary.PendingCount += aggregate.PendingCount
			summary.CompletedCount += aggregate.CompletedCount
			summary.RejectedCount += aggregate.RejectedCount
			summary.InProgressCount += aggregate.InProgressCount
			summary.DraftCount += aggregate.DraftCount
			if summary.LastRequestAt == "" || (!aggregate.LastRequestAt.IsZero() && aggregate.LastRequestAt.Format(time.RFC3339) > summary.LastRequestAt) {
				if !aggregate.LastRequestAt.IsZero() {
					summary.LastRequestAt = aggregate.LastRequestAt.Format(time.RFC3339)
				}
			}
			for env := range aggregate.Environments {
				if !seenEnvironments[env] {
					seenEnvironments[env] = true
					summary.Environments = append(summary.Environments, env)
				}
			}
			for cloud := range aggregate.Clouds {
				if !seenClouds[cloud] {
					seenClouds[cloud] = true
					summary.Clouds = append(summary.Clouds, cloud)
				}
			}
		}
		sort.Strings(summary.Environments)
		sort.Strings(summary.Clouds)

		summary.NeedsAttention = summary.OwnerCount == 0 || summary.MemberCount == 0 || (strings.ToLower(team.TeamType) == "portal" && summary.VisibleTemplateCount == 0)
		if summary.OwnerCount == 0 {
			resp.Summary["teams_without_owner"]++
		}
		if summary.NeedsAttention {
			resp.Summary["teams_needing_action"]++
		}

		resp.Teams = append(resp.Teams, summary)
	}

	return resp, nil
}

func adminTeamOwnershipHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := requireAdmin(w, r); !ok {
		return
	}

	resp, err := buildTeamOwnershipSummary()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "error": "failed to load team ownership"})
		return
	}

	if r.URL.Query().Get("format") == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=team-ownership.csv")
		writeCSV := func(values ...string) string {
			for i, value := range values {
				if strings.Contains(value, ",") || strings.Contains(value, "\"") || strings.Contains(value, "\n") {
					values[i] = "\"" + strings.ReplaceAll(strings.ReplaceAll(value, "\"", "\"\""), "\n", " ") + "\""
				}
			}
			return strings.Join(values, ",")
		}
		_, _ = w.Write([]byte(writeCSV(
			"id", "name", "type", "group_id", "members", "owners", "assigned_templates", "visible_templates",
			"requests", "pending", "completed", "rejected", "in_progress", "draft", "environments", "clouds", "last_request_at",
		) + "\n"))
		for _, team := range resp.Teams {
			_, _ = w.Write([]byte(writeCSV(
				strconv.Itoa(team.ID),
				team.Name,
				team.TeamType,
				team.ApplicationID,
				strconv.Itoa(team.MemberCount),
				strconv.Itoa(team.OwnerCount),
				strconv.Itoa(team.AssignedTemplateCount),
				strconv.Itoa(team.VisibleTemplateCount),
				strconv.Itoa(team.RequestCount),
				strconv.Itoa(team.PendingCount),
				strconv.Itoa(team.CompletedCount),
				strconv.Itoa(team.RejectedCount),
				strconv.Itoa(team.InProgressCount),
				strconv.Itoa(team.DraftCount),
				strings.Join(team.Environments, " | "),
				strings.Join(team.Clouds, " | "),
				team.LastRequestAt,
			) + "\n"))
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
