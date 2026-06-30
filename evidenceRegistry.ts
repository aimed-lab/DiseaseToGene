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

export interface FilterDef {
  kind: FilterKind;
  field?: string;                // raw value_json field to filter on, in REAL units
                                 // (e.g. 'log2fc', 'loeuf', 'chronos'); the funnel
                                 // filters on this, not on the normalized axis.
  unit?: string;                 // label shown next to the control, e.g. "log2FC"
  min?: number; max?: number; step?: number; default?: number;
  op?: '>=' | '<=';              // keep genes whose raw value is ≥ / ≤ the threshold
  categories?: string[];         // for kind:'category'
}

export interface AxisDef {
  key: string;                   // stable id; also the funnel feature field name
  tier: number;                  // position in the ladder (T1..T8); 0 = modifier only
  label: string;
  question: string;
  type: GateType;                // hard = narrows the universe; soft = ranks only
  source: string;                // human-readable data source
  color: string;                 // matches the gene drill-down panel colours
  evidenceType: string | null;   // EVIDENCE.evidence_type powering it (null = RANKING_SCORES)
  direction: Direction;          // pro = high good; con = high is a reason against
  weight: number;                // composite weight
  filter: FilterDef;
  headline: boolean;             // true = its own tier card; false = composite-only modifier
  measures?: string;             // plain-English: what the raw value represents (UI explainer)
  provenance?: string;           // dataset + how the value is actually computed (UI explainer)
  caveat?: string;               // optional caution shown in the tier explainer
}

