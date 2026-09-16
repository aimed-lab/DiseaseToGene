#!/usr/bin/env bash
# deploy/rc-cloud-harvest/bin/00-preflight.sh — can this machine run a harvest?
# Run from anywhere; it finds the repo root from its own location. Read-only.
#   bash deploy/rc-cloud-harvest/bin/00-preflight.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

fails=0; warns=0
ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; warns=$((warns+1)); }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails+1)); }
have() { command -v "$1" >/dev/null 2>&1; }

echo "── tools ──────────────────────────────────────────────────────────────"
if have node; then
  v=$(node -v | sed 's/^v//'); major=${v%%.*}
  if [ "$major" -ge 20 ]; then ok "node $v"; else fail "node $v — need 20 or newer (bin/01-install.sh installs it)"; fi
else fail "node not found"; fi
have npx    && ok "npx"            || fail "npx not found"
have git    && ok "git $(git --version | awk '{print $3}')" || fail "git not found"
if have python3; then ok "python3 $(python3 -c 'import sys;print(sys.version.split()[0])' 2>/dev/null || echo '?')"; else fail "python3 not found (network axis needs the winner CLI)"; fi
[ -f "$ROOT/.venv/bin/activate" ] && source "$ROOT/.venv/bin/activate"
if have winner; then ok "winner CLI ($(winner --version 2>&1 | head -1))"; else warn "winner CLI not on PATH — the network axis will fail; bin/01-install.sh installs it into .venv"; fi
[ -d node_modules ] && ok "node_modules present" || fail "node_modules missing — run: npm ci"
[ -f node_modules/tsx/package.json ] && ok "tsx installed" || fail "tsx missing — run: npm ci"

echo "── repo ───────────────────────────────────────────────────────────────"
ok "commit $(git rev-parse --short HEAD 2>/dev/null || echo '?') on $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
if [ -n "$(git status --porcelain 2>/dev/null | grep -v '^?? ' )" ]; then warn "working tree has uncommitted changes — the lineage record will name a commit that does not match what ran"; else ok "working tree clean"; fi
df_free=$(df -Pk . | awk 'NR==2{print int($4/1024/1024)}')
if [ "${df_free:-0}" -ge 10 ]; then ok "${df_free} GB free"; elif [ "${df_free:-0}" -ge 3 ]; then warn "${df_free} GB free — enough to harvest, not enough to build a new cohort's reference tables"; else fail "${df_free} GB free — need at least 3 GB"; fi

echo "── .env ───────────────────────────────────────────────────────────────"
if [ -f .env ]; then
  ok ".env present ($(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env) permissions)"
  perm=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env)
  [ "$perm" = "600" ] || warn ".env should be chmod 600"
  for k in ORACLE_USER ORACLE_PASSWORD ORACLE_CONNECT_STRING; do
    if grep -qE "^${k}=.+" .env; then ok "$k set"; else fail "$k missing or empty in .env"; fi
  done
  grep -qE '^GITHUB_TOKEN=.+' .env && grep -qE '^NOTIFY_ISSUE=.+' .env && ok "notifications configured" || warn "notifications not configured (optional: GITHUB_TOKEN + NOTIFY_ISSUE)"
else
  fail ".env missing — cp deploy/rc-cloud-harvest/env.example .env, then fill it in"
fi

echo "── reference tables (committed) ───────────────────────────────────────"
for f in data/disease_registry.json data/gnomad_constraint.json data/tissue_specificity.json data/expression_paad.json data/expression_gbm.json data/depmap_pancreatic.json data/depmap_gbm.json data/proteomics_pdac.json data/proteomics_gbm.json data/proteomics_ad.json; do
  [ -s "$f" ] && ok "$f ($(du -h "$f" | cut -f1))" || fail "$f missing — git checkout is incomplete"
done

echo "── STRING files (network axis) ────────────────────────────────────────"
sd="${STRING_DIR:-WINNER/data}"
for f in 9606.protein.links.v12.0.txt.gz 9606.protein.info.v12.0.txt.gz 9606.protein.aliases.v12.0.txt.gz; do
  [ -s "$sd/$f" ] && ok "$sd/$f" || warn "$sd/$f missing — bin/01-install.sh downloads it; without it the network axis fails"
done

echo "── outbound HTTPS ─────────────────────────────────────────────────────"
probe() { # host path expected-substring-or-empty
  local code
  code=$(curl -sS -o /dev/null -m 15 -w '%{http_code}' "https://$1$2" 2>/dev/null || echo 000)
  # any HTTP answer means the host is reachable (Open Targets returns 400 to a GET); 000 = no connection
  case "$code" in 2*|3*|400|401|403|405) ok "$1 ($code)";; 000) fail "$1 — no connection (DNS, firewall, or no outbound HTTPS)";; *) warn "$1 answered $code";; esac
}
probe api.platform.opentargets.org /api/v4/graphql
probe www.cbioportal.org /api/health
probe www.ebi.ac.uk /europepmc/webservices/rest/search?query=KRAS\&format=json\&pageSize=1
probe eutils.ncbi.nlm.nih.gov /entrez/eutils/einfo.fcgi
probe github.com /
probe stringdb-downloads.org /

echo "── Oracle ─────────────────────────────────────────────────────────────"
if [ -f .env ] && have npx; then
  if npx tsx --env-file=.env "$HERE/check-oracle.ts"; then :; else fail "Oracle check failed (see above)"; fi
else
  fail "skipped — needs .env and npx"
fi

echo "──────────────────────────────────────────────────────────────────────"
if [ "$fails" -gt 0 ]; then
  echo "$fails FAIL, $warns WARN — fix the FAILs before harvesting."; exit 1
elif [ "$warns" -gt 0 ]; then
  echo "0 FAIL, $warns WARN — a harvest can run; read the WARN lines."; exit 0
else
  echo "all clear. Next: npx tsx --env-file=.env scripts/d2t.ts enrich <id> mutation --dry"; exit 0
fi
