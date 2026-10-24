package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	vulnSevCritical = "critical"
	vulnSevHigh     = "high"
	vulnSevMedium   = "medium"
	vulnSevLow      = "low"
	vulnSevUnknown  = "unknown"

	vulnConfidenceConfirmed = "confirmed"
	vulnConfidencePotential = "potential"
	vulnConfidenceNeedsVer  = "needs_verification"

	vulnLifeOpen      = "open"
	vulnLifeAcked     = "acknowledged"
	vulnLifeRemediate = "in_remediation"
	vulnLifePending   = "pending_verification"
	vulnLifeFixed     = "fixed"
	vulnLifeAccepted  = "risk_accepted"
	vulnLifeFalsePos  = "false_positive"
	vulnLifeMitigated = "mitigated"
	vulnLifeWithdrawn = "withdrawn"

	vulnReachImported    = "imported"
	vulnReachNotImported = "not_imported"
	vulnReachUnknown     = "unknown"

	vulnMatchScan  = "scan"
	vulnMatchIntel = "intel"

	vulnPatchUnknown   = "unknown"
	vulnPatchNone      = "no_known_fix"
	vulnPatchAvailable = "fix_available"
	vulnPatchPRLinked  = "pr_linked"
	vulnPatchMerged    = "merged_awaiting_scan"
	vulnPatchRepoOK    = "repository_verified"
	vulnPatchDeployPen = "deployment_verification_pending"
	vulnPatchDeployOK  = "deployment_verified"

	vulnPriorityEmergency = "emergency"
	vulnPriorityUrgent    = "urgent"
	vulnPriorityHigh      = "high"
	vulnPriorityReview    = "review"
)

type vulnAffectedRange struct {
	Ecosystem    string `json:"ecosystem"`
	Package      string `json:"package"`
	Introduced   string `json:"introduced,omitempty"`
	Fixed        string `json:"fixed,omitempty"`
	LastAffected string `json:"last_affected,omitempty"`
	RangeText    string `json:"range_text,omitempty"`
}

type vulnComponent struct {
	Ecosystem     string `json:"ecosystem"`
	PackageName   string `json:"package_name"`
	Version       string `json:"version"`
	PURL          string `json:"purl,omitempty"`
	Path          string `json:"path"`
	ModulePath    string `json:"module_path"`
	Direct        bool   `json:"direct"`
	Dev           bool   `json:"dev"`
	Resolved      bool   `json:"resolved"`
	ParentPackage string `json:"parent_package,omitempty"`
	Usage         string `json:"usage,omitempty"`
	Reachability  string `json:"reachability,omitempty"`
}

type vulnCoverageGap struct {
	Path    string `json:"path"`
	Reason  string `json:"reason"`
	Adapter string `json:"adapter,omitempty"`
}

type vulnMatch struct {
	Component     vulnComponent
	CanonicalID   string
	Title         string
	Severity      string
	KEV           bool
	Confidence    string
	FirstFixed    string
	Recommended   string
	PatchState    string
	Priority      string
	PriorityWhy   string
	ParentPackage string
}

type vulnAdvisoryRecord struct {
	CanonicalID  string
	Aliases      []string
	Title        string
	Summary      string
	Severity     string
	CVSSScore    float64
	CVSSVector   string
	CVSSProvider string
	Ranges       []vulnAffectedRange
	FirstFixed   string
	KEV          bool
	Source       string
	SourceURL    string
	Withdrawn    bool
	Revision     string
}

type vulnPlanGroup struct {
	Ecosystem   string
	PackageName string
	ModulePath  string
	Current     string
	Target      string
	Action      string
	Status      string
	FindingKeys []string
	Estimated   bool
}

var (
	semverToken = regexp.MustCompile(`v?(\d+)\.(\d+)\.(\d+)`)
	cmpToken    = regexp.MustCompile(`^(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,3})`)
)

