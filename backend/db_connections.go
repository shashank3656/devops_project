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
	ConnectionString string     `json:"-"` // never expose
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
	err := DB.QueryRow(`SELECT id, name, db_type, project, connection_string, COALESCE(mongo_database,''), COALESCE(mongo_collection,''), created_by, created_at FROM db_connections WHERE id = $1`, id).
		Scan(&c.ID, &c.Name, &c.DBType, &c.Project, &c.ConnectionString, &c.MongoDatabase, &c.MongoCollection, &c.CreatedBy, &c.CreatedAt)
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
	return DB.QueryRow(`INSERT INTO db_connections (name, db_type, project, connection_string, mongo_database, mongo_collection, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
		c.Name, c.DBType, c.Project, c.ConnectionString, c.MongoDatabase, c.MongoCollection, c.CreatedBy).
		Scan(&c.ID, &c.CreatedAt)
}

func UpdateDBConnection(c *DBConnection) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	_, err := DB.Exec(`UPDATE db_connections SET name=$1, db_type=$2, project=$3, connection_string=$4, mongo_database=$5, mongo_collection=$6 WHERE id=$7`,
		c.Name, c.DBType, c.Project, c.ConnectionString, c.MongoDatabase, c.MongoCollection, c.ID)
	return err
}

func DeleteDBConnection(id int) error {
	if DB == nil {
		return fmt.Errorf("database not available")
	}
	_, err := DB.Exec(`DELETE FROM db_connections WHERE id = $1`, id)
	return err
}
