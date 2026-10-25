package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const vulnAccessFresh = 30 * time.Minute

func probeVulnRepoAccess(provider, owner, name string) (state, detail string) {
	owner, name = strings.TrimSpace(owner), strings.TrimSpace(name)
	if owner == "" || name == "" {
		return "unknown", "Repository owner and name are missing."
	}
	switch normalizeVulnProvider(provider) {
	case vulnProviderGitLab:
		if vulnGitLabToken() == "" {
			return "no_token", "GITLAB_TOKEN is not set on the API."
		}
		_, err := gitlabDo(http.MethodGet, "/api/v4/projects/"+gitlabProjectPath(owner, name), nil)
		if err != nil {
			return "not_found", fmt.Sprintf("GitLab did not return %s/%s with this token.", owner, name)
		}
		return "reachable", "GitLab returned this repository."
	case vulnProviderBitbucket:
		if vulnBitbucketToken() == "" {
			return "no_token", "BITBUCKET_TOKEN is not set on the API."
		}
		_, err := bitbucketDo(http.MethodGet, fmt.Sprintf("/2.0/repositories/%s/%s", url.PathEscape(owner), url.PathEscape(name)), nil)
		if err != nil {
			return "not_found", fmt.Sprintf("Bitbucket did not return %s/%s with this token.", owner, name)
		}
		return "reachable", "Bitbucket returned this repository."
	default:
		if strings.TrimSpace(GitHubToken) == "" {
			return "no_token", "GITHUB_TOKEN is not set on the API."
		}
		client, err := vulnGitHubClient()
		if err != nil {
			return "no_token", "GITHUB_TOKEN is not set on the API."
		}
		_, resp, getErr := client.Repositories.Get(context.Background(), owner, name)
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		if status == 0 {
			status = githubStatusCode(getErr)
		}
		switch status {
		case 401, 403:
			return "denied", fmt.Sprintf("GitHub refused %s/%s with this token.", owner, name)
		case 404:
			return "not_found", fmt.Sprintf("GitHub did not return %s/%s with this token. Private repos need GITHUB_TOKEN access.", owner, name)
		}
		if getErr != nil {
			return "unknown", "The repository could not be checked. The token value is not shown."
		}
		return "reachable", "GitHub returned this repository."
	}
}

func accessLabelForCollector(mode, state string) string {
	if strings.TrimSpace(mode) != "" && mode != "hosted" {
		return "not_hosted"
	}
	return firstNonEmpty(state, "unknown")
}

func refreshVulnRepoAccess(item *vulnRepoConfig, force bool) {
	if item == nil || item.ID <= 0 {
		return
	}
	if item.CollectionMode != "" && item.CollectionMode != "hosted" {
		item.AccessState = "not_hosted"
		item.AccessDetail = "Hosted collector is not used for this repository."
		persistVulnRepoAccess(item.ID, item.AccessState, item.AccessDetail)
		return
	}
	if !force && item.AccessCheckedAt != nil {
		if checked, err := time.Parse(time.RFC3339, *item.AccessCheckedAt); err == nil && time.Since(checked) < vulnAccessFresh && item.AccessState != "" && item.AccessState != "unknown" {
			return
		}
	}
	owner, name := "", ""
	_ = queryRowContext(`SELECT owner, name FROM vuln_repositories WHERE id=$1`, item.ID).Scan(&owner, &name)
	if owner == "" {
		_, owner, name = parseVulnRepo(item.Repository)
	}
	state, detail := probeVulnRepoAccess(item.Provider, owner, name)
	item.AccessState = state
	item.AccessDetail = detail
	now := time.Now().UTC().Format(time.RFC3339)
	item.AccessCheckedAt = &now
	persistVulnRepoAccess(item.ID, state, detail)
}

func persistVulnRepoAccess(id int, state, detail string) {
	if id <= 0 {
		return
	}
	_, _ = execContext(`UPDATE vuln_repositories SET access_state=$2, access_detail=$3, access_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, id, firstNonEmpty(state, "unknown"), strings.TrimSpace(detail))
}

func summarizeVulnCoverage(gaps []vulnCoverageGap) string {
	if len(gaps) == 0 {
		return "No coverage notes in scanned files"
	}
	declared, lock, skip, source := 0, 0, 0, 0
	for _, gap := range gaps {
		reason := strings.ToLower(gap.Reason + " " + gap.Adapter)
		switch {
		case strings.Contains(reason, "package.json declared"), strings.Contains(reason, "declared version"):
			declared++
		case strings.Contains(reason, "no supported lockfile"), strings.Contains(reason, "lockfile"):
			lock++
		case strings.Contains(reason, "excluded"), strings.Contains(reason, "skip"):
			skip++
		case strings.Contains(reason, "source"):
			source++
		}
	}
	parts := []string{fmt.Sprintf("%d notes", len(gaps))}
	if lock > 0 {
		parts = append(parts, "missing or partial lockfile")
	}
	if declared > 0 {
		parts = append(parts, "package.json declared versions")
	}
	if skip > 0 {
		parts = append(parts, "excluded paths")
	}
	if source > 0 {
		parts = append(parts, "source sampling incomplete")
	}
	return strings.Join(parts, " · ")
}
