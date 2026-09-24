#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test
for f in *_test.go; do
  [ -e "$f" ] || continue
  mv "$f" test/
done
echo "Moved tests; count in test/: $(ls test/*_test.go 2>/dev/null | wc -l | tr -d ' ')"
