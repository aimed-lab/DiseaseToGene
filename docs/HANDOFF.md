# Disease2Target — Session Handoff / Context for Next Session

> Paste this into a new session to get up to speed. Last updated: 2026-06-22.

## 1. What this project is
**Disease2Target** — an AI-assisted therapeutic **target discovery & evidence-ranking** web app.
Enter a disease → pull associated genes from Open Targets → score with a multi-factor **GET**
score (G×0.50 + E×0.25 + T×0.25) → enrich each gene with clinical / literature / tissue /
druggability / mutation evidence → rank, assess, store, and prioritize.

- **Stack:** React 19 + TS + Vite + Tailwind v4 (almost all UI in one ~6k-line `index.tsx`).
  Express backend `server.ts`. External fetching in `api.ts`.
- **Working dir:** `N:\diseasetotarget_version2` · **Repo:** github.com/aimed-lab/DiseaseToGene
- **Dev:** `npm run dev` (= `tsx --env-file=.env server.ts`, port 3000). `tsx` does NOT auto-reload — **restart after any `server.ts`/`oracleService.ts` change.**
- **Verify before commit:** `npx tsc --noEmit` and `npm run build`. Commit/push only when asked.

## 2. The big architectural shift this work cycle
**Content storage moved from Supabase → Oracle.** Per the professor:
- **Supabase = auth/login + admin only** (user_profiles, app_config, invite code).
- **Oracle = ALL content** (rankings, scores, evidence, audit) — the lab's store of record.

### Data flow (content always goes browser → server → Oracle; browser never touches Oracle)
```
Browser (React)  →  server.ts endpoints  →  oracleService.ts (node-oracledb)  →  Oracle
                     (requireUser auth)      (lazy-loaded; APP user)             (4 tables)
```
- Oracle access is **lazy-loaded** in `server.ts` via `oracleSvc()` importing `./oracleService.ts`
  (non-literal import → keeps `oracledb` OUT of the serverless bundle). Gated by `USE_ORACLE_STORE=1`.
- **node-oracledb thin mode** — no Oracle client install needed.

## 3. Oracle (the lab's schema — 4 tables, snapshot-centric)
Owner schema `DISEASE2TARGET_OWNER`; app connects as `DISEASE2TARGET_APP` (RW role) via public synonyms.

| Table | Holds | Relationship |
|---|---|---|
| `TARGET_RANKING_SNAPSHOTS` | 1 row per saved/harvested ranking (disease, version, weights, provenance, targets blob) | parent |
| `RANKING_SCORES` | 1 row per gene per snapshot — GET sub-scores (genetic/expression/target/literature/tau/bimodality/pubtator) | child (snapshot_id) |
| `EVIDENCE` | 1 row per gene per source — `evidence_type` (clinical/literature/druggability/mutation/paper) + `source` + `value_text` + `value_json` + provenance (retrieved_at, generated_by, audit_status) | child (snapshot_id; paper rows have null) |
| `AUDIT_LOG` | append-only event trail (snapshot_saved/harvest_saved/evidence_saved) | independent |

- **IDs are Oracle identity columns** (numeric, auto). Inserts use `RETURNING id INTO`.
- **JSON columns have an `IS JSON` check** → never insert a bare scalar/`null` (use `{}`/`[]`).
  The `clob()` helper enforces this.

## 4. Features built this cycle (all additive)
- **Mutation axis (cBioPortal)** — `cbioportalService.ts` + `MutationPanel.tsx`. Gene→mutation→frequency (KRAS→G12D 41%, TCGA-sourced) on the gene focus view.
- **Paper → evidence** — PDF upload → Gemini extracts → stored as `EVIDENCE` (`evidence_type='paper'`) with source quote. `EvidenceCardsPanel.tsx` + evidence badge.
- **Harvest** — "Harvest to DB (N)" button: for all loaded genes, fetches clinical/literature/ChEMBL/mutation, writes one snapshot + ranking_scores + evidence + audit (transactional). Only stores evidence that has real data (no empty rows).
- **Quick load +200/+500/custom** — fast multi-page Open-Targets-only loading (scores only) to build a big universe for funnel/harvest. (Open Targets loads 50/page; `OT_PAGE_SIZE=50`.)
- **Rankings tab** (`RankingsView.tsx`) — reads Oracle; snapshot picker → **Dashboard** (scores table) + **Gene × Source matrix** (✓ only for real evidence; click a gene → inline stored-evidence detail, no live fetch).
- **Funnel tab** (`FunnelView.tsx`) — **DB-backed** funnel over a stored snapshot. Reads scores+evidence from Oracle, builds per-gene features, runs **hard filters that narrow top→bottom** (Genetic/Mutation/Expression/Druggability, sliders + "require present") + a **soft weighted-harmonic composite** of rank-normalized axes (missing = unknown, never zero). Shortlist with per-axis chips + completeness % + pin/drop + per-gene explainability. **Export CSV.** (Presets + "Save run" were intentionally removed for the demo; future axes hidden.)

