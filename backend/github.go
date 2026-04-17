package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/google/go-github/v61/github"
	"golang.org/x/oauth2"
)

// CheckGitHubConnectivity returns true if GitHub token is set and API is reachable
func CheckGitHubConnectivity() (ok bool, err error) {
	if GitHubToken == "" {
		return false, nil
	}
	ctx := context.Background()
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: GitHubToken})
	tc := oauth2.NewClient(ctx, ts)
	client := github.NewClient(tc)
	_, _, err = client.Repositories.Get(ctx, GitHubOwner, GitHubRepo)
	if err != nil {
		return false, err
	}
	return true, nil
}

func CreateGitHubPR(branchName, filePath string, content []byte, applicationID string) (string, error) {
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
		AppendGitHubLog("branch_exists", fmt.Sprintf("Branch %s already exists, updating it", branchName), branchName)
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
		AppendGitHubLog("branch_created", fmt.Sprintf("Created new branch: %s", branchName), branchName)
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
		AppendGitHubLog("file_update", fmt.Sprintf("File %s exists, updating it", filePath), filePath)
	} else {
		log.Printf("File %s does not exist, will create it", filePath)
		AppendGitHubLog("file_create", fmt.Sprintf("File %s does not exist, creating it", filePath), filePath)
	}

	mergedContent := content
	if sha != nil {
		mergedContent, err = maybeMergeGitHubRequestContent(filePath, fileContent, content)
		if err != nil {
			return "", fmt.Errorf("failed to prepare request content: %w", err)
		}
	}

	// 4. Create or update file
	opts := &github.RepositoryContentFileOptions{
		Message: github.String(fmt.Sprintf("Add/Update infra config: %s", filePath)),
		Content: mergedContent,
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
		AppendGitHubLog("pr_exists", fmt.Sprintf("PR already exists for branch %s", branchName), prs[0].GetHTMLURL())
		return prs[0].GetHTMLURL(), nil
	}

	// 6. Create new PR
	bodyStr := fmt.Sprintf("Auto-generated infrastructure request\n\n**Team:** %s\n**Environment:** %s\n**File:** %s",
		extractTeamFromBranch(branchName), extractEnvFromBranch(branchName), filePath)
	if applicationID != "" {
		bodyStr = fmt.Sprintf("Auto-generated infrastructure request\n\n**Application ID:** %s\n**Team:** %s\n**Environment:** %s\n**File:** %s",
			applicationID, extractTeamFromBranch(branchName), extractEnvFromBranch(branchName), filePath)
	}
	title := fmt.Sprintf("Infrastructure: %s", branchName)
	if applicationID != "" {
		title = fmt.Sprintf("Infrastructure: %s [%s]", branchName, applicationID)
	}
	pr := &github.NewPullRequest{
		Title: github.String(title),
		Head:  github.String(branchName),
		Base:  github.String(BaseBranch),
		Body:  github.String(bodyStr),
	}

	createdPR, _, err := client.PullRequests.Create(
		ctx, GitHubOwner, GitHubRepo, pr,
	)
	if err != nil {
		return "", fmt.Errorf("failed to create PR: %w", err)
	}

	log.Printf("Created PR #%d: %s", createdPR.GetNumber(), createdPR.GetHTMLURL())
	AppendGitHubLog("pr_created", fmt.Sprintf("Created PR #%d: %s", createdPR.GetNumber(), createdPR.GetHTMLURL()), createdPR.GetHTMLURL())
	return createdPR.GetHTMLURL(), nil
}

var storageBucketConfigFields = []string{
	"bucket_name",
	"region",
	"storage_class",
	"soft_delete_policy",
	"versioning_enabled",
	"bucket_retention_policy_enabled",
	"object_retention_enabled",
	"encryption_type",
	"kms_key_name",
}

