# Druggability by Modality — Feature Documentation

_Disease2Target · gene drill-down · "which modality can drug it?"_

---

## 1. What it is (and why)

The old funnel answered **"can we drug it?"** with a single ChEMBL bucket — one verdict per
target. That flattens the one distinction that actually decides how (and whether) to pursue a
target: **druggability depends on the MODALITY.**

The professor's example, confirmed on our own data:
- **ERBB2 (HER2)** is drugged three different ways — **small molecule** (lapatinib), **antibody**
  (trastuzumab), and **antibody-drug-conjugate** (T-DM1) — all approved.
- **PHGDH** has **no small-molecule drug** (no good pocket in most structures) but is plausibly
  tractable by other modalities.

A single "Druggability: yes/no" verdict hides all of that. This feature replaces it with a
per-target, **per-modality** readout that answers **"which modality can drug it?"**

It shows up as a **"Druggability by modality"** panel in the gene drill-down (next to the pocket
panel), triggered on demand.

---

## 2. The core design: FACT vs PREDICTION (kept structurally separate)

The professor's north-star rule is **never mix fact with prediction.** This feature enforces that
in the data model — two separate fields, rendered as two visually distinct blocks:

| Layer | Question it answers | Nature |
|---|---|---|
| **`fact`** | Which modalities have **actual developed drugs**, and how mature? | Hard fact — these drugs exist |
| **`prediction`** | Which modalities are **assessed tractable**, and why? | Assessment — plausible, not built |

They **never share a field or a colour.** In the UI: `fact` = green-tagged block, `prediction` =
amber, dashed block. You can never mistake a prediction for a fact.

**Why the separation matters — it's where decisions get made:**
- When they **agree** (ERBB2: developed *and* tractable) → validated, crowded target.
- When they **diverge** → the interesting cases:
  - **PHGDH**: 0 developed drugs (`fact`) but 3 modalities tractable (`prediction`) → a *novel*
    target that still looks druggable. Must not be rejected for lacking a drug.
  - **KRAS**: only small molecule developed (`fact`), but antibody + PROTAC also assessed
    tractable (`prediction`) → hints at unexplored modalities.

---

## 3. Where the data comes from (the sources)

Everything is from the **Open Targets Platform GraphQL API** (`api.platform.opentargets.org`) —
public, and already used elsewhere in the app, so it works locally and on Vercel.

### Step 0 — resolve the gene
`search(queryString: <gene>, entityNames:["target"])` → the target's **Ensembl gene ID**
(e.g. `ERBB2 → ENSG00000141736`).

### FACT layer — developed drugs by modality
Source: `target(ensemblId).drugAndClinicalCandidates`

| Our field | Open Targets field |
|---|---|
| modality | `rows[].drug.drugType` (e.g. "Small molecule", "Antibody", "Antibody drug conjugate", "Oligonucleotide") |
| maturity | `rows[].drug.maximumClinicalStage` (enum below) |
| drug name | `rows[].drug.name` (used to surface unclassified drugs) |

**Maturity enum → rank:** `APPROVAL(4) · PHASE_4(4) · PHASE_3(3) · PHASE_2_3(2.5) · PHASE_2(2) ·
PHASE_1_2(1.5) · PHASE_1(1) · EARLY_PHASE_1(0.5) · PRECLINICAL(0)`. Rank is used only as a maturity
**annotation** — never as a gate (see §6).

### PREDICTION layer — per-modality tractability
Source: `target(ensemblId).tractability` → array of `{ label, modality, value }` (booleans).

**Modality codes:** `SM` = Small molecule · `AB` = Antibody · `PR` = PROTAC / degrader ·
`OC` = Other (clinical precedence).

