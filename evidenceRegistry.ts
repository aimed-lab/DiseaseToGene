// evidenceRegistry.ts ──────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the funnel's tier gates / evidence axes.
//
// Each entry describes an axis ONCE: how to rank it, how to FILTER it, which
// stored evidence powers it, and where it sits in the tier ladder. The funnel,
// the Gene×Source matrix, and (later) the harvest writer all read this list — so
// adding a new evidence source is ONE entry here (+ the harvest writing its row).
//
// The value_json "contract" every EVIDENCE row should carry, on top of its raw
// measurements:
//     { axis: 0..1, direction: 'pro' | 'con', display: string, ...raw fields }
//   • axis      — normalized magnitude the funnel ranks on (it rank-normalizes
//                 across survivors, so this is just the raw signal strength)
//   • direction — 'pro' = a high value argues FOR the target; 'con' = AGAINST
//   • display   — a short human string for the matrix / target card
// Keeping the raw fields too means real-unit filters (log2FC, LOEUF, trials…)
// always have the actual numbers to work with.

export type Direction = 'pro' | 'con';
export type GateType = 'hard' | 'soft';
export type FilterKind = 'range' | 'category' | 'boolean' | 'none';
// Acquisition cost of the evidence (how expensive it is to HARVEST, not to read —
// every stored axis reads in ~ms). This is what orders the tier ladder: cheap first.
//   ms   = local reference table / one batched API call
//   sec  = live per-gene or bulk API sweep
//   min  = structure/compute step (e.g. pocket analysis)
//   days = experimental / wet-lab validation
export type CostClass = 'ms' | 'sec' | 'min' | 'days';

export interface FilterDef {
  kind: FilterKind;
  field?: string;                // raw value_json field to filter on, in REAL units
                                 // (e.g. 'log2fc', 'loeuf', 'chronos'); the funnel
                                 // filters on this, not on the normalized axis.
  unit?: string;                 // label shown next to the control, e.g. "log2FC"
  min?: number; max?: number; step?: number; default?: number;
  op?: '>=' | '<=';              // keep genes whose raw value is ≥ / ≤ the threshold
  categories?: string[];         // for kind:'category'
  presets?: { label: string; value: number }[];  // hand-picked named cut-offs for the
                                 // funnel dropdown — overrides the generic linear presets
                                 // (which are blind to each axis's real distribution).
  percent?: boolean;             // display the raw 0..1 value as a % in the UI (raw stays 0..1)
}

export interface AxisDef {
  key: string;                   // stable id; also the funnel feature field name
  tier: number;                  // position in the ladder (T1..T8); 0 = modifier only
  cost: CostClass;               // acquisition cost — the ladder is ordered by this (cheap first)
  label: string;
  question: string;
  type: GateType;                // hard = narrows the universe; soft = ranks only
  source: string;                // human-readable data source
  color: string;                 // ONE calm blue for every tier (the funnel reads as a single
                                 // flow, not 8 competing categories). Color marks focus/active
                                 // state, not identity — the tier number + label carry identity.
                                 // Modifiers (non-tier) use a recessive gray.
  evidenceType: string | null;   // EVIDENCE.evidence_type powering it (null = RANKING_SCORES)
  direction: Direction;          // pro = high good; con = high is a reason against
  weight: number;                // composite weight
  filter: FilterDef;
  headline: boolean;             // true = its own tier card; false = composite-only modifier
  measures?: string;             // plain-English: what the raw value represents (UI explainer)
  provenance?: string;           // dataset + how the value is actually computed (UI explainer)
  caveat?: string;               // optional caution shown in the tier explainer
}

