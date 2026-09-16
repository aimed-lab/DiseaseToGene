#!/usr/bin/env bash
# deploy/rc-cloud-harvest/bin/status.sh — per-axis gene coverage of a snapshot (read-only).
#   bash deploy/rc-cloud-harvest/bin/status.sh <snapshotId>
#   bash deploy/rc-cloud-harvest/bin/status.sh            # lists every snapshot
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
if [ $# -ge 1 ]; then
  npx tsx --env-file=.env scripts/d2t.ts status "$1"
else
  npx tsx --env-file=.env scripts/d2t.ts list
fi
