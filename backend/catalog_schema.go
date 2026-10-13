package main

import (
	"fmt"
	"strings"
)

type catalogServiceRecord struct {
	ID        int
	ProjectID int
	Name      string
}

type catalogLink struct {
	ServiceID int
	Target    string
}

func renameCatalogService(services []catalogServiceRecord, id int, name string) ([]catalogServiceRecord, error) {
	name = strings.TrimSpace(name)
	if id <= 0 {
		return services, fmt.Errorf("service id is required")
	}
	if name == "" {
		return services, fmt.Errorf("service name is required")
	}
	found := false
	next := make([]catalogServiceRecord, len(services))
	copy(next, services)
	for index := range next {
		if next[index].ID != id {
			continue
		}
		next[index].Name = name
		found = true
	}
	if !found {
		return services, fmt.Errorf("service %d was not found", id)
	}
	return next, nil
}

func linkCatalogTarget(links []catalogLink, serviceID int, target string) ([]catalogLink, error) {
	target = strings.TrimSpace(target)
	if serviceID <= 0 {
		return links, fmt.Errorf("service id is required")
	}
	if target == "" {
		return links, fmt.Errorf("link target is required")
	}
	for _, link := range links {
		if link.ServiceID == serviceID && strings.EqualFold(link.Target, target) {
			return links, fmt.Errorf("service %d is already linked to %s", serviceID, target)
		}
	}
	return append(links, catalogLink{ServiceID: serviceID, Target: target}), nil
}

func catalogTargetsForService(links []catalogLink, serviceID int) []string {
	out := []string{}
	for _, link := range links {
		if link.ServiceID == serviceID {
			out = append(out, link.Target)
		}
	}
	return out
}

func migrateCatalogSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS catalog_services (
			id SERIAL PRIMARY KEY,
			project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
			name VARCHAR(200) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_catalog_services_project ON catalog_services (project_id)`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS catalog_service_repos (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES catalog_services(id) ON DELETE CASCADE,
			repo VARCHAR(400) NOT NULL,
			UNIQUE (service_id, repo)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS catalog_service_resources (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES catalog_services(id) ON DELETE CASCADE,
			resource_id VARCHAR(400) NOT NULL,
			UNIQUE (service_id, resource_id)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS catalog_service_environments (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES catalog_services(id) ON DELETE CASCADE,
			environment VARCHAR(100) NOT NULL,
			UNIQUE (service_id, environment)
		)
	`)
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS catalog_service_teams (
			id SERIAL PRIMARY KEY,
			service_id INTEGER NOT NULL REFERENCES catalog_services(id) ON DELETE CASCADE,
			team VARCHAR(200) NOT NULL,
			UNIQUE (service_id, team)
		)
	`)
}
