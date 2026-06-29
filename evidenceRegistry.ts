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
}

// The tier ladder — Linked → Dysregulated → Needed → Druggable → Safe → Worth it → Ranked.
// Each `filter.field` is the RAW value (in real units) the funnel filters on; `axis`
// (a normalized 0–1) is used only for ranking/composite.
export const AXES: AxisDef[] = [
  { key: 'genetic', tier: 1, label: 'Genetic association', question: 'Is it genetically linked to the disease?', type: 'hard', source: 'Open Targets', color: '#2563eb', evidenceType: null, direction: 'pro', weight: 1.0, headline: true,
    filter: { kind: 'range', field: 'genetic', unit: 'OT score', min: 0, max: 1, step: 0.01, default: 0, op: '>=' } },
  { key: 'mutation', tier: 2, label: 'Somatic mutation', question: 'Is it recurrently mutated in the tumor?', type: 'hard', source: 'cBioPortal', color: '#dc2626', evidenceType: 'mutation', direction: 'pro', weight: 0.8, headline: true,
    filter: { kind: 'range', field: 'frequency', unit: 'freq', min: 0, max: 1, step: 0.01, default: 0, op: '>=' } },
  { key: 'dysregulation', tier: 3, label: 'Dysregulation', question: 'Is it abnormally expressed in the tumor?', type: 'hard', source: 'TCGA / GTEx', color: '#0d9488', evidenceType: 'expression_tvn', direction: 'pro', weight: 1.0, headline: true,
    filter: { kind: 'range', field: 'log2fc', unit: 'log2FC', min: -4, max: 8, step: 0.1, default: 0, op: '>=' } },
  { key: 'dependency', tier: 4, label: 'Dependency', question: 'Does the tumor need it to survive?', type: 'hard', source: 'DepMap CRISPR', color: '#7c3aed', evidenceType: 'dependency', direction: 'pro', weight: 1.0, headline: true,
    filter: { kind: 'range', field: 'chronos', unit: 'Chronos', min: -3, max: 1, step: 0.05, default: 1, op: '<=' } },
  { key: 'druggability', tier: 5, label: 'Druggability', question: 'Can we drug it?', type: 'hard', source: 'ChEMBL', color: '#4f46e5', evidenceType: 'druggability', direction: 'pro', weight: 1.0, headline: true,
    filter: { kind: 'category', categories: ['Clinically Validated', 'In Clinical Development', 'Preclinical Only', 'No Drug Data Found'] } },
  { key: 'safety', tier: 6, label: 'Safety / constraint', question: 'Is it safe to drug, or essential to healthy cells?', type: 'hard', source: 'gnomAD', color: '#d97706', evidenceType: 'safety', direction: 'con', weight: 0.6, headline: true,
    filter: { kind: 'range', field: 'loeuf', unit: 'LOEUF', min: 0, max: 2, step: 0.05, default: 0, op: '>=' } },
  { key: 'clinical', tier: 7, label: 'Clinical landscape', question: 'Is there trial activity / room?', type: 'soft', source: 'ClinicalTrials.gov', color: '#16a34a', evidenceType: 'clinical', direction: 'pro', weight: 0.75, headline: true,
    filter: { kind: 'range', field: 'trial_count', unit: 'trials', min: 0, max: 50, step: 1, default: 0, op: '>=' } },
  { key: 'literature', tier: 8, label: 'Literature signal', question: 'Is interest established / rising?', type: 'soft', source: 'PubMed / PubTator', color: '#0ea5e9', evidenceType: 'literature', direction: 'pro', weight: 0.75, headline: true,
    filter: { kind: 'range', field: 'velocity', unit: 'velocity', min: 0, max: 1, step: 0.01, default: 0, op: '>=' } },
  // Modifier — feeds the composite but is not its own tier card.
  { key: 'tissue', tier: 0, label: 'Tissue specificity', question: '', type: 'soft', source: 'Protein Atlas', color: '#64748b', evidenceType: null, direction: 'pro', weight: 0.5, headline: false,
    filter: { kind: 'none' } },
];

export const HEADLINE_AXES = AXES.filter(a => a.headline);
export const HARD_AXES = AXES.filter(a => a.type === 'hard' && a.headline);
export const COMPOSITE_AXES = AXES; // every axis with data informs the composite
