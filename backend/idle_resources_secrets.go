package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

// cloudSecretsKey decodes CLOUD_SECRET_KEY (base64) into a 32-byte AES-256 key.
// Returns an error when the key is missing or malformed so the API can refuse
// to store credentials when the operator hasn't set it up.
func cloudSecretsKey() ([]byte, error) {
	raw := CloudSecretKeyB64
	if raw == "" {
		return nil, errors.New("CLOUD_SECRET_KEY is not configured")
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("CLOUD_SECRET_KEY is not valid base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("CLOUD_SECRET_KEY must decode to 32 bytes, got %d", len(key))
	}
	return key, nil
}

// encryptCloudSecret seals plaintext with AES-256-GCM. Returns ciphertext and
// nonce as separate slices so they can be persisted in distinct DB columns.
func encryptCloudSecret(plaintext []byte) (ciphertext, nonce []byte, err error) {
	key, err := cloudSecretsKey()
	if err != nil {
		return nil, nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	ciphertext = gcm.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nonce, nil
}

// decryptCloudSecret opens a ciphertext previously produced by encryptCloudSecret.
func decryptCloudSecret(ciphertext, nonce []byte) ([]byte, error) {
	key, err := cloudSecretsKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(nonce) != gcm.NonceSize() {
		return nil, errors.New("nonce size mismatch")
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}
