package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
)

const jiraSecretEncPrefix = "enc:jira:v1:"

func deriveJiraSecretKey() ([]byte, error) {
	signing, err := sessionSigningKey()
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(append([]byte("opstrellis-jira-secret-v1:"), signing...))
	return sum[:], nil
}

func encryptJiraSecret(plaintext string) (string, error) {
	plaintext = strings.TrimSpace(plaintext)
	if plaintext == "" {
		return "", nil
	}
	if strings.HasPrefix(plaintext, jiraSecretEncPrefix) {
		return plaintext, nil
	}
	key, err := deriveJiraSecretKey()
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
	return jiraSecretEncPrefix + base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func decryptJiraSecret(stored string) (string, error) {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return "", nil
	}
	if !strings.HasPrefix(stored, jiraSecretEncPrefix) {
		return "", fmt.Errorf("jira secret is not encrypted")
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(stored, jiraSecretEncPrefix))
	if err != nil {
		return "", fmt.Errorf("invalid encrypted jira secret")
	}
	key, err := deriveJiraSecretKey()
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
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", fmt.Errorf("invalid encrypted jira secret")
	}
	plain, err := gcm.Open(nil, raw[:nonceSize], raw[nonceSize:], nil)
	if err != nil {
		return "", fmt.Errorf("jira secret could not be decrypted")
	}
	return string(plain), nil
}

func randomHex(n int) string {
	if n <= 0 {
		n = 8
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", n)
	}
	return hex.EncodeToString(buf)
}
