package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

const mcpProtocolVersion = "2024-11-05"

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func mcpTools() []mcpTool {
	emptyProps := map[string]any{"type": "object", "properties": map[string]any{}}
	return []mcpTool{
		{
			Name:        "list_changes",
			Description: "List recent OpsTrellis change requests. Read only.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"project_id":  map[string]any{"type": "integer"},
					"environment": map[string]any{"type": "string"},
					"status":      map[string]any{"type": "string"},
					"q":           map[string]any{"type": "string"},
				},
			},
		},
		{
			Name:        "get_change",
			Description: "Get one change request by id or change_number. Includes blast radius, live-vs-CHG drift, and rollback plan.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id":            map[string]any{"type": "integer"},
					"change_number": map[string]any{"type": "string"},
				},
			},
		},
		{
			Name:        "list_incidents",
			Description: "List incidents. Read only.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"status": map[string]any{"type": "string"},
				},
			},
		},
		{
			Name:        "get_incident",
			Description: "Get one incident by id or incident_number. Includes rollback plan and generated review when present.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id":              map[string]any{"type": "integer"},
					"incident_number": map[string]any{"type": "string"},
				},
			},
		},
		{
			Name:        "health_for_service",
			Description: "Return Health snapshot for a service or environment.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"service":     map[string]any{"type": "string"},
					"environment": map[string]any{"type": "string"},
					"project_id":  map[string]any{"type": "integer"},
				},
			},
		},
		{
			Name:        "list_identity_findings",
			Description: "List static-key warnings, recent OIDC verifies, and the last cloud-role exchange (no secrets).",
			InputSchema: emptyProps,
		},
		{
			Name:        "list_tickets",
			Description: "List recent infrastructure request tickets. Read only.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"status":     map[string]any{"type": "string"},
					"project_id": map[string]any{"type": "integer"},
				},
			},
		},
		{
			Name:        "list_scorecards",
			Description: "List service scorecards. Read only.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"project_id":  map[string]any{"type": "integer"},
					"environment": map[string]any{"type": "string"},
				},
			},
		},
		{
			Name:        "ask_catalog",
			Description: "Answer from Change Requests, incidents, and runbooks only. Read only. Cites IDs.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string"},
				},
			},
		},
		{
			Name:        "get_ticket",
			Description: "Get one infrastructure request by id.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id": map[string]any{"type": "integer"},
				},
			},
		},
		{
			Name:        "comment_incident",
			Description: "Append an operator comment to an incident. Same freeze/apply refusal as the portal. Does not terraform or kubectl apply.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id":              map[string]any{"type": "integer"},
					"incident_number": map[string]any{"type": "string"},
					"comment":         map[string]any{"type": "string"},
				},
			},
		},
		{
			Name:        "request_rollback",
			Description: "Record an emergency CHG to previous_sha. Same freeze/CAB as the portal. Does not apply the revision.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"incident_id":     map[string]any{"type": "integer"},
					"incident_number": map[string]any{"type": "string"},
					"change_id":       map[string]any{"type": "integer"},
					"change_number":   map[string]any{"type": "string"},
					"reason":          map[string]any{"type": "string"},
				},
			},
		},
	}
}

func mcpWriteToolNames() []string {
	return []string{"comment_incident", "request_rollback"}
}

func mcpWrite(w http.ResponseWriter, id any, result any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result":  result,
	})
}

func mcpError(w http.ResponseWriter, id any, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error":   map[string]any{"code": code, "message": message},
	})
}

func mcpAuthIdentity(r *http.Request) (int, error) {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer"))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-API-Key"))
	}
	if token == "" {
		return 0, fmt.Errorf("missing token")
	}
	uid, _, err := validateTokenOrAPIKey(token)
	return uid, err
}

func mcpAuthOK(r *http.Request) bool {
	_, err := mcpAuthIdentity(r)
	return err == nil
}

func mcpHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == "OPTIONS" {
		handleOptions(w, r)
		return
	}
	if r.Method == "GET" {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"name":             "opstrellis",
			"title":            "OpsTrellis MCP",
			"version":          "1.0.0",
			"protocol_version": mcpProtocolVersion,
			"tools":            mcpToolNames(),
			"write_tools":      mcpWriteToolNames(),
			"auth":             "Bearer session token or API key from POST /api/me/api-keys",
		})
		return
	}
	if r.Method != "POST" {
		writeMethodNotAllowed(w, r)
		return
	}
	if !mcpAuthOK(r) {
		writeAPIError(w, r, http.StatusUnauthorized, "mcp requires a session token or API key", nil)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid body", err)
		return
	}
	var req mcpRequest
	if err := json.Unmarshal(body, &req); err != nil {
		mcpError(w, nil, -32700, "parse error")
		return
	}
	if req.JSONRPC == "" {
		req.JSONRPC = "2.0"
	}
	switch strings.TrimSpace(req.Method) {
	case "initialize":
		mcpWrite(w, req.ID, map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "opstrellis", "version": "1.0.0"},
		})
	case "notifications/initialized", "ping":
		mcpWrite(w, req.ID, map[string]any{"ok": true})
	case "tools/list":
		mcpWrite(w, req.ID, map[string]any{"tools": mcpTools()})
	case "tools/call":
		var params struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			mcpError(w, req.ID, -32602, "invalid params")
			return
		}
		userID, _ := mcpAuthIdentity(r)
		text, callErr := callMCPToolAs(params.Name, params.Arguments, userID)
		if callErr != nil {
			mcpError(w, req.ID, -32000, callErr.Error())
			return
		}
		mcpWrite(w, req.ID, map[string]any{
			"content": []map[string]any{{"type": "text", "text": text}},
			"isError": false,
		})
	default:
		mcpError(w, req.ID, -32601, "method not found")
	}
}

