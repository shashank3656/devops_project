#!/usr/bin/env python3
"""Private outbound agent for Global Vulnerabilities & Patches.

Polls OpsTrellis, reads assigned lockfiles or an SBOM from a local checkout
(or GitHub Contents, never a Docker socket), and uploads an inventory envelope.
Correlation and findings stay on the API. Tokens are never printed.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from common import env_int, env_text, load_worker_env

VERSION = "opstrellis-vuln-agent/1.0.0"
SCHEMA = "opstrellis.inventory.v1"
MAX_FILE_BYTES = 200000
MAX_TREE = 8000
SKIP_DIRS = {"node_modules", "vendor", ".git", "dist", "build", "target", ".next", "coverage"}
LOCK_NAMES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "go.mod", "go.sum",
    "requirements.txt", "poetry.lock", "Pipfile.lock", "pom.xml", "gradle.lockfile",
    "packages.lock.json", "composer.lock", "Gemfile.lock", "Cargo.lock", "pubspec.lock",
    "mix.lock", "package.json", ".nvmrc", ".node-version", "Dockerfile", "bom.json",
}
TOKEN_FILE = Path(__file__).resolve().parent / ".agent_token"


def json_request(url: str, method: str, token: str = "", body: dict | None = None, timeout: int = 30) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json", "User-Agent": VERSION}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            return response.status, payload if isinstance(payload, dict) else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"error": "request failed"}
        if not isinstance(payload, dict):
            payload = {"error": "request failed"}
        return exc.code, payload


def save_agent_token(token: str) -> None:
    TOKEN_FILE.write_text(token.strip() + "\n", encoding="utf-8")
    TOKEN_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)


def load_agent_token() -> str:
    env = env_text("VULN_AGENT_TOKEN")
    if env:
        return env
    if TOKEN_FILE.is_file():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    return ""


def enroll(api: str, bootstrap: str) -> str:
    status, payload = json_request(f"{api}/api/security/agent/enroll", "POST", body={"bootstrap_token": bootstrap, "version": VERSION})
    token = str(payload.get("token") or "").strip()
    if status != 200 or not token:
        raise RuntimeError(str(payload.get("error") or "Enrollment failed."))
    save_agent_token(token)
    os.environ["VULN_AGENT_TOKEN"] = token
    print(f"Enrolled agent_id={payload.get('agent_id')}. Identity is stored locally and is not printed.")
    return token


def heartbeat(api: str, token: str, error: str = "") -> None:
    json_request(f"{api}/api/security/agent/heartbeat", "POST", token=token, body={"version": VERSION, "error": error})


def claim_job(api: str, token: str) -> dict | None:
    status, payload = json_request(f"{api}/api/security/agent/jobs/claim", "POST", token=token, body={})
    if status != 200:
        raise RuntimeError(str(payload.get("error") or "Job claim failed."))
    job = payload.get("job")
    return job if isinstance(job, dict) else None


def git_commit(repo_dir: Path) -> str:
    head = repo_dir / ".git" / "HEAD"
    if not head.is_file():
        return ""
    text = head.read_text(encoding="utf-8").strip()
    if text.startswith("ref:"):
        ref = repo_dir / ".git" / text.split(" ", 1)[1].strip()
        return ref.read_text(encoding="utf-8").strip() if ref.is_file() else ""
    return text


def skipped(path: Path, root: Path) -> bool:
    for part in path.relative_to(root).parts[:-1]:
        if part.lower() in SKIP_DIRS:
            return True
    return False


def interesting(path: Path) -> bool:
    name = path.name
    lower = name.lower()
    return name in LOCK_NAMES or lower.endswith(".cdx.json") or lower.endswith(".spdx.json") or lower.startswith("dockerfile")


def collect_local(root: Path) -> tuple[list[dict], list[dict], dict | None]:
    components: list[dict] = []
    coverage: list[dict] = []
    sbom: dict | None = None
    count = 0
    for path in root.rglob("*"):
        if not path.is_file() or skipped(path, root) or not interesting(path):
            continue
        count += 1
        if count > 40:
            coverage.append({"path": str(path.relative_to(root)), "reason": "Scan file cap reached. Remaining modules stay unscanned."})
            break
        rel = str(path.relative_to(root)).replace("\\", "/")
        if path.stat().st_size > MAX_FILE_BYTES:
            coverage.append({"path": rel, "reason": "File exceeded the scan size cap and was skipped."})
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        parsed, maybe_sbom, gaps = parse_artifact(rel, text)
        components.extend(parsed)
        coverage.extend(gaps)
        if maybe_sbom is not None:
            sbom = maybe_sbom
    if not components and sbom is None:
        coverage.append({"path": "/", "reason": "No supported lockfile or SBOM was found. This is not a clean result."})
    return components, coverage, sbom


def github_get(url: str, token: str) -> tuple[int, object]:
    status, payload = json_request(url, "GET", token=token, timeout=30)
    return status, payload


def collect_github(owner: str, name: str, branch: str, token: str) -> tuple[str, list[dict], list[dict], dict | None]:
    tree_url = f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(name)}/git/trees/{urllib.parse.quote(branch)}?recursive=1"
    status, tree = github_get(tree_url, token)
    if status != 200 or not isinstance(tree, dict):
        raise RuntimeError("Repository tree could not be read.")
    sha = str(tree.get("sha") or "")
    paths = []
    for item in tree.get("tree") or []:
        if not isinstance(item, dict) or item.get("type") != "blob":
            continue
        path = str(item.get("path") or "")
        if any(part.lower() in SKIP_DIRS for part in path.split("/")[:-1]):
            continue
        base = path.rsplit("/", 1)[-1]
        if interesting(Path(base)):
            paths.append(path)
        if len(paths) > 40:
            break
        if len(tree.get("tree") or []) > MAX_TREE:
            break
    components: list[dict] = []
    coverage: list[dict] = []
    sbom: dict | None = None
    if tree.get("truncated"):
        coverage.append({"path": "/", "reason": "GitHub truncated the repository tree. Some modules may be unscanned."})
    for path in paths:
        contents_url = f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(name)}/contents/{urllib.parse.quote(path)}?ref={urllib.parse.quote(sha or branch)}"
        status, payload = github_get(contents_url, token)
        if status != 200 or not isinstance(payload, dict) or payload.get("encoding") != "base64":
            coverage.append({"path": path, "reason": "File could not be read from the immutable commit."})
            continue
        try:
            text = base64.b64decode(payload.get("content") or "").decode("utf-8", errors="replace")
        except Exception:
            coverage.append({"path": path, "reason": "File could not be decoded."})
            continue
        if len(text.encode("utf-8")) > MAX_FILE_BYTES:
            coverage.append({"path": path, "reason": "File exceeded the scan size cap and was skipped."})
            continue
        parsed, maybe_sbom, gaps = parse_artifact(path, text)
        components.extend(parsed)
        coverage.extend(gaps)
        if maybe_sbom is not None:
            sbom = maybe_sbom
    if not components and sbom is None:
        coverage.append({"path": "/", "reason": "No supported lockfile or SBOM was found. This is not a clean result."})
    return sha, components, coverage, sbom


def add(components: list[dict], ecosystem: str, package_name: str, version: str, path: str, resolved: bool = True, usage: str = "dependency") -> None:
    name = package_name.strip()
    ver = version.strip().lstrip("v")
    if not name or not ver:
        return
    components.append({
        "ecosystem": ecosystem, "package_name": name, "version": ver, "path": path,
        "module_path": str(Path(path).parent).replace("\\", "/"), "direct": False, "dev": False,
        "resolved": resolved, "usage": usage,
    })


def parse_artifact(path: str, text: str) -> tuple[list[dict], dict | None, list[dict]]:
    base = Path(path).name
    components: list[dict] = []
    coverage: list[dict] = []
    sbom = None
    if base in {"bom.json"} or base.lower().endswith(".cdx.json") or base.lower().endswith(".spdx.json"):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            coverage.append({"path": path, "adapter": "sbom", "reason": "SBOM JSON was not a usable CycloneDX or SPDX document."})
            return components, None, coverage
        return components, payload if isinstance(payload, dict) else None, coverage
    if base == "package-lock.json":
        try:
            lock = json.loads(text)
        except json.JSONDecodeError:
            coverage.append({"path": path, "adapter": "npm", "reason": "package-lock.json could not be parsed."})
            return components, None, coverage
        packages = lock.get("packages") if isinstance(lock, dict) else None
        if isinstance(packages, dict):
            for key, item in packages.items():
                if not key or not isinstance(item, dict):
                    continue
                name = str(item.get("name") or key.rsplit("node_modules/", 1)[-1])
                add(components, "npm", name, str(item.get("version") or ""), path, resolved=True)
        elif isinstance(lock, dict) and isinstance(lock.get("dependencies"), dict):
            for name, item in lock["dependencies"].items():
                if isinstance(item, dict):
                    add(components, "npm", name, str(item.get("version") or ""), path, resolved=True)
        if not components:
            coverage.append({"path": path, "adapter": "npm", "reason": "package-lock.json had no resolved versions."})
        return components, None, coverage
    if base == "composer.lock":
        try:
            lock = json.loads(text)
        except json.JSONDecodeError:
            coverage.append({"path": path, "adapter": "packagist", "reason": "composer.lock could not be parsed."})
            return components, None, coverage
        for item in (lock.get("packages") or []) if isinstance(lock, dict) else []:
            if isinstance(item, dict):
                add(components, "packagist", str(item.get("name") or ""), str(item.get("version") or ""), path)
        return components, None, coverage
    if base == "Pipfile.lock":
        try:
            lock = json.loads(text)
        except json.JSONDecodeError:
            coverage.append({"path": path, "adapter": "pypi", "reason": "Pipfile.lock could not be parsed."})
            return components, None, coverage
        for section in ("default", "develop"):
            block = lock.get(section) if isinstance(lock, dict) else None
            if not isinstance(block, dict):
                continue
            for name, item in block.items():
                version = str((item or {}).get("version") or "").lstrip("=")
                add(components, "pypi", name, version, path)
        return components, None, coverage
    if base == "packages.lock.json":
        try:
            lock = json.loads(text)
        except json.JSONDecodeError:
            coverage.append({"path": path, "adapter": "nuget", "reason": "packages.lock.json could not be parsed."})
            return components, None, coverage
        deps = lock.get("dependencies") if isinstance(lock, dict) else None
        if isinstance(deps, dict):
            for _tfm, packages in deps.items():
                if not isinstance(packages, dict):
                    continue
                for name, item in packages.items():
                    if isinstance(item, dict):
                        add(components, "nuget", name, str(item.get("resolved") or ""), path)
        return components, None, coverage
    if base == "go.sum":
        for line in text.splitlines():
            parts = line.split()
            if len(parts) >= 2 and not parts[1].endswith("/go.mod"):
                add(components, "go", parts[0], parts[1], path)
        return components, None, coverage
    if base == "Cargo.lock":
        name = version = ""
        for line in text.splitlines():
            if line.startswith("name = "):
                name = line.split("=", 1)[1].strip().strip('"')
            elif line.startswith("version = "):
                version = line.split("=", 1)[1].strip().strip('"')
                add(components, "cargo", name, version, path)
                name = version = ""
        return components, None, coverage
    if base == "requirements.txt":
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if "==" in line:
                name, version = line.split("==", 1)
                add(components, "pypi", name, version.split(";")[0], path)
            elif line:
                coverage.append({"path": path, "adapter": "pypi", "reason": f"{line} is not a pinned version. It is not a confirmed match."})
        return components, None, coverage
    if base == "yarn.lock":
        current = ""
        for line in text.splitlines():
            if line.endswith(":") and not line.startswith(" "):
                current = line[:-1].strip().strip('"').split(",")[0]
                if current.startswith("@"):
                    cut = current.find("@", 1)
                    current = current[:cut] if cut > 0 else current
                elif "@" in current:
                    current = current.split("@", 1)[0]
            elif "version" in line and current:
                match = re.search(r'version\s+"?([^"\s]+)"?', line)
                if match:
                    add(components, "npm", current, match.group(1), path)
        return components, None, coverage
    if base in {".nvmrc", ".node-version"}:
        version = text.strip().splitlines()[0].lstrip("v") if text.strip() else ""
        add(components, "node", "node", version, path, resolved=False, usage="declared_runtime")
        coverage.append({"path": path, "adapter": "node", "reason": "Pinned Node file is declared evidence only. It is not the observed production runtime."})
        return components, None, coverage
    if base.lower().startswith("dockerfile"):
        for line in text.splitlines():
            match = re.match(r"(?i)^FROM\s+(?:--platform=\S+\s+)?(\S+)", line.strip())
            if not match or match.group(1).lower() == "scratch":
                continue
            image = match.group(1)
            add(components, "image", image, image.rsplit(":", 1)[-1] if ":" in image and "@" not in image else image, path, resolved="@sha256:" in image, usage="image_tag")
            if "@sha256:" not in image:
                coverage.append({"path": path, "adapter": "image", "reason": f"{image} is a mutable tag. Image OS packages stay unscanned until a digest-linked SBOM is uploaded."})
        return components, None, coverage
    coverage.append({"path": path, "reason": f"{base} was collected as coverage only. Upload a resolved lockfile or SBOM for confirmed matches."})
    return components, None, coverage


def upload_agent(api: str, token: str, job_id: int, repo_id: int, commit: str, components: list[dict], coverage: list[dict], sbom: dict | None) -> None:
    body: dict = {
        "schema_version": SCHEMA,
        "job_id": job_id,
        "repository_id": repo_id,
        "commit_sha": commit,
        "components": components,
        "coverage": coverage,
        "collector_version": VERSION,
    }
    if sbom is not None:
        body["sbom"] = sbom
    status, payload = json_request(f"{api}/api/security/agent/jobs/{job_id}/results", "POST", token=token, body=body)
    if status not in {200, 202}:
        raise RuntimeError(str(payload.get("error") or "Inventory upload failed."))
    print(f"Uploaded inventory for job {job_id}. Findings are stored on the API after correlation.")


def upload_ci(api: str, portal_token: str, repo_id: int, commit: str, components: list[dict], coverage: list[dict], sbom: dict | None) -> None:
    body: dict = {
        "schema_version": SCHEMA,
        "repository_id": repo_id,
        "commit_sha": commit,
        "components": components,
        "coverage": coverage,
    }
    if sbom is not None:
        body["sbom"] = sbom
    status, payload = json_request(f"{api}/api/devops/security/inventories", "POST", token=portal_token, body=body)
    if status not in {200, 202}:
        raise RuntimeError(str(payload.get("error") or "CI inventory upload failed."))
    print(f"Uploaded CI inventory for repository {repo_id}. Findings are stored on the API after correlation.")


def run_claimed_job(api: str, token: str, job: dict, repo_dir: str, github_token: str) -> None:
    job_id = int(job.get("id") or 0)
    repo_id = int(job.get("repo_id") or 0)
    owner = str(job.get("owner") or "")
    name = str(job.get("name") or "")
    branch = str(job.get("branch") or "main")
    if job_id <= 0 or repo_id <= 0:
        raise RuntimeError("Claimed job is missing identifiers.")
    sbom = None
    if repo_dir:
        root = Path(repo_dir).expanduser()
        components, coverage, sbom = collect_local(root)
        commit = git_commit(root)
    elif github_token:
        commit, components, coverage, sbom = collect_github(owner, name, branch, github_token)
    else:
        raise RuntimeError("Set VULN_REPO_DIR for a local checkout, or GITHUB_TOKEN to read lockfiles. Images are not pulled.")
    if not commit:
        raise RuntimeError("commit_sha is required. Use a git checkout or a resolved GitHub ref.")
    upload_agent(api, token, job_id, repo_id, commit, components, coverage, sbom)


def main() -> int:
    parser = argparse.ArgumentParser(description="OpsTrellis private vulnerability inventory agent")
    parser.add_argument("--env-file", default="", help="Optional env file. Defaults to workers/.env")
    parser.add_argument("--api", default="")
    parser.add_argument("--once", action="store_true", help="Claim at most one job, then exit")
    parser.add_argument("--ci", action="store_true", help="Upload the local checkout or SBOM without claiming an agent job")
    parser.add_argument("--repo-dir", default="")
    parser.add_argument("--repository-id", type=int, default=0)
    parser.add_argument("--commit", default="")
    parser.add_argument("--sbom", default="")
    args, _unknown = parser.parse_known_args()
    load_worker_env(args.env_file)

    api = (args.api or env_text("OPSTRELLIS_API_URL", default="http://localhost:8080")).rstrip("/")
    repo_dir = args.repo_dir or env_text("VULN_REPO_DIR")
    poll = env_int("VULN_POLL_SECONDS") or 15
    github_token = env_text("GITHUB_TOKEN")
    bootstrap = env_text("VULN_BOOTSTRAP_TOKEN")
    token = load_agent_token()

    if args.ci:
        portal = env_text("VULN_PORTAL_TOKEN")
        repo_id = args.repository_id or env_int("VULN_REPOSITORY_ID") or 0
        commit = args.commit or env_text("VULN_COMMIT_SHA")
        if repo_id <= 0 or not portal:
            print("CI upload needs VULN_PORTAL_TOKEN and VULN_REPOSITORY_ID in workers/.env.", file=sys.stderr)
            return 1
        sbom = None
        components: list[dict] = []
        coverage: list[dict] = []
        if args.sbom or env_text("VULN_SBOM_FILE"):
            sbom_path = Path(args.sbom or env_text("VULN_SBOM_FILE")).expanduser()
            sbom = json.loads(sbom_path.read_text(encoding="utf-8"))
        elif repo_dir:
            components, coverage, sbom = collect_local(Path(repo_dir).expanduser())
            commit = commit or git_commit(Path(repo_dir).expanduser())
        else:
            print("CI upload needs --sbom or VULN_REPO_DIR.", file=sys.stderr)
            return 1
        if not commit:
            print("CI upload needs a commit SHA.", file=sys.stderr)
            return 1
        try:
            upload_ci(api, portal, repo_id, commit, components, coverage, sbom if isinstance(sbom, dict) else None)
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        return 0

    if not token:
        if not bootstrap:
            print("Set VULN_BOOTSTRAP_TOKEN from Security → Agents & sources, then rerun. The token is shown once.", file=sys.stderr)
            return 1
        try:
            token = enroll(api, bootstrap)
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1

    while True:
        try:
            heartbeat(api, token)
            job = claim_job(api, token)
            if job:
                run_claimed_job(api, token, job, repo_dir, github_token)
            elif args.once:
                print("No queued agent jobs.")
                return 0
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            heartbeat(api, token, error=str(exc))
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(max(5, poll))


if __name__ == "__main__":
    raise SystemExit(main())
