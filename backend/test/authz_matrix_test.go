package main

import "testing"

func TestPermissionMatrixDeniesCrossProjectResourceID(t *testing.T) {
	subject := authzSubject{
		UserID:         7,
		OrganizationID: 1,
		TeamIDs:        []int{4, 9},
		Portal:         "devops",
		Grants: []projectGrant{{
			OrganizationID: 1,
			ProjectID:      10,
			Role:           "operator",
			Environments:   []string{"dev"},
		}},
	}
	own := authorizeResource(authzRequest{
		Subject: subject,
		Resource: authzResource{
			OrganizationID: 1,
			ProjectID:      10,
			Environment:    "dev",
			Kind:           "change",
			ResourceID:     "CHG-15",
		},
		Action: authzRead,
	})
	if !own.Allowed {
		t.Fatalf("own project read denied: %s", own.Reason)
	}

	swapped := authorizeResource(authzRequest{
		Subject: subject,
		Resource: authzResource{
			OrganizationID: 1,
			ProjectID:      11,
			Environment:    "dev",
			Kind:           "change",
			ResourceID:     "CHG-15",
		},
		Action: authzRead,
	})
	if swapped.Allowed {
		t.Fatal("the same resource id in another project must be denied")
	}
}

func TestDeniedAccessFixtures(t *testing.T) {
	base := authzSubject{
		UserID:         7,
		OrganizationID: 1,
		TeamIDs:        []int{4},
		Portal:         "user",
		Grants: []projectGrant{{
			OrganizationID: 1,
			ProjectID:      10,
			Role:           "viewer",
			Environments:   []string{"dev"},
		}},
	}
	resource := authzResource{OrganizationID: 1, ProjectID: 10, Environment: "dev", Kind: "change", ResourceID: "CHG-15"}

	cases := []struct {
		name    string
		mutate  func(subject *authzSubject, resource *authzResource, req *authzRequest)
		allowed bool
	}{
		{name: "other organization", mutate: func(_ *authzSubject, resource *authzResource, _ *authzRequest) {
			resource.OrganizationID = 2
		}},
		{name: "team membership without a grant", mutate: func(subject *authzSubject, _ *authzResource, _ *authzRequest) {
			subject.Grants = nil
			subject.TeamIDs = []int{4, 8}
		}},
		{name: "portal change does not add access", mutate: func(subject *authzSubject, resource *authzResource, _ *authzRequest) {
			subject.Portal = "admin"
			subject.Grants = nil
			resource.ProjectID = 99
		}},
		{name: "revoked grant", mutate: func(subject *authzSubject, _ *authzResource, _ *authzRequest) {
			subject.Grants[0].Revoked = true
		}},
		{name: "viewer write", mutate: func(_ *authzSubject, _ *authzResource, req *authzRequest) {
			req.Action = authzWrite
		}},
		{name: "environment outside the grant", mutate: func(_ *authzSubject, resource *authzResource, _ *authzRequest) {
			resource.Environment = "prod"
		}},
		{name: "all projects cannot create", mutate: func(subject *authzSubject, _ *authzResource, req *authzRequest) {
			subject.Grants[0].Role = "manager"
			req.Action = authzCreate
			req.AllProjects = true
		}},
		{name: "operator cannot create", mutate: func(subject *authzSubject, _ *authzResource, req *authzRequest) {
			subject.Grants[0].Role = "operator"
			req.Action = authzCreate
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			subject := base
			subject.Grants = append([]projectGrant(nil), base.Grants...)
			target := resource
			req := authzRequest{Subject: subject, Resource: target, Action: authzRead}
			tc.mutate(&req.Subject, &req.Resource, &req)
			decision := authorizeResource(req)
			if decision.Allowed != tc.allowed {
				t.Fatalf("allowed=%v reason=%s", decision.Allowed, decision.Reason)
			}
		})
	}

	admin := base
	admin.Grants = []projectGrant{{
		OrganizationID: 1,
		ProjectID:      0,
		Role:           "admin",
		Environments:   []string{"*"},
	}}
	otherProject := authorizeResource(authzRequest{
		Subject:  admin,
		Resource: authzResource{OrganizationID: 1, ProjectID: 22, Environment: "prod", Kind: "change", ResourceID: "CHG-15"},
		Action:   authzRead,
	})
	if !otherProject.Allowed {
		t.Fatalf("org admin read denied: %s", otherProject.Reason)
	}
	otherOrg := authorizeResource(authzRequest{
		Subject:  admin,
		Resource: authzResource{OrganizationID: 2, ProjectID: 22, Environment: "prod", Kind: "change", ResourceID: "CHG-15"},
		Action:   authzRead,
	})
	if otherOrg.Allowed {
		t.Fatal("org admin must not cross organizations")
	}
}
