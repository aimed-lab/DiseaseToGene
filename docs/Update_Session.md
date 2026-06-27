# Disease2Target — Progress Update

## Plan
- Move the content store from Supabase to **Oracle** (lab structure); keep Supabase for auth/login only.
- Make the harvested content (rankings + evidence) **stored, traceable, and reusable** for papers/manuscripts.
- Add a **Target Funnel** to narrow the gene universe to a short target list.
- Add a way to **read the stored Oracle data back** as a ranking dashboard + Gene × Source matrix.
- Keep all of this **additive** — don't change existing scoring/ranking logic.

## Learn
- Oracle ≠ a drop-in for Supabase: it's only a database (no built-in auth/REST), so all content access must go **browser → server → Oracle**; auth stays on Supabase.
- The lab's Oracle schema is **normalized and snapshot-centric** (snapshot → ranking_scores + evidence + audit) — better aligned with "separate GET by source" than our old wide JSON tables.
- Evidence stored as **rows tagged by source** (clinical/literature/ChEMBL/mutation/paper) makes the data extensible and manuscript-ready (each fact carries source + date + audit status).
- Several silent failures came from small things: a UTF-8 BOM breaking the API key, a 2 MB body limit vs a 25 MB route, an `IS JSON` constraint rejecting a `null`, and `NOT NULL` timestamp columns — all now understood and fixed.

## Execute / Completed
1. **Oracle migration** — content store moved to Oracle; Supabase reduced to auth/login only.
2. **Storage model** wired to the lab's 4 tables: `TARGET_RANKING_SNAPSHOTS`, `RANKING_SCORES`, `EVIDENCE`, `AUDIT_LOG` (server-side `oracleService` + endpoints; lazy-loaded).
3. **Harvest → Oracle** — one harvest stores a snapshot + per-gene scores + per-source evidence + an audit entry, transactionally.
4. **Paper upload → Oracle** — extracted paper facts stored as `evidence` rows with source quote + provenance.
5. **Target Funnel tab** — multi-stage filters (Genetic/Expression/Druggability/Literature/Tissue) narrow the loaded genes to a ranked short list.
6. **Rankings tab (reads Oracle)** — snapshot picker → **ranking dashboard** + **Gene × Source matrix** (the source-separation view).
7. **Quick load +200 / +500** — fast Open-Targets-only loading to build a larger gene universe for the funnel/harvest.
8. **Mutation axis (cBioPortal)** — gene → mutation → frequency on the gene card (KRAS → G12D 41%, sourced to TCGA).
9. **Fixes** — PDF upload (body limit + auth), `.env` BOM, Oracle JSON/timestamp/bimodality bugs, human-readable evidence summaries.
10. **Docs** — demo + roadmap deck, target-prioritization plan, meeting updates.

## Assessment
- Verified the server **connects to Oracle** (`/api/oracle/health` → reachable).
- Verified **harvest writes** end-to-end: snapshot + ranking_scores + evidence + `harvest_saved` audit (confirmed via `verify_snapshots` + SQL Developer).
- Isolated and fixed the write failures with a **direct write test** (`test_write.cjs`) that surfaced the exact Oracle errors.
- Confirmed **evidence is stored per source** (clinical/literature/ChEMBL/mutation) in the `EVIDENCE` table, with readable summaries + full JSON for reuse.
- Confirmed the new **Funnel** and **Rankings** tabs build cleanly (type-check + production build pass) and are fully additive (no existing logic changed).
