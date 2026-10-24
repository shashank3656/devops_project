package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCanonicalizeAdvisoryAliases(t *testing.T) {
	canonical, aliases := canonicalizeAdvisoryIDs("CVE-2026-1111", "GHSA-aaaa-bbbb-cccc", "CVE-2026-1111")
	if canonical != "GHSA-AAAA-BBBB-CCCC" {
		t.Fatalf("canonical = %q", canonical)
	}
	if len(aliases) != 2 {
		t.Fatalf("aliases = %v", aliases)
	}
}

func TestVersionRangeMatchAndFixBoundary(t *testing.T) {
	rng := parseGitHubVersionRange("npm", "demo-http-client", ">= 2.4.0 < 2.4.2", "2.4.2")
	hit, _ := versionInRange("2.4.0", rng)
	if !hit {
		t.Fatal("2.4.0 should be affected")
	}
	hit, _ = versionInRange("2.4.1", rng)
	if !hit {
		t.Fatal("2.4.1 should be affected")
	}
	hit, why := versionInRange("2.4.2", rng)
	if hit {
		t.Fatalf("fixed version must not match: %s", why)
	}
}

func TestNpmDoesNotMatchPythonSameName(t *testing.T) {
	components := []vulnComponent{{
		Ecosystem: "npm", PackageName: "demo-http-client", Version: "2.4.0", Path: "package-lock.json", Resolved: true, Direct: true,
	}}
	advisories := []vulnAdvisoryRecord{{
		CanonicalID: "CVE-2026-1",
		Title:       "Python only",
		Severity:    "critical",
		Ranges: []vulnAffectedRange{{
			Ecosystem: "pypi", Package: "demo-http-client", Introduced: "0", Fixed: "3.0.0",
		}},
	}}
	if got := correlateInventory(components, advisories); len(got) != 0 {
		t.Fatalf("cross-ecosystem match = %+v", got)
	}
}

func TestConfirmedMatchAndUnaffectedFix(t *testing.T) {
	advisory := vulnAdvisoryRecord{
		CanonicalID: "GHSA-DEMO-HTTP",
		Aliases:     []string{"GHSA-DEMO-HTTP", "CVE-2026-4242"},
		Title:       "demo-http-client before 2.4.2",
		Severity:    "high",
		CVSSScore:   7.5,
		FirstFixed:  "2.4.2",
		Ranges: []vulnAffectedRange{
			parseGitHubVersionRange("npm", "demo-http-client", "< 2.4.2", "2.4.2"),
		},
	}
	vulnerable := correlateInventory([]vulnComponent{{
		Ecosystem: "npm", PackageName: "demo-http-client", Version: "2.4.0", Path: "apps/api/package-lock.json",
		ModulePath: "apps/api", Resolved: true, Direct: false, ParentPackage: "demo-sdk",
	}}, []vulnAdvisoryRecord{advisory})
	if len(vulnerable) != 1 || vulnerable[0].Confidence != vulnConfidenceConfirmed {
		t.Fatalf("vulnerable = %+v", vulnerable)
	}
	if vulnerable[0].FirstFixed != "2.4.2" || vulnerable[0].Recommended != "2.4.2" {
		t.Fatalf("fix fields = %+v", vulnerable[0])
	}
	if vulnerable[0].ParentPackage != "demo-sdk" {
		t.Fatalf("parent = %q", vulnerable[0].ParentPackage)
	}
	fixed := correlateInventory([]vulnComponent{{
		Ecosystem: "npm", PackageName: "demo-http-client", Version: "2.4.2", Path: "apps/api/package-lock.json", ModulePath: "apps/api", Resolved: true, Direct: true,
	}}, []vulnAdvisoryRecord{advisory})
	if len(fixed) != 0 {
		t.Fatalf("fixed version still matched: %+v", fixed)
	}
}

func TestUnresolvedMavenIsCoverageNotVersion(t *testing.T) {
	parsed := parsePOM("backend/pom.xml", "backend", `<project><dependencies><dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>${core.version}</version></dependency></dependencies></project>`)
	if len(parsed.Components) != 1 || parsed.Components[0].Resolved || parsed.Components[0].Version != "" {
		t.Fatalf("unresolved component = %+v", parsed.Components)
	}
	if len(parsed.Coverage) == 0 {
		t.Fatal("expected coverage gap for BOM/property version")
	}
	matches := correlateInventory(parsed.Components, []vulnAdvisoryRecord{{
		CanonicalID: "CVE-2026-MAVEN",
		Severity:    "high",
		Ranges:      []vulnAffectedRange{{Ecosystem: "maven", Package: "com.acme:core", Introduced: "0", Fixed: "2.0.0"}},
	}})
	if len(matches) != 1 || matches[0].Confidence != vulnConfidenceNeedsVer {
		t.Fatalf("unresolved match = %+v", matches)
	}
}

