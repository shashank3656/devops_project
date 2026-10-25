package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	vulnProviderGitHub    = "github"
	vulnProviderGitLab    = "gitlab"
	vulnProviderBitbucket = "bitbucket"
	vulnMaxSCMBody        = 2 << 20
)

var vulnSCMClient = &http.Client{Timeout: 25 * time.Second}

func normalizeVulnProvider(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case vulnProviderGitLab:
		return vulnProviderGitLab
	case vulnProviderBitbucket:
		return vulnProviderBitbucket
	default:
		return vulnProviderGitHub
	}
}

func vulnReposMatch(left, right string) bool {
	_, ownerA, nameA := parseVulnRepo(left)
	_, ownerB, nameB := parseVulnRepo(right)
	if ownerA != "" && nameA != "" && strings.EqualFold(ownerA, ownerB) && strings.EqualFold(nameA, nameB) {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right)) && strings.TrimSpace(left) != ""
}

func parseVulnRepo(raw string) (provider, owner, name string) {
	value := strings.TrimSpace(raw)
	value = strings.TrimSuffix(value, ".git")
	if value == "" {
		return "", "", ""
	}
	lower := strings.ToLower(value)
	switch {
	case strings.Contains(lower, "gitlab.com/") || strings.HasPrefix(lower, "git@gitlab.com:"):
		rest := scmPathAfterHost(value, "gitlab.com")
		parts := splitSCMPath(rest)
		if len(parts) >= 2 {
			return vulnProviderGitLab, strings.Join(parts[:len(parts)-1], "/"), parts[len(parts)-1]
		}
	case strings.Contains(lower, "bitbucket.org/") || strings.HasPrefix(lower, "git@bitbucket.org:"):
		rest := scmPathAfterHost(value, "bitbucket.org")
		parts := splitSCMPath(rest)
		if len(parts) >= 2 {
			return vulnProviderBitbucket, parts[0], parts[1]
		}
	default:
		rest := value
		rest = strings.TrimPrefix(rest, "https://")
		rest = strings.TrimPrefix(rest, "http://")
		rest = strings.TrimPrefix(rest, "git@github.com:")
		rest = strings.TrimPrefix(rest, "github.com/")
		parts := splitSCMPath(rest)
		if len(parts) >= 2 {
			return vulnProviderGitHub, parts[0], parts[1]
		}
	}
	return "", "", ""
}

func scmPathAfterHost(raw, host string) string {
	value := strings.TrimSpace(raw)
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimPrefix(value, "http://")
	lower := strings.ToLower(value)
	prefix := "git@" + host + ":"
	if strings.HasPrefix(lower, prefix) {
		return value[len(prefix):]
	}
	if strings.HasPrefix(lower, host+"/") {
		return value[len(host)+1:]
	}
	if idx := strings.Index(lower, host+"/"); idx >= 0 {
		return value[idx+len(host)+1:]
	}
	return value
}

func splitSCMPath(raw string) []string {
	out := []string{}
	for _, part := range strings.Split(strings.Trim(raw, "/"), "/") {
		part = strings.TrimSpace(part)
		if part != "" && part != "-" {
			out = append(out, part)
		}
	}
	return out
}

func vulnGitLabToken() string { return strings.TrimSpace(os.Getenv("GITLAB_TOKEN")) }

func vulnBitbucketToken() string { return strings.TrimSpace(os.Getenv("BITBUCKET_TOKEN")) }

func vulnGitLabBase() string {
	base := strings.TrimSpace(os.Getenv("GITLAB_URL"))
	if base == "" {
		base = "https://gitlab.com"
	}
	return strings.TrimRight(base, "/")
}

func vulnHostedCollectorConfigured() bool {
	return strings.TrimSpace(GitHubToken) != "" || vulnGitLabToken() != "" || vulnBitbucketToken() != ""
}

func hostedCollectorNote() string {
	names := make([]string, 0, 3)
	if strings.TrimSpace(GitHubToken) != "" {
		names = append(names, "GITHUB_TOKEN")
	}
	if vulnGitLabToken() != "" {
		names = append(names, "GITLAB_TOKEN")
	}
	if vulnBitbucketToken() != "" {
		names = append(names, "BITBUCKET_TOKEN")
	}
	if len(names) == 0 {
		return "Hosted collector is offline until GITHUB_TOKEN, GITLAB_TOKEN, or BITBUCKET_TOKEN is set on the API. Those names are stored as secret references, not shown here."
	}
	return "Hosted collector is configured on the API for " + strings.Join(names, ", ") + "."
}

