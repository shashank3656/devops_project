package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/go-github/v61/github"
)

const (
	vulnMaxTreeEntries = 8000
	vulnMaxLockfiles   = 40
	vulnMaxFileBytes   = 200000
)

func runVulnScanJob(jobID int) {
	if DB == nil || jobID <= 0 {
		return
	}
	var repoID int
	var state string
	if err := queryRowContext(`SELECT repo_id, state FROM vuln_scan_jobs WHERE id = $1`, jobID).Scan(&repoID, &state); err != nil {
		return
	}
	if state != "queued" && state != "running" {
		return
	}
	_, _ = execContext(`UPDATE vuln_scan_jobs SET state='running', stage='clone', started_at=COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id=$1`, jobID)
	owner, name, branch, exclusions := "", "", "main", ""
	if err := queryRowContext(`SELECT owner, name, branch, COALESCE(exclusions,'') FROM vuln_repositories WHERE id = $1`, repoID).Scan(&owner, &name, &branch, &exclusions); err != nil {
		failVulnScan(jobID, "queued", "Repository registration was not found.")
		return
	}
	commit, err := resolveVulnCommit(owner, name, branch)
	if err != nil {
		failVulnScan(jobID, "clone", err.Error())
		return
	}
	_, _ = execContext(`UPDATE vuln_scan_jobs SET stage='inventory', commit_sha=$2 WHERE id=$1`, jobID, commit)
	paths, truncated, err := listVulnRepoPaths(owner, name, commit)
	if err != nil {
		failVulnScan(jobID, "inventory", err.Error())
		return
	}
	lockfiles := discoverVulnLockfiles(paths)
	excludedGaps := []vulnCoverageGap{}
	lockfiles, excludedGaps = applyVulnExclusions(lockfiles, exclusions)
	if len(lockfiles) > vulnMaxLockfiles {
		lockfiles = lockfiles[:vulnMaxLockfiles]
	}
	parsedItems := make([]vulnParsedInventory, 0, len(lockfiles))
	coverage := []vulnCoverageGap{}
	coverage = append(coverage, excludedGaps...)
	if truncated {
		coverage = append(coverage, vulnCoverageGap{Path: "/", Reason: "GitHub truncated the repository tree. Some modules may be unscanned."})
	}
	for _, filePath := range lockfiles {
		content, sizeOK, getErr := fetchVulnRepoFile(owner, name, filePath, commit)
		if getErr != nil {
			coverage = append(coverage, vulnCoverageGap{Path: filePath, Reason: "File could not be read from the immutable commit."})
			continue
		}
		if !sizeOK {
			coverage = append(coverage, vulnCoverageGap{Path: filePath, Reason: "File exceeded the scan size cap and was skipped."})
			continue
		}
		parsedItems = append(parsedItems, parseVulnArtifact(filePath, content))
	}
	merged := mergeParsedInventories(parsedItems)
	merged.Coverage = append(coverage, merged.Coverage...)
	if len(lockfiles) == 0 {
		merged.Coverage = append(merged.Coverage, vulnCoverageGap{Path: "/", Reason: "No supported lockfile or SBOM was found. This is not a clean result."})
	}
	_, _ = execContext(`UPDATE vuln_scan_jobs SET stage='correlation' WHERE id=$1`, jobID)
	if err := saveInventoryAndCorrelate(jobID, repoID, commit, merged); err != nil {
		failVulnScan(jobID, "correlation", "Inventory could not be saved.")
		return
	}
	state = "succeeded"
	if len(merged.Coverage) > 0 {
		state = "partial"
	}
	assessed := 0
	seenMod := map[string]bool{}
	for _, item := range merged.Components {
		if !seenMod[item.ModulePath] {
			seenMod[item.ModulePath] = true
			assessed++
		}
	}
	_, _ = execContext(`
		UPDATE vuln_scan_jobs
		SET state=$2, stage='done', coverage_json=$3, discovered_modules=$4, assessed_modules=$5, error='', finished_at=CURRENT_TIMESTAMP
		WHERE id=$1
	`, jobID, state, encodeJSONString(merged.Coverage), len(merged.Modules), assessed)
}

func failVulnScan(jobID int, stage, message string) {
	_, _ = execContext(`
		UPDATE vuln_scan_jobs
		SET state='failed', stage=$2, error=$3, finished_at=CURRENT_TIMESTAMP
		WHERE id=$1
	`, jobID, stage, message)
}

func resolveVulnCommit(owner, name, branch string) (string, error) {
	client, err := vulnGitHubClient()
	if err != nil {
		return "", err
	}
	ctx := context.Background()
	ref, _, err := client.Git.GetRef(ctx, owner, name, "refs/heads/"+branch)
	if err != nil {
		return "", fmt.Errorf("The default branch could not be resolved. Check repository access.")
	}
	sha := ""
	if ref != nil && ref.Object != nil {
		sha = ref.Object.GetSHA()
	}
	if sha == "" {
		return "", fmt.Errorf("The commit SHA was empty.")
	}
	return sha, nil
}

func listVulnRepoPaths(owner, name, sha string) ([]string, bool, error) {
	client, err := vulnGitHubClient()
	if err != nil {
		return nil, false, err
	}
	tree, _, err := client.Git.GetTree(context.Background(), owner, name, sha, true)
	if err != nil {
		return nil, false, fmt.Errorf("The repository tree could not be read.")
	}
	if tree == nil {
		return nil, false, fmt.Errorf("The repository tree was empty.")
	}
	truncated := tree.GetTruncated()
	if len(tree.Entries) > vulnMaxTreeEntries {
		truncated = true
	}
	limit := len(tree.Entries)
	if limit > vulnMaxTreeEntries {
		limit = vulnMaxTreeEntries
	}
	out := make([]string, 0, limit)
	for i := 0; i < limit; i++ {
		entry := tree.Entries[i]
		if entry.GetType() != "blob" {
			continue
		}
		out = append(out, entry.GetPath())
	}
	return out, truncated, nil
}

func fetchVulnRepoFile(owner, name, path, sha string) (string, bool, error) {
	client, err := vulnGitHubClient()
	if err != nil {
		return "", false, err
	}
	file, _, _, err := client.Repositories.GetContents(context.Background(), owner, name, path, &github.RepositoryContentGetOptions{Ref: sha})
	if err != nil {
		return "", false, err
	}
	if file == nil {
		return "", false, fmt.Errorf("missing file")
	}
	if file.GetSize() > vulnMaxFileBytes {
		return "", false, nil
	}
	content, err := file.GetContent()
	if err != nil {
		return "", false, err
	}
	if len(content) > vulnMaxFileBytes {
		return "", false, nil
	}
	return content, true, nil
}

func vulnGitHubClient() (*github.Client, error) {
	if strings.TrimSpace(GitHubToken) == "" {
		return nil, fmt.Errorf("Hosted collector needs GITHUB_TOKEN on the API. Private outbound agents and CI inventory uploads are the alternatives.")
	}
	return newGitHubClient()
}
