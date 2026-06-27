# Disease2Target — Project Brief (handoff / onboarding)

> Paste this into a new session to get up to speed fast.

## What the app is

**Disease2Target (a.k.a. DiseaseToTarget / "GET app")** — an AI-assisted **therapeutic-target discovery and evidence-ranking** web app. You enter a disease; it pulls disease-associated genes from Open Targets, scores them with a multi-factor **GET** score, enriches each gene with literature / clinical-trial / tissue / druggability evidence, and lets you rank, assess, compare, export, and store the results.

- **Repo:** github.com/aimed-lab/DiseaseToGene (the git remote still prints the old name `GetDiseaseTarget` and redirects — same repo)
- **Live:** disease-to-gene.vercel.app (Vercel)
- **Working dir:** `N:\diseasetotarget_version2`

## Tech stack & architecture

- **Frontend:** React 19 + TypeScript, Vite, Tailwind v4. Almost everything is in one big file: **`index.tsx`** (~6k lines).
- **Backend:** **`server.ts`** — Express. Proxies external APIs (CORS/rate-limit), AI calls, admin, auth-register, API cache.
- **API client:** **`api.ts`** — all external data fetching (Open Targets, ChEMBL, PubMed, etc.).
- **ChEMBL:** **`chemblService.ts`** + **`DruggabilityPanel.tsx`**.
- **Types:** **`types.ts`**. **Auth/DB helpers:** **`supabase.ts`**.
- **Build:** `npm run build` = `vite build` (→ `dist/`) + esbuild bundles `server.ts` → `dist-server/server.cjs`.
- **Deploy paths:** Vercel (`vercel.json` + `api/index.ts` wraps the Express app as a serverless fn) **and** Docker (`Dockerfile`, `docker-compose.yml`). Server-side throttling can't coordinate across Vercel instances → NCBI calls are throttled **client-side** in `api.ts`.

## Data sources & key metrics (all from named public APIs — nothing fabricated)

- **GET score = G×0.50 + E×0.25 + T×0.25** (computed in `api.ts` `getGenes`)
  - **G** genetic = max(genetic_association, somatic_mutation, genetic_literature) — Open Targets
  - **E** expression = strength×0.7 + selectivity×0.3 — Open Targets RNA
  - **T** target = tractability tier (Approved Drug 1.0 → 0.1) — Open Targets
- **Literature:** PubMed (E-utilities, `GENE[Gene Name] AND disease`, `[pdat]` recent) + Europe PMC (full-text hitCount) + PubTator velocity
- **Clinical:** ClinicalTrials.gov v2 (trial_count, max_phase, active)
- **Tissue:** Human Protein Atlas TAU (bulk + single-cell) + bimodality (precomputed)
- **Druggability (ChEMBL):** label from `/mechanism` target max phase — **Clinically Validated** (Ph4) / **In Clinical Development** (Ph1–3) / **Preclinical Only** (compounds, no trials) / **No Drug Data Found**; best IC50 from `/activity`; modalities **predicted** from GO cellular location (not confirmed)
- AI (Gemini via `/api/ai/*`, server-side only) is used **only for narrative summaries**, never to invent numbers.

## Features built this cycle

- **Target Assessment ("Assess") tab** — per-gene evidence cards (GET, tissue, clinical, literature, ChEMBL) + AI trade-off + DOCX report.
- **ChEMBL druggability** integrated into Assess cards, the gene drill-down panel, and CSV export.
- **Exports:** Combined CSV, **All-Metrics CSV** (user picks 50–500 genes, batched + progress), DOCX, Obsidian wiki.
- **Content storage (Supabase):** **Save Snapshot** + **Ranking History** — versioned, provenance-tagged ranking snapshots per disease (Export dropdown). *(Requires running `docs/sql/target_ranking_snapshots.sql` in Supabase once.)*
- **Traceability:** inline `(i)` info dots on every metric + a 17-section in-app **Documentation** page (profile menu → Documentation).
- **Auth:** Supabase auth; **invite-code-gated registration** (server-validated, auto-confirmed); admin panel to view/rotate the invite code; user management.
- **Feedback** button → GitHub issues.

## Env vars (set in `.env` locally, Vercel dashboard for prod)

`GEMINI_API_KEY` (key format `AQ.Ab8…` is valid), `GEMINI_MODEL=gemini-2.5-flash`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SIGNUP_INVITE_CODE`, optional `NCBI_API_KEY` / `NOTION_*`.
⚠️ Keep `.env` as **UTF-8 without BOM** — a BOM silently breaks the first var (`GEMINI_API_KEY not configured`).

## Professor's direction (drives the roadmap)

Make it a **content-centric, traceable scientific engine**, not just a UI. Priorities: (1) **traceability** on every block, (2) **store** high-value content (Oracle later, Supabase now), (3) **daily updates**, (4) disease focus **Pancreatic cancer → GBM → Alzheimer's** with **mutation-level** depth for cancer (KRAS, SRC via cBioPortal — not yet built), (5) **benchmark** GET against known targets, (6) push **all attributes** to **Spinner/GeneTerrain** (needs their schema), (7) real **documentation/working directory**.
Plan docs: `docs/Content_Centric_Plan.md`, deck `docs/Disease2Target_Content_Centric_Plan.pptx`.

## Known gaps / next up

- Snapshots store ranking-table values + literature/clinical (only for drilled-in genes); **ChEMBL not yet in snapshots**.
- **cBioPortal mutation axis** (KRAS/SRC) not built.
- **Benchmarking view** not built.
- **Spinner/GeneTerrain export** blocked on their input schema.
- Run the snapshots SQL in Supabase before Save Snapshot works.

## Conventions

- Don't change scoring/ranking logic unless asked. Keep changes additive.
- Verify with `npx tsc --noEmit` and `npm run build` before committing.
- Commit + push to `main` only when asked; commits co-authored by Claude.
