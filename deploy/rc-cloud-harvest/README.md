# Running the Disease2Target harvest on the RC cloud

This folder is everything needed to run the evidence harvest (`scripts/d2t.ts`) on an
always-on Linux VM instead of a laptop on VPN. Nothing in the pipeline changes — the same
script writes the same rows to the same Oracle store — it just runs on a machine that is
already on the campus network, does not sleep, and keeps a log.

```
deploy/rc-cloud-harvest/
├── README.md              this runbook
├── AXES.md                what each of the 12 evidence axes needs (data, network, time)
├── env.example            the variables the VM needs — names only, never values
├── bin/
│   ├── 00-preflight.sh    can this machine run a harvest? (node, python, winner, .env, files, network, Oracle)
│   ├── 01-install.sh      one-time setup on a fresh Ubuntu/Rocky VM
│   ├── check-oracle.ts    connects to Oracle and lists snapshots — the real connectivity test
│   ├── harvest.sh         the whole pipeline: harvest → enrich (12 axes) → kg → status, logged
│   ├── enrich.sh          re-run one or more axes on an existing snapshot
│   ├── status.sh          per-axis coverage of a snapshot
│   └── notify.sh          post a run summary to a GitHub issue (optional)
└── systemd/
    ├── d2t-harvest@.service   run one harvest as a service:  systemctl start 'd2t-harvest@pancreatic adenocarcinoma'
    ├── d2t-queue.service      the queue worker — harvests queued from the app's Settings → Harvest (§4b)
    └── d2t-harvest.timer      example monthly schedule — DISABLED by default; on demand is the recommended mode
```

## 0. What a run does

```
harvest "<disease>" <geneCount>   → new snapshot in Oracle (candidate genes from Open Targets)
enrich <id> <axis>  × 12          → one axis at a time, cheap/local first, each idempotent
kg <id>                           → project EVIDENCE into the knowledge graph (KG_NODES / KG_EDGES)
status <id>                       → per-axis gene coverage
```

`harvest.sh` runs exactly that, records every step (script, git commit, parameters, start
and end time) into `runs/<id>.lineage.yaml`, then **audits the snapshot against the sources**
(`scripts/auditSnapshot.ts`: every row checked for consistency, a random sample of genes
re-derived from Open Targets, cBioPortal, gnomAD and Europe PMC with the script's own queries;
result in `runs/<id>.audit.txt`). It never stops the whole run because one axis failed — a
failed axis or a failed audit is listed in the summary and can be re-run with `enrich.sh`.

**Every harvest creates a new snapshot.** The app shows the newest snapshot per disease, so a
finished run becomes what users see. Run `--dry` first on a new machine; and read §6 before
scheduling anything unattended.

## 1. Prerequisites on the VM

| need | why | check |
|---|---|---|
| Ubuntu 22.04 / Rocky 9 or similar, 2 vCPU, 8 GB RAM, **20 GB disk** | the reference tables are ~200 MB; raw downloads for a *new* disease are up to 2.5 GB | `df -h` |
| Node **20 or newer** | the pipeline is TypeScript run with `tsx` | `node -v` |
| Python 3.10+ and `pip` | the `winner` CLI (network axis) is the lab's Python package | `python3 --version` |
| git | clone the repo; the run log records the commit | `git --version` |
| outbound HTTPS to the sources | see AXES.md for the host list | preflight checks each |
| **route to Oracle** (host + port from `ORACLE_CONNECT_STRING`) | the whole point of the VM | `bin/check-oracle.ts` |
| Oracle credentials with write access to the D2T schema | the harvest writes rows | in `.env`, never in git |

The Node driver `oracledb` v7 runs in **thin mode** — no Oracle Instant Client to install.

## 2. One-time install

```bash
# on the VM, as the user that will run harvests (not root)
git clone https://github.com/aimed-lab/DiseaseToGene.git d2t
cd d2t
bash deploy/rc-cloud-harvest/bin/01-install.sh
```

The install script: installs Node via nvm if missing, `npm ci`, creates a Python venv and
installs `winner` from the lab's GitHub, downloads the three STRING v12.0 files for the
network axis (~100 MB, into `WINNER/data/`), creates `logs/` and `runs/`, and prints the
systemd install lines. It is safe to re-run.

