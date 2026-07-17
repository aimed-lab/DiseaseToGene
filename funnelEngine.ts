// funnelEngine.ts ─────────────────────────────────────────────────────────────
// Two-stage target-nomination engine implementing `Disease2Target_App_Design.md`
// (v2 architecture). PURE — no React, no I/O — so it can be unit-tested and reused.
//
// It REPLACES the old strict hard-gate cascade + within-survivor harmonic composite
// (which, verified on 12 canonical PDAC genes, collapsed the list to zero and deleted
// KRAS at the LOEUF gate). The design instead:
//   STAGE 1  ELIGIBILITY  — 2 permissive gates that only remove the out-of-scope:
//       Gate 1 DISEASE NEXUS (OR): OT_overall ≥ 0.10  OR  mutation ≥ 5%  OR
//                                  selective dependency (Chronos ≤ −0.5)
//       Gate 2 TRACTABILITY (optional; modality-aware): ≥ 1 plausible modality
//   STAGE 2  COMPENSATORY SCORE — weighted ARITHMETIC mean of EXTERNALLY-normalized
//       axes (a gene's axis score is a property of the gene, not of who else
//       survived), minus bounded risk penalties (constraint / common-essentiality).
//
// Why arithmetic, not harmonic: harmonic is dominated by the smallest axis, so one
// weak axis buries an otherwise-strong target (verified: TP53, a 60%-mutated PDAC
// driver with ~0 CRISPR dependency, sinks to ~#11 under harmonic but ranks ~#4 under
// arithmetic). See the design doc §2/§6.
//
// Every value the engine reads is a RAW value in real units (OT score, mutation
// fraction, log2FC, Chronos, LOEUF, drug label) — the same fields the funnel already
// stores per gene. No new harvested data is required for the core engine; axes we do
// not yet harvest (OT tractability buckets, OncoKB/CGC mechanism tags, common-
// essentiality, tissue τ) are wired as optional and no-op when absent, flagged below.

export interface FunnelGene {
  gene_symbol: string;
  otOverall: number | null;   // OT overall/indirect association — used for the ELIGIBILITY nexus ONLY
                              // (a permissive "any disease link" arm). NOT used in the score, because
                              // OT-overall is a blend of somatic-mutation + literature + … and would
                              // double-count the somatic axis (verified ρ≈0.84 with mutation).
  geneticAssoc: number | null; // OT genetic_association DATATYPE — the TRUE germline/genetic signal
                              // (G1). ≈null for pure somatic cancer drivers (honest); non-zero for
                              // germline-risk genes (BRCA2, ATM, CDKN2A germline). Used in the SCORE.
  frequency: number | null;   // somatic mutation fraction 0..1 (cBioPortal) — the single somatic axis (G2)
  log2fc: number | null;      // tumor-vs-normal log2 fold-change
  chronos: number | null;     // DepMap Chronos gene effect (more negative = needed)
  loeuf: number | null;       // gnomAD v4 LOEUF (low = constrained)
  drugLabel: string | null;   // ChEMBL bucket: Clinically Validated / In Clinical Development / Preclinical Only / No Drug Data Found
  trialCount?: number | null; // ClinicalTrials.gov count (attention — annotation only)
  velocity?: number | null;   // PubMed velocity (attention — annotation only)
  tissueTau?: number | null;  // HPA/GTEx τ (optional; absent in current snapshots)
  commonEssential?: boolean;  // DepMap common-essential (optional; absent for now)
  mechanism?: 'oncogene' | 'tumor_suppressor' | 'fusion' | null; // OncoKB/CGC (optional)
}

export interface EligibilityConfig {
  nexus: boolean;         // Gate 1 on/off (default on)
  otMin: number;          // OT overall floor for nexus (design default 0.10)
  mutMin: number;         // mutation-fraction floor for nexus (design default 0.05)
  depMax: number;         // Chronos ceiling for selective dependency (design −0.5)
  tractability: boolean;  // Gate 2 on/off — OFF by default until OT tractability data
                          // is harvested (max-phase alone would wrongly drop novel targets)
}

export const DEFAULT_ELIGIBILITY: EligibilityConfig = {
  nexus: true, otMin: 0.10, mutMin: 0.05, depMax: -0.5, tractability: false,
};

// ── external normalization (design §4) — fixed functions, NOT survivor-relative ──
const clip01 = (x: number) => Math.max(0, Math.min(1, x));
export const NORM = {
  // G1 — germline/genetic association (OT genetic_association DATATYPE), NOT OT overall.
  // Scoring on OT-overall double-counts the somatic axis; reading the datatype component
  // fixes that and makes "genetic" mean genetics. null (excluded) for pure somatic drivers,
  // so it never dilutes their score — it only rewards genes with real genetic support.
  genetic:    (g: FunnelGene) => (g.geneticAssoc == null ? null : clip01(g.geneticAssoc)),
  mutation:   (g: FunnelGene) => (g.frequency == null ? null : g.frequency / (g.frequency + 0.05)), // 0.5 at 5%
  dysreg:     (g: FunnelGene) => (g.log2fc == null ? null : clip01(Math.abs(g.log2fc) / 3)),        // two-sided
  dependency: (g: FunnelGene) => (g.chronos == null ? null : clip01(-g.chronos)),
  tractability:(g: FunnelGene) => {                                                                  // ChEMBL bucket → score
    if (g.drugLabel == null) return null;
    if (/Validated/i.test(g.drugLabel)) return 1.0;
    if (/Development/i.test(g.drugLabel)) return 0.6;
    if (/Preclinical/i.test(g.drugLabel)) return 0.3;
    return 0.0; // No Drug Data Found
  },
  tissue:     (g: FunnelGene) => (g.tissueTau == null ? null : clip01((g.tissueTau - 0.5) / 0.5)),
} as const;

