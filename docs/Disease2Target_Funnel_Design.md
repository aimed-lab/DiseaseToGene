# Disease2Target — Target-Prioritization Funnel: Design Document

> Design specification for the multi-tier target-discovery funnel.
> Author: Nikhil Kurmachalam · Demonstration disease: Pancreatic adenocarcinoma
> Status: **design for review** (precedes implementation). Reflects professor's feedback of this cycle.

---

## 1. Purpose

Disease2Target narrows a disease's entire gene universe down to a **short, justified list of
nominated drug targets**. It does this not in one scoring step but as an **ordered, cost-aware funnel**:
cheap evidence first, expensive analysis last, with explicit criteria at every transition and the
ability to improve candidates over repeated rounds.

This document is the **design that precedes implementation**. It specifies the funnel's philosophy, its
tiers (ordered by computational cost), the data architecture that backs it, and the validation story.
A working prototype already exists for several tiers (see §8); this document is the blueprint the
prototype is measured against and grown from.

---

## 2. Design principles

1. **Order by cost, not by intuition.** A step that is *only an API call + a search* is **Tier 1**.
   Computationally expensive steps (differential expression, network propagation, simulation) belong in
   **later** tiers. Steps of *similar* cost are grouped into the same cost band.
2. **Tiers are silos; transitions are sifts.** Each tier is a **silo that accumulates candidates from
   many sources** (literature, patents, clinical-trial databases, structured DBs). The **transition
   between two tiers is a sift** — an explicit, scorable criterion a candidate must meet to advance.
   So every tier *expands* (gather) and then *sifts* (narrow).
3. **Reasons to pursue AND reasons not to.** Most pipelines only accumulate positive evidence.
   Defensibility comes from explicitly modelling the negatives — safety/constraint, undruggable
   mechanism, tumor-suppressor intractability.
4. **Iterative enrichment over rounds.** A candidate that does not reach the final tier in round 1 may
   reach it in a later round as new evidence is gathered. Candidates carry **lineage** so promotion and
   provenance are traceable.
5. **Deterministic code scores; AI only reads.** Every number is produced by deterministic code from a
   named source. AI extracts and summarizes; it never invents scores. Everything is stored and
   traceable in Oracle.
6. **No early triage.** The full universe is carried forward; hard thresholds are applied tier-by-tier
   on explicit criteria, never as an arbitrary "top-N" cut until the final nomination.

---

## 3. The funnel model

```
                       SOURCES (accumulate into the tier silo)
      literature · patents · clinical trials · structured DBs · prior rounds
                                   │
                          ┌────────▼────────┐
                          │   TIER  (silo)  │   ← candidates pool here (EXPAND)
                          └────────┬────────┘
                                   │  SIFT: explicit, scorable criterion (NARROW)
                                   ▼
                          ┌─────────────────┐
                          │  next TIER      │
                          └─────────────────┘
   … repeat, cheap → expensive …            … and ITERATE over rounds:
                                            missed candidates can be promoted later.
```

- A **tier** answers one question, costs roughly one "cost class," and may pull candidates from
  **multiple sources**.
- A **sift** is the gate between tiers: a criterion with a clear outcome to score (a threshold, a
  membership test, a centrality cut).
- **Rounds**: the whole funnel can be re-run; new literature or new analysis can lift a previously
  dropped gene. Lineage IDs record where each candidate came from and which round promoted it.

---

## 4. The tier ladder (ordered by computational cost)

The spine, in cost order: **cheap searches → cheap lookups → moderate compute → expensive models →
simulation → nomination.**

