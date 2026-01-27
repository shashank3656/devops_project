package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type InfraRequest map[string]interface{}

func createPRHandler(w http.ResponseWriter, r *http.Request) {
	var payload InfraRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	team := payload["team"].(string)
	env := payload["env"].(string)
	cloud := payload["cloud"].(string)
	service := payload["service"].(string)

	filePath := fmt.Sprintf(
		"configs/%s/%s/%s-%s.json",
		team, env, cloud, service,
	)

	content, _ := json.MarshalIndent(payload, "", "  ")

	prURL, err := CreateGitHubPR(filePath, content)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"pr_url": prURL,
	})
}

func main() {
	http.HandleFunc("/create-pr", createPRHandler)
	fmt.Println("Backend running on :8080")
	http.ListenAndServe(":8080", nil)
}