Then create `.env` from `env.example` and fill in the Oracle values (ask the owner — do not
paste them into chat, tickets or commits):

```bash
cp deploy/rc-cloud-harvest/env.example .env
chmod 600 .env
nano .env
```

## 3. Preflight — run this before the first harvest, and after any change

```bash
bash deploy/rc-cloud-harvest/bin/00-preflight.sh
```

It checks, in order: tool versions · `.env` has the required names · the committed reference
tables exist · STRING files exist · `winner --version` answers · each external host answers
over HTTPS · **Oracle connects and lists snapshots** (`check-oracle.ts`). Every line is
`OK` / `WARN` / `FAIL`; a `FAIL` on Oracle or on Open Targets means do not proceed.

A dry run of one cheap axis is the last check — it fetches but does not write:

```bash
npx tsx --env-file=.env scripts/d2t.ts enrich <existing snapshot id> mutation --dry
```

Use an existing snapshot id from the preflight's list (e.g. 102).

## 4. Running a harvest

**On demand (recommended):**

```bash
# full pipeline for one disease; 7500 = candidate genes requested from Open Targets
bash deploy/rc-cloud-harvest/bin/harvest.sh "pancreatic adenocarcinoma" 7500

# same, but detached from your terminal and logged (survives logout)
nohup bash deploy/rc-cloud-harvest/bin/harvest.sh "glioblastoma" 6000 > /dev/null 2>&1 &
tail -f logs/latest.log

# or through systemd (also survives logout; journal + logs/)
sudo systemctl start 'd2t-harvest@pancreatic adenocarcinoma'
journalctl -u 'd2t-harvest@pancreatic adenocarcinoma' -f
```

Options for `harvest.sh`:

| option | meaning |
|---|---|
| `--axes expression,dependency,…` | only these axes (default: all 12, in the order in AXES.md) |
| `--skip network` | skip an axis (repeatable) |
| `--no-kg` | do not build the knowledge graph at the end |
| `--dry` | fetch everything, write nothing (the harvest step still needs Oracle to *read*) |
| `--snapshot <id>` | skip the harvest step and enrich an existing snapshot |

### 4b. From the browser — the queue worker

An admin can queue a harvest from the app (**Settings → Harvest**: disease, candidate genes,
*Queue harvest*). The request is a row in Supabase (`docs/sql/harvest_jobs.sql`, run once in
the Supabase SQL editor). On the VM, the **queue worker** polls that table over outbound HTTPS,
runs `harvest.sh` for each job exactly as above, and writes progress, the log tail, the
summary, the snapshot id and the audit verdict back to the row — the panel shows all of it
and whether a worker is listening. One job at a time; a job for a disease that already has
one queued or running is refused; only a queued job can be cancelled.

```bash
# .env needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see env.example)
npx tsx --env-file=.env scripts/harvestQueue.ts --once      # try it: takes one job if any, then exits

# keep it running — with sudo:
sed -e "s|@ROOT@|$PWD|g" -e "s|@USER@|$USER|g" deploy/rc-cloud-harvest/systemd/d2t-queue.service | sudo tee /etc/systemd/system/d2t-queue.service >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now d2t-queue
journalctl -u d2t-queue -f

# without sudo:
nohup setsid npx tsx --env-file=.env scripts/harvestQueue.ts > logs/queue-worker.out 2>&1 &
```

The panel's job options can also carry `snapshot: <id>` (re-run axes on an existing
snapshot, like `enrich.sh`) — not in the form yet, but the worker honours it.

**Re-run one axis** (after a source outage, or to refresh):

```bash
bash deploy/rc-cloud-harvest/bin/enrich.sh 124 clinical literature
bash deploy/rc-cloud-harvest/bin/status.sh 124
```

**How long it takes.** Open Targets harvest 2–5 min. Local axes (expression, proteomics,
dependency, safety, tissue) seconds to a minute each. API axes per gene: annotation,
druggability, clinical, patents, literature — 20–60 min each for ~6,000 genes, rate-limited
by the sources, not by the VM. Mutation 1–2 min (one cohort call). Network 5–15 min. A full
run is **2–4 hours**; it is fine to walk away.

## 5. What a run leaves behind

