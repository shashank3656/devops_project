package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/go-github/v61/github"
)

// Day-2 operations on delivered infrastructure, all through the normal approval flow:
//   - resize:       a draft that edits the same request.json, so Terraform updates in place
//   - decommission: a request whose PR deletes the source's request files, so Terraform destroys them
// Temporary environments: non-prod requests can carry an expiry. Owners are reminded
// three days ahead; at expiry a decommission request is queued for approval.

const (
	day2Resize            = "resize"
	day2Decommission      = "decommission"
	lifetimeMaxDays       = 90
	lifetimeReminderAhead = 72 * time.Hour
)

var lifecycleSchedulerActive int32

type requestOperation struct {
	Operation       string    `json:"operation"`
	SourceRequestID int       `json:"source_request_id"`
	Reason          string    `json:"reason,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type requestLifetime struct {
	ExpiresAt             *time.Time        `json:"expires_at,omitempty"`
	DaysLeft              int               `json:"days_left"`
	ExtendedCount         int               `json:"extended_count"`
	CanSetLifetime        bool              `json:"can_set_lifetime"`
	DecommissionRequestID *int              `json:"decommission_request_id,omitempty"`
	Operation             *requestOperation `json:"operation,omitempty"`
}

func loadRequestOperation(requestID int) *requestOperation {
	if DB == nil || requestID <= 0 {
		return nil
	}
	var op requestOperation
	err := queryRowContext(`
		SELECT operation, source_request_id, reason, created_at FROM pr_request_operations WHERE request_id = $1
	`, requestID).Scan(&op.Operation, &op.SourceRequestID, &op.Reason, &op.CreatedAt)
	if err != nil {
		return nil
	}
	return &op
}

func openDecommissionFor(sourceRequestID int) int {
	if DB == nil {
		return 0
	}
	var id int
	_ = queryRowContext(`
		SELECT o.request_id FROM pr_request_operations o JOIN pr_requests r ON r.id = o.request_id
		 WHERE o.source_request_id = $1 AND o.operation = $2 AND r.status NOT IN ('rejected', 'cancelled')
		 ORDER BY o.request_id DESC LIMIT 1
	`, sourceRequestID, day2Decommission).Scan(&id)
	return id
}

func buildRequestLifetime(req *PRRequest, now time.Time) requestLifetime {
	lifetime := requestLifetime{}
	if req == nil {
		return lifetime
	}
	lifetime.CanSetLifetime = !envEqualsProd(req.Env) && req.Status != "rejected"
	lifetime.Operation = loadRequestOperation(req.ID)
	if DB == nil {
		return lifetime
	}
	var expiresAt time.Time
	var extended int
	err := queryRowContext(`
		SELECT expires_at, extended_count FROM pr_request_lifetimes WHERE request_id = $1
	`, req.ID).Scan(&expiresAt, &extended)
	if err == nil {
		lifetime.ExpiresAt = &expiresAt
		lifetime.ExtendedCount = extended
		lifetime.DaysLeft = int(expiresAt.Sub(now).Hours() / 24)
	}
	if id := openDecommissionFor(req.ID); id > 0 {
		lifetime.DecommissionRequestID = &id
	}
	return lifetime
}

func canManageRequest(req *PRRequest, userID int) bool {
	if req.CreatedBy != nil && *req.CreatedBy == userID {
		return true
	}
	if userID <= 0 {
		return false
	}
	user, err := GetUserByID(userID)
	return err == nil && user != nil && user.Role == "admin"
}

// handleRequestLifetime PUT /api/request/:id/lifetime {"days": 7} sets or extends the expiry; {"days": 0} clears it.
func handleRequestLifetime(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	if !canManageRequest(req, userID) {
		writeAPIError(w, r, http.StatusForbidden, "only the creator or an admin can change this request's lifetime", nil)
		return
	}
	if envEqualsProd(req.Env) {
		writeAPIError(w, r, http.StatusBadRequest, "production requests cannot be temporary", nil)
		return
	}
	var body struct {
		Days int `json:"days"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Days < 0 || body.Days > lifetimeMaxDays {
		writeAPIError(w, r, http.StatusBadRequest, fmt.Sprintf("days must be between 0 and %d", lifetimeMaxDays), nil)
		return
	}
	if existing := openDecommissionFor(id); existing > 0 {
		writeAPIError(w, r, http.StatusConflict, fmt.Sprintf("request #%d is already decommissioning this", existing), nil)
		return
	}
	var actor *int
	if userID > 0 {
		actor = &userID
	}
	if body.Days == 0 {
		if _, err := execContext(`DELETE FROM pr_request_lifetimes WHERE request_id = $1`, id); err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		AppendAuditLog(actor, "request_lifetime_clear", "pr_request", strconv.Itoa(id), "")
	} else {
		expiresAt := time.Now().Add(time.Duration(body.Days) * 24 * time.Hour)
		_, err := execContext(`
			INSERT INTO pr_request_lifetimes (request_id, expires_at, set_by, updated_at)
			VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
			ON CONFLICT (request_id) DO UPDATE SET
				expires_at = EXCLUDED.expires_at, set_by = EXCLUDED.set_by,
				extended_count = pr_request_lifetimes.extended_count + 1,
				decommission_request_id = NULL, sweep_claimed_at = NULL, updated_at = CURRENT_TIMESTAMP
		`, id, expiresAt, actor)
		if err != nil {
			writeAPIError(w, r, http.StatusInternalServerError, "request failed", err)
			return
		}
		AppendAuditLog(actor, "request_lifetime_set", "pr_request", strconv.Itoa(id), fmt.Sprintf("days=%d expires=%s", body.Days, expiresAt.Format(time.RFC3339)))
	}
	w.Header().Set("Content-Type", "application/json")
	encodeJSON(w, map[string]interface{}{"status": "ok", "lifetime": buildRequestLifetime(req, time.Now())})
}

