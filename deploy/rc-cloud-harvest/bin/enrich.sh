#!/usr/bin/env bash
# deploy/rc-cloud-harvest/bin/enrich.sh — re-run one or more axes on an existing snapshot.
#   bash deploy/rc-cloud-harvest/bin/enrich.sh <snapshotId> <axis> [axis…] [--dry]
#   bash deploy/rc-cloud-harvest/bin/enrich.sh 124 clinical literature
# Same logging and lineage record as harvest.sh (it IS harvest.sh with --snapshot and --axes).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ $# -ge 2 ] || { echo 'usage: enrich.sh <snapshotId> <axis> [axis…] [--dry]'; exit 2; }
SNAP="$1"; shift
DRY=""; AXES=""
for a in "$@"; do case "$a" in --dry) DRY="--dry";; *) AXES="${AXES:+$AXES,}$a";; esac; done
exec bash "$HERE/harvest.sh" --snapshot "$SNAP" --axes "$AXES" --no-kg $DRY
