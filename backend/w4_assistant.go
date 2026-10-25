package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type groundedCitation struct {
	Kind    string `json:"kind"`
	ID      int    `json:"id"`
	Number  string `json:"number"`
	Title   string `json:"title"`
	Href    string `json:"href,omitempty"`
	Service string `json:"service,omitempty"`
}

type groundedRollbackHint struct {
	ChangeID       int    `json:"change_id,omitempty"`
	ChangeNumber   string `json:"change_number,omitempty"`
	IncidentID     int    `json:"incident_id,omitempty"`
	IncidentNumber string `json:"incident_number,omitempty"`
	PreviousSHA    string `json:"previous_sha,omitempty"`
	Allowed        bool   `json:"allowed"`
	Reason         string `json:"reason,omitempty"`
}

type groundedSource struct {
	Kind        string
	ID          int
	Number      string
	Title       string
	Href        string
	Service     string
	PreviousSHA string
	Body        string
	Score       int
}

type groundedAnswer struct {
	Reply     string                `json:"reply"`
	Citations []groundedCitation    `json:"citations"`
	Rollback  *groundedRollbackHint `json:"rollback,omitempty"`
	Source    string                `json:"source"`
}

var (
	chgNumberPattern  = regexp.MustCompile(`(?i)\bCHG0*([0-9]+)\b`)
	incNumberPattern  = regexp.MustCompile(`(?i)\bINC0*([0-9]+)\b`)
	calcNumberPattern = regexp.MustCompile(`(?i)\bCALC-COST-([A-F0-9]+)\b`)
	applyPattern      = regexp.MustCompile(`(?i)\b(terraform\s+apply|kubectl\s+apply|helm\s+upgrade|destroy\s+prod|apply\s+this\s+plan)\b`)
)

func queryAsksToApply(query string) bool {
	return applyPattern.MatchString(query)
}

func citationHRef(kind string, id int, number string) string {
	switch kind {
	case "change":
		return fmt.Sprintf("/changes/%d", id)
	case "incident":
		return fmt.Sprintf("/incidents/%d", id)
	case "runbook":
		return "/runbooks"
	case "cost_calculation":
		return "/cost/optimization?calc=" + number
	default:
		return ""
	}
}

func costQueryRelated(query string) bool {
	value := strings.ToLower(query)
	for _, token := range []string{"cost", "spend", "anomaly", "saving", "rightsiz", "calc-cost", "forecast", "unallocated", "operating bill", "kubernetes", "capacity", "request-only"} {
		if strings.Contains(value, token) {
			return true
		}
	}
	return calcNumberPattern.MatchString(query)
}

