# Disease2Target — Plan: Content Store + Target-Prioritization Funnel

**Owner:** Nikhil Kurmachalam · **Updated:** June 2026
**North star:** Turn Disease2Target into a multi-objective **target-discovery funnel** that lab
members actually use — narrowing a disease's gene universe to a short, justified target
list, each backed by a traceable **target card** in Oracle — proven first on **pancreatic cancer**.

---

## 0. Who the users are (the professor's question)
- **Primary:** lab members **Fuad** and **Md Delower** — must be able to log in, search a
  disease, see ranked targets + target cards, and export. Get them using it *before* new features.
- **Secondary:** the lab/professor for review; later, Smart Drug Discovery account holders.
- **Benefit:** instead of manually gathering evidence per gene, they get a stored, sourced,
  ranked short-list of druggable targets per disease, with the reasoning behind each.

---

## 1. Where we are (DONE)
- ✅ **Content-centric storage** (the shift the professor praised).
- ✅ **Oracle migration of content** — Supabase = auth/admin only; Oracle = all content:
  - `TARGET_RANKING_SNAPSHOTS` (snapshot header), `RANKING_SCORES` (per-gene GET scores),
    `EVIDENCE` (per-source evidence + provenance), `AUDIT_LOG` (append-only).
  - Save Snapshot, Harvest, Paper upload all write Oracle via `/api/snapshots`, `/api/harvest`,
    `/api/evidence` (server-side `oracleService.ts`, lazy-loaded, gated by `USE_ORACLE_STORE=1`).
- ✅ **Mutation axis** (cBioPortal: gene→mutation→frequency) and **paper-derived evidence**.
- ✅ Evidence highlight badge + Stored Evidence panel now read from Oracle.

---

## 2. Pending — finish to be review-ready (small)
1. **Verify Oracle end-to-end** (post `CHK_TRS_TARGETS` fix): re-harvest → confirm
   `verify_snapshots.cjs` shows snapshot + ranking_scores + evidence + `harvest_saved` audit.
2. **Verify read-backs:** paper upload → `EVIDENCE`; EVIDENCE badge + Stored Evidence panel
   populate from Oracle.
3. **Remove leftover Supabase content code** + obsolete Supabase SQL/migration scripts.
4. **Deployment note:** dev-on-VPN is fine for the demo; production backend must run inside
   UAB's network (Docker) to reach Oracle — Vercel can't. (Handle later.)
5. **Non-code:** Teams-message professor for **SDDVK GitHub access**; line up **Fuad/Delower**
   as first users.

---

## 3. The funnel (the professor's #1 scientific direction)
Replicate the **drug-discovery funnel** on the **target side**:
```
disease gene universe → genetic filter → expression/specificity → druggability
   → mutation-actionability → safety → network → composite score → SHORT TARGET LIST
```
- **Objectives = scoring-matrix rows** (each: metric · direction · weight · optional threshold).
- **Hard filters** = funnel stages that *narrow* (show wide→narrow counts).
- **Weighted composite** = ranks survivors → short list.
- **Criteria** come from the user / inferred **cohort profile** (e.g. "metastatic PDAC,
  KRAS-mutant" preset emphasizes mutation-actionability + druggability + clinical stage).
- **Output unit** = the **target card** (all attributes + provenance, already in Oracle).
- **Network centrality = one factor among many** (don't over-rely).

Reuses what exists: GET **weights panel** → scoring matrix; **filter/sort** system → funnel
stages; **stored attributes** in Oracle → the data; **RWR/WINNER** → centrality factor.

---

## 4. Target-prioritization gaps to close (what's missing)
Current engine is strong on *evidence breadth*, thin on *defensibility*. Add:
1. **Safety / tolerability axis** — gnomAD genetic constraint (pLI) + HPA normal-tissue
   expression breadth. *Reasons NOT to pursue a target.* Cheap, high value.
2. **Functional dependency** — **DepMap** CRISPR essentiality (does the tumor need the gene).
3. **Mutation → drug actionability** — link variant → approved/trial drug (e.g. G12D→daraxonrasib).
4. **Disease-vs-normal differential expression** — GEO/TCGA tumor-vs-normal (not just baseline/TAU).
5. **Benchmarking** — does the ranking recover known targets (KRAS/SRC/EGFR)? Validation.

---

## 5. What is NOT necessary (avoid scope creep)
- Black-box ML / foundation-model scoring (professor wants a **transparent** matrix).
- 3D structural pocket detection / AlphaFold druggability (heavy, defer).
- IP / commercial landscape (out of scope).
- Perfecting many diseases (stay on **pancreatic** until complete).
- Over-investing in network algorithms (centrality is one factor).

---

## 6. Roadmap (prioritized)
**Phase A — Lock the foundation (this week, for review)**
- Finish §2 (verify Oracle, cleanup). Get Fuad/Delower able to log in + run pancreatic.

**Phase B — Make it prioritize (the marquee work)**
1. **Target card view** — assemble all stored attributes per gene into one card (visible/exportable).
2. **Scoring matrix** — explicit, weighted, transparent rubric (extend weights panel) + documentation.
3. **Funnel v1** — criteria (thresholds + weights) → staged filter w/ narrowing counts → short
   ranked list + target cards.

**Phase C — Make it defensible**
4. **Safety axis** (gnomAD pLI + HPA normal-tissue).
5. **DepMap dependency axis**.
6. **Mutation→drug actionability**.
7. **Benchmark** (KRAS/SRC recovery) → pancreatic PoC complete.

**Phase D — Expand**
8. Cohort-profile presets + iterative rounds.
9. GBM, then Alzheimer's.

---

## 7. Professor feedback → mapped
- Content-centric / Oracle → §1 (done), §2 (finishing).
- Funnel / multi-objective → §3, Phase B/C.
- Scoring matrix → §3, Phase B.2.
- Target card → §3, Phase B.1.
- Pre-calc attributes (one of many) → harvest done; balance with safety/dependency (§4).
- Real users (Fuad/Delower) first → §0, Phase A. **Highest priority per professor.**
- Pancreatic first → Phase C.7 completes PoC.
- Planning + who-are-users → this doc; §0.
- SDDVK GitHub access + SDD wiki → next week (non-code).

---

## 8. Recommended next step
Lock Oracle (Phase A) → build **Target Card** (Phase B.1, the visible artifact + funnel input)
→ **Funnel v1** (B.3). Add **Safety axis** (C.4) as the cheapest high-impact credibility win.
Real users (Fuad/Delower) on pancreatic is the success metric for the next review.
