#!/usr/bin/env bash
# deploy/rc-cloud-harvest/bin/harvest.sh — the whole pipeline for one disease, logged.
#
#   bash deploy/rc-cloud-harvest/bin/harvest.sh "<disease>" [geneCount] [options]
#
#   harvest → enrich × 12 axes (cheap/local first) → kg → status
#
# options
#   --snapshot <id>        skip the harvest step; enrich an existing snapshot
#   --axes a,b,c           only these axes (default: all, in AXES.md order)
#   --skip <axis>          skip one axis (repeatable)
#   --no-kg                do not project the knowledge graph at the end
#   --dry                  fetch, write nothing (needs Oracle to READ; the harvest step is dry too)
#
# A failed axis does not stop the run: it is recorded, the next axis runs, and the summary
# lists what to re-run with enrich.sh. Everything goes to logs/<date>_<disease>.log and the
# per-step record to runs/<id>.lineage.yaml (the wiki's lineage format — see README §5).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

DISEASE=""; COUNT=7500; SNAP=""; AXES=""; SKIP=""; KG=1; DRY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) SNAP="$2"; shift 2;;
    --axes)     AXES="$2"; shift 2;;
    --skip)     SKIP="$SKIP,$2"; shift 2;;
    --no-kg)    KG=0; shift;;
    --dry)      DRY="--dry"; shift;;
    -h|--help)  sed -n '2,20p' "$0"; exit 0;;
    *) if [ -z "$DISEASE" ]; then DISEASE="$1"; elif [[ "$1" =~ ^[0-9]+$ ]]; then COUNT="$1"; else echo "unexpected argument: $1"; exit 2; fi; shift;;
  esac
done
if [ -z "$DISEASE" ] && [ -z "$SNAP" ]; then echo 'usage: harvest.sh "<disease>" [geneCount] [--snapshot <id>] [--axes a,b] [--skip x] [--no-kg] [--dry]'; exit 2; fi

# ── environment ──
[ -f .env ] || { echo "FAIL .env missing (see README §2)"; exit 1; }
[ -f .venv/bin/activate ] && source .venv/bin/activate     # winner CLI for the network axis
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
mkdir -p logs runs
LOCK=runs/.harvest.lock
if ! ( set -o noclobber; echo $$ > "$LOCK" ) 2>/dev/null; then
  echo "another harvest is running (pid $(cat "$LOCK")) — one at a time; remove $LOCK if it is stale"; exit 1; fi
trap 'rm -f "$LOCK"' EXIT

STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
SLUG=$(echo "${DISEASE:-snapshot-$SNAP}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g; s/^-//; s/-$//')
LOG="logs/${STAMP}_${SLUG}.log"; ln -sf "$(basename "$LOG")" logs/latest.log
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
DIRTY=$([ -n "$(git status --porcelain 2>/dev/null | grep -v '^?? ')" ] && echo true || echo false)
D2T="npx tsx --env-file=.env scripts/d2t.ts"
ALL_AXES="expression proteomics dependency safety tissue mutation annotation druggability clinical patents literature network"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }
run() { # run <label> <cmd...>  → appends output to the log, returns the exit status
  local label="$1"; shift
  log "── $label: $*"
  "$@" 2>&1 | tee -a "$LOG"
  return "${PIPESTATUS[0]}"
}

# ── lineage record (the wiki's format; README §5) ──
LINEAGE=""
lineage_open() {
  LINEAGE="runs/$1.lineage.yaml"
  cat > "$LINEAGE" <<EOF
---
snapshot: $1
disease_name: "${DISEASE}"
kind: reconstructed
reconstructed_on: $(date -u +%Y-%m-%d)
reconstructed_by: harvest.sh on $(hostname) (recorded at run time, not reconstructed afterwards — set confidence to high when publishing)
reconstructed_from: run log $LOG · git commit $COMMIT$([ "$DIRTY" = true ] && echo ' (working tree had uncommitted changes)')
runs:
EOF
}
lineage_add() { # id axis evidence_type script params started finished status
  [ -n "$LINEAGE" ] || return 0
  cat >> "$LINEAGE" <<EOF
  - id: $1
    axis: $2
    evidence_type: $3
    script: "$4"
    commit: $COMMIT
    ran_at: $6
    finished_at: $7
    status: $8
    source: see AXES.md for the source of this axis; source_version is recorded by the axis in its own rows where the source reports one
    params: $5
    confidence: high
EOF
}
etype() { case "$1" in expression) echo expression_tvn;; literature) echo literature_epmc;; *) echo "$1";; esac; }

