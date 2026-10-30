package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

type rdapResponse struct {
	Events      []rdapEvent  `json:"events"`
	Entities    []rdapEntity `json:"entities"`
	SecureDNS   rdapDNS      `json:"secureDNS"`
	Status      []string     `json:"status"`
	LDHName     string       `json:"ldhName"`
	UnicodeName string       `json:"unicodeName"`
}

type rdapEntity struct {
	Roles    []string     `json:"roles"`
	Events   []rdapEvent  `json:"events"`
	Entities []rdapEntity `json:"entities"`
}

type rdapEvent struct {
	Action string `json:"eventAction"`
	Date   string `json:"eventDate"`
}

type rdapDNS struct {
	DelegationSigned bool `json:"delegationSigned"`
}

func probeExpiryRDAP(ctx context.Context, domain string) expiryObservation {
	obs := expiryObservation{Source: "rdap", ObservedAt: time.Now().UTC(), ObservationPoint: "rdap.org"}
	ascii, err := normalizeRegistrableDomain(domain)
	if err != nil {
		obs.ErrorClass = "denied"
		obs.Detail = "That value is not a registrable domain."
		obs.Assessment = "unknown"
		return obs
	}
	if ip := net.ParseIP(ascii); ip != nil {
		obs.ErrorClass = "denied"
		obs.Detail = "IP addresses are not domain registrations."
		obs.Assessment = "unknown"
		return obs
	}

	var registrar, registry *time.Time
	rdapOK := false
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://rdap.org/domain/"+ascii, nil)
	if err == nil {
		req.Header.Set("Accept", "application/rdap+json, application/json")
		client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: expiryPublicRedirect}
		res, doErr := client.Do(req)
		if doErr != nil {
			obs.ErrorClass = "unreachable"
			obs.Detail = "RDAP could not be reached. Domain expiry stays Unknown until WHOIS or a later check."
		} else {
			body, readErr := io.ReadAll(io.LimitReader(res.Body, 1<<20))
			res.Body.Close()
			if readErr != nil {
				obs.ErrorClass = "unknown"
				obs.Detail = "RDAP response could not be read. Domain expiry stays Unknown until WHOIS or a later check."
			} else if res.StatusCode >= 400 {
				obs.ErrorClass = "unknown"
				obs.Detail = fmt.Sprintf("RDAP returned no expiry date (%d). Domain expiry stays Unknown until WHOIS or a later check.", res.StatusCode)
			} else {
				var parsed rdapResponse
				if json.Unmarshal(body, &parsed) != nil {
					obs.ErrorClass = "unknown"
					obs.Detail = "RDAP returned unstructured data. Domain expiry stays Unknown until WHOIS or a later check."
				} else {
					registrar, registry = rdapExpiryDates(collectRDAPEvents(parsed))
					rdapOK = registrar != nil || registry != nil
					auto := rdapAutoRenew(parsed.Status)
					obs.AutoRenew = auto
					obs.RawSummary = fmt.Sprintf("domain=%s source=rdap.org", ascii)
				}
			}
		}
	} else {
		obs.ErrorClass = "unknown"
		obs.Detail = "RDAP request could not be built."
	}

	whoisNote := ""
	if registrar == nil || registry == nil {
		wr, wg, whoisHost, used := lookupExpiryWHOIS(ctx, ascii)
		if used {
			if registrar == nil {
				registrar = wr
			}
			if registry == nil {
				registry = wg
			}
			if whoisHost != "" {
				whoisNote = " WHOIS " + whoisHost + " filled missing registration dates."
				if obs.RawSummary == "" {
					obs.RawSummary = fmt.Sprintf("domain=%s source=whois", ascii)
				} else {
					obs.RawSummary += " whois=" + whoisHost
				}
				obs.Source = "rdap+whois"
			}
		}
	}

	captured := ""
	registrar, registry, captured = capturePublishedDomainExpiry(registrar, registry)
	obs.RegistrarExpires = registrar
	obs.RegistryExpires = registry
	if registrar == nil && registry == nil {
		if obs.ErrorClass == "" {
			obs.ErrorClass = "unknown"
		}
		if strings.TrimSpace(obs.Detail) == "" {
			obs.Detail = "RDAP and WHOIS did not include an expiration date. Domain expiry stays Unknown."
		}
		obs.Assessment = "unknown"
		return obs
	}
	obs.ErrorClass = ""
	if registrar != nil && registry != nil && !registrar.Equal(*registry) {
		obs.ErrorClass = "conflict"
		obs.Detail = "Registrar and registry expiry differ. Both dates are stored."
	} else if captured != "" {
		obs.Detail = captured
	} else if rdapOK {
		obs.Detail = "RDAP registration expiry. Auto-renew is not proof of completed renewal."
	} else {
		obs.Detail = "WHOIS registration expiry. Auto-renew is not proof of completed renewal."
	}
	obs.Detail += whoisNote
	if obs.RawSummary == "" {
		obs.RawSummary = fmt.Sprintf("domain=%s source=rdap.org", ascii)
	}
	return obs
}

