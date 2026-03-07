package main

import (
	"encoding/json"
	"log"
	"net/http"
)

func swaggerHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	w.Header().Set("Content-Type", "application/json")

	// OpenAPI 3.0 specification
	swaggerSpec := map[string]interface{}{
		"openapi": "3.0.0",
		"info": map[string]interface{}{
			"title":       "Infrastructure Portal API",
			"version":     "1.0.0",
			"description": "API for managing cloud infrastructure requests via GitHub PRs",
		},
		"servers": []map[string]interface{}{
			{
				"url":         "http://localhost:8080",
				"description": "Local development server",
			},
		},
		"paths": map[string]interface{}{
			"/create-pr": map[string]interface{}{
				"post": map[string]interface{}{
					"summary":     "Create infrastructure PR",
					"description": "Creates a GitHub PR with infrastructure configuration",
					"requestBody": map[string]interface{}{
						"required": true,
						"content": map[string]interface{}{
							"application/json": map[string]interface{}{
								"schema": map[string]interface{}{
									"type":     "object",
									"required": []string{"team", "env", "cloud", "service"},
									"properties": map[string]interface{}{
										"team":    map[string]interface{}{"type": "string"},
										"env":     map[string]interface{}{"type": "string"},
										"cloud":   map[string]interface{}{"type": "string"},
										"service": map[string]interface{}{"type": "string"},
									},
								},
							},
						},
					},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "PR created successfully",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"type": "object",
										"properties": map[string]interface{}{
											"pr_url": map[string]interface{}{"type": "string"},
											"status": map[string]interface{}{"type": "string"},
											"branch": map[string]interface{}{"type": "string"},
										},
									},
								},
							},
						},
					},
				},
			},
			"/api/history": map[string]interface{}{
				"get": map[string]interface{}{
					"summary":     "Get PR request history",
					"description": "Retrieves a list of previous PR requests",
					"parameters": []map[string]interface{}{
						{
							"name":        "team",
							"in":          "query",
							"description": "Filter by team",
							"required":    false,
							"schema":      map[string]interface{}{"type": "string"},
						},
						{
							"name":        "env",
							"in":          "query",
							"description": "Filter by environment",
							"required":    false,
							"schema":      map[string]interface{}{"type": "string"},
						},
						{
							"name":        "limit",
							"in":          "query",
							"description": "Number of results to return",
							"required":    false,
							"schema":      map[string]interface{}{"type": "integer", "default": 50},
						},
						{
							"name":        "offset",
							"in":          "query",
							"description": "Number of results to skip",
							"required":    false,
							"schema":      map[string]interface{}{"type": "integer", "default": 0},
						},
					},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "List of PR requests",
						},
					},
				},
			},
			"/api/auth/signup": map[string]interface{}{
				"post": map[string]interface{}{
					"summary":     "User signup",
					"description": "Create a new user account",
					"requestBody": map[string]interface{}{
						"required": true,
						"content": map[string]interface{}{
							"application/json": map[string]interface{}{
								"schema": map[string]interface{}{
									"type":     "object",
									"required": []string{"username", "email", "password"},
									"properties": map[string]interface{}{
										"username": map[string]interface{}{"type": "string"},
										"email":    map[string]interface{}{"type": "string"},
										"password": map[string]interface{}{"type": "string"},
									},
								},
							},
						},
					},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "User created successfully",
						},
					},
				},
			},
			"/api/auth/login": map[string]interface{}{
				"post": map[string]interface{}{
					"summary":     "User login",
					"description": "Authenticate user and get token",
					"requestBody": map[string]interface{}{
						"required": true,
						"content": map[string]interface{}{
							"application/json": map[string]interface{}{
								"schema": map[string]interface{}{
									"type":     "object",
									"required": []string{"username", "password"},
									"properties": map[string]interface{}{
										"username": map[string]interface{}{"type": "string"},
										"password": map[string]interface{}{"type": "string"},
									},
								},
							},
						},
					},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "Login successful",
						},
					},
				},
			},
		},
	}

	if err := json.NewEncoder(w).Encode(swaggerSpec); err != nil {
		log.Printf("swagger spec response encode failed: %v", err)
	}
}

func swaggerUIHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	w.Header().Set("Content-Type", "text/html")

	// Simple Swagger UI HTML
	html := `<!DOCTYPE html>
<html>
<head>
    <title>Infrastructure Portal API - Swagger UI</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui.css" />
    <style>
        html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
        *, *:before, *:after { box-sizing: inherit; }
        body { margin:0; background: #fafafa; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const ui = SwaggerUIBundle({
                url: "/swagger.json",
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout"
            });
        };
    </script>
</body>
</html>`

	if _, err := w.Write([]byte(html)); err != nil {
		log.Printf("swagger ui response write failed: %v", err)
	}
}
