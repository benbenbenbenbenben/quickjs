#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-master}"
UPSTREAM_TRACKING_BRANCH="${UPSTREAM_TRACKING_BRANCH:-upstream-main}"
FEATURE_BRANCH="${FEATURE_BRANCH:-debugger}"

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: this script must be run inside a git repository" >&2
  exit 1
fi

if ! git remote get-url "$UPSTREAM_REMOTE" > /dev/null 2>&1; then
  echo "Error: upstream remote '$UPSTREAM_REMOTE' not found." >&2
  echo "Add it with, for example:" >&2
  echo "  git remote add $UPSTREAM_REMOTE https://github.com/bellard/quickjs.git" >&2
  exit 1
fi

set -x

git fetch "$UPSTREAM_REMOTE"

if git show-ref --verify --quiet "refs/heads/$UPSTREAM_TRACKING_BRANCH"; then
  git checkout "$UPSTREAM_TRACKING_BRANCH"
  git reset --hard "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
else
  git checkout -b "$UPSTREAM_TRACKING_BRANCH" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
fi

git checkout "$FEATURE_BRANCH"
git rebase "$UPSTREAM_TRACKING_BRANCH"

make -j"$(nproc)"
make test
