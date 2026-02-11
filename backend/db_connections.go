package main

import (
	"database/sql"
	"fmt"
	"time"
)

type DBConnection struct {
	ID               int        `json:"id"`
	Name             string     `json:"name"`
	DBType           string     `json:"db_type"`
	Project          string     `json:"project"`
	Host             string     `json:"host"`
	Port             string     `json:"port"`
	Username         string     `json:"username"`
	Password         string     `json:"-"`
	Database         string     `json:"database"`
	SSLMode          string     `json:"ssl_mode"` // disable | required | require
	ConnectionString string     `json:"-"`        // legacy fallback when host empty
	MongoDatabase    string     `json:"mongo_database"`
	MongoCollection  string     `json:"mongo_collection"`
	CreatedBy        *int       `json:"created_by"`
	CreatedAt        time.Time  `json:"created_at"`
}

func ListDBConnections(projectFilter string) ([]DBConnection, error) {
	if DB == nil {
		return nil, nil
	}
	query := `SELECT id, name, db_type, project, COALESCE(mongo_database,''), COALESCE(mongo_collection,''), created_by, created_at FROM db_connections WHERE 1=1`
	args := []interface{}{}
	if projectFilter != "" {
		query += ` AND project = $1`
		args = append(args, projectFilter)
	}
	query += ` ORDER BY project, name`
	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DBConnection
	for rows.Next() {
		var c DBConnection
		if err := rows.Scan(&c.ID, &c.Name, &c.DBType, &c.Project, &c.MongoDatabase, &c.MongoCollection, &c.CreatedBy, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func ListDBProjects() ([]string, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`SELECT DISTINCT project FROM db_connections ORDER BY project`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func GetDBConnectionByID(id int) (*DBConnection, error) {
	if DB == nil {
		return nil, nil
	}
	var c DBConnection
	err := DB.QueryRow(`SELECT id, name, db_type, project, COALESCE(host,''), COALESCE(port,''), COALESCE(username,''), COALESCE(password,''), COALESCE(database, database_name, ''), COALESCE(ssl_mode,'disable'), COALESCE(connection_string,''), COALESCE(mongo_database,''), COALESCE(mongo_collection,''), created_by, created_at FROM db_connections WHERE id = $1`, id).
		Scan(&c.ID, &c.Name, &c.DBType, &c.Project, &c.Host, &c.Port, &c.Username, &c.Password, &c.Database, &c.SSLMode, &c.ConnectionString, &c.MongoDatabase, &c.MongoCollection, &c.CreatedBy, &c.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func CreateDBConnection(c *DBConnection) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	// name, alias, project are optional, used only for display/tracking
	displayName := c.Name
	if displayName == "" {
		displayName = "Connection"
	}
	return DB.QueryRow(`INSERT INTO db_connections (name, alias, db_type, project, host, port, username, password, database, database_name, ssl_mode, mongo_database, mongo_collection, created_by)
		VALUES ($1, $2, $3, COALESCE(NULLIF(TRIM($4),''), 'default'), $5, $6, $7, $8, $9, $9, $10, $11, $12, $13) RETURNING id, created_at`,
		displayName, displayName, c.DBType, c.Project, c.Host, c.Port, c.Username, c.Password, c.Database, c.SSLMode, c.MongoDatabase, c.MongoCollection, c.CreatedBy).
		Scan(&c.ID, &c.CreatedAt)
}

func UpdateDBConnection(c *DBConnection) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	displayName := c.Name
	if displayName == "" {
		displayName = "Connection"
	}
	_, err := DB.Exec(`UPDATE db_connections SET name=$1, alias=$2, db_type=$3, project=$4, host=$5, port=$6, username=$7, password=$8, database=$9, database_name=$9, ssl_mode=$10, mongo_database=$11, mongo_collection=$12 WHERE id=$13`,
		displayName, displayName, c.DBType, c.Project, c.Host, c.Port, c.Username, c.Password, c.Database, c.SSLMode, c.MongoDatabase, c.MongoCollection, c.ID)
	return err
}

func DeleteDBConnection(id int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	_, err := DB.Exec(`DELETE FROM db_connections WHERE id = $1`, id)
	return err
}
