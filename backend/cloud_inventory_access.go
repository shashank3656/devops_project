package main

import "strings"

func devopsUserCanViewInventoryTeam(visibleTeamSlugs []string, resourceTeamSlug string) bool {
	resourceTeamSlug = strings.TrimSpace(resourceTeamSlug)
	if resourceTeamSlug == "" || len(visibleTeamSlugs) == 0 {
		return false
	}
	for _, slug := range visibleTeamSlugs {
		if strings.EqualFold(strings.TrimSpace(slug), resourceTeamSlug) {
			return true
		}
	}
	return false
}

// resolveInventoryTeamFilter returns the team slug to filter by, or empty to mean all visible teams.
// ok is false when the requested team is not visible to the user.
func resolveInventoryTeamFilter(requestedTeam string, visibleTeamSlugs []string) (team string, ok bool) {
	requestedTeam = strings.TrimSpace(requestedTeam)
	if len(visibleTeamSlugs) == 0 {
		return "", false
	}
	if requestedTeam == "" {
		return "", true
	}
	if devopsUserCanViewInventoryTeam(visibleTeamSlugs, requestedTeam) {
		return requestedTeam, true
	}
	return "", false
}
