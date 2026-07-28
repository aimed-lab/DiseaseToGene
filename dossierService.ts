// dossierService.ts ──────────────────────────────────────────────────────────
// Builds a GENE DOSSIER — a UniProt-style, categorised documentation of one target —
// from the evidence already stored in Oracle (RANKING_SCORES + EVIDENCE), plus the
// headline counts the dashboard shows: score, one-paragraph summary, developed drugs,
// clinical trials by phase, publications and patents.
//
// THREE DESIGN RULES, inherited from decisions already made in this project:
//
//  1. FACT vs PREDICTION are never mixed. Every attribute carries `level`:
//       fact       — a record of something that happened (a drug exists, a trial ran)
//       prediction — a forward-looking assessment (tractability, pocket druggability)
//       annotation — context that must never drive a score (patents, PubMed velocity)
//     This is the professor's rule from the modality work, enforced in the data model.
//
//  2. THREE-STATE confidence. `not_fetched` is distinct from a real zero — collapsing
//     the two is what produced ~336 druggability false negatives (bug #1). A missing
//     axis says "we did not look", never "there is nothing".
//
//  3. The summary is DETERMINISTIC — assembled from the stored numbers, never written
//     by a language model. Nothing in it can be present that is not in the data.
//
// PURE: no I/O, no React. Callers hand it rows; it returns the dossier.

export type EvidenceLevel = 'fact' | 'prediction' | 'annotation';
export type Confidence = 'high' | 'medium' | 'low' | 'not_fetched';

export interface DossierAttr {
  key: string;
  label: string;
  value: string | number | null;
  unit?: string | null;
  source: string;
  level: EvidenceLevel;
  confidence: Confidence;
  note?: string;
}
export interface DossierCategory {
  key: string;
  label: string;
  blurb: string;                  // what this section answers, in one line
  attrs: DossierAttr[];
}
export interface DossierHeadline {
  drugs: number | null;                 // developed drugs hitting this target
  proven_modalities: number | null;
  tractable_modalities: number | null;
  trials_total: number | null;          // trials in THIS disease
  trials_by_phase: { phase1: number; phase2: number; phase3: number; phase4: number } | null;
  max_disease_phase: number | null;
  publications: number | null;
  velocity: number | null;
  patents: number | null;
}
// Row-shaped detail the UI renders as tables. Kept out of `categories` because these are
// LISTS, not single attributes — a category renders label/value pairs, these need columns.
export interface DossierDetail {
  drugs: { name: string; modality: string | null; family: string | null; stage: string; approved: boolean }[];
  modalities: { modality: string; family: string; drugCount: number; topStage: string; approved: boolean }[];
  tractability: { modality: string; code: string; labels: string[] }[];
  trials: { id: string | null; url: string | null; phase: number; status: string | null; title: string | null;
            year: number | null; drug: string | null; why_stopped: string | null; stop_reasons: string[];
            sponsor?: string | null; collaborators?: string[]; start_date?: string | null; completion_date?: string | null;
            enrollment?: number | null; n_locations?: number; countries?: string[];
            locations?: { facility: string | null; city: string | null; state: string | null; country: string | null }[] }[];
  papers: { title: string; id: string; source: string; journal: string | null; year: string | null }[];
  safety_liabilities: { event: string | null; datasource: string | null; effects: string[] }[];
  variants: { change: string; count: number; fraction: number }[];
}
export interface GeneDossier {
  gene_symbol: string;
  disease_id: string;
  disease_name: string;
  rank: number | null;
  score: number | null;
  summary: string;
  headline: DossierHeadline;
  categories: DossierCategory[];
  detail: DossierDetail;
  completeness: { score: number; present: number; total: number; missing: string[] };
  provenance: { sources: string[]; snapshot_id: number | null; generated_at: string };
}

const num = (v: unknown): number | null => (v == null || isNaN(Number(v)) ? null : Number(v));
const safeParse = (s: unknown): any => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fx = (n: number, d = 2) => Number(n.toFixed(d));

