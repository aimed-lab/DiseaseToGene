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
  { key: 'expression',   label: 'Expression',    definition: 'Dysregulation in disease vs normal tissue — magnitude of tumour-vs-normal change at the mRNA and protein level.', source: 'UCSC Xena (mRNA log2FC) · CPTAC/LinkedOmics (protein log2FC)' },
  { key: 'dependency',   label: 'Dependency',    definition: 'How essential the gene is in disease cell lines (CRISPR knockout effect) — a strong dependency means knocking it out hurts the tumour.', source: 'DepMap Chronos' },
  { key: 'tractability', label: 'Tractability',  definition: 'How druggable the protein is — whether a therapeutic of the chosen modality can engage it.', source: 'Open Targets tractability' },
  { key: 'safety',       label: 'Safety',        definition: 'Tolerance to perturbation — loss-of-function constraint, curated safety liabilities, and whether the gene is pan-essential (a lower score = more risk).', source: 'gnomAD LOEUF · Open Targets safety · common-essential flag' },
  { key: 'clinical',     label: 'Clinical',      definition: 'Clinical precedent and momentum in this disease — trial phase reached and how many trials.', source: 'Open Targets trials · ClinicalTrials.gov' },
  { key: 'literature',   label: 'Literature',    definition: 'Research momentum — recent publication velocity for the gene in this disease.', source: 'Europe PMC' },
  { key: 'network',      label: 'Network',       definition: 'Network importance and proximity to the disease seed genes over the protein–protein interaction graph.', source: 'WINNER + RWR over STRING' },
];

// CORE biology criteria — missing one of these penalises the score (real evidence gap).
// The rest (clinical / literature / network) are CONTEXT: neutral when absent, so genuinely
// novel targets (no trials, few papers) aren't punished for lacking attention.
export const CORE_CRITERIA = new Set<CriterionKey>(['genetics', 'expression', 'dependency', 'tractability', 'safety']);

export type ModalityKey = 'small_molecule' | 'antibody' | 'protac' | 'mrna' | 'gene_therapy';
export interface ModalityProfile {
  key: ModalityKey; label: string; note: string;
  weights: Record<CriterionKey, number>;   // relative; normalised at build time
  gate?: (g: any) => boolean;               // eligibility (e.g. antibody ⇒ surface/secreted)
  gateNote?: string;
  // Only "ready" modalities are shown. The non-SM profiles re-weight the SAME eight
  // small-molecule-oriented criteria; they do NOT yet model modality-specific biology
  // (immunogenicity, extracellular localization, delivery, ternary-complex formation…),
  // so — per the professor — we don't display their rankings until those criteria exist.
  // The profiles stay in code so re-enabling is one flag once the criteria are built.
  ready: boolean;
  pendingCriteria?: string;                 // what still needs to exist before this is shown
}

// Modalities we actually surface in the UI. Small-molecule is the only validated one today
// (benchmarked ROC-AUC 0.82); the rest are deferred until they have their own criteria.
export const readyModalities = (): ModalityKey[] =>
  (Object.keys(MODALITY_PROFILES) as ModalityKey[]).filter(k => MODALITY_PROFILES[k].ready);

