package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
)

const vulnPRCheckContext = "opstrellis/vulnerability-comparison"

func vulnPRCheckState(coverage string, introC, introH int) (state, desc string) {
	if coverage != "complete" {
		return "pending", "Incomplete coverage is never a clean verdict. Informational only; this does not merge."
	}
	if introC+introH > 0 {
		return "failure", "Introduced Critical or High findings. Informational only; this does not merge."
	}
	return "success", "No introduced Critical/High in complete coverage. Informational only; this does not merge."
}

func deploymentPatchOutcome(current string, hasSBOM, stillPresent bool) string {
	if !hasSBOM {
		if current == vulnPatchRepoOK || current == vulnPatchDeployPen {
			return vulnPatchDeployPen
		}
		return current
	}
	if stillPresent {
		return vulnPatchDeployPen
	}
	if current == vulnPatchRepoOK || current == vulnPatchDeployPen {
		return vulnPatchDeployOK
	}
	return current
}

func publishVulnPRCheck(repoID, prNumber int, coverage string, introC, introH int, headSHA string) {
	if repoID <= 0 || strings.TrimSpace(headSHA) == "" {
		return
	}
	var owner, name string
	if queryRowContext(`SELECT owner, name FROM vuln_repositories WHERE id=$1`, repoID).Scan(&owner, &name) != nil {
		return
	}
	client, err := vulnGitHubClient()
	if err != nil {
		return
	}
	state, desc := vulnPRCheckState(coverage, introC, introH)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	target := strings.TrimRight(DevOpsFrontendURL, "/") + "/security/vulnerabilities?tab=comparisons"
	_, _, _ = client.Repositories.CreateStatus(ctx, owner, name, headSHA, &github.RepoStatus{
		State:       github.String(state),
		Context:     github.String(vulnPRCheckContext),
		Description: github.String(truncateStatusDescription(desc)),
		TargetURL:   github.String(target),
	})
	_ = prNumber
}

func openVulnPatchPR(userID, planID int) (string, error) {
	if planID <= 0 {
		return "", fmt.Errorf("patch plan not found")
	}
	var repoID int
	var module, eco, pkg, current, target, action, status, rawIDs string
	if err := queryRowContext(`
		SELECT repo_id, module_path, ecosystem, package_name, current_version, target_version, action, status, finding_ids
		FROM vuln_patch_plans WHERE id=$1
	`, planID).Scan(&repoID, &module, &eco, &pkg, &current, &target, &action, &status, &rawIDs); err != nil {
		return "", fmt.Errorf("patch plan not found")
	}
	if strings.TrimSpace(target) == "" {
		return "", fmt.Errorf("No known fix is listed. A patch PR was not opened.")
	}
	var owner, name, branch string
	if err := queryRowContext(`SELECT owner, name, branch FROM vuln_repositories WHERE id=$1`, repoID).Scan(&owner, &name, &branch); err != nil {
		return "", fmt.Errorf("repository is not registered")
	}
	client, err := vulnGitHubClient()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	baseRef, _, err := client.Git.GetRef(ctx, owner, name, "refs/heads/"+branch)
	if err != nil || baseRef == nil || baseRef.Object == nil {
		return "", fmt.Errorf("The default branch could not be resolved.")
	}
	branchName := fmt.Sprintf("opstrellis/vuln-patch-%d", planID)
	_, _, err = client.Git.CreateRef(ctx, owner, name, &github.Reference{
		Ref:    github.String("refs/heads/" + branchName),
		Object: &github.GitObject{SHA: baseRef.Object.SHA},
	})
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "already exists") {
		return "", fmt.Errorf("A patch branch could not be created.")
	}
	body := vulnPatchProposalMarkdown(planID, owner+"/"+name, module, eco, pkg, current, target, action, rawIDs)
	path := fmt.Sprintf("security/opstrellis-patch-%d.md", planID)
	opts := &github.RepositoryContentFileOptions{
		Message: github.String("docs: proposed security patch for " + pkg),
		Content: []byte(body),
		Branch:  github.String(branchName),
	}
	existing, _, _, getErr := client.Repositories.GetContents(ctx, owner, name, path, &github.RepositoryContentGetOptions{Ref: branchName})
	if getErr == nil && existing != nil {
		opts.SHA = existing.SHA
	}
	if _, _, err = client.Repositories.CreateFile(ctx, owner, name, path, opts); err != nil {
		return "", fmt.Errorf("The patch proposal could not be written.")
	}
	title := fmt.Sprintf("Security patch proposal: %s %s → %s", pkg, current, target)
	prBody := body + "\n\nThis pull request is a proposal. OpsTrellis does not merge it, does not run package scripts, and does not apply `--force` upgrades."
	created, _, err := client.PullRequests.Create(ctx, owner, name, &github.NewPullRequest{
		Title: github.String(title),
		Head:  github.String(branchName),
		Base:  github.String(branch),
		Body:  github.String(prBody),
		Draft: github.Bool(true),
	})
	if err != nil {
		prs, _, listErr := client.PullRequests.List(ctx, owner, name, &github.PullRequestListOptions{State: "open", Head: owner + ":" + branchName, Base: branch})
		if listErr == nil && len(prs) > 0 {
			created = prs[0]
		} else {
			return "", fmt.Errorf("The patch pull request could not be opened.")
		}
	}
	url := created.GetHTMLURL()
	var ids []int
	_ = json.Unmarshal([]byte(firstNonEmpty(rawIDs, "[]")), &ids)
	for _, id := range ids {
		_, _ = execContext(`UPDATE vuln_findings SET pr_url=$2, patch_state=$3, lifecycle=CASE WHEN lifecycle='open' THEN 'in_remediation' ELSE lifecycle END WHERE id=$1`, id, url, vulnPatchPRLinked)
		_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail, actor_id) VALUES ($1,'pr_opened',$2,$3)`, id, "Draft patch proposal opened. Tests are required. This is not merged and not Fixed.", userID)
	}
	_, _ = execContext(`UPDATE vuln_patch_plans SET status='pr_linked', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, planID)
	return url, nil
}

