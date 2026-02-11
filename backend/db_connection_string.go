package main

import (
	"fmt"
	"net/url"
)

// GetDSN returns the connection string for this DB. Uses separate fields when host is set; otherwise legacy connection_string.
func (c *DBConnection) GetDSN() string {
	if c.Host != "" {
		return c.BuildConnectionString()
	}
	return c.ConnectionString
}

// BuildConnectionString builds the DSN for the given db_type from separate fields (host, port, username, password, database, ssl_mode)
func (c *DBConnection) BuildConnectionString() string {
	switch c.DBType {
	case "postgres", "postgresql":
		return buildPostgresDSN(c)
	case "mysql":
		return buildMySQLDSN(c)
	case "mongodb":
		return buildMongoDSN(c)
	default:
		return c.ConnectionString
	}
}

func buildPostgresDSN(c *DBConnection) string {
	ssl := "disable"
	if c.SSLMode == "required" || c.SSLMode == "require" {
		ssl = "require"
	}
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.Username, c.Password, c.Database, ssl)
}

func buildMySQLDSN(c *DBConnection) string {
	tls := ""
	if c.SSLMode == "required" || c.SSLMode == "require" {
		tls = "&tls=true"
	}
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true%s",
		c.Username, c.Password, c.Host, c.Port, c.Database, tls)
}

func buildMongoDSN(c *DBConnection) string {
	auth := ""
	if c.Username != "" || c.Password != "" {
		auth = url.QueryEscape(c.Username) + ":" + url.QueryEscape(c.Password) + "@"
	}
	db := c.Database
	if db == "" {
		db = c.MongoDatabase
	}
	base := fmt.Sprintf("mongodb://%s%s:%s/%s", auth, c.Host, c.Port, db)
	if c.SSLMode == "required" || c.SSLMode == "require" {
		base += "?ssl=true"
	}
	return base
}
