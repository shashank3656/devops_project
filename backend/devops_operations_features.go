package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

func encodeDevopsOperationsJSON(w http.ResponseWriter, payload interface{}) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("devops operations response encode failed: %v", err)
	}
}

type changeCalendarSummary struct {
	UpcomingCount        int `json:"upcoming_count"`
	OverdueCount         int `json:"overdue_count"`
	ProductionWatchCount int `json:"production_watch_count"`
	InProgressCount      int `json:"in_progress_count"`
}

type changeCalendarItem struct {
	RequestID    int       `json:"request_id"`
	ProjectID    *int      `json:"project_id,omitempty"`
	ProjectName  string    `json:"project_name,omitempty"`
	ProjectCode  string    `json:"project_code,omitempty"`
	Team         string    `json:"team"`
	Environment  string    `json:"environment"`
	Cloud        string    `json:"cloud"`
	Service      string    `json:"service"`
	Status       string    `json:"status"`
	Priority     string    `json:"priority"`
	DueDate      time.Time `json:"due_date"`
	WindowStart  time.Time `json:"window_start"`
	WindowEnd    time.Time `json:"window_end"`
	CalendarDate string    `json:"calendar_date"`
	ChangeType   string    `json:"change_type"`
	RiskLevel    string    `json:"risk_level"`
	Summary      string    `json:"summary"`
}

type approvalSLASummary struct {
	PendingCount     int     `json:"pending_count"`
	OverdueCount     int     `json:"overdue_count"`
	DueSoonCount     int     `json:"due_soon_count"`
	AvgAgeHours      float64 `json:"avg_age_hours"`
	OldestAgeHours   float64 `json:"oldest_age_hours"`
	ManagerQueue     int     `json:"manager_queue"`
	DevopsQueue      int     `json:"devops_queue"`
	FinalReviewQueue int     `json:"final_review_queue"`
}

type approvalSLABreakdownItem struct {
	Key            string  `json:"key"`
	Label          string  `json:"label"`
	PendingCount   int     `json:"pending_count"`
	OverdueCount   int     `json:"overdue_count"`
	AvgAgeHours    float64 `json:"avg_age_hours"`
	OldestAgeHours float64 `json:"oldest_age_hours"`
}

type approvalSLABucket struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

type approvalSLAResponse struct {
	Summary       approvalSLASummary         `json:"summary"`
	ByProject     []approvalSLABreakdownItem `json:"by_project"`
	ByEnvironment []approvalSLABreakdownItem `json:"by_environment"`
	ByTeam        []approvalSLABreakdownItem `json:"by_team"`
	ByApprover    []approvalSLABreakdownItem `json:"by_approver"`
	AgingBuckets  []approvalSLABucket        `json:"aging_buckets"`
}

type serviceHeatmapRow struct {
	ProjectID     int            `json:"project_id"`
	ProjectName   string         `json:"project_name"`
	ProjectCode   string         `json:"project_code"`
	Status        string         `json:"status"`
	RequestCount  int            `json:"request_count"`
	PendingCount  int            `json:"pending_count"`
	ServiceCounts map[string]int `json:"service_counts"`
}

type serviceHeatmapResponse struct {
	Columns       []string            `json:"columns"`
	Rows          []serviceHeatmapRow `json:"rows"`
	CloudTotals   map[string]int      `json:"cloud_totals"`
	ServiceTotals map[string]int      `json:"service_totals"`
}

type approvalSLAAccumulator struct {
	Label        string
	PendingCount int
	OverdueCount int
	AgeHoursSum  float64
	OldestHours  float64
}

func ageBucketKey(ageHours float64) string {
	switch {
	case ageHours < 4:
		return "under_4h"
	case ageHours < 12:
		return "under_12h"
	case ageHours < 24:
		return "under_24h"
	case ageHours < 72:
		return "under_72h"
	default:
		return "over_72h"
	}
}

func ageBucketLabel(key string) string {
	switch key {
	case "under_4h":
		return "< 4h"
	case "under_12h":
		return "4h - 12h"
	case "under_24h":
		return "12h - 24h"
	case "under_72h":
		return "24h - 72h"
	default:
		return "> 72h"
	}
}

func appendApprovalAccumulator(target map[string]*approvalSLAAccumulator, key, label string, ageHours float64, overdue bool) {
	entry := target[key]
	if entry == nil {
		entry = &approvalSLAAccumulator{Label: label}
		target[key] = entry
	}
	entry.PendingCount++
	entry.AgeHoursSum += ageHours
	if overdue {
		entry.OverdueCount++
	}
	if ageHours > entry.OldestHours {
		entry.OldestHours = ageHours
	}
}