func TestGlobalAdvisoryIsNotExposure(t *testing.T) {
	matches := correlateInventory(nil, []vulnAdvisoryRecord{{
		CanonicalID: "CVE-2026-9999",
		Title:       "Public critical advisory",
		Severity:    "critical",
		CVSSScore:   9.8,
		Ranges:      []vulnAffectedRange{{Ecosystem: "npm", Package: "left-pad", Introduced: "0", Fixed: "1.3.0"}},
	}})
	if len(matches) != 0 {
		t.Fatalf("empty inventory must not create repository findings: %+v", matches)
	}
}

func TestNpmLockTransitiveAndDirect(t *testing.T) {
	raw := `{
	  "packages": {
	    "": {"name": "checkout-api"},
	    "node_modules/demo-sdk": {"version": "1.0.0"},
	    "node_modules/demo-sdk/node_modules/demo-http-client": {"version": "2.4.0"}
	  }
	}`
	parsed := parseNPMLock("package-lock.json", "", raw)
	if len(parsed.Components) != 2 {
		t.Fatalf("components = %+v", parsed.Components)
	}
	var nested *vulnComponent
	for i := range parsed.Components {
		if parsed.Components[i].PackageName == "demo-http-client" {
			nested = &parsed.Components[i]
		}
	}
	if nested == nil || nested.Direct || nested.ParentPackage != "demo-sdk" {
		t.Fatalf("nested = %+v", nested)
	}
}

func TestPatchPlanGroupsParentUpgrade(t *testing.T) {
	matches := []vulnMatch{
		{
			CanonicalID: "GHSA-1", Confidence: vulnConfidenceConfirmed, FirstFixed: "2.4.2", Recommended: "2.4.2",
			Component: vulnComponent{Ecosystem: "npm", PackageName: "demo-http-client", Version: "2.4.0", ModulePath: "apps/api", Direct: false, ParentPackage: "demo-sdk"},
			ParentPackage: "demo-sdk",
		},
		{
			CanonicalID: "GHSA-2", Confidence: vulnConfidenceConfirmed, FirstFixed: "2.4.2", Recommended: "2.4.2",
			Component: vulnComponent{Ecosystem: "npm", PackageName: "demo-http-client", Version: "2.4.1", ModulePath: "apps/api", Direct: false, ParentPackage: "demo-sdk"},
			ParentPackage: "demo-sdk",
		},
	}
	plans := groupPatchPlans(matches)
	if len(plans) != 1 {
		t.Fatalf("plans = %+v", plans)
	}
	if plans[0].Action != "parent_upgrade" || plans[0].PackageName != "demo-sdk" || len(plans[0].FindingKeys) != 2 {
		t.Fatalf("group = %+v", plans[0])
	}
	if !plans[0].Estimated || plans[0].Status != "tests_required" {
		t.Fatalf("must remain estimated until tests exist: %+v", plans[0])
	}
}

func TestLifecycleRejectsDirectFixed(t *testing.T) {
	next, problem := nextLifecycle(vulnLifeOpen, vulnLifeFixed, "done")
	if next != vulnLifeOpen || problem == "" {
		t.Fatalf("direct fixed must be rejected, got %q %q", next, problem)
	}
	next, problem = nextLifecycle(vulnLifeOpen, vulnLifeAcked, "")
	if next != vulnLifeAcked || problem != "" {
		t.Fatalf("ack = %q %q", next, problem)
	}
}

func TestYarnLockParsesResolvedVersion(t *testing.T) {
	parsed := parseVulnArtifact("frontend/yarn.lock", "demo-http-client@^2.4.0:\n  version \"2.4.0\"\n")
	if len(parsed.Components) != 1 || parsed.Components[0].PackageName != "demo-http-client" || parsed.Components[0].Version != "2.4.0" {
		t.Fatalf("yarn = %+v", parsed.Components)
	}
}

func TestBunLockbRemainsCoverageGap(t *testing.T) {
	parsed := parseVulnArtifact("apps/web/bun.lockb", "binary")
	if len(parsed.Components) != 0 || len(parsed.Coverage) == 0 {
		t.Fatalf("bun.lockb coverage = %+v", parsed)
	}
}

func TestDockerfileMutableTagIsCoverageNotMatch(t *testing.T) {
	parsed := parseVulnArtifact("Dockerfile", "FROM node:20\n")
	if len(parsed.Components) != 1 || parsed.Components[0].Usage != "image_tag" || parsed.Components[0].Resolved {
		t.Fatalf("dockerfile = %+v", parsed.Components)
	}
	if len(parsed.Coverage) == 0 {
		t.Fatal("mutable tag must stay a coverage gap")
	}
	matches := correlateInventory(parsed.Components, []vulnAdvisoryRecord{{
		CanonicalID: "CVE-IMAGE",
		Severity:    "high",
		Ranges:      []vulnAffectedRange{{Ecosystem: "image", Package: "node:20", Introduced: "0", Fixed: "21"}},
	}})
	if len(matches) != 0 {
		t.Fatalf("declared image tags must not confirm findings: %+v", matches)
	}
}

