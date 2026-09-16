#!/usr/bin/env bash
# deploy/rc-cloud-harvest/bin/01-install.sh — one-time setup on a fresh Linux VM.
# Run as the user that will run harvests (not root; it uses sudo only for apt/dnf).
# Safe to re-run: every step checks before it acts.
#   git clone https://github.com/aimed-lab/DiseaseToGene.git d2t && cd d2t
#   bash deploy/rc-cloud-harvest/bin/01-install.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"
say() { printf '\n▶ %s\n' "$*"; }

say "system packages (curl, git, python3, venv, build tools)"
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq curl git python3 python3-venv python3-pip build-essential ca-certificates
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y -q curl git python3 python3-pip gcc gcc-c++ make ca-certificates
else
  echo "no apt-get or dnf — install curl, git, python3 (with venv/pip) and a C compiler by hand"; fi

say "Node 20+ (via nvm, per user — no root, no distro package)"
need_node=1
if command -v node >/dev/null 2>&1; then v=$(node -v | sed 's/^v//'); [ "${v%%.*}" -ge 20 ] && need_node=0; fi
if [ "$need_node" = 1 ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 22 >/dev/null
  nvm alias default 22 >/dev/null
fi
echo "node $(node -v), npm $(npm -v)"

say "npm ci (exact lockfile versions)"
npm ci --no-audit --no-fund

say "Python venv + the winner CLI (network axis)"
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q --upgrade pip
if ! command -v winner >/dev/null 2>&1; then
  pip install -q "git+https://github.com/aimed-lab/WINNER.git@v0.1.1-py#subdirectory=python"
fi
echo "winner: $(winner --version 2>&1 | head -1)"

say "STRING v12.0 files for the network axis (~100 MB, once)"
sd="${STRING_DIR:-WINNER/data}"; mkdir -p "$sd"
dl() { [ -s "$sd/$1" ] && echo "have $1" || curl -fL --retry 3 -o "$sd/$1" "https://stringdb-downloads.org/download/$2/$1"; }
dl 9606.protein.info.v12.0.txt.gz    protein.info.v12.0
dl 9606.protein.links.v12.0.txt.gz   protein.links.v12.0
dl 9606.protein.aliases.v12.0.txt.gz protein.aliases.v12.0

say "folders"
mkdir -p logs runs
chmod +x "$HERE"/*.sh

say ".env"
if [ -f .env ]; then echo ".env exists — not touched"; else
  cp deploy/rc-cloud-harvest/env.example .env; chmod 600 .env
  echo "created .env from env.example — fill in the Oracle values:  nano .env"
fi

say "systemd (optional — lets a harvest survive logout and be started with systemctl)"
cat <<EOF
To install the service unit for this checkout and this user:

  sed -e "s|@ROOT@|$ROOT|g" -e "s|@USER@|$USER|g" deploy/rc-cloud-harvest/systemd/d2t-harvest@.service | sudo tee /etc/systemd/system/d2t-harvest@.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl start 'd2t-harvest@pancreatic adenocarcinoma'      # one run, detached
  journalctl -u 'd2t-harvest@pancreatic adenocarcinoma' -f

The timer (deploy/rc-cloud-harvest/systemd/d2t-harvest.timer) is an example of a monthly
schedule and is deliberately not installed here. On demand is the recommended mode.
EOF

say "done. Next:  bash deploy/rc-cloud-harvest/bin/00-preflight.sh"