| where | what |
|---|---|
| Oracle | the snapshot, its scores, its evidence rows, its graph — what the app and the wiki read |
| `logs/<date>_<disease>.log` (+ `logs/latest.log`) | everything the pipeline printed, timestamped |
| `runs/<id>.lineage.yaml` | one entry per step: script, git commit, parameters, source versions where known, started/finished, exit status |
| `runs/<id>.summary.txt` | the per-axis OK/FAIL table, the audit verdict and the final `status` output |
| `runs/<id>.audit.txt` | every audit check, PASS / WARN / FAIL — `--raw` adds DepMap and GTEx recomputed from the raw files |

**Lineage is recorded by the harvest itself** (since 16 Sep 2026): every `harvest`, `enrich`
and `kg` step appends an entry to `snapshot.provenance.runs[]` in Oracle — script, git commit
of the checkout, source and version, the formula, start and finish — and the wiki shows the
snapshot's lineage green, *recorded*, with no file to copy. `runs/<id>.lineage.yaml` is still
written as a belt-and-braces copy; for a snapshot harvested before this (or if a run's write
to `provenance.runs[]` failed — the log says so), load the file into the store:

```bash
npx tsx --env-file=.env scripts/d2t.ts lineage <id> runs/<id>.lineage.yaml     # or wiki/lineage/<id>.md
```

A re-run of an axis appends a new entry; the wiki shows the latest run per axis.

## 6. Before running unattended

1. **Decide who checks the result.** A finished harvest becomes the newest snapshot for that
   disease, which the app selects by default. Someone opens the Ranking Board and the wiki
   overview for the new snapshot the same day and looks at per-axis coverage (`status.sh`).
2. **Keep it on demand until the first three runs were clean.** The timer file is provided
   and disabled; the sources change monthly at most, and a scheduled harvest nobody asked
   for is a snapshot nobody checks.
3. **Notify.** `bin/notify.sh <id>` posts the summary to a GitHub issue (needs `GITHUB_TOKEN`
   with issue-write scope on the repo and `NOTIFY_ISSUE`); `harvest.sh` calls it at the end
   when both are set.
4. **One run at a time.** The service unit uses a lock; do not start two harvests in
   parallel — the sources rate-limit per IP and the second run only slows the first.

## 7. Known gaps this kit does not close (code changes, tracked separately)

- **`source_url` is empty on every evidence row.** The fetchers know the URL they read; the
  harvest should store it, and the wiki's live-link template becomes a fallback.
- **Charset at ingestion.** Paper titles arrive with `¿` for an en dash and `ß` for `β`;
  fix the character set on the ORDS write path, not at render.
- **A `published` flag on snapshots**, so a fresh harvest is reviewed before the app's
  "newest snapshot per disease" rule makes it the default. One column; not written yet.

## 8. Security notes

- `.env` holds Oracle write credentials. `chmod 600`, owned by the run user, never committed
  (`.gitignore` already excludes it), never pasted anywhere.
- The VM needs **outbound** HTTPS and a route to Oracle only. It serves nothing; keep no
  inbound ports open.
- The GitHub token for `notify.sh` needs only `issues: write`. Use a bot account if the lab
  has one, so notifications are not attributed to a person.
- The pipeline never deletes: `enrich` replaces one axis of one snapshot, idempotently; the
  only destructive scripts in the repo are named `wipe_*` and are not called from here.

## 9. Troubleshooting

| symptom | likely cause | do |
|---|---|---|
| `check-oracle.ts` times out | no route from the VM to the Oracle host/port | ask RC for the security-group rule; confirm with `nc -zv <host> <port>` |
| `ORA-01017` | wrong user/password | fix `.env`; the user must own the D2T schema or have write grants |
| `winner: command not found` | venv not on PATH for this shell | `source .venv/bin/activate` (the scripts do this themselves) |
| `expression: … not built yet` | new disease with no reference table | build it — AXES.md, "adding a disease" |
| `429` / `5xx` in an API axis | source rate-limiting or outage | wait, then `enrich.sh <id> <axis>`; the axis is idempotent |
| network axis: `no candidate_cutoff in provenance` | snapshot harvested by an old script | `npx tsx --env-file=.env scripts/d2t.ts provenance <id> --cutoff <N>` |
| run finished but the app shows the old snapshot | the app caches snapshot lists per session | reload the app; the wiki index lists every snapshot |
