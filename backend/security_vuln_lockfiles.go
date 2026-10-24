package main

import (
	"encoding/json"
	"regexp"
	"strings"
)

var (
	yarnVersionRe = regexp.MustCompile(`(?m)^"?([^"\n]+)"?:\s*$`)
	yarnVerLine   = regexp.MustCompile(`(?m)^\s+version\s+"?([^"\n]+)"?`)
	pnpmPkgRe     = regexp.MustCompile(`(?m)^\s{2}['"]?([^'"\s:]+@[^'"\s:]+)['"]?:`)
	gemSpecRe     = regexp.MustCompile(`(?m)^\s{4}([a-zA-Z0-9_\-]+) \(([^)]+)\)`)
	mixPkgRe      = regexp.MustCompile(`"([^"]+)":\s*\{:hex,\s*:?[a-zA-Z0-9_]+,\s*"([^"]+)"`)
	dockerFromRe  = regexp.MustCompile(`(?i)^FROM\s+(?:--platform=\S+\s+)?([^\s]+)`)
	gradleLockRe  = regexp.MustCompile(`^([^=\s]+)=`)
)

func addResolved(out *vulnParsedInventory, eco, name, version, filePath, module string, direct, dev bool) {
	name = strings.TrimSpace(name)
	version = strings.TrimSpace(strings.TrimPrefix(version, "v"))
	if name == "" || version == "" {
		return
	}
	out.Components = append(out.Components, vulnComponent{
		Ecosystem:   normalizeEcosystem(eco),
		PackageName: normalizePackageName(eco, name),
		Version:     version,
		Path:        filePath,
		ModulePath:  module,
		Direct:      direct,
		Dev:         dev,
		Resolved:    true,
		Usage:       "dependency",
	})
}

func parseYarnLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	blocks := strings.Split(content, "\n\n")
	for _, block := range blocks {
		if strings.HasPrefix(strings.TrimSpace(block), "#") && !strings.Contains(block, "version") {
			continue
		}
		header := yarnVersionRe.FindStringSubmatch(block)
		ver := yarnVerLine.FindStringSubmatch(block)
		if header == nil || ver == nil {
			continue
		}
		name := yarnPackageName(header[1])
		addResolved(&out, "npm", name, ver[1], filePath, module, false, false)
	}
	if len(out.Components) == 0 {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "npm", Reason: "yarn.lock had no resolved versions."})
	}
	return out
}

func yarnPackageName(key string) string {
	key = strings.Trim(key, `"`)
	if i := strings.Index(key, "@npm:"); i >= 0 {
		key = key[:i]
	}
	if strings.HasPrefix(key, "@") {
		if i := strings.Index(key[1:], "@"); i >= 0 {
			return key[:i+1]
		}
		return key
	}
	if i := strings.Index(key, "@"); i >= 0 {
		return key[:i]
	}
	return key
}

func parsePnpmLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	inPackages := false
	for _, line := range strings.Split(content, "\n") {
		trim := strings.TrimRight(line, "\r")
		if strings.HasPrefix(trim, "packages:") {
			inPackages = true
			continue
		}
		if inPackages && len(trim) > 0 && !strings.HasPrefix(trim, " ") && !strings.HasPrefix(trim, "\t") && strings.HasSuffix(trim, ":") && !strings.HasPrefix(trim, "packages") {
			if !strings.HasPrefix(trim, " ") {
				inPackages = strings.HasPrefix(trim, "packages")
			}
		}
		if !inPackages {
			continue
		}
		m := pnpmPkgRe.FindStringSubmatch(trim)
		if m == nil {
			continue
		}
		name, version := splitAtVersion(strings.TrimPrefix(m[1], "/"))
		addResolved(&out, "npm", name, version, filePath, module, false, false)
	}
	if len(out.Components) == 0 {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "npm", Reason: "pnpm-lock.yaml had no resolved packages."})
	}
	return out
}

func splitAtVersion(raw string) (string, string) {
	raw = strings.TrimPrefix(raw, "/")
	if strings.HasPrefix(raw, "@") {
		if i := strings.LastIndex(raw, "@"); i > 0 {
			return raw[:i], raw[i+1:]
		}
		return raw, ""
	}
	if i := strings.LastIndex(raw, "@"); i > 0 {
		return raw[:i], raw[i+1:]
	}
	if i := strings.LastIndex(raw, "/"); i > 0 && strings.Count(raw, "/") == 1 {
		return raw[:i], raw[i+1:]
	}
	return raw, ""
}

func parseBunLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	var doc struct {
		Packages map[string][]any `json:"packages"`
	}
	if json.Unmarshal([]byte(content), &doc) != nil {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "npm", Reason: "bun.lock could not be parsed as JSON."})
		return out
	}
	for name, row := range doc.Packages {
		version := ""
		if len(row) > 0 {
			if text, ok := row[0].(string); ok {
				if i := strings.LastIndex(text, "@"); i > 0 {
					version = text[i+1:]
				} else {
					version = text
				}
			}
		}
		addResolved(&out, "npm", yarnPackageName(name), version, filePath, module, false, false)
	}
	return out
}

func parsePoetryLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	name, version := "", ""
	flush := func() {
		addResolved(&out, "pypi", name, version, filePath, module, true, false)
		name, version = "", ""
	}
	for _, line := range strings.Split(content, "\n") {
		trim := strings.TrimSpace(line)
		if trim == "[[package]]" {
			flush()
			continue
		}
		if strings.HasPrefix(trim, "name = ") {
			name = strings.Trim(strings.TrimPrefix(trim, "name = "), `"`)
		}
		if strings.HasPrefix(trim, "version = ") {
			version = strings.Trim(strings.TrimPrefix(trim, "version = "), `"`)
		}
	}
	flush()
	return out
}

func parsePipfileLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	var doc struct {
		Default map[string]struct {
			Version string `json:"version"`
		} `json:"default"`
		Develop map[string]struct {
			Version string `json:"version"`
		} `json:"develop"`
	}
	if json.Unmarshal([]byte(content), &doc) != nil {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "pypi", Reason: "Pipfile.lock could not be parsed."})
		return out
	}
	for name, pkg := range doc.Default {
		addResolved(&out, "pypi", name, strings.TrimPrefix(pkg.Version, "=="), filePath, module, true, false)
	}
	for name, pkg := range doc.Develop {
		addResolved(&out, "pypi", name, strings.TrimPrefix(pkg.Version, "=="), filePath, module, true, true)
	}
	return out
}

func parseGradleLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	for _, line := range strings.Split(content, "\n") {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") || strings.HasPrefix(trim, "empty=") {
			continue
		}
		m := gradleLockRe.FindStringSubmatch(trim)
		if m == nil {
			continue
		}
		coords := strings.Split(m[1], ":")
		if len(coords) < 3 {
			continue
		}
		name := coords[0] + ":" + coords[1]
		addResolved(&out, "maven", name, coords[2], filePath, module, true, strings.Contains(strings.ToLower(trim), "test"))
	}
	return out
}

func parseNugetLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	var doc struct {
		Dependencies map[string]map[string]struct {
			Type     string `json:"type"`
			Resolved string `json:"resolved"`
		} `json:"dependencies"`
	}
	if json.Unmarshal([]byte(content), &doc) != nil {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "nuget", Reason: "packages.lock.json could not be parsed."})
		return out
	}
	for _, framework := range doc.Dependencies {
		for name, pkg := range framework {
			addResolved(&out, "nuget", name, pkg.Resolved, filePath, module, strings.EqualFold(pkg.Type, "Direct"), false)
		}
	}
	return out
}

func parseGemfileLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	inSpecs := false
	for _, line := range strings.Split(content, "\n") {
		if strings.TrimSpace(line) == "specs:" {
			inSpecs = true
			continue
		}
		if inSpecs && (line == "PLATFORMS" || line == "DEPENDENCIES" || line == "BUNDLED WITH" || line == "GIT") {
			inSpecs = false
			continue
		}
		if !inSpecs {
			continue
		}
		m := gemSpecRe.FindStringSubmatch(line)
		if m != nil {
			addResolved(&out, "rubygems", m[1], m[2], filePath, module, true, false)
		}
	}
	return out
}

func parsePubspecLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	name := ""
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "    ") && strings.HasSuffix(strings.TrimSpace(line), ":") {
			name = strings.TrimSuffix(strings.TrimSpace(line), ":")
			continue
		}
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "version:") && name != "" && name != "sdks" && name != "packages" {
			version := strings.Trim(strings.TrimSpace(strings.TrimPrefix(trim, "version:")), `"'`)
			addResolved(&out, "pub", name, version, filePath, module, true, false)
			name = ""
		}
	}
	return out
}

func parseMixLock(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	for _, m := range mixPkgRe.FindAllStringSubmatch(content, -1) {
		addResolved(&out, "hex", m[1], m[2], filePath, module, true, false)
	}
	return out
}

