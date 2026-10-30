package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"
)

type expiryObservation struct {
	Source           string     `json:"source"`
	ObservedAt       time.Time  `json:"observed_at"`
	ObservationPoint string     `json:"observation_point"`
	LeafFingerprint  string     `json:"leaf_fingerprint,omitempty"`
	Issuer           string     `json:"issuer,omitempty"`
	SANs             string     `json:"sans,omitempty"`
	NotBefore        *time.Time `json:"not_before,omitempty"`
	NotAfter         *time.Time `json:"not_after,omitempty"`
	ChainNotAfter    *time.Time `json:"chain_not_after,omitempty"`
	HostnameOK       bool       `json:"hostname_ok"`
	ChainOK          bool       `json:"chain_ok"`
	DNSOK            bool       `json:"dns_ok"`
	ResolvedIPs      string     `json:"resolved_ips,omitempty"`
	Assessment       string     `json:"assessment"`
	ErrorClass       string     `json:"error_class,omitempty"`
	Detail           string     `json:"detail,omitempty"`
	RegistrarExpires *time.Time `json:"registrar_expires_at,omitempty"`
	RegistryExpires  *time.Time `json:"registry_expires_at,omitempty"`
	AutoRenew        *bool      `json:"auto_renew,omitempty"`
	Manual           bool       `json:"manual,omitempty"`
	RawSummary       string     `json:"raw_summary,omitempty"`
}

var observeExpiryTLS = probeExpiryTLS
var lookupExpiryRDAP = probeExpiryRDAP