Each modality has several **buckets** (labels) that are true/false — e.g. for ERBB2's `SM`:
`Approved Drug`, `Structure with Ligand`, `High-Quality Ligand`, **`High-Quality Pocket`**,
`Druggable Family`. These are the *reasons* a modality is (or isn't) tractable — provided by Open
Targets' structural/biological assessment (canSAR-derived).

### Data flow
```
Browser panel → GET /api/druggability/modality?gene=<SYM>
   → modalityService.getModalityProfile(gene)
      → OT search (gene → Ensembl)
      → OT target { drugAndClinicalCandidates, tractability }   [one GraphQL call]
   → { fact, prediction }   (structurally separate)
```
No Oracle, no internal deps — pure public API, so it runs on Vercel like the pocket panel.

---

## 4. The output (data model)

```
ModalityProfile {
  gene, ensemblId,
  fact: {
    developed: [ { modality, family, drugCount, topStage, topStageRank, approved } ],  // KNOWN modalities, most-mature first
    totalDrugs,          // all developed drugs (incl. unclassified)
    provenModalities,    // # distinct KNOWN modalities (raw drugType) — excludes Unknown
    provenFamilies,      // # distinct families (ADC folds under Biologic)
    bestStageRank,       // maturity of the most-advanced modality (annotation only)
    unclassified: { drugCount, names[], topStage, topStageRank } | null,  // drugType-null drugs — NOT a modality
    provenance: "Open Targets drugAndClinicalCandidates (drug.drugType, maximumClinicalStage)"
  },
  prediction: {
    buckets: [ { modality, code, labels[] } ],   // per assessment modality, the TRUE tractability buckets
    tractableModalities,   // # modalities with ≥1 true bucket — the ONLY gate-safe signal
    provenance: "Open Targets tractability (per-modality assessment)"
  },
  note
}
```

**Family grouping** (display): Small molecule → *Small molecule*; Antibody / ADC / Protein / Enzyme
→ *Biologic*; Oligonucleotide → *Oligonucleotide (RNA/ASO)*; Cell / Gene → *Cell / gene therapy*;
otherwise *Other*. (This map is validated on common values; the long tail is refined over time —
see §6.)

---

## 5. Worked examples (verified against the live API)

**ERBB2** — the multi-modality poster child
- `fact`: Small molecule (Approved ×30) · Antibody (Approved ×7) · Antibody-drug-conjugate
  (Approved ×6) → **3 proven modalities, 2 families**. Plus **5 unclassified drugs** (MM-111,
  KN-026, S-222611, …) shown separately.
- `prediction`: SM, AB, PROTAC, Other all tractable — SM includes "High-Quality Pocket".

**KRAS**
- `fact`: Small molecule only (Approved ×3) → 1 modality.
- `prediction`: SM + Antibody + PROTAC assessed tractable → unexplored modalities.

**PHGDH** — novel target
- `fact`: **0 developed drugs**.
- `prediction`: 3 modalities assessed tractable → *"the funnel must NOT reject this on developed
  drugs."* (Exactly why we never gate on maturity.)

---

## 6. Design guardrails (from the Claude-Science review)

1. **Fact/prediction separation is structural, not cosmetic** — different fields, different UI
   blocks, different OT endpoints. If they ever share a column or a score, the original problem is
   back.
2. **Never gate the funnel on developed-drug maturity** — that rewards crowded targets and would
   kill novel first-in-class targets (PHGDH has 0 developed drugs but a real tractability case).
   The `fact` is a **scored annotation**; the only gate-safe signal is `tractableModalities`
   (is there ≥1 plausible modality).
3. **"Unknown" drugType is a taxonomy gap, not a modality** — excluded from `provenModalities` and
   surfaced separately *with drug names* so it can be resolved. ADC is folded under the Biologic
   family, so `provenModalities` (raw) and `provenFamilies` (grouped) are both reported and
   consistent.
4. **Patent** (a future source) is a *popularity* signal, not a quality signal — treat as context,
   never a pro-score (avoid hype bias).

---

## 7. Where it lives / how to use it

- **Service:** `modalityService.ts` → `getModalityProfile(gene)`
- **Route:** `GET /api/druggability/modality?gene=<SYM>` (server.ts) — public-API only
- **UI:** `ModalityPanel.tsx`, mounted in `GeneDetailDrawer.tsx` and `index.tsx` (drill-down)
- **Test:** open a gene's drill-down → "Druggability by modality" → **Analyze modalities**; or hit
  the endpoint directly: `/api/druggability/modality?gene=ERBB2`

---

## 8. Verification

- **Claude Science: "✅ all correct."** ERBB2 fact layer exact match to a live pull (30 SM / 7 Ab /
  6 ADC / 5 Unknown, all Approved; 48 total); prediction layer every bucket label identical; fact
  and prediction confirmed to come from genuinely different OT endpoints.
- Two taxonomy notes raised (Unknown, ADC-folding) → both fixed and re-verified.
- Confirmed working in the running UI and via the JSON endpoint.

---

## 9. Pending / roadmap

- **Into the funnel as a scored tier** — currently a drill-down; to become a tier it needs the
  modality evidence **harvested into Oracle**, then a **scored** registry axis (gate on tractability
  only). *Needs a harvest run inside UAB.*
- **Long-tail taxonomy pass** — map the "Unknown" drugType drugs (e.g. bispecifics, TKIs) genome-wide.
- **ChEMBL cross-check** — `molecule_type` + max phase as a second fact source (OT alone already delivers).
- **Predicted per-modality plausibility** (PHGDH-style chart) — kept as a clearly-labeled prediction
  layer if added.