func flattenApprovalAccumulators(values map[string]*approvalSLAAccumulator) []approvalSLABreakdownItem {
	items := make([]approvalSLABreakdownItem, 0, len(values))
	for key, value := range values {
		if value == nil || value.PendingCount == 0 {
			continue
		}
		items = append(items, approvalSLABreakdownItem{
			Key:            key,
			Label:          value.Label,
			PendingCount:   value.PendingCount,
			OverdueCount:   value.OverdueCount,
			AvgAgeHours:    value.AgeHoursSum / float64(value.PendingCount),
			OldestAgeHours: value.OldestHours,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].PendingCount == items[j].PendingCount {
			return items[i].Label < items[j].Label
		}
		return items[i].PendingCount > items[j].PendingCount
	})
	return items
}

func resolveApprovalOwnerLabel(req *PRRequest) string {
	if req == nil {
		return "Unassigned"
	}
	switch req.Status {
	case "pending_user_manager_approval":
		if req.CreatedBy != nil && *req.CreatedBy > 0 {
			managerID := GetGroupManagerForUserInTeam(*req.CreatedBy, req.Team)
			if managerID == 0 {
				managerID = GetGroupManagerForUser(*req.CreatedBy)
			}
			if managerID > 0 {
				if user, err := GetUserByID(managerID); err == nil && user != nil && strings.TrimSpace(user.Username) != "" {
					return user.Username
				}
			}
		}
		return "Team manager"
	case "pending_devops_approval":
		if req.AssignedTo != nil && *req.AssignedTo > 0 {
			if user, err := GetUserByID(*req.AssignedTo); err == nil && user != nil && strings.TrimSpace(user.Username) != "" {
				return user.Username
			}
		}
		return "Unassigned DevOps"
	default:
		return "Final approval"
	}
}

func devopsChangeCalendarHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}

	requests, err := GetPRRequests("", "", "", 0, "pending_any", "", "", 0, 0, nil, 250, 0, "due_date", "asc", false, "", "")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsOperationsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	now := time.Now()
	items := make([]changeCalendarItem, 0)
	summary := changeCalendarSummary{}
	for _, req := range requests {
		if req.DueDate == nil {
			continue
		}
		due := *req.DueDate
		if due.Before(now.Add(-24*time.Hour)) || due.After(now.Add(21*24*time.Hour)) {
			continue
		}
		changeType := "Change window"
		riskLevel := "low"
		if strings.EqualFold(req.Env, "prod") {
			changeType = "Production window"
			riskLevel = "high"
			summary.ProductionWatchCount++
		}
		if due.Before(now) {
			changeType = "Overdue window"
			riskLevel = "high"
			summary.OverdueCount++
		} else {
			summary.UpcomingCount++
		}
		if req.Status == "in_progress" {
			summary.InProgressCount++
		}
		items = append(items, changeCalendarItem{
			RequestID:    req.ID,
			ProjectID:    req.ProjectID,
			ProjectName:  req.ProjectName,
			ProjectCode:  req.ProjectCode,
			Team:         req.Team,
			Environment:  req.Env,
			Cloud:        req.Cloud,
			Service:      req.Service,
			Status:       req.Status,
			Priority:     req.Priority,
			DueDate:      due,
			WindowStart:  due.Add(-2 * time.Hour),
			WindowEnd:    due.Add(2 * time.Hour),
			CalendarDate: due.Format("2006-01-02"),
			ChangeType:   changeType,
			RiskLevel:    riskLevel,
			Summary:      fmt.Sprintf("%s · %s · %s", req.Team, req.Cloud, req.Service),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].DueDate.Before(items[j].DueDate)
	})

	w.Header().Set("Content-Type", "application/json")
	encodeDevopsOperationsJSON(w, map[string]interface{}{
		"status":  "ok",
		"summary": summary,
		"items":   items,
	})
}

func devopsApprovalSLAHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}

	requests, err := GetPRRequests("", "", "", 0, "pending_any", "", "", 0, 0, nil, 500, 0, "created_at", "asc", false, "", "")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsOperationsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	now := time.Now()
	response := approvalSLAResponse{
		ByProject:     []approvalSLABreakdownItem{},
		ByEnvironment: []approvalSLABreakdownItem{},
		ByTeam:        []approvalSLABreakdownItem{},
		ByApprover:    []approvalSLABreakdownItem{},
		AgingBuckets:  []approvalSLABucket{},
	}
	projectAcc := map[string]*approvalSLAAccumulator{}
	envAcc := map[string]*approvalSLAAccumulator{}
	teamAcc := map[string]*approvalSLAAccumulator{}
	approverAcc := map[string]*approvalSLAAccumulator{}
	bucketCounts := map[string]int{}
	var totalAge float64
	for _, req := range requests {
		if req.Status != "pending_approval" && req.Status != "pending_devops_approval" && req.Status != "pending_user_manager_approval" {
			continue
		}
		ageHours := now.Sub(req.CreatedAt).Hours()
		overdue := req.DueDate != nil && req.DueDate.Before(now)
		dueSoon := req.DueDate != nil && req.DueDate.After(now) && req.DueDate.Before(now.Add(24*time.Hour))

		response.Summary.PendingCount++
		totalAge += ageHours
		if overdue {
			response.Summary.OverdueCount++
		}
		if dueSoon {
			response.Summary.DueSoonCount++
		}
		if ageHours > response.Summary.OldestAgeHours {
			response.Summary.OldestAgeHours = ageHours
		}
		switch req.Status {
		case "pending_user_manager_approval":
			response.Summary.ManagerQueue++
		case "pending_devops_approval":
			response.Summary.DevopsQueue++
		default:
			response.Summary.FinalReviewQueue++
		}

		projectKey := strconv.Itoa(valueOrZero(req.ProjectID))
		projectLabel := req.ProjectName
		if strings.TrimSpace(projectLabel) == "" {
			projectLabel = "Unassigned project"
		}
		appendApprovalAccumulator(projectAcc, projectKey, projectLabel, ageHours, overdue)
		appendApprovalAccumulator(envAcc, strings.TrimSpace(req.Env), strings.TrimSpace(req.Env), ageHours, overdue)
		appendApprovalAccumulator(teamAcc, strings.TrimSpace(req.Team), strings.TrimSpace(req.Team), ageHours, overdue)
		approverLabel := resolveApprovalOwnerLabel(&req)
		appendApprovalAccumulator(approverAcc, approverLabel, approverLabel, ageHours, overdue)
		bucketCounts[ageBucketKey(ageHours)]++
	}
	if response.Summary.PendingCount > 0 {
		response.Summary.AvgAgeHours = totalAge / float64(response.Summary.PendingCount)
	}
	response.ByProject = flattenApprovalAccumulators(projectAcc)
	response.ByEnvironment = flattenApprovalAccumulators(envAcc)
	response.ByTeam = flattenApprovalAccumulators(teamAcc)
	response.ByApprover = flattenApprovalAccumulators(approverAcc)

	bucketOrder := []string{"under_4h", "under_12h", "under_24h", "under_72h", "over_72h"}
	for _, key := range bucketOrder {
		response.AgingBuckets = append(response.AgingBuckets, approvalSLABucket{
			Key:   key,
			Label: ageBucketLabel(key),
			Count: bucketCounts[key],
		})
	}

	w.Header().Set("Content-Type", "application/json")
	encodeDevopsOperationsJSON(w, map[string]interface{}{
		"status":  "ok",
		"summary": response.Summary,
		"sla":     response,
	})
}

func devopsServiceHeatmapHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method != "GET" {
		writeMethodNotAllowed(w, r)
		return
	}
	if _, ok := requireDevopsManager(w, r); !ok {
		return
	}

	projects, err := listProjectCatalogs()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		encodeDevopsOperationsJSON(w, map[string]interface{}{"error": err.Error(), "status": "error"})
		return
	}

	response := serviceHeatmapResponse{
		Columns:       []string{},
		Rows:          []serviceHeatmapRow{},
		CloudTotals:   map[string]int{},
		ServiceTotals: map[string]int{},
	}
	serviceSet := map[string]struct{}{}
	for _, project := range projects {
		row := serviceHeatmapRow{
			ProjectID:     project.ID,
			ProjectName:   project.Name,
			ProjectCode:   project.Code,
			Status:        project.Status,
			RequestCount:  project.RequestCount,
			PendingCount:  project.PendingRequestCount,
			ServiceCounts: map[string]int{},
		}
		for _, service := range project.Services {
			label := strings.ToUpper(strings.TrimSpace(service.Cloud)) + ":" + strings.TrimSpace(service.Service)
			if label == ":" || strings.TrimSpace(label) == "" {
				continue
			}
			row.ServiceCounts[label]++
			response.ServiceTotals[label]++
			response.CloudTotals[strings.ToUpper(strings.TrimSpace(service.Cloud))]++
			serviceSet[label] = struct{}{}
		}
		response.Rows = append(response.Rows, row)
	}
	for label := range serviceSet {
		response.Columns = append(response.Columns, label)
	}
	sort.Strings(response.Columns)
	sort.Slice(response.Rows, func(i, j int) bool {
		if response.Rows[i].PendingCount == response.Rows[j].PendingCount {
			return response.Rows[i].ProjectName < response.Rows[j].ProjectName
		}
		return response.Rows[i].PendingCount > response.Rows[j].PendingCount
	})

	w.Header().Set("Content-Type", "application/json")
	encodeDevopsOperationsJSON(w, map[string]interface{}{
		"status":  "ok",
		"heatmap": response,
	})
}

func valueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
