package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// SupabaseStorageConfig holds credentials and routing information for the
// S3-compatible Supabase Storage endpoint. Values are sourced from environment
// variables so they stay out of source control.
type SupabaseStorageConfig struct {
	Endpoint        string // e.g. https://<ref>.storage.supabase.co/storage/v1/s3
	Region          string // e.g. ap-south-1
	Bucket          string // e.g. architecture-diagrams
	AccessKeyID     string
	SecretAccessKey string
	PublicURLBase   string // e.g. https://<ref>.supabase.co/storage/v1/object/public (bucket is appended)
}

var (
	supabaseStorageConfig = SupabaseStorageConfig{
		Endpoint:        strings.TrimRight(getEnv("SUPABASE_STORAGE_ENDPOINT", "https://jkvrxhwoxtrkzvzogixi.storage.supabase.co/storage/v1/s3"), "/"),
		Region:          getEnv("SUPABASE_STORAGE_REGION", "ap-south-1"),
		Bucket:          getEnv("SUPABASE_STORAGE_BUCKET", "architecture-diagrams"),
		AccessKeyID:     getEnv("SUPABASE_STORAGE_ACCESS_KEY_ID", ""),
		SecretAccessKey: getEnv("SUPABASE_STORAGE_SECRET_ACCESS_KEY", ""),
		PublicURLBase:   strings.TrimRight(getEnv("SUPABASE_STORAGE_PUBLIC_URL_BASE", ""), "/"),
	}
)

// supabaseStorageConfigured returns true when access keys are present so callers
// can skip uploads gracefully during local development without credentials.
func supabaseStorageConfigured() bool {
	cfg := supabaseStorageConfig
	return cfg.Endpoint != "" && cfg.Region != "" && cfg.Bucket != "" && cfg.AccessKeyID != "" && cfg.SecretAccessKey != ""
}

// publicStorageURL derives a browser-facing URL for the uploaded object when the
// bucket is public. If PublicURLBase is unset we derive it from the S3 endpoint
// by swapping ".storage.supabase.co/storage/v1/s3" -> ".supabase.co/storage/v1/object/public".
func publicStorageURL(objectKey string) string {
	cfg := supabaseStorageConfig
	base := cfg.PublicURLBase
	if base == "" {
		host := cfg.Endpoint
		host = strings.Replace(host, ".storage.supabase.co/storage/v1/s3", ".supabase.co/storage/v1/object/public", 1)
		base = host
	}
	return fmt.Sprintf("%s/%s/%s", strings.TrimRight(base, "/"), cfg.Bucket, objectKey)
}

// newObjectKey returns a path-like key scoped by env/project plus a random suffix.
func newObjectKey(projectName, environment, filename string) string {
	project := slugForObjectKey(projectName)
	env := slugForObjectKey(environment)
	randHex := make([]byte, 8)
	_, _ = rand.Read(randHex)
	suffix := hex.EncodeToString(randHex)
	clean := slugForObjectKey(filename)
	if clean == "" {
		clean = "diagram"
	}
	ts := time.Now().UTC().Format("20060102T150405Z")
	return fmt.Sprintf("%s/%s/%s/%s-%s", project, env, ts, suffix, clean)
}

func slugForObjectKey(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == '-' || r == '_':
			b.WriteRune(r)
		case r == ' ' || r == '/' || r == '\\':
			b.WriteByte('-')
		}
	}
	slug := strings.Trim(b.String(), "-")
	if len(slug) > 120 {
		slug = slug[:120]
	}
	return strings.ToLower(slug)
}

