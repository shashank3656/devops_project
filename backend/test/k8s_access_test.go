package main

import "testing"

func TestK8sAccessLevels(t *testing.T) {
	if k8sRank("none") != 0 || k8sRank("read") != 1 || k8sRank("write") != 2 || k8sRank("") != 0 {
		t.Fatal("rank")
	}
	if teamK8sLevel("", "devops") != "read" {
		t.Fatal("devops default")
	}
	if teamK8sLevel("", "portal") != "none" {
		t.Fatal("portal default")
	}
	if teamK8sLevel("write", "portal") != "write" {
		t.Fatal("explicit team write")
	}
	if teamK8sLevel("none", "devops") != "none" {
		t.Fatal("explicit team none")
	}
	if projectK8sLevel("") != "read" {
		t.Fatal("link default")
	}
	if projectK8sLevel("none") != "none" {
		t.Fatal("link none")
	}
	if k8sEffective("write", "read") != "read" || k8sEffective("read", "write") != "read" {
		t.Fatal("minimum of team and project")
	}
	if k8sEffective("none", "write") != "none" {
		t.Fatal("team none blocks the project")
	}
	if k8sStronger("read", "write") != "write" || k8sStronger("write", "read") != "write" {
		t.Fatal("strongest across teams")
	}
}
