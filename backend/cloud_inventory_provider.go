package main

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
)

// CloudInventoryListFilters are normalized query filters for inventory providers.
type CloudInventoryListFilters struct {
	Cloud             string
	Team              string
	Account           string
	Env               string
	Region            string
	Search            string
	Page              int
	Limit             int
	ProjectID         int
	VisibleTeamSlugs  []string
}

// CloudInventoryProvider abstracts cloud inventory reads (AWS first; live sync optional).
type CloudInventoryProvider interface {
	List(ctx context.Context, filters CloudInventoryListFilters) (items []cloudResourceRow, total int, err error)
	GetByID(ctx context.Context, id int) (*cloudResourceRow, error)
}

type dbCloudInventoryProvider struct{}

func (dbCloudInventoryProvider) List(_ context.Context, filters CloudInventoryListFilters) ([]cloudResourceRow, int, error) {
	if DB == nil {
		return nil, 0, sql.ErrConnDone
	}
	cloud := filters.Cloud
	if cloud == "" {
		cloud = "aws"
	}
	page := filters.Page
	if page < 1 {
		page = 1
	}
	limit := filters.Limit
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	offset := (page - 1) * limit

	if len(filters.VisibleTeamSlugs) == 0 {
		return []cloudResourceRow{}, 0, nil
	}

	team := strings.TrimSpace(filters.Team)
	if team == "" && filters.ProjectID > 0 {
		var slug string
		_ = DB.QueryRow(`
			SELECT COALESCE(t.slug, '')
			FROM project_team_access pta
			JOIN teams t ON t.id = pta.team_id
			WHERE pta.project_id = $1
			ORDER BY pta.team_id
			LIMIT 1
		`, filters.ProjectID).Scan(&slug)
		team = strings.TrimSpace(slug)
	}

	team, teamOK := resolveInventoryTeamFilter(team, filters.VisibleTeamSlugs)
	if !teamOK {
		return []cloudResourceRow{}, 0, nil
	}

	where := []string{"cloud = $1"}
	args := []interface{}{cloud}
	if team != "" {
		args = append(args, team)
		where = append(where, "team_slug = $"+strconv.Itoa(len(args)))
	} else {
		placeholders := make([]string, len(filters.VisibleTeamSlugs))
		for i, slug := range filters.VisibleTeamSlugs {
			args = append(args, strings.TrimSpace(slug))
			placeholders[i] = "$" + strconv.Itoa(len(args))
		}
		where = append(where, "team_slug IN ("+strings.Join(placeholders, ",")+")")
	}
	if strings.TrimSpace(filters.Account) != "" {
		args = append(args, strings.TrimSpace(filters.Account))
		where = append(where, "account_id = $"+strconv.Itoa(len(args)))
	}
	if strings.TrimSpace(filters.Env) != "" {
		args = append(args, strings.TrimSpace(filters.Env))
		where = append(where, "environment = $"+strconv.Itoa(len(args)))
	}
	if strings.TrimSpace(filters.Region) != "" {
		args = append(args, strings.TrimSpace(filters.Region))
		where = append(where, "region = $"+strconv.Itoa(len(args)))
	}
	if strings.TrimSpace(filters.Search) != "" {
		args = append(args, "%"+strings.TrimSpace(filters.Search)+"%")
		where = append(where, "(display_name ILIKE $"+strconv.Itoa(len(args))+" OR resource_id ILIKE $"+strconv.Itoa(len(args))+")")
	}
	if configured, err := cloudAccountsConfigured(cloud); err == nil && configured {
		if ids, err := listConnectedCloudAccountIDsForTeams(cloud, filters.VisibleTeamSlugs); err == nil {
			if len(ids) == 0 {
				return []cloudResourceRow{}, 0, nil
			}
			placeholders := make([]string, len(ids))
			for i, id := range ids {
				args = append(args, id)
				placeholders[i] = "$" + strconv.Itoa(len(args))
			}
			where = append(where, "account_id IN ("+strings.Join(placeholders, ",")+")")
		}
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	countQuery := "SELECT COUNT(*) FROM cloud_resources WHERE " + whereSQL
	if err := DB.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limitArg := len(args) + 1
	offsetArg := len(args) + 2
	listQuery := `
		SELECT id, team_slug, cloud, account_id, account_name, environment, region, service_type, resource_id, display_name, status, updated_at
		FROM cloud_resources WHERE ` + whereSQL + `
		ORDER BY updated_at DESC, id DESC
		LIMIT $` + strconv.Itoa(limitArg) + ` OFFSET $` + strconv.Itoa(offsetArg)
	args = append(args, limit, offset)
	rows, err := DB.Query(listQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := []cloudResourceRow{}
	for rows.Next() {
		var item cloudResourceRow
		var updated sql.NullTime
		if err := rows.Scan(&item.ID, &item.TeamSlug, &item.Cloud, &item.AccountID, &item.AccountName, &item.Environment, &item.Region, &item.ServiceType, &item.ResourceID, &item.DisplayName, &item.Status, &updated); err != nil {
			return nil, 0, err
		}
		if updated.Valid {
			item.UpdatedAt = updated.Time.UTC().Format("2006-01-02T15:04:05Z")
		}
		items = append(items, item)
	}
	return items, total, nil
}

func (dbCloudInventoryProvider) GetByID(_ context.Context, id int) (*cloudResourceRow, error) {
	if DB == nil {
		return nil, sql.ErrConnDone
	}
	var item cloudResourceRow
	var updated sql.NullTime
	err := DB.QueryRow(`
		SELECT id, team_slug, cloud, account_id, account_name, environment, region, service_type, resource_id, display_name, status, updated_at
		FROM cloud_resources WHERE id = $1
	`, id).Scan(&item.ID, &item.TeamSlug, &item.Cloud, &item.AccountID, &item.AccountName, &item.Environment, &item.Region, &item.ServiceType, &item.ResourceID, &item.DisplayName, &item.Status, &updated)
	if err != nil {
		return nil, err
	}
	if updated.Valid {
		item.UpdatedAt = updated.Time.UTC().Format("2006-01-02T15:04:05Z")
	}
	return &item, nil
}

// cloudInventoryProvider is the active inventory backend (DB demo seed today; AWS API later).
var cloudInventoryProvider CloudInventoryProvider = dbCloudInventoryProvider{}
