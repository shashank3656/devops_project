package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var iamAccessNumberPattern = regexp.MustCompile(`^AR-\d{4}-\d{3,8}$`)
var iamPathIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
var iamAWSPolicyName = regexp.MustCompile(`^[A-Za-z0-9+=,.@_-]{1,64}$`)

type iamAccessDispatch struct {
	File   string
	URL    string
	Inputs map[string]string
}

func iamAccessRepo() (owner, repo, workflow string) {
	owner = strings.TrimSpace(os.Getenv("IAM_ACCESS_GITHUB_OWNER"))
	if owner == "" {
		owner = "shashank3656"
	}
	repo = strings.TrimSpace(os.Getenv("IAM_ACCESS_GITHUB_REPO"))
	if repo == "" {
		repo = "project_infra"
	}
	workflow = strings.TrimSpace(os.Getenv("IAM_ACCESS_WORKFLOW"))
	if workflow == "" {
		workflow = "iam-access.yaml"
	}
	return owner, repo, workflow
}

func iamAccessCallbackSecret() string {
	if secret := strings.TrimSpace(os.Getenv("IAM_ACCESS_CALLBACK_SECRET")); secret != "" {
		return secret
	}
	return strings.TrimSpace(CIWebhookSecret)
}

func buildIAMAccessDispatches(item *iamRequest) ([]iamAccessDispatch, error) {
	if item == nil {
		return nil, fmt.Errorf("access request is missing")
	}
	in := item.Evaluation.Input
	cloud := strings.ToLower(strings.TrimSpace(in.Provider))
	if cloud != "aws" && cloud != "gcp" && cloud != "azure" {
		return nil, fmt.Errorf("cloud must be aws, gcp, or azure")
	}
	project := iamProjectSlug(in.ProjectID)
	env := iamPathID(strings.ToLower(strings.TrimSpace(in.Environment)))
	principal := iamPathID(in.PrincipalID)
	account := iamPathID(in.CloudAccountID)
	if env == "" || principal == "" || account == "" {
		return nil, fmt.Errorf("project, environment, person, and cloud account are required")
	}
	member, err := iamCloudMember(cloud, in.CloudMember, item.RequesterID)
	if err != nil {
		return nil, err
	}
	starts, err := iamAccessTime(in.StartsAt)
	if err != nil {
		return nil, fmt.Errorf("start time must be a date and time")
	}
	ends, err := iamAccessTime(in.EndsAt)
	if err != nil {
		return nil, fmt.Errorf("end time must be a date and time")
	}
	roles := iamAccessRoles(in)
	if len(roles) == 0 {
		return nil, fmt.Errorf("a cloud role is required")
	}
	owner, repo, workflow := iamAccessRepo()
	file := fmt.Sprintf("iam/%s/%s/%s/%s.json", project, env, cloud, principal)
	url := fmt.Sprintf("https://github.com/%s/%s/actions/workflows/%s", owner, repo, workflow)
	base := iamWorkflowAccessNumber(item.AccessNumber)
	out := make([]iamAccessDispatch, 0, len(roles))
	for index, role := range roles {
		mapped, mapErr := iamWorkflowRole(cloud, role)
		if mapErr != nil {
			return nil, mapErr
		}
		number := base
		if index > 0 {
			number = fmt.Sprintf("%s%02d", base, index)
			if !iamAccessNumberPattern.MatchString(number) {
				return nil, fmt.Errorf("access number cannot cover more than one role")
			}
		}
		out = append(out, iamAccessDispatch{
			File: file,
			URL:  url,
			Inputs: map[string]string{
				"project":       project,
				"env":           env,
				"cloud":         cloud,
				"principal_id":  principal,
				"account_id":    account,
				"member":        member,
				"role":          mapped,
				"access_number": number,
				"starts_at":     starts,
				"ends_at":       ends,
			},
		})
	}
	return out, nil
}

