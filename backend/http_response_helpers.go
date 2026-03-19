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
	setSafeJSONResponseHeaders(w.Header())
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(payload)
}

func writeAPIError(w http.ResponseWriter, r *http.Request, status int, message string, cause error) {
	msg := sanitizeAPIErrorMessage(message)
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
		payload["cause"] = sanitizeAPIErrorMessage(cause.Error())
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

func setSafeJSONResponseHeaders(header http.Header) {
	if header == nil {
		return
	}
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("X-Content-Type-Options", "nosniff")
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
