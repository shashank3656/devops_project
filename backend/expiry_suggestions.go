package main

import (
	"net"
	"strings"
)

type expiryHostSuggestion struct {
	Hostname        string `json:"hostname"`
	Source          string `json:"source"`
	ProjectID       int    `json:"project_id,omitempty"`
	Cluster         string `json:"cluster,omitempty"`
	Namespace       string `json:"namespace,omitempty"`
	Registered      bool   `json:"registered"`
	IssuedNotServed bool   `json:"issued_not_served,omitempty"`
	CollectorHint   string `json:"collector_hint,omitempty"`
	Note            string `json:"note,omitempty"`
}

const expiryIssuedNotServedNote = "Issued inventory is not proof the currently served endpoint was observed."

func registeredExpiryHosts() map[string]bool {
	out := map[string]bool{}
	if DB == nil {
		return out
	}
	rows, cancel, err := queryRowsWithTimeout(`SELECT LOWER(COALESCE(NULLIF(hostname, ''), registered_domain)) FROM expiry_assets WHERE state <> 'archived'`)
	if err != nil {
		return out
	}
	defer cancel()
	defer rows.Close()
	for rows.Next() {
		var host string
		if err := rows.Scan(&host); err == nil && strings.TrimSpace(host) != "" {
			out[strings.ToLower(strings.TrimSpace(host))] = true
		}
	}
	return out
}

func expirySuggestionAllowed(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" || strings.HasPrefix(host, "*") {
		return false
	}
	if host == "internal.example.com" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return false
	}
	return true
}

func suggestExpiryHosts(userID, projectID int) []expiryHostSuggestion {
	out := []expiryHostSuggestion{}
	seen := map[string]bool{}
	registered := registeredExpiryHosts()
	projects := []int{}
	if projectID > 0 {
		projects = []int{projectID}
	} else {
		projects = visibleProjectIDsForUser(userID)
		if len(projects) > 8 {
			projects = projects[:8]
		}
	}
	for _, pid := range projects {
		if pid <= 0 {
			continue
		}
		dash, err := loadK8sDashboardForReader(userID, pid, "", "", "", true)
		if err != nil || dash == nil {
			continue
		}
		for _, ing := range dash.Ingresses {
			host := strings.ToLower(strings.TrimSpace(ing.Host))
			if !expirySuggestionAllowed(host) || seen[host] {
				continue
			}
			seen[host] = true
			out = append(out, expiryHostSuggestion{
				Hostname:   host,
				Source:     "kubernetes_ingress",
				ProjectID:  pid,
				Cluster:    ing.ClusterName,
				Namespace:  ing.Namespace,
				Registered: registered[host],
			})
		}
		for _, cert := range dash.Certificates {
			for _, host := range splitExpirySuggestionHosts(cert.Hosts) {
				if seen[host] {
					continue
				}
				hint := ""
				if expiryHostNeedsPrivateCollector(host) {
					hint = "private"
				} else if !expirySuggestionAllowed(host) {
					continue
				}
				seen[host] = true
				out = append(out, expiryHostSuggestion{
					Hostname:        host,
					Source:          "certificate_manager",
					ProjectID:       pid,
					Cluster:         cert.ClusterName,
					Namespace:       cert.Namespace,
					Registered:      registered[host],
					IssuedNotServed: true,
					CollectorHint:   hint,
					Note:            expiryIssuedNotServedNote,
				})
			}
		}
	}
	out = append(out, suggestCloudCertificateManagers(registered, seen)...)
	return out
}

func splitExpirySuggestionHosts(raw string) []string {
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		host := strings.ToLower(strings.TrimSpace(part))
		if host == "" || strings.HasPrefix(host, "*") {
			continue
		}
		out = append(out, host)
	}
	return out
}

func expiryHostnameFromInventory(name, resourceID string) string {
	for _, raw := range []string{name, resourceID} {
		host, err := normalizeExpiryHostname(raw)
		if err != nil {
			continue
		}
		if net.ParseIP(host) != nil || !strings.Contains(host, ".") {
			continue
		}
		if strings.Count(host, ".") == 0 {
			continue
		}
		return host
	}
	return ""
}

func cloudCertificateManagerType(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "acm", "acm-pca", "acm_certificate", "certificate-manager", "certificatemanager", "ssl", "tls":
		return true
	default:
		return false
	}
}

func suggestCloudCertificateManagers(registered, seen map[string]bool) []expiryHostSuggestion {
	if DB == nil {
		return nil
	}
	rows, cancel, err := queryRowsWithTimeout(`
		SELECT COALESCE(display_name, ''), COALESCE(resource_id, ''), COALESCE(service_type, '')
		FROM cloud_resources
		WHERE LOWER(COALESCE(service_type, '')) IN ('acm','acm-pca','acm_certificate','certificate-manager','certificatemanager','ssl','tls')
		ORDER BY id DESC
		LIMIT 50
	`)
	if err != nil {
		return nil
	}
	defer cancel()
	defer rows.Close()
	out := []expiryHostSuggestion{}
	for rows.Next() {
		var name, resourceID, serviceType string
		if err := rows.Scan(&name, &resourceID, &serviceType); err != nil || !cloudCertificateManagerType(serviceType) {
			continue
		}
		host := expiryHostnameFromInventory(name, resourceID)
		if host == "" || seen[host] {
			continue
		}
		hint := ""
		if expiryHostNeedsPrivateCollector(host) {
			hint = "private"
		} else if !expirySuggestionAllowed(host) {
			continue
		}
		seen[host] = true
		out = append(out, expiryHostSuggestion{
			Hostname:        host,
			Source:          "cloud_certificate_manager",
			Registered:      registered[host],
			IssuedNotServed: true,
			CollectorHint:   hint,
			Note:            expiryIssuedNotServedNote,
		})
	}
	return out
}
