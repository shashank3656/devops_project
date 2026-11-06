package main

import (
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const jiraAttachMaxBytes = 10 << 20

var jiraAttachAllowedExt = map[string]bool{
	".csv":  true,
	".gif":  true,
	".jpeg": true,
	".jpg":  true,
	".json": true,
	".md":   true,
	".pdf":  true,
	".png":  true,
	".txt":  true,
	".webp": true,
	".xml":  true,
	".yaml": true,
	".yml":  true,
}

func jiraAttachHandler(w http.ResponseWriter, r *http.Request, userID int) {
	if err := r.ParseMultipartForm(jiraAttachMaxBytes + 1<<20); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "file is too large or missing", err)
		return
	}
	cloudID := strings.TrimSpace(r.FormValue("cloud_id"))
	issueID := strings.TrimSpace(r.FormValue("issue_id"))
	if cloudID == "" || issueID == "" {
		writeAPIError(w, r, http.StatusBadRequest, "cloud_id and issue_id are required", nil)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "a file is required", err)
		return
	}
	defer file.Close()
	if header.Size > jiraAttachMaxBytes {
		writeAPIError(w, r, http.StatusBadRequest, "attachments are limited to 10 MB", nil)
		return
	}
	name := filepath.Base(header.Filename)
	if errMsg := jiraAttachmentRejected(name); errMsg != "" {
		writeAPIError(w, r, http.StatusBadRequest, errMsg, nil)
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, jiraAttachMaxBytes+1))
	if err != nil || int64(len(data)) > jiraAttachMaxBytes {
		writeAPIError(w, r, http.StatusBadRequest, "attachments are limited to 10 MB", err)
		return
	}
	sample := data
	if len(sample) > 8000 {
		sample = sample[:8000]
	}
	if utf8.Valid(data) && jiraSanitizeCreateText(string(sample)) == "" && len(bytesTrim(data)) > 0 {
		writeAPIError(w, r, http.StatusBadRequest, "that file looks like it contains a secret and was not sent to Jira", nil)
		return
	}
	space, err := findJiraSpaceForIssue(cloudID, issueID)
	if err != nil {
		writeAPIError(w, r, http.StatusNotFound, "linked issue not found", err)
		return
	}
	access, _ := jiraAccessForSpace(userID, space.ID)
	if !access.CanCreate && !access.CanLink {
		writeAPIError(w, r, http.StatusForbidden, "you cannot attach files to this Jira issue", nil)
		return
	}
	if err := jiraWriteAllowed(space.ConnectionID, "attach"); err != nil {
		writeAPIError(w, r, http.StatusForbidden, err.Error(), err)
		return
	}
	token, err := jiraValidAccessToken(space.ConnectionID)
	if err != nil {
		writeAPIError(w, r, http.StatusConflict, err.Error(), err)
		return
	}
	id, err := jiraAPI.AddAttachment(token, cloudID, issueID, name, data)
	if err != nil {
		writeAPIError(w, r, http.StatusBadGateway, err.Error(), err)
		return
	}
	insertJiraAudit(space.ConnectionID, userID, "attach", "", 0, cloudID, issueID, "ok", name)
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status":        "ok",
		"attachment_id": id,
		"filename":      name,
		"note":          "The file was sent to Jira and was not stored in OpsTrellis.",
	})
}

func jiraAttachmentRejected(filename string) string {
	name := strings.ToLower(strings.TrimSpace(filename))
	if name == "" || strings.Contains(name, "..") {
		return "file name is not allowed"
	}
	ext := strings.ToLower(filepath.Ext(name))
	if !jiraAttachAllowedExt[ext] {
		return "that file type is not allowed"
	}
	blocked := []string{"password", "secret", "token", "credential", ".log"}
	for _, needle := range blocked {
		if strings.Contains(name, needle) {
			return "logs and credential files are not sent to Jira"
		}
	}
	return ""
}

func bytesTrim(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}
