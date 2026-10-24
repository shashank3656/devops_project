package main

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"path"
	"strings"
)

var vulnLockfileNames = map[string]string{
	"package-lock.json":  "npm",
	"yarn.lock":          "npm",
	"pnpm-lock.yaml":     "npm",
	"bun.lock":           "npm",
	"bun.lockb":          "npm",
	"go.mod":             "go",
	"requirements.txt":   "pypi",
	"poetry.lock":        "pypi",
	"Pipfile.lock":       "pypi",
	"pom.xml":            "maven",
	"gradle.lockfile":    "maven",
	"packages.lock.json": "nuget",
	"composer.lock":      "packagist",
	"Gemfile.lock":       "rubygems",
	"Cargo.lock":         "cargo",
	"pubspec.lock":       "pub",
	"mix.lock":           "hex",
	"package.json":       "npm",
	".nvmrc":             "node",
	".node-version":      "node",
	"Dockerfile":         "image",
	"bom.json":           "sbom",
}

var vulnSkipPathParts = []string{
	"node_modules", "vendor", ".git", "dist", "build", "target", ".next", "coverage",
}

type vulnParsedInventory struct {
	Components []vulnComponent
	Coverage   []vulnCoverageGap
	Modules    []string
}

func applyVulnExclusions(paths []string, exclusions string) ([]string, []vulnCoverageGap) {
	kept := make([]string, 0, len(paths))
	gaps := []vulnCoverageGap{}
	rules := splitVulnExclusions(exclusions)
	for _, item := range paths {
		if vulnPathExcluded(item, rules) {
			gaps = append(gaps, vulnCoverageGap{Path: item, Reason: "Path excluded by repository scan policy."})
			continue
		}
		kept = append(kept, item)
	}
	return kept, gaps
}

func splitVulnExclusions(raw string) []string {
	out := []string{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' || r == ';' }) {
		rule := strings.TrimSpace(strings.TrimPrefix(part, "/"))
		if rule != "" {
			out = append(out, rule)
		}
	}
	return out
}

func vulnPathExcluded(filePath string, rules []string) bool {
	clean := strings.TrimPrefix(strings.ReplaceAll(filePath, "\\", "/"), "/")
	for _, rule := range rules {
		if clean == rule || strings.HasPrefix(clean, strings.TrimSuffix(rule, "/")+"/") || strings.HasPrefix(clean, rule) {
			return true
		}
	}
	return false
}

func discoverVulnSourceFiles(paths []string) []string {
	out := make([]string, 0, 30)
	for _, raw := range paths {
		clean := strings.TrimPrefix(strings.ReplaceAll(raw, "\\", "/"), "/")
		if vulnPathSkipped(clean) || vulnSourceSkipped(clean) {
			continue
		}
		lower := strings.ToLower(path.Ext(clean))
		switch lower {
		case ".go", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".java", ".kt":
			out = append(out, clean)
		}
		if len(out) >= 30 {
			break
		}
	}
	return out
}

func vulnSourceSkipped(clean string) bool {
	lower := strings.ToLower(clean)
	base := strings.ToLower(path.Base(clean))
	if strings.Contains(base, "_test.") || strings.Contains(base, ".test.") || strings.Contains(base, ".spec.") {
		return true
	}
	return strings.Contains(lower, "/test/") || strings.Contains(lower, "/tests/") || strings.Contains(lower, "/__tests__/")
}

func reachabilityValue(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case vulnReachImported:
		return vulnReachImported
	case vulnReachNotImported:
		return vulnReachNotImported
	default:
		return vulnReachUnknown
	}
}

func reachabilityReason(match vulnMatch) string {
	why := strings.TrimSpace(match.PriorityWhy)
	switch reachabilityValue(match.Component.Reachability) {
	case vulnReachImported:
		return strings.TrimSpace(why + " Imported in sampled sources.")
	case vulnReachNotImported:
		return strings.TrimSpace(why + " Import not found in sampled sources. This is not a not-affected claim.")
	default:
		return strings.TrimSpace(why + " Reachability is Unknown because sources were not sampled.")
	}
}