func TestSBOMImagePackageCanMatch(t *testing.T) {
	parsed := parseSBOM("image.cdx.json", "", `{
		"components":[{"name":"busybox","version":"1.36.1","purl":"pkg:apk/busybox@1.36.1","type":"operating-system"}]
	}`)
	if len(parsed.Components) != 1 || parsed.Components[0].Usage != "image" || parsed.Components[0].Ecosystem != "alpine" {
		t.Fatalf("sbom = %+v", parsed.Components)
	}
	matches := correlateInventory(parsed.Components, []vulnAdvisoryRecord{{
		CanonicalID: "CVE-BUSYBOX",
		Severity:    "high",
		Ranges:      []vulnAffectedRange{{Ecosystem: "alpine", Package: "busybox", Introduced: "0", Fixed: "1.36.2"}},
	}})
	if len(matches) != 1 || matches[0].Confidence != vulnConfidenceConfirmed {
		t.Fatalf("image sbom match = %+v", matches)
	}
}

func TestDeclaredRuntimeIsNotAFinding(t *testing.T) {
	parsed := parseVulnArtifact("package.json", `{"engines":{"node":"20.11.0"}}`)
	if len(parsed.Components) != 1 || parsed.Components[0].Usage != "declared_runtime" {
		t.Fatalf("engines = %+v", parsed)
	}
	if got := correlateInventory(parsed.Components, []vulnAdvisoryRecord{{
		CanonicalID: "CVE-NODE", Severity: "critical",
		Ranges: []vulnAffectedRange{{Ecosystem: "node", Package: "node", Introduced: "0", Fixed: "20.12.0"}},
	}}); len(got) != 0 {
		t.Fatalf("declared runtime matched: %+v", got)
	}
}

func TestPRCompareClassifiesIntroducedAndIncomplete(t *testing.T) {
	advisory := vulnAdvisoryRecord{
		CanonicalID: "GHSA-PR", Severity: "critical",
		Ranges: []vulnAffectedRange{{Ecosystem: "npm", Package: "demo-http-client", Introduced: "0", Fixed: "2.4.2"}},
	}
	base := correlateInventory([]vulnComponent{{Ecosystem: "npm", PackageName: "left-pad", Version: "1.0.0", Resolved: true}}, []vulnAdvisoryRecord{advisory})
	head := correlateInventory([]vulnComponent{{Ecosystem: "npm", PackageName: "demo-http-client", Version: "2.4.0", Path: "package-lock.json", Resolved: true}}, []vulnAdvisoryRecord{advisory})
	items := compareVulnMatches(base, head)
	if len(items) != 1 || items[0]["classification"] != "introduced" {
		t.Fatalf("compare = %+v", items)
	}
	if classifyPRFinding("introduced", "incomplete") != "not_comparable" {
		t.Fatal("incomplete coverage must never be a clean introduced verdict")
	}
	if classifyPRFinding("removed", "incomplete") != "removed" {
		t.Fatal("removed stays removed")
	}
}

func TestAgentCannotClaimOtherTenantJob(t *testing.T) {
	if vulnAgentOwnsJob(5, 9) {
		t.Fatal("agent for project 5 must not claim project 9")
	}
	if !vulnAgentOwnsJob(5, 5) {
		t.Fatal("agent should claim its own project")
	}
	if vulnAgentOwnsJob(0, 5) {
		t.Fatal("unscoped agent must not claim a project job")
	}
}

func TestAgentTokenHashNeverEqualsRaw(t *testing.T) {
	raw := "ost_agent_demo"
	got := hashVulnToken(raw)
	if got == raw || strings.Contains(got, "ost_agent") {
		t.Fatalf("hash leaked token material: %s", got)
	}
	if hashVulnToken(raw) != got {
		t.Fatal("hash must be stable")
	}
}

func TestGoModIndirect(t *testing.T) {
	parsed := parseGoMod("go.mod", "", "module example.com/app\n\nrequire (\n\tgithub.com/foo/bar v1.2.3 // indirect\n)\n")
	if len(parsed.Components) != 1 || parsed.Components[0].Direct || parsed.Components[0].Version != "1.2.3" {
		t.Fatalf("go.mod = %+v", parsed.Components)
	}
}

