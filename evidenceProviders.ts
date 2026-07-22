// evidenceProviders.ts ─────────────────────────────────────────────────────────
// SERVER-SIDE evidence providers used by the background harvest job (server.ts).
//
// These mirror the browser drill-down services (cbioportalService.ts,
// chemblService.ts, gnomadService.ts) so the evidence the JOB stores in Oracle is
// the SAME data the gene drawer shows live — one source of truth, funnel == drawer.
// The browser services route through /api/proxy (CORS); the server has no CORS, so
// here we call the upstream APIs directly. Every provider returns plain numbers in
// REAL units (frequency, IC50 nM, trial counts…) — the funnel filters on these.
//
// Keep any string destined for Oracle value_text/value_json ASCII/Latin-1 safe
// (the DB charset mangles arrows etc.); "·" is fine, arrows are not.

import { getModalityProfile, geneToEnsembl } from './modalityService.ts';

// ─── small helpers ────────────────────────────────────────────────────────────
const num = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 80)}`);
  return r.json();
}

// ─── Mutation axis — cBioPortal, BULK cohort pull ─────────────────────────────
// One disease maps to one TCGA study; a single mutations/fetch returns every
// mutation in the sequenced cohort, which we aggregate per gene. So the whole
// mutation axis for the universe is ONE network call (not per-gene).

const CBIO_BASE = 'https://www.cbioportal.org/api';

const CBIO_STUDY_MAP: { match: RegExp; id: string; name: string }[] = [
  { match: /pancrea|pdac|paad|ductal adenocarcinoma/i, id: 'paad_tcga_pan_can_atlas_2018', name: 'Pancreatic Adenocarcinoma (TCGA, PanCancer Atlas)' },
  { match: /glioblastoma|\bgbm\b/i, id: 'gbm_tcga_pan_can_atlas_2018', name: 'Glioblastoma Multiforme (TCGA, PanCancer Atlas)' },
];

export function resolveCbioStudy(disease: string): { id: string; name: string } | null {
  return CBIO_STUDY_MAP.find(s => s.match.test(disease || '')) ?? null;
}

export interface MutationStat {
  frequency: number;            // mutated_samples / total_samples (0..1)
  mutated_samples: number;
  total_samples: number;
  dominant_variant: string | null;
  top_variants: { change: string; count: number; fraction: number }[];
  study_id: string;
  study_name: string;
}

// Returns gene_symbol -> MutationStat for the whole cohort, or null if the disease
// has no mapped study (non-cancer) or the cohort can't be fetched.
export async function fetchCohortMutations(disease: string): Promise<Map<string, MutationStat> | null> {
  const study = resolveCbioStudy(disease);
  if (!study) return null;
  const sampleListId = `${study.id}_sequenced`;
  let totalSamples = 0;
  try {
    const sl = await getJson(`${CBIO_BASE}/sample-lists/${sampleListId}`);
    totalSamples = Array.isArray(sl?.sampleIds) ? sl.sampleIds.length : 0;
  } catch { /* fall through — frequency denominator stays 0 */ }
  if (!totalSamples) return null;

  const mutations: any[] = await getJson(
    `${CBIO_BASE}/molecular-profiles/${study.id}_mutations/mutations/fetch?projection=DETAILED`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ sampleListId }) },
  );

  // aggregate per gene: distinct mutated samples + per-protein-change sample counts
  type Agg = { samples: Set<string>; variants: Map<string, Set<string>> };
  const byGene = new Map<string, Agg>();
  for (const m of mutations) {
    const g = m?.gene?.hugoGeneSymbol; const s = m?.sampleId;
    if (!g || !s) continue;
    let a = byGene.get(g); if (!a) { a = { samples: new Set(), variants: new Map() }; byGene.set(g, a); }
    a.samples.add(s);
    const pc = m.proteinChange;
    if (pc) { let vs = a.variants.get(pc); if (!vs) { vs = new Set(); a.variants.set(pc, vs); } vs.add(s); }
  }

  const out = new Map<string, MutationStat>();
  for (const [gene, a] of byGene) {
    const mutated = a.samples.size;
    const variants = [...a.variants.entries()]
      .map(([change, vs]) => ({ change, count: vs.size, fraction: mutated > 0 ? vs.size / mutated : 0 }))
      .sort((x, y) => y.count - x.count);
    out.set(gene, {
      frequency: totalSamples > 0 ? mutated / totalSamples : 0,
      mutated_samples: mutated,
      total_samples: totalSamples,
      dominant_variant: variants[0]?.change ?? null,
      top_variants: variants.slice(0, 6),
      study_id: study.id, study_name: study.name,
    });
  }
  return out;
}

// ─── Druggability axis — Open Targets (per gene) ──────────────────────────────
// Uses modalityService.getModalityProfile: developed drugs by modality (FACT) plus
// per-modality tractability (PREDICTION), from OT drugAndClinicalCandidates +
// tractability. Replaces the old multi-call ChEMBL REST path, whose every timeout /
// unresolved-target / caught error was silently written as "No Drug Data Found" —
// the root cause of ~336 false negatives incl. EGFR/BRAF/CDK4/AKT1 (bug #1).
//
// THREE-STATE by contract — the fix for #1:
//   • lookup FAILED or target unresolved  → return null  → caller writes NO row
//     (a missing axis, NOT a fabricated "no drug"). Re-run fills it in — idempotent.
//   • lookup ok, developed drugs found    → label by developed-drug maturity (stage)
//   • lookup ok, genuinely no drugs       → "No Drug Data Found" (tractability still noted,
//     so a novel-but-tractable target like PHGDH scores > 0 and is never deleted)

export interface DruggabilityStat {
  label: 'Clinically Validated' | 'In Clinical Development' | 'Preclinical Only' | 'No Drug Data Found';
  score: number;                 // 0..1
  best_ic50_nm: number | null;   // OT path does not return IC50 → null (kept for shape compat)
  total_compounds: number;       // developed drugs (OT drugAndClinicalCandidates count)
  target_max_phase: number;      // 0..4 max developed-drug clinical stage (−1 → 0)
  target_drug_count: number;     // # proven (developed-drug) modalities
  target_chembl_id: string | null; // repurposed: the OT Ensembl id (provenance handle)
  tractable_modalities: number;  // # modalities assessed tractable — the novel-target-safe signal
  proven_modalities: number;     // # distinct developed-drug modalities
}

export async function fetchDruggability(symbol: string): Promise<DruggabilityStat | null> {
  const p = await getModalityProfile(symbol);
  // NOT-FETCHED / unresolved → null. Never fabricate "No Drug Data Found" from a failed lookup.
  if (p.error) return null;
  const rank = p.fact.bestStageRank;            // −1 when no developed drug
  const drugs = p.fact.totalDrugs;
  const tractable = p.prediction.tractableModalities;
  let label: DruggabilityStat['label'], score: number;
  if (rank >= 4)          { label = 'Clinically Validated';    score = 1.0; }
  else if (rank >= 1)     { label = 'In Clinical Development'; score = 0.85; }
  else if (drugs > 0)     { label = 'Preclinical Only';        score = 0.5; }  // preclinical developed drugs
  else if (tractable > 0) { label = 'Preclinical Only';        score = 0.3; }  // novel, but a tractable handle
  else                    { label = 'No Drug Data Found';      score = 0.0; }  // genuinely none
  return {
    label, score, best_ic50_nm: null,
    total_compounds: drugs,
    target_max_phase: rank >= 0 ? rank : 0,
    target_drug_count: p.fact.provenModalities,
    target_chembl_id: p.ensemblId,
    tractable_modalities: tractable,
    proven_modalities: p.fact.provenModalities,
  };
}

// ─── Clinical axis — Open Targets target→drug→trial graph (disease-scoped) ────
// REPLACES the ClinicalTrials.gov free-text search. CT.gov has NO gene field (it stores
// disease + intervention, not target), so any gene lookup was substring matching: REN hit
// "cur-REN-t" / "recur-REN-t" / "-REN-al" and scored renin 234 trials for PDAC. Gene→trial
// attribution exists only in a curated source — Open Targets.
//
// The question this answers: "does a drug that hits THIS target have a trial in THIS
// disease, and how far has that trial got?"
//
// ⚠ NEVER read the row-level `drug.maximumClinicalStage` — that is the drug's GLOBAL max
// stage across ALL diseases. Dasatinib/bosutinib are APPROVED (for CML) but only Phase 2
// in pancreatic; using the global stage would falsely credit SRC with an approved PDAC
// drug. Phase MUST come from `clinicalReports.trialPhase` filtered to the disease.

const OT_GQL = 'https://api.platform.opentargets.org/api/v4/graphql';

// Exact strings OT returns (no spaces — not "Phase III").
const TRIAL_PHASE_NUM: Record<string, number> = {
  PHASE4: 4, PHASE3: 3, 'PHASE2/PHASE3': 2.5, PHASE2: 2, 'PHASE1/PHASE2': 1.5, PHASE1: 1, EARLY_PHASE1: 0.5,
};

async function otGql(query: string, variables: Record<string, unknown>): Promise<any> {
  const r = await fetch(OT_GQL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`OT ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error('OT: ' + String(j.errors?.[0]?.message || 'query error').slice(0, 160));
  return j.data;
}

