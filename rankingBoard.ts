// rankingBoard.ts ──────────────────────────────────────────────────────────
// The "US-News-style" target ranking engine (CollaboFest Phase 1+2).
//
// Turns the per-gene raw signals from /api/dashboard/genes into a TRANSPARENT
// weighted sum across 8 criteria, rescaled so the disease's leader = 100 — and
// makes MODALITY a lever that swaps the weight vector (and gates ineligible
// targets), so the ranking reshuffles when the user picks small-molecule vs
// antibody vs siRNA, etc.  Pure, UI-agnostic; the view just renders what this
// returns.  See docs/CollaboFest_Phase0_User_Requirements.md.

export type CriterionKey =
  | 'genetics' | 'expression' | 'dependency' | 'tractability'
  | 'safety' | 'clinical' | 'literature' | 'network';

export interface CriterionDef { key: CriterionKey; label: string; definition: string; source: string; }

// The 8 subcategories — each carries its own definition + data source, surfaced
// verbatim in the target report-card drill-down (the professor's "criteria + a
// definition + where each candidate scores + the evidence").
export const CRITERIA: CriterionDef[] = [
  { key: 'genetics',     label: 'Genetics',      definition: 'Causal disease association and somatic mutation burden — how strongly genetics implicates this gene in the disease.', source: 'Open Targets genetic association · cBioPortal mutation frequency' },
  { key: 'expression',   label: 'Disease expr.', definition: 'Dysregulation in disease vs normal tissue — magnitude of tumour-vs-normal change at the mRNA and protein level.', source: 'UCSC Xena (mRNA log2FC) · CPTAC/LinkedOmics (protein log2FC)' },
  { key: 'dependency',   label: 'Dependency',    definition: 'How essential the gene is in disease cell lines (CRISPR knockout effect) — a strong dependency means knocking it out hurts the tumour.', source: 'DepMap Chronos' },
  { key: 'tractability', label: 'Tractability',  definition: 'How druggable the protein is — whether a therapeutic of the chosen modality can engage it.', source: 'Open Targets tractability' },
  { key: 'safety',       label: 'Safety',        definition: 'Tolerance to perturbation — loss-of-function constraint, curated safety liabilities, and whether the gene is pan-essential (a lower score = more risk).', source: 'gnomAD LOEUF · Open Targets safety · common-essential flag' },
  { key: 'clinical',     label: 'Clinical',      definition: 'Clinical precedent and momentum in this disease — trial phase reached and how many trials.', source: 'Open Targets trials · ClinicalTrials.gov' },
  { key: 'literature',   label: 'Literature',    definition: 'Research momentum — recent publication velocity for the gene in this disease.', source: 'Europe PMC' },
  { key: 'network',      label: 'Network',       definition: 'Network importance and proximity to the disease seed genes over the protein–protein interaction graph.', source: 'WINNER + RWR over STRING' },
];

export type ModalityKey = 'small_molecule' | 'antibody' | 'protac' | 'mrna' | 'gene_therapy';
export interface ModalityProfile {
  key: ModalityKey; label: string; note: string;
  weights: Record<CriterionKey, number>;   // relative; normalised at build time
  gate?: (g: any) => boolean;               // eligibility (e.g. antibody ⇒ surface/secreted)
  gateNote?: string;
}