func npmDeclaredVersion(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	if value == "" || value == "*" || value == "latest" || strings.HasPrefix(value, "http") || strings.HasPrefix(value, "git") || strings.HasPrefix(value, "file:") || strings.HasPrefix(value, "workspace:") || strings.HasPrefix(value, "npm:") {
		return "", false
	}
	for _, prefix := range []string{">=", "<=", ">", "<", "=", "^", "~"} {
		if strings.HasPrefix(value, prefix) {
			value = strings.TrimSpace(strings.TrimPrefix(value, prefix))
			break
		}
	}
	if i := strings.IndexAny(value, " |"); i >= 0 {
		value = strings.TrimSpace(value[:i])
	}
	value = strings.TrimPrefix(value, "v")
	if value == "" || strings.ContainsAny(value, "xX*") {
		return "", false
	}
	parts := strings.Split(value, ".")
	return value, len(parts) >= 2
}

func parsePackageJSONRuntime(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	var doc struct {
		Engines              map[string]string `json:"engines"`
		Dependencies         map[string]string `json:"dependencies"`
		DevDependencies      map[string]string `json:"devDependencies"`
		OptionalDependencies map[string]string `json:"optionalDependencies"`
	}
	if json.Unmarshal([]byte(content), &doc) != nil {
		return out
	}
	if node := strings.TrimSpace(doc.Engines["node"]); node != "" {
		out.Components = append(out.Components, vulnComponent{
			Ecosystem: "node", PackageName: "node", Version: node, Path: filePath, ModulePath: module,
			Resolved: false, Usage: "declared_runtime",
		})
		out.Coverage = append(out.Coverage, vulnCoverageGap{
			Path: filePath, Adapter: "node",
			Reason: "package.json engines.node is declared runtime evidence, not an observed production version.",
		})
	}
	addDeclared := func(deps map[string]string, dev bool) {
		for name, spec := range deps {
			name = strings.TrimSpace(name)
			version, resolved := npmDeclaredVersion(spec)
			if name == "" || version == "" {
				continue
			}
			out.Components = append(out.Components, vulnComponent{
				Ecosystem:   "npm",
				PackageName: normalizePackageName("npm", name),
				Version:     version,
				PURL:        "pkg:npm/" + normalizePackageName("npm", name) + "@" + version,
				Path:        filePath,
				ModulePath:  module,
				Direct:      true,
				Dev:         dev,
				Resolved:    resolved,
			})
		}
	}
	addDeclared(doc.Dependencies, false)
	addDeclared(doc.OptionalDependencies, false)
	addDeclared(doc.DevDependencies, true)
	if len(doc.Dependencies)+len(doc.DevDependencies)+len(doc.OptionalDependencies) > 0 {
		out.Coverage = append(out.Coverage, vulnCoverageGap{
			Path: filePath, Adapter: "npm",
			Reason: "package.json declared versions were used because a lockfile was not preferred for this module. This is not an installed lockfile pin.",
		})
	}
	return out
}

func parseNodeVersionFile(filePath, module, content string) vulnParsedInventory {
	version := strings.TrimSpace(strings.TrimPrefix(strings.Split(content, "\n")[0], "v"))
	out := vulnParsedInventory{Modules: []string{module}}
	if version == "" {
		return out
	}
	out.Components = append(out.Components, vulnComponent{
		Ecosystem: "node", PackageName: "node", Version: version, Path: filePath, ModulePath: module,
		Resolved: false, Usage: "declared_runtime",
	})
	out.Coverage = append(out.Coverage, vulnCoverageGap{
		Path: filePath, Adapter: "node",
		Reason: "Pinned Node file is declared evidence only. It is not the observed production runtime.",
	})
	return out
}

func parseDockerfileImage(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	for _, line := range strings.Split(content, "\n") {
		m := dockerFromRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		image := m[1]
		if strings.EqualFold(image, "scratch") {
			continue
		}
		out.Components = append(out.Components, vulnComponent{
			Ecosystem: "image", PackageName: image, Version: imageTag(image), Path: filePath, ModulePath: module,
			Resolved: strings.Contains(image, "@sha256:"), Usage: "image_tag",
		})
		if !strings.Contains(image, "@sha256:") {
			out.Coverage = append(out.Coverage, vulnCoverageGap{
				Path: filePath, Adapter: "image",
				Reason: image + " is a mutable tag. Image OS packages stay unscanned until a digest-linked SBOM is uploaded.",
			})
		}
	}
	return out
}

func imageTag(image string) string {
	if i := strings.LastIndex(image, "@"); i >= 0 {
		return image[i+1:]
	}
	if i := strings.LastIndex(image, ":"); i >= 0 && !strings.Contains(image[i:], "/") {
		return image[i+1:]
	}
	return "latest"
}