func vulnBranchCandidates(requested, defaultBranch string) []string {
	out := make([]string, 0, 4)
	seen := map[string]bool{}
	for _, item := range []string{requested, defaultBranch, "main", "master"} {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
	}
	return out
}

func resolveVulnCommit(provider, owner, name, branch string) (sha, used string, err error) {
	switch normalizeVulnProvider(provider) {
	case vulnProviderGitLab:
		return resolveGitLabCommit(owner, name, branch)
	case vulnProviderBitbucket:
		return resolveBitbucketCommit(owner, name, branch)
	default:
		return resolveGitHubVulnCommit(owner, name, branch)
	}
}

func listVulnRepoPaths(provider, owner, name, sha string) ([]string, bool, error) {
	switch normalizeVulnProvider(provider) {
	case vulnProviderGitLab:
		return listGitLabRepoPaths(owner, name, sha)
	case vulnProviderBitbucket:
		return listBitbucketRepoPaths(owner, name, sha)
	default:
		return listGitHubVulnRepoPaths(owner, name, sha)
	}
}

func fetchVulnRepoFile(provider, owner, name, path, sha string) (string, bool, error) {
	switch normalizeVulnProvider(provider) {
	case vulnProviderGitLab:
		return fetchGitLabRepoFile(owner, name, path, sha)
	case vulnProviderBitbucket:
		return fetchBitbucketRepoFile(owner, name, path, sha)
	default:
		return fetchGitHubVulnRepoFile(owner, name, path, sha)
	}
}

func gitlabProjectPath(owner, name string) string {
	return url.QueryEscape(strings.Trim(owner+"/"+name, "/"))
}

func gitlabDefaultBranch(owner, name string) string {
	raw, err := gitlabDo(http.MethodGet, "/api/v4/projects/"+gitlabProjectPath(owner, name), nil)
	if err != nil {
		return ""
	}
	var payload struct {
		DefaultBranch string `json:"default_branch"`
	}
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	return strings.TrimSpace(payload.DefaultBranch)
}

func resolveGitLabCommit(owner, name, branch string) (string, string, error) {
	candidates := vulnBranchCandidates(branch, gitlabDefaultBranch(owner, name))
	for _, cand := range candidates {
		raw, err := gitlabDo(http.MethodGet, "/api/v4/projects/"+gitlabProjectPath(owner, name)+"/repository/branches/"+url.PathEscape(cand), nil)
		if err != nil {
			continue
		}
		var payload struct {
			Commit struct {
				ID string `json:"id"`
			} `json:"commit"`
		}
		if json.Unmarshal(raw, &payload) != nil || strings.TrimSpace(payload.Commit.ID) == "" {
			continue
		}
		return payload.Commit.ID, cand, nil
	}
	return "", "", fmt.Errorf("No matching branch was found for %s/%s. Tried %s.", owner, name, strings.Join(candidates, ", "))
}

func listGitLabRepoPaths(owner, name, sha string) ([]string, bool, error) {
	out := []string{}
	truncated := false
	for page := 1; page <= 80; page++ {
		path := fmt.Sprintf("/api/v4/projects/%s/repository/tree?ref=%s&recursive=true&per_page=100&page=%d", gitlabProjectPath(owner, name), url.QueryEscape(sha), page)
		raw, err := gitlabDo(http.MethodGet, path, nil)
		if err != nil {
			return nil, false, fmt.Errorf("The repository tree could not be read.")
		}
		var entries []struct {
			Type string `json:"type"`
			Path string `json:"path"`
		}
		if json.Unmarshal(raw, &entries) != nil {
			return nil, false, fmt.Errorf("The repository tree could not be read.")
		}
		if len(entries) == 0 {
			break
		}
		for _, entry := range entries {
			if entry.Type != "blob" || strings.TrimSpace(entry.Path) == "" {
				continue
			}
			out = append(out, entry.Path)
			if len(out) >= vulnMaxTreeEntries {
				return out, true, nil
			}
		}
		if len(entries) < 100 {
			break
		}
		if page == 80 {
			truncated = true
		}
	}
	return out, truncated, nil
}

