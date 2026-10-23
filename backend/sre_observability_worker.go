package main

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

func startMonitorEvaluationWorker() {
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			drainQueuedMonitorBatches()
			runDueScheduledMonitors()
		}
	}()
}

func drainQueuedMonitorBatches() {
	if DB == nil {
		return
	}
	for i := 0; i < 8; i++ {
		var batchID int
		var monitorCSV string
		err := queryRowContext(`
			UPDATE monitor_evaluation_batches
			SET state = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
			WHERE id = (
				SELECT id FROM monitor_evaluation_batches
				WHERE state = 'queued'
				ORDER BY id
				LIMIT 1
			) AND state = 'queued'
			RETURNING id, monitor_ids
		`).Scan(&batchID, &monitorCSV)
		if err != nil || batchID <= 0 {
			return
		}
		ids := parseCSVInts(monitorCSV)
		monitors := make([]serviceMonitorView, 0, len(ids))
		for _, id := range ids {
			item, err := getServiceMonitor(id)
			if err != nil {
				continue
			}
			monitors = append(monitors, *item)
		}
		runMonitorBatch(batchID, monitors)
	}
}

func parseCSVInts(raw string) []int {
	parts := strings.Split(raw, ",")
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.Atoi(strings.TrimSpace(part))
		if err == nil && id > 0 {
			out = append(out, id)
		}
	}
	return out
}

func runDueScheduledMonitors() {
	if DB == nil {
		return
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT m.id, m.service_id, m.environment, m.schedule_minutes
		FROM service_monitors m
		WHERE m.enabled = TRUE AND m.schedule_minutes > 0
	`)
	if err != nil {
		return
	}
	defer cancel()
	defer rows.Close()
	type due struct {
		id, serviceID, minutes int
		env                    string
	}
	items := []due{}
	for rows.Next() {
		var item due
		if rows.Scan(&item.id, &item.serviceID, &item.env, &item.minutes) == nil {
			items = append(items, item)
		}
	}
	now := time.Now().UTC()
	for _, item := range items {
		latest := latestMonitorRun(item.id)
		if latest != nil && latest.EvaluatedAt != nil {
			stamp, err := time.Parse(time.RFC3339, *latest.EvaluatedAt)
			if err == nil && now.Sub(stamp) < time.Duration(item.minutes)*time.Minute {
				continue
			}
		}
		service, err := getServiceMapByID(item.serviceID)
		if err != nil {
			continue
		}
		monitor, err := getServiceMonitor(item.id)
		if err != nil || !monitor.Enabled {
			continue
		}
		if _, _, err := enqueueSavedMonitorsAt(0, service, item.env, []serviceMonitorView{*monitor}, "scheduled", time.Time{}); err != nil {
			log.Printf("[monitoring] scheduled refresh skipped service=%d monitor=%d: %v", item.serviceID, item.id, err)
		}
	}
}

func enqueueSavedMonitors(userID int, service *serviceMapEntry, env string, selected []serviceMonitorView, mode string) (*evalBatchView, int, error) {
	return enqueueSavedMonitorsAt(userID, service, env, selected, mode, time.Time{})
}

func enqueueSavedMonitorsAt(userID int, service *serviceMapEntry, env string, selected []serviceMonitorView, mode string, reuseAnchor time.Time) (*evalBatchView, int, error) {
	if len(selected) == 0 {
		return nil, 400, fmt.Errorf("no enabled monitors to refresh")
	}
	versionIDs := make([]int, 0, len(selected))
	ids := make([]string, 0, len(selected))
	for _, monitor := range selected {
		versionIDs = append(versionIDs, monitor.ID*1000+monitor.CurrentVersion)
		ids = append(ids, strconv.Itoa(monitor.ID))
	}
	key := coalesceRefreshKey(service.ID, env, versionIDs, mode)
	if ok, existing := monitorEvalGate.begin(key); !ok {
		if existing > 0 {
			view, _ := getEvalBatch(existing)
			return view, 202, nil
		}
		return nil, 409, fmt.Errorf("a refresh for this scope is already running")
	}
	var batchID int
	err := queryRowContext(`
		INSERT INTO monitor_evaluation_batches (service_id, project_id, environment, actor_id, state, coalesce_key, monitor_ids, correlation_id)
		VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7)
		RETURNING id
	`, service.ID, nullableProject(service), env, userID, key, strings.Join(ids, ","), fmt.Sprintf("eval-%d-%d", service.ID, time.Now().Unix())).Scan(&batchID)
	if err != nil {
		monitorEvalGate.done(key)
		return nil, 500, err
	}
	if anchor := retryEvaluationAnchor(reuseAnchor, mode == "retry"); !anchor.IsZero() {
		_, _ = execContext(`UPDATE monitor_evaluation_batches SET anchor_at = $2 WHERE id = $1`, batchID, anchor)
	}
	monitorEvalGate.bind(key, batchID)
	go drainQueuedMonitorBatches()
	view, _ := getEvalBatch(batchID)
	if view == nil {
		view = &evalBatchView{ID: batchID, ServiceID: service.ID, Environment: env, State: "queued", Mode: "on_demand"}
	}
	if mode == "scheduled" {
		view.Mode = "scheduled"
	}
	if mode == "retry" {
		view.Mode = "retry"
	}
	return view, 202, nil
}