func TestParseGitHubAdvisoriesKeepsAliases(t *testing.T) {
	body := []byte(`[{
		"ghsa_id":"GHSA-aaaa-bbbb-cccc",
		"cve_id":"CVE-2026-1111",
		"html_url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
		"summary":"demo-http-client affected",
		"severity":"high",
		"cvss":{"score":7.5,"vector_string":"CVSS:3.1/AV:N"},
		"vulnerabilities":[{
			"package":{"ecosystem":"npm","name":"demo-http-client"},
			"vulnerable_version_range":"< 2.4.2",
			"first_patched_version":{"identifier":"2.4.2"}
		}]
	}]`)
	items := parseGitHubAdvisories(body)
	if len(items) != 1 || items[0].CanonicalID != "GHSA-AAAA-BBBB-CCCC" {
		t.Fatalf("parsed = %+v", items)
	}
	if items[0].FirstFixed != "2.4.2" || items[0].Severity != vulnSevHigh {
		t.Fatalf("fields = %+v", items[0])
	}
}

func TestConnectorPublicStillOmitsSecretsForVulnJSON(t *testing.T) {
	overview := vulnOverview(0)
	raw, _ := json.Marshal(overview)
	if strings.Contains(string(raw), "ghp_") || strings.Contains(strings.ToLower(string(raw)), "github_token") && strings.Contains(string(raw), `"github_token"`) {
		t.Fatalf("token leaked: %s", raw)
	}
	if _, ok := overview["github_token_configured"]; !ok {
		t.Fatal("expected boolean github_token_configured")
	}
}

func TestVulnExclusionsSkipListedPaths(t *testing.T) {
	kept, gaps := applyVulnExclusions([]string{"apps/api/package-lock.json", "vendor-extra/go.mod", "docs/bom.json"}, "docs,vendor-extra")
	if len(kept) != 1 || kept[0] != "apps/api/package-lock.json" {
		t.Fatalf("kept = %v", kept)
	}
	if len(gaps) != 2 {
		t.Fatalf("gaps = %+v", gaps)
	}
}

func TestAcceptedInventorySchema(t *testing.T) {
	if !acceptedVulnInventorySchema("") || !acceptedVulnInventorySchema("opstrellis.inventory.v1") {
		t.Fatal("supported schemas were rejected")
	}
	if acceptedVulnInventorySchema("v2-private-code") {
		t.Fatal("unknown schema must be rejected")
	}
}

func TestVulnPRCheckNeverMerges(t *testing.T) {
	state, desc := vulnPRCheckState("incomplete", 0, 0)
	if state != "pending" || !strings.Contains(desc, "does not merge") {
		t.Fatalf("incomplete = %s %s", state, desc)
	}
	state, desc = vulnPRCheckState("complete", 1, 0)
	if state != "failure" {
		t.Fatalf("introduced critical = %s", state)
	}
	state, desc = vulnPRCheckState("complete", 0, 0)
	if state != "success" || !strings.Contains(desc, "does not merge") {
		t.Fatalf("clean informational = %s %s", state, desc)
	}
}

func TestDeploymentOutcomeNeedsSBOM(t *testing.T) {
	if deploymentPatchOutcome(vulnPatchRepoOK, false, false) != vulnPatchDeployPen {
		t.Fatal("digest without SBOM cannot verify deployment")
	}
	if deploymentPatchOutcome(vulnPatchRepoOK, true, true) != vulnPatchDeployPen {
		t.Fatal("package still in digest SBOM stays pending")
	}
	if deploymentPatchOutcome(vulnPatchRepoOK, true, false) != vulnPatchDeployOK {
		t.Fatal("absent from digest SBOM should be deployment verified")
	}
}

func TestPatchProposalForbidsForceAndMerge(t *testing.T) {
	body := vulnPatchProposalMarkdown(1, "acme/api", "apps/api", "npm", "demo-http-client", "2.4.0", "2.4.2", "direct_upgrade", "[1]")
	if !strings.Contains(body, "No automatic merge") || !strings.Contains(body, "--force") {
		t.Fatalf("proposal missing safeguards: %s", body)
	}
}

func TestDueAtForPriority(t *testing.T) {
	if dueAtForPriority(vulnPriorityReview) != nil {
		t.Fatal("review findings have no SLA clock")
	}
	if dueAtForPriority(vulnPriorityUrgent) == nil {
		t.Fatal("urgent findings need a due date")
	}
}

func TestDiscoverLockfilesSkipsNodeModules(t *testing.T) {
	got := discoverVulnLockfiles([]string{
		"apps/api/package-lock.json",
		"apps/api/node_modules/foo/package-lock.json",
		"backend/pom.xml",
		"vendor/x/go.mod",
	})
	if len(got) != 2 || got[0] != "apps/api/package-lock.json" || got[1] != "backend/pom.xml" {
		t.Fatalf("discovered = %v", got)
	}
}
