package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type AccessReviewMembership struct {
	TeamID        int    `json:"team_id"`
	TeamName      string `json:"team_name"`
	TeamSlug      string `json:"team_slug"`
	ApplicationID string `json:"application_id"`
	TeamType      string `json:"team_type"`
	Role          string `json:"role"`
}

type AccessReviewUser struct {
	ID              int                      `json:"id"`
	Username        string                   `json:"username"`
	Email           string                   `json:"email"`
	Role            string                   `json:"role"`
	Verified        bool                     `json:"verified"`
	UserType        string                   `json:"user_type"`
	IsPortalManager bool                     `json:"is_portal_manager"`
	DevopsProfile   *DevopsProfile           `json:"devops_profile,omitempty"`
	Memberships     []AccessReviewMembership `json:"memberships"`
}

func listAccessReviewUsers() ([]AccessReviewUser, error) {
	if DB == nil {
		return []AccessReviewUser{}, nil
	}
	rows, err := DB.Query(`
		SELECT
			u.id,
			u.username,
			u.email,
			COALESCE(u.role, 'viewer'),
			COALESCE(u.verified, false),
			COALESCE(u.user_type, 'portal_user'),
			COALESCE(u.is_portal_manager, false),
			t.id,
			COALESCE(t.name, ''),
			COALESCE(t.slug, ''),
			COALESCE(t.application_id, ''),
			COALESCE(t.team_type, 'portal'),
			COALESCE(m.role, '')
		FROM users u
		LEFT JOIN team_members m ON m.user_id = u.id
		LEFT JOIN teams t ON t.id = m.team_id
		WHERE u.role != 'admin' OR u.role IS NULL
		ORDER BY u.username, t.name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	userIndex := make(map[int]int)
	users := make([]AccessReviewUser, 0)
	for rows.Next() {
		var (
			userID          int
			username        string
			email           string
			role            string
			verified        bool
			userType        string
			isPortalManager bool
			teamID          sql.NullInt64
			teamName        string
			teamSlug        string
			applicationID   string
			teamType        string
			memberRole      string
		)
		if err := rows.Scan(
			&userID,
			&username,
			&email,
			&role,
			&verified,
			&userType,
			&isPortalManager,
			&teamID,
			&teamName,
			&teamSlug,
			&applicationID,
			&teamType,
			&memberRole,
		); err != nil {
			return nil, err
		}
		idx, exists := userIndex[userID]
		if !exists {
			user := AccessReviewUser{
				ID:              userID,
				Username:        username,
				Email:           email,
				Role:            role,
				Verified:        verified,
				UserType:        userType,
				IsPortalManager: isPortalManager,
				Memberships:     []AccessReviewMembership{},
			}
			if userType == "devops_user" {
				if profile, err := GetDevopsProfile(userID); err == nil && profile != nil {
					user.DevopsProfile = profile
				}
			}
			users = append(users, user)
			idx = len(users) - 1
			userIndex[userID] = idx
		}
		if teamID.Valid && teamID.Int64 > 0 {
			users[idx].Memberships = append(users[idx].Memberships, AccessReviewMembership{
				TeamID:        int(teamID.Int64),
				TeamName:      teamName,
				TeamSlug:      teamSlug,
				ApplicationID: applicationID,
				TeamType:      teamType,
				Role:          memberRole,
			})
		}
	}
	return users, nil
}

func adminAccessReviewHandler(w http.ResponseWriter, r *http.Request) {
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
	if DB == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not available", "status": "error"})
		return
	}
	users, err := listAccessReviewUsers()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	totalMemberships := 0
	usersWithoutTeams := 0
	portalManagers := 0
	devopsManagers := 0
	for _, user := range users {
		totalMemberships += len(user.Memberships)
		if len(user.Memberships) == 0 {
			usersWithoutTeams++
		}
		if user.IsPortalManager {
			portalManagers++
		}
		if user.DevopsProfile != nil && user.DevopsProfile.IsManager {
			devopsManagers++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"users":  users,
		"summary": map[string]int{
			"total_users":         len(users),
			"total_memberships":   totalMemberships,
			"users_without_teams": usersWithoutTeams,
			"portal_managers":     portalManagers,
			"devops_managers":     devopsManagers,
		},
	})
}
