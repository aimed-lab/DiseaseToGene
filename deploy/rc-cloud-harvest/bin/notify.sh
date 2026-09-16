#!/usr/bin/env bash
# deploy/rc-cloud-harvest/bin/notify.sh — post a run summary as a comment on a GitHub issue.
#   bash deploy/rc-cloud-harvest/bin/notify.sh <snapshotId>
# Reads GITHUB_TOKEN, GITHUB_REPO (default aimed-lab/DiseaseToGene) and NOTIFY_ISSUE from .env.
# The token needs only issues:write. Posts runs/<id>.summary.txt; nothing from .env is sent.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"
[ $# -ge 1 ] || { echo 'usage: notify.sh <snapshotId>'; exit 2; }
SNAP="$1"
SUMMARY="runs/$SNAP.summary.txt"
[ -s "$SUMMARY" ] || { echo "no $SUMMARY"; exit 1; }
# read only the three keys we need, without exporting the rest of .env into this shell
val() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r'; }
TOKEN=$(val GITHUB_TOKEN); REPO=$(val GITHUB_REPO); ISSUE=$(val NOTIFY_ISSUE)
REPO=${REPO:-aimed-lab/DiseaseToGene}
[ -n "$TOKEN" ] && [ -n "$ISSUE" ] || { echo "GITHUB_TOKEN / NOTIFY_ISSUE not set — skipping notification"; exit 0; }
body=$(printf 'Harvest run — snapshot #%s on %s\n\n```\n%s\n```\n' "$SNAP" "$(hostname)" "$(head -c 60000 "$SUMMARY")")
payload=$(node -e 'process.stdout.write(JSON.stringify({ body: require("fs").readFileSync(0, "utf8") }))' <<< "$body")
code=$(curl -sS -o /tmp/notify.out -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/issues/$ISSUE/comments" -d "$payload")
if [ "$code" = 201 ]; then echo "posted to $REPO#$ISSUE"; else echo "notify failed ($code): $(head -c 300 /tmp/notify.out)"; exit 1; fi
