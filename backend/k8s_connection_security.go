package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const k8sCredentialEncPrefix = "enc:v1:"

var k8sSecretRefPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9._-]{0,127}$`)

func k8sAuthModesForCloud(cloud string) []string {
	switch strings.ToLower(strings.TrimSpace(cloud)) {
	case "aws":
		return []string{"eks_iam", "secret_ref", "kubeconfig", "service_account", "token", "in_cluster"}
	case "azure":
		return []string{"aks_workload_identity", "secret_ref", "kubeconfig", "service_account", "token", "in_cluster"}
	case "gcp":
		return []string{"gke_workload_identity", "secret_ref", "kubeconfig", "service_account", "token", "in_cluster"}
	default:
		return k8sAuthModes()
	}
}

func k8sAuthModesByCloud() map[string][]string {
	return map[string][]string{
		"aws":   k8sAuthModesForCloud("aws"),
		"azure": k8sAuthModesForCloud("azure"),
		"gcp":   k8sAuthModesForCloud("gcp"),
	}
}

func k8sCredentialStoresSecret(mode string) bool {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "kubeconfig", "service_account", "token", "oidc":
		return true
	default:
		return false
	}
}

func k8sCredentialUsesServerSideRef(mode string) bool {
	return strings.EqualFold(strings.TrimSpace(mode), "secret_ref")
}

func k8sCredentialUsesCloudTrust(mode string) bool {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "eks_iam", "aks_workload_identity", "gke_workload_identity", "in_cluster":
		return true
	default:
		return false
	}
}

func deriveK8sCredentialKey() ([]byte, error) {
	signing, err := sessionSigningKey()
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(append([]byte("setuops-k8s-credential-v1:"), signing...))
	return sum[:], nil
}

func encryptK8sCredential(plaintext string) (string, error) {
	plaintext = strings.TrimSpace(plaintext)
	if plaintext == "" {
		return "", nil
	}
	if strings.HasPrefix(plaintext, k8sCredentialEncPrefix) {
		return plaintext, nil
	}
	key, err := deriveK8sCredentialKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return k8sCredentialEncPrefix + base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func decryptK8sCredential(stored string) (string, error) {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return "", nil
	}
	if !strings.HasPrefix(stored, k8sCredentialEncPrefix) {
		return stored, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(stored, k8sCredentialEncPrefix))
	if err != nil {
		return "", fmt.Errorf("invalid encrypted k8s credential")
	}
	key, err := deriveK8sCredentialKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("invalid encrypted k8s credential payload")
	}
	nonce, ciphertext := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("unable to decrypt k8s credential")
	}
	return string(plain), nil
}

func envKeyForK8sSecretRef(ref string) string {
	normalized := strings.ToUpper(strings.NewReplacer("-", "_", ".", "_").Replace(strings.TrimSpace(ref)))
	return "K8S_SECRET_REF_" + normalized
}

func resolveK8sSecretRef(ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", fmt.Errorf("secret_ref is required")
	}
	if !k8sSecretRefPattern.MatchString(ref) {
		return "", fmt.Errorf("secret_ref must be 1-128 chars (letters, numbers, ., _, -)")
	}
	if value := strings.TrimSpace(os.Getenv(envKeyForK8sSecretRef(ref))); value != "" {
		return value, nil
	}
	if blob := strings.TrimSpace(os.Getenv("K8S_SECRET_REFS")); blob != "" {
		var mapping map[string]string
		if err := json.Unmarshal([]byte(blob), &mapping); err == nil {
			if value := strings.TrimSpace(mapping[ref]); value != "" {
				return value, nil
			}
		}
	}
	return "", fmt.Errorf("secret_ref %q is not configured on the API host (set %s or K8S_SECRET_REFS)", ref, envKeyForK8sSecretRef(ref))
}

func validateK8sClusterEndpoint(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("cluster endpoint is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("cluster endpoint must be a valid URL")
	}
	if strings.ToLower(parsed.Scheme) != "https" {
		return fmt.Errorf("cluster endpoint must use https")
	}
	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("cluster endpoint host is required")
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".local") {
		return fmt.Errorf("cluster endpoint cannot target localhost")
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
			return fmt.Errorf("cluster endpoint cannot target private or loopback addresses")
		}
	}
	return nil
}

type k8sCloudTrustConfig struct {
	RoleARN             string `json:"role_arn,omitempty"`
	ExternalID          string `json:"external_id,omitempty"`
	TenantID            string `json:"tenant_id,omitempty"`
	SubscriptionID      string `json:"subscription_id,omitempty"`
	ResourceGroup       string `json:"resource_group,omitempty"`
	ServiceAccountEmail string `json:"service_account_email,omitempty"`
	ProjectID           string `json:"project_id,omitempty"`
	Region              string `json:"region,omitempty"`
}

func validateK8sCloudTrustCredential(cloud, mode, credential string) error {
	credential = strings.TrimSpace(credential)
	if credential == "" {
		return fmt.Errorf("trust configuration is required for %s mode", mode)
	}
	var cfg k8sCloudTrustConfig
	if err := json.Unmarshal([]byte(credential), &cfg); err != nil {
		return fmt.Errorf("trust configuration must be valid JSON")
	}
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "eks_iam":
		if strings.TrimSpace(cfg.RoleARN) == "" {
			return fmt.Errorf("role_arn is required for eks_iam")
		}
		if !strings.EqualFold(cloud, "aws") {
			return fmt.Errorf("eks_iam is only valid for aws clusters")
		}
	case "aks_workload_identity":
		if strings.TrimSpace(cfg.TenantID) == "" || strings.TrimSpace(cfg.SubscriptionID) == "" {
			return fmt.Errorf("tenant_id and subscription_id are required for aks_workload_identity")
		}
		if !strings.EqualFold(cloud, "azure") {
			return fmt.Errorf("aks_workload_identity is only valid for azure clusters")
		}
	case "gke_workload_identity":
		if strings.TrimSpace(cfg.ServiceAccountEmail) == "" || strings.TrimSpace(cfg.ProjectID) == "" {
			return fmt.Errorf("service_account_email and project_id are required for gke_workload_identity")
		}
		if !strings.EqualFold(cloud, "gcp") {
			return fmt.Errorf("gke_workload_identity is only valid for gcp clusters")
		}
	case "in_cluster":
		return nil
	}
	return nil
}

func prepareK8sCredentialForStorage(mode, credential string) (string, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	credential = strings.TrimSpace(credential)
	switch {
	case mode == "in_cluster":
		return "", nil
	case k8sCredentialUsesServerSideRef(mode):
		if _, err := resolveK8sSecretRef(credential); err != nil {
			return "", err
		}
		return credential, nil
	case k8sCredentialUsesCloudTrust(mode):
		return credential, nil
	case k8sCredentialStoresSecret(mode):
		if credential == "" {
			return "", fmt.Errorf("authentication credential is required for %s mode", mode)
		}
		return encryptK8sCredential(credential)
	default:
		if credential == "" {
			return "", fmt.Errorf("authentication credential is required for %s mode", mode)
		}
		return encryptK8sCredential(credential)
	}
}

func materializeK8sCredential(mode, stored string) (string, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	stored = strings.TrimSpace(stored)
	switch {
	case mode == "in_cluster":
		return "", nil
	case k8sCredentialUsesServerSideRef(mode):
		return resolveK8sSecretRef(stored)
	case k8sCredentialUsesCloudTrust(mode):
		return stored, nil
	default:
		return decryptK8sCredential(stored)
	}
}

func k8sSkipEndpointProbe() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("K8S_SKIP_ENDPOINT_PROBE")))
	return v == "1" || v == "true" || v == "yes"
}

func probeK8sClusterEndpoint(endpoint string) error {
	if err := validateK8sClusterEndpoint(endpoint); err != nil {
		return err
	}
	if k8sSkipEndpointProbe() {
		return nil
	}
	client := &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
		},
	}
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(endpoint, "/")+"/version", nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach cluster endpoint (TLS/DNS): %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 500 {
		return fmt.Errorf("cluster endpoint returned %d", resp.StatusCode)
	}
	return nil
}

func maybeReencryptK8sStoredCredential(mode, stored string) (string, error) {
	stored = strings.TrimSpace(stored)
	if stored == "" || !k8sCredentialStoresSecret(mode) {
		return stored, nil
	}
	if strings.HasPrefix(stored, k8sCredentialEncPrefix) {
		return stored, nil
	}
	return encryptK8sCredential(stored)
}

func migrateK8sCredentialsEncryption() {
	if DB == nil {
		return
	}
	ctx, cancel := dbTimeoutContext()
	defer cancel()
	rows, err := DB.QueryContext(ctx, `
		SELECT id, auth_mode, auth_credential
		FROM project_k8s_connections
		WHERE COALESCE(auth_credential, '') <> ''
		  AND auth_credential NOT LIKE 'enc:v1:%'
	`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var mode, cred string
		if err := rows.Scan(&id, &mode, &cred); err != nil {
			continue
		}
		next, err := maybeReencryptK8sStoredCredential(mode, cred)
		if err != nil || next == cred {
			continue
		}
		_, _ = DB.ExecContext(ctx, `UPDATE project_k8s_connections SET auth_credential = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, next)
	}
}

func testK8sConnectionInput(input k8sOnboardingInput) (string, error) {
	requireCredential := !strings.EqualFold(strings.TrimSpace(input.AuthMode), "in_cluster")
	input, _, err := sanitizeK8sOnboardingInput(input, requireCredential)
	if err != nil {
		return "", err
	}
	stored, err := prepareK8sCredentialForStorage(input.AuthMode, input.AuthCredential)
	if err != nil {
		return "", err
	}
	if _, err := materializeK8sCredential(input.AuthMode, stored); err != nil {
		return "", err
	}
	if err := probeK8sClusterEndpoint(input.ClusterEndpoint); err != nil {
		return "", err
	}
	return "Cluster endpoint is reachable and credentials are configured on the server.", nil
}
