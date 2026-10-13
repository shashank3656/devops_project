package main

type capabilityMode string

const (
	capabilityLive        capabilityMode = "live"
	capabilityDemo        capabilityMode = "demo"
	capabilityUnavailable capabilityMode = "unavailable"
)

type inheritedCapability struct {
	Name        string
	Route       string
	Mode        capabilityMode
	Evidence    string
	Environment string
	Revision    string
}

func inheritedCapabilityInventory(revision, environment string) []inheritedCapability {
	note := func(name, route string, mode capabilityMode, evidence string) inheritedCapability {
		return inheritedCapability{
			Name:        name,
			Route:       route,
			Mode:        mode,
			Evidence:    evidence,
			Environment: environment,
			Revision:    revision,
		}
	}
	return []inheritedCapability{
		note("Session and project authorization", "/api/me", capabilityLive, "Local tests cover signing, expiry, revocation, and the project matrix."),
		note("Change and incident queues", "/api/me/changes", capabilityLive, "List and detail reads use the permission matrix."),
		note("Inbound webhook workers", "/api/webhooks/change", capabilityLive, "A source stored with a project cannot write another project."),
		note("Request template catalog", "/api/templates", capabilityLive, "Templates are rows in the database. Input-to-render is still SO-F03-2."),
		note("Policy rules", "/api/devops/policies", capabilityLive, "Rules are rows in policy_rules."),
		note("SLO budgets", "/api/devops/slos", capabilityLive, "Budgets are rows loaded by listServiceSLOBudgets."),
		note("Service map", "/api/devops/services", capabilityLive, "Entries are rows loaded by listServiceMap."),
		note("Preview environment list", "/api/devops/previews", capabilityUnavailable, "The connected database has no preview_environments table, so the list cannot be read."),
		note("Scorecards", "/api/devops/scorecards", capabilityLive, "Scorecards are built from stored service records."),
		note("GitOps project catalog", "/api/devops/gitops/projects", capabilityLive, "Projects are stored records visible to the signed-in user."),
		note("CI status webhook", "/api/webhooks/ci", capabilityLive, "A matching secret updates an existing request. It does not create a cloud resource."),
		note("Health check", "/health", capabilityLive, "Reports database, cache, and GitHub connectivity. A missing dependency is degraded, not healthy."),
		note("Golden path catalog", "/api/golden-paths", capabilityDemo, "The six paths are a hardcoded list, not stored records."),
		note("Cost estimate", "/api/cost-guardrail", capabilityDemo, "Monthly cost comes from a static instance price table, not a billing API."),
		note("Cloud inventory", "/api/devops/cloud/resources", capabilityDemo, "The connected database has 5 cloud_resources rows, including the demo seed ids. There is no cloud API read."),
		note("Kubernetes overview", "/api/devops/k8s-overview", capabilityUnavailable, "The connected database has 0 project_k8s_connections rows."),
		note("GitHub connectivity", "/api/webhooks/github", capabilityUnavailable, "The configured token was rejected by the GitHub API, so repository calls stay unavailable."),
		note("Copilot model", "/api/copilot", capabilityUnavailable, "Without COPILOT_API_KEY or OPENAI_API_KEY the handler keeps the grounded catalog answer and does not call a model."),
		note("Credential audit", "/api/devops/credential-audit", capabilityLive, "Rows come from stored credential audit logs. This is not a scanner finding."),
		note("Security findings", "(no scanner route)", capabilityUnavailable, "identity_findings has 0 rows and records SSO identity data. No cloud or code scanner route is registered."),
		note("Sandbox provisioning", "/api/request", capabilityUnavailable, "verifySandboxProvision records unavailable until a non-demo resource matches the sandbox bucket and region. SO-F03-3."),
	}
}
