
#!/usr/bin/env python3
"""Update Railway Docker image tags for matching GHCR services, then deploy."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API = "https://backboard.railway.com/graphql/v2"
USER_AGENT = "railway-ghcr-image-sync/1.0"


def gql(token: str, query: str, variables: dict) -> dict:
    body = json.dumps(
        {"query": query, "variables": variables}
    ).encode("utf-8")

    req = urllib.request.Request(
        API,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            response_body = resp.read().decode("utf-8")
            status = resp.status

    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        print(
            f"Railway HTTP error: {exc.code} {exc.reason}",
            file=sys.stderr,
        )
        print(f"Response: {response_body[:5000]}", file=sys.stderr)
        raise

    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Could not connect to Railway API: {exc.reason}"
        ) from exc

    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Railway returned invalid JSON (HTTP {status}): "
            f"{response_body[:1000]}"
        ) from exc

    if payload.get("errors"):
        raise RuntimeError(
            "Railway GraphQL errors:\n"
            + json.dumps(payload["errors"], indent=2)
        )

    return payload.get("data") or {}


def normalize_image(image: str) -> str:
    """Remove digest and tag while preserving registry ports."""
    image = image.strip().split("@", 1)[0]
    last_slash = image.rfind("/")
    last_colon = image.rfind(":")

    # A colon after the last slash represents an image tag.
    # A colon before the last slash may be a registry port.
    if last_colon > last_slash:
        image = image[:last_colon]

    return image


def main() -> int:
    token = os.environ.get("RAILWAY_TOKEN", "").strip()
    project_id = os.environ.get("PROJECT_ID", "").strip()
    environment_id = os.environ.get("ENVIRONMENT_ID", "").strip()
    tag = os.environ.get("IMAGE_TAG", "").strip()

    try:
        prefixes = json.loads(
            os.environ.get("IMAGE_PREFIXES", "[]")
        )
    except json.JSONDecodeError as exc:
        raise RuntimeError("IMAGE_PREFIXES is not valid JSON.") from exc

    if not all((token, project_id, environment_id, tag)):
        raise RuntimeError(
            "Missing RAILWAY_TOKEN, PROJECT_ID, "
            "ENVIRONMENT_ID, or IMAGE_TAG."
        )

    if (
        not isinstance(prefixes, list)
        or not prefixes
        or not all(isinstance(p, str) and p.strip() for p in prefixes)
    ):
        raise RuntimeError(
            "IMAGE_PREFIXES must be a nonempty JSON array of strings."
        )

    prefixes = [p.strip().rstrip("/") for p in prefixes]

    print(f"Connecting to Railway GraphQL API: {API}")
    print(f"Image tag: {tag}")
    print(f"Image prefixes: {json.dumps(prefixes)}")

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

    project = services_data.get("project")
    if not project:
        raise RuntimeError(
            "Railway returned no project. Check PROJECT_ID and token access."
        )

    edges = (
        ((project.get("services") or {}).get("edges")) or []
    )

    if not edges:
        print("No services found in the Railway project.")
        return 2

    updated = []
    matched = 0

    for edge in edges:
        node = (edge or {}).get("node") or {}
        service_id = node.get("id") or ""
        service_name = node.get("name") or service_id

        if not service_id:
            continue

        inst_data = gql(
            token,
            """
            query ServiceInstance(
              $serviceId: String!
              $environmentId: String!
            ) {
              serviceInstance(
                serviceId: $serviceId
                environmentId: $environmentId
              ) {
                source {
                  image
                }
              }
            }
            """,
            {
                "serviceId": service_id,
                "environmentId": environment_id,
            },
        )

        instance = inst_data.get("serviceInstance")
        if not instance:
            print(
                f"Skip {service_name}: no instance in this environment"
            )
            continue

        source = instance.get("source") or {}
        image = (source.get("image") or "").strip()

        if not image:
            print(f"Skip {service_name}: no Docker image configured")
            continue

        repository = normalize_image(image)

        matched_prefix = next(
            (
                prefix
                for prefix in prefixes
                if repository == prefix
                or repository.startswith(prefix + "/")
                or repository.startswith(prefix + "-")
            ),
            None,
        )

        if not matched_prefix:
            print(f"Skip {service_name}: image does not match prefixes")
            continue

        matched += 1

        # Preserve the actual repository name returned by Railway.
        # Replace only its tag; don't accidentally change registry paths.
        new_image = f"{repository}:{tag}"

        if image == new_image:
            print(f"Skip {service_name}: already on {new_image}")
            continue

        print(f"Updating {service_name}: {image} -> {new_image}")

        gql(
            token,
            """
            mutation ServiceInstanceUpdate(
              $serviceId: String!
              $environmentId: String!
              $input: ServiceInstanceUpdateInput!
            ) {
              serviceInstanceUpdate(
                serviceId: $serviceId
                environmentId: $environmentId
                input: $input
              )
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
            mutation ServiceInstanceDeploy(
              $serviceId: String!
              $environmentId: String!
            ) {
              serviceInstanceDeployV2(
                serviceId: $serviceId
                environmentId: $environmentId
              )
            }
            """,
            {
                "serviceId": service_id,
                "environmentId": environment_id,
            },
        )

        updated.append(service_name)
        print(f"Successfully submitted deployment for {service_name}")

    if not matched:
        print(
            "No Railway services matched the GHCR image prefixes.",
            file=sys.stderr,
        )
        return 2

    if updated:
        print(
            f"Successfully updated {len(updated)} service(s): "
            + ", ".join(updated)
        )
    else:
        print("All matching services already use the requested tag.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError:
        # The HTTP status and response body were already printed.
        raise SystemExit(1)
    except Exception as exc:
        print(f"::error::{exc}", file=sys.stderr)
        raise SystemExit(1)
