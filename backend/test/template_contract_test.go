package main

import "testing"

func TestTemplatePinRejectsMissingVersions(t *testing.T) {
	input := templateVersionPin{TemplateKey: supportedTemplateKey, GeneratorVersion: "hcl-1", ModuleVersion: "1.0.0"}
	pinned, err := pinTemplateContract(input)
	if err == nil || pinned.SchemaVersion != 0 || input.SchemaVersion != 0 {
		t.Fatalf("missing schema pinned %+v err %v input %#v", pinned, err, input)
	}
	input.SchemaVersion = 1
	input.GeneratorVersion = ""
	pinned, err = pinTemplateContract(input)
	if err == nil || pinned.GeneratorVersion != "" {
		t.Fatalf("missing generator pinned %+v err %v", pinned, err)
	}
	input.GeneratorVersion = "hcl-1"
	input.ModuleVersion = ""
	pinned, err = pinTemplateContract(input)
	if err == nil || pinned.ModuleVersion != "" {
		t.Fatalf("missing module pinned %+v err %v", pinned, err)
	}
}

func TestTemplatePinDoesNotReplaceADifferentVersion(t *testing.T) {
	input := templateVersionPin{TemplateKey: supportedTemplateKey, SchemaVersion: 2, GeneratorVersion: "hcl-9", ModuleVersion: "9.9.9"}
	pinned, err := pinTemplateContract(input)
	if err == nil || pinned.ModuleVersion == "1.0.0" || input.ModuleVersion != "9.9.9" || input.SchemaVersion != 2 {
		t.Fatalf("mismatch pinned %+v err %v input %#v", pinned, err, input)
	}
	exact := templateVersionPin{TemplateKey: supportedTemplateKey, SchemaVersion: 1, GeneratorVersion: "hcl-1", ModuleVersion: "1.0.0"}
	pinned, err = pinTemplateContract(exact)
	if err != nil || pinned.SchemaVersion != 1 || pinned.GeneratorVersion != "hcl-1" || pinned.ModuleVersion != "1.0.0" || pinned.ModuleSource == "" {
		t.Fatalf("exact pin %+v err %v", pinned, err)
	}
}