func maybeMergeGitHubRequestContent(filePath string, existingFile *github.RepositoryContent, content []byte) ([]byte, error) {
	if existingFile == nil || !strings.HasSuffix(strings.ToLower(strings.TrimSpace(filePath)), "request.json") {
		return content, nil
	}

	existingContent, err := existingFile.GetContent()
	if err != nil {
		return nil, fmt.Errorf("decode existing request.json: %w", err)
	}
	if strings.TrimSpace(existingContent) == "" {
		return content, nil
	}

	return mergeStorageBucketRequestContent([]byte(existingContent), content)
}

func mergeStorageBucketRequestContent(existingContent, newContent []byte) ([]byte, error) {
	var existingPayload map[string]interface{}
	if err := json.Unmarshal(existingContent, &existingPayload); err != nil {
		return nil, fmt.Errorf("parse existing request payload: %w", err)
	}

	var newPayload map[string]interface{}
	if err := json.Unmarshal(newContent, &newPayload); err != nil {
		return nil, fmt.Errorf("parse new request payload: %w", err)
	}

	if !isGCPStorageBucketRequestPayload(newPayload) || !isGCPStorageBucketRequestPayload(existingPayload) {
		return newContent, nil
	}

	mergedPayload := cloneJSONMap(existingPayload)
	for key, value := range newPayload {
		if key == "config" {
			continue
		}
		mergedPayload[key] = value
	}

	existingConfig := extractRequestConfigMap(existingPayload)
	newConfig := extractRequestConfigMap(newPayload)
	mergedConfig := cloneJSONMap(existingConfig)

	buckets, err := mergeStorageBucketEntries(mergedConfig, newConfig)
	if err != nil {
		return nil, err
	}

	for key, value := range newConfig {
		if key == "buckets" || isStorageBucketConfigField(key) {
			continue
		}
		mergedConfig[key] = value
	}

	if len(buckets) > 0 {
		mergedConfig["buckets"] = buckets
		mergedConfig["bucket_count"] = len(buckets)
		applyPrimaryStorageBucketFields(mergedConfig, buckets[len(buckets)-1])
	}

	mergedPayload["config"] = mergedConfig
	return json.MarshalIndent(mergedPayload, "", "  ")
}

func isGCPStorageBucketRequestPayload(payload map[string]interface{}) bool {
	if payload == nil {
		return false
	}
	cloud := strings.ToLower(strings.TrimSpace(stringValue(payload["cloud"])))
	service := normalizeStorageBucketServiceKey(stringValue(payload["service"]))
	if cloud != "gcp" || service != "cloud-storage" {
		return false
	}

	config := extractRequestConfigMap(payload)
	if _, ok := storageBucketEntryFromConfig(config); ok {
		return true
	}
	if raw, ok := config["buckets"]; ok && raw != nil {
		return true
	}
	return false
}

func normalizeStorageBucketServiceKey(service string) string {
	switch strings.TrimSpace(strings.ToLower(service)) {
	case "storage", "cloud-storage", "cloud_storage", "cloud storage":
		return "cloud-storage"
	default:
		return strings.TrimSpace(strings.ToLower(service))
	}
}

func extractRequestConfigMap(payload map[string]interface{}) map[string]interface{} {
	if payload == nil {
		return map[string]interface{}{}
	}
	if rawConfig, ok := payload["config"].(map[string]interface{}); ok && rawConfig != nil {
		return rawConfig
	}
	return map[string]interface{}{}
}

func mergeStorageBucketEntries(existingConfig, newConfig map[string]interface{}) ([]map[string]interface{}, error) {
	existingEntries, err := collectStorageBucketEntries(existingConfig)
	if err != nil {
		return nil, err
	}

	newEntry, ok := storageBucketEntryFromConfig(newConfig)
	if !ok {
		return existingEntries, nil
	}
	return upsertStorageBucketEntry(existingEntries, newEntry), nil
}

func collectStorageBucketEntries(config map[string]interface{}) ([]map[string]interface{}, error) {
	entries := make([]map[string]interface{}, 0)
	if config == nil {
		return entries, nil
	}

	if rawBuckets, ok := config["buckets"]; ok && rawBuckets != nil {
		normalized, err := normalizeStorageBucketEntries(rawBuckets)
		if err != nil {
			return nil, err
		}
		for _, entry := range normalized {
			entries = upsertStorageBucketEntry(entries, entry)
		}
	}

	if singleEntry, ok := storageBucketEntryFromConfig(config); ok {
		entries = upsertStorageBucketEntry(entries, singleEntry)
	}

	return entries, nil
}

