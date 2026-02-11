package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/lib/pq"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	dbQueryMaxRows   = 1000
	dbQueryTimeout   = 30 * time.Second
	dbQueryMaxLength = 10000
)

var dangerousSQL = regexp.MustCompile(`(?i)\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b`)

func isReadOnlyQuery(q string) bool {
	trimmed := strings.TrimSpace(q)
	if len(trimmed) == 0 {
		return false
	}
	if len(trimmed) > dbQueryMaxLength {
		return false
	}
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "SELECT") && !strings.HasPrefix(upper, "WITH") {
		return false
	}
	if dangerousSQL.MatchString(trimmed) {
		return false
	}
	return true
}

// executeSQLQuery runs SELECT on Postgres or MySQL, returns columns, rows, count, error
func executeSQLQuery(driver, dsn, query string) ([]string, []map[string]interface{}, int, error) {
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, nil, 0, err
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, nil, 0, err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, nil, 0, err
	}

	result := []map[string]interface{}{}
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}

	for rows.Next() {
		if len(result) >= dbQueryMaxRows {
			break
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			log.Printf("[db-query] scan error: %v", err)
			break
		}
		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			switch v := val.(type) {
			case []byte:
				row[col] = string(v)
			case nil:
				row[col] = nil
			default:
				row[col] = val
			}
		}
		result = append(result, row)
	}
	return columns, result, len(result), rows.Err()
}

// executeMongoQuery runs find with filter (query as JSON). Returns documents as rows
func executeMongoQuery(connectionString, database, collection, filterJSON string) ([]string, []map[string]interface{}, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(connectionString))
	if err != nil {
		return nil, nil, 0, err
	}
	defer func() { _ = client.Disconnect(ctx) }()

	var filter bson.M
	if filterJSON != "" {
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(filterJSON), &m); err != nil {
			return nil, nil, 0, fmt.Errorf("invalid filter JSON: %w", err)
		}
		filter = bson.M(m)
	} else {
		filter = bson.M{}
	}

	coll := client.Database(database).Collection(collection)
	opts := options.Find().SetLimit(int64(dbQueryMaxRows))
	cursor, err := coll.Find(ctx, filter, opts)
	if err != nil {
		return nil, nil, 0, err
	}
	defer cursor.Close(ctx)

	var docs []map[string]interface{}
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, nil, 0, err
	}

	// Flatten to rows with _id and other keys
	columns := []string{"_id"}
	seenCols := map[string]bool{"_id": true}
	for _, d := range docs {
		for k := range d {
			if !seenCols[k] {
				seenCols[k] = true
				columns = append(columns, k)
			}
		}
	}
	rows := make([]map[string]interface{}, len(docs))
	for i, d := range docs {
		rows[i] = d
	}
	return columns, rows, len(rows), nil
}