// createDay2Request creates the follow-up request for resize or decommission.
// Decommission requests are submitted for approval straight away since there is nothing to edit.
func createDay2Request(source *PRRequest, operation, reason string, actorID *int) (*PRRequest, error) {
	if source.Status != "completed" && source.Status != "in_progress" {
		return nil, fmt.Errorf("only delivered requests can be resized or decommissioned")
	}
	if operation == day2Decommission {
		if existing := openDecommissionFor(source.ID); existing > 0 {
			return nil, fmt.Errorf("request #%d already decommissions this", existing)
		}
	}
	appID, err := GenerateApplicationID()
	if err != nil {
		return nil, err
	}
	primaryCloud, primaryService := primaryRequestService(source)
	_, branchName := BuildRequestGitArtifacts(source.ProjectID, source.Team, primaryCloud, source.Env, primaryService, appID)
	createdBy := source.CreatedBy
	if createdBy == nil {
		createdBy = actorID
	}
	label := "change"
	if operation == day2Decommission {
		label = "decommission"
	}
	draft := &PRRequest{
		ProjectID:     source.ProjectID,
		Team:          source.Team,
		Env:           source.Env,
		Cloud:         primaryCloud,
		Service:       primaryService,
		ClientName:    strings.TrimSpace(fmt.Sprintf("%s (%s of #%d)", source.ClientName, label, source.ID)),
		ApplicationID: appID,
		Priority:      source.Priority,
		Branch:        branchName,
		FilePath:      source.FilePath,
		Status:        "draft",
		Config:        ensureRequestConfigApplicationID(source.Config, appID),
		CreatedBy:     createdBy,
	}
	applyRequestBundleEntries(draft, source.ServiceBundle)
	if err := SavePRRequest(draft); err != nil {
		return nil, err
	}
	_, _ = execContext(`UPDATE pr_requests SET linked_request_id = $1 WHERE id = $2`, source.ID, draft.ID)
	if _, err := execContext(`
		INSERT INTO pr_request_operations (request_id, operation, source_request_id, reason, created_by)
		VALUES ($1, $2, $3, $4, $5)
	`, draft.ID, operation, source.ID, strings.TrimSpace(reason), actorID); err != nil {
		return nil, err
	}
	if operation == day2Decommission {
		requester := 0
		if createdBy != nil {
			requester = *createdBy
		}
		status := determineApprovalStatusForRequest(draft.ProjectID, requester, draft.Team, draft.Env)
		if err := UpdatePRRequestStatus(draft.ID, status); err != nil {
			return nil, err
		}
		draft.Status = status
		_, _ = execContext(`UPDATE pr_request_lifetimes SET decommission_request_id = $1 WHERE request_id = $2`, draft.ID, source.ID)
	}
	AppendAuditLog(actorID, "request_day2_"+operation, "pr_request", strconv.Itoa(draft.ID), fmt.Sprintf("source=%d reason=%s", source.ID, strings.TrimSpace(reason)))
	AppendUserActivity(createdBy, "request_day2_"+operation, "pr_request", strconv.Itoa(draft.ID), fmt.Sprintf("%s of #%d", operation, source.ID))
	return draft, nil
}

