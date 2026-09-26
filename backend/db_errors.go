package main

import (
	"errors"
	"strings"

	"github.com/lib/pq"
)

func isMissingDatabaseRelation(err error, relation string) bool {
	if err == nil {
		return false
	}
	relation = strings.ToLower(strings.TrimSpace(relation))
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && string(pqErr.Code) == "42P01" {
		return relation == "" || strings.Contains(strings.ToLower(pqErr.Message), relation)
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "does not exist") && (relation == "" || strings.Contains(msg, relation))
}