func iamAccessRoles(in iamEvaluateInput) []string {
	roles := []string{}
	for _, role := range in.Permissions {
		role = strings.TrimSpace(role)
		if role != "" {
			roles = append(roles, role)
		}
	}
	if len(roles) == 0 && strings.TrimSpace(in.Action) != "" {
		roles = append(roles, strings.TrimSpace(in.Action))
	}
	return roles
}

func iamWorkflowRole(cloud, role string) (string, error) {
	role = strings.TrimSpace(role)
	lower := strings.ToLower(role)
	if role == "" || strings.Contains(role, "*") || strings.Contains(lower, "administratoraccess") {
		return "", fmt.Errorf("this role cannot be written to the access file")
	}
	switch cloud {
	case "gcp":
		denied := map[string]bool{
			"roles/owner": true, "roles/editor": true, "roles/iam.admin": true,
			"roles/iam.securityadmin": true, "roles/resourcemanager.projectiamadmin": true,
		}
		if !strings.HasPrefix(role, "roles/") || denied[lower] {
			return "", fmt.Errorf("this role cannot be written to the access file")
		}
		return role, nil
	case "aws":
		if strings.HasPrefix(role, "arn:aws:iam::") {
			return role, nil
		}
		if !iamAWSPolicyName.MatchString(role) || strings.EqualFold(role, "PowerUserAccess") || strings.EqualFold(role, "IAMFullAccess") {
			return "", fmt.Errorf("this role cannot be written to the access file")
		}
		return "arn:aws:iam::aws:policy/" + role, nil
	case "azure":
		if strings.EqualFold(role, "Owner") || strings.EqualFold(role, "User Access Administrator") {
			return "", fmt.Errorf("this role cannot be written to the access file")
		}
		return role, nil
	default:
		return "", fmt.Errorf("cloud must be aws, gcp, or azure")
	}
}

func iamCloudMember(cloud, explicit string, requesterID int) (string, error) {
	explicit = strings.TrimSpace(explicit)
	switch cloud {
	case "gcp":
		if explicit != "" {
			return explicit, nil
		}
		if DB == nil || requesterID <= 0 {
			return "", fmt.Errorf("cloud member is required")
		}
		user, err := GetUserByID(requesterID)
		if err != nil || user == nil || strings.TrimSpace(user.Email) == "" {
			return "", fmt.Errorf("cloud member is required")
		}
		return "user:" + strings.TrimSpace(user.Email), nil
	case "aws", "azure":
		if explicit == "" {
			return "", fmt.Errorf("cloud member is required")
		}
		return explicit, nil
	default:
		return "", fmt.Errorf("cloud must be aws, gcp, or azure")
	}
}

func iamProjectSlug(projectID string) string {
	projectID = strings.TrimSpace(projectID)
	if id, err := strconv.Atoi(projectID); err == nil && id > 0 && DB != nil {
		if project, lookupErr := getProjectCatalogByID(id); lookupErr == nil && project != nil {
			if slug := iamPathID(project.Code); slug != "" {
				return slug
			}
		}
	}
	if slug := iamPathID(projectID); slug != "" {
		return slug
	}
	return "project"
}

func iamPathID(value string) string {
	value = strings.TrimSpace(value)
	if iamPathIDPattern.MatchString(value) {
		return value
	}
	return ""
}

func iamWorkflowAccessNumber(number string) string {
	number = strings.TrimSpace(number)
	if iamAccessNumberPattern.MatchString(number) {
		return number
	}
	now := time.Now().UTC()
	return fmt.Sprintf("AR-%d-%03d", now.Year(), now.YearDay())
}

func iamAccessTime(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("missing time")
	}
	layouts := []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02T15:04"}
	var parsed time.Time
	var err error
	for _, layout := range layouts {
		parsed, err = time.Parse(layout, value)
		if err == nil {
			return parsed.UTC().Format(time.RFC3339), nil
		}
	}
	return "", err
}

