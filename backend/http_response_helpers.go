package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

func writeJSONResponse(w http.ResponseWriter, status int, payload interface{}) error {
	if status <= 0 {
		status = http.StatusOK
	}
	if contentType := strings.TrimSpace(w.Header().Get("Content-Type")); contentType == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(payload)
}

func writeAPIError(w http.ResponseWriter, r *http.Request, status int, message string, cause error) {
	msg := strings.TrimSpace(message)
	if msg == "" {
		msg = strings.TrimSpace(http.StatusText(status))
	}
	if msg == "" {
		msg = "request failed"
	}

	requestID := ""
	traceID := ""
	spanID := ""
	if r != nil {
		ctx := r.Context()
		requestID = requestIDFromContext(ctx)
		traceID, spanID = traceAndSpanIDs(ctx)
	}

	payload := map[string]interface{}{
		"status":     "error",
		"error":      msg,
		"request_id": requestID,
	}
	if traceID != "" {
		payload["trace_id"] = traceID
	}
	if spanID != "" {
		payload["span_id"] = spanID
	}
	if cause != nil {
		payload["cause"] = cause.Error()
	}

	if err := writeJSONResponse(w, status, payload); err != nil {
		log.Printf(
			"[HTTP] error_response_write_failed status=%d request_id=%s trace_id=%s span_id=%s msg=%q write_err=%v",
			status,
			requestID,
			traceID,
			spanID,
			msg,
			err,
		)
		return
	}

	if cause != nil {
		log.Printf(
			"[HTTP] status=%d request_id=%s trace_id=%s span_id=%s msg=%q cause=%v",
			status,
			requestID,
			traceID,
			spanID,
			msg,
			cause,
		)
		return
	}
	log.Printf(
		"[HTTP] status=%d request_id=%s trace_id=%s span_id=%s msg=%q",
		status,
		requestID,
		traceID,
		spanID,
		msg,
	)
}

func writeMethodNotAllowed(w http.ResponseWriter, r *http.Request, allowed ...string) {
	if len(allowed) > 0 {
		w.Header().Set("Allow", strings.Join(allowed, ", "))
	}
	method := ""
	if r != nil {
		method = r.Method
	}
	writeAPIError(
		w,
		r,
		http.StatusMethodNotAllowed,
		fmt.Sprintf("method %q not allowed", method),
		nil,
	)
}

func encodeJSON(w http.ResponseWriter, payload interface{}) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("response encode failed: %v", err)
	}
}