func canonicalizeAdvisoryIDs(ids ...string) (string, []string) {
	seen := map[string]bool{}
	aliases := make([]string, 0, len(ids))
	var ghsa, cve, osv, other string
	for _, raw := range ids {
		id := strings.ToUpper(strings.TrimSpace(raw))
		id = strings.ReplaceAll(id, " ", "")
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		aliases = append(aliases, id)
		switch {
		case strings.HasPrefix(id, "GHSA-") && ghsa == "":
			ghsa = id
		case strings.HasPrefix(id, "CVE-") && cve == "":
			cve = id
		case strings.HasPrefix(id, "OSV-") || strings.HasPrefix(id, "PYSEC-") || strings.HasPrefix(id, "GO-"):
			if osv == "" {
				osv = id
			}
		default:
			if other == "" {
				other = id
			}
		}
	}
	canonical := ghsa
	if canonical == "" {
		canonical = cve
	}
	if canonical == "" {
		canonical = osv
	}
	if canonical == "" {
		canonical = other
	}
	return canonical, aliases
}

func normalizeEcosystem(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "npm", "javascript", "typescript", "node", "nodejs":
		return "npm"
	case "maven", "java", "kotlin", "gradle":
		return "maven"
	case "pip", "pypi", "python":
		return "pypi"
	case "go", "golang", "gomod":
		return "go"
	case "nuget", "dotnet", "csharp":
		return "nuget"
	case "composer", "packagist", "php":
		return "packagist"
	case "rubygems", "ruby", "gem":
		return "rubygems"
	case "rust", "cargo", "crates.io", "crates":
		return "cargo"
	case "pub", "dart":
		return "pub"
	case "hex", "elixir", "erlang":
		return "hex"
	case "alpine", "apk":
		return "alpine"
	case "deb", "debian", "ubuntu":
		return "deb"
	case "rpm", "fedora", "rhel":
		return "rpm"
	default:
		return strings.ToLower(strings.TrimSpace(raw))
	}
}

func normalizePackageName(ecosystem, name string) string {
	value := strings.TrimSpace(name)
	switch normalizeEcosystem(ecosystem) {
	case "npm":
		return strings.ToLower(value)
	case "pypi":
		value = strings.ToLower(value)
		value = strings.ReplaceAll(value, "_", "-")
		value = strings.ReplaceAll(value, ".", "-")
		return value
	case "maven":
		return strings.ToLower(value)
	default:
		return value
	}
}

func parseGitHubVersionRange(ecosystem, pkg, raw, firstPatched string) vulnAffectedRange {
	item := vulnAffectedRange{
		Ecosystem: normalizeEcosystem(ecosystem),
		Package:   normalizePackageName(ecosystem, pkg),
		RangeText: strings.TrimSpace(raw),
		Fixed:     strings.TrimSpace(firstPatched),
	}
	text := strings.ReplaceAll(item.RangeText, ",", " ")
	parts := strings.Fields(text)
	for i := 0; i < len(parts); i++ {
		token := parts[i]
		if i+1 < len(parts) && (token == ">=" || token == ">" || token == "<=" || token == "<" || token == "=") {
			token += parts[i+1]
			i++
		}
		match := cmpToken.FindStringSubmatch(token)
		if match == nil {
			continue
		}
		op, ver := match[1], match[2]
		if op == "" {
			op = "="
		}
		switch op {
		case ">=", ">", "=":
			if item.Introduced == "" {
				item.Introduced = ver
			}
		case "<":
			if item.Fixed == "" {
				item.Fixed = ver
			}
		case "<=":
			item.LastAffected = ver
		}
	}
	if item.Fixed == "" {
		item.Fixed = strings.TrimSpace(firstPatched)
	}
	return item
}

func versionInRange(version string, rng vulnAffectedRange) (hit bool, reason string) {
	version = strings.TrimSpace(strings.TrimPrefix(version, "v"))
	if version == "" {
		return false, "installed version is unresolved"
	}
	if rng.Introduced != "" {
		if cmpVersion(version, rng.Introduced) < 0 {
			return false, "below introduced version"
		}
	}
	if rng.Fixed != "" {
		if cmpVersion(version, rng.Fixed) >= 0 {
			return false, "at or beyond fixed version"
		}
		return true, "within affected range"
	}
	if rng.LastAffected != "" {
		if cmpVersion(version, rng.LastAffected) <= 0 {
			return true, "at or below last affected version"
		}
		return false, "beyond last affected version"
	}
	if rng.RangeText != "" && rng.Introduced == "" {
		return false, "affected range could not be parsed"
	}
	return true, "advisory listed this package without a bounded range"
}

