"""Shared helpers for private monitoring workers.

Environment is loaded in this order, first existing value wins:
1. Process environment (systemd, Docker, Kubernetes, exported shell vars)
2. --env-file or WORKERS_ENV_FILE
3. workers/.env next to these files

Secret values are never printed. Grafana connectors store GRAFANA_TOKEN.
Splunk connectors store SPLUNK_TOKEN. Private sample pushes store
PRIVATE_SAMPLE_SECRET. The worker reads those same names from the loaded
environment.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


WORKER_DIR = Path(__file__).resolve().parent


def load_worker_env(env_file: str = "") -> None:
    candidates = []
    if env_file.strip():
        candidates.append(Path(env_file).expanduser())
    named = os.environ.get("WORKERS_ENV_FILE", "").strip()
    if named:
        candidates.append(Path(named).expanduser())
    candidates.append(WORKER_DIR / ".env")
    for path in candidates:
        if path.is_file():
            _apply_env_file(path)
            return


def _apply_env_file(path: Path) -> None:
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def env_text(*names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return default


def env_int(*names: str) -> int | None:
    raw = env_text(*names)
    if not raw:
        return None
    return int(raw)


def secret_from_ref(secret_ref: str) -> str:
    name = secret_ref.strip() or hmac_secret_ref()
    return os.environ.get(name, "")


def hmac_secret_ref() -> str:
    return env_text("PRIVATE_SAMPLE_SECRET_REF", "MONITORING_SECRET_REF", default="PRIVATE_SAMPLE_SECRET")


def source_name() -> str:
    return env_text("MONITORING_SOURCE", default="private").lower()


def source_settings(source: str) -> dict[str, str]:
    if source == "grafana":
        return {
            "token_ref": "GRAFANA_TOKEN",
            "base_url": env_text("GRAFANA_BASE_URL"),
            "query": env_text("GRAFANA_QUERY"),
            "query_url": env_text("GRAFANA_QUERY_URL"),
            "allow_host": env_text("GRAFANA_ALLOW_HOST"),
            "datasource_uid": env_text("GRAFANA_DATASOURCE_UID"),
        }
    if source == "splunk":
        return {
            "token_ref": "SPLUNK_TOKEN",
            "base_url": env_text("SPLUNK_BASE_URL"),
            "query": env_text("SPLUNK_QUERY"),
            "query_url": env_text("SPLUNK_QUERY_URL"),
            "allow_host": env_text("SPLUNK_ALLOW_HOST"),
            "datasource_uid": "",
        }
    return {
        "token_ref": hmac_secret_ref(),
        "base_url": "",
        "query": "",
        "query_url": env_text("PRIVATE_QUERY_URL", "MONITORING_QUERY_URL"),
        "allow_host": env_text("PRIVATE_ALLOW_HOST", "MONITORING_ALLOW_HOST"),
        "datasource_uid": "",
    }


def source_query_url(source: str, settings: dict[str, str]) -> str:
    if settings.get("query_url"):
        return settings["query_url"]
    base = settings.get("base_url", "").rstrip("/")
    query = settings.get("query", "")
    if source == "grafana" and base and settings.get("datasource_uid") and query:
        uid = urllib.parse.quote(settings["datasource_uid"], safe="")
        return f"{base}/api/datasources/proxy/uid/{uid}/api/v1/query?query={urllib.parse.quote(query)}"
    if source == "splunk" and base and query:
        search = query if query.lower().startswith("search ") else f"search {query}"
        return f"{base}/services/search/jobs/export?output_mode=json&search={urllib.parse.quote(search)}"
    return ""


def parse_mapped_counts(payload: object) -> tuple[int, int]:
    if not isinstance(payload, dict):
        return 0, 0
    if "good" in payload or "total" in payload:
        good = int(payload.get("good") or 0)
        total = int(payload.get("total") or good)
        return good, total
    result = payload.get("data", {}).get("result") if isinstance(payload.get("data"), dict) else None
    if isinstance(result, list) and result:
        value = result[0].get("value") if isinstance(result[0], dict) else None
        if isinstance(value, list) and len(value) > 1:
            total = int(float(value[1]))
            return total, total
    return 0, 0


def push_sample(*, api: str, connector_id: int, service_id: int, environment: str, good: int, total: int, secret: str) -> str:
    body = json.dumps({
        "service_id": service_id,
        "environment": environment,
        "good": good,
        "total": total,
    }).encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        f"{api.rstrip('/')}/api/webhooks/monitoring-samples?connector_id={connector_id}",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Hub-Signature-256": f"sha256={digest}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(exc.read().decode("utf-8") or str(exc)) from exc