// An axis that is absent from the evidence table was never harvested for this gene —
// report it as not_fetched, not as zero (rule 2).
const attr = (
  key: string, label: string, value: string | number | null, source: string,
  level: EvidenceLevel, opts: { unit?: string | null; confidence?: Confidence; note?: string } = {},
): DossierAttr => ({
  key, label, value, source, level,
  unit: opts.unit ?? null,
  confidence: opts.confidence ?? (value == null ? 'not_fetched' : 'high'),
  note: opts.note,
});

// The axes a complete dossier would document. Used for the completeness score, which
// exists so "evidence-sparse" is never silently read as "low quality".
const EXPECTED_AXES = [
  'disease_association', 'mutation', 'expression', 'dependency',
  'safety', 'druggability', 'clinical', 'literature',
] as const;

export interface DossierInput {
  gene_symbol: string;
  disease_id: string;
  disease_name: string;
  snapshot_id?: number | null;
  scoreRow?: Record<string, unknown> | null;      // one RANKING_SCORES row
  evidence: Array<{ evidence_type: string; value_json?: unknown; source?: unknown }>;
  patents?: { gene_patents: number; disease_patents: number } | null;   // live (not yet stored)
}

export function buildGeneDossier(input: DossierInput): GeneDossier {
  const { gene_symbol, disease_id, disease_name } = input;
  const ev: Record<string, any> = {};
  const srcOf: Record<string, string> = {};
  for (const e of input.evidence || []) {
    if (!e?.evidence_type) continue;
    ev[e.evidence_type] = safeParse(e.value_json) || {};
    srcOf[e.evidence_type] = String(e.source ?? '');
  }
  const s = input.scoreRow || {};
  const mut = ev.mutation, dys = ev.expression_tvn, dep = ev.dependency, saf = ev.safety;
  const drug = ev.druggability, clin = ev.clinical, lit = ev.literature_epmc, pm = ev.literature;
  const ann = ev.annotation, tis = ev.tissue, pat = ev.patents;

  const otOverall = num(s.get_score);
  const genetic = num(s.genetic_score);

  // SCHEMA-VERSION DETECTION. Snapshots harvested before the 2026-07 evidence fixes store
  // different meanings under the same keys, and rendering them as if they were current
  // would be actively misleading:
  //   druggability.total_compounds  legacy = a ChEMBL BIOACTIVITY count (SRC: 6,507)
  //                                 current = developed drugs from Open Targets (SRC: 8)
  //   clinical.trial_count          legacy = a CT.gov FREE-TEXT match (renin: 234)
  //                                 current = drugs with a trial in THIS disease
  // The new fields (proven_modalities / n_drugs_in_disease_trials) only exist post-fix, so
  // their absence is a reliable version marker. Legacy values are kept but demoted to
  // annotation + low confidence and excluded from the headline counters.
  const drugLegacy = !!drug && drug.proven_modalities === undefined;
  const clinLegacy = !!clin && clin.n_drugs_in_disease_trials === undefined;

  // ── categories ────────────────────────────────────────────────────────────
  const categories: DossierCategory[] = [];

  categories.push({
    key: 'identity', label: 'Identity', blurb: 'What this entry is.',
    attrs: [
      attr('symbol', 'Gene symbol', gene_symbol, 'Open Targets', 'fact'),
      attr('approved_name', 'Protein name', ann?.approved_name ?? null, 'Open Targets', 'fact'),
      attr('uniprot', 'UniProt', ann?.uniprot_id ?? null, 'Open Targets', 'fact', { note: 'Cross-reference key to UniProt / PDB.' }),
      attr('ensembl', 'Ensembl ID', ann?.ensembl_id ?? drug?.ensembl_id ?? null, 'Open Targets', 'fact'),
      attr('biotype', 'Biotype', ann?.biotype ?? null, 'Open Targets', 'fact'),
      attr('locus', 'Locus', ann?.genomic_location ?? null, 'Open Targets', 'fact'),
      attr('disease', 'Disease context', disease_name || null, 'Open Targets', 'fact'),
      attr('rank', 'Rank in snapshot', num(s.rank), 'Disease2Target', 'fact'),
    ],
  });

  // The biology narrative — what this protein actually DOES. Without it a dossier is a
  // sheet of numbers; this is the section that makes it read like a UniProt entry.
  categories.push({
    key: 'function', label: 'Function & localisation', blurb: 'What the protein does, and where it is.',
    attrs: [
      attr('target_class', 'Target class', ann?.target_class ?? null, 'Open Targets', 'fact',
        { note: 'Protein family — kinases, GPCRs and ion channels have very different modality options.' }),
      attr('function', 'Function', ann?.function_description ?? null, 'Open Targets (UniProt)', 'fact'),
      attr('locations', 'Subcellular location', Array.isArray(ann?.subcellular_locations) && ann.subcellular_locations.length ? ann.subcellular_locations.join(', ') : null, 'Open Targets', 'fact'),
      attr('surface', 'Antibody-accessible', ann ? (ann.surface_or_secreted ? 'yes — surface or secreted' : 'no — intracellular') : null, 'Open Targets', 'prediction',
        { note: 'Antibodies and ADCs can only reach surface or secreted proteins. An intracellular target needs a small molecule or a degrader.' }),
      attr('pathways', 'Pathways', Array.isArray(ann?.pathways) && ann.pathways.length ? ann.pathways.slice(0, 6).join(', ') + (ann.pathway_count > 6 ? ` (+${ann.pathway_count - 6} more)` : '') : null, 'Open Targets (Reactome)', 'fact'),
      attr('paralogs', 'Close paralogs', Array.isArray(ann?.paralogs) && ann.paralogs.length ? ann.paralogs.join(', ') : null, 'Open Targets', 'fact',
        { note: 'A close paralog can compensate for loss, which is a common reason a real target shows a weak knockout phenotype.' }),
      attr('hallmarks', 'Cancer hallmarks', Array.isArray(ann?.hallmarks) && ann.hallmarks.length ? ann.hallmarks.join(', ') : null, 'Open Targets', 'annotation'),
    ],
  });

  categories.push({
    key: 'disease_association', label: 'Disease association', blurb: 'Is it linked to the disease at all?',
    attrs: [
      attr('ot_overall', 'Open Targets association', otOverall != null ? fx(otOverall, 3) : null, 'Open Targets', 'fact',
        { note: 'Aggregate of all datatypes — used for eligibility only, never scored (it double-counts the somatic axis).' }),
      attr('genetic_association', 'Genetic association (G1)', genetic != null ? fx(genetic, 3) : null, 'Open Targets genetic_association', 'fact',
        { note: 'Germline/genetic signal only. Near zero for pure somatic drivers — that is honest, not missing.' }),
    ],
  });

  categories.push({
    key: 'mutation', label: 'Somatic mutation', blurb: 'Is it recurrently mutated in the tumour?',
    attrs: [
      attr('frequency', 'Mutation frequency', mut?.frequency != null ? pct(num(mut.frequency)!) : null, srcOf.mutation || 'cBioPortal', 'fact'),
      attr('mutated_samples', 'Mutated samples', mut ? `${mut.mutated_samples ?? '?'} / ${mut.total_samples ?? '?'}` : null, srcOf.mutation || 'cBioPortal', 'fact'),
      attr('dominant_variant', 'Dominant variant', mut?.dominant_variant ?? null, srcOf.mutation || 'cBioPortal', 'fact'),
    ],
  });

  categories.push({
    key: 'expression', label: 'Expression', blurb: 'Is it abnormally expressed in the tumour?',
    attrs: [
      attr('log2fc', 'Tumour vs normal', dys?.log2fc != null ? fx(num(dys.log2fc)!, 2) : null, srcOf.expression_tvn || 'UCSC Xena', 'fact',
        { unit: 'log2FC', confidence: dys ? (dys.low_confidence ? 'low' : 'high') : 'not_fetched',
          note: dys?.low_confidence ? 'Low confidence: the gene is not expressed in normal tissue, so the ratio is driven by a near-zero denominator.' : undefined }),
      attr('direction', 'Direction', dys ? (num(dys.log2fc) != null && num(dys.log2fc)! >= 0 ? 'over-expressed' : 'under-expressed') : null, srcOf.expression_tvn || 'UCSC Xena', 'fact'),
    ],
  });

  categories.push({
    key: 'dependency', label: 'Dependency', blurb: 'Does the tumour need it to survive?',
    attrs: [
      attr('chronos', 'CRISPR dependency', dep?.mean != null ? fx(num(dep.mean)!, 3) : null, srcOf.dependency || 'DepMap', 'fact',
        { unit: 'Chronos', note: 'More negative = more essential. Around -1 is a strong dependency.' }),
      attr('frac_dependent', 'Dependent cell lines', dep?.frac_dependent != null ? pct(num(dep.frac_dependent)!) : null, srcOf.dependency || 'DepMap', 'fact'),
    ],
  });

  categories.push({
    key: 'safety', label: 'Safety / constraint', blurb: 'Is losing it likely to be tolerated?',
    attrs: [
      attr('loeuf', 'LOEUF', saf?.loeuf != null ? fx(num(saf.loeuf)!, 3) : null, srcOf.safety || 'gnomAD v4', 'fact',
        { note: 'Low LOEUF = intolerant to loss-of-function = a safety flag. This is a bounded penalty, never a gate.' }),
      attr('pli', 'pLI', saf?.pli != null ? fx(num(saf.pli)!, 3) : null, srcOf.safety || 'gnomAD v4', 'fact'),
      attr('oe_lof', 'Observed/expected LoF', saf?.oe_lof != null ? fx(num(saf.oe_lof)!, 3) : null, srcOf.safety || 'gnomAD v4', 'fact'),
      attr('lof_z', 'LoF Z-score', saf?.lof_z != null ? fx(num(saf.lof_z)!, 2) : null, srcOf.safety || 'gnomAD v4', 'fact'),
      attr('mis_z', 'Missense Z-score', saf?.mis_z != null ? fx(num(saf.mis_z)!, 2) : null, srcOf.safety || 'gnomAD v4', 'fact'),
      // Recorded adverse events beat inferring safety from a genetic proxy alone.
      attr('liabilities', 'Known safety liabilities', ann?.n_safety_liabilities ?? null, 'Open Targets', 'fact',
        { note: Array.isArray(ann?.safety_liabilities) && ann.safety_liabilities.length
            ? 'Recorded events: ' + ann.safety_liabilities.slice(0, 6).map((x: any) => x.event).filter(Boolean).join(', ')
            : 'Real recorded adverse effects for this target, not a genetic proxy.' }),
      attr('common_essential', 'Common-essential', ann ? (ann.is_common_essential ? 'yes — essential across most cell lines' : 'no') : null, 'Open Targets (DepMap)', 'fact',
        { note: 'A pan-essential gene is needed by healthy cells too, so a strong CRISPR score is NOT tumour selectivity. This is the flag that separates a real dependency from a housekeeping one.' }),
    ],
  });

  categories.push({
    key: 'tissue', label: 'Tissue specificity', blurb: 'Is it restricted to a few tissues, or everywhere?',
    attrs: [
      attr('tau', 'Tau', tis?.tau != null ? fx(num(tis.tau)!, 3) : null, srcOf.tissue || 'GTEx v8', 'fact',
        { note: 'Yanai tau over GTEx: 0 = expressed evenly everywhere (drugging it hits every tissue — a safety concern), 1 = restricted to one or a few tissues.' }),
      attr('max_tissue', 'Highest in', tis?.max_tissue ?? null, srcOf.tissue || 'GTEx v8', 'fact'),
      attr('max_tpm', 'Peak expression', tis?.max_tpm != null ? fx(num(tis.max_tpm)!, 1) : null, srcOf.tissue || 'GTEx v8', 'fact', { unit: 'TPM' }),
    ],
  });

  categories.push({
    key: 'druggability', label: 'Druggability', blurb: 'Which modality could drug it?',
    attrs: drugLegacy
      ? [
        attr('label', 'Status', drug?.label ?? null, srcOf.druggability || 'ChEMBL (legacy)', 'fact', { confidence: 'low' }),
        attr('legacy_compounds', 'ChEMBL compounds (legacy)', drug?.total_compounds ?? null, srcOf.druggability || 'ChEMBL (legacy)', 'annotation',
          { confidence: 'low', note: 'Legacy row: this is a ChEMBL bioactivity count, NOT a count of developed drugs. Re-enrich this snapshot to get Open Targets drug/modality data.' }),
        attr('proven_modalities', 'Proven modalities', null, 'Open Targets', 'fact', { note: 'Not present in this legacy row — re-enrich to populate.' }),
        attr('tractable_modalities', 'Tractable modalities', null, 'Open Targets tractability', 'prediction', { note: 'Not present in this legacy row — re-enrich to populate.' }),
      ]
      : [
        attr('label', 'Status', drug?.label ?? null, srcOf.druggability || 'Open Targets', 'fact'),
        attr('total_compounds', 'Developed drugs', drug?.total_compounds ?? null, srcOf.druggability || 'Open Targets', 'fact',
          { note: 'A record of drugs that exist. Never gate on this — it rewards crowded targets and would delete novel ones.' }),
        attr('proven_modalities', 'Proven modalities', drug?.proven_modalities ?? null, srcOf.druggability || 'Open Targets', 'fact'),
        attr('tractable_modalities', 'Tractable modalities', drug?.tractable_modalities ?? null, 'Open Targets tractability', 'prediction',
          { note: 'A forward-looking assessment, not a record. This is the only druggability signal that is safe to gate on.' }),
      ],
  });

  const tbp = clin?.trials_by_phase ?? null;
  categories.push({
    key: 'clinical', label: 'Clinical landscape', blurb: 'Is anyone already pursuing it in this disease?',
    attrs: clinLegacy
      ? [
        attr('legacy_text_trials', 'Registry text-match trials (legacy)', clin?.trial_count ?? null, srcOf.clinical || 'ClinicalTrials.gov (legacy)', 'annotation',
          { confidence: 'low', note: 'Legacy row: a ClinicalTrials.gov FREE-TEXT match, not gene-attributed (renin scored 234 for pancreatic this way). Re-enrich for the Open Targets trial graph.' }),
        attr('legacy_max_phase', 'Max phase (legacy registry)', clin?.max_phase ?? null, srcOf.clinical || 'ClinicalTrials.gov (legacy)', 'annotation', { confidence: 'low' }),
        attr('drugs_in_trials', 'Drugs in disease trials', null, 'Open Targets', 'fact', { note: 'Not present in this legacy row — re-enrich to populate.' }),
      ]
      : [
        attr('drugs_in_trials', 'Drugs in disease trials', clin?.n_drugs_in_disease_trials ?? null, srcOf.clinical || 'Open Targets', 'fact'),
        attr('max_phase', 'Max phase in disease', clin?.max_disease_trial_phase ?? null, srcOf.clinical || 'Open Targets', 'fact',
          { note: 'Read from each trial in THIS disease — not the drug\'s global approval status.' }),
        attr('trials_total', 'Trials in disease', clin?.n_disease_trials ?? null, srcOf.clinical || 'Open Targets', 'fact'),
        attr('phase1', 'Phase 1 trials', tbp?.phase1 ?? null, srcOf.clinical || 'Open Targets', 'fact'),
        attr('phase2', 'Phase 2 trials', tbp?.phase2 ?? null, srcOf.clinical || 'Open Targets', 'fact'),
        attr('phase3', 'Phase 3 trials', tbp?.phase3 ?? null, srcOf.clinical || 'Open Targets', 'fact'),
        attr('drug_names', 'Drugs', Array.isArray(clin?.drug_names) && clin.drug_names.length ? clin.drug_names.join(', ') : null, srcOf.clinical || 'Open Targets', 'fact'),
      ],
  });

  categories.push({
    key: 'literature', label: 'Literature', blurb: 'Is interest established or rising?',
    attrs: [
      attr('papers', 'Publications', lit?.paper_count ?? null, srcOf.literature_epmc || 'Europe PMC', 'fact'),
      attr('velocity', 'Recent share (3y)', lit?.velocity != null ? pct(num(lit.velocity)!) : null, srcOf.literature_epmc || 'Europe PMC', 'annotation',
        { confidence: lit ? (lit.low_confidence ? 'low' : 'high') : 'not_fetched',
          note: lit?.low_confidence ? 'Low confidence: too few papers for a stable recent/total ratio.' : 'Momentum, not biological strength.' }),
      attr('pubmed_papers', 'PubMed papers', pm?.paper_count ?? null, 'PubMed', 'annotation',
        { note: 'Precise per-paper gene tagging, but rate-limited and ~20x smaller — shown for reference, never scored.' }),
    ],
  });

  categories.push({
    key: 'patents', label: 'Patents', blurb: 'How commercially worked is this target?',
    attrs: [
      attr('gene_patents', 'Patents naming the gene', input.patents?.gene_patents ?? null, 'Europe PMC (EPO patent index)', 'annotation',
        { note: 'Context only. A high count means a crowded, already-owned area — rewarding it would bias against novel targets.' }),
      attr('disease_patents', 'Patents naming gene + disease', input.patents?.disease_patents ?? null, 'Europe PMC (EPO patent index)', 'annotation'),
    ],
  });

  // ── completeness (so evidence-sparse is never mistaken for low quality) ────
  const present: string[] = [], missing: string[] = [];
  const has: Record<string, boolean> = {
    disease_association: otOverall != null, mutation: !!mut, expression: !!dys, dependency: !!dep,
    safety: !!saf, druggability: !!drug, clinical: !!clin, literature: !!lit,
  };
  for (const a of EXPECTED_AXES) (has[a] ? present : missing).push(a);

  // ── headline counters the dashboard cards read ────────────────────────────
  const headline: DossierHeadline = {
    drugs: drugLegacy ? null : (drug?.total_compounds ?? null),
    proven_modalities: drug?.proven_modalities ?? null,
    tractable_modalities: drug?.tractable_modalities ?? null,
    trials_total: clinLegacy ? null : (clin?.n_disease_trials ?? null),
    trials_by_phase: tbp ?? null,
    max_disease_phase: clinLegacy ? null : (clin?.max_disease_trial_phase ?? null),
    publications: lit?.paper_count ?? null,
    velocity: lit?.velocity != null ? num(lit.velocity) : null,
    patents: input.patents?.gene_patents ?? null,
  };

  const detail: DossierDetail = {
    drugs: Array.isArray(drug?.drugs) ? drug.drugs : [],
    modalities: Array.isArray(drug?.modalities) ? drug.modalities : [],
    tractability: Array.isArray(drug?.tractability) ? drug.tractability : [],
    // most advanced first; stopped trials surface their reason in the UI
    trials: Array.isArray(clin?.trials) ? clin.trials : [],
    papers: Array.isArray(lit?.top_papers) ? lit.top_papers : [],
    safety_liabilities: Array.isArray(ann?.safety_liabilities) ? ann.safety_liabilities : [],
    variants: Array.isArray(mut?.top_variants) ? mut.top_variants : [],
  };

  return {
    gene_symbol, disease_id, disease_name,
    rank: num(s.rank),
    score: num(s.overall_score) ?? otOverall,
    detail,
    summary: buildSummary(gene_symbol, disease_name, { otOverall, mut, dys, dep, saf, drug, clin, lit, patents: input.patents ?? null, drugLegacy, clinLegacy }),
    headline,
    categories,
    completeness: { score: present.length / EXPECTED_AXES.length, present: present.length, total: EXPECTED_AXES.length, missing },
    provenance: {
      sources: [...new Set(Object.values(srcOf).filter(Boolean))],
      snapshot_id: input.snapshot_id ?? null,
      generated_at: new Date().toISOString(),
    },
  };
}