func cmpVersion(left, right string) int {
	a := parseVersionParts(left)
	b := parseVersionParts(right)
	for i := 0; i < 3; i++ {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	return 0
}

func parseVersionParts(raw string) [3]int {
	out := [3]int{}
	match := semverToken.FindStringSubmatch(strings.TrimSpace(raw))
	if match == nil {
		fields := strings.Split(strings.TrimPrefix(strings.TrimSpace(raw), "v"), ".")
		for i := 0; i < len(fields) && i < 3; i++ {
			n, _ := strconv.Atoi(regexp.MustCompile(`^\d+`).FindString(fields[i]))
			out[i] = n
		}
		return out
	}
	out[0], _ = strconv.Atoi(match[1])
	out[1], _ = strconv.Atoi(match[2])
	out[2], _ = strconv.Atoi(match[3])
	return out
}

func severityFromScore(score float64, label string) string {
	text := strings.ToLower(strings.TrimSpace(label))
	switch text {
	case vulnSevCritical, vulnSevHigh, vulnSevMedium, vulnSevLow:
		if score <= 0 {
			return text
		}
	}
	switch {
	case score >= 9:
		return vulnSevCritical
	case score >= 7:
		return vulnSevHigh
	case score >= 4:
		return vulnSevMedium
	case score > 0:
		return vulnSevLow
	case text != "":
		return text
	default:
		return vulnSevUnknown
	}
}

func patchStateForFix(fixed string) string {
	if strings.TrimSpace(fixed) == "" {
		return vulnPatchNone
	}
	return vulnPatchAvailable
}

func priorityForMatch(severity string, kev, confirmed bool) (string, string) {
	if !confirmed {
		return vulnPriorityReview, "Applicability still needs evidence; this is not counted as confirmed exposure."
	}
	if kev && severity == vulnSevCritical {
		return vulnPriorityUrgent, "Confirmed match with known exploitation (KEV) and Critical severity."
	}
	if kev {
		return vulnPriorityUrgent, "Confirmed match listed in CISA KEV."
	}
	if severity == vulnSevCritical {
		return vulnPriorityUrgent, "Confirmed Critical dependency match."
	}
	if severity == vulnSevHigh {
		return vulnPriorityHigh, "Confirmed High dependency match."
	}
	return vulnPriorityReview, "Confirmed match without a Critical or High rating."
}

func correlateInventory(components []vulnComponent, advisories []vulnAdvisoryRecord) []vulnMatch {
	out := make([]vulnMatch, 0)
	seen := map[string]bool{}
	for _, component := range components {
		if component.Usage == "declared_runtime" || component.Usage == "image_tag" {
			continue
		}
		eco := normalizeEcosystem(component.Ecosystem)
		pkg := normalizePackageName(eco, component.PackageName)
		for _, advisory := range advisories {
			if advisory.Withdrawn {
				continue
			}
			for _, rng := range advisory.Ranges {
				if normalizeEcosystem(rng.Ecosystem) != eco {
					continue
				}
				if normalizePackageName(eco, rng.Package) != pkg {
					continue
				}
				canonical, _ := canonicalizeAdvisoryIDs(append(advisory.Aliases, advisory.CanonicalID)...)
				key := strings.Join([]string{eco, pkg, component.Path, canonical}, "|")
				if seen[key] {
					continue
				}
				match := vulnMatch{
					Component:     component,
					CanonicalID:   canonical,
					Title:         advisory.Title,
					Severity:      severityFromScore(advisory.CVSSScore, advisory.Severity),
					KEV:           advisory.KEV,
					FirstFixed:    firstNonEmpty(rng.Fixed, advisory.FirstFixed),
					ParentPackage: component.ParentPackage,
				}
				if !component.Resolved || strings.TrimSpace(component.Version) == "" {
					match.Confidence = vulnConfidenceNeedsVer
					match.Priority = vulnPriorityReview
					match.PriorityWhy = "Manifest listed this package without a resolved installed version."
					match.PatchState = patchStateForFix(match.FirstFixed)
					match.Recommended = match.FirstFixed
					seen[key] = true
					out = append(out, match)
					continue
				}
				hit, why := versionInRange(component.Version, rng)
				if !hit {
					continue
				}
				match.Confidence = vulnConfidenceConfirmed
				match.PatchState = patchStateForFix(match.FirstFixed)
				match.Recommended = match.FirstFixed
				if component.ParentPackage != "" && !component.Direct {
					match.ParentPackage = component.ParentPackage
				}
				match.Priority, match.PriorityWhy = priorityForMatch(match.Severity, match.KEV, true)
				_ = why
				seen[key] = true
				out = append(out, match)
			}
		}
	}
	return out
}

func severityLabel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case vulnSevCritical:
		return "Critical"
	case vulnSevHigh:
		return "High"
	case vulnSevMedium:
		return "Medium"
	case vulnSevLow:
		return "Low"
	default:
		return "Unknown"
	}
}