func collectRDAPEvents(parsed rdapResponse) []rdapEvent {
	events := append([]rdapEvent{}, parsed.Events...)
	var walk func([]rdapEntity)
	walk = func(ents []rdapEntity) {
		for _, ent := range ents {
			events = append(events, ent.Events...)
			walk(ent.Entities)
		}
	}
	walk(parsed.Entities)
	return events
}

func rdapExpiryDates(events []rdapEvent) (registrar *time.Time, registry *time.Time) {
	for _, event := range events {
		when, err := parseExpiryTimestamp(event.Date)
		if err != nil {
			continue
		}
		utc := when.UTC()
		switch classifyRDAPExpiryAction(event.Action) {
		case "registry":
			if registry == nil {
				copyTime := utc
				registry = &copyTime
			}
		case "registrar":
			copyTime := utc
			registrar = &copyTime
		}
	}
	return registrar, registry
}

func capturePublishedDomainExpiry(registrar, registry *time.Time) (*time.Time, *time.Time, string) {
	if registrar != nil || registry == nil {
		return registrar, registry, ""
	}
	copyTime := *registry
	return &copyTime, registry, "Registration expiry captured from the published registry date. The registrar did not publish a separate date."
}

func classifyRDAPExpiryAction(action string) string {
	a := strings.ToLower(strings.TrimSpace(action))
	a = strings.ReplaceAll(a, "_", " ")
	a = strings.ReplaceAll(a, "-", " ")
	a = strings.Join(strings.Fields(a), " ")
	if a == "" || strings.Contains(a, "registration") || strings.Contains(a, "last changed") || strings.Contains(a, "last update") {
		return ""
	}
	if strings.Contains(a, "registrar") && strings.Contains(a, "expir") {
		return "registrar"
	}
	if a == "expiration date" {
		return "registrar"
	}
	if a == "expiration" || (strings.Contains(a, "registry") && strings.Contains(a, "expir")) {
		return "registry"
	}
	return ""
}

func parseExpiryTimestamp(raw string) (time.Time, error) {
	value := strings.TrimSpace(raw)
	value = strings.Trim(value, ".")
	value = strings.TrimSuffix(value, " UTC")
	value = strings.TrimSuffix(value, " GMT")
	if value == "" {
		return time.Time{}, fmt.Errorf("empty")
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999Z07:00",
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05 MST",
		"2006-01-02 15:04:05",
		"02-Jan-2006 15:04:05 MST",
		"02-Jan-2006",
		"2006-01-02",
		"2006.01.02 15:04:05",
		"2006.01.02",
	}
	var last error
	for _, layout := range layouts {
		when, err := time.Parse(layout, value)
		if err == nil {
			return when.UTC(), nil
		}
		last = err
	}
	if last == nil {
		last = fmt.Errorf("unparsed")
	}
	return time.Time{}, last
}

func rdapAutoRenew(status []string) *bool {
	for _, item := range status {
		lower := strings.ToLower(item)
		if strings.Contains(lower, "auto renew") || strings.Contains(lower, "autorenew") {
			flag := !strings.Contains(lower, "prohibited") && !strings.Contains(lower, "disabled")
			return &flag
		}
	}
	return nil
}

func expiryPublicRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 3 {
		return fmt.Errorf("too many redirects")
	}
	host := req.URL.Hostname()
	if host == "" {
		return fmt.Errorf("redirect host missing")
	}
	if ip := net.ParseIP(host); ip != nil && !ipIsPublicForProbe(ip) {
		return fmt.Errorf("redirect to a private address is not allowed")
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(req.Context(), host)
	if err != nil {
		return err
	}
	for _, addr := range addrs {
		if !ipIsPublicForProbe(addr.IP) {
			return fmt.Errorf("redirect to a private address is not allowed")
		}
	}
	return nil
}