## 5. Key files
- `index.tsx` — all UI; tabs: Targets/Funnel/Rankings/Literature/Papers/Enrichment/Cohorts. `handleHarvest`, `handleLoadMoreGenes`.
- `server.ts` — endpoints: `/api/oracle/health`, `/api/snapshots` (CRUD), `/api/snapshots/:id/scores`, `/api/snapshots/:id/evidence`, `/api/harvest`, `/api/evidence`. `requireUser` middleware sets `req.appUser`.
- `oracleService.ts` — Oracle DB layer: `saveSnapshot`, `saveHarvest`, `saveEvidenceCards`, `listSnapshots`, `getSnapshot`, `deleteSnapshot`, `listRankingScores`, `snapshotEvidence` (returns value_json), `evidenceGeneSymbols`, `evidenceForGene`, `ping`, `logAudit`.
- `supabase.ts` — auth + thin client helpers that call the server endpoints (snapshot/paper/evidence/harvest fns) and the snapshot-read fns (`fetchSnapshotScores`, `fetchSnapshotEvidence`).
- `MutationPanel.tsx`, `EvidenceCardsPanel.tsx`, `RankingsView.tsx`, `FunnelView.tsx` — feature components.
- `docs/oracle/*.cjs` — admin/diagnostic scripts: `create_tables`, `check_status`, `check_owner`, `describe_tables`, `check_id_strategy`, `verify_snapshots`, `test_write`, `migrate_to_oracle`.
- `docs/sql/oracle_schema.sql` — our Oracle DDL (NOTE: lab created their own 4 tables; we conformed to theirs).
- Plans/updates: `docs/PLAN_Target_Prioritization.md`, `docs/Update_Session.md`, `documentation/Disease2Target_Funnel_Build_Spec.docx`.

## 6. Env vars (`.env`, UTF-8 **without BOM** — a BOM silently breaks the first var)
```
GEMINI_API_KEY=...        GEMINI_MODEL=gemini-2.5-flash
SUPABASE_URL=...          SUPABASE_ANON_KEY=...   SUPABASE_SERVICE_ROLE_KEY=...
ORACLE_USER=DISEASE2TARGET_APP        ORACLE_PASSWORD=...           (app — runtime)
ORACLE_OWNER_USER=DISEASE2TARGET_OWNER  ORACLE_OWNER_PASSWORD=...   (owner — DDL/admin scripts)
ORACLE_CONNECT_STRING=sparc.informatics.uab.edu:1521/BIODB.INFORMATICS.UAB.EDU
ORACLE_SCHEMA=DISEASE2TARGET_OWNER
USE_ORACLE_STORE=1
```

## 7. To run / test (must be on UAB VPN — Oracle host is internal)
1. `npm run dev` (restart after server-side changes).
2. `curl http://localhost:3000/api/oracle/health` → `{ "ok": true, "db": "reachable" }`.
3. Search disease → **Quick load +500** → **Harvest** → check **Rankings** tab + `node --env-file=.env docs/oracle/verify_snapshots.cjs`.
4. **Funnel** tab → pick snapshot → drag thresholds → Export CSV.

## 8. Gotchas / things that bit us (so the next session doesn't repeat)
- **`.env` BOM** → `GEMINI_API_KEY not configured`. Fix: save `.env` as UTF-8 *without* BOM.
- **`tsx` no auto-reload** → restart `npm run dev` after `server.ts`/`oracleService.ts` edits.
- **VPN required** — `sparc.informatics.uab.edu` is UAB-internal; this dev machine reached it only on VPN. The agent's own environment **cannot** reach it.
- **Oracle JSON `IS JSON`** constraint rejects bare `null` — store `{}`/`[]`.
- **NOT NULL timestamps** (`created_at`, `event_time`) had no inserted value → all writes rolled back until fixed (now set via `SYSTIMESTAMP`).
- **Browser cannot connect to Oracle** — only the server can.
- **Production deployment** must run the backend **inside UAB's network** (Docker), not Vercel — Vercel can't reach the internal Oracle.

## 9. Current state
✅ Content store on Oracle, working end-to-end (harvest → snapshot+scores+evidence+audit).
✅ Rankings dashboard + Gene × Source matrix (reads Oracle).
✅ DB-backed Funnel (hard filters narrow + soft composite + CSV export).
✅ Mutation axis, paper evidence, evidence badge/panel.
✅ tsc + build pass.

## 10. Next steps (from the plan)
- **Real users** — get Fuad & Md Delower using it on pancreatic cancer (professor's top ask).
- **Target card** — assemble per-gene full-attribute card from the stored data (export for manuscripts).
- **New prioritization axes** (the funnel's reserved slots) once harvested: **safety (gnomAD pLI)**, **DepMap dependency**, tumor-vs-normal expression, variant→drug actionability.
- **Benchmarking** — does GET/funnel recover known targets (KRAS/SRC/EGFR)?
- **Funnel "Save run"** (was deferred) — persist a run (config + shortlist) as a reproducible snapshot.
- **Paper evidence in the matrix** (paper rows have snapshot_id=null; join by gene).
- **Pancreatic PoC complete**, then GBM, then Alzheimer's.
- **SDD wiki / SDDVK GitHub access** (non-code, pending).

## 11. Professor's direction (one line)
Content-centric, **traceable** engine on Oracle; replicate the **drug-discovery funnel** on the
target side (multi-objective, narrow to a short justified list); **target cards**; **real users**;
pancreatic cancer first. Scores by deterministic code, AI only reads/extracts (never invents numbers).
