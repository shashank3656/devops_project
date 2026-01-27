package main

import (
	"database/sql"
	"fmt"
	"log"
)

// MigrateDatabase updates the database schema to allow NULL for created_by
// This should be run once to update existing databases
func MigrateDatabase() error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}

	// Check if the column already allows NULL
	var isNullable string
	err := DB.QueryRow(`
		SELECT is_nullable 
		FROM information_schema.columns 
		WHERE table_name = 'pr_requests' 
		AND column_name = 'created_by'
	`).Scan(&isNullable)

	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("failed to check column: %w", err)
	}

	// If column doesn't allow NULL, update it
	if isNullable == "NO" {
		log.Println("Migrating database: allowing NULL for created_by column...")
		
		// Drop the foreign key constraint first
		_, err = DB.Exec(`ALTER TABLE pr_requests DROP CONSTRAINT IF EXISTS pr_requests_created_by_fkey`)
		if err != nil {
			log.Printf("Warning: failed to drop constraint (may not exist): %v", err)
		}

		// Make column nullable
		_, err = DB.Exec(`ALTER TABLE pr_requests ALTER COLUMN created_by DROP NOT NULL`)
		if err != nil {
			return fmt.Errorf("failed to make column nullable: %w", err)
		}

		// Re-add foreign key with ON DELETE SET NULL
		_, err = DB.Exec(`
			ALTER TABLE pr_requests 
			ADD CONSTRAINT pr_requests_created_by_fkey 
			FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
		`)
		if err != nil {
			return fmt.Errorf("failed to add foreign key: %w", err)
		}

		log.Println("Database migration completed successfully")
	} else {
		log.Println("Database schema is already up to date")
	}

	return nil
}
