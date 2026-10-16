package main

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

type cloudAccountInsert struct {
	Provider     string
	AccountID    string
	DisplayName  string
	TeamSlug     string
	ProjectID    int
	Environments []string
	AuthMode     string
	RoleARN      string
	ExternalID   string
	SecretRef    string
	OnboardedBy  int
}

type cloudAccountCredentials struct {
	AuthMode   string
	RoleARN    string
	ExternalID string
	SecretRef  string
}

func cloudAccountProjectExists(projectID int) bool {
	if DB == nil || projectID <= 0 {
		return false
	}
	var id int
	err := DB.QueryRow(`SELECT id FROM projects WHERE id = $1`, projectID).Scan(&id)
	return err == nil && id == projectID
}

func insertCloudAccount(in cloudAccountInsert) (*cloudAccountRecord, error) {
	var id int
	var projectID any
	if in.ProjectID > 0 {
		projectID = in.ProjectID
	}
	roleARN, err := sealCloudSecret(in.RoleARN)
	if err != nil {
		return nil, err
	}
	externalID, err := sealCloudSecret(in.ExternalID)
	if err != nil {
		return nil, err
	}
	secretRef, err := sealCloudSecret(in.SecretRef)
	if err != nil {
		return nil, err
	}
	err = DB.QueryRow(`
		INSERT INTO cloud_accounts (
			provider, account_id, display_name, team_slug, project_id, environments_json,
			auth_mode, role_arn, external_id, secret_ref, status, onboarded_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)
		RETURNING id
	`, in.Provider, in.AccountID, in.DisplayName, in.TeamSlug, projectID, encodeEnvironmentsJSON(in.Environments),
		in.AuthMode, roleARN, externalID, secretRef, in.OnboardedBy).Scan(&id)
	if err != nil {
		return nil, err
	}
	return getCloudAccountByID(id)
}

func scanCloudAccount(row *sql.Row) (*cloudAccountRecord, error) {
	var item cloudAccountRecord
	var envJSON, roleARN, externalID, secretRef, lastError string
	var lastTest, disabledAt sql.NullTime
	var onboardedBy, disabledBy, projectID sql.NullInt64
	var onboardedName, projectName, projectCode sql.NullString
	err := row.Scan(
		&item.ID, &item.Provider, &item.AccountID, &item.DisplayName, &item.TeamSlug, &envJSON,
		&item.AuthMode, &roleARN, &externalID, &secretRef, &item.Status, &lastError, &lastTest,
		&onboardedBy, &disabledBy, &disabledAt, &item.CreatedAt, &item.UpdatedAt, &onboardedName,
		&projectID, &projectName, &projectCode,
	)
	if err != nil {
		return nil, err
	}
	item.Environments = parseEnvironmentsJSON(envJSON)
	item.RoleARNSet = strings.TrimSpace(roleARN) != ""
	item.ExternalIDSet = strings.TrimSpace(externalID) != ""
	item.SecretRefSet = strings.TrimSpace(secretRef) != ""
	item.CredentialsEncrypted = cloudSecretIsSealed(roleARN) || cloudSecretIsSealed(externalID) || cloudSecretIsSealed(secretRef)
	item.LastError = strings.TrimSpace(lastError)
	if lastTest.Valid {
		t := lastTest.Time.UTC()
		item.LastTestAt = &t
	}
	if onboardedBy.Valid {
		v := int(onboardedBy.Int64)
		item.OnboardedBy = &v
	}
	if disabledAt.Valid {
		t := disabledAt.Time.UTC()
		item.DisabledAt = &t
	}
	if onboardedName.Valid {
		item.OnboardedByName = onboardedName.String
	}
	fillCloudAccountProject(&item, projectID, projectName, projectCode)
	return &item, nil
}

const cloudAccountSelect = `
	SELECT ca.id, ca.provider, ca.account_id, ca.display_name, ca.team_slug, ca.environments_json,
	       ca.auth_mode, ca.role_arn, ca.external_id, ca.secret_ref, ca.status, ca.last_error, ca.last_test_at,
	       ca.onboarded_by, ca.disabled_by, ca.disabled_at, ca.created_at, ca.updated_at,
	       COALESCE(u.username, ''),
	       ca.project_id, COALESCE(p.name, ''), COALESCE(p.code, '')
	  FROM cloud_accounts ca
	  LEFT JOIN users u ON u.id = ca.onboarded_by
	  LEFT JOIN projects p ON p.id = ca.project_id
`