// UploadDiagramToSupabase pushes the given payload to Supabase Storage. It returns
// the object key stored in the bucket and a best-effort public URL.
func UploadDiagramToSupabase(ctx context.Context, projectName, environment, filename, contentType string, payload []byte) (objectKey string, publicURL string, err error) {
	if !supabaseStorageConfigured() {
		return "", "", errors.New("supabase storage not configured (set SUPABASE_STORAGE_ACCESS_KEY_ID and SUPABASE_STORAGE_SECRET_ACCESS_KEY)")
	}
	if len(payload) == 0 {
		return "", "", errors.New("empty payload")
	}
	cfg := supabaseStorageConfig
	objectKey = newObjectKey(projectName, environment, filename)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	fullURL := fmt.Sprintf("%s/%s/%s", cfg.Endpoint, cfg.Bucket, objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, fullURL, bytes.NewReader(payload))
	if err != nil {
		return "", "", fmt.Errorf("build put request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(payload))

	if err := signS3Request(req, payload, cfg); err != nil {
		return "", "", fmt.Errorf("sign put request: %w", err)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("upload to supabase storage: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return objectKey, publicStorageURL(objectKey), nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return "", "", fmt.Errorf("supabase storage upload failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

// DownloadDiagramFromSupabase streams a stored object back to the caller.
// The caller must close the returned ReadCloser.
func DownloadDiagramFromSupabase(ctx context.Context, objectKey string) (io.ReadCloser, string, int64, error) {
	if !supabaseStorageConfigured() {
		return nil, "", 0, errors.New("supabase storage not configured")
	}
	cfg := supabaseStorageConfig
	fullURL := fmt.Sprintf("%s/%s/%s", cfg.Endpoint, cfg.Bucket, objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, "", 0, err
	}
	if err := signS3Request(req, nil, cfg); err != nil {
		return nil, "", 0, err
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", 0, err
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp.Body, resp.Header.Get("Content-Type"), resp.ContentLength, nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	resp.Body.Close()
	return nil, "", 0, fmt.Errorf("supabase storage download failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

// DeleteDiagramFromSupabase removes a previously stored object.
func DeleteDiagramFromSupabase(ctx context.Context, objectKey string) error {
	if !supabaseStorageConfigured() {
		return nil
	}
	cfg := supabaseStorageConfig
	fullURL := fmt.Sprintf("%s/%s/%s", cfg.Endpoint, cfg.Bucket, objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, fullURL, nil)
	if err != nil {
		return err
	}
	if err := signS3Request(req, nil, cfg); err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	return fmt.Errorf("supabase storage delete failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

// ---- AWS SigV4 inline signer for S3 path-style requests ----

func signS3Request(req *http.Request, body []byte, cfg SupabaseStorageConfig) error {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	payloadHash := sha256Hex(body)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)

	canonicalURI := canonicalURIPath(req.URL.Path)
	canonicalQuery := canonicalQueryString(req.URL.Query())

	// Build canonical headers (host + x-amz-* always; content-type when present).
	host := req.URL.Host
	headerMap := map[string]string{
		"host":                 host,
		"x-amz-date":           amzDate,
		"x-amz-content-sha256": payloadHash,
	}
	if ct := strings.TrimSpace(req.Header.Get("Content-Type")); ct != "" {
		headerMap["content-type"] = ct
	}
	names := make([]string, 0, len(headerMap))
	for k := range headerMap {
		names = append(names, k)
	}
	sort.Strings(names)
	var canonHeaders strings.Builder
	for _, name := range names {
		canonHeaders.WriteString(name)
		canonHeaders.WriteByte(':')
		canonHeaders.WriteString(headerMap[name])
		canonHeaders.WriteByte('\n')
	}
	signedHeadersList := strings.Join(names, ";")

	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI,
		canonicalQuery,
		canonHeaders.String(),
		signedHeadersList,
		payloadHash,
	}, "\n")

	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, cfg.Region)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	kDate := hmacSHA256([]byte("AWS4"+cfg.SecretAccessKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(cfg.Region))
	kService := hmacSHA256(kRegion, []byte("s3"))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	signature := hex.EncodeToString(hmacSHA256(kSigning, []byte(stringToSign)))

	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		cfg.AccessKeyID, credentialScope, signedHeadersList, signature)
	req.Header.Set("Authorization", auth)
	return nil
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

// canonicalURIPath encodes each path segment per RFC3986 (keeping '/').
// Go's url.PathEscape handles segment encoding but treats '/' as unsafe, so we
// split on '/' and rejoin.
func canonicalURIPath(p string) string {
	if p == "" {
		return "/"
	}
	parts := strings.Split(p, "/")
	for i, s := range parts {
		parts[i] = awsURIEncode(s, false)
	}
	return strings.Join(parts, "/")
}

func canonicalQueryString(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		vals := values[k]
		sort.Strings(vals)
		for j, v := range vals {
			if i > 0 || j > 0 {
				b.WriteByte('&')
			}
			b.WriteString(awsURIEncode(k, true))
			b.WriteByte('=')
			b.WriteString(awsURIEncode(v, true))
		}
	}
	return b.String()
}

// awsURIEncode replicates the AWS-flavored URI encoding used in canonical
// requests. When encodeSlash is false, '/' is passed through unchanged.
func awsURIEncode(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		case c == '/' && !encodeSlash:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