// weighted-arithmetic weights (design §4)
export type ScoreWeights = Record<keyof typeof NORM, number>;
export const WEIGHTS: ScoreWeights = {
  genetic: 1.0, mutation: 0.8, dysreg: 1.0, dependency: 1.0, tractability: 1.0, tissue: 0.5,
};

export interface ScoredGene {
  gene: FunnelGene;
  eligible: boolean;
  reasons: string[];          // which nexus condition(s) made it eligible
  axisScores: Record<string, number | null>;
  base: number | null;        // weighted arithmetic mean of present axes
  penalties: { label: string; value: number }[];
  score: number | null;       // base − Σ penalties
  completeness: number;       // present axes / scored axes
  flags: string[];            // risk / under-evidenced flags
}

export interface FunnelResult {
  total: number;
  eligibleCount: number;
  stage1: { afterNexus: number; afterTractability: number };
  ranked: ScoredGene[];       // eligible genes, sorted by score desc
}

// Stage 1 — eligibility. OR-of-nexus (any one credible disease link) then optional
// tractability. Returns the passing reasons so the UI can show WHY a gene is in.
function eligibility(g: FunnelGene, cfg: EligibilityConfig): { ok: boolean; reasons: string[]; passNexus: boolean; passTract: boolean } {
  const reasons: string[] = [];
  let passNexus = true;
  if (cfg.nexus) {
    const byOt = g.otOverall != null && g.otOverall >= cfg.otMin;
    const byMut = g.frequency != null && g.frequency >= cfg.mutMin;
    const byDep = g.chronos != null && g.chronos <= cfg.depMax;
    if (byOt) reasons.push(`OT ≥ ${cfg.otMin}`);
    if (byMut) reasons.push(`mut ≥ ${Math.round(cfg.mutMin * 100)}%`);
    if (byDep) reasons.push(`Chronos ≤ ${cfg.depMax}`);
    passNexus = byOt || byMut || byDep;
  }
  // Gate 2 tractability is permissive: only removes an explicit "No Drug Data Found".
  // Kept OFF by default because true modality-aware tractability (OT buckets) is not
  // yet harvested — using max-phase alone would wrongly drop genuine first-in-class targets.
  let passTract = true;
  if (cfg.tractability) passTract = !(g.drugLabel != null && /No Drug/i.test(g.drugLabel));
  return { ok: passNexus && passTract, reasons, passNexus, passTract };
}

// Stage 2 — compensatory score. Weighted ARITHMETIC mean of the externally-normalized
// axes that have data, minus bounded risk deductions. Mechanism router: tumor-suppressors
// are routed to two-sided dysregulation logic (already two-sided in NORM.dysreg); the
// oncogene/TSG tag is honored when present but never gates.
// `weights` defaults to the module WEIGHTS; the benchmark harness passes an override
// so it can ablate/fit weights against THE REAL engine (a weight of 0 excludes that axis
// from both numerator and denominator — the correct hold-out semantic). Weights never
// affect eligibility, only the Stage-2 score, so ranking sweeps stay pure.
function scoreGene(g: FunnelGene, weights: ScoreWeights = WEIGHTS): ScoredGene {
  const axisScores: Record<string, number | null> = {};
  let wsum = 0, acc = 0, present = 0;
  const scoredKeys = Object.keys(NORM) as (keyof typeof NORM)[];
  for (const k of scoredKeys) {
    const s = NORM[k](g);
    axisScores[k] = s;
    if (s == null) continue;
    const w = weights[k];
    if (w === 0) continue; // weight 0 = axis held out (ablation) — exclude from score AND completeness
    wsum += w; acc += w * s; present++;
  }
  const base = wsum > 0 ? acc / wsum : null;

  // bounded risk penalties (design §4/§6) — annotations that subtract, never gate.
  const penalties: { label: string; value: number }[] = [];
  const flags: string[] = [];
  if (g.loeuf != null && g.loeuf < 0.6) { penalties.push({ label: 'constraint (LOEUF < 0.6)', value: 0.10 }); flags.push('constrained'); }
  if (g.commonEssential) { penalties.push({ label: 'common-essential', value: 0.10 }); flags.push('common-essential'); }

  const score = base == null ? null : base - penalties.reduce((a, p) => a + p.value, 0);
  const completeness = scoredKeys.length ? present / scoredKeys.length : 0;
  if (completeness < 0.6) flags.push('under-evidenced');

  return { gene: g, eligible: true, reasons: [], axisScores, base, penalties, score, completeness, flags };
}

export function runFunnel(
  genes: FunnelGene[],
  cfg: EligibilityConfig = DEFAULT_ELIGIBILITY,
  weights: ScoreWeights = WEIGHTS,
): FunnelResult {
  const total = genes.length;
  let afterNexus = 0, afterTractability = 0;
  const eligible: ScoredGene[] = [];
  for (const g of genes) {
    const e = eligibility(g, cfg);
    if (e.passNexus) afterNexus++;
    if (e.passNexus && e.passTract) afterTractability++;
    if (!e.ok) continue;
    const s = scoreGene(g, weights);
    s.reasons = e.reasons;
    eligible.push(s);
  }
  eligible.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { total, eligibleCount: eligible.length, stage1: { afterNexus, afterTractability }, ranked: eligible };
}