func applyReachability(components []vulnComponent, sources []string, scanned bool) {
	if !scanned || len(sources) == 0 {
		for i := range components {
			if components[i].Reachability == "" {
				components[i].Reachability = vulnReachUnknown
			}
		}
		return
	}
	hay := strings.ToLower(strings.Join(sources, "\n"))
	for i := range components {
		pkg := strings.ToLower(strings.TrimSpace(components[i].PackageName))
		if pkg == "" {
			components[i].Reachability = vulnReachUnknown
			continue
		}
		needles := []string{pkg}
		if idx := strings.LastIndex(pkg, "/"); idx >= 0 && idx < len(pkg)-1 {
			needles = append(needles, pkg[idx+1:])
		}
		hit := false
		for _, needle := range needles {
			if needle != "" && strings.Contains(hay, needle) {
				hit = true
				break
			}
		}
		if hit {
			components[i].Reachability = vulnReachImported
		} else {
			components[i].Reachability = vulnReachNotImported
		}
	}
}

func discoverVulnLockfiles(paths []string) []string {
	out := make([]string, 0)
	for _, raw := range paths {
		clean := strings.TrimPrefix(strings.ReplaceAll(raw, "\\", "/"), "/")
		if vulnPathSkipped(clean) {
			continue
		}
		base := path.Base(clean)
		if _, ok := vulnLockfileNames[base]; ok {
			out = append(out, clean)
			continue
		}
		lower := strings.ToLower(base)
		if strings.HasSuffix(lower, ".cdx.json") || strings.HasSuffix(lower, ".spdx.json") || strings.HasPrefix(lower, "dockerfile") {
			out = append(out, clean)
		}
	}
	return out
}

func vulnPathSkipped(clean string) bool {
	parts := strings.Split(clean, "/")
	for _, part := range parts[:max(0, len(parts)-1)] {
		lower := strings.ToLower(part)
		for _, skip := range vulnSkipPathParts {
			if lower == skip {
				return true
			}
		}
	}
	return false
}

func parseVulnArtifact(filePath, content string) vulnParsedInventory {
	base := path.Base(filePath)
	module := strings.TrimSuffix(filePath, "/"+base)
	if module == filePath {
		module = ""
	}
	switch base {
	case "package-lock.json":
		return parseNPMLock(filePath, module, content)
	case "go.mod":
		return parseGoMod(filePath, module, content)
	case "requirements.txt":
		return parseRequirements(filePath, module, content)
	case "pom.xml":
		return parsePOM(filePath, module, content)
	case "composer.lock":
		return parseComposerLock(filePath, module, content)
	case "Cargo.lock":
		return parseCargoLock(filePath, module, content)
	case "yarn.lock":
		return parseYarnLock(filePath, module, content)
	case "pnpm-lock.yaml":
		return parsePnpmLock(filePath, module, content)
	case "bun.lock":
		return parseBunLock(filePath, module, content)
	case "bun.lockb":
		return vulnParsedInventory{Coverage: []vulnCoverageGap{{Path: filePath, Adapter: "npm", Reason: "bun.lockb is binary. Provide bun.lock or an SBOM."}}, Modules: []string{module}}
	case "poetry.lock":
		return parsePoetryLock(filePath, module, content)
	case "Pipfile.lock":
		return parsePipfileLock(filePath, module, content)
	case "gradle.lockfile":
		return parseGradleLock(filePath, module, content)
	case "packages.lock.json":
		return parseNugetLock(filePath, module, content)
	case "Gemfile.lock":
		return parseGemfileLock(filePath, module, content)
	case "pubspec.lock":
		return parsePubspecLock(filePath, module, content)
	case "mix.lock":
		return parseMixLock(filePath, module, content)
	case "package.json":
		return parsePackageJSONRuntime(filePath, module, content)
	case ".nvmrc", ".node-version":
		return parseNodeVersionFile(filePath, module, content)
	case "bom.json":
		return parseSBOM(filePath, module, content)
	default:
		lower := strings.ToLower(base)
		if strings.HasPrefix(lower, "dockerfile") {
			return parseDockerfileImage(filePath, module, content)
		}
		if strings.HasSuffix(lower, ".cdx.json") || strings.HasSuffix(lower, ".spdx.json") {
			return parseSBOM(filePath, module, content)
		}
		return vulnParsedInventory{
			Coverage: []vulnCoverageGap{{Path: filePath, Reason: "Unsupported artifact."}},
		}
	}
}

