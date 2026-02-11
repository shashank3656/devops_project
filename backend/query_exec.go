package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

func rowsToJSON(rows *sql.Rows) (string, error) {
	cols, err := rows.Columns()
	if err != nil {
		return "", err
	}
	var result []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		valPtrs := make([]interface{}, len(cols))
		for i := range vals {
			valPtrs[i] = &vals[i]
		}
		if err := rows.Scan(valPtrs...); err != nil {
			return "", err
		}
		row := make(map[string]interface{})
		for i, col := range cols {
			v := vals[i]
			if v == nil {
				row[col] = nil
				continue
			}
			switch t := v.(type) {
			case []byte:
				row[col] = string(t)
			case time.Time:
				row[col] = t.Format(time.RFC3339)
			default:
				row[col] = v
			}
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	b, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func executePostgresQuery(ctx context.Context, dsn string, query string) (string, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return "", err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	return rowsToJSON(rows)
}

func executeMySQLQuery(ctx context.Context, dsn string, query string) (string, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return "", err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	return rowsToJSON(rows)
}

func executeMongoQuery(ctx context.Context, dsn string, query string) (string, error) {
	// MongoDB requires different query format (JSON) and driver. Stub for now.
	return "", fmt.Errorf("MongoDB query execution not yet implemented; use Postgres or MySQL")
}