// The tier ladder is ordered by ACQUISITION COST (cheapest evidence first): local
// reference tables / one batched call (ms) come before live per-gene API sweeps (sec).
// Order is presentational only — the v2 engine is order-independent (OR eligibility +
// weighted sum), so reordering tiers never changes which genes are eligible or how they
// rank. Each axis keeps its own tier. `filter.field` is the RAW value the funnel filters on.
export const AXES: AxisDef[] = [
  // ── ms — local reference table / one batched call ──
  { key: 'genetic', tier: 1, cost: 'ms', label: 'Genetic association', question: 'Is it genetically linked to the disease?', type: 'hard', source: 'Open Targets', color: '#2a78d6', evidenceType: null, direction: 'pro', weight: 1.0, headline: true,
    measures: 'Open Targets genetic-association score (0-1): how strongly inherited / germline genetic evidence ties this gene to the disease.',
    provenance: 'Open Targets Platform — associatedTargets, genetic_association datatype (GWAS catalog, ClinVar, gene-burden, etc.).',
    caveat: 'For somatic-driven cancers like pancreatic, most genes (incl. KRAS/TP53) score ~0 here — the real driver signal is in Somatic mutation. Leave this gate off unless you specifically want germline-linked genes.',
    filter: { kind: 'range', field: 'genetic', unit: 'OT score', min: 0, max: 1, step: 0.01, default: 0, op: '>=',
      presets: [{ label: 'Any', value: 0 }, { label: 'Some link', value: 0.05 }, { label: 'Moderate', value: 0.2 }, { label: 'Strong', value: 0.5 }] } },
  { key: 'safety', tier: 2, cost: 'ms', label: 'Safety / constraint', question: 'Is it safe to drug, or essential to healthy cells?', type: 'hard', source: 'gnomAD', color: '#2a78d6', evidenceType: 'safety', direction: 'con', weight: 0.6, headline: true,
    measures: 'gnomAD LOEUF — loss-of-function tolerance. Low LOEUF = gene is constrained (healthy humans cannot lose it) = higher knockdown-toxicity risk.',
    provenance: 'gnomAD v4.1 constraint, MANE Select transcript; LOEUF = lof.oe_ci.upper.',
    caveat: 'This counts AGAINST a target (con) and inverts in the ranking. Many excellent oncology targets (KRAS, EGFR) are constrained — treat as a caution flag, not a hard cut. A strict gate here can remove valid targets.',
    filter: { kind: 'range', field: 'loeuf', unit: 'LOEUF', min: 0, max: 2, step: 0.05, default: 0, op: '>=',
      presets: [{ label: 'Any', value: 0 }, { label: 'Drop extreme constraint', value: 0.35 }, { label: 'Tolerant only', value: 0.6 }, { label: 'Highly tolerant', value: 1.0 }] } },
  { key: 'dependency', tier: 3, cost: 'ms', label: 'Dependency', question: 'Does the tumor need it to survive?', type: 'hard', source: 'DepMap CRISPR', color: '#2a78d6', evidenceType: 'dependency', direction: 'pro', weight: 1.0, headline: true,
    measures: 'DepMap CRISPR Chronos score. More negative = cancer cell lines depend on this gene to survive.',
    provenance: 'DepMap (Chronos) — pancreatic cell lines; mean score across lines + % dependent lines.',
    filter: { kind: 'range', field: 'chronos', unit: 'Chronos', min: -3, max: 1, step: 0.05, default: 1, op: '<=',
      presets: [{ label: 'Any', value: 1 }, { label: 'Depleted', value: -0.5 }, { label: 'Dependency', value: -1 }, { label: 'Strong dependency', value: -1.5 }] } },
  { key: 'dysregulation', tier: 4, cost: 'ms', label: 'Dysregulation', question: 'Is it abnormally expressed in the tumor?', type: 'hard', source: 'TCGA / GTEx', color: '#2a78d6', evidenceType: 'expression_tvn', direction: 'pro', weight: 1.0, headline: true,
    measures: 'log2 fold-change of tumor vs normal expression. Positive = over-expressed in tumor.',
    provenance: 'UCSC Xena Toil — TCGA-PAAD tumors vs GTEx normal pancreas (median-based log2FC).',
    caveat: 'The gate keeps over-expressed genes (log2FC >=). Tumour-suppressor losses (strongly negative) are dysregulated too but a >= threshold drops them — set it deliberately.',
    filter: { kind: 'range', field: 'log2fc', unit: 'log2FC', min: -4, max: 8, step: 0.1, default: 0, op: '>=',
      presets: [{ label: 'Any', value: 0 }, { label: 'Up-regulated (2x)', value: 1 }, { label: 'Strongly up (4x)', value: 2 }, { label: 'Extreme (8x)', value: 3 }] } },
  // ── sec — live per-gene / bulk API sweep ──
  { key: 'literature', tier: 5, cost: 'sec', label: 'Literature signal', question: 'Is interest established / rising?', type: 'soft', source: 'PubMed', color: '#2a78d6', evidenceType: 'literature', direction: 'pro', weight: 0.75, headline: true,
    measures: 'Publication velocity — share of this target\'s disease-relevant papers published in the last ~3 years (momentum).',
    provenance: 'PubMed E-utilities gene x disease query; recent_count / paper_count. Europe PMC stored alongside.',
    caveat: 'Soft tier: by default it ranks rather than gates. Measures attention / momentum, not biological strength.',
    filter: { kind: 'range', field: 'velocity', unit: 'velocity', min: 0, max: 1, step: 0.01, default: 0, op: '>=', percent: true,
      presets: [{ label: 'Any', value: 0 }, { label: 'Some momentum', value: 0.2 }, { label: 'Rising', value: 0.4 }, { label: 'Hot', value: 0.6 }] } },
  { key: 'mutation', tier: 6, cost: 'sec', label: 'Somatic mutation', question: 'Is it recurrently mutated in the tumor?', type: 'hard', source: 'cBioPortal', color: '#2a78d6', evidenceType: 'mutation', direction: 'pro', weight: 0.8, headline: true,
    measures: 'Fraction of tumor samples in the cohort that carry a mutation in this gene (0-1).',
    provenance: 'cBioPortal — disease-matched cohort; mutated_samples / total_samples, with the dominant variant.',
    filter: { kind: 'range', field: 'frequency', unit: 'freq', min: 0, max: 1, step: 0.01, default: 0, op: '>=', percent: true,
      presets: [{ label: 'Any', value: 0 }, { label: 'Recurrent', value: 0.02 }, { label: 'Frequent', value: 0.05 }, { label: 'Driver-level', value: 0.20 }] } },
  { key: 'druggability', tier: 7, cost: 'sec', label: 'Druggability', question: 'Can we drug it?', type: 'hard', source: 'ChEMBL', color: '#2a78d6', evidenceType: 'druggability', direction: 'pro', weight: 1.0, headline: true,
    measures: 'Whether tractable chemical matter exists, bucketed by clinical maturity.',
    provenance: 'ChEMBL — bioactivities, target max clinical phase and compound counts -> category label.',
    filter: { kind: 'category', categories: ['Clinically Validated', 'In Clinical Development', 'Preclinical Only', 'No Drug Data Found'] } },
  { key: 'clinical', tier: 8, cost: 'sec', label: 'Clinical landscape', question: 'Is there trial activity / room?', type: 'soft', source: 'ClinicalTrials.gov', color: '#2a78d6', evidenceType: 'clinical', direction: 'pro', weight: 0.75, headline: true,
    measures: 'Number of disease-scoped clinical trials naming this target, and the max phase reached.',
    provenance: 'ClinicalTrials.gov — interventional trials matching gene x disease (genes with 0 trials are not stored).',
    caveat: 'Soft tier: by default it ranks rather than gates. High counts mean a crowded / validated space — read as "activity", not necessarily "room".',
    filter: { kind: 'range', field: 'trial_count', unit: 'trials', min: 0, max: 50, step: 1, default: 0, op: '>=',
      presets: [{ label: 'Any', value: 0 }, { label: 'Has a trial', value: 1 }, { label: 'Active', value: 3 }, { label: 'Busy', value: 10 }] } },
  // Modifier — feeds the composite but is not its own tier card.
  { key: 'tissue', tier: 0, cost: 'ms', label: 'Tissue specificity', question: '', type: 'soft', source: 'Protein Atlas', color: '#94a3b8', evidenceType: null, direction: 'pro', weight: 0.5, headline: false,
    measures: 'Tissue specificity (tau) — how selectively the gene is expressed in the target tissue.',
    provenance: 'Human Protein Atlas — tau across tissues.',
    filter: { kind: 'none' } },
];

export const HEADLINE_AXES = AXES.filter(a => a.headline);
export const HARD_AXES = AXES.filter(a => a.type === 'hard' && a.headline);
export const COMPOSITE_AXES = AXES; // every axis with data informs the composite