func normalizeStorageBucketEntries(raw any) ([]map[string]interface{}, error) {
	switch value := raw.(type) {
	case []map[string]interface{}:
		out := make([]map[string]interface{}, 0, len(value))
		for _, item := range value {
			entry, ok := storageBucketEntryFromConfig(item)
			if !ok {
				continue
			}
			out = append(out, entry)
		}
		return out, nil
	case []interface{}:
		out := make([]map[string]interface{}, 0, len(value))
		for index, item := range value {
			itemMap, err := coerceJSONMap(item)
			if err != nil {
				return nil, fmt.Errorf("invalid storage bucket item %d", index+1)
			}
			entry, ok := storageBucketEntryFromConfig(itemMap)
			if !ok {
				continue
			}
			out = append(out, entry)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("storage bucket list must be an array")
	}
}

func coerceJSONMap(raw any) (map[string]interface{}, error) {
	if rawMap, ok := raw.(map[string]interface{}); ok && rawMap != nil {
		return rawMap, nil
	}

	bytes, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func storageBucketEntryFromConfig(config map[string]interface{}) (map[string]interface{}, bool) {
	if config == nil {
		return nil, false
	}

	bucketName := strings.TrimSpace(stringValue(config["bucket_name"]))
	if bucketName == "" {
		return nil, false
	}

	entry := map[string]interface{}{
		"bucket_name": bucketName,
	}
	for _, field := range storageBucketConfigFields {
		if field == "bucket_name" {
			continue
		}
		if value, ok := config[field]; ok && value != nil {
			entry[field] = value
		}
	}
	return entry, true
}

func upsertStorageBucketEntry(entries []map[string]interface{}, entry map[string]interface{}) []map[string]interface{} {
	if entry == nil {
		return entries
	}

	targetName := strings.ToLower(strings.TrimSpace(stringValue(entry["bucket_name"])))
	if targetName == "" {
		return entries
	}

	clonedEntry := cloneJSONMap(entry)
	for index, existing := range entries {
		if strings.ToLower(strings.TrimSpace(stringValue(existing["bucket_name"]))) == targetName {
			entries[index] = clonedEntry
			return entries
		}
	}
	return append(entries, clonedEntry)
}

func applyPrimaryStorageBucketFields(config map[string]interface{}, entry map[string]interface{}) {
	if config == nil {
		return
	}

	for _, field := range storageBucketConfigFields {
		if value, ok := entry[field]; ok {
			config[field] = value
		} else {
			delete(config, field)
		}
	}
}

func isStorageBucketConfigField(field string) bool {
	for _, name := range storageBucketConfigFields {
		if name == field {
			return true
		}
	}
	return false
}

func cloneJSONMap(source map[string]interface{}) map[string]interface{} {
	if source == nil {
		return map[string]interface{}{}
	}
	cloned := make(map[string]interface{}, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func CreateGitHubPRWithFiles(branchName string, files map[string][]byte, title, body string) (string, error) {
	ctx := context.Background()

	if GitHubToken == "" {
		return "", fmt.Errorf("GITHUB_TOKEN environment variable is required")
	}
	if len(files) == 0 {
		return "", fmt.Errorf("at least one file is required")
	}

	ts := oauth2.StaticTokenSource(
		&oauth2.Token{AccessToken: GitHubToken},
	)
	tc := oauth2.NewClient(ctx, ts)
	client := github.NewClient(tc)

	baseRef, _, err := client.Git.GetRef(
		ctx, GitHubOwner, GitHubRepo, "refs/heads/"+BaseBranch,
	)
	if err != nil {
		return "", fmt.Errorf("failed to get base branch: %w", err)
	}

	branchRef := "refs/heads/" + branchName
	_, _, branchErr := client.Git.GetRef(ctx, GitHubOwner, GitHubRepo, branchRef)
	if branchErr == nil {
		log.Printf("Branch %s already exists, updating it", branchName)
		AppendGitHubLog("branch_exists", fmt.Sprintf("Branch %s already exists, updating it", branchName), branchName)
	} else {
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
		AppendGitHubLog("branch_created", fmt.Sprintf("Created new branch: %s", branchName), branchName)
	}

	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	for _, filePath := range paths {
		content := files[filePath]
		fileContent, _, _, err := client.Repositories.GetContents(
			ctx, GitHubOwner, GitHubRepo, filePath, &github.RepositoryContentGetOptions{
				Ref: branchName,
			},
		)

		var sha *string
		if err == nil && fileContent != nil {
			sha = fileContent.SHA
			log.Printf("File %s exists, will update it", filePath)
			AppendGitHubLog("file_update", fmt.Sprintf("File %s exists, updating it", filePath), filePath)
		} else {
			log.Printf("File %s does not exist, will create it", filePath)
			AppendGitHubLog("file_create", fmt.Sprintf("File %s does not exist, creating it", filePath), filePath)
		}

		opts := &github.RepositoryContentFileOptions{
			Message: github.String(fmt.Sprintf("Add/Update infra config: %s", filePath)),
			Content: content,
			Branch:  github.String(branchName),
		}
		if sha != nil {
			opts.SHA = sha
		}

		if _, _, err := client.Repositories.CreateFile(
			ctx, GitHubOwner, GitHubRepo, filePath, opts,
		); err != nil {
			return "", fmt.Errorf("failed to create/update file %s: %w", filePath, err)
		}
	}

	prs, _, err := client.PullRequests.List(ctx, GitHubOwner, GitHubRepo, &github.PullRequestListOptions{
		State: "open",
		Head:  fmt.Sprintf("%s:%s", GitHubOwner, branchName),
		Base:  BaseBranch,
	})
	if err != nil {
		return "", fmt.Errorf("failed to check existing PRs: %w", err)
	}
	if len(prs) > 0 {
		log.Printf("PR already exists for branch %s, returning existing PR", branchName)
		AppendGitHubLog("pr_exists", fmt.Sprintf("PR already exists for branch %s", branchName), prs[0].GetHTMLURL())
		return prs[0].GetHTMLURL(), nil
	}

	if strings.TrimSpace(title) == "" {
		title = fmt.Sprintf("Infrastructure: %s", branchName)
	}
	if strings.TrimSpace(body) == "" {
		body = fmt.Sprintf("Auto-generated infrastructure request\n\n**Branch:** %s", branchName)
	}

	pr := &github.NewPullRequest{
		Title: github.String(title),
		Head:  github.String(branchName),
		Base:  github.String(BaseBranch),
		Body:  github.String(body),
	}

	createdPR, _, err := client.PullRequests.Create(
		ctx, GitHubOwner, GitHubRepo, pr,
	)
	if err != nil {
		return "", fmt.Errorf("failed to create PR: %w", err)
	}

	log.Printf("Created PR #%d: %s", createdPR.GetNumber(), createdPR.GetHTMLURL())
	AppendGitHubLog("pr_created", fmt.Sprintf("Created PR #%d: %s", createdPR.GetNumber(), createdPR.GetHTMLURL()), createdPR.GetHTMLURL())
	return createdPR.GetHTMLURL(), nil
}

// Helper functions to extract team and env from branch name
func extractTeamFromBranch(branchName string) string {
	parts := strings.Split(branchName, "/")
	if len(parts) >= 6 && strings.EqualFold(parts[0], "project") {
		return parts[2]
	}
	if len(parts) > 0 {
		return parts[0]
	}
	return branchName
}

func extractEnvFromBranch(branchName string) string {
	parts := strings.Split(branchName, "/")
	if len(parts) >= 6 && strings.EqualFold(parts[0], "project") {
		return parts[4]
	}
	if len(parts) > 1 {
		return parts[1]
	}
	return ""
}
