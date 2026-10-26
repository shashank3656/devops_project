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
	Events      []rdapEvent `json:"events"`
	SecureDNS   rdapDNS     `json:"secureDNS"`
	Status      []string    `json:"status"`
	LDHName     string      `json:"ldhName"`
	UnicodeName string      `json:"unicodeName"`
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://rdap.org/domain/"+ascii, nil)
	if err != nil {
		obs.ErrorClass = "unknown"
		obs.Detail = "RDAP request could not be built."
		obs.Assessment = "unknown"
		return obs
	}
	req.Header.Set("Accept", "application/rdap+json, application/json")
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: expiryPublicRedirect}
	res, err := client.Do(req)
	if err != nil {
		obs.ErrorClass = "unreachable"
		obs.Detail = "RDAP could not be reached. Domain expiry stays Unknown."
		obs.Assessment = "unknown"
		return obs
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		obs.ErrorClass = "unknown"
		obs.Detail = "RDAP response could not be read. Domain expiry stays Unknown."
		obs.Assessment = "unknown"
		return obs
	}
	if res.StatusCode >= 400 {
		obs.ErrorClass = "unknown"
		obs.Detail = fmt.Sprintf("RDAP returned no expiry date (%d). Domain expiry stays Unknown.", res.StatusCode)
		obs.Assessment = "unknown"
		return obs
	}
	var parsed rdapResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		obs.ErrorClass = "unknown"
		obs.Detail = "RDAP returned unstructured data. Domain expiry stays Unknown."
		obs.Assessment = "unknown"
		return obs
	}
	registrar, registry := rdapExpiryDates(parsed.Events)
	obs.RegistrarExpires = registrar
	obs.RegistryExpires = registry
	if registrar == nil && registry == nil {
		obs.ErrorClass = "unknown"
		obs.Detail = "RDAP did not include an expiration date. Domain expiry stays Unknown."
		obs.Assessment = "unknown"
		return obs
	}
	if registrar != nil && registry != nil && !registrar.Equal(*registry) {
		obs.ErrorClass = "conflict"
		obs.Detail = "Registrar and registry expiry differ. Both dates are stored."
	} else {
		obs.Detail = "RDAP registration expiry. Auto-renew is not proof of completed renewal."
	}
	auto := rdapAutoRenew(parsed.Status)
	obs.AutoRenew = auto
	obs.RawSummary = fmt.Sprintf("domain=%s source=rdap.org", ascii)
	return obs
}

func rdapExpiryDates(events []rdapEvent) (registrar *time.Time, registry *time.Time) {
	for _, event := range events {
		when, err := time.Parse(time.RFC3339, strings.TrimSpace(event.Date))
		if err != nil {
			when, err = time.Parse("2006-01-02T15:04:05Z07:00", strings.TrimSpace(event.Date))
		}
		if err != nil {
			continue
		}
		utc := when.UTC()
		switch strings.ToLower(strings.TrimSpace(event.Action)) {
		case "expiration":
			if registry == nil {
				copyTime := utc
				registry = &copyTime
			}
		case "registrar expiration", "expiration date":
			copyTime := utc
			registrar = &copyTime
		}
	}
	return registrar, registry
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