// The disease + all its descendant ontology ids, resolved ONCE per enrich run so the
// per-gene trial filter is a cheap id-set test. `nameHints` is the safety net for trial
// indications tagged to a RELATED node (parent/sibling) that isn't in `ids`.
//
// Two defects this guards against, both found live:
//  • Callers that pass no diseaseId (the /api/clinical route from the drill-down panels)
//    would otherwise have an EMPTY id set and fall back to name matching alone — so we
//    resolve the name to an ontology id here when no id is supplied.
//  • A single first-word hint silently undercounts: viewing "exocrine pancreatic carcinoma"
//    gave hint "exocrin", which missed BOSUTINIB whose only trial is tagged "pancreatic
//    adenocarcinoma" — a real Phase-1 PDAC trial, dropped. We therefore keep a hint per
//    SIGNIFICANT token and drop generic oncology words that would match any cancer.
export interface DiseaseScope { ids: Set<string>; nameHints: string[] }

// Words too generic to scope on — "carcinoma" alone would match breast carcinoma etc.
const GENERIC_DISEASE_WORDS = new Set([
  'cancer', 'carcinoma', 'adenocarcinoma', 'neoplasm', 'neoplasia', 'tumor', 'tumour',
  'malignant', 'malignancy', 'disease', 'disorder', 'syndrome', 'the', 'of', 'and',
]);

