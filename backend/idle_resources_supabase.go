package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

// supabaseStorageConfig is loaded lazily so the server can boot when the user
// hasn't filled the credentials in yet — only callers that hit the upload path
// will see the validation error.
type supabaseStorageConfig struct {
	Endpoint  string
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
}

func loadSupabaseStorageConfig() (supabaseStorageConfig, error) {
	cfg := supabaseStorageConfig{
		Endpoint:  strings.TrimRight(os.Getenv("SUPABASE_STORAGE_ENDPOINT"), "/"),
		Region:    os.Getenv("SUPABASE_STORAGE_REGION"),
		Bucket:    os.Getenv("SUPABASE_STORAGE_BUCKET"),
		AccessKey: os.Getenv("SUPABASE_STORAGE_ACCESS_KEY_ID"),
		SecretKey: os.Getenv("SUPABASE_STORAGE_SECRET_ACCESS_KEY"),
	}
	missing := []string{}
	if cfg.Endpoint == "" {
		missing = append(missing, "SUPABASE_STORAGE_ENDPOINT")
	}
	if cfg.Region == "" {
		missing = append(missing, "SUPABASE_STORAGE_REGION")
	}
	if cfg.Bucket == "" {
		missing = append(missing, "SUPABASE_STORAGE_BUCKET")
	}
	if cfg.AccessKey == "" {
		missing = append(missing, "SUPABASE_STORAGE_ACCESS_KEY_ID")
	}
	if cfg.SecretKey == "" {
		missing = append(missing, "SUPABASE_STORAGE_SECRET_ACCESS_KEY")
	}
	if len(missing) > 0 {
		return cfg, fmt.Errorf("supabase storage missing env: %s", strings.Join(missing, ", "))
	}
	return cfg, nil
}

// supabaseStorageUpload PUTs an object using AWS SigV4 (S3-compatible).
// Returns the public-style URL Supabase exposes for retrieval.
func supabaseStorageUpload(objectKey, contentType string, body []byte) (string, error) {
	cfg, err := loadSupabaseStorageConfig()
	if err != nil {
		return "", err
	}
	endpointURL, err := url.Parse(cfg.Endpoint)
	if err != nil {
		return "", err
	}
	canonicalURI := "/" + cfg.Bucket + "/" + strings.TrimPrefix(objectKey, "/")
	full := *endpointURL
	full.Path = strings.TrimRight(endpointURL.Path, "/") + canonicalURI

	req, err := http.NewRequest(http.MethodPut, full.String(), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", contentType)
	if err := signSupabaseRequest(req, body, cfg); err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("supabase upload %d: %s", resp.StatusCode, truncate(string(raw), 400))
	}
	return full.String(), nil
}

// supabaseStorageDelete is best-effort: errors are returned so callers can log
// them, but most cleanup paths swallow the error.
func supabaseStorageDelete(objectKey string) error {
	cfg, err := loadSupabaseStorageConfig()
	if err != nil {
		return err
	}
	endpointURL, err := url.Parse(cfg.Endpoint)
	if err != nil {
		return err
	}
	canonicalURI := "/" + cfg.Bucket + "/" + strings.TrimPrefix(objectKey, "/")
	full := *endpointURL
	full.Path = strings.TrimRight(endpointURL.Path, "/") + canonicalURI
	req, err := http.NewRequest(http.MethodDelete, full.String(), nil)
	if err != nil {
		return err
	}
	if err := signSupabaseRequest(req, nil, cfg); err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusNotFound {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase delete %d: %s", resp.StatusCode, truncate(string(raw), 400))
	}
	return nil
}

// signSupabaseRequest implements AWS SigV4 for S3-compatible Supabase Storage.
// Inlined here (instead of pulling in aws sdk's signer) so the helper stays a
// drop-in stdlib-only utility.
func signSupabaseRequest(req *http.Request, body []byte, cfg supabaseStorageConfig) error {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	if req.URL.Host == "" {
		return fmt.Errorf("invalid request URL")
	}
	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Date", amzDate)

	bodyHash := sha256Hex(body)
	req.Header.Set("X-Amz-Content-Sha256", bodyHash)

	signedHeaderNames := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	if ct := req.Header.Get("Content-Type"); ct != "" {
		signedHeaderNames = append(signedHeaderNames, "content-type")
	}
	sort.Strings(signedHeaderNames)

	canonicalHeaders := strings.Builder{}
	for _, h := range signedHeaderNames {
		canonicalHeaders.WriteString(h)
		canonicalHeaders.WriteByte(':')
		canonicalHeaders.WriteString(strings.TrimSpace(req.Header.Get(h)))
		canonicalHeaders.WriteByte('\n')
	}

	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		req.URL.RawQuery,
		canonicalHeaders.String(),
		strings.Join(signedHeaderNames, ";"),
		bodyHash,
	}, "\n")

	scope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, cfg.Region)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	kDate := hmacSHA256([]byte("AWS4"+cfg.SecretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(cfg.Region))
	kService := hmacSHA256(kRegion, []byte("s3"))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	signature := hex.EncodeToString(hmacSHA256(kSigning, []byte(stringToSign)))

	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		cfg.AccessKey, scope, strings.Join(signedHeaderNames, ";"), signature)
	req.Header.Set("Authorization", auth)
	return nil
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}
