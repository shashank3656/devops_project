package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/google/go-github/v61/github"
	"golang.org/x/oauth2"
)

type GitOpsRepoTreeNode struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Depth       int    `json:"depth"`
	Environment string `json:"environment,omitempty"`
	Exists      bool   `json:"exists"`
}

type GitOpsRepoFileDocument struct {
	ProjectID         int    `json:"project_id"`
	ProjectName       string `json:"project_name"`
	Path              string `json:"path"`
	Name              string `json:"name"`
	Environment       string `json:"environment"`
	Component         string `json:"component"`
	Content           string `json:"content"`
	Exists            bool   `json:"exists"`
	CurrentPermission string `json:"current_permission"`
	CanWrite          bool   `json:"can_write"`
	CanManage         bool   `json:"can_manage"`
	Warning           string `json:"warning,omitempty"`
}

func newGitHubClient() (*github.Client, error) {
	if GitHubToken == "" {
		return nil, fmt.Errorf("GITHUB_TOKEN environment variable is required")
	}
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: GitHubToken})
	tc := oauth2.NewClient(context.Background(), ts)
	return github.NewClient(tc), nil
}

func isGitHubNotFound(err error) bool {
	if err == nil {
		return false
	}
	if responseErr, ok := err.(*github.ErrorResponse); ok && responseErr.Response != nil {
		return responseErr.Response.StatusCode == http.StatusNotFound
	}
	return false
}

func getGitHubDirectoryContents(path, ref string) ([]*github.RepositoryContent, error) {
	client, err := newGitHubClient()
	if err != nil {
		return nil, err
	}
	_, dir, _, err := client.Repositories.GetContents(
		context.Background(), GitHubOwner, GitHubRepo, path, &github.RepositoryContentGetOptions{Ref: ref},
	)
	return dir, err
}

func getGitHubFileContent(path, ref string) (string, bool, error) {
	client, err := newGitHubClient()
	if err != nil {
		return "", false, err
	}
	file, _, _, err := client.Repositories.GetContents(
		context.Background(), GitHubOwner, GitHubRepo, path, &github.RepositoryContentGetOptions{Ref: ref},
	)
	if err != nil {
		if isGitHubNotFound(err) {
			return "", false, nil
		}
		return "", false, err
	}
	if file == nil {
		return "", false, nil
	}
	content, err := file.GetContent()
	if err != nil {
		return "", false, err
	}
	return content, true, nil
}

func buildGitOpsFallbackTree(project GitOpsCatalogProject, exists bool) []GitOpsRepoTreeNode {
	rootParts := strings.Split(project.RepoRoot, "/")
	nodes := make([]GitOpsRepoTreeNode, 0, len(rootParts)+(len(project.Environments)*len(project.Components)))
	for index, part := range rootParts {
		if strings.TrimSpace(part) == "" {
			continue
		}
		nodes = append(nodes, GitOpsRepoTreeNode{
			ID:     fmt.Sprintf("root-%d-%s", index, part),
			Kind:   "folder",
			Name:   part,
			Path:   strings.Join(rootParts[:index+1], "/"),
			Depth:  index,
			Exists: exists,
		})
	}
	for _, environment := range project.Environments {
		envPath := BuildGitOpsManagedEnvironmentFolder(project.RepoRoot, environment)
		nodes = append(nodes, GitOpsRepoTreeNode{
			ID:          fmt.Sprintf("env-%s", environment),
			Kind:        "folder",
			Name:        environment,
			Path:        envPath,
			Depth:       len(rootParts),
			Environment: environment,
			Exists:      exists,
		})
		for _, component := range project.Components {
			nodes = append(nodes, GitOpsRepoTreeNode{
				ID:          fmt.Sprintf("file-%s-%s", environment, component),
				Kind:        "file",
				Name:        component + ".json",
				Path:        BuildGitOpsManagedManifestPath(project.RepoRoot, environment, component),
				Depth:       len(rootParts) + 1,
				Environment: environment,
				Exists:      exists,
			})
		}
	}
	return nodes
}

