package main

import (
	"net"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/idna"
)

var expiryAllowedPorts = map[int]bool{443: true, 8443: true}

func normalizeExpiryHostname(raw string) (string, error) {
	value := strings.TrimSpace(strings.ToLower(raw))
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimPrefix(value, "http://")
	if slash := strings.Index(value, "/"); slash >= 0 {
		value = value[:slash]
	}
	if at := strings.LastIndex(value, "@"); at >= 0 {
		return "", errOncallInvalid
	}
	host := value
	if strings.HasPrefix(host, "[") {
		end := strings.Index(host, "]")
		if end < 0 {
			return "", errOncallInvalid
		}
		host = host[1:end]
	} else if colon := strings.LastIndex(host, ":"); colon >= 0 && net.ParseIP(host) == nil {
		host = host[:colon]
	}
	host = strings.TrimSuffix(host, ".")
	if host == "" || strings.ContainsAny(host, " \t\n") {
		return "", errOncallInvalid
	}
	ascii, err := idna.Lookup.ToASCII(host)
	if err != nil || ascii == "" {
		return "", errOncallInvalid
	}
	return ascii, nil
}

func normalizeRegistrableDomain(raw string) (string, error) {
	host, err := normalizeExpiryHostname(raw)
	if err != nil {
		return "", err
	}
	if ip := net.ParseIP(host); ip != nil {
		return "", errOncallInvalid
	}
	labels := strings.Split(host, ".")
	if len(labels) < 2 {
		return "", errOncallInvalid
	}
	return strings.Join(labels[len(labels)-2:], "."), nil
}

func parseExpiryPort(raw string, fallback int) int {
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	port, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0
	}
	return port
}

func expiryPortAllowed(port int) bool {
	return expiryAllowedPorts[port]
}

func normalizeExpiryCollector(raw string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return "hosted", nil
	}
	if value != "hosted" && value != "private" {
		return "", errOncallInvalid
	}
	return value, nil
}

func expiryCollectorIsPrivate(raw string) bool {
	return strings.EqualFold(strings.TrimSpace(raw), "private")
}

func expiryHostNeedsPrivateCollector(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	if host == "internal.example.com" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return !ipIsPublicForProbe(ip)
	}
	return false
}

func expiryCoverageCopy(collector string) string {
	if expiryCollectorIsPrivate(collector) {
		return "Private collector. One observation point does not prove every region. Hosted checks do not reach this target."
	}
	return "Hosted collector. One observation point does not prove every region."
}

func expiryWaitingPrivateObservation() expiryObservation {
	return expiryObservation{
		Source:           "collector",
		ObservedAt:       time.Now().UTC(),
		ObservationPoint: "private",
		Assessment:       "unknown",
		ErrorClass:       "waiting",
		Detail:           "Waiting for a private collector observation. Hosted checks do not reach this target.",
	}
}

func ipIsPublicForProbe(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 169 && ip4[1] == 254 {
			return false
		}
		if ip4[0] == 0 {
			return false
		}
	}
	return true
}

func classifyExpiryAssessment(assetType string, notAfter *time.Time, hostnameOK, chainOK bool, probeErr string, now time.Time, warnDays []int) string {
	if strings.TrimSpace(probeErr) != "" && notAfter == nil {
		if strings.Contains(strings.ToLower(probeErr), "timeout") || strings.Contains(strings.ToLower(probeErr), "unreachable") || strings.Contains(strings.ToLower(probeErr), "no such host") {
			return "unknown"
		}
		if assetType == "certificate" {
			return "invalid"
		}
		return "unknown"
	}
	if notAfter == nil {
		return "unknown"
	}
	if assetType == "certificate" && (!hostnameOK || !chainOK) {
		return "invalid"
	}
	if !now.Before(*notAfter) {
		return "expired"
	}
	remaining := int(notAfter.Sub(now).Hours() / 24)
	threshold := 30
	for _, day := range warnDays {
		if day > 0 && day < threshold {
			threshold = day
		}
	}
	if len(warnDays) > 0 {
		threshold = warnDays[0]
		for _, day := range warnDays {
			if day > threshold {
				threshold = day
			}
		}
	}
	if remaining <= threshold {
		return "expiring"
	}
	return "valid"
}

func parseWarnDays(raw string) []int {
	out := []int{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		days, err := strconv.Atoi(part)
		if err != nil || days <= 0 || days > 400 {
			continue
		}
		out = append(out, days)
	}
	if len(out) == 0 {
		return []int{30, 14, 7, 3, 1}
	}
	return out
}

func remainingExpiryDays(notAfter *time.Time, now time.Time) *int {
	if notAfter == nil {
		return nil
	}
	days := int(notAfter.Sub(now).Hours() / 24)
	return &days
}