| Tier | Question | Sources accumulated | Sift criterion | Cost class | Status |
|---|---|---|---|---|---|
| **T0** Universe | What is the candidate set? | Open Targets `associatedTargets` (+ literature / patent / trial seed pools) | none — assemble, no triage | cheap | ✅ have |
| **T1** Literature & evidence presence | Is it on the radar at all? | PubMed / PubTator3 / Europe PMC · ClinicalTrials.gov · patents · OT | credible disease mention / association ≥ generous floor | cheap (API + search) | ✅ have (patents: missing) |
| **T2** Genetic & mutation link | Is it genetically/somatically linked? | OT genetic datatype · cBioPortal somatic mutation | minimum genetic or mutation support | cheap (API) | ✅ have |
| **T3** Annotation lookups (safety · druggability · dependency) | Safe? Druggable? Needed? | gnomAD pLI/LOEUF · ChEMBL / OT tractability · DepMap (precomputed) | not safety-excluded · plausible modality · dependency present | cheap (1 API / table lookup) | ✅ built — store next |
| **T4** Disease-pathway relevance | Is it in disease biology? | PAGER / Enrichr / OT pathways | member of an enriched disease pathway | moderate | 🟡 compute exists |
| **T5** Differential expression | Is it dysregulated in the tumor? | TCGA / GTEx tumor-vs-normal (Xena Toil) | significantly dysregulated | moderate (precomputed; live = expensive) | ✅ built — store next |
| **T6** Network / systems centrality | Is it central to the disease network? | STRING + WINNER / RWR propagation | centrality / WINNER score > threshold | moderate | 🟡 compute exists |
| **T7** Mechanism & actionability | Can it actually be acted on? | COSMIC / OncoKB (onco/TSG, GoF/LoF) · OncoKB / CIViC / DGIdb (variant→drug) | actionable mechanism (drop intractable LoF unless synthetic-lethal) | moderate–expensive (curated/licensed) | 🔴 missing |
| **T8** Model-based scoring | What do learned models say? | foundation-model target scoring · perturbation modeling | model score ≥ threshold | expensive (GPU) | 🔴 missing |
| **T9** Structural / simulation | Is the pocket real and tractable? | docking · molecular dynamics · binding-site assessment (collaborators) | favorable binding / simulation | very expensive (GPU / HPC) | 🔴 missing |
| **T10** Nomination | How do survivors rank, and is it trustworthy? | internal: composite + gold-standard benchmarks | weighted-harmonic composite + validation passes | cheap (gated on all above) | 🟡 partial |

**Notes on cost.** DepMap, gnomAD and our tumor-vs-normal expression are **precomputed once** into
reference tables, so the per-candidate *test* at T3/T5 is a cheap lookup even though *generating* the
data was expensive. The design deliberately pushes the expensive *generation* offline and keeps the
*gate* cheap — this is a decision to confirm, not assume.

---

## 5. Expansion (generators) and iterative rounds

Every tier has an **expand** move, not only a sift:

- **T0** — the Open Targets universe is the base generator.
- **T1** — literature generators: embedding-neighbor search, "last-12-months" refresh, patent/trial pulls.
- **Cross-tier** — *regenerate from winners*: take current top candidates and gather their neighbors;
  and *diversity research*: deliberately include "possible winners," not only winners, so the next
  round explores breadth.