func retrieveGroundedSources(query string, projectIDs map[int]struct{}) []groundedSource {
	query = strings.TrimSpace(query)
	if query == "" || DB == nil {
		return nil
	}
	wantCHG := map[int]struct{}{}
	for _, match := range chgNumberPattern.FindAllStringSubmatch(query, -1) {
		if id, err := strconv.Atoi(match[1]); err == nil && id > 0 {
			wantCHG[id] = struct{}{}
		}
	}
	wantINC := map[int]struct{}{}
	for _, match := range incNumberPattern.FindAllStringSubmatch(query, -1) {
		if id, err := strconv.Atoi(match[1]); err == nil && id > 0 {
			wantINC[id] = struct{}{}
		}
	}
	tokens := tokenizeQuery(query)
	out := []groundedSource{}
	if changes, err := listChangeRequests(0, "", "", ""); err == nil {
		for _, item := range changes {
			if len(projectIDs) > 0 && (item.ProjectID == nil || !containsProjectID(projectIDs, *item.ProjectID)) {
				continue
			}
			score := scoreGroundedFields(tokens, item.ChangeNumber, item.Title, item.Service, item.Repo, item.SHA, item.Summary)
			if _, ok := wantCHG[item.ID]; ok {
				score += 20
			}
			if score <= 0 {
				continue
			}
			out = append(out, groundedSource{
				Kind:        "change",
				ID:          item.ID,
				Number:      firstNonEmpty(item.ChangeNumber, formatChangeNumber(item.ID)),
				Title:       firstNonEmpty(item.Title, item.Repo),
				Href:        citationHRef("change", item.ID, item.ChangeNumber),
				Service:     item.Service,
				PreviousSHA: item.PreviousSHA,
				Body:        strings.TrimSpace(item.Summary + " " + item.RollbackHint + " " + item.Status),
				Score:       score,
			})
		}
	}
	if incidents, err := listRequestIncidents(""); err == nil {
		for _, item := range incidents {
			if len(projectIDs) > 0 && (item.ProjectID == nil || !containsProjectID(projectIDs, *item.ProjectID)) {
				continue
			}
			score := scoreGroundedFields(tokens, item.IncidentNumber, item.Summary, item.Service, item.RequestService, item.Notes)
			if _, ok := wantINC[item.ID]; ok {
				score += 20
			}
			if score <= 0 {
				continue
			}
			previous := ""
			if item.SuspectedChangeID != nil {
				if change, err := getChangeRequestByID(*item.SuspectedChangeID); err == nil && change != nil {
					previous = change.PreviousSHA
				}
			}
			out = append(out, groundedSource{
				Kind:        "incident",
				ID:          item.ID,
				Number:      firstNonEmpty(item.IncidentNumber, formatIncidentNumber(item.ID)),
				Title:       item.Summary,
				Href:        citationHRef("incident", item.ID, item.IncidentNumber),
				Service:     firstNonEmpty(item.Service, item.RequestService),
				PreviousSHA: previous,
				Body:        strings.TrimSpace(item.Notes + " " + item.RollbackHint),
				Score:       score,
			})
		}
	}
	if runbooks, err := listProjectRunbooks(0); err == nil {
		for _, item := range runbooks {
			if len(projectIDs) > 0 && !containsProjectID(projectIDs, item.ProjectID) {
				continue
			}
			score := scoreGroundedFields(tokens, item.Title, item.Service, item.Content)
			if score <= 0 {
				continue
			}
			out = append(out, groundedSource{
				Kind:    "runbook",
				ID:      item.ID,
				Number:  fmt.Sprintf("RB%d", item.ID),
				Title:   item.Title,
				Href:    citationHRef("runbook", item.ID, ""),
				Service: item.Service,
				Body:    item.Content,
				Score:   score,
			})
		}
	}
	sortGroundedSources(out)
	if len(out) > 6 {
		out = out[:6]
	}
	return out
}

func retrieveCostInsightSources(userID int, query string) []groundedSource {
	if userID <= 0 || !costQueryRelated(query) {
		return nil
	}
	insights, err := buildCostInsights(userID, "actual", "USD", "", "", costMetricsContext{})
	if err != nil || insights == nil {
		return nil
	}
	want := map[string]struct{}{}
	for _, match := range calcNumberPattern.FindAllString(query, -1) {
		want[strings.ToUpper(match)] = struct{}{}
	}
	tokens := tokenizeQuery(query)
	out := []groundedSource{}
	for _, item := range insights.Calculations {
		score := scoreGroundedFields(tokens, item.CalcID, item.Kind, item.ResourceID, item.Note, item.Amount)
		if _, ok := want[strings.ToUpper(item.CalcID)]; ok {
			score += 20
		}
		if score <= 0 && len(want) == 0 && costQueryRelated(query) {
			score = 1
		}
		if score <= 0 {
			continue
		}
		source := costAISafeSource(item)
		source.Score = score
		if costAISafeSourceLeaks(source) {
			continue
		}
		out = append(out, source)
	}
	sortGroundedSources(out)
	if len(out) > 6 {
		out = out[:6]
	}
	return out
}

func containsProjectID(ids map[int]struct{}, id int) bool {
	_, ok := ids[id]
	return ok
}

func tokenizeQuery(query string) []string {
	fields := strings.Fields(strings.ToLower(strings.ReplaceAll(query, "/", " ")))
	out := []string{}
	for _, field := range fields {
		field = strings.Trim(field, ".,?:;#")
		if len(field) < 3 || field == "the" || field == "and" || field == "for" {
			continue
		}
		out = append(out, field)
	}
	return out
}

func scoreGroundedFields(tokens []string, fields ...string) int {
	haystack := strings.ToLower(strings.Join(fields, " "))
	if haystack == "" {
		return 0
	}
	score := 0
	for _, token := range tokens {
		if strings.Contains(haystack, token) {
			score++
		}
	}
	return score
}