func parseSBOM(filePath, module, content string) vulnParsedInventory {
	out := vulnParsedInventory{Modules: []string{module}}
	var cdx struct {
		Components []struct {
			Name    string `json:"name"`
			Version string `json:"version"`
			PURL    string `json:"purl"`
			Type    string `json:"type"`
			Scope   string `json:"scope"`
		} `json:"components"`
	}
	if json.Unmarshal([]byte(content), &cdx) == nil && len(cdx.Components) > 0 {
		for _, item := range cdx.Components {
			eco, name, version := purlParts(item.PURL, item.Name, item.Version)
			if name == "" {
				continue
			}
			usage := "dependency"
			if item.Type == "operating-system" || item.Type == "container" {
				usage = "image"
			}
			out.Components = append(out.Components, vulnComponent{
				Ecosystem: eco, PackageName: name, Version: version, PURL: item.PURL,
				Path: filePath, ModulePath: module, Direct: true, Resolved: version != "", Usage: usage, Dev: strings.EqualFold(item.Scope, "excluded"),
			})
		}
		return out
	}
	var spdx struct {
		Packages []struct {
			Name         string `json:"name"`
			VersionInfo  string `json:"versionInfo"`
			ExternalRefs []struct {
				ReferenceType    string `json:"referenceType"`
				ReferenceLocator string `json:"referenceLocator"`
			} `json:"externalRefs"`
		} `json:"packages"`
	}
	if json.Unmarshal([]byte(content), &spdx) != nil {
		out.Coverage = append(out.Coverage, vulnCoverageGap{Path: filePath, Adapter: "sbom", Reason: "SBOM JSON was not a usable CycloneDX or SPDX document."})
		return out
	}
	for _, pkg := range spdx.Packages {
		purl := ""
		for _, ref := range pkg.ExternalRefs {
			if strings.EqualFold(ref.ReferenceType, "purl") {
				purl = ref.ReferenceLocator
			}
		}
		eco, name, version := purlParts(purl, pkg.Name, pkg.VersionInfo)
		if name == "" {
			continue
		}
		out.Components = append(out.Components, vulnComponent{
			Ecosystem: eco, PackageName: name, Version: version, PURL: purl,
			Path: filePath, ModulePath: module, Direct: true, Resolved: version != "", Usage: "dependency",
		})
	}
	return out
}

func purlParts(purl, fallbackName, fallbackVersion string) (eco, name, version string) {
	name = fallbackName
	version = fallbackVersion
	eco = "generic"
	raw := strings.TrimPrefix(purl, "pkg:")
	if raw == "" || raw == purl && fallbackName != "" {
		return eco, name, version
	}
	if i := strings.Index(raw, "/"); i > 0 {
		eco = normalizeEcosystem(raw[:i])
		rest := raw[i+1:]
		if j := strings.Index(rest, "@"); j >= 0 {
			name = rest[:j]
			version = rest[j+1:]
			if k := strings.Index(version, "?"); k >= 0 {
				version = version[:k]
			}
		} else {
			name = rest
		}
	}
	if eco == "golang" {
		eco = "go"
	}
	if eco == "pypi" || eco == "npm" || eco == "maven" || eco == "nuget" || eco == "cargo" || eco == "gem" {
		if eco == "gem" {
			eco = "rubygems"
		}
	}
	return eco, name, version
}

func compareVulnMatches(base, head []vulnMatch) []map[string]string {
	key := func(m vulnMatch) string {
		return strings.Join([]string{m.Component.Ecosystem, m.Component.PackageName, m.CanonicalID, m.Component.ModulePath}, "|")
	}
	baseMap := map[string]vulnMatch{}
	headMap := map[string]vulnMatch{}
	for _, item := range base {
		baseMap[key(item)] = item
	}
	for _, item := range head {
		headMap[key(item)] = item
	}
	out := []map[string]string{}
	for k, item := range headMap {
		class := "introduced"
		baseVer := ""
		if prev, ok := baseMap[k]; ok {
			class = "unchanged"
			baseVer = prev.Component.Version
		}
		out = append(out, map[string]string{
			"classification": class,
			"canonical_id":   item.CanonicalID,
			"ecosystem":      item.Component.Ecosystem,
			"package_name":   item.Component.PackageName,
			"module_path":    item.Component.ModulePath,
			"base_version":   baseVer,
			"head_version":   item.Component.Version,
			"severity":       item.Severity,
		})
	}
	for k, item := range baseMap {
		if _, ok := headMap[k]; ok {
			continue
		}
		out = append(out, map[string]string{
			"classification": "removed",
			"canonical_id":   item.CanonicalID,
			"ecosystem":      item.Component.Ecosystem,
			"package_name":   item.Component.PackageName,
			"module_path":    item.Component.ModulePath,
			"base_version":   item.Component.Version,
			"head_version":   "",
			"severity":       item.Severity,
		})
	}
	return out
}
