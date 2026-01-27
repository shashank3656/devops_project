package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/bradleyfalzon/ghinstallation/v2"
	"github.com/google/go-github/v61/github"
)

func CreateGitHubPR(path string, content []byte) (string, error) {
	ctx := context.Background()

	itr, err := ghinstallation.NewKeyFromFile(
		http.DefaultTransport,
		GitHubAppID,
		GitHubInstallID,
		GitHubPrivateKey,
	)
	if err != nil {
		return "", err
	}

	client := github.NewClient(&http.Client{Transport: itr})

	branchName := fmt.Sprintf("infra-%d", time.Now().Unix())

	// 1. Get base branch
	baseRef, _, err := client.Git.GetRef(
		ctx, GitHubOwner, GitHubRepo, "refs/heads/"+BaseBranch,
	)
	if err != nil {
		return "", err
	}

	// 2. Create new branch
	newRef := &github.Reference{
		Ref: github.String("refs/heads/" + branchName),
		Object: &github.GitObject{
			SHA: baseRef.Object.SHA,
		},
	}
	_, _, err = client.Git.CreateRef(ctx, GitHubOwner, GitHubRepo, newRef)
	if err != nil {
		return "", err
	}

	// 3. Create or update file
	opts := &github.RepositoryContentFileOptions{
		Message: github.String("Add infra config"),
		Content: content,
		Branch:  github.String(branchName),
	}

	_, _, err = client.Repositories.CreateFile(
		ctx, GitHubOwner, GitHubRepo, path, opts,
	)
	if err != nil {
		return "", err
	}

	// 4. Create PR
	pr := &github.NewPullRequest{
		Title: github.String("Infra request"),
		Head:  github.String(branchName),
		Base:  github.String(BaseBranch),
		Body:  github.String("Auto-generated infra request"),
	}

	createdPR, _, err := client.PullRequests.Create(
		ctx, GitHubOwner, GitHubRepo, pr,
	)
	if err != nil {
		return "", err
	}

	return createdPR.GetHTMLURL(), nil
}