// handleRequestDay2 POST /api/request/:id/day2 {"action": "resize"|"decommission", "reason": "..."}
func handleRequestDay2(w http.ResponseWriter, r *http.Request, id int, req *PRRequest, userID int) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	if !canManageRequest(req, userID) {
		writeAPIError(w, r, http.StatusForbidden, "only the creator or an admin can change this infrastructure", nil)
		return
	}
	var body struct {
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}
	action := strings.ToLower(strings.TrimSpace(body.Action))
	if action != day2Resize && action != day2Decommission {
		writeAPIError(w, r, http.StatusBadRequest, "action must be resize or decommission", nil)
		return
	}
	if action == day2Decommission && strings.TrimSpace(body.Reason) == "" {
		writeAPIError(w, r, http.StatusBadRequest, "say why this is being decommissioned", nil)
		return
	}
	var actor *int
	if userID > 0 {
		actor = &userID
	}
	draft, err := createDay2Request(req, action, body.Reason, actor)
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
		return
	}
	message := "Draft created. Change the size in History, then send it for review."
	if action == day2Decommission {
		message = "Decommission request sent for approval. Nothing is deleted until it is approved and merged."
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	encodeJSON(w, map[string]interface{}{"status": "ok", "id": draft.ID, "request_status": draft.Status, "message": message})
}

// requestFilePaths lists every request.json a request wrote, including service-bundle files.
func requestFilePaths(req *PRRequest) []string {
	content := []byte(ensureRequestConfigApplicationID(req.Config, req.ApplicationID))
	files, err := buildBundledRequestFiles(req.FilePath, content)
	if err != nil || len(files) == 0 {
		return []string{req.FilePath}
	}
	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}

// CreateGitHubPRDeletingFiles opens a PR that removes the given files from a fresh branch.
func CreateGitHubPRDeletingFiles(branchName string, paths []string, title, body string) (string, error) {
	client, err := newGitHubClient()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	baseRef, _, err := client.Git.GetRef(ctx, GitHubOwner, GitHubRepo, "refs/heads/"+BaseBranch)
	if err != nil {
		return "", fmt.Errorf("failed to get base branch: %w", err)
	}
	branchRef := "refs/heads/" + branchName
	if _, _, err := client.Git.GetRef(ctx, GitHubOwner, GitHubRepo, branchRef); err != nil {
		if _, _, err := client.Git.CreateRef(ctx, GitHubOwner, GitHubRepo, &github.Reference{
			Ref: github.String(branchRef), Object: &github.GitObject{SHA: baseRef.Object.SHA},
		}); err != nil {
			return "", fmt.Errorf("failed to create branch: %w", err)
		}
	}

	deleted := 0
	for _, path := range paths {
		file, _, _, err := client.Repositories.GetContents(ctx, GitHubOwner, GitHubRepo, path, &github.RepositoryContentGetOptions{Ref: branchName})
		if err != nil || file == nil {
			continue
		}
		if _, _, err := client.Repositories.DeleteFile(ctx, GitHubOwner, GitHubRepo, path, &github.RepositoryContentFileOptions{
			Message: github.String("Decommission infra config: " + path),
			SHA:     file.SHA,
			Branch:  github.String(branchName),
		}); err != nil {
			return "", fmt.Errorf("failed to delete %s: %w", path, err)
		}
		AppendGitHubLog("file_delete", "Deleted "+path+" for decommission", path)
		deleted++
	}
	if deleted == 0 {
		return "", fmt.Errorf("none of the request files exist on %s; nothing to decommission", BaseBranch)
	}

	prs, _, err := client.PullRequests.List(ctx, GitHubOwner, GitHubRepo, &github.PullRequestListOptions{
		State: "open", Head: fmt.Sprintf("%s:%s", GitHubOwner, branchName), Base: BaseBranch,
	})
	if err == nil && len(prs) > 0 {
		return prs[0].GetHTMLURL(), nil
	}
	created, _, err := client.PullRequests.Create(ctx, GitHubOwner, GitHubRepo, &github.NewPullRequest{
		Title: github.String(title), Head: github.String(branchName), Base: github.String(BaseBranch), Body: github.String(body),
	})
	if err != nil {
		return "", fmt.Errorf("failed to create PR: %w", err)
	}
	AppendGitHubLog("pr_created", fmt.Sprintf("Created decommission PR #%d", created.GetNumber()), created.GetHTMLURL())
	return created.GetHTMLURL(), nil
}