func probeExpiryTLS(ctx context.Context, hostname string, port int) expiryObservation {
	obs := expiryObservation{Source: "tls", ObservedAt: time.Now().UTC(), ObservationPoint: "hosted"}
	if !expiryPortAllowed(port) {
		obs.ErrorClass = "denied"
		obs.Detail = "Only ports 443 and 8443 are allowed for hosted checks."
		obs.Assessment = "unknown"
		return obs
	}
	if ip := net.ParseIP(hostname); ip != nil && !ipIsPublicForProbe(ip) {
		obs.ErrorClass = "denied"
		obs.Detail = "Internal targets need a private collector. This hosted check only reaches public endpoints."
		obs.Assessment = "unknown"
		return obs
	}
	resolver := net.DefaultResolver
	addrs, err := resolver.LookupIPAddr(ctx, hostname)
	dnsOK, publicIPs := expiryResolvedPublicIPs(addrs)
	obs.DNSOK = dnsOK
	if len(publicIPs) > 0 {
		obs.ResolvedIPs = strings.Join(publicIPs, ", ")
	}
	if err != nil || !dnsOK {
		obs.ErrorClass = "unreachable"
		obs.Detail = "The hostname could not be resolved."
		obs.Assessment = "unknown"
		return obs
	}
	if len(publicIPs) == 0 {
		obs.ErrorClass = "denied"
		obs.Detail = "Internal targets need a private collector. This hosted check only reaches public endpoints."
		obs.Assessment = "unknown"
		return obs
	}
	public := net.ParseIP(publicIPs[0])
	if public == nil {
		obs.ErrorClass = "denied"
		obs.Detail = "Internal targets need a private collector. This hosted check only reaches public endpoints."
		obs.Assessment = "unknown"
		return obs
	}
	dialer := &net.Dialer{Timeout: 8 * time.Second, KeepAlive: -1}
	raw, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(public.String(), fmt.Sprintf("%d", port)))
	if err != nil {
		obs.ErrorClass = "unreachable"
		obs.Detail = "The endpoint was unreachable."
		obs.Assessment = "unknown"
		return obs
	}
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(8 * time.Second))
	cfg := &tls.Config{ServerName: hostname, MinVersion: tls.VersionTLS12, Time: time.Now}
	conn := tls.Client(raw, cfg)
	verifyErr := conn.HandshakeContext(ctx)
	state := conn.ConnectionState()
	_ = conn.Close()
	if len(state.PeerCertificates) == 0 && verifyErr != nil {
		insecure := &tls.Config{ServerName: hostname, MinVersion: tls.VersionTLS12, InsecureSkipVerify: true}
		raw2, dialErr := dialer.DialContext(ctx, "tcp", net.JoinHostPort(public.String(), fmt.Sprintf("%d", port)))
		if dialErr != nil {
			obs.ErrorClass = "invalid"
			obs.Detail = "TLS handshake failed and no certificate was presented."
			obs.Assessment = "invalid"
			return obs
		}
		defer raw2.Close()
		_ = raw2.SetDeadline(time.Now().Add(8 * time.Second))
		conn2 := tls.Client(raw2, insecure)
		_ = conn2.HandshakeContext(ctx)
		state = conn2.ConnectionState()
		_ = conn2.Close()
		obs.ErrorClass = "invalid"
		obs.Detail = "TLS handshake failed. The presented certificate is stored as evidence only."
	}
	if len(state.PeerCertificates) == 0 {
		obs.ErrorClass = "invalid"
		obs.Detail = "No certificate was presented."
		obs.Assessment = "invalid"
		return obs
	}
	leaf := state.PeerCertificates[0]
	sum := sha256.Sum256(leaf.Raw)
	obs.LeafFingerprint = strings.ToUpper(hex.EncodeToString(sum[:]))
	obs.Issuer = strings.TrimSpace(leaf.Issuer.CommonName)
	if obs.Issuer == "" {
		obs.Issuer = leaf.Issuer.String()
	}
	obs.SANs = joinExpirySANs(leaf)
	nb, na := leaf.NotBefore.UTC(), leaf.NotAfter.UTC()
	obs.NotBefore = &nb
	obs.NotAfter = &na
	if earliest := earliestChainExpiry(state.PeerCertificates); earliest != nil {
		obs.ChainNotAfter = earliest
	}
	opts := x509.VerifyOptions{DNSName: hostname, Roots: nil, Intermediates: x509.NewCertPool(), CurrentTime: time.Now()}
	for _, cert := range state.PeerCertificates[1:] {
		opts.Intermediates.AddCert(cert)
	}
	if _, err := leaf.Verify(opts); err == nil {
		obs.ChainOK = true
		obs.HostnameOK = true
	} else {
		obs.ErrorClass = "invalid"
		obs.Detail = "Hostname or chain validation failed."
		nameErr := leaf.VerifyHostname(hostname)
		obs.HostnameOK = nameErr == nil
		obs.ChainOK = false
	}
	if verifyErr == nil {
		obs.HostnameOK = true
		obs.ChainOK = true
		obs.ErrorClass = ""
		obs.Detail = "Leaf certificate observed at the hosted collector."
	}
	obs.RawSummary = fmt.Sprintf("sni=%s port=%d dns=%s ip=%s fingerprint=%s", hostname, port, obs.ResolvedIPs, public.String(), obs.LeafFingerprint)
	return obs
}

func expiryResolvedPublicIPs(addrs []net.IPAddr) (bool, []string) {
	if len(addrs) == 0 {
		return false, nil
	}
	public := []string{}
	seen := map[string]bool{}
	for _, addr := range addrs {
		if !ipIsPublicForProbe(addr.IP) {
			continue
		}
		value := addr.IP.String()
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		public = append(public, value)
		if len(public) == 5 {
			break
		}
	}
	return true, public
}

func joinExpirySANs(cert *x509.Certificate) string {
	names := append([]string{}, cert.DNSNames...)
	sort.Strings(names)
	return strings.Join(names, ", ")
}

func earliestChainExpiry(certs []*x509.Certificate) *time.Time {
	var earliest *time.Time
	for _, cert := range certs {
		if cert == nil {
			continue
		}
		end := cert.NotAfter.UTC()
		if earliest == nil || end.Before(*earliest) {
			copyEnd := end
			earliest = &copyEnd
		}
	}
	return earliest
}
