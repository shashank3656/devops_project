package main

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/google/go-github/v61/github"
	"golang.org/x/oauth2"
)

func CreateGitHubPR(branchName, filePath string, content []byte) (string, error) {
	ctx := context.Background()

	if GitHubToken == "" {
		return "", fmt.Errorf("GITHUB_TOKEN environment variable is required")
	}

	// Create authenticated GitHub client using token
	ts := oauth2.StaticTokenSource(
		&oauth2.Token{AccessToken: GitHubToken},
	)
	tc := oauth2.NewClient(ctx, ts)
	client := github.NewClient(tc)

	// 1. Get base branch
	baseRef, _, err := client.Git.GetRef(
		ctx, GitHubOwner, GitHubRepo, "refs/heads/"+BaseBranch,
	)
	if err != nil {
		return "", fmt.Errorf("failed to get base branch: %w", err)
	}

	// 2. Check if branch already exists
	branchRef := "refs/heads/" + branchName
	_, _, branchErr := client.Git.GetRef(ctx, GitHubOwner, GitHubRepo, branchRef)
	
	if branchErr == nil {
		// Branch exists, we'll update it
		log.Printf("Branch %s already exists, updating it", branchName)
	} else {
		// Branch doesn't exist, create new branch
		newRef := &github.Reference{
			Ref: github.String(branchRef),
			Object: &github.GitObject{
				SHA: baseRef.Object.SHA,
			},
		}
		_, _, err = client.Git.CreateRef(ctx, GitHubOwner, GitHubRepo, newRef)
		if err != nil {
			return "", fmt.Errorf("failed to create branch: %w", err)
		}
		log.Printf("Created new branch: %s", branchName)
	}

	// 3. Check if file already exists to determine if we should create or update
	fileContent, _, _, err := client.Repositories.GetContents(
		ctx, GitHubOwner, GitHubRepo, filePath, &github.RepositoryContentGetOptions{
			Ref: branchName,
		},
	)

	var sha *string
	if err == nil && fileContent != nil {
		// File exists, get its SHA for update
		sha = fileContent.SHA
		log.Printf("File %s exists, will update it", filePath)
	} else {
		log.Printf("File %s does not exist, will create it", filePath)
	}

	// 4. Create or update file
	opts := &github.RepositoryContentFileOptions{
		Message: github.String(fmt.Sprintf("Add/Update infra config: %s", filePath)),
		Content: content,
		Branch:  github.String(branchName),
	}
	if sha != nil {
		opts.SHA = sha
	}

	_, _, err = client.Repositories.CreateFile(
		ctx, GitHubOwner, GitHubRepo, filePath, opts,
	)
	if err != nil {
		return "", fmt.Errorf("failed to create/update file: %w", err)
	}

	// 5. Check if PR already exists for this branch
	prs, _, err := client.PullRequests.List(ctx, GitHubOwner, GitHubRepo, &github.PullRequestListOptions{
		State: "open",
		Head:  fmt.Sprintf("%s:%s", GitHubOwner, branchName),
		Base:  BaseBranch,
	})
	if err != nil {
		return "", fmt.Errorf("failed to check existing PRs: %w", err)
	}

	// If PR exists, return its URL
	if len(prs) > 0 {
		log.Printf("PR already exists for branch %s, returning existing PR", branchName)
		return prs[0].GetHTMLURL(), nil
	}

	// 6. Create new PR
	pr := &github.NewPullRequest{
		Title: github.String(fmt.Sprintf("Infrastructure Request: %s/%s", branchName, filePath)),
		Head:  github.String(branchName),
		Base:  github.String(BaseBranch),
		Body:  github.String(fmt.Sprintf("Auto-generated infrastructure request\n\n**Team:** %s\n**Environment:** %s\n**File:** %s", 
			extractTeamFromBranch(branchName), extractEnvFromBranch(branchName), filePath)),
	}

	createdPR, _, err := client.PullRequests.Create(
		ctx, GitHubOwner, GitHubRepo, pr,
	)
	if err != nil {
		return "", fmt.Errorf("failed to create PR: %w", err)
	}

	log.Printf("Created PR #%d: %s", createdPR.GetNumber(), createdPR.GetHTMLURL())
	return createdPR.GetHTMLURL(), nil
}

// Helper functions to extract team and env from branch name
func extractTeamFromBranch(branchName string) string {
	parts := strings.Split(branchName, "/")
	if len(parts) > 0 {
		return parts[0]
	}
	return branchName
}

func extractEnvFromBranch(branchName string) string {
	parts := strings.Split(branchName, "/")
	if len(parts) > 1 {
		return parts[1]
	}
	return ""
}

