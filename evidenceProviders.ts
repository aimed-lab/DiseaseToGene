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

import { getModalityProfile, geneToEnsembl } from './modalityService.js';

// ─── small helpers ────────────────────────────────────────────────────────────
const num = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Retries TRANSIENT upstream failures (5xx, 429, network errors) with backoff. A single
// cBioPortal 502 once killed a whole harvest run; a bulk cohort fetch is one request that
// the entire mutation axis depends on, so it is worth retrying rather than losing the axis.
// 4xx other than 429 is NOT retried — that is a bad request, not a blip.
async function getJson(url: string, init?: RequestInit, tries = 3): Promise<any> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const r = await fetch(url, init);
      if (!r.ok) {
        const retryable = r.status >= 500 || r.status === 429;
        if (!retryable || attempt === tries) throw new Error(`${r.status} ${url.slice(0, 80)}`);
        await new Promise(res => setTimeout(res, 2000 * attempt));
        continue;
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      // a thrown non-retryable status is already final
      if (attempt === tries || /^(4\d\d) /.test(String((e as Error)?.message)) && !/^429 /.test(String((e as Error)?.message))) throw e;
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
  // ── detail: "which drugs / which modality", not just how many ──
  drugs: { name: string; modality: string | null; family: string | null; stage: string; approved: boolean }[];
  modalities: { modality: string; family: string; drugCount: number; topStage: string; approved: boolean }[];
  tractability: { modality: string; code: string; labels: string[] }[];  // WHY it is tractable
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
    drugs: p.fact.drugs.map(d => ({ name: d.name, modality: d.modality, family: d.family, stage: d.stage, approved: d.approved })),
    modalities: p.fact.developed.map(m => ({ modality: m.modality, family: m.family, drugCount: m.drugCount, topStage: m.topStage, approved: m.approved })),
    tractability: p.prediction.buckets.map(b => ({ modality: b.modality, code: b.code, labels: b.labels })),
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
  // OT 403s requests with no User-Agent (Node's fetch sends none) — see modalityService.ts.
  const r = await fetch(OT_GQL, { method: 'POST', headers: { 'content-type': 'application/json', 'User-Agent': 'Disease2Target/1.0 (academic research; contact via app)' }, body: JSON.stringify({ query, variables }) });
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
// `condQuery` is the disease's specific words in full ("pancreatic", "triple negative breast") for
// ClinicalTrials.gov's condition search, which matches whole words — the 7-char prefix hints
// are for OUR substring checks and would find almost nothing there.
export interface DiseaseScope { ids: Set<string>; nameHints: string[]; condQuery?: string }

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
  const condQuery = (diseaseName || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(t => t.length >= 4 && !GENERIC_DISEASE_WORDS.has(t)).join(' ');
  return { ids, nameHints: diseaseNameHints(diseaseName), condQuery };
}

export interface ClinicalStat {
  trial_count: number;               // = n_drugs_in_disease_trials (kept for shape compat)
  max_phase: number;                 // = max_disease_trial_phase (kept for shape compat)
  n_drugs_in_disease_trials: number;
  max_disease_trial_phase: number;
  drug_names: string[];
  axis: number;                      // 0..1 — maturity-dominant, breadth only breaks ties
  n_disease_trials: number;          // distinct trial records in this disease
  trials_by_phase: { phase1: number; phase2: number; phase3: number; phase4: number };
  // ── per-trial detail. `why_stopped` is the point: a target whose trials stopped for
  // TOXICITY is a different proposition from one stopped for business reasons, and
  // nothing else in the pipeline records failure reasons.
  trials: {
    id: string | null; url: string | null; phase: number; status: string | null;
    title: string | null; year: number | null; drug: string | null;
    why_stopped: string | null; stop_reasons: string[];
    // ── enriched from ClinicalTrials.gov (OT carries none of these) ──
    sponsor?: string | null; collaborators?: string[];
    start_date?: string | null; completion_date?: string | null; enrollment?: number | null;
    n_locations?: number; countries?: string[];
    locations?: { facility: string | null; city: string | null; state: string | null; country: string | null }[];
    // 'ot' (default when absent) = Open Targets drugAndClinicalCandidates; 'supplement' = a drug
    // DGIdb maps to this gene that Open Targets does not list yet, found on ClinicalTrials.gov
    // by name. Never scored.
    source?: 'ot' | 'supplement';
    mechanism?: string | null;          // DGIdb interaction type (inhibitor, antibody, ...)
    drug_sources?: string[];            // DGIdb's own sources for the drug-gene link (GuideToPharmacology, TTD, ...)
  }[];
  n_stopped_trials: number;
  // Trials of DGIdb-mapped drugs that Open Targets does not carry. Kept apart from every scored
  // number above so the axis is Open-Targets-only until a human says otherwise.
  supplement?: { source: string; drugs: string[]; n_trials: number; max_phase: number } | null;
}

// ─── Second drug→target source: DGIdb ────────────────────────────────────────
// ChEMBL curates a new drug's mechanism months after its Phase 3 starts, and Open Targets
// inherits the gap: daraxonrasib was in Phase 3 for PDAC and not a KRAS drug in OT 26.06.
// DGIdb (dgidb.org, free GraphQL, no key) aggregates other expert-curated drug-gene
// sources — Guide to Pharmacology had daraxonrasib → KRAS (inhibitor) — so fetchClinical
// asks it for the gene's drugs, takes the ones Open Targets did not list, finds THEIR
// ClinicalTrials.gov studies in the disease, and appends them labelled and unscored.
//
// Only target-mechanism sources count. CIViC / OncoKB / CGI / PharmGKB / Clearity list a
// drug against a gene when the gene's MUTATION predicts response (gemcitabine, nivolumab
// for KRAS) — a biomarker, not a target. DGIdb's own ChEMBL feed is excluded too: it maps
// every HCV NS3 protease inhibitor (glecaprevir…) to KRAS, and Open Targets already reads
// ChEMBL properly. TALC / TdgClinicalTrial are trial-list scrapes, not mechanism claims.
const DGIDB_URL = process.env.DGIDB_URL || 'https://dgidb.org/api/graphql';
const DGIDB_MECHANISM_SOURCES = new Set(['GuideToPharmacology', 'TTD', 'DrugBank']);
export const SUPPLEMENT_SOURCE = 'ClinicalTrials.gov, drug→target from DGIdb (Guide to Pharmacology, TTD, DrugBank)';
interface DgidbDrug { name: string; type: string | null; sources: string[]; codes?: string[] }

// A trial registers a new drug under its development code (RMC-6236) long before the INN
// (daraxonrasib) appears in the record, so the INN alone misses the pivotal studies. PubChem
// (free, no key) lists both; keep the code-shaped synonyms — letters, dash, digits — and drop
// catalogue ids (CHEMBL…, NSC…, GTPL…) that never name an intervention.
const CODE_RE = /^[A-Z]{2,5}-\d{3,7}[A-Z]?$/;
const CATALOGUE_PREFIX = /^(CHEMBL|GTPL|NSC|GLXC|HY|CS|EX|BCP|MFCD|DTXSID|DTXCID|SCHEMBL|ORB|DA|AC|AT|SR|CAS|UNII|EN|FT|AKOS|MLS|SMR|ZINC|HMS|BDBM|SB|NCGC|TOX|CCG|Q|DB|D)\b/i;
const codeCache = new Map<string, Promise<string[]>>();
function drugCodes(name: string): Promise<string[]> {
  const key = name.toUpperCase();
  let p = codeCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/synonyms/JSON`, { headers: { Accept: 'application/json' } });
        if (!r.ok) return [];
        const j: any = await r.json();
        const syn: string[] = j?.InformationList?.Information?.[0]?.Synonym ?? [];
        const out = new Set<string>();
        for (const x of syn) { const u = String(x).toUpperCase().replace(/\s+/g, '-'); if (CODE_RE.test(u) && !CATALOGUE_PREFIX.test(u)) out.add(u); }
        return [...out].slice(0, 4);
      } catch { return []; }
    })();
    codeCache.set(key, p);
  }
  return p;
}
// "RMC-6236", "RMC 6236" and "RMC6236" are one name
const squash = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
const dgidbCache = new Map<string, Promise<DgidbDrug[]>>();
function dgidbDrugsFor(symbol: string): Promise<DgidbDrug[]> {
  const key = symbol.toUpperCase();
  let p = dgidbCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const query = `query($g:[String!]!){ genes(names:$g){ nodes{ name interactions{ drug{ name } interactionTypes{ type } sources{ sourceDbName } } } } }`;
        const r = await fetch(DGIDB_URL, { method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json', 'User-Agent': 'Disease2Target/1.0 (academic research; contact via app)' }, body: JSON.stringify({ query, variables: { g: [key] } }) });
        if (!r.ok) return [];
        const j: any = await r.json();
        const node = (j?.data?.genes?.nodes ?? []).find((n: any) => String(n?.name ?? '').toUpperCase() === key);
        const out: DgidbDrug[] = [];
        const seen = new Set<string>();
        for (const it of (node?.interactions ?? [])) {
          const name = String(it?.drug?.name ?? '').trim();
          const sources = (it?.sources ?? []).map((x: any) => String(x?.sourceDbName ?? '')).filter((x: string) => DGIDB_MECHANISM_SOURCES.has(x));
          if (!name || !sources.length) continue;
          // tool compounds ("COMPOUND 25 [PMID: …]") and IUPAC strings never name a trial intervention
          if (/^COMPOUND\s|\[PMID|\(|\d-[A-Z]{2,}/i.test(name) || name.length > 40) continue;
          const k = name.toUpperCase(); if (seen.has(k)) continue; seen.add(k);
          out.push({ name: k, type: it?.interactionTypes?.[0]?.type ? String(it.interactionTypes[0].type) : null, sources });
        }
        return out;
      } catch { return []; }                     // DGIdb down → no supplement, never an error
    })();
    dgidbCache.set(key, p);
  }
  return p;
}

// ClinicalTrials.gov interventional studies of the supplement drugs in the disease — ONE call
// per gene, every drug name OR-ed into query.intr. A study is kept only when one of its own
// conditions matches a disease hint AND one of the drugs is one of its interventions, so the
// fuzzy search cannot pull in another cancer or a mere mention. Best-effort: any failure
// returns [] and the OT-only record stands.
async function fetchSupplementTrials(drugs: DgidbDrug[], scope: DiseaseScope): Promise<ClinicalStat['trials']> {
  if (!drugs.length || !scope.nameHints.length) return [];
  for (const d of drugs) if (!d.codes) d.codes = await drugCodes(d.name);
  const names = drugs.flatMap(d => [d.name, ...(d.codes || [])]);
  const url = 'https://clinicaltrials.gov/api/v2/studies'
    + `?query.intr=${encodeURIComponent(names.map(n => `"${n}"`).join(' OR '))}`
    + `&query.cond=${encodeURIComponent(scope.condQuery || scope.nameHints.join(' '))}`
    + '&filter.advanced=' + encodeURIComponent('AREA[StudyType]INTERVENTIONAL')
    + '&fields=protocolSection.identificationModule,protocolSection.statusModule,protocolSection.designModule,'
    + 'protocolSection.conditionsModule,protocolSection.armsInterventionsModule,protocolSection.sponsorCollaboratorsModule'
    + '&pageSize=100';
  try {
    // a gene with many mapped drugs (lonafarnib alone has dozens of studies) overflows one page — follow up to 3
    const studies: any[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 3; page++) {
      const r = await fetch(url + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), { headers: { Accept: 'application/json' } });
      if (!r.ok) break;
      const j: any = await r.json();
      studies.push(...(j?.studies ?? []));
      pageToken = j?.nextPageToken ? String(j.nextPageToken) : null;
      if (!pageToken) break;
    }
    const out: ClinicalStat['trials'] = [];
    for (const st of studies) {
      const ps = st?.protocolSection ?? {};
      const nct = String(ps?.identificationModule?.nctId ?? '').toUpperCase();
      if (!/^NCT[0-9]+$/.test(nct)) continue;
      const conds: string[] = (ps?.conditionsModule?.conditions ?? []).map((c: any) => String(c).toLowerCase());
      if (!conds.some(c => scope.nameHints.some(h => c.includes(h)))) continue;
      // an intervention is often registered under its code (RMC-6236) with the INN in otherNames — check both
      const ivs: string[] = (ps?.armsInterventionsModule?.interventions ?? []).flatMap((i: any) => [String(i?.name ?? ''), ...((i?.otherNames ?? []) as any[]).map(String)]).map(squash);
      const matched = drugs.filter(d => { const keys = [d.name, ...(d.codes || [])].map(squash); return ivs.some(i => keys.some(k => i.includes(k))); });
      if (!matched.length) continue;
      const phases: string[] = ps?.designModule?.phases ?? [];
      const p = phases.length ? Math.max(0, ...phases.map(x => TRIAL_PHASE_NUM[String(x)] ?? 0)) : 0;
      const stm = ps?.statusModule ?? {};
      const start = stm?.startDateStruct?.date ?? null;
      const yr = start ? Number(String(start).slice(0, 4)) : null;
      const why = stm?.whyStopped ? String(stm.whyStopped).slice(0, 400) : null;
      const idm = ps?.identificationModule ?? {};
      out.push({
        id: nct, url: `https://clinicaltrials.gov/study/${nct}`, phase: p,
        status: stm?.overallStatus ? String(stm.overallStatus) : null,
        title: idm?.officialTitle ? String(idm.officialTitle).slice(0, 300) : (idm?.briefTitle ? String(idm.briefTitle).slice(0, 300) : null),
        year: yr && yr > 1900 ? yr : null,
        drug: matched.map(d => d.name).join(' + '),
        why_stopped: why, stop_reasons: [],
        sponsor: ps?.sponsorCollaboratorsModule?.leadSponsor?.name ?? null,
        source: 'supplement',
        mechanism: matched[0].type,
        drug_sources: [...new Set(matched.flatMap(d => d.sources))],
      });
    }
    return out;
  } catch { return []; }
}