func fetchGitLabRepoFile(owner, name, filePath, sha string) (string, bool, error) {
	apiPath := fmt.Sprintf("/api/v4/projects/%s/repository/files/%s?ref=%s", gitlabProjectPath(owner, name), url.QueryEscape(filePath), url.QueryEscape(sha))
	raw, err := gitlabDo(http.MethodGet, apiPath, nil)
	if err != nil {
		return "", false, err
	}
	var payload struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
		Size     int    `json:"size"`
	}
	if json.Unmarshal(raw, &payload) != nil {
		return "", false, fmt.Errorf("missing file")
	}
	if payload.Size > vulnMaxFileBytes {
		return "", false, nil
	}
	content := payload.Content
	if strings.EqualFold(payload.Encoding, "base64") {
		decoded, decErr := base64.StdEncoding.DecodeString(strings.ReplaceAll(payload.Content, "\n", ""))
		if decErr != nil {
			return "", false, decErr
		}
		content = string(decoded)
	}
	if len(content) > vulnMaxFileBytes {
		return "", false, nil
	}
	return content, true, nil
}

func bitbucketDefaultBranch(owner, name string) string {
	raw, err := bitbucketDo(http.MethodGet, fmt.Sprintf("/2.0/repositories/%s/%s", url.PathEscape(owner), url.PathEscape(name)), nil)
	if err != nil {
		return ""
	}
	var payload struct {
		Mainbranch struct {
			Name string `json:"name"`
		} `json:"mainbranch"`
	}
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	return strings.TrimSpace(payload.Mainbranch.Name)
}

func resolveBitbucketCommit(owner, name, branch string) (string, string, error) {
	candidates := vulnBranchCandidates(branch, bitbucketDefaultBranch(owner, name))
	for _, cand := range candidates {
		raw, err := bitbucketDo(http.MethodGet, fmt.Sprintf("/2.0/repositories/%s/%s/refs/branches/%s", url.PathEscape(owner), url.PathEscape(name), url.PathEscape(cand)), nil)
		if err != nil {
			continue
		}
		var payload struct {
			Target struct {
				Hash string `json:"hash"`
			} `json:"target"`
		}
		if json.Unmarshal(raw, &payload) != nil || strings.TrimSpace(payload.Target.Hash) == "" {
			continue
		}
		return payload.Target.Hash, cand, nil
	}
	return "", "", fmt.Errorf("No matching branch was found for %s/%s. Tried %s.", owner, name, strings.Join(candidates, ", "))
}

func listBitbucketRepoPaths(owner, name, sha string) ([]string, bool, error) {
	next := fmt.Sprintf("https://api.bitbucket.org/2.0/repositories/%s/%s/src/%s/?max_depth=12&pagelen=100", url.PathEscape(owner), url.PathEscape(name), url.PathEscape(sha))
	out := []string{}
	truncated := false
	for page := 0; page < 80 && next != ""; page++ {
		raw, err := bitbucketDoURL(http.MethodGet, next, nil)
		if err != nil {
			return nil, false, fmt.Errorf("The repository tree could not be read.")
		}
		var payload struct {
			Next   string `json:"next"`
			Values []struct {
				Type string `json:"type"`
				Path string `json:"path"`
			} `json:"values"`
		}
		if json.Unmarshal(raw, &payload) != nil {
			return nil, false, fmt.Errorf("The repository tree could not be read.")
		}
		for _, entry := range payload.Values {
			if entry.Type != "commit_file" || strings.TrimSpace(entry.Path) == "" {
				continue
			}
			out = append(out, entry.Path)
			if len(out) >= vulnMaxTreeEntries {
				return out, true, nil
			}
		}
		next = payload.Next
		if next != "" && !scmURLAllowed(next) {
			return nil, false, fmt.Errorf("The repository tree could not be read.")
		}
		if page == 79 && next != "" {
			truncated = true
			break
		}
	}
	return out, truncated, nil
}

func fetchBitbucketRepoFile(owner, name, filePath, sha string) (string, bool, error) {
	apiPath := fmt.Sprintf("/2.0/repositories/%s/%s/src/%s/%s", url.PathEscape(owner), url.PathEscape(name), url.PathEscape(sha), strings.TrimPrefix(filePath, "/"))
	raw, err := bitbucketDo(http.MethodGet, apiPath, nil)
	if err != nil {
		return "", false, err
	}
	content := string(raw)
	if len(content) > vulnMaxFileBytes {
		return "", false, nil
	}
	return content, true, nil
}