log "harvest.sh · disease=\"${DISEASE}\" count=$COUNT snapshot=${SNAP:-new} commit=$COMMIT dirty=$DIRTY dry=${DRY:-no}"
log "log: $LOG"

# ── 1. harvest ──
if [ -z "$SNAP" ]; then
  t0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  out=$(mktemp)
  log "── harvest: $D2T harvest \"$DISEASE\" $COUNT $DRY"
  $D2T harvest "$DISEASE" "$COUNT" $DRY 2>&1 | tee -a "$LOG" | tee "$out" >/dev/null
  st=${PIPESTATUS[0]}
  SNAP=$(grep -oE 'SAVED snapshot #[0-9]+' "$out" | grep -oE '[0-9]+' | tail -1)
  rm -f "$out"
  if [ "$st" != 0 ] || [ -z "$SNAP" ]; then
    if [ -n "$DRY" ]; then log "dry harvest finished; no snapshot was created, so the axes cannot run. Use --snapshot <id> --dry to dry-run axes on an existing snapshot."; exit 0; fi
    log "FAIL harvest step (exit $st) — nothing to enrich"; exit 1
  fi
  lineage_open "$SNAP"
  lineage_add "r${SNAP}-harvest" harvest null "scripts/d2t.ts harvest" "{ disease: \"$DISEASE\", gene_count_requested: $COUNT, candidate_rule: \"top $COUNT by Open Targets overall association score\" }" "$t0" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ok
  log "✔ snapshot #$SNAP created"
else
  lineage_open "$SNAP"
  log "using existing snapshot #$SNAP"
fi

# ── 2. axes ──
if [ -n "$AXES" ]; then LIST=$(echo "$AXES" | tr ',' ' '); else LIST="$ALL_AXES"; fi
OKS=""; FAILS=""; SKIPPED=""
for ax in $LIST; do
  if echo ",$SKIP," | grep -q ",$ax,"; then SKIPPED="$SKIPPED $ax"; log "skip $ax"; continue; fi
  t0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if run "enrich $ax" $D2T enrich "$SNAP" "$ax" $DRY; then st=ok; OKS="$OKS $ax"; else st=failed; FAILS="$FAILS $ax"; log "✗ $ax failed — continuing with the next axis"; fi
  lineage_add "r${SNAP}-$ax" "$ax" "$(etype "$ax")" "scripts/d2t.ts enrich $SNAP $ax" "{ dry: $([ -n "$DRY" ] && echo true || echo false) }" "$t0" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$st"
done

# ── 3. knowledge graph ──
if [ "$KG" = 1 ] && [ -z "$DRY" ]; then
  t0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if run "kg" $D2T kg "$SNAP"; then st=ok; else st=failed; FAILS="$FAILS kg"; fi
  lineage_add "r${SNAP}-kg" kg null "scripts/d2t.ts kg $SNAP" "{}" "$t0" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$st"
fi

# ── 4. status + summary ──
SUMMARY="runs/$SNAP.summary.txt"
{
  echo "snapshot #$SNAP · ${DISEASE:-} · commit $COMMIT · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "ok:     ${OKS:-(none)}"
  echo "failed: ${FAILS:-(none)}"
  echo "skipped:${SKIPPED:-(none)}"
  echo "log:    $LOG"
  echo "lineage:$LINEAGE"
  echo
  [ -z "$DRY" ] && $D2T status "$SNAP" 2>&1
} | tee "$SUMMARY" | tee -a "$LOG"

if [ -n "$FAILS" ]; then
  log "finished with failures — re-run: bash deploy/rc-cloud-harvest/bin/enrich.sh $SNAP$FAILS"
else
  log "finished clean. Next: open the Ranking Board and /wiki for snapshot #$SNAP and check coverage; publish $LINEAGE as wiki/lineage/$SNAP.md (README §5)."
fi

# ── 5. notify (optional) ──
if grep -qE '^GITHUB_TOKEN=.+' .env && grep -qE '^NOTIFY_ISSUE=.+' .env; then
  bash "$HERE/notify.sh" "$SNAP" 2>&1 | tee -a "$LOG" || true
fi
[ -z "$FAILS" ]
