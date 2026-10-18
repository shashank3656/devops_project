package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type searchHit struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle,omitempty"`
	Href     string `json:"href"`
}

func searchHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w, r, http.MethodGet)
		return
	}
	_, user, ok := requireSignedIn(w, r)
	if !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	hits := searchCatalog(query, user)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "hits": hits})
}

func searchCatalog(query string, user *User) []searchHit {
	hits := make([]searchHit, 0, 20)
	if DB == nil || user == nil || strings.TrimSpace(query) == "" {
		return hits
	}
	like := "%" + strings.ToLower(strings.TrimSpace(query)) + "%"
	limit := 8

	if rows, err := DB.Query(`
		SELECT id, team, env, cloud, service, status, COALESCE(pr_url, '')
		FROM pr_requests
		WHERE CAST(id AS TEXT) ILIKE $1
		   OR LOWER(team) LIKE $1
		   OR LOWER(service) LIKE $1
		   OR LOWER(cloud) LIKE $1
		   OR LOWER(COALESCE(pr_url, '')) LIKE $1
		ORDER BY updated_at DESC
		LIMIT $2
	`, like, limit); err == nil {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var id int
			var team, env, cloud, service, status, prURL string
			if err := rows.Scan(&id, &team, &env, &cloud, &service, &status, &prURL); err != nil {
				continue
			}
			hits = append(hits, searchHit{
				ID:       fmt.Sprintf("request-%d", id),
				Kind:     "request",
				Title:    fmt.Sprintf("Request #%d · %s %s", id, cloud, service),
				Subtitle: strings.TrimSpace(strings.Join([]string{team, env, status}, " · ")),
				Href:     requestSearchHref(user, id, prURL),
			})
		}
	}

	if rows, err := DB.Query(`
		SELECT id, name, code, status FROM projects
		WHERE LOWER(name) LIKE $1 OR LOWER(code) LIKE $1
		ORDER BY updated_at DESC LIMIT $2
	`, like, 5); err == nil {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var id int
			var name, code, status string
			if err := rows.Scan(&id, &name, &code, &status); err != nil {
				continue
			}
			hits = append(hits, searchHit{
				ID:       fmt.Sprintf("project-%d", id),
				Kind:     "project",
				Title:    name,
				Subtitle: strings.TrimSpace(code + " · " + status),
				Href:     projectSearchHref(user, id),
			})
		}
	}

	if rows, err := DB.Query(`
		SELECT id, COALESCE(incident_number, ''), COALESCE(summary, ''), status
		FROM request_incidents
		WHERE LOWER(COALESCE(incident_number, '')) LIKE $1
		   OR LOWER(COALESCE(summary, '')) LIKE $1
		   OR CAST(id AS TEXT) ILIKE $1
		ORDER BY updated_at DESC LIMIT $2
	`, like, 5); err == nil {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var id int
			var number, title, status string
			if err := rows.Scan(&id, &number, &title, &status); err != nil {
				continue
			}
			label := number
			if label == "" {
				label = fmt.Sprintf("INC-%d", id)
			}
			hits = append(hits, searchHit{
				ID:       fmt.Sprintf("incident-%d", id),
				Kind:     "incident",
				Title:    strings.TrimSpace(label + " " + title),
				Subtitle: status,
				Href:     incidentSearchHref(user, id),
			})
		}
	}

	if user.UserType == "devops_user" {
		if rows, err := DB.Query(`
			SELECT id, COALESCE(service,''), COALESCE(repo,''), COALESCE(environment,''), COALESCE(team,'')
			FROM service_map
			WHERE LOWER(COALESCE(service,'')) LIKE $1
			   OR LOWER(COALESCE(repo,'')) LIKE $1
			   OR LOWER(COALESCE(team,'')) LIKE $1
			ORDER BY service
			LIMIT 8
		`, like); err == nil {
			defer func() { _ = rows.Close() }()
			for rows.Next() {
				var id int
				var service, repo, environment, team string
				if err := rows.Scan(&id, &service, &repo, &environment, &team); err != nil {
					continue
				}
				hits = append(hits, searchHit{
					ID:       fmt.Sprintf("service-%d", id),
					Kind:     "service",
					Title:    service,
					Subtitle: strings.TrimSpace(strings.Join([]string{environment, team, repo}, " · ")),
					Href:     "/services/" + strconv.Itoa(id),
				})
			}
		}
	}

	if user.Role == "admin" || user.UserType == "devops_user" {
		if rows, err := DB.Query(`
			SELECT id, name FROM request_templates
			WHERE LOWER(name) LIKE $1 OR LOWER(COALESCE(cloud, '')) LIKE $1
			ORDER BY id DESC LIMIT 4
		`, like); err == nil {
			defer func() { _ = rows.Close() }()
			for rows.Next() {
				var id int
				var name string
				if err := rows.Scan(&id, &name); err != nil {
					continue
				}
				hits = append(hits, searchHit{
					ID:    fmt.Sprintf("template-%d", id),
					Kind:  "template",
					Title: name,
					Href:  "/templates",
				})
			}
		}
	}

	if user != nil && (user.Role == "admin" || user.UserType == "devops_user") {
		if rows, err := DB.Query(`
			SELECT id, username
			FROM users
			WHERE LOWER(username) LIKE $1
			ORDER BY username
			LIMIT 5
		`, like); err == nil {
			defer func() { _ = rows.Close() }()
			for rows.Next() {
				var id int
				var username string
				if err := rows.Scan(&id, &username); err != nil {
					continue
				}
				hits = append(hits, searchHit{
					ID:       fmt.Sprintf("person-%d", id),
					Kind:     "person",
					Title:    username,
					Subtitle: "Person",
					Href:     "/portal-access/users/" + strconv.Itoa(id),
				})
			}
		}
	}

	if n, err := strconv.Atoi(strings.TrimPrefix(strings.ToLower(query), "pr #")); err == nil && n > 0 {
		hits = append([]searchHit{{
			ID:    fmt.Sprintf("pr-%d", n),
			Kind:  "pr",
			Title: fmt.Sprintf("PR #%d impact", n),
			Href:  "/history?pr=" + strconv.Itoa(n),
		}}, hits...)
	}

	if len(hits) > 20 {
		return hits[:20]
	}
	return hits
}

func requestSearchHref(user *User, id int, prURL string) string {
	if user != nil && user.UserType == "devops_user" {
		return "/tickets?id=" + strconv.Itoa(id)
	}
	if user != nil && user.Role == "admin" {
		return "/requests?id=" + strconv.Itoa(id)
	}
	if strings.Contains(prURL, "/pull/") {
		return "/history?id=" + strconv.Itoa(id)
	}
	return "/history?id=" + strconv.Itoa(id)
}

func projectSearchHref(user *User, id int) string {
	if user != nil && user.UserType == "devops_user" {
		return "/projects/" + strconv.Itoa(id)
	}
	if user != nil && user.Role == "admin" {
		return "/projects/" + strconv.Itoa(id)
	}
	return "/my-projects/" + strconv.Itoa(id)
}

func incidentSearchHref(user *User, id int) string {
	if user != nil && user.UserType == "devops_user" {
		return "/incidents/" + strconv.Itoa(id) + "/edit"
	}
	return "/incidents"
}