// First-proposal weight profiles — the *shape* the professor described. Shipped as
// defaults; the UI exposes them as adjustable sliders so they can be calibrated by eye.
export const MODALITY_PROFILES: Record<ModalityKey, ModalityProfile> = {
  small_molecule: {
    key: 'small_molecule', label: 'Small molecule', note: 'Balanced; leans on a ligandable pocket (tractability) and dependency.',
    weights: { genetics: 0.15, expression: 0.12, dependency: 0.15, tractability: 0.20, safety: 0.13, clinical: 0.10, literature: 0.05, network: 0.10 },
    ready: true,
  },
  antibody: {
    key: 'antibody', label: 'Antibody / ADC', note: 'Requires the target to be on the cell surface or secreted; weights surface abundance and selectivity.',
    // Integer-percent points summing to 100 (reproduces the prior effective weights to the nearest 1%).
    weights: { genetics: 0.14, expression: 0.21, dependency: 0.09, tractability: 0.14, safety: 0.19, clinical: 0.12, literature: 0.05, network: 0.06 },
    gate: (g) => g?.surface_or_secreted === true,
    gateNote: 'Not surface/secreted — unreachable by an antibody.',
    ready: false, pendingCriteria: 'extracellular localization, surface abundance, immunogenicity',
  },
  protac: {
    key: 'protac', label: 'Degrader (PROTAC)', note: 'Needs a ligandable handle and enough expressed protein to degrade; intracellular.',
    // Integer-percent points summing to 100 (reproduces the prior effective weights to the nearest 1%).
    weights: { genetics: 0.14, expression: 0.17, dependency: 0.16, tractability: 0.17, safety: 0.13, clinical: 0.08, literature: 0.04, network: 0.11 },
    ready: false, pendingCriteria: 'ternary-complex feasibility, E3-ligase co-expression, lysine availability',
  },
  mrna: {
    key: 'mrna', label: 'mRNA / siRNA (knockdown)', note: 'No binding pocket needed — dependency dominates (knockdown must matter); values knockdown tolerance.',
    weights: { genetics: 0.15, expression: 0.15, dependency: 0.28, tractability: 0.0, safety: 0.20, clinical: 0.07, literature: 0.05, network: 0.10 },
    ready: false, pendingCriteria: 'delivery / tissue targeting, knockdown durability, off-target risk',
  },
  gene_therapy: {
    key: 'gene_therapy', label: 'Gene therapy', note: 'Genetic causality dominates; loss-of-function biology and safety weigh heavily.',
    weights: { genetics: 0.35, expression: 0.08, dependency: 0.12, tractability: 0.0, safety: 0.25, clinical: 0.08, literature: 0.04, network: 0.08 },
    ready: false, pendingCriteria: 'vector tropism / delivery, expression durability, immunogenicity',
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

// ── Deep-dive breakdown ──────────────────────────────────────────────────────
// The per-criterion drill-down behind the report-card score: every underlying
// metric, its raw value, and exactly how it feeds the criterion. Transforms here
// MUST match criterionScores() above — so the deep dive can never drift from the
// score it explains. Honours the project's fact-vs-prediction split.
export type MetricRole = 'term' | 'factor' | 'context';   // weighted term · multiplicative factor · shown-only
export interface SubMetric {
  label: string;
  value: string | null;        // formatted raw value; null = no data ("—")
  note?: string;               // what it means / how to read it
  sub?: number | null;         // 0–1 contribution the score actually uses (null when role='context')
  role: MetricRole;
  weightPct?: number;          // for role='term': its share of the blend
  kind: 'fact' | 'prediction'; // never mix — measured evidence vs model output
}
export interface CriterionBreakdown { formula: string; metrics: SubMetric[]; }

export function criterionBreakdown(key: CriterionKey, g: any): CriterionBreakdown {
  const num = (x: any, d = 2) => (x == null || !isFinite(Number(x)) ? null : Number(x).toFixed(d));
  const pct = (x: any, d = 0) => (x == null || !isFinite(Number(x)) ? null : `${(Number(x) * 100).toFixed(d)}%`);

  switch (key) {
    case 'genetics': return {
      formula: 'Weighted mean of the signals present — 60% association, 40% mutation burden.',
      metrics: [
        { label: 'OT genetic association', value: num(g.genetic_score), sub: g.genetic_score != null ? clamp01(g.genetic_score) : null, role: 'term', weightPct: 60, kind: 'fact', note: 'Open Targets aggregated genetic association (0–1) — GWAS, ClinVar, rare-disease links.' },
        { label: 'Somatic mutation frequency', value: g.mutation_freq != null ? `${pct(g.mutation_freq, 1)} of tumours` : null, sub: g.mutation_freq != null ? clamp01(g.mutation_freq) : null, role: 'term', weightPct: 40, kind: 'fact', note: 'cBioPortal — fraction of this disease’s tumours carrying a mutation in the gene.' },
      ],
    };
    case 'expression': {
      const exprMag = g.expr_log2fc != null ? clamp01(Math.abs(g.expr_log2fc) / 4) * (g.expr_low_conf ? 0.25 : 1) : null;
      const protMag = g.prot_log2fc != null ? clamp01(Math.abs(g.prot_log2fc) / 3) : null;
      return {
        formula: 'Weighted mean of mRNA and protein dysregulation (50/50). |log2FC| scaled (mRNA ÷4, protein ÷3).',
        metrics: [
          { label: 'mRNA log2FC (tumour vs normal)', value: num(g.expr_log2fc), sub: exprMag, role: 'term', weightPct: 50, kind: 'fact', note: g.expr_low_conf ? 'UCSC Xena — LOW-CONFIDENCE (near-zero normal floor inflates the ratio): discounted ×0.25.' : 'UCSC Xena — magnitude of tumour-vs-normal mRNA change.' },
          { label: 'Protein log2FC (tumour vs normal)', value: num(g.prot_log2fc), sub: protMag, role: 'term', weightPct: 50, kind: 'fact', note: 'CPTAC / LinkedOmics — magnitude of tumour-vs-normal protein change.' },
        ],
      };
    }
    case 'dependency': return {
      formula: 'Chronos mapped to 0–1 (a score of −1 → 1.0). More negative = stronger dependency.',
      metrics: [
        { label: 'DepMap Chronos (mean)', value: num(g.chronos), sub: g.chronos != null ? clamp01(-g.chronos) : null, role: 'term', weightPct: 100, kind: 'fact', note: 'CRISPR knockout effect across disease cell lines; ≤ −0.5 = essential (knockout hurts the tumour).' },
        { label: 'Fraction of lines dependent', value: pct(g.frac_dependent), role: 'context', kind: 'fact', note: 'Share of cell lines where the gene scores as a dependency — breadth, not depth (context only).' },
      ],
    };
    case 'tractability': {
      const pm = g.proven_modalities;
      const provenStr = Array.isArray(pm) ? (pm.length ? pm.join(', ') : null) : (pm ? String(pm) : null);
      return {
        formula: 'Open Targets tractability score mapped to 0–1. (Held out of the benchmark — a novelty-neutral axis.)',
        metrics: [
          { label: 'OT tractability score', value: num(g.druggability_score), sub: g.druggability_score != null ? clamp01(g.druggability_score) : null, role: 'term', weightPct: 100, kind: 'prediction', note: 'Open Targets — predicted druggability of the protein for the chosen modality.' },
          { label: 'Tractable modalities', value: g.tractable_modalities != null ? String(g.tractable_modalities) : null, role: 'context', kind: 'prediction', note: 'How many modality buckets Open Targets predicts can engage this target.' },
          { label: 'Proven modalities', value: provenStr, role: 'context', kind: 'fact', note: 'Modalities with a real drug already developed against this target.' },
          { label: 'Compounds in ChEMBL', value: g.n_drugs != null ? String(g.n_drugs) : null, role: 'context', kind: 'fact', note: 'Total known compounds targeting the gene (existence, not efficacy).' },
        ],
      };
    }
    case 'safety': {
      const loeufTol = g.loeuf != null ? clamp01(g.loeuf / 1.5) : null;
      const essPenalty = g.is_common_essential ? 0.5 : 1;
      const liabPenalty = g.n_safety_liabilities != null ? clamp01(1 - Math.min(g.n_safety_liabilities, 5) / 10) : 1;
      return {
        formula: 'Product of three factors: LoF tolerance × essentiality penalty × liability penalty (a lower score = more risk).',
        metrics: [
          { label: 'gnomAD LOEUF', value: num(g.loeuf), sub: loeufTol, role: 'factor', kind: 'fact', note: 'Loss-of-function constraint; higher = tolerates LoF = safer to drug. Scaled ÷1.5.' },
          { label: 'Pan-essential (common)', value: g.is_common_essential == null ? null : (g.is_common_essential ? 'yes' : 'no'), sub: g.is_common_essential != null ? essPenalty : null, role: 'factor', kind: 'fact', note: 'Essential across most cell lines → toxicity risk. Applies a ×0.5 penalty when true.' },
          { label: 'Safety liabilities', value: g.n_safety_liabilities != null ? String(g.n_safety_liabilities) : null, sub: g.n_safety_liabilities != null ? liabPenalty : null, role: 'factor', kind: 'fact', note: 'Curated Open Targets safety flags; each trims the score (penalty = 1 − min(n,5)/10).' },
          { label: 'Target class', value: g.target_class || null, role: 'context', kind: 'fact', note: 'Protein family — context for interpreting the liabilities.' },
        ],
      };
    }
    case 'clinical': {
      const phase = g.max_disease_phase != null ? clamp01(g.max_disease_phase / 4) : null;
      const trials = g.n_disease_trials != null ? clamp01(Math.min(g.n_disease_trials, 10) / 10) : null;
      let byPhase: string | null = null;
      const tbp = g.trials_by_phase;
      if (tbp && typeof tbp === 'object') { const parts = Object.entries(tbp).filter(([, v]) => Number(v) > 0).map(([k, v]) => `P${k}: ${v}`); byPhase = parts.length ? parts.join(' · ') : null; }
      return {
        formula: 'Weighted mean of trial phase reached and trial count (60/40). Phase ÷4, count capped at 10.',
        metrics: [
          { label: 'Max disease trial phase', value: g.max_disease_phase != null ? `Phase ${g.max_disease_phase}` : null, sub: phase, role: 'term', weightPct: 60, kind: 'fact', note: 'Furthest clinical phase reached by any drug for this target in this disease.' },
          { label: 'Disease trials', value: g.n_disease_trials != null ? String(g.n_disease_trials) : null, sub: trials, role: 'term', weightPct: 40, kind: 'fact', note: 'Number of trials for this target in this disease (ClinicalTrials.gov via OT).' },
          { label: 'Trials by phase', value: byPhase, role: 'context', kind: 'fact', note: 'Distribution of trials across phases.' },
          { label: 'Stopped trials', value: g.n_stopped_trials != null ? String(g.n_stopped_trials) : null, role: 'context', kind: 'fact', note: 'Trials halted — a caution signal (context only, not scored).' },
        ],
      };
    }
    case 'literature': return {
      formula: 'Publication velocity mapped to 0–1 — recent research momentum for the gene in this disease.',
      metrics: [
        { label: 'Publication velocity', value: pct(g.velocity), sub: g.velocity != null ? clamp01(g.velocity) : null, role: 'term', weightPct: 100, kind: 'fact', note: 'Europe PMC — recent publication rate (novelty-fair: absence isn’t punished elsewhere).' },
        { label: 'Publications', value: g.n_publications != null ? String(g.n_publications) : null, role: 'context', kind: 'fact', note: 'Total papers linking the gene to this disease.' },
        { label: 'Patents', value: g.n_patents != null ? String(g.n_patents) : null, role: 'context', kind: 'fact', note: 'Patent count mentioning the gene (context only).' },
      ],
    };
    case 'network': return {
      formula: 'WINNER network centrality mapped to 0–1 — proximity/importance over the STRING PPI graph.',
      metrics: [
        { label: 'WINNER score', value: num(g.winner_score), sub: g.winner_score != null ? clamp01(g.winner_score) : null, role: 'term', weightPct: 100, kind: 'prediction', note: 'RWR-based centrality/proximity to the disease seed genes over STRING (top-2000 only).' },
        { label: 'RWR score', value: num(g.rwr_score, 4), role: 'context', kind: 'prediction', note: 'Random-walk-with-restart proximity to the seed set.' },
        { label: 'Seed gene', value: g.is_seed == null ? null : (g.is_seed ? 'yes' : 'no'), role: 'context', kind: 'fact', note: 'Whether the gene is itself one of the disease seed genes.' },
      ],
    };
  }
}

export interface ScoredGene {
  symbol: string; boardRank: number; sourceRank: number | null;
  criteria: Record<CriterionKey, number | null>;
  overall: number;          // 0–1 weighted sum over present criteria (missing = 0)
  display: number;          // 0–100, leader = 100
  coverage: number;         // # of the weighted criteria with data (breadth)
  gated: boolean; gateNote?: string;
  raw: any;                 // the original row (for the evidence drill-down)
}

// ── F1.1 Verdict ─────────────────────────────────────────────────────────────
// Turn a scored target into a plain-language decision: what tier it's in, what it
// leads on, and what holds it back — derived from the SAME field-standing math the
// report-card bars use (rel = value ÷ field-leader), weighted by the ACTIVE weights,
// so the callouts reflect what actually moves the score for the current modality.
// Pure + exported so the on-screen card and the generated report share one source.
export type VerdictTone = 'top' | 'strong' | 'mid' | 'low';
export interface TargetVerdict {
  rank: number; total: number; pctTop: number;   // pctTop: 0 = best, 1 = worst
  tier: string; tone: VerdictTone; isTop: boolean;
  strengths: string[]; drags: string[]; gaps: string[];
}
export function computeVerdict(
  selected: ScoredGene,
  total: number,
  activeKeys: CriterionKey[],
  weights: Record<CriterionKey, number>,
  criterionMax: Record<CriterionKey, number>,
): TargetVerdict {
  const N = total || 1;
  const rank = selected.boardRank;
  const pctTop = rank / N;
  let tier: string, tone: VerdictTone;
  if (rank <= Math.max(1, N * 0.01))      { tier = 'Top-tier candidate'; tone = 'top'; }
  else if (rank <= N * 0.10)              { tier = 'Strong candidate';   tone = 'strong'; }
  else if (rank <= N * 0.33)              { tier = 'Upper mid-field';    tone = 'mid'; }
  else if (rank <= N * 0.66)              { tier = 'Mid-field';          tone = 'mid'; }
  else                                    { tier = 'Lower tier';         tone = 'low'; }

  const labelOf = (k: CriterionKey) => CRITERIA.find(c => c.key === k)?.label || k;
  const rel = (k: CriterionKey): number | null => {
    const raw = selected.criteria[k];
    return raw == null || !isFinite(raw) ? null : Math.max(0, Math.min(1, raw / (criterionMax[k] || 1)));
  };
  const rows = activeKeys.map(k => ({ k, label: labelOf(k), rel: rel(k), w: weights[k] || 0, missing: selected.criteria[k] == null }));

  const WT = 0.05;   // ignore criteria carrying <5% of the active budget — they don't move the verdict
  const strengths = rows.filter(r => !r.missing && (r.rel ?? 0) >= 0.6 && r.w >= WT)
    .sort((a, b) => ((b.rel ?? 0) * b.w) - ((a.rel ?? 0) * a.w)).slice(0, 3).map(r => r.label);
  const drags = rows.filter(r => !r.missing && (r.rel ?? 1) < 0.4 && r.w >= WT)
    .sort((a, b) => (1 - (b.rel ?? 0)) * b.w - (1 - (a.rel ?? 0)) * a.w).slice(0, 3).map(r => r.label);
  const gaps = rows.filter(r => r.missing && r.w >= WT).sort((a, b) => b.w - a.w).slice(0, 2).map(r => r.label);

  return { rank, total: N, pctTop, tier, tone, isTop: tone === 'top' || tone === 'strong', strengths, drags, gaps };
}

// ── F1.2 Better alternatives ─────────────────────────────────────────────────
// "Are there better targets than X, and why?" — the comparable targets that OUTRANK
// the selected one, found through two lenses the user chose: same protein family
// (target_class) and STRING network neighbours. Modality-eligibility is already baked
// in: `scored` is built for the current modality, so gated targets have sunk. For each
// alternative we surface the criteria on which it beats the selected target (the "why").
// Pure + exported so the card and the generated report share one source of truth.
export interface Alternative {
  symbol: string; boardRank: number; display: number;
  tags: Array<'family' | 'network'>;
  wins: string[];   // criteria labels where this alternative out-scores the selected target
  targetClass: string | null;
}
export function findBetterAlternatives(
  selected: ScoredGene,
  scored: ScoredGene[],
  activeKeys: CriterionKey[],
  opts: { neighbors?: Set<string>; limit?: number; minDelta?: number } = {},
): Alternative[] {
  const limit = opts.limit ?? 5;
  const minDelta = opts.minDelta ?? 0.12;
  const neighbors = opts.neighbors ?? new Set<string>();
  const norm = (v: any) => String(v ?? '').trim().toLowerCase();
  const selClass = norm(selected.raw?.target_class);
  const labelOf = (k: CriterionKey) => CRITERIA.find(c => c.key === k)?.label || k;

  const out: Alternative[] = [];
  for (const s of scored) {
    if (s.symbol === selected.symbol || s.gated || s.boardRank >= selected.boardRank) continue;
    const tags: Array<'family' | 'network'> = [];
    if (selClass && norm(s.raw?.target_class) === selClass) tags.push('family');
    if (neighbors.has(s.symbol.toUpperCase())) tags.push('network');
    if (tags.length === 0) continue;
    const wins = activeKeys
      .map(k => ({ label: labelOf(k), d: (s.criteria[k] ?? 0) - (selected.criteria[k] ?? 0) }))
      .filter(x => x.d > minDelta).sort((a, b) => b.d - a.d).slice(0, 6).map(x => x.label);
    out.push({ symbol: s.symbol, boardRank: s.boardRank, display: s.display, tags, wins, targetClass: s.raw?.target_class ?? null });
  }
  return out.sort((a, b) => a.boardRank - b.boardRank).slice(0, limit);
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
  criterionMax: Record<CriterionKey, number>;   // field-leader value per criterion — DISPLAY normalization only (not scoring)
  activeCriteria: CriterionKey[];               // criteria with data in THIS snapshot (e.g. no dependency for a non-cancer disease)
  criterionCoverage: Record<CriterionKey, number>;
} {
  const profile = MODALITY_PROFILES[modality];
  const rawW = weightOverride || profile.weights;

  // Score every gene once, then measure per-criterion coverage across the whole field.
  const allCriteria = genes.map(g => criterionScores(g));
  const criterionCoverage = {} as Record<CriterionKey, number>;
  for (const c of CRITERIA) { let n = 0; for (const sc of allCriteria) if (sc[c.key] != null) n++; criterionCoverage[c.key] = n; }

  // ACTIVE = criteria that actually have data in this snapshot AND carry weight. A criterion that
  // is empty for EVERY gene (e.g. dependency for a non-cancer disease like Alzheimer's) is dropped
  // entirely: hidden from the UI and removed from the weight budget, which is renormalised over the
  // remaining criteria. Because the axis was absent for the whole field, this does NOT change the
  // ranking (it rescales every score by the same factor) — it just stops a dead axis wasting budget.
  const activeCriteria = CRITERIA.filter(c => criterionCoverage[c.key] > 0).map(c => c.key);
  const activeSum = activeCriteria.reduce((s, k) => s + Math.max(0, rawW[k] || 0), 0) || 1;
  const weights = {} as Record<CriterionKey, number>;
  for (const c of CRITERIA) weights[c.key] = activeCriteria.includes(c.key) ? Math.max(0, rawW[c.key] || 0) / activeSum : 0;

  const pre = genes.map((g, i) => {
    const criteria = allCriteria[i];
    const gated = !!(profile.gate && !profile.gate(g));
    // Weighted mean over the ACTIVE criteria, where CORE and CONTEXT criteria treat absence
    // differently — which is the whole novelty-fairness rule, and was previously stated in the
    // comments but not implemented:
    //
    //   CORE (genetics, expression, dependency, tractability, safety) — a missing one is a
    //   real evidence gap. Its weight STAYS in the denominator, so the target is penalised.
    //
    //   CONTEXT (clinical, literature, network) — these reward ATTENTION. A first-in-class
    //   target has no trials and few papers, and docking it for that buries exactly the
    //   targets this tool exists to surface. A missing one is dropped from the denominator,
    //   so it is neutral rather than a zero.
    //
    // A target with complete evidence is unaffected: the denominator is the full active
    // weight budget, so its score is identical to the previous behaviour.
    let num = 0, den = 0, coverage = 0;
    for (const c of CRITERIA) {
      const v = criteria[c.key], w = weights[c.key];
      if (w <= 0) continue;
      const isCore = CORE_CRITERIA.has(c.key);
      if (v != null) { num += v * w; den += w; coverage++; }
      else if (isCore) { den += w; }            // core gap: counted against the target
      // context gap: neither numerator nor denominator — genuinely neutral
    }
    let overall = den > 0 ? num / den : 0;
    if (gated) overall *= 0.05;                       // ineligible → sink, but a gate must gate (sorted last below)
    return { symbol: g.gene_symbol, sourceRank: g.rank ?? null, criteria, overall, coverage, gated, gateNote: gated ? profile.gateNote : undefined, raw: g };
  });

  const leader = pre.reduce((m, x) => Math.max(m, x.gated ? 0 : x.overall), 0) || 1;   // leader is an ELIGIBLE gene
  const scored = pre
    // A gate must GATE: ineligible targets always sort below every eligible one, then by score.
    .sort((a, b) => (a.gated ? 1 : 0) - (b.gated ? 1 : 0) || b.overall - a.overall)
    .map((x, i) => ({ ...x, boardRank: i + 1, display: Math.round(100 * Math.min(x.overall, leader) / leader) }));

  // Per-criterion field maximum — used ONLY to normalise the bars for display, so the
  // strongest gene in each column fills its bar (genetics tops out ~0.26 in absolute terms
  // and otherwise reads as "low" even for the field leader). Never feeds the overall score.
  const criterionMax = {} as Record<CriterionKey, number>;
  for (const c of CRITERIA) {
    let mx = 0;
    for (const p of pre) { const v = p.criteria[c.key]; if (v != null && isFinite(v) && v > mx) mx = v; }
    criterionMax[c.key] = mx > 0 ? mx : 1;
  }
  return { scored, weights, profile, criterionMax, activeCriteria, criterionCoverage };
}