func loadGitOpsRepoTree(project GitOpsCatalogProject) ([]GitOpsRepoTreeNode, string, error) {
	if GitHubToken == "" {
		return buildGitOpsFallbackTree(project, false), "GITHUB_TOKEN is not configured, so Project-Infra is showing the expected structure instead of the live repository tree.", nil
	}

	rootContents, err := getGitHubDirectoryContents(project.RepoRoot, project.BaseBranch)
	if err != nil {
		if isGitHubNotFound(err) {
			return buildGitOpsFallbackTree(project, false), "The GitOps project root does not exist on the base branch yet. Project-Infra is showing the expected structure until the scaffold PR is merged.", nil
		}
		return nil, "", err
	}

	rootParts := strings.Split(project.RepoRoot, "/")
	nodes := make([]GitOpsRepoTreeNode, 0, len(rootParts)+len(project.Environments)*4)
	for index, part := range rootParts {
		if strings.TrimSpace(part) == "" {
			continue
		}
		nodes = append(nodes, GitOpsRepoTreeNode{
			ID:     fmt.Sprintf("root-%d-%s", index, part),
			Kind:   "folder",
			Name:   part,
			Path:   strings.Join(rootParts[:index+1], "/"),
			Depth:  index,
			Exists: true,
		})
	}

	rootEnvSet := make(map[string]bool)
	for _, entry := range rootContents {
		if entry == nil || entry.GetType() != "dir" {
			continue
		}
		rootEnvSet[normalizeGitOpsComponentName(entry.GetName())] = true
	}

	for _, environment := range project.Environments {
		envPath := BuildGitOpsManagedEnvironmentFolder(project.RepoRoot, environment)
		envExists := rootEnvSet[environment]
		nodes = append(nodes, GitOpsRepoTreeNode{
			ID:          fmt.Sprintf("env-%s", environment),
			Kind:        "folder",
			Name:        environment,
			Path:        envPath,
			Depth:       len(rootParts),
			Environment: environment,
			Exists:      envExists,
		})

		fileSet := make(map[string]bool)
		if envExists {
			envContents, err := getGitHubDirectoryContents(envPath, project.BaseBranch)
			if err != nil && !isGitHubNotFound(err) {
				return nil, "", err
			}
			for _, entry := range envContents {
				if entry == nil || entry.GetType() != "file" || !strings.HasSuffix(strings.ToLower(entry.GetName()), ".json") {
					continue
				}
				componentName := normalizeGitOpsComponentName(strings.TrimSuffix(entry.GetName(), ".json"))
				fileSet[componentName] = true
			}
		}

		components := append([]string{}, project.Components...)
		for component := range fileSet {
			found := false
			for _, existing := range components {
				if existing == component {
					found = true
					break
				}
			}
			if !found {
				components = append(components, component)
			}
		}
		sort.Strings(components)

		for _, component := range components {
			nodes = append(nodes, GitOpsRepoTreeNode{
				ID:          fmt.Sprintf("file-%s-%s", environment, component),
				Kind:        "file",
				Name:        component + ".json",
				Path:        BuildGitOpsManagedManifestPath(project.RepoRoot, environment, component),
				Depth:       len(rootParts) + 1,
				Environment: environment,
				Exists:      fileSet[component],
			})
		}
	}

	return nodes, "", nil
}

func loadGitOpsRepoFile(project GitOpsCatalogProject, environment, component string) (*GitOpsRepoFileDocument, error) {
	environment = normalizeGitOpsComponentName(environment)
	component = normalizeGitOpsComponentName(component)
	path := BuildGitOpsManagedManifestPath(project.RepoRoot, environment, component)

	document := &GitOpsRepoFileDocument{
		ProjectID:         project.ID,
		ProjectName:       project.Name,
		Path:              path,
		Name:              component + ".json",
		Environment:       environment,
		Component:         component,
		Exists:            false,
		CurrentPermission: project.CurrentPermission,
		CanWrite:          project.CanWrite,
		CanManage:         project.CanManage,
	}

	if GitHubToken == "" {
		content, err := buildGitOpsManifestContent(project, environment, component)
		if err != nil {
			return nil, err
		}
		document.Content = string(content)
		document.Warning = "GITHUB_TOKEN is not configured, so Project-Infra is showing a generated JSON scaffold instead of the live repository file."
		return document, nil
	}

	content, exists, err := getGitHubFileContent(path, project.BaseBranch)
	if err != nil {
		return nil, err
	}
	if exists {
		document.Content = content
		document.Exists = true
		return document, nil
	}

	scaffold, err := buildGitOpsManifestContent(project, environment, component)
	if err != nil {
		return nil, err
	}
	document.Content = string(scaffold)
	document.Warning = "This file does not exist on the base branch yet. Project-Infra is showing the JSON scaffold that will be created when you save it."
	return document, nil
}