func vulnPatchProposalMarkdown(planID int, repo, module, eco, pkg, current, target, action, rawIDs string) string {
	return strings.TrimSpace(fmt.Sprintf(`# OpsTrellis patch proposal %d

Repository: %s
Module: %s
Ecosystem: %s
Package: %s
Current version: %s
Proposed target: %s
Action: %s
Linked findings: %s

## Required next steps
1. Update the resolved lockfile or SBOM in your authorized CI.
2. Run the project's tests. Compatibility is not claimed from the version number.
3. Request an OpsTrellis rescan after merge. Merged is not Fixed.

## Explicitly not done
- No automatic merge
- No npm audit fix --force or equivalent
- No package lifecycle scripts
- No production rollout
`, planID, repo, firstNonEmpty(module, "/"), eco, pkg, current, target, action, firstNonEmpty(rawIDs, "[]")))
}

func recordVulnDeployment(userID, serviceID int, environment, digest, commit string, sbom []vulnComponent) (int, error) {
	environment = strings.TrimSpace(environment)
	digest = strings.TrimSpace(digest)
	if serviceID <= 0 || environment == "" || digest == "" {
		return 0, fmt.Errorf("service, environment, and digest are required")
	}
	row := serviceVulnDetail(userID, serviceID)
	if row == nil {
		return 0, fmt.Errorf("service not found")
	}
	var service *vulnServiceRow
	switch v := row["service"].(type) {
	case *vulnServiceRow:
		service = v
	case vulnServiceRow:
		copied := v
		service = &copied
	}
	if service == nil {
		return 0, fmt.Errorf("service not found")
	}
	hasSBOM := len(sbom) > 0
	var id int
	err := queryRowContext(`
		INSERT INTO vuln_deployments (service_id, repo_id, environment, digest, commit_sha, has_sbom, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
	`, serviceID, nullIfZero(service.RepoID), environment, digest, strings.TrimSpace(commit), hasSBOM, userID).Scan(&id)
	if err != nil {
		return 0, err
	}
	if service.RepoID > 0 {
		_, _ = execContext(`
			INSERT INTO vuln_runtime_observations (repo_id, kind, value, provenance, path, commit_sha)
			VALUES ($1,'image_digest',$2,'deployed',$3,$4)
		`, service.RepoID, digest, environment, strings.TrimSpace(commit))
	}
	present := map[string]bool{}
	for _, item := range sbom {
		present[normalizeEcosystem(item.Ecosystem)+"|"+normalizePackageName(item.Ecosystem, item.PackageName)+"|"+strings.TrimSpace(item.Version)] = true
	}
	findings, _ := listVulnFindings(userID, 0, serviceID, "", "")
	for _, item := range findings {
		if item.Lifecycle == vulnLifeFixed || item.Lifecycle == vulnLifeFalsePos || item.Lifecycle == vulnLifeWithdrawn {
			continue
		}
		still := present[normalizeEcosystem(item.Ecosystem)+"|"+normalizePackageName(item.Ecosystem, item.PackageName)+"|"+strings.TrimSpace(item.Installed)]
		next := deploymentPatchOutcome(item.PatchState, hasSBOM, still)
		if next == item.PatchState {
			continue
		}
		_, _ = execContext(`UPDATE vuln_findings SET patch_state=$2 WHERE id=$1`, item.ID, next)
		detail := "Deployment digest recorded for " + environment + ". Production exposure stays Unknown without matching SBOM evidence."
		if hasSBOM && !still && next == vulnPatchDeployOK {
			detail = "Digest-linked SBOM no longer contains this package version. Deployment verified; this is not an automatic production patch."
		}
		if hasSBOM && still {
			detail = "Digest-linked SBOM still contains this package version. Deployment verification is pending."
		}
		_, _ = execContext(`INSERT INTO vuln_finding_events (finding_id, kind, detail, actor_id) VALUES ($1,'deployment',$2,$3)`, item.ID, detail, userID)
	}
	return id, nil
}

func listVulnDeployments(serviceID int) []map[string]any {
	if DB == nil || serviceID <= 0 {
		return []map[string]any{}
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT id, environment, digest, commit_sha, has_sbom, created_at
		FROM vuln_deployments WHERE service_id=$1 ORDER BY id DESC LIMIT 20
	`, serviceID)
	if err != nil {
		return []map[string]any{}
	}
	defer cancel()
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int
		var env, digest, sha string
		var has bool
		var created time.Time
		if rows.Scan(&id, &env, &digest, &sha, &has, &created) != nil {
			continue
		}
		out = append(out, map[string]any{
			"id": id, "environment": env, "digest": digest, "commit_sha": sha, "has_sbom": has,
			"created_at": created.UTC().Format(time.RFC3339),
			"note":       "A digest without a matching SBOM cannot prove production is patched.",
		})
	}
	return out
}