func loadVulnPRSHAs(provider, owner, name string, prNumber int, allowFork bool) (baseSHA, headSHA string, err error) {
	switch normalizeVulnProvider(provider) {
	case vulnProviderGitLab:
		return loadGitLabMRSHAs(owner, name, prNumber, allowFork)
	case vulnProviderBitbucket:
		return loadBitbucketPRSHAs(owner, name, prNumber, allowFork)
	default:
		return loadGitHubPRSHAs(owner, name, prNumber, allowFork)
	}
}

func loadGitLabMRSHAs(owner, name string, iid int, allowFork bool) (string, string, error) {
	raw, err := gitlabDo(http.MethodGet, fmt.Sprintf("/api/v4/projects/%s/merge_requests/%d", gitlabProjectPath(owner, name), iid), nil)
	if err != nil {
		return "", "", fmt.Errorf("The merge request could not be read.")
	}
	var payload struct {
		ProjectID       int `json:"project_id"`
		SourceProjectID int `json:"source_project_id"`
		DiffRefs        struct {
			BaseSHA string `json:"base_sha"`
			HeadSHA string `json:"head_sha"`
		} `json:"diff_refs"`
	}
	if json.Unmarshal(raw, &payload) != nil {
		return "", "", fmt.Errorf("The merge request could not be read.")
	}
	if payload.SourceProjectID != 0 && payload.ProjectID != 0 && payload.SourceProjectID != payload.ProjectID && !allowFork {
		return "", "", fmt.Errorf("Fork pull requests are not scanned unless the repository policy allows them.")
	}
	if payload.DiffRefs.BaseSHA == "" || payload.DiffRefs.HeadSHA == "" {
		return "", "", fmt.Errorf("The pull request was missing an immutable commit SHA.")
	}
	return payload.DiffRefs.BaseSHA, payload.DiffRefs.HeadSHA, nil
}

func loadBitbucketPRSHAs(owner, name string, prNumber int, allowFork bool) (string, string, error) {
	raw, err := bitbucketDo(http.MethodGet, fmt.Sprintf("/2.0/repositories/%s/%s/pullrequests/%d", url.PathEscape(owner), url.PathEscape(name), prNumber), nil)
	if err != nil {
		return "", "", fmt.Errorf("The pull request could not be read.")
	}
	var payload struct {
		Source struct {
			Commit struct {
				Hash string `json:"hash"`
			} `json:"commit"`
			Repository struct {
				FullName string `json:"full_name"`
			} `json:"repository"`
		} `json:"source"`
		Destination struct {
			Commit struct {
				Hash string `json:"hash"`
			} `json:"commit"`
			Repository struct {
				FullName string `json:"full_name"`
			} `json:"repository"`
		} `json:"destination"`
	}
	if json.Unmarshal(raw, &payload) != nil {
		return "", "", fmt.Errorf("The pull request could not be read.")
	}
	if payload.Source.Repository.FullName != "" && payload.Destination.Repository.FullName != "" &&
		!strings.EqualFold(payload.Source.Repository.FullName, payload.Destination.Repository.FullName) && !allowFork {
		return "", "", fmt.Errorf("Fork pull requests are not scanned unless the repository policy allows them.")
	}
	if payload.Destination.Commit.Hash == "" || payload.Source.Commit.Hash == "" {
		return "", "", fmt.Errorf("The pull request was missing an immutable commit SHA.")
	}
	return payload.Destination.Commit.Hash, payload.Source.Commit.Hash, nil
}

func publishGitLabCommitStatus(owner, name, sha, state, desc, target string) {
	gitlabState := state
	if state == "failure" {
		gitlabState = "failed"
	}
	_, _ = gitlabDo(http.MethodPost, fmt.Sprintf("/api/v4/projects/%s/statuses/%s", gitlabProjectPath(owner, name), url.PathEscape(sha)), map[string]any{
		"state":       gitlabState,
		"name":        vulnPRCheckContext,
		"description": truncateStatusDescription(desc),
		"target_url":  target,
	})
}

