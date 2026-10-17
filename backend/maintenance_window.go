package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type maintenanceWindowRecord struct {
	ID             int       `json:"id"`
	Number         string    `json:"number"`
	ProjectID      int       `json:"project_id"`
	ProjectName    string    `json:"project_name"`
	Environment    string    `json:"environment"`
	Service        string    `json:"service"`
	TeamID         int       `json:"team_id"`
	TeamName       string    `json:"team_name"`
	OwnerName      string    `json:"owner_name"`
	ChangeNumber   string    `json:"change_number"`
	IncidentNumber string    `json:"incident_number"`
	Impact         string    `json:"impact"`
	Description    string    `json:"description"`
	StartsAt       time.Time `json:"starts_at"`
	EndsAt         time.Time `json:"ends_at"`
	Status         string    `json:"status"`
	CreatedBy      int       `json:"created_by"`
	CreatedByName  string    `json:"created_by_name"`
	ManagerUserID  int       `json:"manager_user_id"`
	CanDecide      bool      `json:"can_decide"`
	CreatedAt      time.Time `json:"created_at"`
}

func migrateMaintenanceWindowSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS maintenance_windows (
			id SERIAL PRIMARY KEY,
			project_id INTEGER NOT NULL,
			environment TEXT NOT NULL,
			service TEXT NOT NULL,
			team_id INTEGER NOT NULL DEFAULT 0,
			team_name TEXT NOT NULL DEFAULT '',
			owner_name TEXT NOT NULL,
			change_number TEXT NOT NULL,
			incident_number TEXT NOT NULL DEFAULT '',
			impact TEXT NOT NULL,
			description TEXT NOT NULL,
			starts_at TIMESTAMP NOT NULL,
			ends_at TIMESTAMP NOT NULL,
			status TEXT NOT NULL,
			created_by INTEGER NOT NULL,
			manager_user_id INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
}

func maintenanceWindowNumber(id int) string {
	return fmt.Sprintf("MNT%07d", id)
}

func maintenanceWindowsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireSessionUser(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		items, err := listMaintenanceWindows(userID)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "Maintenance could not be loaded.", err)
			return
		}
		if items == nil {
			items = []maintenanceWindowRecord{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"windows": items, "status": "ok"})
	case http.MethodPost:
		createMaintenanceWindow(w, r, userID)
	default:
		writeMethodNotAllowed(w, r)
	}
}

func maintenanceWindowDetailHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	userID, ok := requireSessionUser(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/maintenance/windows/"), "/")
	parts := strings.Split(path, "/")
	id, err := strconv.Atoi(parts[0])
	if err != nil || id <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "That maintenance record was not found.", err)
		return
	}
	if len(parts) == 2 && parts[1] == "decision" {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w, r)
			return
		}
		decideMaintenanceWindow(w, r, userID, id)
		return
	}
	if r.Method != http.MethodGet || len(parts) != 1 {
		writeMethodNotAllowed(w, r)
		return
	}
	item, err := getMaintenanceWindow(id, userID)
	if err != nil || item == nil {
		writeAPIError(w, r, http.StatusNotFound, "That maintenance record was not found.", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"window": item, "status": "ok"})
}