// The tier ladder — Linked → Dysregulated → Needed → Druggable → Safe → Worth it → Ranked.
// Each `filter.field` is the RAW value (in real units) the funnel filters on; `axis`
// (a normalized 0–1) is used only for ranking/composite.
export const AXES: AxisDef[] = [
  { key: 'genetic', tier: 1, label: 'Genetic association', question: 'Is it genetically linked to the disease?', type: 'hard', source: 'Open Targets', color: '#2563eb', evidenceType: null, direction: 'pro', weight: 1.0, headline: true,
    measures: 'Open Targets genetic-association score (0-1): how strongly inherited / germline genetic evidence ties this gene to the disease.',
    provenance: 'Open Targets Platform — associatedTargets, genetic_association datatype (GWAS catalog, ClinVar, gene-burden, etc.).',
    caveat: 'For somatic-driven cancers like pancreatic, most genes (incl. KRAS/TP53) score ~0 here — the real driver signal is in Somatic mutation (T2). Leave this gate off unless you specifically want germline-linked genes.',
    filter: { kind: 'range', field: 'genetic', unit: 'OT score', min: 0, max: 1, step: 0.01, default: 0, op: '>=' } },
  { key: 'mutation', tier: 2, label: 'Somatic mutation', question: 'Is it recurrently mutated in the tumor?', type: 'hard', source: 'cBioPortal', color: '#dc2626', evidenceType: 'mutation', direction: 'pro', weight: 0.8, headline: true,
    measures: 'Fraction of tumor samples in the cohort that carry a mutation in this gene (0-1).',
    provenance: 'cBioPortal — disease-matched cohort; mutated_samples / total_samples, with the dominant variant.',
    filter: { kind: 'range', field: 'frequency', unit: 'freq', min: 0, max: 1, step: 0.01, default: 0, op: '>=' } },
  { key: 'dysregulation', tier: 3, label: 'Dysregulation', question: 'Is it abnormally expressed in the tumor?', type: 'hard', source: 'TCGA / GTEx', color: '#0d9488', evidenceType: 'expression_tvn', direction: 'pro', weight: 1.0, headline: true,
    measures: 'log2 fold-change of tumor vs normal expression. Positive = over-expressed in tumor.',
    provenance: 'UCSC Xena Toil — TCGA-PAAD tumors vs GTEx normal pancreas (median-based log2FC).',
    caveat: 'The gate keeps over-expressed genes (log2FC >=). Tumour-suppressor losses (strongly negative) are dysregulated too but a >= threshold drops them — set it deliberately.',
    filter: { kind: 'range', field: 'log2fc', unit: 'log2FC', min: -4, max: 8, step: 0.1, default: 0, op: '>=' } },
  { key: 'dependency', tier: 4, label: 'Dependency', question: 'Does the tumor need it to survive?', type: 'hard', source: 'DepMap CRISPR', color: '#7c3aed', evidenceType: 'dependency', direction: 'pro', weight: 1.0, headline: true,
    measures: 'DepMap CRISPR Chronos score. More negative = cancer cell lines depend on this gene to survive.',
    provenance: 'DepMap (Chronos) — pancreatic cell lines; mean score across lines + % dependent lines.',
    filter: { kind: 'range', field: 'chronos', unit: 'Chronos', min: -3, max: 1, step: 0.05, default: 1, op: '<=' } },
  { key: 'druggability', tier: 5, label: 'Druggability', question: 'Can we drug it?', type: 'hard', source: 'ChEMBL', color: '#4f46e5', evidenceType: 'druggability', direction: 'pro', weight: 1.0, headline: true,
    measures: 'Whether tractable chemical matter exists, bucketed by clinical maturity.',
    provenance: 'ChEMBL — bioactivities, target max clinical phase and compound counts -> category label.',
    filter: { kind: 'category', categories: ['Clinically Validated', 'In Clinical Development', 'Preclinical Only', 'No Drug Data Found'] } },
  { key: 'safety', tier: 6, label: 'Safety / constraint', question: 'Is it safe to drug, or essential to healthy cells?', type: 'hard', source: 'gnomAD', color: '#d97706', evidenceType: 'safety', direction: 'con', weight: 0.6, headline: true,
    measures: 'gnomAD LOEUF — loss-of-function tolerance. Low LOEUF = gene is constrained (healthy humans cannot lose it) = higher knockdown-toxicity risk.',
    provenance: 'gnomAD v4.1 constraint, MANE Select transcript; LOEUF = lof.oe_ci.upper.',
    caveat: 'This counts AGAINST a target (con) and inverts in the ranking. Many excellent oncology targets (KRAS, EGFR) are constrained — treat as a caution flag, not a hard cut. A strict gate here can remove valid targets.',
    filter: { kind: 'range', field: 'loeuf', unit: 'LOEUF', min: 0, max: 2, step: 0.05, default: 0, op: '>=' } },
  { key: 'clinical', tier: 7, label: 'Clinical landscape', question: 'Is there trial activity / room?', type: 'soft', source: 'ClinicalTrials.gov', color: '#16a34a', evidenceType: 'clinical', direction: 'pro', weight: 0.75, headline: true,
    measures: 'Number of disease-scoped clinical trials naming this target, and the max phase reached.',
    provenance: 'ClinicalTrials.gov — interventional trials matching gene x disease (genes with 0 trials are not stored).',
    caveat: 'Soft tier: by default it ranks rather than gates. High counts mean a crowded / validated space — read as "activity", not necessarily "room".',
    filter: { kind: 'range', field: 'trial_count', unit: 'trials', min: 0, max: 50, step: 1, default: 0, op: '>=' } },
  { key: 'literature', tier: 8, label: 'Literature signal', question: 'Is interest established / rising?', type: 'soft', source: 'PubMed', color: '#0ea5e9', evidenceType: 'literature', direction: 'pro', weight: 0.75, headline: true,
    measures: 'Publication velocity — share of this target\'s disease-relevant papers published in the last ~3 years (momentum).',
    provenance: 'PubMed E-utilities gene x disease query; recent_count / paper_count. Europe PMC stored alongside.',
    caveat: 'Soft tier: by default it ranks rather than gates. Measures attention / momentum, not biological strength.',
    filter: { kind: 'range', field: 'velocity', unit: 'velocity', min: 0, max: 1, step: 0.01, default: 0, op: '>=' } },
  // Modifier — feeds the composite but is not its own tier card.
  { key: 'tissue', tier: 0, label: 'Tissue specificity', question: '', type: 'soft', source: 'Protein Atlas', color: '#64748b', evidenceType: null, direction: 'pro', weight: 0.5, headline: false,
    measures: 'Tissue specificity (tau) — how selectively the gene is expressed in the target tissue.',
    provenance: 'Human Protein Atlas — tau across tissues.',
    filter: { kind: 'none' } },
];

export const HEADLINE_AXES = AXES.filter(a => a.headline);
export const HARD_AXES = AXES.filter(a => a.type === 'hard' && a.headline);
export const COMPOSITE_AXES = AXES; // every axis with data informs the composite