func fillCloudAccountProject(item *cloudAccountRecord, projectID sql.NullInt64, projectName, projectCode sql.NullString) {
	if item == nil {
		return
	}
	if projectID.Valid && projectID.Int64 > 0 {
		item.ProjectID = int(projectID.Int64)
	}
	if projectName.Valid {
		item.ProjectName = projectName.String
	}
	if projectCode.Valid {
		item.ProjectCode = projectCode.String
	}
}

func getCloudAccountByID(id int) (*cloudAccountRecord, error) {
	return scanCloudAccount(DB.QueryRow(cloudAccountSelect+` WHERE ca.id = $1`, id))
}

// lookupCloudAccountDBID returns the onboarded cloud_accounts.id for a provider account id visible to the team.
func lookupCloudAccountDBID(teamSlug, provider, externalAccountID string) int {
	if DB == nil {
		return 0
	}
	teamSlug = strings.TrimSpace(teamSlug)
	provider = strings.ToLower(strings.TrimSpace(provider))
	externalAccountID = strings.TrimSpace(externalAccountID)
	if teamSlug == "" || provider == "" || externalAccountID == "" {
		return 0
	}
	var id int
	err := DB.QueryRow(`
		SELECT id FROM cloud_accounts
		WHERE team_slug = $1 AND LOWER(provider) = $2 AND account_id = $3
		ORDER BY CASE WHEN status = 'disabled' THEN 1 ELSE 0 END, id DESC
		LIMIT 1
	`, teamSlug, provider, externalAccountID).Scan(&id)
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func getCloudAccountCredentials(id int) (*cloudAccountRecord, *cloudAccountCredentials, error) {
	item, err := getCloudAccountByID(id)
	if err != nil || item == nil {
		return nil, nil, err
	}
	var roleARN, externalID, secretRef, authMode string
	err = DB.QueryRow(`SELECT auth_mode, role_arn, external_id, secret_ref FROM cloud_accounts WHERE id = $1`, id).
		Scan(&authMode, &roleARN, &externalID, &secretRef)
	if err != nil {
		return item, nil, err
	}
	roleARN, err = openCloudSecret(roleARN)
	if err != nil {
		return item, nil, err
	}
	externalID, err = openCloudSecret(externalID)
	if err != nil {
		return item, nil, err
	}
	secretRef, err = openCloudSecret(secretRef)
	if err != nil {
		return item, nil, err
	}
	return item, &cloudAccountCredentials{
		AuthMode:   authMode,
		RoleARN:    roleARN,
		ExternalID: externalID,
		SecretRef:  secretRef,
	}, nil
}

func sealCloudSecret(value string) (string, error) {
	return encryptK8sCredential(value)
}

func openCloudSecret(value string) (string, error) {
	return decryptK8sCredential(value)
}

func cloudSecretIsSealed(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), k8sCredentialEncPrefix)
}

func listCloudAccountsForTeams(teamSlugs []string) ([]cloudAccountRecord, error) {
	if len(teamSlugs) == 0 {
		return []cloudAccountRecord{}, nil
	}
	placeholders := make([]string, len(teamSlugs))
	args := make([]interface{}, len(teamSlugs))
	for i, slug := range teamSlugs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = slug
	}
	query := cloudAccountSelect + ` WHERE ca.team_slug IN (` + strings.Join(placeholders, ",") + `) ORDER BY ca.display_name, ca.account_id`
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cloudAccountRecord{}
	for rows.Next() {
		item, err := scanCloudAccountRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, nil
}