func parseNPMLock(filePath, module, content string) vulnParsedInventory {
	var doc struct {
		Packages map[string]struct {
			Version  string `json:"version"`
			Dev      bool   `json:"dev"`
			Optional bool   `json:"optional"`
			Name     string `json:"name"`
		} `json:"packages"`
		Dependencies map[string]struct {
			Version string `json:"version"`
			Dev     bool   `json:"dev"`
		} `json:"dependencies"`
	}
	if err := json.Unmarshal([]byte(content), &doc); err != nil {
		return vulnParsedInventory{Coverage: []vulnCoverageGap{{Path: filePath, Adapter: "npm", Reason: "package-lock.json could not be parsed."}}, Modules: []string{module}}
	}
	out := vulnParsedInventory{Modules: []string{module}}
	if len(doc.Packages) > 0 {
		for rel, pkg := range doc.Packages {
			if rel == "" {
				continue
			}
			name := pkg.Name
			if name == "" {
				name = npmNameFromLockPath(rel)
			}
			if name == "" || pkg.Version == "" {
				continue
			}
			direct := strings.Count(rel, "node_modules/") == 1
			parent := ""
			if !direct {
				parent = npmParentFromLockPath(rel)
			}
			out.Components = append(out.Components, vulnComponent{
				Ecosystem:     "npm",
				PackageName:   normalizePackageName("npm", name),
				Version:       pkg.Version,
				PURL:          "pkg:npm/" + normalizePackageName("npm", name) + "@" + pkg.Version,
				Path:          filePath,
				ModulePath:    module,
				Direct:        direct,
				Dev:           pkg.Dev,
				Resolved:      true,
				ParentPackage: parent,
			})
		}
		return out
	}
	for name, pkg := range doc.Dependencies {
		if strings.TrimSpace(name) == "" || pkg.Version == "" {
			continue
		}
		out.Components = append(out.Components, vulnComponent{
			Ecosystem:   "npm",
			PackageName: normalizePackageName("npm", name),
			Version:     strings.TrimPrefix(pkg.Version, "^"),
			Path:        filePath,
			ModulePath:  module,
			Direct:      true,
			Dev:         pkg.Dev,
			Resolved:    !strings.ContainsAny(pkg.Version, "<>^~*"),
		})
	}
	if len(out.Components) == 0 {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "npm", Reason: "package-lock.json had no resolved packages."})
	}
	return out
}

func npmNameFromLockPath(rel string) string {
	rel = strings.TrimPrefix(rel, "/")
	idx := strings.LastIndex(rel, "node_modules/")
	if idx < 0 {
		return ""
	}
	return strings.TrimPrefix(rel[idx+len("node_modules/"):], "/")
}

func npmParentFromLockPath(rel string) string {
	rel = strings.TrimPrefix(rel, "/")
	parts := strings.Split(rel, "/node_modules/")
	if len(parts) < 2 {
		return ""
	}
	parent := parts[len(parts)-2]
	parent = strings.TrimPrefix(parent, "node_modules/")
	if i := strings.LastIndex(parent, "/"); i >= 0 {
		parent = parent[i+1:]
	}
	return parent
}

