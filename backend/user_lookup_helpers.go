package main

import (
	"database/sql"
	"strings"
)

func GetUserByUsername(username string) (*User, error) {
	if DB == nil {
		return nil, nil
	}
	normalized := strings.TrimSpace(username)
	if normalized == "" {
		return nil, nil
	}

	var user User
	var verified sql.NullBool
	var role sql.NullString
	var userType sql.NullString
	var managerID sql.NullInt64
	var isPortalManager sql.NullBool
	var totpEnabled sql.NullBool
	err := queryRowContext(
		`SELECT id, username, email, COALESCE(verified, false), COALESCE(role, 'viewer'), COALESCE(user_type, 'portal_user'), manager_id, COALESCE(is_portal_manager, false), COALESCE(totp_enabled, false), created_at
		 FROM users
		 WHERE LOWER(username) = LOWER($1)
		 ORDER BY id ASC
		 LIMIT 1`,
		normalized,
	).Scan(&user.ID, &user.Username, &user.Email, &verified, &role, &userType, &managerID, &isPortalManager, &totpEnabled, &user.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	user.Verified = verified.Valid && verified.Bool
	user.Role = "viewer"
	if role.Valid && role.String != "" {
		user.Role = role.String
	}
	user.UserType = "portal_user"
	if userType.Valid && (userType.String == "portal_user" || userType.String == "devops_user") {
		user.UserType = userType.String
	}
	if managerID.Valid && managerID.Int64 > 0 {
		value := int(managerID.Int64)
		user.ManagerID = &value
	}
	user.IsPortalManager = isPortalManager.Valid && isPortalManager.Bool
	user.TotpEnabled = totpEnabled.Valid && totpEnabled.Bool
	return &user, nil
}

func GetPortalManagerUserIDsByTeamNameOrSlug(teamNameOrSlug string) ([]int, error) {
	if DB == nil {
		return []int{}, nil
	}
	normalized := strings.TrimSpace(teamNameOrSlug)
	if normalized == "" {
		return []int{}, nil
	}

	rows, cancel, err := queryRowsWithTimeout(
		`SELECT DISTINCT tm.user_id
		 FROM team_members tm
		 INNER JOIN teams t ON t.id = tm.team_id
		 WHERE (LOWER(t.name) = LOWER($1) OR LOWER(t.slug) = LOWER($1))
		   AND COALESCE(t.team_type, 'portal') = 'portal'
		   AND tm.role IN ('lead', 'manager')
		 ORDER BY tm.user_id`,
		normalized,
	)
	if err != nil {
		return nil, err
	}
	defer cancel()
	defer rows.Close()

	out := make([]int, 0)
	for rows.Next() {
		var userID int
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		if userID > 0 {
			out = append(out, userID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
