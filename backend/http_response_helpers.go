package main

import (
	"encoding/json"
	"log"
	"net/http"
)

func encodeJSON(w http.ResponseWriter, payload interface{}) {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("response encode failed: %v", err)
	}
}
