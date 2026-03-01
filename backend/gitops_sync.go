package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
)

type GitOpsSyncResult struct {
	OK      bool     `json:"ok"`
	PRURL   string   `json:"pr_url,omitempty"`
	Branch  string   `json:"branch,omitempty"`
	Files   []string `json:"files,omitempty"`
	Warning string   `json:"warning,omitempty"`
}

func buildGitOpsManifestContent(project GitOpsCatalogProject, environment, component string) ([]byte, error) {
	payload := map[string]interface{}{
		"project": map[string]interface{}{
			"name":     project.Name,
			"slug":     project.Slug,
			"group_id": project.GroupID,
			"team":     project.TeamName,
		},
		"environment": environment,
		"component":   component,
		"cloud":       strings.TrimSpace(project.DefaultCloud),
		"metadata": map[string]interface{}{
			"managed_by": "devops-portal",
			"mode":       "gitops",
			"base":       project.BaseBranch,
		},
		"spec": map[string]interface{}{},
	}
	if payload["cloud"] == "" {
		payload["cloud"] = "aws"
	}
	return json.MarshalIndent(payload, "", "  ")
}

func buildGitOpsStructureFiles(project GitOpsCatalogProject, components []string) (map[string][]byte, []string, error) {
	normalizedComponents := normalizeGitOpsComponentList(components)
	files := make(map[string][]byte, len(project.Environments)*len(normalizedComponents))
	paths := make([]string, 0, len(project.Environments)*len(normalizedComponents))

	for _, environment := range project.Environments {
		for _, component := range normalizedComponents {
			path := BuildGitOpsManagedManifestPath(project.RepoRoot, environment, component)
			content, err := buildGitOpsManifestContent(project, environment, component)
			if err != nil {
				return nil, nil, err
			}
			files[path] = content
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	return files, paths, nil
}

func buildGitOpsSyncBranch(project GitOpsCatalogProject, action string) (string, error) {
	requestID, err := GenerateApplicationID()
	if err != nil {
		return "", err
	}
	groupKey := strings.TrimSpace(project.GroupID)
	if groupKey == "" {
		groupKey = ResolveTeamPathKey(project.TeamName)
	}
	return fmt.Sprintf("%s/project-infra/%s/%s-%s",
		groupKey,
		project.Slug,
		normalizeGitOpsComponentName(action),
		strings.ToLower(requestID),
	), nil
}

func syncGitOpsProjectStructureToGit(project GitOpsCatalogProject, components []string, action string) GitOpsSyncResult {
	files, paths, err := buildGitOpsStructureFiles(project, components)
	if err != nil {
		return GitOpsSyncResult{
			Warning: fmt.Sprintf("GitOps structure was saved, but manifest generation failed: %v", err),
		}
	}

	if GitHubToken == "" {
		return GitOpsSyncResult{
			Warning: "GitOps structure was saved in the portal, but GITHUB_TOKEN is not configured so no repo files or PR were created.",
			Files:   paths,
		}
	}

	branchName, err := buildGitOpsSyncBranch(project, action)
	if err != nil {
		return GitOpsSyncResult{
			Warning: fmt.Sprintf("GitOps structure was saved, but branch generation failed: %v", err),
			Files:   paths,
		}
	}

	componentList := normalizeGitOpsComponentList(components)
	title := fmt.Sprintf("Project-Infra: sync %s", project.Name)
	if action == "create" {
		title = fmt.Sprintf("Project-Infra: scaffold %s", project.Name)
	} else if action == "add-json" && len(componentList) == 1 {
		title = fmt.Sprintf("Project-Infra: add %s.json to %s", componentList[0], project.Name)
	}
	body := fmt.Sprintf(
		"Auto-generated Project-Infra sync from DevOps Portal\n\n**Project:** %s\n**Repo Root:** %s\n**Environments:** %s\n**Components:** %s",
		project.Name,
		project.RepoRoot,
		strings.Join(project.Environments, ", "),
		strings.Join(componentList, ", "),
	)

	prURL, err := CreateGitHubPRWithFiles(branchName, files, title, body)
	if err != nil {
		log.Printf("gitops sync failed for project %d: %v", project.ID, err)
		return GitOpsSyncResult{
			Branch:  branchName,
			Files:   paths,
			Warning: fmt.Sprintf("GitOps structure was saved, but repo sync failed: %v", err),
		}
	}

	return GitOpsSyncResult{
		OK:     true,
		PRURL:  prURL,
		Branch: branchName,
		Files:  paths,
	}
}