func dispatchIAMAccessWorkflows(dispatches []iamAccessDispatch) error {
	if len(dispatches) == 0 {
		return fmt.Errorf("access file workflow is missing")
	}
	if strings.TrimSpace(GitHubToken) == "" {
		return fmt.Errorf("GITHUB_TOKEN is required")
	}
	owner, repo, workflow := iamAccessRepo()
	endpoint := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches", owner, repo, workflow)
	for _, item := range dispatches {
		body, err := json.Marshal(map[string]any{"ref": "main", "inputs": item.Inputs})
		if err != nil {
			return err
		}
		req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+GitHubToken)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNoContent {
			return fmt.Errorf("access file workflow returned %d", resp.StatusCode)
		}
	}
	return nil
}

func completeIAMProvision(accessNumber string) error {
	accessNumber = strings.TrimSpace(accessNumber)
	cloudAccess.mu.Lock()
	defer cloudAccess.mu.Unlock()
	var item *iamRequest
	for _, candidate := range cloudAccess.byID {
		if candidate.AccessNumber == accessNumber {
			item = candidate
			break
		}
	}
	if item == nil {
		return fmt.Errorf("request not found")
	}
	if item.Status == "ACTIVE" {
		return nil
	}
	if item.Status != "PROVISIONING" {
		return fmt.Errorf("request is not waiting for the access file")
	}
	item.Status = "ACTIVE"
	item.UpdatedAt = time.Now().UTC()
	grant := iamGrant{
		ID: newIAMID(), RequestID: item.ID, RequesterID: item.RequesterID,
		PrincipalID: item.Evaluation.Input.PrincipalID, RoleName: item.Evaluation.RoleName, RoleID: item.Evaluation.RoleID,
		Scope: item.Evaluation.NormalizedScope, Status: "active", AccessNumber: item.AccessNumber, GrantedAt: item.UpdatedAt,
	}
	cloudAccess.grants = append(cloudAccess.grants, grant)
	item.Timeline = append(item.Timeline, cloudAccess.addAudit(0, "provisioned", item.ID, item.Evaluation.RoleName))
	item.Timeline = append(item.Timeline, cloudAccess.addAudit(0, "access_request_closed", item.ID, item.AccessNumber))
	if DB != nil && item.RequesterID > 0 {
		ends := strings.TrimSpace(item.Evaluation.Input.EndsAt)
		message := fmt.Sprintf("Access %s is active on %s account %s until %s.", item.AccessNumber, strings.ToUpper(item.Evaluation.Input.Provider), item.Evaluation.Input.CloudAccountID, ends)
		sendNotificationEmailIfConfigured(item.RequesterID, "approved", "Cloud access is active", message)
	}
	return nil
}

func iamAccessWebhookHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		handleOptions(w, r)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w, r)
		return
	}
	expected := iamAccessCallbackSecret()
	provided := strings.TrimSpace(r.Header.Get("X-CI-Secret"))
	if provided == "" {
		provided = strings.TrimSpace(r.Header.Get("X-OpsTrellis-Secret"))
	}
	if expected == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		writeAPIError(w, r, http.StatusUnauthorized, "webhook secret was rejected", nil)
		return
	}
	var body struct {
		AccessNumber string `json:"accessNumber"`
		Status       string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid json", nil)
		return
	}
	if strings.EqualFold(strings.TrimSpace(body.Status), "failed") {
		cloudAccess.mu.Lock()
		for _, item := range cloudAccess.byID {
			if item.AccessNumber == strings.TrimSpace(body.AccessNumber) && item.Status == "PROVISIONING" {
				item.Status = "PROVISION_FAILED"
				item.UpdatedAt = time.Now().UTC()
			}
		}
		cloudAccess.mu.Unlock()
		writeIAM(w, http.StatusOK, map[string]string{"status": "failed"})
		return
	}
	if err := completeIAMProvision(body.AccessNumber); err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), nil)
		return
	}
	writeIAM(w, http.StatusOK, map[string]string{"status": "active"})
}