func mcpToolNames() []string {
	tools := mcpTools()
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	return names
}

func callMCPTool(name string, args map[string]any) (string, error) {
	return callMCPToolAs(name, args, 0)
}

func callMCPToolAs(name string, args map[string]any, userID int) (string, error) {
	if args == nil {
		args = map[string]any{}
	}
	switch strings.TrimSpace(name) {
	case "list_changes":
		items, err := listChangeRequests(intFromAny(args["project_id"]), stringFromAny(args["environment"]), stringFromAny(args["status"]), stringFromAny(args["q"]))
		if err != nil {
			return "", err
		}
		return marshalMCP(items)
	case "get_change":
		item, err := lookupChangeForMCP(intFromAny(args["id"]), stringFromAny(args["change_number"]))
		if err != nil {
			return "", err
		}
		return marshalMCP(mcpChangeDetail(item))
	case "list_incidents":
		items, err := listRequestIncidents(stringFromAny(args["status"]))
		if err != nil {
			return "", err
		}
		return marshalMCP(items)
	case "get_incident":
		item, err := lookupIncidentForMCP(intFromAny(args["id"]), stringFromAny(args["incident_number"]))
		if err != nil {
			return "", err
		}
		attachRollbackPlan(item)
		review, postmortem := incidentReviewPayload(item)
		return marshalMCP(map[string]any{"incident": item, "review": review, "postmortem": postmortem, "rollback": item.RollbackPlan})
	case "ask_catalog":
		answer := buildGroundedAnswer(stringFromAny(args["query"]), retrieveGroundedSources(stringFromAny(args["query"]), nil))
		return marshalMCP(answer)
	case "health_for_service":
		payload, err := buildOpsHealth(intFromAny(args["project_id"]), stringFromAny(args["environment"]))
		if err != nil {
			return "", err
		}
		service := strings.ToLower(strings.TrimSpace(stringFromAny(args["service"])))
		if service != "" {
			return marshalMCP(map[string]any{"service": service, "health": payload})
		}
		return marshalMCP(payload)
	case "list_identity_findings":
		return marshalMCP(identityCatalogPayload())
	case "comment_incident":
		return mcpCommentIncident(args, userID)
	case "request_rollback":
		return mcpRequestRollback(args, userID)
	case "list_tickets":
		items, err := GetPRRequests("", "", "", intFromAny(args["project_id"]), stringFromAny(args["status"]), "", stringFromAny(args["q"]), 0, 0, nil, 50, 0, "updated_at", "desc", false, "", "")
		if err != nil {
			return "", err
		}
		return marshalMCP(items)
	case "list_scorecards":
		items, err := buildServiceScorecards(intFromAny(args["project_id"]), stringFromAny(args["environment"]))
		if err != nil {
			return "", err
		}
		return marshalMCP(items)
	case "get_ticket":
		id := intFromAny(args["id"])
		if id <= 0 {
			return "", fmt.Errorf("id is required")
		}
		item, err := GetPRRequestByID(id)
		if err != nil {
			return "", err
		}
		return marshalMCP(item)
	default:
		return "", fmt.Errorf("unknown or write tool %q is not allowed", name)
	}
}

func mcpChangeDetail(item *changeRequestRecord) map[string]any {
	if item == nil {
		return map[string]any{}
	}
	if item.ID > 0 {
		attachChangeRollbackPlan(item)
	}
	return map[string]any{
		"change":       item,
		"blast_radius": blastRadiusForChange(*item),
		"drift":        detectServiceDrift(item.Service, item.Environment, item.SHA, item.ImageDigest),
		"rollback":     item.RollbackPlan,
	}
}

func lookupChangeForMCP(id int, number string) (*changeRequestRecord, error) {
	if id > 0 {
		return getChangeRequestByID(id)
	}
	number = strings.TrimSpace(number)
	if number == "" {
		return nil, fmt.Errorf("id or change_number is required")
	}
	items, err := listChangeRequests(0, "", "", number)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if strings.EqualFold(items[i].ChangeNumber, number) || strconv.Itoa(items[i].ID) == number {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("change not found")
}

func lookupIncidentForMCP(id int, number string) (*requestIncident, error) {
	if id > 0 {
		return getRequestIncidentByID(id)
	}
	number = strings.TrimSpace(number)
	if number == "" {
		return nil, fmt.Errorf("id or incident_number is required")
	}
	items, err := listRequestIncidents("")
	if err != nil {
		return nil, err
	}
	for i := range items {
		if strings.EqualFold(items[i].IncidentNumber, number) || strconv.Itoa(items[i].ID) == number {
			return &items[i], nil
		}
	}
	return nil, fmt.Errorf("incident not found")
}

func marshalMCP(value any) (string, error) {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", err
	}
	return string(raw), nil
}