func groupPatchPlans(matches []vulnMatch) []vulnPlanGroup {
	index := map[string]*vulnPlanGroup{}
	order := make([]string, 0)
	for _, match := range matches {
		if match.Confidence != vulnConfidenceConfirmed {
			continue
		}
		target := match.Recommended
		if target == "" {
			target = match.FirstFixed
		}
		if target == "" {
			continue
		}
		action := "direct_upgrade"
		pkg := match.Component.PackageName
		current := match.Component.Version
		if match.ParentPackage != "" && !match.Component.Direct {
			action = "parent_upgrade"
			pkg = match.ParentPackage
		}
		key := strings.Join([]string{match.Component.ModulePath, match.Component.Ecosystem, pkg, target}, "|")
		item, ok := index[key]
		if !ok {
			item = &vulnPlanGroup{
				Ecosystem:   match.Component.Ecosystem,
				PackageName: pkg,
				ModulePath:  match.Component.ModulePath,
				Current:     current,
				Target:      target,
				Action:      action,
				Status:      "tests_required",
				Estimated:   true,
			}
			index[key] = item
			order = append(order, key)
		}
		findingKey := fmt.Sprintf("%s:%s@%s", match.CanonicalID, match.Component.PackageName, match.Component.Version)
		item.FindingKeys = append(item.FindingKeys, findingKey)
	}
	out := make([]vulnPlanGroup, 0, len(order))
	for _, key := range order {
		out = append(out, *index[key])
	}
	return out
}

func encodeJSONString(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func decodeAffectedJSON(raw string) []vulnAffectedRange {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []vulnAffectedRange
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

func findingKey(repoID int, branch, module, eco, pkg, canonical string) string {
	return fmt.Sprintf("%d|%s|%s|%s|%s|%s", repoID, branch, module, eco, pkg, canonical)
}

func nextLifecycle(current, want, reason string) (string, string) {
	want = strings.ToLower(strings.TrimSpace(want))
	current = strings.ToLower(strings.TrimSpace(current))
	if want == "" || want == current {
		return current, ""
	}
	if want == vulnLifeFixed {
		return current, "Fixed is only set after a successful scoped rescan."
	}
	switch want {
	case vulnLifeAcked, vulnLifeRemediate, vulnLifePending, vulnLifeAccepted, vulnLifeFalsePos, vulnLifeMitigated:
		if (want == vulnLifeAccepted || want == vulnLifeFalsePos || want == vulnLifeMitigated) && strings.TrimSpace(reason) == "" {
			return current, "This disposition needs a reason."
		}
		return want, ""
	default:
		return current, "That lifecycle transition is not allowed."
	}
}
