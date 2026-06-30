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

// ─── Druggability axis — ChEMBL (per gene) ────────────────────────────────────
// Mirrors chemblService.ts: resolve target -> best IC50 + total compounds + the
// target-level max trial phase (from /mechanism), which drives the label.

const CHEMBL_BASE = 'https://www.ebi.ac.uk/chembl/api/data';

export interface DruggabilityStat {
  label: 'Clinically Validated' | 'In Clinical Development' | 'Preclinical Only' | 'No Drug Data Found';
  score: number;                 // 0..1
  best_ic50_nm: number | null;
  total_compounds: number;
  target_max_phase: number;
  target_drug_count: number;
  target_chembl_id: string | null;
}

async function chemblTargetId(symbol: string): Promise<string | null> {
  try {
    const d = await getJson(`${CHEMBL_BASE}/target/search?q=${encodeURIComponent(symbol)}&organism=Homo+sapiens&format=json`);
    const targets: any[] = d?.targets || [];
    if (!targets.length) return null;
    const exact = targets.find(t => t.target_components?.some((c: any) => c.target_component_synonyms?.some((s: any) => s.syn_type === 'GENE_SYMBOL' && s.component_synonym?.toUpperCase() === symbol.toUpperCase())));
    return (exact || targets[0])?.target_chembl_id || null;
  } catch { return null; }
}

async function chemblCompounds(targetId: string): Promise<{ best: number | null; total: number }> {
  try {
    const d = await getJson(`${CHEMBL_BASE}/activity?target_chembl_id=${targetId}&standard_type=IC50&format=json&limit=25`);
    const acts: any[] = d?.activities || [];
    const total = d?.page_meta?.total_count || acts.length;
    const valid = acts.map(a => num(a.standard_value)).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
    return { best: valid[0] ?? null, total };
  } catch { return { best: null, total: 0 }; }
}

async function chemblTargetMaxPhase(targetId: string): Promise<{ maxPhase: number; drugCount: number }> {
  try {
    const d = await getJson(`${CHEMBL_BASE}/mechanism?target_chembl_id=${targetId}&format=json&limit=100`);
    const mechs: any[] = d?.mechanisms || [];
    let maxPhase = 0;
    for (const m of mechs) { const p = num(m.max_phase) ?? 0; if (p > maxPhase) maxPhase = p; }
    return { maxPhase, drugCount: mechs.length };
  } catch { return { maxPhase: 0, drugCount: 0 }; }
}

function druggabilityLabel(targetMaxPhase: number, totalCompounds: number, bestIc50: number | null): { label: DruggabilityStat['label']; score: number } {
  const potent = bestIc50 != null && bestIc50 < 100;
  if (targetMaxPhase >= 4) return { label: 'Clinically Validated', score: 1.0 };
  if (targetMaxPhase >= 1) return { label: 'In Clinical Development', score: 0.85 };
  if (totalCompounds > 0 && potent) return { label: 'Preclinical Only', score: 0.65 };
  if (totalCompounds > 0) return { label: 'Preclinical Only', score: 0.5 };
  return { label: 'No Drug Data Found', score: 0.0 };
}

export async function fetchDruggability(symbol: string): Promise<DruggabilityStat | null> {
  const targetId = await chemblTargetId(symbol);
  if (!targetId) return { label: 'No Drug Data Found', score: 0, best_ic50_nm: null, total_compounds: 0, target_max_phase: 0, target_drug_count: 0, target_chembl_id: null };
  const [compounds, status] = await Promise.all([chemblCompounds(targetId), chemblTargetMaxPhase(targetId)]);
  const { label, score } = druggabilityLabel(status.maxPhase, compounds.total, compounds.best);
  return { label, score, best_ic50_nm: compounds.best, total_compounds: compounds.total, target_max_phase: status.maxPhase, target_drug_count: status.drugCount, target_chembl_id: targetId };
}

// ─── Clinical axis — ClinicalTrials.gov v2 (per gene, disease-scoped) ─────────
// "Is there trial activity / room?" — trials in this disease that mention the
// gene/target, plus the highest phase reached. Per-gene query (no bulk join from
// trial intervention back to gene target exists), cached upstream.

const CT_BASE = 'https://clinicaltrials.gov/api/v2/studies';
const PHASE_NUM: Record<string, number> = { EARLY_PHASE1: 0.5, PHASE1: 1, PHASE2: 2, PHASE3: 3, PHASE4: 4 };

export interface ClinicalStat { trial_count: number; max_phase: number; }

export async function fetchClinical(symbol: string, disease: string): Promise<ClinicalStat | null> {
  try {
    const url = `${CT_BASE}?query.cond=${encodeURIComponent(disease)}&query.term=${encodeURIComponent(symbol)}` +
      `&pageSize=50&countTotal=true&fields=protocolSection.designModule.phases`;
    const d = await getJson(url);
    const trial_count = num(d?.totalCount) ?? 0;
    let max_phase = 0;
    for (const st of (d?.studies || [])) {
      for (const p of (st?.protocolSection?.designModule?.phases || [])) {
        const v = PHASE_NUM[p] ?? 0; if (v > max_phase) max_phase = v;
      }
    }
    return { trial_count, max_phase };
  } catch { return null; }
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
