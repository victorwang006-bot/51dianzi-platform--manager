#!/usr/bin/env bash
# Offline incremental candidate recovery only. No deploy/apply/SSH/PM2/DB.
set -euo pipefail
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$TOOLS/../.." && pwd -P)"
WORK=/home/ubuntu/work/channel-reference-phase2-20261114
MODE="${1:-}"
case "$MODE" in frontend|backend) ;; *) echo 'Usage: build-candidates-local.sh frontend|backend' >&2; exit 2;; esac
cd "$REPO"
if [[ "$MODE" == frontend ]]; then
  mkdir -p "$WORK/frontend-candidate"
  node "$TOOLS/frontend-build.cjs"
  node "$TOOLS/merge.cjs"
  node "$TOOLS/frontend-tests/bindings.cjs"
  node "$TOOLS/frontend-tests/native.cjs"
  node "$TOOLS/frontend-proof.cjs"
else
  mkdir -p "$WORK/backend-candidate/evidence"
  # Requires exact current source freeze, parent capture and archived auth evidence.
  # Never executes the historical worker or the real admin candidate entrypoint.
  node "$TOOLS/service-build.cjs"
  python3 "$TOOLS/rebind-final-graph-pins.py"
  node "$TOOLS/backend-build.cjs"
  node "$TOOLS/backend-test.cjs"
  node "$WORK/backend-candidate/invariant-test.cjs"
  node "$TOOLS/freeze-check.cjs"
fi
printf '%s\n' 'LOCAL CANDIDATE ONLY; formal research/prepare/source binding/release still gated.'