func listAllCloudAccounts() ([]cloudAccountRecord, error) {
	rows, err := DB.Query(cloudAccountSelect + ` ORDER BY ca.team_slug, ca.display_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cloudAccountRecord{}
	for rows.Next() {
		item, err := scanCloudAccountRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, nil
}

func scanCloudAccountRow(rows *sql.Rows) (*cloudAccountRecord, error) {
	var item cloudAccountRecord
	var envJSON, roleARN, externalID, secretRef, lastError string
	var lastTest, disabledAt sql.NullTime
	var onboardedBy, disabledBy, projectID sql.NullInt64
	var onboardedName, projectName, projectCode sql.NullString
	if err := rows.Scan(
		&item.ID, &item.Provider, &item.AccountID, &item.DisplayName, &item.TeamSlug, &envJSON,
		&item.AuthMode, &roleARN, &externalID, &secretRef, &item.Status, &lastError, &lastTest,
		&onboardedBy, &disabledBy, &disabledAt, &item.CreatedAt, &item.UpdatedAt, &onboardedName,
		&projectID, &projectName, &projectCode,
	); err != nil {
		return nil, err
	}
	item.Environments = parseEnvironmentsJSON(envJSON)
	item.RoleARNSet = strings.TrimSpace(roleARN) != ""
	item.ExternalIDSet = strings.TrimSpace(externalID) != ""
	item.SecretRefSet = strings.TrimSpace(secretRef) != ""
	item.CredentialsEncrypted = cloudSecretIsSealed(roleARN) || cloudSecretIsSealed(externalID) || cloudSecretIsSealed(secretRef)
	item.LastError = strings.TrimSpace(lastError)
	if lastTest.Valid {
		t := lastTest.Time.UTC()
		item.LastTestAt = &t
	}
	if onboardedBy.Valid {
		v := int(onboardedBy.Int64)
		item.OnboardedBy = &v
	}
	if disabledAt.Valid {
		t := disabledAt.Time.UTC()
		item.DisabledAt = &t
	}
	if onboardedName.Valid {
		item.OnboardedByName = onboardedName.String
	}
	fillCloudAccountProject(&item, projectID, projectName, projectCode)
	return &item, nil
}

func disableCloudAccount(id, managerID int) (*cloudAccountRecord, error) {
	_, err := DB.Exec(`
		UPDATE cloud_accounts
		SET status = 'disabled', disabled_by = $2, disabled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, managerID)
	if err != nil {
		return nil, err
	}
	return getCloudAccountByID(id)
}

func reenableCloudAccount(id int) (*cloudAccountRecord, error) {
	_, err := DB.Exec(`
		UPDATE cloud_accounts
		SET status = 'pending', disabled_by = NULL, disabled_at = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id)
	if err != nil {
		return nil, err
	}
	return getCloudAccountByID(id)
}

func updateCloudAccountMeta(id int, displayName *string, environments []string) (*cloudAccountRecord, error) {
	if displayName != nil && strings.TrimSpace(*displayName) != "" {
		_, _ = DB.Exec(`UPDATE cloud_accounts SET display_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, strings.TrimSpace(*displayName))
	}
	if environments != nil {
		_, _ = DB.Exec(`UPDATE cloud_accounts SET environments_json = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, encodeEnvironmentsJSON(environments))
	}
	return getCloudAccountByID(id)
}

func recordCloudAccountTestResult(id int, testErr error) (*cloudAccountRecord, error) {
	status := "connected"
	lastError := ""
	if testErr != nil {
		status = "error"
		lastError = publicCloudTestError(testErr)
	}
	_, err := DB.Exec(`
		UPDATE cloud_accounts
		SET status = $2, last_error = $3, last_test_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, status, lastError)
	if err != nil {
		return nil, err
	}
	return getCloudAccountByID(id)
}

func listConnectedCloudAccountIDsForTeams(provider string, teamSlugs []string) ([]string, error) {
	if DB == nil {
		return nil, sql.ErrConnDone
	}
	if len(teamSlugs) == 0 {
		return []string{}, nil
	}
	provider = normalizeCloudProvider(provider)
	placeholders := make([]string, len(teamSlugs))
	args := []interface{}{provider}
	for i, slug := range teamSlugs {
		args = append(args, strings.TrimSpace(slug))
		placeholders[i] = "$" + strconv.Itoa(len(args))
	}
	query := `
		SELECT account_id FROM cloud_accounts
		WHERE provider = $1 AND status = 'connected' AND disabled_at IS NULL
		  AND team_slug IN (` + strings.Join(placeholders, ",") + `)`
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var accountID string
		if err := rows.Scan(&accountID); err != nil {
			return nil, err
		}
		if strings.TrimSpace(accountID) != "" {
			out = append(out, strings.TrimSpace(accountID))
		}
	}
	return out, nil
}

func updateCloudAccountTrust(id int, authMode, roleARN, externalID, secretRef string) error {
	var err error
	roleARN, err = sealCloudSecret(roleARN)
	if err != nil {
		return err
	}
	externalID, err = sealCloudSecret(externalID)
	if err != nil {
		return err
	}
	secretRef, err = sealCloudSecret(secretRef)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`
		UPDATE cloud_accounts
		SET auth_mode = $2, role_arn = $3, external_id = $4, secret_ref = $5,
		    status = 'pending', last_error = '', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, authMode, roleARN, externalID, secretRef)
	return err
}

func cloudAccountsConfigured(provider string) (bool, error) {
	var count int
	err := DB.QueryRow(`SELECT COUNT(*) FROM cloud_accounts WHERE provider = $1`, normalizeCloudProvider(provider)).Scan(&count)
	return count > 0, err
}