func publishBitbucketCommitStatus(owner, name, sha, state, desc, target string) {
	bbState := "INPROGRESS"
	switch state {
	case "success":
		bbState = "SUCCESSFUL"
	case "failure":
		bbState = "FAILED"
	}
	_, _ = bitbucketDo(http.MethodPost, fmt.Sprintf("/2.0/repositories/%s/%s/commit/%s/statuses/build", url.PathEscape(owner), url.PathEscape(name), url.PathEscape(sha)), map[string]any{
		"key":         "opstrellis-vuln-comparison",
		"state":       bbState,
		"name":        vulnPRCheckContext,
		"description": truncateStatusDescription(desc),
		"url":         target,
	})
}

func openGitLabPatchMR(owner, name, branch, branchName, path, title, body, content string) (string, error) {
	fileAPI := fmt.Sprintf("/api/v4/projects/%s/repository/files/%s", gitlabProjectPath(owner, name), url.QueryEscape(path))
	payload := map[string]any{
		"branch":         branchName,
		"content":        content,
		"commit_message": "docs: proposed security patch",
		"start_branch":   branch,
	}
	if _, err := gitlabDo(http.MethodPost, fileAPI, payload); err != nil {
		payload["start_branch"] = nil
		delete(payload, "start_branch")
		if _, putErr := gitlabDo(http.MethodPut, fileAPI, map[string]any{
			"branch":         branchName,
			"content":        content,
			"commit_message": "docs: proposed security patch",
		}); putErr != nil {
			return "", fmt.Errorf("The patch proposal could not be written.")
		}
		_ = err
	}
	raw, err := gitlabDo(http.MethodPost, "/api/v4/projects/"+gitlabProjectPath(owner, name)+"/merge_requests", map[string]any{
		"source_branch": branchName,
		"target_branch": branch,
		"title":         title,
		"description":   body,
		"draft":         true,
	})
	if err != nil {
		return "", fmt.Errorf("The patch merge request could not be opened.")
	}
	var created struct {
		WebURL string `json:"web_url"`
	}
	if json.Unmarshal(raw, &created) != nil || created.WebURL == "" {
		return "", fmt.Errorf("The patch merge request could not be opened.")
	}
	return created.WebURL, nil
}

func gitlabDo(method, apiPath string, body any) ([]byte, error) {
	if vulnGitLabToken() == "" {
		return nil, fmt.Errorf("Hosted collector needs GITLAB_TOKEN on the API. Private outbound agents and CI inventory uploads are the alternatives.")
	}
	return scmDo(method, vulnGitLabBase()+apiPath, "PRIVATE-TOKEN", vulnGitLabToken(), body)
}

func bitbucketDo(method, apiPath string, body any) ([]byte, error) {
	return bitbucketDoURL(method, "https://api.bitbucket.org"+apiPath, body)
}

func bitbucketDoURL(method, rawURL string, body any) ([]byte, error) {
	if vulnBitbucketToken() == "" {
		return nil, fmt.Errorf("Hosted collector needs BITBUCKET_TOKEN on the API. Private outbound agents and CI inventory uploads are the alternatives.")
	}
	if !scmURLAllowed(rawURL) {
		return nil, fmt.Errorf("The repository tree could not be read.")
	}
	return scmDo(method, rawURL, "Authorization", "Bearer "+vulnBitbucketToken(), body)
}

func scmURLAllowed(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return false
	}
	host := strings.ToLower(parsed.Host)
	if host == "api.bitbucket.org" || host == "gitlab.com" || host == "www.gitlab.com" {
		return true
	}
	if base, err := url.Parse(vulnGitLabBase()); err == nil && strings.EqualFold(base.Host, parsed.Host) {
		return true
	}
	return false
}

func scmDo(method, rawURL, header, value string, body any) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = strings.NewReader(string(raw))
	}
	req, err := http.NewRequest(method, rawURL, reader)
	if err != nil {
		return nil, err
	}
	if parsed, parseErr := url.Parse(rawURL); parseErr == nil {
		prefix := parsed.Scheme + "://" + parsed.Host
		req.URL.Scheme = parsed.Scheme
		req.URL.Host = parsed.Host
		req.URL.Opaque = "//" + parsed.Host + strings.TrimPrefix(rawURL, prefix)
	}
	req.Header.Set(header, value)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := vulnSCMClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, vulnMaxSCMBody))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("source-control request failed")
	}
	return raw, nil
}