// The wide, scalar GENE_DOSSIER row the dashboard grid reads — one row per gene. Parses the
// raw evidence directly (same inputs as buildGeneDossier) so it is not coupled to the
// category layout. Only headline scalars live here; the rich detail (drug list, per-trial
// records, function narrative, safety liabilities) stays in EVIDENCE and is read on drill-down.
export function buildDossierRow(input: DossierInput, summary: string): Record<string, unknown> {
  const ev: Record<string, any> = {};
  for (const e of input.evidence || []) if (e?.evidence_type) ev[e.evidence_type] = safeParse(e.value_json) || {};
  const s = input.scoreRow || {};
  const mut = ev.mutation, dys = ev.expression_tvn, dep = ev.dependency, saf = ev.safety, tis = ev.tissue;
  const drug = ev.druggability, clin = ev.clinical, lit = ev.literature_epmc, ann = ev.annotation, pat = ev.patents;
  const drugLegacy = !!drug && drug.proven_modalities === undefined;
  const clinLegacy = !!clin && clin.n_drugs_in_disease_trials === undefined;
  const b01 = (v: any) => (v == null ? null : v ? 1 : 0);

  const present = ['mutation', 'expression_tvn', 'dependency', 'safety', 'tissue', 'annotation', 'druggability', 'clinical', 'literature_epmc']
    .filter(a => ev[a]);
  const expected = ['disease_association', 'mutation', 'expression', 'dependency', 'safety', 'druggability', 'clinical', 'literature'];
  const missing = expected.filter(a => {
    const map: Record<string, boolean> = {
      disease_association: num(s.get_score) != null, mutation: !!mut, expression: !!dys, dependency: !!dep,
      safety: !!saf, druggability: !!drug, clinical: !!clin, literature: !!lit,
    };
    return !map[a];
  });

  return {
    gene_symbol: input.gene_symbol, disease_id: input.disease_id, disease_name: input.disease_name,
    snapshot_id: input.snapshot_id ?? null, rank_position: num(s.rank), score: num(s.overall_score) ?? num(s.get_score),
    summary,
    approved_name: ann?.approved_name ?? null, uniprot_id: ann?.uniprot_id ?? null, target_class: ann?.target_class ?? null,
    surface_or_secreted: b01(ann?.surface_or_secreted), is_common_essential: b01(ann?.is_common_essential),
    n_drugs: drugLegacy ? null : (drug?.total_compounds ?? null),
    n_proven_modalities: drug?.proven_modalities ?? null, n_tractable_modalities: drug?.tractable_modalities ?? null,
    top_modality: Array.isArray(drug?.modalities) && drug.modalities.length ? drug.modalities[0].modality : null,
    max_drug_phase: drug?.target_max_phase ?? null,
    n_disease_trials: clinLegacy ? null : (clin?.n_disease_trials ?? null),
    trials_phase1: clin?.trials_by_phase?.phase1 ?? null, trials_phase2: clin?.trials_by_phase?.phase2 ?? null,
    trials_phase3: clin?.trials_by_phase?.phase3 ?? null, trials_phase4: clin?.trials_by_phase?.phase4 ?? null,
    max_disease_phase: clinLegacy ? null : (clin?.max_disease_trial_phase ?? null), n_stopped_trials: clin?.n_stopped_trials ?? null,
    mutation_frequency: mut?.frequency != null ? num(mut.frequency) : null,
    log2fc: dys?.log2fc != null ? num(dys.log2fc) : null, chronos: dep?.mean != null ? num(dep.mean) : null,
    loeuf: saf?.loeuf != null ? num(saf.loeuf) : null, tissue_tau: tis?.tau != null ? num(tis.tau) : null,
    n_safety_liabilities: ann?.n_safety_liabilities ?? null,
    n_publications: lit?.paper_count ?? null, literature_velocity: lit?.velocity != null ? num(lit.velocity) : null,
    n_patents: pat?.gene_patents ?? null,
    completeness: present.length / 9, missing_axes: missing.join(','),
    schema_version: drugLegacy || clinLegacy ? 'legacy' : 'v2',
  };
}

