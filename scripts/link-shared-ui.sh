#!/usr/bin/env bash
# BRD-05: one shared-ui tree — portals symlink to devops_project/shared-ui
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for portal in devops-frontend; do
  target="$ROOT/$portal/shared-ui"
  if [ -L "$target" ]; then
    echo "OK $portal/shared-ui -> $(readlink "$target")"
    continue
  fi
  if [ -d "$target" ]; then
    rm -rf "$target"
  fi
  ln -s ../shared-ui "$target"
  echo "Linked $portal/shared-ui -> ../shared-ui"
done
