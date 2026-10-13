package main

import "testing"

const (
	digestA = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	digestB = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

type artifactMem struct {
	sboms      []artifactSBOM
	components []artifactComponent
	exposures  []artifactExposure
	findings   []artifactFinding
}

func (m *artifactMem) install() func() {
	previousSave := saveArtifactSBOM
	previousFind := findArtifactSBOM
	previousComponent := insertArtifactComponent
	previousExposure := saveArtifactExposure
	previousListExposure := listArtifactExposures
	previousSaveFinding := saveArtifactFinding
	previousFindFinding := findArtifactFinding
	previousListFinding := listArtifactFindings
	previousAttempt := loadArtifactAttempt
	saveArtifactSBOM = func(item artifactSBOM) (artifactSBOM, error) {
		item.ID = len(m.sboms) + 1
		m.sboms = append(m.sboms, item)
		return item, nil
	}
	findArtifactSBOM = func(projectID int, digest string) (artifactSBOM, error) {
		for _, item := range m.sboms {
			if item.ProjectID == projectID && item.Digest == digest {
				item.Components = m.componentsFor(item.ID)
				return item, nil
			}
		}
		return artifactSBOM{}, nil
	}
	insertArtifactComponent = func(item artifactComponent) (artifactComponent, error) {
		item.ID = len(m.components) + 1
		m.components = append(m.components, item)
		return item, nil
	}
	saveArtifactExposure = func(item artifactExposure) (artifactExposure, error) {
		item.ID = len(m.exposures) + 1
		m.exposures = append(m.exposures, item)
		return item, nil
	}
	listArtifactExposures = func(projectID int, digest string) ([]artifactExposure, error) {
		var items []artifactExposure
		for _, item := range m.exposures {
			if item.ProjectID == projectID && item.Digest == digest {
				items = append(items, item)
			}
		}
		return items, nil
	}
	saveArtifactFinding = func(item artifactFinding) (artifactFinding, error) {
		item.ID = len(m.findings) + 1
		m.findings = append(m.findings, item)
		return item, nil
	}
	findArtifactFinding = func(projectID int, digest, ruleID, purl string) (artifactFinding, error) {
		for _, item := range m.findings {
			if item.ProjectID == projectID && item.Digest == digest && item.RuleID == ruleID && item.PURL == purl {
				return item, nil
			}
		}
		return artifactFinding{}, nil
	}
	listArtifactFindings = func(projectID int, digest string) ([]artifactFinding, error) {
		var items []artifactFinding
		for _, item := range m.findings {
			if item.ProjectID == projectID && item.Digest == digest {
				items = append(items, item)
			}
		}
		return items, nil
	}
	loadArtifactAttempt = func(id int) (deploymentAttempt, error) {
		if id == 4 {
			return deploymentAttempt{ID: 4, ProjectID: 10, Environment: "dev", ImageDigest: digestA}, nil
		}
		return deploymentAttempt{}, errSBOMHidden
	}
	return func() {
		saveArtifactSBOM = previousSave
		findArtifactSBOM = previousFind
		insertArtifactComponent = previousComponent
		saveArtifactExposure = previousExposure
		listArtifactExposures = previousListExposure
		saveArtifactFinding = previousSaveFinding
		findArtifactFinding = previousFindFinding
		listArtifactFindings = previousListFinding
		loadArtifactAttempt = previousAttempt
	}
}

func (m *artifactMem) componentsFor(sbomID int) []artifactComponent {
	var items []artifactComponent
	for _, item := range m.components {
		if item.SBOMID == sbomID {
			items = append(items, item)
		}
	}
	return items
}

func sbomActor(role string) authzSubject {
	userID := 4
	if role == "viewer" {
		userID = 5
	}
	return authzSubject{
		UserID: userID, OrganizationID: pilotOrganizationID,
		Grants: []projectGrant{{OrganizationID: pilotOrganizationID, ProjectID: 10, Role: role, Environments: []string{"*"}}},
	}
}

func TestMutableTagDoesNotMixArtifacts(t *testing.T) {
	mem := &artifactMem{}
	restore := mem.install()
	defer restore()
	first, err := recordSBOM(sbomActor("operator"), sbomInput{
		ProjectID: 10, Digest: digestA, Tag: "latest",
		Components: []artifactComponent{{Name: "libc", Version: "1.0.0", PURL: "pkg:generic/libc@1.0.0"}},
	})
	if err != nil || first.Format != pinnedSBOMFormat || len(first.Components) != 1 || first.Components[0].Version != "1.0.0" {
		t.Fatalf("first %+v err %v", first, err)
	}
	second, err := recordSBOM(sbomActor("operator"), sbomInput{
		ProjectID: 10, Digest: digestB, Tag: "latest",
		Components: []artifactComponent{{Name: "libc", Version: "2.0.0", PURL: "pkg:generic/libc@2.0.0"}},
	})
	if err != nil || second.ID == first.ID || len(mem.sboms) != 2 {
		t.Fatalf("second %+v rows %d err %v", second, len(mem.sboms), err)
	}
	again, err := recordSBOM(sbomActor("operator"), sbomInput{
		ProjectID: 10, Digest: digestA, Tag: "moved",
		Components: []artifactComponent{{Name: "libc", Version: "9.0.0", PURL: "pkg:generic/libc@9.0.0"}},
	})
	if err != nil || again.ID != first.ID || again.Components[0].Version != "1.0.0" || len(mem.components) != 2 {
		t.Fatalf("again %+v components %d err %v", again, len(mem.components), err)
	}
	if _, err := recordArtifactExposure(sbomActor("operator"), 10, digestA, "prod", 4); err != errSBOMInvalid || len(mem.exposures) != 0 {
		t.Fatalf("mismatch err %v rows %d", err, len(mem.exposures))
	}
	if _, err := recordSBOM(sbomActor("viewer"), sbomInput{ProjectID: 10, Digest: digestA, Tag: "latest"}); err != errSBOMDenied || len(mem.sboms) != 2 {
		t.Fatalf("viewer err %v rows %d", err, len(mem.sboms))
	}
}

func TestSameDigestShowsBothEnvironments(t *testing.T) {
	mem := &artifactMem{}
	restore := mem.install()
	defer restore()
	if _, err := recordSBOM(sbomActor("operator"), sbomInput{
		ProjectID: 10, Digest: digestA, Tag: "1.2.3",
		Components: []artifactComponent{{Name: "libc", Version: "1.0.0", PURL: "pkg:generic/libc@1.0.0"}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := recordArtifactExposure(sbomActor("operator"), 10, digestA, "dev", 4); err != nil {
		t.Fatal(err)
	}
	if _, err := recordArtifactExposure(sbomActor("operator"), 10, digestA, "prod", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := recordArtifactFinding(sbomActor("operator"), artifactFinding{
		ProjectID: 10, Digest: digestA, RuleID: "CVE-2026-1", PackageName: "libc", PackageVersion: "1.0.0", PURL: "pkg:generic/libc@1.0.0",
	}); err != nil {
		t.Fatal(err)
	}
	context, err := artifactExposureContext(sbomActor("viewer"), 10, digestA)
	if err != nil || len(context.Environments) != 2 || context.Environments[0].Environment != "dev" || context.Environments[1].Environment != "prod" || len(context.Findings) != 1 || context.Exposure != "deployed" || len(mem.exposures) != 2 {
		t.Fatalf("context %+v err %v", context, err)
	}
	other, err := artifactExposureContext(sbomActor("viewer"), 10, digestB)
	if err != errSBOMHidden || len(other.Environments) != 0 {
		t.Fatalf("other %+v err %v", other, err)
	}
}

func TestIncompleteSBOMIsFlagged(t *testing.T) {
	mem := &artifactMem{}
	restore := mem.install()
	defer restore()
	saved, err := recordSBOM(sbomActor("operator"), sbomInput{
		ProjectID: 10, Digest: digestA, Tag: "1.2.3",
		Components: []artifactComponent{{Name: "libc", Version: "1.0.0"}},
	})
	if err != nil || saved.Complete || saved.State != "incomplete" || saved.State == "healthy" || saved.Components[0].Name != "libc" || saved.Components[0].Version != "1.0.0" || saved.Components[0].PURL != "" {
		t.Fatalf("saved %+v err %v", saved, err)
	}
	context, err := artifactExposureContext(sbomActor("operator"), 10, digestA)
	if err != nil || context.State != "incomplete" || context.Exposure != "unknown" || context.Complete {
		t.Fatalf("context %+v err %v", context, err)
	}
	if len(mem.sboms) != 1 || mem.sboms[0].State != "incomplete" {
		t.Fatalf("stored %+v", mem.sboms)
	}
}