// ── the one-paragraph summary ────────────────────────────────────────────────
// DETERMINISTIC by design: every clause is emitted only when the underlying number
// exists, and it states what is MISSING rather than glossing over it. No language
// model writes this, so it cannot assert anything the evidence does not contain.
function buildSummary(
  gene: string, disease: string,
  d: { otOverall: number | null; mut: any; dys: any; dep: any; saf: any; drug: any; clin: any; lit: any; patents: any; drugLegacy: boolean; clinLegacy: boolean },
): string {
  const parts: string[] = [];
  const dis = disease || 'this disease';

  parts.push(d.otOverall != null
    ? `${gene} has an Open Targets association of ${fx(d.otOverall, 2)} with ${dis}.`
    : `${gene} has no stored Open Targets association for ${dis}.`);

  const bits: string[] = [];
  if (d.mut?.frequency != null) bits.push(`mutated in ${pct(num(d.mut.frequency)!)} of the cohort${d.mut.dominant_variant ? ` (dominant ${d.mut.dominant_variant})` : ''}`);
  if (d.dys?.log2fc != null) {
    const v = num(d.dys.log2fc)!;
    bits.push(`${v >= 0 ? 'over' : 'under'}-expressed at log2FC ${fx(v, 2)}${d.dys.low_confidence ? ' (low confidence)' : ''}`);
  }
  if (d.dep?.mean != null) {
    const c = num(d.dep.mean)!;
    bits.push(`${c <= -0.5 ? 'a selective CRISPR dependency' : 'weak CRISPR dependency'} (Chronos ${fx(c, 2)})`);
  }
  if (bits.length) parts.push(`It is ${bits.join(', ')}.`);

  if (d.drug?.label) {
    if (d.drugLegacy) {
      // Legacy row: total_compounds is a ChEMBL bioactivity count, NOT developed drugs.
      // Say only what the row actually supports.
      parts.push(`Druggability: ${d.drug.label} (legacy ChEMBL record — drug and modality counts require a re-enrich).`);
    } else {
      const n = d.drug.total_compounds ?? 0;
      parts.push(n > 0
        ? `Druggability: ${d.drug.label} — ${n} developed drug${n === 1 ? '' : 's'} across ${d.drug.proven_modalities ?? 0} modalit${d.drug.proven_modalities === 1 ? 'y' : 'ies'}${d.drug.tractable_modalities ? `, and ${d.drug.tractable_modalities} modalit${d.drug.tractable_modalities === 1 ? 'y is' : 'ies are'} assessed tractable` : ''}.`
        : `Druggability: no developed drug yet${d.drug.tractable_modalities ? `, but ${d.drug.tractable_modalities} modalit${d.drug.tractable_modalities === 1 ? 'y is' : 'ies are'} assessed tractable — a novel-target profile` : ''}.`);
    }
  }

  if (d.clin) {
    if (d.clinLegacy) {
      parts.push(`Clinical: a legacy registry text search reported ${d.clin.trial_count ?? '?'} trial matches, which is not gene-attributed — re-enrich for the Open Targets trial graph.`);
    } else {
      const nd = d.clin.n_drugs_in_disease_trials ?? 0;
      const tp = d.clin.trials_by_phase;
      parts.push(nd > 0
        ? `Clinically, ${nd} drug${nd === 1 ? '' : 's'} hitting ${gene} ${nd === 1 ? 'is' : 'are'} in ${dis} trials (max Phase ${d.clin.max_disease_trial_phase ?? '?'}${tp ? `; ${tp.phase1} Phase 1, ${tp.phase2} Phase 2, ${tp.phase3} Phase 3` : ''}).`
        : `No drug targeting ${gene} is in a registered ${dis} trial — no clinical precedent yet, which is a novelty signal rather than a negative.`);
    }
  }

  if (d.saf?.loeuf != null) {
    const l = num(d.saf.loeuf)!;
    parts.push(l < 0.6
      ? `Safety: constrained (LOEUF ${fx(l, 2)}), so loss-of-function is poorly tolerated — a bounded risk deduction, not a veto.`
      : `Safety: no constraint flag (LOEUF ${fx(l, 2)}).`);
  }

  if (d.lit?.paper_count != null) {
    parts.push(`Literature: ${d.lit.paper_count} publications${d.lit.velocity != null && !d.lit.low_confidence ? `, ${pct(num(d.lit.velocity)!)} in the last three years` : ''}.`);
  }
  if (d.patents?.gene_patents != null) parts.push(`${d.patents.gene_patents} patents name the gene (context only).`);

  return parts.join(' ');
}