func sortGroundedSources(items []groundedSource) {
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].Score > items[i].Score {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
}

func buildGroundedAnswer(query string, sources []groundedSource) groundedAnswer {
	if queryAsksToApply(query) {
		return groundedAnswer{
			Reply:  "I will not apply Terraform, Helm, or cluster changes. Cite a Change or Incident and use the Rollback action, which records an emergency CHG and still respects freeze and gates.",
			Source: "grounded",
		}
	}
	if len(sources) == 0 {
		return groundedAnswer{
			Reply:  "I can only answer from a Change, Incident, runbook, or Cost calculation ID that already exists. Name a CHG, INC, CALC-COST, service, or SHA.",
			Source: "grounded",
		}
	}
	citations := make([]groundedCitation, 0, len(sources))
	var b strings.Builder
	b.WriteString("From the catalog:\n")
	var rollback *groundedRollbackHint
	for _, source := range sources {
		citations = append(citations, groundedCitation{
			Kind:    source.Kind,
			ID:      source.ID,
			Number:  source.Number,
			Title:   source.Title,
			Href:    source.Href,
			Service: source.Service,
		})
		detail := strings.TrimSpace(source.Body)
		if len(detail) > 180 {
			detail = detail[:180] + "…"
		}
		b.WriteString(fmt.Sprintf("- %s %s — %s", strings.ToUpper(source.Kind[:1])+source.Kind[1:], source.Number, source.Title))
		if detail != "" {
			b.WriteString(": " + detail)
		}
		b.WriteString("\n")
		if rollback == nil && strings.TrimSpace(source.PreviousSHA) != "" {
			rollback = &groundedRollbackHint{
				PreviousSHA: source.PreviousSHA,
				Allowed:     true,
				Reason:      "Linked change has a previous SHA. DevOps can record an emergency rollback CHG; this assistant will not apply it.",
			}
			if source.Kind == "change" {
				rollback.ChangeID = source.ID
				rollback.ChangeNumber = source.Number
			}
			if source.Kind == "incident" {
				rollback.IncidentID = source.ID
				rollback.IncidentNumber = source.Number
			}
		}
	}
	if rollback != nil {
		b.WriteString("\nSuggested recovery: roll back to " + rollback.PreviousSHA)
		if rollback.ChangeNumber != "" {
			b.WriteString(" from " + rollback.ChangeNumber)
		}
		b.WriteString(". I will not apply that revision.")
	}
	return groundedAnswer{Reply: strings.TrimSpace(b.String()), Citations: citations, Rollback: rollback, Source: "grounded"}
}

func answerGroundedCopilot(body copilotRequest, userID int, portal string) groundedAnswer {
	projectIDs := map[int]struct{}{}
	if strings.EqualFold(portal, "user") || strings.EqualFold(body.Portal, "user") {
		projectIDs = projectIDSet(visibleProjectIDsForUser(userID))
	}
	sources := retrieveGroundedSources(firstNonEmpty(body.Query, body.Title), projectIDs)
	sources = append(sources, retrieveCostInsightSources(userID, firstNonEmpty(body.Query, body.Title))...)
	sortGroundedSources(sources)
	if len(sources) > 8 {
		sources = sources[:8]
	}
	answer := buildGroundedAnswer(body.Query, sources)
	recordCostAIProof(userID, body)
	if len(answer.Citations) == 0 {
		return answer
	}
	if reply, ok := callCopilotModel(userID, copilotRequest{
		Query:  body.Query,
		Path:   body.Path,
		Title:  body.Title,
		Portal: body.Portal,
		Context: map[string]interface{}{
			"citations": answer.Citations,
			"rollback":  answer.Rollback,
			"catalog":   answer.Reply,
		},
	}); ok && !queryAsksToApply(body.Query) {
		if !replyCitesCatalog(reply, answer.Citations) {
			reply = reply + "\n\n" + answer.Reply
		}
		answer.Reply = reply
		answer.Source = "model+grounded"
	}
	return answer
}

func replyCitesCatalog(reply string, citations []groundedCitation) bool {
	for _, item := range citations {
		if item.Number != "" && strings.Contains(strings.ToUpper(reply), strings.ToUpper(item.Number)) {
			return true
		}
	}
	return false
}
