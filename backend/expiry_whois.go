package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

func lookupExpiryWHOIS(ctx context.Context, domain string) (registrar, registry *time.Time, server string, used bool) {
	if ctx.Err() != nil {
		return nil, nil, "", false
	}
	ascii := strings.ToLower(strings.TrimSpace(domain))
	labels := strings.Split(ascii, ".")
	if len(labels) < 2 {
		return nil, nil, "", false
	}
	tld := labels[len(labels)-1]
	ianaBody, err := whoisQuery(ctx, "whois.iana.org", tld)
	if err != nil {
		return nil, nil, "", false
	}
	server = ianaWHOISServer(ianaBody)
	if server == "" || server == "whois.iana.org" {
		return nil, nil, "", false
	}
	body, err := whoisQuery(ctx, server, ascii)
	if err != nil {
		return nil, nil, server, false
	}
	registrar, registry = parseWHOISExpiryLines(body)
	if registrar == nil && registry == nil {
		return nil, nil, server, false
	}
	return registrar, registry, server, true
}

func ianaWHOISServer(body string) string {
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(strings.ToLower(trimmed), "whois:") {
			continue
		}
		_, value, ok := splitWHOISField(trimmed)
		if !ok {
			return ""
		}
		server := strings.ToLower(strings.Trim(strings.TrimSpace(value), "."))
		if server == "" || strings.ContainsAny(server, " /@") {
			return ""
		}
		return server
	}
	return ""
}

func parseWHOISExpiryLines(body string) (registrar *time.Time, registry *time.Time) {
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "%") || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.Contains(line, "@") {
			continue
		}
		key, value, ok := splitWHOISField(line)
		if !ok {
			continue
		}
		kind := whoisExpiryKind(key)
		if kind == "" {
			continue
		}
		when, err := parseExpiryTimestamp(value)
		if err != nil {
			continue
		}
		utc := when.UTC()
		switch kind {
		case "registrar":
			if registrar == nil {
				copyTime := utc
				registrar = &copyTime
			}
		case "registry":
			if registry == nil {
				copyTime := utc
				registry = &copyTime
			}
		}
	}
	return registrar, registry
}

func whoisExpiryKind(key string) string {
	k := strings.ToLower(strings.TrimSpace(key))
	k = strings.ReplaceAll(k, "_", " ")
	k = strings.ReplaceAll(k, "-", " ")
	k = strings.Join(strings.Fields(k), " ")
	if k == "" {
		return ""
	}
	if strings.Contains(k, "email") || strings.Contains(k, "phone") || strings.Contains(k, "fax") || strings.Contains(k, "registrant") || strings.Contains(k, "contact") {
		return ""
	}
	if strings.Contains(k, "creat") || strings.Contains(k, "updat") || strings.Contains(k, "changed") || strings.Contains(k, "registered on") {
		return ""
	}
	if strings.Contains(k, "registrar") && (strings.Contains(k, "expir") || strings.Contains(k, "paid")) {
		return "registrar"
	}
	if strings.Contains(k, "registry") && strings.Contains(k, "expir") {
		return "registry"
	}
	switch k {
	case "paid till", "paid till date", "expires", "expiry date", "expiration date", "expire", "expiry", "expire date":
		return "registrar"
	}
	return ""
}

func splitWHOISField(line string) (string, string, bool) {
	idx := strings.Index(line, ":")
	if idx <= 0 {
		return "", "", false
	}
	key := strings.TrimSpace(line[:idx])
	value := strings.TrimSpace(line[idx+1:])
	if key == "" || value == "" {
		return "", "", false
	}
	return key, value, true
}

func whoisQuery(ctx context.Context, server, query string) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	ip, err := firstPublicHostIP(ctx, server)
	if err != nil {
		return "", err
	}
	dialer := net.Dialer{Timeout: 6 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), "43"))
	if err != nil {
		return "", err
	}
	defer conn.Close()
	deadline := time.Now().Add(6 * time.Second)
	if until, ok := ctx.Deadline(); ok && until.Before(deadline) {
		deadline = until
	}
	_ = conn.SetDeadline(deadline)
	if _, err := io.WriteString(conn, query+"\r\n"); err != nil {
		return "", err
	}
	body, err := io.ReadAll(io.LimitReader(conn, 64<<10))
	if err != nil && len(body) == 0 {
		return "", err
	}
	return string(body), nil
}

func firstPublicHostIP(ctx context.Context, host string) (net.IP, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return nil, fmt.Errorf("host missing")
	}
	if ip := net.ParseIP(host); ip != nil {
		if !ipIsPublicForProbe(ip) {
			return nil, fmt.Errorf("private address is not allowed")
		}
		return ip, nil
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, addr := range addrs {
		if ipIsPublicForProbe(addr.IP) {
			return addr.IP, nil
		}
	}
	return nil, fmt.Errorf("no public address")
}
