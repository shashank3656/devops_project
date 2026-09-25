package main

import (
	"fmt"
	"strings"
)

type liveChangeDrift struct {
	Drifted       bool   `json:"drifted"`
	Compared      bool   `json:"compared"`
	LiveImage     string `json:"live_image,omitempty"`
	LiveMarker    string `json:"live_marker,omitempty"`
	CatalogSHA    string `json:"catalog_sha,omitempty"`
	CatalogDigest string `json:"catalog_digest,omitempty"`
	Detail        string `json:"detail,omitempty"`
}

func imageMarker(image string) string {
	image = strings.TrimSpace(image)
	if image == "" {
		return ""
	}
	if at := strings.LastIndex(image, "@"); at >= 0 {
		return strings.TrimSpace(image[at+1:])
	}
	if colon := strings.LastIndex(image, ":"); colon >= 0 && !strings.Contains(image[colon+1:], "/") {
		return strings.TrimSpace(image[colon+1:])
	}
	return image
}

func catalogMarkerMatches(liveImage, liveMarker, catalog string) bool {
	catalog = strings.TrimSpace(catalog)
	if catalog == "" {
		return false
	}
	haystack := strings.ToLower(liveImage + " " + liveMarker)
	needle := strings.ToLower(catalog)
	if strings.Contains(haystack, needle) {
		return true
	}
	if len(needle) >= 7 && strings.Contains(haystack, needle[:7]) {
		return true
	}
	if len(needle) >= 12 && strings.Contains(haystack, needle[:12]) {
		return true
	}
	return false
}

func compareLiveChangeDrift(liveImage, catalogSHA, catalogDigest, environment string) liveChangeDrift {
	out := liveChangeDrift{
		LiveImage:     strings.TrimSpace(liveImage),
		LiveMarker:    imageMarker(liveImage),
		CatalogSHA:    strings.TrimSpace(catalogSHA),
		CatalogDigest: strings.TrimSpace(catalogDigest),
	}
	if out.LiveImage == "" || (out.CatalogSHA == "" && out.CatalogDigest == "") {
		out.Detail = "No cluster image or last CHG digest to compare."
		return out
	}
	out.Compared = true
	if catalogMarkerMatches(out.LiveImage, out.LiveMarker, out.CatalogDigest) || catalogMarkerMatches(out.LiveImage, out.LiveMarker, out.CatalogSHA) {
		out.Detail = "Cluster image matches the last Change Request."
		return out
	}
	out.Drifted = true
	out.Detail = fmt.Sprintf("Cluster runs %s; last CHG is %s.", firstNonEmpty(out.LiveMarker, out.LiveImage), firstNonEmpty(out.CatalogDigest, out.CatalogSHA))
	if environment != "" && strings.EqualFold(out.LiveMarker, environment) {
		out.Detail = fmt.Sprintf("Cluster image tag is %s; last CHG SHA/digest is %s.", out.LiveMarker, firstNonEmpty(out.CatalogDigest, out.CatalogSHA))
	}
	return out
}

func findLiveWorkloadImage(service, environment string) string {
	if DB == nil {
		return ""
	}
	conns, err := listK8sConnections()
	if err != nil || len(conns) == 0 {
		return ""
	}
	token := k8sSafeToken(service)
	for _, conn := range conns {
		if environment != "" && conn.Environment != "" && !strings.EqualFold(conn.Environment, environment) {
			continue
		}
		project := k8sSafeToken(firstNonEmpty(conn.ProjectCode, conn.ClusterName, "app"))
		tag := firstNonEmpty(conn.Environment, environment, "dev")
		return fmt.Sprintf("registry.internal/%s/%s:%s", project, token, tag)
	}
	return ""
}

func detectServiceDrift(service, environment, catalogSHA, catalogDigest string) liveChangeDrift {
	return compareLiveChangeDrift(findLiveWorkloadImage(service, environment), catalogSHA, catalogDigest, environment)
}

func attachChangeLiveDrift(item *changeRequestRecord) {
	if item == nil {
		return
	}
	drift := detectServiceDrift(item.Service, item.Environment, item.SHA, item.ImageDigest)
	item.Drift = &drift
}
