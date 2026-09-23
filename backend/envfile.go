package main

import (
	"bufio"
	"log"
	"os"
	"strings"
)

func loadBackendEnvFiles() {
	preexisting := map[string]struct{}{}
	for _, entry := range os.Environ() {
		key, _, found := strings.Cut(entry, "=")
		if found && key != "" {
			preexisting[key] = struct{}{}
		}
	}

	files := []string{
		"/app/config/.env",
		"config/.env",
		"../config/.env",
		".env",
	}
	seen := map[string]struct{}{}
	for _, path := range files {
		if _, already := seen[path]; already {
			continue
		}
		seen[path] = struct{}{}
		applied, err := applyEnvFile(path, preexisting)
		if err != nil {
			if !os.IsNotExist(err) {
				log.Printf("Warning: could not read env file %s: %v", path, err)
			}
			continue
		}
		if applied > 0 {
			log.Printf("Loaded %d env values from %s", applied, path)
		}
	}
}

func applyEnvFile(path string, preexisting map[string]struct{}) (int, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer func() { _ = file.Close() }()

	applied := 0
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, exists := preexisting[key]; exists {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`)) ||
				(strings.HasPrefix(value, `'`) && strings.HasSuffix(value, `'`)) {
				value = value[1 : len(value)-1]
			}
		}
		if err := os.Setenv(key, value); err != nil {
			return applied, err
		}
		applied++
	}
	return applied, scanner.Err()
}
