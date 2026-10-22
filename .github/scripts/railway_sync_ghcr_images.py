#!/usr/bin/env python3
"""Update Railway Docker image tags for services matching GHCR prefixes, then deploy."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API = "https://backboard.railway.com/graphql/v2"


def gql(token: str, query: str, variables: dict) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        API,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    if payload.get("errors"):
        raise RuntimeError(json.dumps(payload["errors"], indent=2))
    return payload.get("data") or {}


def main() -> int:
    token = os.environ.get("RAILWAY_TOKEN", "").strip()
    project_id = os.environ.get("PROJECT_ID", "").strip()
    environment_id = os.environ.get("ENVIRONMENT_ID", "").strip()
    tag = os.environ.get("IMAGE_TAG", "").strip()
    prefixes = json.loads(os.environ.get("IMAGE_PREFIXES", "[]"))

    if not token or not project_id or not environment_id or not tag or not prefixes:
        print("Missing RAILWAY_TOKEN, PROJECT_ID, ENVIRONMENT_ID, IMAGE_TAG, or IMAGE_PREFIXES", file=sys.stderr)
        return 1

    services_data = gql(
        token,
        """
        query ProjectServices($projectId: String!) {
          project(id: $projectId) {
            services {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
        }
        """,
        {"projectId": project_id},
    )
    edges = (((services_data.get("project") or {}).get("services") or {}).get("edges")) or []
    updated = []

    for edge in edges:
        node = (edge or {}).get("node") or {}
        service_id = node.get("id") or ""
        service_name = node.get("name") or service_id
        if not service_id:
            continue

        inst_data = gql(
            token,
            """
            query ServiceInstance($serviceId: String!, $environmentId: String!) {
              serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
                source {
                  image
                }
              }
            }
            """,
            {"serviceId": service_id, "environmentId": environment_id},
        )
        image = (((inst_data.get("serviceInstance") or {}).get("source") or {}).get("image")) or ""
        if not image:
            continue

        base = image.split("@")[0]
        if ":" in base:
            base = base.rsplit(":", 1)[0]

        matched_prefix = None
        for prefix in prefixes:
            if base == prefix or base.startswith(prefix) or image.startswith(prefix):
                matched_prefix = prefix
                break
        if not matched_prefix:
            continue

        new_image = f"{matched_prefix}:{tag}"
        if new_image == image:
            print(f"Skip {service_name}: already on {new_image}")
            continue

        gql(
            token,
            """
            mutation ServiceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
              serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
            }
            """,
            {
                "serviceId": service_id,
                "environmentId": environment_id,
                "input": {"source": {"image": new_image}},
            },
        )
        gql(
            token,
            """
            mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
              serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
            }
            """,
            {"serviceId": service_id, "environmentId": environment_id},
        )
        updated.append(service_name)
        print(f"Updated {service_name} -> {new_image}")

    if not updated:
        print("No Railway services matched the GHCR image prefixes.", file=sys.stderr)
        return 2
    print(f"Successfully updated {len(updated)} service(s): {', '.join(updated)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        print(exc.read().decode(), file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
