#!/usr/bin/env bash
set -euo pipefail

# Build QuickJS wasm + the browser-debugger example inside a container.
# This keeps host dependencies to just a container runtime (Docker/Podman).

RUNTIME="${CONTAINER_RUNTIME:-docker}"
IMAGE="${QUICKJS_BROWSER_DEBUGGER_IMAGE:-emscripten/emsdk:3.1.56}"

if ! command -v "$RUNTIME" >/dev/null 2>&1; then
  echo "Error: container runtime '$RUNTIME' not found (set CONTAINER_RUNTIME=docker or podman)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec "$RUNTIME" run --rm \
  -v "$REPO_ROOT":/src \
  -w /src \
  "$IMAGE" \
  bash examples/browser-debugger/build-inside.sh