func parseGoMod(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	inBlock := false
	for _, line := range strings.Split(content, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "replace ") {
			out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "go", Reason: "go.mod replace directives were recorded as coverage, not as resolved versions."})
			continue
		}
		if strings.HasPrefix(trim, "require (") {
			inBlock = true
			continue
		}
		if inBlock && trim == ")" {
			inBlock = false
			continue
		}
		if strings.HasPrefix(trim, "require ") || inBlock {
			fields := strings.Fields(strings.TrimPrefix(trim, "require "))
			if len(fields) < 2 || strings.HasPrefix(fields[0], "//") {
				continue
			}
			name, version := fields[0], strings.TrimPrefix(fields[1], "v")
			indirect := strings.Contains(trim, "// indirect")
			out.Components = append(out.Components, vulnComponent{
				Ecosystem:   "go",
				PackageName: name,
				Version:     version,
				PURL:        "pkg:golang/" + name + "@v" + version,
				Path:        filePath,
				ModulePath:  module,
				Direct:      !indirect,
				Resolved:    true,
			})
		}
	}
	if len(out.Components) == 0 {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "go", Reason: "go.mod had no require entries."})
	}
	return out
}

func parseRequirements(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	for _, line := range strings.Split(content, "\n") {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") || strings.HasPrefix(trim, "-") {
			continue
		}
		if i := strings.Index(trim, "#"); i >= 0 {
			trim = strings.TrimSpace(trim[:i])
		}
		name, version, resolved := splitPinnedPython(trim)
		if name == "" {
			continue
		}
		item := vulnComponent{
			Ecosystem:   "pypi",
			PackageName: normalizePackageName("pypi", name),
			Version:     version,
			Path:        filePath,
			ModulePath:  module,
			Direct:      true,
			Resolved:    resolved,
		}
		if !resolved {
			out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "pypi", Reason: name + " is not pinned; Needs verification, not a confirmed version."})
		}
		out.Components = append(out.Components, item)
	}
	return out
}

func splitPinnedPython(spec string) (name, version string, resolved bool) {
	for _, sep := range []string{"==", "==="} {
		if strings.Contains(spec, sep) {
			parts := strings.SplitN(spec, sep, 2)
			return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), true
		}
	}
	name = spec
	for _, sep := range []string{">=", "<=", "~=", "!=", ">", "<"} {
		if i := strings.Index(spec, sep); i >= 0 {
			name = strings.TrimSpace(spec[:i])
			break
		}
	}
	return name, "", false
}

func parsePOM(filePath, module, content string) vulnParsedInventory {
	type pomDep struct {
		GroupID    string `xml:"groupId"`
		ArtifactID string `xml:"artifactId"`
		Version    string `xml:"version"`
		Scope      string `xml:"scope"`
	}
	var doc struct {
		Dependencies struct {
			Dependency []pomDep `xml:"dependency"`
		} `xml:"dependencies"`
	}
	out := vulnParsedInventory{Modules: []string{module}}
	if err := xml.Unmarshal([]byte(content), &doc); err != nil {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "maven", Reason: "pom.xml could not be parsed."})
		return out
	}
	for _, dep := range doc.Dependencies.Dependency {
		name := strings.TrimSpace(dep.GroupID) + ":" + strings.TrimSpace(dep.ArtifactID)
		if strings.Trim(name, ":") == "" {
			continue
		}
		version := strings.TrimSpace(dep.Version)
		resolved := version != "" && !strings.Contains(version, "${")
		item := vulnComponent{
			Ecosystem:   "maven",
			PackageName: normalizePackageName("maven", name),
			Version:     version,
			PURL:        fmt.Sprintf("pkg:maven/%s@%s", name, version),
			Path:        filePath,
			ModulePath:  module,
			Direct:      true,
			Dev:         strings.EqualFold(dep.Scope, "test"),
			Resolved:    resolved,
		}
		if !resolved {
			item.Version = ""
			item.PURL = ""
			out.Coverage = append(out.Coverage, vulnCoverageGap{
				Path:    filePath,
				Adapter: "maven",
				Reason:  name + " has an unresolved BOM or property version. Provide a resolved graph or lockfile.",
			})
		}
		out.Components = append(out.Components, item)
	}
	if len(out.Components) == 0 {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "maven", Reason: "pom.xml listed no dependencies."})
	}
	return out
}