**Rounds & lineage.** Each candidate carries an ID encoding its origin and derivation (analogous to the
chemistry side's `A0…E0 → .round1` lineage). A gene dropped at T6 in round 1 can re-enter in round 2
when, say, new differential-expression data arrives — and the system records *why* it was promoted.

---

## 6. Data architecture

**One schema, never altered. Extensibility lives in convention + a registry — not in DDL.**

### 6.1 Storage (Oracle, content store of record)
- `TARGET_RANKING_SNAPSHOTS` — one row per harvested ranking (disease, tier/version, provenance).
- `RANKING_SCORES` — one row per gene per snapshot (the GET sub-scores).
- `EVIDENCE` — one row per `(gene, evidence_type, source)`, payload in `value_json`. **Adding a new
  evidence source = new rows, zero schema change.**
- `AUDIT_LOG` — append-only event trail.

### 6.2 The `value_json` contract
Every evidence row carries, on top of its raw measurements:
```json
{ "axis": 0.0-1.0, "direction": "pro|con", "display": "human text", "...raw fields": "…" }
```
- `axis` — normalized magnitude the funnel ranks on (the funnel rank-normalizes across survivors).
- `direction` — does a high value argue **for** or **against** the target (safety is `con`).
- `display` — short string for the Gene×Source matrix and the target card.
- raw fields — kept so **real-unit filters** (log2FC, LOEUF, trials…) always have the actual numbers.

### 6.3 The registry (single source of truth)
`evidenceRegistry.ts` declares each axis once: `tier`, `label`, `source(s)`, sift `type` (hard/soft),
`direction`, composite `weight`, and the **filter definition** (range / category / boolean). The
funnel, the matrix, and the harvest writer all read it. **Adding a tier or a filter = one entry.**
Re-tiering by cost (per §4) is editing the `tier` numbers in this one file.

### 6.4 The harvest pipeline (providers + cost-tiered passes)
- Each source is a uniform **provider** (`key`, `scope: universe|survivors`, `diseaseScoped`,
  `fetch()` → contract-shaped `value_json`). Adding a source = one provider + one registry line.
- A job runs providers in **two passes**: **cheap, full-universe** (T0–T3, T5 lookups) for *all* genes;
  **expensive, survivors-only** (later tiers, rate-limited APIs) on the genes that cleared the cheap sifts.
- Writes are **idempotent upserts** on `(snapshot, gene, evidence_type)`, so a snapshot can be
  **enriched incrementally** across rounds without duplication.
- Jobs run in the **background** (Jobs tab); the funnel reads only the stored snapshot (no live calls).

---

## 7. Validation — the SRC case study

**The headline result.** SRC has an Open Targets association of ≈ 0.39 — ranked **~7,000 of ~20,000**.
Single-modality scoring buries it.

- **No early triage** (T0) keeps SRC in the universe instead of cutting it at "top 500."
- SRC is **weak** on the cheap genetic/mutation tiers — but **strong** on literature (heavily studied
  kinase) and druggability (dasatinib/bosutinib).
- On the moderate tiers it is **strong**: **over-expressed in tumor** (tumor-vs-normal log2FC ≈ +1.46,
  highly significant — measured in our prototype) and a **network hub**.
- The **composite** (T10), treating Open Targets as one axis among many and inverting safety, surfaces
  SRC near the top — matching the independent SRC discovery (PAGER + network ranking, SRC in the top ~20).

**The story:** *single-modality, even with millions spent, buries SRC; our objective multi-tier system,
using all available data, recovers it.* Benchmark recovery (KRAS / TP53 / SMAD4 / SRC) plus sensitivity
analysis (top-N stability under weight perturbation) make the ranking defensible rather than asserted.

---

## 8. Coverage and build order

### 8.1 Status summary
| Capability | Tier | Status |
|---|---|---|
| Open Targets universe / association | T0–T2 | ✅ have |
| Literature (PubMed/PubTator), clinical trials | T1 | ✅ have |
| Somatic mutation (cBioPortal) | T2 | ✅ have |
| Safety / constraint (gnomAD) | T3 | ✅ built — not yet stored as evidence |
| Druggability (ChEMBL / tractability) | T3 | ✅ have |
| Dependency (DepMap) | T3 | ✅ built — not yet stored |
| Pathway relevance (Enrichr / PAGER) | T4 | 🟡 compute exists, not a funnel gate yet |
| Differential expression (TCGA/GTEx) | T5 | ✅ built — not yet stored |
| Network centrality (STRING/WINNER/RWR) | T6 | 🟡 compute exists, not a funnel gate yet |
| Mechanism + variant→drug actionability | T7 | 🔴 missing |
| Model-based scoring | T8 | 🔴 missing |
| Structural / molecular dynamics | T9 | 🔴 missing |
| Composite + benchmark validation | T10 | 🟡 partial |
| Registry + value_json contract + filters | — | ✅ built |
| Background jobs + Oracle data browser | — | ✅ built |
| Iterative rounds + lineage IDs | — | 🔴 missing |
| Patents source | T1 | 🔴 missing |

### 8.2 Build order (impact per effort, cost-aware)
1. **Store the cheap axes** (safety, dysregulation, dependency) into Oracle via the provider framework
   + idempotent upsert → the funnel's pending tiers light up end-to-end. *(highest leverage)*
2. **Re-tier the registry by cost** (per §4) — a config edit.
3. **Wire pathway (T4) and network (T6)** into the funnel — the compute already exists.
4. **Composite + SRC benchmark (T10)** — complete the validation story.
5. **Mechanism + actionability (T7)** — COSMIC/OncoKB/CIViC/DGIdb (arrange academic licenses early).
6. **Iterative rounds + lineage**, then **target card** (manuscript-ready per-gene export).
7. **Model-based (T8) and structural/MD (T9)** — expensive tiers, routed to HPC (e.g. SPARC-Q) later.

---

## 9. Summary

The funnel narrows the gene universe through cost-ordered tiers — cheap searches first, expensive
analysis last — where each **tier accumulates candidates from many sources** and each **transition
sifts on an explicit criterion**, modelling reasons *not* to pursue alongside reasons to pursue, and
improving candidates over **iterative rounds**. One unchanging Oracle schema plus a `value_json`
contract and a single registry make every new evidence source a one-line addition. The decisive proof
is recovering **SRC** — invisible to single-modality scoring — objectively, from all available data.