// First-proposal weight profiles — the *shape* the professor described. Shipped as
// defaults; the UI exposes them as adjustable sliders so they can be calibrated by eye.
export const MODALITY_PROFILES: Record<ModalityKey, ModalityProfile> = {
  small_molecule: {
    key: 'small_molecule', label: 'Small molecule', note: 'Balanced; leans on a ligandable pocket (tractability) and dependency.',
    weights: { genetics: 0.15, expression: 0.12, dependency: 0.15, tractability: 0.20, safety: 0.13, clinical: 0.10, literature: 0.05, network: 0.10 },
  },
  antibody: {
    key: 'antibody', label: 'Antibody / ADC', note: 'Requires the target to be on the cell surface or secreted; weights surface abundance and selectivity.',
    weights: { genetics: 0.12, expression: 0.18, dependency: 0.08, tractability: 0.12, safety: 0.16, clinical: 0.10, literature: 0.04, network: 0.06 },
    gate: (g) => g?.surface_or_secreted === true,
    gateNote: 'Not surface/secreted — unreachable by an antibody.',
  },
  protac: {
    key: 'protac', label: 'Degrader (PROTAC)', note: 'Needs a ligandable handle and enough expressed protein to degrade; intracellular.',
    weights: { genetics: 0.13, expression: 0.16, dependency: 0.15, tractability: 0.16, safety: 0.12, clinical: 0.08, literature: 0.04, network: 0.10 },
  },
  mrna: {
    key: 'mrna', label: 'mRNA / siRNA (knockdown)', note: 'No binding pocket needed — dependency dominates (knockdown must matter); values knockdown tolerance.',
    weights: { genetics: 0.15, expression: 0.15, dependency: 0.28, tractability: 0.0, safety: 0.20, clinical: 0.07, literature: 0.05, network: 0.10 },
  },
  gene_therapy: {
    key: 'gene_therapy', label: 'Gene therapy', note: 'Genetic causality dominates; loss-of-function biology and safety weigh heavily.',
    weights: { genetics: 0.35, expression: 0.08, dependency: 0.12, tractability: 0.0, safety: 0.25, clinical: 0.08, literature: 0.04, network: 0.08 },
  },
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
// weighted mean over the signals that are actually present (so missing data
// neither counts as 0 nor inflates the score); null if nothing is present.
const blend = (pairs: Array<[number | null | undefined, number]>): number | null => {
  let sw = 0, s = 0, any = false;
  for (const [v, w] of pairs) { if (v != null && isFinite(v as number)) { s += (v as number) * w; sw += w; any = true; } }
  return any && sw > 0 ? s / sw : null;
};

// Raw per-gene signals → 8 criterion scores in 0–1 (null = no data for that criterion).
export function criterionScores(g: any): Record<CriterionKey, number | null> {
  // Discount low-confidence expression (near-zero normal tissue → inflated |log2FC|, e.g. lncRNAs).
  const exprMag = g.expr_log2fc != null ? clamp01(Math.abs(g.expr_log2fc) / 4) * (g.expr_low_conf ? 0.25 : 1) : null;
  const protMag = g.prot_log2fc != null ? clamp01(Math.abs(g.prot_log2fc) / 3) : null;
  const loeufTol = g.loeuf != null ? clamp01(g.loeuf / 1.5) : null;           // high LOEUF = tolerates LoF = safer
  const liabPenalty = g.n_safety_liabilities != null ? clamp01(1 - Math.min(g.n_safety_liabilities, 5) / 10) : 1;
  const essPenalty = g.is_common_essential ? 0.5 : 1;                          // pan-essential = riskier
  const phase = g.max_disease_phase != null ? clamp01(g.max_disease_phase / 4) : null;
  const trials = g.n_disease_trials != null ? clamp01(Math.min(g.n_disease_trials, 10) / 10) : null;

  return {
    genetics:     blend([[g.genetic_score, 0.6], [g.mutation_freq, 0.4]]),
    expression:   blend([[exprMag, 0.5], [protMag, 0.5]]),
    dependency:   g.chronos != null ? clamp01(-g.chronos) : null,             // Chronos −1 ≈ strong dependency
    tractability: g.druggability_score != null ? clamp01(g.druggability_score) : null,
    safety:       loeufTol != null ? clamp01(loeufTol * essPenalty * liabPenalty) : (g.is_common_essential != null ? clamp01(0.5 * essPenalty * liabPenalty) : null),
    clinical:     blend([[phase, 0.6], [trials, 0.4]]),
    literature:   g.velocity != null ? clamp01(g.velocity) : null,
    network:      g.winner_score != null ? clamp01(g.winner_score) : null,
  };
}

export interface ScoredGene {
  symbol: string; boardRank: number; sourceRank: number | null;
  criteria: Record<CriterionKey, number | null>;
  overall: number;          // 0–1 weighted sum (missing criteria contribute 0)
  display: number;          // 0–100, leader = 100
  coverage: number;         // # of the weighted criteria with data (breadth)
  gated: boolean; gateNote?: string;
  raw: any;                 // the original row (for the evidence drill-down)
}

// Normalise a weight vector to sum 1 across the 8 criteria.
export function normaliseWeights(w: Record<CriterionKey, number>): Record<CriterionKey, number> {
  const total = CRITERIA.reduce((s, c) => s + Math.max(0, w[c.key] || 0), 0) || 1;
  const out = {} as Record<CriterionKey, number>;
  for (const c of CRITERIA) out[c.key] = Math.max(0, w[c.key] || 0) / total;
  return out;
}

// Build the ranked board for a modality (with optional slider overrides).
export function buildBoard(genes: any[], modality: ModalityKey, weightOverride?: Record<CriterionKey, number>): {
  scored: ScoredGene[]; weights: Record<CriterionKey, number>; profile: ModalityProfile;
} {
  const profile = MODALITY_PROFILES[modality];
  const weights = normaliseWeights(weightOverride || profile.weights);

  const pre = genes.map(g => {
    const criteria = criterionScores(g);
    const gated = !!(profile.gate && !profile.gate(g));
    // Weighted SUM across ALL weighted criteria — a MISSING criterion contributes 0 (US-News
    // style: blanks sink you). This rewards breadth of evidence, so a gene with one strong
    // criterion and nothing else can't tie a fully-evidenced target. Weights sum to 1.
    let overall = 0, coverage = 0;
    for (const c of CRITERIA) {
      const v = criteria[c.key], w = weights[c.key];
      if (w <= 0) continue;
      if (v != null) { overall += v * w; coverage++; }
    }
    if (gated) overall *= 0.05;                       // ineligible → sink to the bottom, don't hide
    return { symbol: g.gene_symbol, sourceRank: g.rank ?? null, criteria, overall, coverage, gated, gateNote: gated ? profile.gateNote : undefined, raw: g };
  });

  const leader = pre.reduce((m, x) => Math.max(m, x.overall), 0) || 1;
  const scored = pre
    .sort((a, b) => b.overall - a.overall)
    .map((x, i) => ({ ...x, boardRank: i + 1, display: Math.round(100 * x.overall / leader) }));
  return { scored, weights, profile };
}
