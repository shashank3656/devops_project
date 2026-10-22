package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

const pilotOrganizationID = 1

// Resource authorization for F02. A grant is explicit project membership.
// Team membership and the portal selector never add a project.

type authzAction string

const (
	authzRead   authzAction = "read"
	authzWrite  authzAction = "write"
	authzCreate authzAction = "create"
)

type authzResource struct {
	OrganizationID int
	ProjectID      int
	Environment    string
	Kind           string
	ResourceID     string
}

type projectGrant struct {
	OrganizationID int
	ProjectID      int // 0 is an organization-wide admin grant
	Role           string
	Environments   []string
	Revoked        bool
}

type authzSubject struct {
	UserID         int
	OrganizationID int
	TeamIDs        []int
	Portal         string
	Grants         []projectGrant
	ReadAll        bool
}

type authzRequest struct {
	Subject     authzSubject
	Resource    authzResource
	Action      authzAction
	AllProjects bool
}

type authzDecision struct {
	Allowed bool
	Reason  string
}

func authorizeResource(req authzRequest) authzDecision {
	if req.Subject.OrganizationID <= 0 || req.Resource.OrganizationID <= 0 || req.Resource.ProjectID <= 0 {
		return authzDecision{Reason: "organization and project are required"}
	}
	if req.Subject.OrganizationID != req.Resource.OrganizationID {
		return authzDecision{Reason: "organization mismatch"}
	}
	if req.AllProjects && req.Action != authzRead {
		return authzDecision{Reason: "all projects is read-only"}
	}
	grant, ok := matchingGrant(req.Subject.Grants, req.Resource)
	if !ok {
		return authzDecision{Reason: "no project grant"}
	}
	if !environmentAllowed(grant.Environments, req.Resource.Environment) {
		return authzDecision{Reason: "environment is not granted"}
	}
	if !actionAllowed(grant.Role, req.Action) {
		return authzDecision{Reason: "role cannot perform this action"}
	}
	return authzDecision{Allowed: true, Reason: "granted"}
}

func matchingGrant(grants []projectGrant, resource authzResource) (projectGrant, bool) {
	var orgAdmin projectGrant
	foundAdmin := false
	for _, grant := range grants {
		if grant.Revoked || grant.OrganizationID != resource.OrganizationID {
			continue
		}
		if grant.ProjectID == resource.ProjectID {
			return grant, true
		}
		if grant.ProjectID == 0 && strings.EqualFold(grant.Role, "admin") {
			orgAdmin = grant
			foundAdmin = true
		}
	}
	if foundAdmin {
		return orgAdmin, true
	}
	return projectGrant{}, false
}

func environmentAllowed(allowed []string, environment string) bool {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if environment == "" {
		return false
	}
	for _, item := range allowed {
		item = strings.ToLower(strings.TrimSpace(item))
		if item == "*" || item == environment {
			return true
		}
	}
	return false
}

func grantsFromCatalog(projects []ProjectCatalog, role string) []projectGrant {
	grants := make([]projectGrant, 0, len(projects))
	for _, project := range projects {
		if project.ID <= 0 {
			continue
		}
		environments := project.Environments
		if len(environments) == 0 {
			environments = []string{"*"}
		}
		grants = append(grants, projectGrant{
			OrganizationID: pilotOrganizationID,
			ProjectID:      project.ID,
			Role:           role,
			Environments:   environments,
		})
	}
	return grants
}

func portalAdminSubject(userID int) authzSubject {
	return authzSubject{
		UserID:         userID,
		OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{
			OrganizationID: pilotOrganizationID,
			ProjectID:      0,
			Role:           "admin",
			Environments:   []string{"*"},
		}},
	}
}

func subjectFromRole(userID int, role string) (authzSubject, bool) {
	if strings.EqualFold(strings.TrimSpace(role), "admin") {
		return portalAdminSubject(userID), true
	}
	return authzSubject{}, false
}

func authzSubjectForUser(userID int) authzSubject {
	if DB != nil {
		if user, err := GetUserByID(userID); err == nil && user != nil {
			if subject, ok := subjectFromRole(userID, user.Role); ok {
				return subject
			}
		}
	}
	role := "viewer"
	if userCanAuthorizeChange(userID) {
		role = "operator"
	}
	projects, err := getVisibleProjectsForUser(userID)
	if err != nil {
		projects = nil
	}
	return authzSubject{
		UserID:         userID,
		OrganizationID: pilotOrganizationID,
		Grants:         grantsFromCatalog(projects, role),
	}
}

func actionAllowed(role string, action authzAction) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "admin", "manager":
		return action == authzRead || action == authzWrite || action == authzCreate
	case "operator":
		return action == authzRead || action == authzWrite
	case "viewer":
		return action == authzRead
	default:
		return false
	}
}

var errCatalogUnauthorized = errors.New("missing or invalid authorization")

var catalogSubjectFromRequest = defaultCatalogSubject

func defaultCatalogSubject(r *http.Request) (authzSubject, error) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return authzSubject{}, errCatalogUnauthorized
	}
	userID, err := validateToken(strings.TrimPrefix(header, "Bearer "))
	if err != nil || userID <= 0 {
		return authzSubject{}, errCatalogUnauthorized
	}
	return authzSubjectForUser(userID), nil
}

func catalogEnvironmentsAllowed(subject authzSubject, projectID int, environments []string, action authzAction) bool {
	if projectID <= 0 {
		return false
	}
	envs := environments
	if len(envs) == 0 {
		envs = []string{"*"}
	}
	for _, environment := range envs {
		decision := authorizeResource(authzRequest{
			Subject: subject,
			Resource: authzResource{
				OrganizationID: pilotOrganizationID,
				ProjectID:      projectID,
				Environment:    environment,
				Kind:           "service",
				ResourceID:     strconv.Itoa(projectID),
			},
			Action: action,
		})
		if !decision.Allowed {
			return false
		}
	}
	return true
}
