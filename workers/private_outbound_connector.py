#!/usr/bin/env python3
"""Query Grafana or Splunk inside a private network, then HMAC-push counts.

MONITORING_SOURCE selects grafana, splunk, or private. Grafana uses
GRAFANA_TOKEN / GRAFANA_BASE_URL. Splunk uses SPLUNK_TOKEN / SPLUNK_BASE_URL.
The OpsTrellis push still uses PRIVATE_SAMPLE_SECRET. Tokens are never printed.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

from common import (
    env_int,
    env_text,
    hmac_secret_ref,
    load_worker_env,
    parse_mapped_counts,
    push_sample,
    secret_from_ref,
    source_name,
    source_query_url,
    source_settings,
)


def allowed_host(url: str, extra: str) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    allow = {"127.0.0.1", "localhost", "::1"}
    if extra.strip():
        allow.add(extra.strip().lower())
    return host in allow


def main() -> int:
    parser = argparse.ArgumentParser(description="Private outbound monitoring connector")
    parser.add_argument("--env-file", default="", help="Optional env file. Defaults to workers/.env")
    parser.add_argument("--source", default="")
    parser.add_argument("--api", default="")
    parser.add_argument("--connector-id", type=int, default=0)
    parser.add_argument("--service-id", type=int, default=0)
    parser.add_argument("--environment", default="")
    parser.add_argument("--query-url", default="")
    parser.add_argument("--allow-host", default="")
    parser.add_argument("--secret-ref", default="")
    args, _unknown = parser.parse_known_args()
    load_worker_env(args.env_file)

    source = (args.source or source_name()).lower()
    settings = source_settings(source)
    api = args.api or env_text("OPSTRELLIS_API_URL", default="http://localhost:8080")
    connector_id = args.connector_id or env_int("MONITORING_CONNECTOR_ID") or 0
    service_id = args.service_id or env_int("MONITORING_SERVICE_ID") or 0
    environment = args.environment or env_text("MONITORING_SERVICE_ENVIRONMENT")
    query_url = args.query_url or source_query_url(source, settings)
    allow_host = args.allow_host or settings.get("allow_host", "")
    hmac_ref = args.secret_ref or hmac_secret_ref()
    if connector_id <= 0 or service_id <= 0 or not environment or not query_url:
        print("Set connector, service, environment, and the Grafana or Splunk query settings in workers/.env.", file=sys.stderr)
        return 1
    if not allowed_host(query_url, allow_host):
        print("Query URL host is not allowlisted. Use localhost or set GRAFANA_ALLOW_HOST / SPLUNK_ALLOW_HOST.", file=sys.stderr)
        return 1
    hmac_secret = secret_from_ref(hmac_ref)
    if not hmac_secret:
        print(f"Set {hmac_ref} in the worker environment or workers/.env; do not pass the key on the command line.", file=sys.stderr)
        return 1
    headers = {"Accept": "application/json"}
    read_token = secret_from_ref(settings["token_ref"]) if source in {"grafana", "splunk"} else ""
    if read_token:
        headers["Authorization"] = f"Bearer {read_token}"
    request = urllib.request.Request(query_url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    good, total = parse_mapped_counts(payload)
    try:
        print(push_sample(api=api, connector_id=connector_id, service_id=service_id, environment=environment, good=good, total=total, secret=hmac_secret))
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