func createMaintenanceWindow(w http.ResponseWriter, r *http.Request, userID int) {
	var body struct {
		ProjectID      int    `json:"project_id"`
		Environment    string `json:"environment"`
		Service        string `json:"service"`
		TeamID         int    `json:"team_id"`
		OwnerName      string `json:"owner_name"`
		ChangeNumber   string `json:"change_number"`
		IncidentNumber string `json:"incident_number"`
		Impact         string `json:"impact"`
		Description    string `json:"description"`
		Start          string `json:"start"`
		End            string `json:"end"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "That value is not accepted.", err)
		return
	}
	environment := strings.TrimSpace(body.Environment)
	service := strings.TrimSpace(body.Service)
	owner := strings.TrimSpace(body.OwnerName)
	changeNumber := strings.TrimSpace(body.ChangeNumber)
	impact := strings.TrimSpace(body.Impact)
	description := strings.TrimSpace(body.Description)
	start, startErr := time.Parse(time.RFC3339, strings.TrimSpace(body.Start))
	end, endErr := time.Parse(time.RFC3339, strings.TrimSpace(body.End))
	if body.ProjectID <= 0 || body.TeamID <= 0 || environment == "" || !maintenancePublicText(service) || !maintenancePublicText(owner) || !maintenancePublicText(impact) || !maintenancePublicText(description) || changeNumber == "" || startErr != nil || endErr != nil || !end.After(start) || len(description) > maintenanceBodyLimit {
		writeAPIError(w, r, http.StatusBadRequest, "Choose the project, service, team, owner, change, start, end, impact, and description.", nil)
		return
	}
	creator, err := GetUserByID(userID)
	if err != nil || creator == nil || creator.ManagerID == nil || *creator.ManagerID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "A manager is not set for this person.", err)
		return
	}
	if *creator.ManagerID == userID {
		writeAPIError(w, r, http.StatusBadRequest, "A manager is not set for this person.", nil)
		return
	}
	var teamName string
	_ = DB.QueryRow(`SELECT name FROM teams WHERE id = $1`, body.TeamID).Scan(&teamName)
	var id int
	err = DB.QueryRow(`
		INSERT INTO maintenance_windows (
			project_id, environment, service, team_id, team_name, owner_name, change_number, incident_number,
			impact, description, starts_at, ends_at, status, created_by, manager_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_manager',$13,$14)
		RETURNING id
	`, body.ProjectID, environment, service, body.TeamID, strings.TrimSpace(teamName), owner, changeNumber, strings.TrimSpace(body.IncidentNumber), impact, description, start.UTC(), end.UTC(), userID, *creator.ManagerID).Scan(&id)
	if err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Maintenance could not be created.", err)
		return
	}
	number := maintenanceWindowNumber(id)
	notifyMaintenanceUser(userID, body.ProjectID, "Maintenance "+number+" created", "Your maintenance "+number+" for "+service+" was created. It is waiting for your manager.")
	notifyMaintenanceUser(*creator.ManagerID, body.ProjectID, "Maintenance "+number+" needs your approval", "Maintenance "+number+" for "+service+" is waiting for you. Open Maintenance to approve or reject it.")
	item, err := getMaintenanceWindow(id, userID)
	if err != nil || item == nil {
		writeAPIError(w, r, http.StatusInternalServerError, "Maintenance could not be created.", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"window": item, "status": "ok"})
}

func decideMaintenanceWindow(w http.ResponseWriter, r *http.Request, userID, id int) {
	var body struct {
		Decision string `json:"decision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "Approve or reject this maintenance.", err)
		return
	}
	decision := strings.ToLower(strings.TrimSpace(body.Decision))
	if decision != "approve" && decision != "reject" {
		writeAPIError(w, r, http.StatusBadRequest, "Approve or reject this maintenance.", nil)
		return
	}
	item, err := getMaintenanceWindow(id, userID)
	if err != nil || item == nil {
		writeAPIError(w, r, http.StatusNotFound, "That maintenance record was not found.", err)
		return
	}
	if item.CreatedBy == userID || !maintenanceCanDecide(userID, item) {
		writeAPIError(w, r, http.StatusForbidden, "This step is waiting for someone else.", nil)
		return
	}
	next := item.Status
	if decision == "reject" {
		next = "rejected"
	} else {
		switch item.Status {
		case "pending_manager":
			next = "pending_devops"
		case "pending_devops":
			next = "pending_admin"
		case "pending_admin":
			next = "approved"
		default:
			writeAPIError(w, r, http.StatusConflict, "This maintenance is no longer waiting.", nil)
			return
		}
	}
	if _, err := DB.Exec(`UPDATE maintenance_windows SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, next); err != nil {
		writeAPIError(w, r, http.StatusInternalServerError, "The decision could not be saved.", err)
		return
	}
	number := item.Number
	switch next {
	case "pending_devops":
		for _, managerID := range maintenanceDevopsManagerIDs() {
			if managerID == item.CreatedBy {
				continue
			}
			notifyMaintenanceUser(managerID, item.ProjectID, "Maintenance "+number+" needs DevOps approval", "Maintenance "+number+" for "+item.Service+" was approved by the manager. Open Maintenance to approve or reject it.")
		}
	case "pending_admin":
		for _, adminID := range maintenanceAdminIDs() {
			if adminID == item.CreatedBy {
				continue
			}
			notifyMaintenanceUser(adminID, item.ProjectID, "Maintenance "+number+" needs admin approval", "Maintenance "+number+" for "+item.Service+" was approved by a DevOps manager. Open Maintenance to approve or reject it.")
		}
	case "approved":
		notifyMaintenanceUser(item.CreatedBy, item.ProjectID, "Maintenance "+number+" approved", "Maintenance "+number+" for "+item.Service+" was approved by the manager, a DevOps manager, and an admin.")
	case "rejected":
		notifyMaintenanceUser(item.CreatedBy, item.ProjectID, "Maintenance "+number+" rejected", "Maintenance "+number+" for "+item.Service+" was rejected.")
	}
	updated, err := getMaintenanceWindow(id, userID)
	if err != nil || updated == nil {
		writeAPIError(w, r, http.StatusInternalServerError, "The decision could not be saved.", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"window": updated, "status": "ok"})
}

func listMaintenanceWindows(userID int) ([]maintenanceWindowRecord, error) {
	seeAll := maintenanceSeesAll(userID)
	query := `
		SELECT w.id, w.project_id, COALESCE(p.name, ''), w.environment, w.service, w.team_id, w.team_name,
		       w.owner_name, w.change_number, w.incident_number, w.impact, w.description, w.starts_at, w.ends_at,
		       w.status, w.created_by, COALESCE(u.username, ''), w.manager_user_id, w.created_at
		FROM maintenance_windows w
		LEFT JOIN projects p ON p.id = w.project_id
		LEFT JOIN users u ON u.id = w.created_by
	`
	args := []any{}
	if !seeAll {
		query += ` WHERE w.created_by = $1 OR w.manager_user_id = $1`
		args = append(args, userID)
	}
	query += ` ORDER BY w.created_at DESC, w.id DESC`
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []maintenanceWindowRecord{}
	for rows.Next() {
		item, scanErr := scanMaintenanceWindow(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		item.CanDecide = maintenanceCanDecide(userID, &item)
		items = append(items, item)
	}
	return items, rows.Err()
}

func getMaintenanceWindow(id, userID int) (*maintenanceWindowRecord, error) {
	row := DB.QueryRow(`
		SELECT w.id, w.project_id, COALESCE(p.name, ''), w.environment, w.service, w.team_id, w.team_name,
		       w.owner_name, w.change_number, w.incident_number, w.impact, w.description, w.starts_at, w.ends_at,
		       w.status, w.created_by, COALESCE(u.username, ''), w.manager_user_id, w.created_at
		FROM maintenance_windows w
		LEFT JOIN projects p ON p.id = w.project_id
		LEFT JOIN users u ON u.id = w.created_by
		WHERE w.id = $1
	`, id)
	item, err := scanMaintenanceWindow(row)
	if err != nil {
		return nil, err
	}
	if !maintenanceSeesAll(userID) && item.CreatedBy != userID && item.ManagerUserID != userID {
		return nil, nil
	}
	item.CanDecide = maintenanceCanDecide(userID, &item)
	return &item, nil
}

type maintenanceScanner interface {
	Scan(dest ...any) error
}

func scanMaintenanceWindow(row maintenanceScanner) (maintenanceWindowRecord, error) {
	var item maintenanceWindowRecord
	err := row.Scan(
		&item.ID, &item.ProjectID, &item.ProjectName, &item.Environment, &item.Service, &item.TeamID, &item.TeamName,
		&item.OwnerName, &item.ChangeNumber, &item.IncidentNumber, &item.Impact, &item.Description, &item.StartsAt, &item.EndsAt,
		&item.Status, &item.CreatedBy, &item.CreatedByName, &item.ManagerUserID, &item.CreatedAt,
	)
	item.Number = maintenanceWindowNumber(item.ID)
	return item, err
}

func maintenanceSeesAll(userID int) bool {
	user, err := GetUserByID(userID)
	if err != nil || user == nil {
		return false
	}
	if user.Role == "admin" {
		return true
	}
	prof, err := GetDevopsProfile(userID)
	return err == nil && prof != nil && prof.IsManager
}

func maintenanceCanDecide(userID int, item *maintenanceWindowRecord) bool {
	if item == nil || userID <= 0 || userID == item.CreatedBy {
		return false
	}
	switch item.Status {
	case "pending_manager":
		return userID == item.ManagerUserID
	case "pending_devops":
		prof, err := GetDevopsProfile(userID)
		return err == nil && prof != nil && prof.IsManager
	case "pending_admin":
		user, err := GetUserByID(userID)
		return err == nil && user != nil && user.Role == "admin"
	default:
		return false
	}
}

func maintenanceDevopsManagerIDs() []int {
	rows, err := DB.Query(`SELECT user_id FROM devops_profiles WHERE is_manager = TRUE`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err == nil && id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

func maintenanceAdminIDs() []int {
	rows, err := DB.Query(`SELECT id FROM users WHERE role = 'admin'`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	ids := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err == nil && id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

func notifyMaintenanceUser(userID, projectID int, subject, message string) {
	notifyOncallUser(userID, projectID, "maintenance", subject, message)
}

func userCanReachMaintenanceWindows(userID int) bool {
	if userID <= 0 || DB == nil {
		return false
	}
	if user, err := GetUserByID(userID); err == nil && user != nil && user.Role == "admin" {
		return true
	}
	if prof, err := GetDevopsProfile(userID); err == nil && prof != nil && prof.IsManager {
		return true
	}
	var exists bool
	err := DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM maintenance_windows WHERE manager_user_id = $1 OR created_by = $1)`, userID).Scan(&exists)
	return err == nil && exists
}
