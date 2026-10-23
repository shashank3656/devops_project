#!/usr/bin/env python3
"""Push mapped good/total counts from a private network.

Values can come from workers/.env, WORKERS_ENV_FILE, or already-exported
environment variables. Do not pass the HMAC key on the command line.
"""

from __future__ import annotations

import argparse
import sys

from common import env_int, env_text, hmac_secret_ref, load_worker_env, push_sample, secret_from_ref


def main() -> int:
    parser = argparse.ArgumentParser(description="Push a private monitoring sample")
    parser.add_argument("--env-file", default="", help="Optional env file. Defaults to workers/.env")
    parser.add_argument("--api", default="")
    parser.add_argument("--connector-id", type=int, default=0)
    parser.add_argument("--service-id", type=int, default=0)
    parser.add_argument("--environment", default="")
    parser.add_argument("--good", type=int, default=None)
    parser.add_argument("--total", type=int, default=None)
    parser.add_argument("--secret-ref", default="")
    args, _unknown = parser.parse_known_args()
    load_worker_env(args.env_file)

    api = args.api or env_text("OPSTRELLIS_API_URL", default="http://localhost:8080")
    connector_id = args.connector_id or env_int("MONITORING_CONNECTOR_ID") or 0
    service_id = args.service_id or env_int("MONITORING_SERVICE_ID") or 0
    environment = args.environment or env_text("MONITORING_SERVICE_ENVIRONMENT")
    good = args.good if args.good is not None else env_int("MONITORING_GOOD")
    total = args.total if args.total is not None else env_int("MONITORING_TOTAL")
    secret_ref = args.secret_ref or hmac_secret_ref()
    if connector_id <= 0 or service_id <= 0 or not environment or good is None or total is None:
        print("Set connector, service, environment, good, and total in workers/.env or flags.", file=sys.stderr)
        return 1
    secret = secret_from_ref(secret_ref)
    if not secret:
        print(f"Set {secret_ref} in the worker environment or workers/.env; do not pass the key on the command line.", file=sys.stderr)
        return 1
    try:
        print(push_sample(api=api, connector_id=connector_id, service_id=service_id, environment=environment, good=good, total=total, secret=secret))
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