// createPullRequestForRequest is what approval calls to open the request's PR.
func createPullRequestForRequest(req *PRRequest) (string, error) {
	op := loadRequestOperation(req.ID)
	if op == nil || op.Operation != day2Decommission {
		return CreateGitHubPR(req.Branch, req.FilePath, []byte(req.Config), req.ApplicationID)
	}
	source, err := GetPRRequestByID(op.SourceRequestID)
	if err != nil || source == nil {
		return "", fmt.Errorf("source request #%d for this decommission was not found", op.SourceRequestID)
	}
	paths := requestFilePaths(source)
	title := fmt.Sprintf("Decommission: %s [%s]", req.Branch, req.ApplicationID)
	body := fmt.Sprintf("Removes the infrastructure delivered by request #%d.\n\n**Reason:** %s\n\n**Files removed:**\n- %s\n\nTerraform will destroy these resources when this merges.",
		source.ID, firstNonBlankString(op.Reason, "not given"), strings.Join(paths, "\n- "))
	return CreateGitHubPRDeletingFiles(req.Branch, paths, title, body)
}

func firstNonBlankString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// runLifetimeSweep sends expiry reminders and queues teardown for expired temporary requests.
func runLifetimeSweep(now time.Time) {
	if DB == nil {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT l.request_id, l.expires_at
		  FROM pr_request_lifetimes l JOIN pr_requests r ON r.id = l.request_id
		 WHERE l.decommission_request_id IS NULL AND r.status IN ('completed', 'in_progress') AND l.expires_at <= $1
		 ORDER BY l.expires_at LIMIT 100
	`, now.Add(lifetimeReminderAhead))
	if err != nil {
		log.Printf("[lifetime] sweep query failed: %v", err)
		return
	}
	type due struct {
		id        int
		expiresAt time.Time
	}
	items := make([]due, 0)
	for rows.Next() {
		var item due
		if rows.Scan(&item.id, &item.expiresAt) == nil {
			items = append(items, item)
		}
	}
	rows.Close()
	cancel()

	for _, item := range items {
		req, err := GetPRRequestByID(item.id)
		if err != nil || req == nil {
			continue
		}
		recipients := []int{}
		if req.CreatedBy != nil {
			recipients = append(recipients, *req.CreatedBy)
		}
		if item.expiresAt.After(now) {
			message := fmt.Sprintf("Request #%d (%s in %s) expires %s. Extend it from History to keep it; otherwise a teardown request is queued for approval.",
				req.ID, req.Service, req.Env, item.expiresAt.Format("Mon 2 Jan 15:04 MST"))
			_ = dispatchOpsNotification(buildOpsNotificationEventKey("ttl-reminder", strconv.Itoa(req.ID), strconv.FormatInt(item.expiresAt.Unix(), 10)),
				"ttl_reminder", "Temporary environment expires soon", message, &req.ID, req.ProjectID, recipients, map[string]any{"expires_at": item.expiresAt})
			continue
		}
		claim, err := execContext(`
			UPDATE pr_request_lifetimes SET sweep_claimed_at = CURRENT_TIMESTAMP
			 WHERE request_id = $1 AND decommission_request_id IS NULL
			   AND (sweep_claimed_at IS NULL OR sweep_claimed_at < CURRENT_TIMESTAMP - INTERVAL '1 hour')
		`, req.ID)
		if err != nil {
			continue
		}
		if claimed, _ := claim.RowsAffected(); claimed != 1 {
			continue
		}
		decommission, err := createDay2Request(req, day2Decommission, "Temporary environment reached its expiry", req.CreatedBy)
		if err != nil {
			log.Printf("[lifetime] request %d: could not queue teardown: %v", req.ID, err)
			continue
		}
		withDevops, err := buildOpsNotificationRecipients(recipients)
		if err != nil {
			withDevops = recipients
		}
		message := fmt.Sprintf("Request #%d (%s in %s) expired. Teardown request #%d is waiting for approval.", req.ID, req.Service, req.Env, decommission.ID)
		_ = dispatchOpsNotification(buildOpsNotificationEventKey("ttl-expired", strconv.Itoa(req.ID), strconv.FormatInt(item.expiresAt.Unix(), 10)),
			"ttl_expired", "Temporary environment expired", message, &decommission.ID, req.ProjectID, withDevops, map[string]any{"source_request_id": req.ID})
	}
}

func startLifecycleScheduler() {
	if !atomic.CompareAndSwapInt32(&lifecycleSchedulerActive, 0, 1) {
		return
	}
	go func() {
		time.Sleep(2 * time.Minute)
		runLifetimeSweep(time.Now())
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			runLifetimeSweep(time.Now())
		}
	}()
}