function diseaseNameHints(diseaseName: string): string[] {
  const toks = (diseaseName || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const hints = toks
    .filter(t => t.length >= 4 && !GENERIC_DISEASE_WORDS.has(t))
    .map(t => t.slice(0, 7));                    // prefix tolerates pancreatic/pancreas
  return [...new Set(hints)];
}

export async function resolveDiseaseScope(diseaseId: string, diseaseName: string): Promise<DiseaseScope> {
  const ids = new Set<string>();
  let id = (diseaseId || '').trim();
  // No id supplied (drill-down panels) → resolve the name so descendants still work.
  if (!id && diseaseName) {
    try {
      const s = await otGql(`query($q:String!){ search(queryString:$q, entityNames:["disease"], page:{index:0,size:1}){ hits{ id } } }`, { q: diseaseName });
      id = s?.search?.hits?.[0]?.id || '';
    } catch { /* name hints still apply */ }
  }
  if (id) {
    ids.add(id);
    try {
      const d = await otGql(`query($id:String!){ disease(efoId:$id){ id name descendants } }`, { id });
      const dis = d?.disease;
      if (dis?.id) ids.add(dis.id);
      for (const x of (dis?.descendants || [])) if (x) ids.add(String(x));
    } catch { /* fall back to id + name hints */ }
  }
  return { ids, nameHints: diseaseNameHints(diseaseName) };
}

export interface ClinicalStat {
  trial_count: number;               // = n_drugs_in_disease_trials (kept for shape compat)
  max_phase: number;                 // = max_disease_trial_phase (kept for shape compat)
  n_drugs_in_disease_trials: number;
  max_disease_trial_phase: number;
  drug_names: string[];
  axis: number;                      // 0..1 — maturity-dominant, breadth only breaks ties
}

// Axis: maturity dominates (a Phase-3 PDAC drug beats five Phase-1s). Phase4→1.00,
// Phase3→0.75, Phase2→0.50, Phase1→0.25, none→0. Small capped breadth bonus as tie-break.
function clinicalAxis(maxPhase: number, nDrugs: number): number {
  if (maxPhase <= 0) return 0;
  const base = clamp01(maxPhase / 4);
  const breadth = Math.min(0.10, 0.02 * Math.log1p(nDrugs));
  return clamp01(base + breadth);
}

export async function fetchClinical(symbol: string, scope: DiseaseScope): Promise<ClinicalStat | null> {
  try {
    const ensemblId = await geneToEnsembl(symbol);
    if (!ensemblId) return null;                  // unresolved → not-fetched (3-state), never a fake 0
    const d = await otGql(
      `query($e:String!){ target(ensemblId:$e){ drugAndClinicalCandidates{ rows{
         drug{ name }
         clinicalReports{ trialPhase diseases{ disease{ id name } } }
       } } } }`, { e: ensemblId });
    const rows: any[] = d?.target?.drugAndClinicalCandidates?.rows ?? [];
    const drugs = new Set<string>();
    let maxPhase = 0;
    for (const r of rows) {
      let inThisDisease = false, bestForDrug = 0;
      for (const cr of (r?.clinicalReports ?? [])) {
        const hit = (cr?.diseases ?? []).some((x: any) => {
          const id = x?.disease?.id, nm = String(x?.disease?.name ?? '').toLowerCase();
          return (id && scope.ids.has(String(id))) || scope.nameHints.some(h => nm.includes(h));
        });
        if (!hit) continue;                        // trial is for a different disease — ignore
        inThisDisease = true;
        const p = TRIAL_PHASE_NUM[String(cr?.trialPhase ?? '')] ?? 0;
        if (p > bestForDrug) bestForDrug = p;
      }
      if (!inThisDisease) continue;
      if (r?.drug?.name) drugs.add(String(r.drug.name));
      if (bestForDrug > maxPhase) maxPhase = bestForDrug;
    }
    const nDrugs = drugs.size;
    return {
      trial_count: nDrugs, max_phase: maxPhase,
      n_drugs_in_disease_trials: nDrugs, max_disease_trial_phase: maxPhase,
      drug_names: [...drugs].slice(0, 25),
      axis: clinicalAxis(maxPhase, nDrugs),
    };
  } catch { return null; }                         // fetch failed → not-fetched (3-state)
}

// ─── Literature axis — two complementary sources (per gene, disease-scoped) ───
// "Is interest established / rising?" Both compute total co-mentions + the share
// in the last 3 years (velocity). We store BOTH so a case study can use either:
//   • PubMed  — gene-specific (`SYMBOL[Gene Name]`), cleaner/smaller count
//   • Europe PMC — full-text, broader count
// Queries mirror api.ts getDrillDownData EXACTLY so stored == webapp drill-down.

export interface LiteratureStat { paper_count: number; recent_count: number; velocity: number; }

// Same disease-name normalization the drill-down uses before querying literature.
function cleanDiseaseName(d: string): string {
  return (d || '')
    .replace(/['"]/g, '')
    .replace(/\b(biomarker measurement|measurement|pathology|disorder|syndrome)\b.*$/i, '')
    .replace(/^(late|early)[- ]onset\s+/i, '')
    .replace(/^(juvenile|familial|sporadic|idiopathic)\s+/i, '')
    .trim();
}

// PubMed E-utilities — matches the drill-down "Literature" block (3,675 for KRAS).
const PUBMED = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const PM_TOOL = '&tool=DiseaseToTarget&email=nkurmach@uab.edu';
async function pubmedCount(term: string): Promise<number> {
  const d = await getJson(`${PUBMED}?db=pubmed&term=${encodeURIComponent(term)}&retmode=json${PM_TOOL}`);
  return num(d?.esearchresult?.count) ?? 0;
}
export async function fetchPubmedLiterature(symbol: string, disease: string): Promise<LiteratureStat | null> {
  try {
    const clean = cleanDiseaseName(disease);
    const yr = new Date().getFullYear();
    const base = `${symbol}[Gene Name] AND ${clean}`;
    const [total, recent] = await Promise.all([
      pubmedCount(base),
      pubmedCount(`${base} AND ${yr - 3}:${yr}[pdat]`),
    ]);
    return { paper_count: total, recent_count: recent, velocity: total > 0 ? recent / total : 0 };
  } catch { return null; }
}

// Europe PMC — matches the drill-down "Europe PMC" block (7,975 for KRAS).
const EPMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
async function epmcHits(query: string): Promise<number> {
  const d = await getJson(`${EPMC_BASE}?query=${encodeURIComponent(query)}&format=json&resultType=idlist&pageSize=1`);
  return num(d?.hitCount) ?? 0;
}
export async function fetchLiterature(symbol: string, disease: string): Promise<LiteratureStat | null> {
  try {
    const clean = cleanDiseaseName(disease);
    const yr = new Date().getFullYear();
    const base = `${symbol} AND "${clean}"`;
    const [total, recent] = await Promise.all([
      epmcHits(base),
      epmcHits(`${base} AND FIRST_PDATE:[${yr - 3}-01-01 TO ${yr}-12-31]`),
    ]);
    return { paper_count: total, recent_count: recent, velocity: total > 0 ? recent / total : 0 };
  } catch { return null; }
}

export { clamp01 as _clamp01 };