func parseComposerLock(filePath, module, content string) vulnParsedInventory {
	var doc struct {
		Packages    []struct{ Name, Version string } `json:"packages"`
		PackagesDev []struct{ Name, Version string } `json:"packages-dev"`
	}
	out := vulnParsedInventory{Modules: []string{module}}
	if err := json.Unmarshal([]byte(content), &doc); err != nil {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "packagist", Reason: "composer.lock could not be parsed."})
		return out
	}
	add := func(name, version string, dev bool) {
		if name == "" || version == "" {
			return
		}
		out.Components = append(out.Components, vulnComponent{
			Ecosystem:   "packagist",
			PackageName: name,
			Version:     strings.TrimPrefix(version, "v"),
			Path:        filePath,
			ModulePath:  module,
			Direct:      true,
			Dev:         dev,
			Resolved:    true,
		})
	}
	for _, pkg := range doc.Packages {
		add(pkg.Name, pkg.Version, false)
	}
	for _, pkg := range doc.PackagesDev {
		add(pkg.Name, pkg.Version, true)
	}
	return out
}

func parseCargoLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	name, version := "", ""
	for _, line := range strings.Split(content, "\n") {
		trim := strings.TrimSpace(line)
		if trim == "[[package]]" {
			if name != "" && version != "" {
				out.Components = append(out.Components, vulnComponent{
					Ecosystem: "cargo", PackageName: name, Version: version,
					Path: filePath, ModulePath: module, Resolved: true,
				})
			}
			name, version = "", ""
			continue
		}
		if strings.HasPrefix(trim, "name = ") {
			name = strings.Trim(strings.TrimPrefix(trim, "name = "), `"`)
		}
		if strings.HasPrefix(trim, "version = ") {
			version = strings.Trim(strings.TrimPrefix(trim, "version = "), `"`)
		}
	}
	if name != "" && version != "" {
		out.Components = append(out.Components, vulnComponent{
			Ecosystem: "cargo", PackageName: name, Version: version,
			Path: filePath, ModulePath: module, Resolved: true,
		})
	}
	return out
}

func mergeParsedInventories(items []vulnParsedInventory) vulnParsedInventory {
	out := vulnParsedInventory{}
	modules := map[string]bool{}
	for _, item := range items {
		out.Components = append(out.Components, item.Components...)
		out.Coverage = append(out.Coverage, item.Coverage...)
		for _, module := range item.Modules {
			if !modules[module] {
				modules[module] = true
				out.Modules = append(out.Modules, module)
			}
		}
	}
	out.Components = preferResolvedLockfileComponents(out.Components)
	return out
}

func preferResolvedLockfileComponents(components []vulnComponent) []vulnComponent {
	locked := map[string]bool{}
	for _, item := range components {
		base := path.Base(item.Path)
		if !item.Resolved || item.Usage == "declared_runtime" || item.Usage == "image_tag" {
			continue
		}
		if base == "package.json" {
			continue
		}
		locked[item.ModulePath+"|"+normalizeEcosystem(item.Ecosystem)+"|"+normalizePackageName(item.Ecosystem, item.PackageName)] = true
	}
	if len(locked) == 0 {
		return components
	}
	out := make([]vulnComponent, 0, len(components))
	for _, item := range components {
		if path.Base(item.Path) == "package.json" && item.Usage != "declared_runtime" {
			key := item.ModulePath + "|" + normalizeEcosystem(item.Ecosystem) + "|" + normalizePackageName(item.Ecosystem, item.PackageName)
			if locked[key] {
				continue
			}
		}
		out = append(out, item)
	}
	return out
}

func technologiesFromComponents(components []vulnComponent, coverage []vulnCoverageGap) []string {
	seen := map[string]bool{}
	out := make([]string, 0)
	add := func(eco string) {
		eco = normalizeEcosystem(eco)
		if eco == "" || seen[eco] {
			return
		}
		seen[eco] = true
		out = append(out, eco)
	}
	for _, item := range components {
		add(item.Ecosystem)
	}
	for _, gap := range coverage {
		add(gap.Adapter)
	}
	if len(out) == 0 {
		return []string{}
	}
	return out
}
