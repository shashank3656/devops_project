package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const recordDocumentMaxBytes = 15 << 20

var recordDocumentAllowedExt = map[string]bool{
	".csv":  true,
	".doc":  true,
	".docx": true,
	".gif":  true,
	".html": true,
	".jpeg": true,
	".jpg":  true,
	".json": true,
	".log":  true,
	".md":   true,
	".pdf":  true,
	".png":  true,
	".ppt":  true,
	".pptx": true,
	".txt":  true,
	".webp": true,
	".xls":  true,
	".xlsx": true,
	".xml":  true,
	".yaml": true,
	".yml":  true,
	".zip":  true,
}

type recordDocument struct {
	ID                 int       `json:"id"`
	RecordKind         string    `json:"record_kind"`
	RecordID           int       `json:"record_id"`
	OriginalName       string    `json:"original_name"`
	ContentType        string    `json:"content_type"`
	ByteSize           int64     `json:"byte_size"`
	UploadedBy         *int      `json:"uploaded_by,omitempty"`
	UploadedByUsername string    `json:"uploaded_by_username,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
	storageKey         string    `json:"-"`
}

func migrateRecordDocumentsSchema() {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(`
		CREATE TABLE IF NOT EXISTS record_documents (
			id SERIAL PRIMARY KEY,
			record_kind TEXT NOT NULL,
			record_id INTEGER NOT NULL,
			original_name TEXT NOT NULL,
			content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
			byte_size BIGINT NOT NULL DEFAULT 0,
			storage_key TEXT NOT NULL UNIQUE,
			uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_record_documents_record ON record_documents (record_kind, record_id)`)
}

func normalizeRecordDocumentKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "incident", "incidents":
		return "incident"
	case "change", "changes":
		return "change"
	case "problem", "problems":
		return "problem"
	default:
		return ""
	}
}

func sanitizeRecordDocumentName(name string) string {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	name = filepath.Base(name)
	var b strings.Builder
	for _, r := range name {
		if r < 32 || r == 127 || unicode.IsControl(r) {
			continue
		}
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			b.WriteByte('_')
		default:
			b.WriteRune(r)
		}
	}
	out := strings.Trim(strings.TrimSpace(b.String()), ".")
	if out == "" || out == "." || out == ".." {
		return "document"
	}
	if len(out) > 180 {
		ext := filepath.Ext(out)
		stem := strings.TrimSuffix(out, ext)
		limit := 180 - len(ext)
		if limit < 1 {
			limit = 1
		}
		if len(stem) > limit {
			stem = stem[:limit]
		}
		out = stem + ext
	}
	return out
}

func recordDocumentAllowed(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return recordDocumentAllowedExt[ext]
}

func recordDocumentStorageKey(kind string, recordID int, original string) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	parts := []string{}
	if prefix := strings.Trim(strings.TrimSpace(RecordDocsS3Prefix), "/"); prefix != "" {
		parts = append(parts, prefix)
	}
	parts = append(parts, kind, strconv.Itoa(recordID), hex.EncodeToString(buf)+"-"+sanitizeRecordDocumentName(original))
	return strings.Join(parts, "/"), nil
}

func recordDocsConfigured() bool {
	return strings.TrimSpace(RecordDocsS3Bucket) != ""
}

func recordDocsAWSConfig(ctx context.Context) (aws.Config, error) {
	if cfg, ok := awsBaseConfig(ctx); ok {
		return cfg, nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return aws.Config{}, err
	}
	return cfg, nil
}

func recordDocsS3Client(ctx context.Context) (*s3.Client, error) {
	if !recordDocsConfigured() {
		return nil, errors.New("document storage is not configured")
	}
	cfg, err := recordDocsAWSConfig(ctx)
	if err != nil {
		return nil, errors.New("document storage is not configured")
	}
	return s3.NewFromConfig(cfg), nil
}

func serveRecordDocuments(w http.ResponseWriter, r *http.Request, kind string, recordID, userID int, rest []string) {
	kind = normalizeRecordDocumentKind(kind)
	if kind == "" || recordID <= 0 {
		writeAPIError(w, r, http.StatusBadRequest, "invalid document record", nil)
		return
	}
	if DB == nil {
		writeAPIError(w, r, http.StatusServiceUnavailable, "database not available", nil)
		return
	}
	switch {
	case len(rest) == 0:
		switch r.Method {
		case http.MethodGet:
			list, err := listRecordDocuments(kind, recordID)
			if err != nil {
				writeAPIError(w, r, http.StatusInternalServerError, "failed to list documents", err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"documents": list, "status": "ok"})
		case http.MethodPost:
			item, err := uploadRecordDocument(r, kind, recordID, userID)
			if err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, errRecordDocsNotConfigured) {
					status = http.StatusServiceUnavailable
				}
				writeAPIError(w, r, status, err.Error(), nil)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"document": item, "status": "ok"})
		default:
			writeMethodNotAllowed(w, r)
		}
	case len(rest) == 1:
		docID, err := strconv.Atoi(rest[0])
		if err != nil || docID <= 0 {
			writeAPIError(w, r, http.StatusBadRequest, "invalid document id", err)
			return
		}
		item, err := getRecordDocument(kind, recordID, docID)
		if err != nil || item == nil {
			writeAPIError(w, r, http.StatusNotFound, "document not found", err)
			return
		}
		switch r.Method {
		case http.MethodGet:
			if err := streamRecordDocument(w, r, item); err != nil {
				writeAPIError(w, r, http.StatusBadGateway, "could not download the document", nil)
			}
		case http.MethodDelete:
			if err := deleteRecordDocument(item); err != nil {
				writeAPIError(w, r, http.StatusBadRequest, err.Error(), nil)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
		default:
			writeMethodNotAllowed(w, r)
		}
	default:
		writeAPIError(w, r, http.StatusNotFound, "document not found", nil)
	}
}

var errRecordDocsNotConfigured = errors.New("document storage is not configured")

func listRecordDocuments(kind string, recordID int) ([]recordDocument, error) {
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT d.id, d.record_kind, d.record_id, d.original_name, d.content_type, d.byte_size,
		       d.uploaded_by, COALESCE(u.username,''), d.created_at, d.storage_key
		FROM record_documents d
		LEFT JOIN users u ON u.id = d.uploaded_by
		WHERE d.record_kind = $1 AND d.record_id = $2
		ORDER BY d.id DESC
	`, kind, recordID)
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") {
			return []recordDocument{}, nil
		}
		return nil, err
	}
	defer cancel()
	defer rows.Close()
	out := []recordDocument{}
	for rows.Next() {
		item, err := scanRecordDocument(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func getRecordDocument(kind string, recordID, docID int) (*recordDocument, error) {
	row := queryRowContext(`
		SELECT d.id, d.record_kind, d.record_id, d.original_name, d.content_type, d.byte_size,
		       d.uploaded_by, COALESCE(u.username,''), d.created_at, d.storage_key
		FROM record_documents d
		LEFT JOIN users u ON u.id = d.uploaded_by
		WHERE d.record_kind = $1 AND d.record_id = $2 AND d.id = $3
	`, kind, recordID, docID)
	item, err := scanRecordDocument(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

type recordDocumentScanner interface {
	Scan(dest ...any) error
}

func scanRecordDocument(row recordDocumentScanner) (recordDocument, error) {
	var item recordDocument
	var uploadedBy sql.NullInt64
	if err := row.Scan(&item.ID, &item.RecordKind, &item.RecordID, &item.OriginalName, &item.ContentType, &item.ByteSize, &uploadedBy, &item.UploadedByUsername, &item.CreatedAt, &item.storageKey); err != nil {
		return recordDocument{}, err
	}
	if uploadedBy.Valid {
		value := int(uploadedBy.Int64)
		item.UploadedBy = &value
	}
	return item, nil
}

func uploadRecordDocument(r *http.Request, kind string, recordID, userID int) (*recordDocument, error) {
	if !recordDocsConfigured() {
		return nil, errRecordDocsNotConfigured
	}
	r.Body = http.MaxBytesReader(nil, r.Body, recordDocumentMaxBytes+1024)
	if err := r.ParseMultipartForm(recordDocumentMaxBytes); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, fmt.Errorf("file is larger than 15 MB")
		}
		return nil, fmt.Errorf("choose a file to upload")
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return nil, fmt.Errorf("choose a file to upload")
	}
	defer file.Close()
	name := sanitizeRecordDocumentName(header.Filename)
	if !recordDocumentAllowed(name) {
		return nil, fmt.Errorf("that file type is not allowed")
	}
	payload, err := io.ReadAll(io.LimitReader(file, recordDocumentMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("could not read the file")
	}
	if int64(len(payload)) > recordDocumentMaxBytes {
		return nil, fmt.Errorf("file is larger than 15 MB")
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("file is empty")
	}
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if contentType == "" || contentType == "application/octet-stream" {
		if detected := mime.TypeByExtension(strings.ToLower(filepath.Ext(name))); detected != "" {
			contentType = detected
		} else {
			contentType = "application/octet-stream"
		}
	}
	key, err := recordDocumentStorageKey(kind, recordID, name)
	if err != nil {
		return nil, fmt.Errorf("could not store the file")
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	client, err := recordDocsS3Client(ctx)
	if err != nil {
		return nil, errRecordDocsNotConfigured
	}
	if _, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(strings.TrimSpace(RecordDocsS3Bucket)),
		Key:         aws.String(key),
		Body:        bytes.NewReader(payload),
		ContentType: aws.String(contentType),
	}); err != nil {
		return nil, fmt.Errorf("could not store the file")
	}
	var uploadedBy any
	if userID > 0 {
		uploadedBy = userID
	}
	var item recordDocument
	var storedKey string
	var uploaded sql.NullInt64
	err = queryRowContext(`
		INSERT INTO record_documents (record_kind, record_id, original_name, content_type, byte_size, storage_key, uploaded_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, record_kind, record_id, original_name, content_type, byte_size, uploaded_by, created_at, storage_key
	`, kind, recordID, name, contentType, int64(len(payload)), key, uploadedBy).Scan(
		&item.ID, &item.RecordKind, &item.RecordID, &item.OriginalName, &item.ContentType, &item.ByteSize, &uploaded, &item.CreatedAt, &storedKey,
	)
	if err != nil {
		_, _ = client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(strings.TrimSpace(RecordDocsS3Bucket)),
			Key:    aws.String(key),
		})
		return nil, fmt.Errorf("could not save the document")
	}
	item.storageKey = storedKey
	if uploaded.Valid {
		value := int(uploaded.Int64)
		item.UploadedBy = &value
	}
	return &item, nil
}

func streamRecordDocument(w http.ResponseWriter, r *http.Request, item *recordDocument) error {
	if item == nil || strings.TrimSpace(item.storageKey) == "" {
		return errors.New("document not found")
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	client, err := recordDocsS3Client(ctx)
	if err != nil {
		return err
	}
	out, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(strings.TrimSpace(RecordDocsS3Bucket)),
		Key:    aws.String(item.storageKey),
	})
	if err != nil {
		return err
	}
	defer out.Body.Close()
	contentType := strings.TrimSpace(item.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, item.OriginalName))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if item.ByteSize > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(item.ByteSize, 10))
	}
	_, err = io.Copy(w, out.Body)
	return err
}

func deleteRecordDocument(item *recordDocument) error {
	if item == nil {
		return errors.New("document not found")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if client, err := recordDocsS3Client(ctx); err == nil && strings.TrimSpace(item.storageKey) != "" {
		_, _ = client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(strings.TrimSpace(RecordDocsS3Bucket)),
			Key:    aws.String(item.storageKey),
		})
	}
	_, err := execContext(`DELETE FROM record_documents WHERE id = $1 AND record_kind = $2 AND record_id = $3`, item.ID, item.RecordKind, item.RecordID)
	return err
}