// Axis: maturity dominates (a Phase-3 PDAC drug beats five Phase-1s). Phase4→1.00,
// Phase3→0.75, Phase2→0.50, Phase1→0.25, none→0. Small capped breadth bonus as tie-break.
function clinicalAxis(maxPhase: number, nDrugs: number): number {
  if (maxPhase <= 0) return 0;
  const base = clamp01(maxPhase / 4);
  const breadth = Math.min(0.10, 0.02 * Math.log1p(nDrugs));
  return clamp01(base + breadth);
}

// Trial metadata Open Targets does NOT carry — start year, sponsor/collaborators, sites,
// enrollment, completion — fetched from the ClinicalTrials.gov v2 API by NCT id and merged
// into the trial records in place. Batched (filter.ids), best-effort: a failed lookup leaves
// the OT-only record untouched. #13 (expand clinical trial info).
async function enrichTrialsWithCtgov(
  trials: { id: string | null; year: number | null; status: string | null; why_stopped: string | null; [k: string]: any }[],
): Promise<void> {
  const ids = [...new Set(trials.map(t => (t.id || '').toUpperCase()).filter(x => /^NCT\d+$/.test(x)))];
  if (!ids.length) return;
  const meta = new Map<string, any>();
  const CHUNK = 40;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    try {
      const url = `https://clinicaltrials.gov/api/v2/studies?filter.ids=${batch.join(',')}`
        + '&fields=protocolSection.identificationModule,protocolSection.statusModule,'
        + 'protocolSection.sponsorCollaboratorsModule,protocolSection.designModule,protocolSection.contactsLocationsModule'
        + `&pageSize=${batch.length}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const j: any = await r.json();
      for (const s of (j?.studies ?? [])) {
        const ps = s?.protocolSection ?? {};
        const nct = String(ps?.identificationModule?.nctId ?? '').toUpperCase();
        if (!nct) continue;
        const st = ps?.statusModule ?? {}, sp = ps?.sponsorCollaboratorsModule ?? {};
        const start = st?.startDateStruct?.date ?? null;
        const yr = start ? Number(String(start).slice(0, 4)) : null;
        const locs = (ps?.contactsLocationsModule?.locations ?? []).map((l: any) => ({
          facility: l?.facility ?? null, city: l?.city ?? null, state: l?.state ?? null, country: l?.country ?? null,
        }));
        meta.set(nct, {
          year: (yr && yr > 1900) ? yr : null,
          start_date: start,
          completion_date: st?.completionDateStruct?.date ?? st?.primaryCompletionDateStruct?.date ?? null,
          status: st?.overallStatus ?? null,
          why_stopped: st?.whyStopped ?? null,
          sponsor: sp?.leadSponsor?.name ?? null,
          collaborators: (sp?.collaborators ?? []).map((c: any) => String(c?.name ?? '')).filter(Boolean).slice(0, 8),
          enrollment: Number.isFinite(Number(ps?.designModule?.enrollmentInfo?.count)) ? Number(ps.designModule.enrollmentInfo.count) : null,
          n_locations: locs.length,
          countries: [...new Set(locs.map((l: any) => l.country).filter(Boolean))].slice(0, 12),
          locations: locs.slice(0, 15),
        });
      }
    } catch { /* skip this batch — keep the OT-only trial record */ }
  }
  for (const t of trials) {
    const m = t.id ? meta.get(t.id.toUpperCase()) : null;
    if (!m) continue;
    if (t.year == null) t.year = m.year;                              // OT year was usually null — CT.gov fills it
    if (!t.status && m.status) t.status = m.status;
    if (!t.why_stopped && m.why_stopped) t.why_stopped = String(m.why_stopped).slice(0, 400);
    t.sponsor = m.sponsor; t.collaborators = m.collaborators;
    t.start_date = m.start_date; t.completion_date = m.completion_date; t.enrollment = m.enrollment;
    t.n_locations = m.n_locations; t.countries = m.countries; t.locations = m.locations;
  }
}

export async function fetchClinical(symbol: string, scope: DiseaseScope): Promise<ClinicalStat | null> {
  try {
    const ensemblId = await geneToEnsembl(symbol);
    if (!ensemblId) return null;                  // unresolved → not-fetched (3-state), never a fake 0
    const d = await otGql(
      `query($e:String!){ target(ensemblId:$e){ drugAndClinicalCandidates{ rows{
         drug{ name }
         clinicalReports{
           id url trialPhase trialOverallStatus trialOfficialTitle year
           trialWhyStopped trialStopReasonCategories
           diseases{ disease{ id name } }
         }
       } } } }`, { e: ensemblId });
    const rows: any[] = d?.target?.drugAndClinicalCandidates?.rows ?? [];
    const drugs = new Set<string>();
    const trials: ClinicalStat['trials'] = [];
    const seenTrial = new Set<string>();
    let maxPhase = 0, nTrials = 0, nStopped = 0;
    // Phase histogram over the DISEASE trials. Combined phases round down to the phase
    // actually reached (PHASE1/PHASE2 -> Phase 1) so a bucket never overstates maturity.
    const byPhase = { phase1: 0, phase2: 0, phase3: 0, phase4: 0 };
    for (const r of rows) {
      let inThisDisease = false, bestForDrug = 0;
      for (const cr of (r?.clinicalReports ?? [])) {
        const hit = (cr?.diseases ?? []).some((x: any) => {
          const id = x?.disease?.id, nm = String(x?.disease?.name ?? '').toLowerCase();
          return (id && scope.ids.has(String(id))) || scope.nameHints.some(h => nm.includes(h));
        });
        if (!hit) continue;                        // trial is for a different disease — ignore
        inThisDisease = true;
        nTrials++;
        const p = TRIAL_PHASE_NUM[String(cr?.trialPhase ?? '')] ?? 0;
        if (p >= 4) byPhase.phase4++;
        else if (p >= 3) byPhase.phase3++;
        else if (p >= 2) byPhase.phase2++;
        else if (p >= 1) byPhase.phase1++;
        if (p > bestForDrug) bestForDrug = p;
        const tid = cr?.id ? String(cr.id) : null;
        const dedupeKey = tid || `${r?.drug?.name}|${cr?.trialOfficialTitle}`;
        if (!seenTrial.has(dedupeKey)) {
          seenTrial.add(dedupeKey);
          const why = cr?.trialWhyStopped ? String(cr.trialWhyStopped) : null;
          if (why) nStopped++;
          trials.push({
            id: tid, url: cr?.url ? String(cr.url) : null, phase: p,
            status: cr?.trialOverallStatus ? String(cr.trialOverallStatus) : null,
            title: cr?.trialOfficialTitle ? String(cr.trialOfficialTitle).slice(0, 300) : null,
            // guard null explicitly: Number(null) is 0, which would store a fake year 0
            year: cr?.year != null && Number.isFinite(Number(cr.year)) && Number(cr.year) > 1900 ? Number(cr.year) : null,
            drug: r?.drug?.name ? String(r.drug.name) : null,
            why_stopped: why ? why.slice(0, 400) : null,
            stop_reasons: Array.isArray(cr?.trialStopReasonCategories) ? cr.trialStopReasonCategories.map(String) : [],
          });
        }
      }
      if (!inThisDisease) continue;
      if (r?.drug?.name) drugs.add(String(r.drug.name));
      if (bestForDrug > maxPhase) maxPhase = bestForDrug;
    }
    // most-advanced first, so the stored cap keeps the trials that matter
    const finalTrials = trials.sort((a, b) => b.phase - a.phase || (b.year ?? 0) - (a.year ?? 0)).slice(0, 60);
    await enrichTrialsWithCtgov(finalTrials);   // fill year / sponsor / sites from ClinicalTrials.gov
    const nDrugs = drugs.size;
    // DGIdb supplement: appended AFTER the scored numbers are fixed. Only drugs Open Targets
    // did not list are looked up (one DGIdb call + at most one ClinicalTrials.gov call per gene).
    let supplement: ClinicalStat['supplement'] = null;
    const otDrugs = new Set(rows.map(r => String(r?.drug?.name ?? '').toUpperCase()).filter(Boolean));
    const extra = (await dgidbDrugsFor(symbol)).filter(d => !otDrugs.has(d.name)).slice(0, 40);
    if (extra.length) {
      const have = new Set(finalTrials.map(t => String(t.id || '').toUpperCase()));
      const added: ClinicalStat['trials'] = [];
      for (const t of await fetchSupplementTrials(extra, scope)) {
        const k = String(t.id).toUpperCase(); if (have.has(k)) continue; have.add(k); added.push(t);
      }
      if (added.length) {
        added.sort((a, b) => b.phase - a.phase || (b.year ?? 0) - (a.year ?? 0));
        finalTrials.push(...added.slice(0, 40));
        supplement = { source: SUPPLEMENT_SOURCE, drugs: [...new Set(added.map(t => String(t.drug)))], n_trials: added.length, max_phase: Math.max(0, ...added.map(t => t.phase)) };
      }
    }
    return {
      trial_count: nDrugs, max_phase: maxPhase,
      n_drugs_in_disease_trials: nDrugs, max_disease_trial_phase: maxPhase,
      drug_names: [...drugs].slice(0, 25),
      axis: clinicalAxis(maxPhase, nDrugs),
      n_disease_trials: nTrials, trials_by_phase: byPhase,
      trials: finalTrials,
      n_stopped_trials: nStopped,
      supplement,
    };
  } catch { return null; }                         // fetch failed → not-fetched (3-state)
}

// ─── Literature axis — two complementary sources (per gene, disease-scoped) ───
// "Is interest established / rising?" Both compute total co-mentions + the share
// in the last 3 years (velocity). We store BOTH so a case study can use either:
//   • PubMed  — gene-specific (`SYMBOL[Gene Name]`), cleaner/smaller count
//   • Europe PMC — full-text, broader count
// Queries mirror api.ts getDrillDownData EXACTLY so stored == webapp drill-down.

export interface LiteraturePaper { title: string; id: string; source: string; journal: string | null; year: string | null }
export interface LiteratureStat {
  paper_count: number; recent_count: number; velocity: number;
  // Top recent papers, so "2,628 publications" becomes readable, citable evidence rather
  // than a bare count. Fetched only by fetchLiterature (Europe PMC), not the PubMed path.
  top_papers?: LiteraturePaper[];
  latest_year?: string | null;
}

// Same disease-name normalization the drill-down uses before querying literature.
export function cleanDiseaseName(d: string): string {
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
export async function epmcHits(query: string): Promise<number> {
  const d = await getJson(`${EPMC_BASE}?query=${encodeURIComponent(query)}&format=json&resultType=idlist&pageSize=1`);
  return num(d?.hitCount) ?? 0;
}
// Top papers, newest first — one extra Europe PMC call, cited-by ordering unavailable on
// the free endpoint so we take the most recent, which is what "momentum" is about anyway.
export async function epmcTopPapers(query: string, n = 5): Promise<LiteraturePaper[]> {
  const d = await getJson(`${EPMC_BASE}?query=${encodeURIComponent(query)}&format=json&resultType=lite&pageSize=${n}&sort=P_PDATE_D%20desc`);
  const rows: any[] = d?.resultList?.result || [];
  return rows.map(r => ({
    title: String(r.title || '').replace(/<[^>]+>/g, '').slice(0, 300),
    id: String(r.pmid || r.id || ''), source: String(r.source || 'MED'),
    journal: r.journalTitle ? String(r.journalTitle) : null,
    year: r.pubYear ? String(r.pubYear) : null,
  })).filter(p => p.title);
}

export async function fetchLiterature(symbol: string, disease: string, withPapers = false): Promise<LiteratureStat | null> {
  try {
    const clean = cleanDiseaseName(disease);
    const yr = new Date().getFullYear();
    const base = `${symbol} AND "${clean}"`;
    const [total, recent, papers] = await Promise.all([
      epmcHits(base),
      epmcHits(`${base} AND FIRST_PDATE:[${yr - 3}-01-01 TO ${yr}-12-31]`),
      withPapers ? epmcTopPapers(base).catch(() => []) : Promise.resolve([] as LiteraturePaper[]),
    ]);
    return {
      paper_count: total, recent_count: recent, velocity: total > 0 ? recent / total : 0,
      ...(withPapers ? { top_papers: papers, latest_year: papers[0]?.year ?? null } : {}),
    };
  } catch { return null; }
}

// ─── Patent axis — Europe PMC patent index (SRC:PAT) ─────────────────────────
// Europe PMC indexes EPO patent documents alongside literature, so the same free API
// that powers the literature axis also gives a patent count — no new key or vendor.
//
// CONTEXT ONLY, never a pro-score (per the design review): a high patent count means
// a crowded, commercially-worked area. That is useful context for a nomination, but
// rewarding it would bias the funnel toward already-owned targets and penalise novel
// ones (PHGDH: 6 patents vs EGFR: 2,046). Store it, show it, do not score it.
export interface PatentStat {
  gene_patents: number;          // patents mentioning the gene (any indication)
  disease_patents: number;       // patents mentioning the gene AND the disease
}

export async function fetchPatents(symbol: string, disease: string): Promise<PatentStat | null> {
  try {
    const clean = cleanDiseaseName(disease);
    const [gene, both] = await Promise.all([
      epmcHits(`"${symbol}" AND SRC:PAT`),
      clean ? epmcHits(`"${symbol}" AND "${clean}" AND SRC:PAT`) : Promise.resolve(0),
    ]);
    return { gene_patents: gene, disease_patents: both };
  } catch { return null; }        // fetch failed → not-fetched (3-state), never a fake 0
}

export { clamp01 as _clamp01 };
