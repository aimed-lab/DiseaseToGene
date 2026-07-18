// enrichService.ts ────────────────────────────────────────────────────────────
// ON-DEMAND per-tier evidence for a single gene that is NOT in the Oracle snapshot
// (candidates added from a paper / CSV / manual entry). It fetches each funnel tier
// live from the SAME public sources the harvest job uses — so an added gene ranks in
// the funnel immediately, without waiting for an internal harvest → Oracle run.
//
// This is the professor's "new paper → 20 genes → generation → run the funnel" loop,
// and his cost-tiering in action: cheap tiers (ms) resolve instantly, live APIs (sec)
// run in parallel. Server-side (uses node fs for the reference tables).
//
// Disease scope: genetic / druggability / clinical / literature / safety work for ANY
// disease; mutation (cohort), dysregulation (expression reference) and dependency
// (lineage) are disease-specific and currently wired for PANCREATIC (the reference
// tables + cBioPortal cohort we have). Other diseases return those three as null until
// their references are added — honest, not fabricated.

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import {
  fetchCohortMutations, fetchDruggability, fetchClinical, fetchLiterature,
  resolveCbioStudy, type MutationStat,
} from './evidenceProviders.js';

const OT = 'https://api.platform.opentargets.org/api/v4/graphql';

// ── caches (reference tables + per-disease cohort) so N paper genes don't refetch ──
const refCache = new Map<string, any>();
async function loadRef(file: string): Promise<any> {
  if (refCache.has(file)) return refCache.get(file);
  let parsed: any = null;
  try { parsed = JSON.parse(await fsp.readFile(path.join(process.cwd(), 'data', file), 'utf-8')); } catch { parsed = null; }
  refCache.set(file, parsed);
  return parsed;
}
const cohortCache = new Map<string, Map<string, MutationStat> | null>();
async function cohort(disease: string): Promise<Map<string, MutationStat> | null> {
  if (cohortCache.has(disease)) return cohortCache.get(disease)!;
  let m: Map<string, MutationStat> | null = null;
  try { m = await fetchCohortMutations(disease); } catch { m = null; }
  cohortCache.set(disease, m);
  return m;
}

async function otFetch(query: string, variables: any): Promise<any> {
  const r = await fetch(OT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`OT ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error('OT: ' + String(j.errors?.[0]?.message || 'error').slice(0, 120));
  return j.data;
}
async function geneToEnsembl(gene: string): Promise<string | null> {
  try {
    const d = await otFetch(`query($q:String!){ search(queryString:$q, entityNames:["target"]){ hits{ id name } } }`, { q: gene });
    const hits: any[] = d?.search?.hits || [];
    return (hits.find(h => h.name?.toUpperCase() === gene.toUpperCase()) || hits[0])?.id || null;
  } catch { return null; }
}
// OT overall + genetic_association datatype for gene × disease.
async function otGenetic(ensembl: string, diseaseId: string): Promise<{ overall: number | null; genetic: number | null }> {
  try {
    const d = await otFetch(
      `query($id:String!,$efo:String!){ target(ensemblId:$id){ associatedDiseases(Bs:[$efo]){ rows{ score datatypeScores{ id score } } } } }`,
      { id: ensembl, efo: diseaseId });
    const row = d?.target?.associatedDiseases?.rows?.[0];
    if (!row) return { overall: null, genetic: null };
    const gen = (row.datatypeScores || []).find((x: any) => x.id === 'genetic_association')?.score ?? null;
    return { overall: row.score ?? null, genetic: gen };
  } catch { return { overall: null, genetic: null }; }
}

export interface TierStatus { value: number | string | null; source: string; ok: boolean; }
export interface EnrichedGene {
  gene_symbol: string;
  disease: string;
  getScore: number | null;   // OT overall (eligibility)
  drugLabel: string | null;
  raw: { genetic: number | null; frequency: number | null; log2fc: number | null; chronos: number | null; loeuf: number | null; trial_count: number | null; velocity: number | null };
  tiers: Record<string, TierStatus>;  // per-tier readout for the UI
}

// Enrich ONE gene against a disease, live. `diseaseId` = OT/MONDO/EFO id, `diseaseName`
// = human name (used for the cBioPortal cohort match + literature/clinical queries).
export async function enrichGene(gene: string, diseaseId: string, diseaseName: string): Promise<EnrichedGene> {
  const g = (gene || '').trim().toUpperCase();
  // pancreatic-scoped reference tables (expression / dependency) — only apply when the
  // disease is one we have references for; otherwise those three tiers stay null.
  const cbio = resolveCbioStudy(diseaseName);            // matches paad / gbm cohorts
  const pancreatic = /pancrea|paad|pdac/i.test(diseaseName);

  const [ens, exprRef, depRef, gnomRef] = await Promise.all([
    geneToEnsembl(g),
    pancreatic ? loadRef('expression_paad.json') : Promise.resolve(null),
    pancreatic ? loadRef('depmap_pancreatic.json') : Promise.resolve(null),
    loadRef('gnomad_constraint.json'),
  ]);
  const [genetic, cohortMap, drug, clin, lit] = await Promise.all([
    ens ? otGenetic(ens, diseaseId) : Promise.resolve({ overall: null, genetic: null }),
    cbio ? cohort(diseaseName) : Promise.resolve(null),
    fetchDruggability(g).catch(() => null),
    fetchClinical(g, diseaseName).catch(() => null),
    fetchLiterature(g, diseaseName).catch(() => null),
  ]);

  const mut = cohortMap?.get(g) ?? null;
  const expr = exprRef?.genes?.[g] ?? null;
  const dep = depRef?.genes?.[g] ?? null;
  const gn = gnomRef?.genes?.[g] ?? null;

  const raw = {
    genetic: genetic.genetic,
    frequency: mut ? mut.frequency : null,
    log2fc: expr ? (typeof expr.log2fc === 'number' ? expr.log2fc : null) : null,
    chronos: dep ? (typeof dep.mean === 'number' ? dep.mean : null) : null,
    loeuf: gn ? (typeof gn.loeuf === 'number' ? gn.loeuf : null) : null,
    trial_count: clin ? clin.trial_count : null,
    velocity: lit ? lit.velocity : null,
  };
  const tier = (value: any, source: string): TierStatus => ({ value: value ?? null, source, ok: value != null });
  const tiers: Record<string, TierStatus> = {
    genetic: tier(raw.genetic, 'Open Targets (genetic_association)'),
    mutation: tier(raw.frequency, cbio ? `cBioPortal (${cbio.id})` : 'cBioPortal (no cohort for this disease)'),
    dysregulation: tier(raw.log2fc, pancreatic ? 'TCGA-PAAD vs GTEx' : 'expression reference (disease not set up)'),
    dependency: tier(raw.chronos, pancreatic ? 'DepMap (pancreatic)' : 'DepMap (lineage not set up)'),
    safety: tier(raw.loeuf, 'gnomAD v4 LOEUF'),
    druggability: tier(drug?.label ?? null, 'ChEMBL'),
    clinical: tier(raw.trial_count, 'ClinicalTrials.gov'),
    literature: tier(raw.velocity, 'PubMed / Europe PMC'),
  };

  return { gene_symbol: g, disease: diseaseName, getScore: genetic.overall, drugLabel: drug?.label ?? null, raw, tiers };
}

// Enrich several genes concurrently (bounded) — for a batch of paper candidates.
export async function enrichGenes(genes: string[], diseaseId: string, diseaseName: string, conc = 4): Promise<EnrichedGene[]> {
  const out: EnrichedGene[] = [];
  for (let i = 0; i < genes.length; i += conc) {
    const batch = genes.slice(i, i + conc);
    out.push(...await Promise.all(batch.map(g => enrichGene(g, diseaseId, diseaseName).catch(() => ({
      gene_symbol: g.toUpperCase(), disease: diseaseName, getScore: null, drugLabel: null,
      raw: { genetic: null, frequency: null, log2fc: null, chronos: null, loeuf: null, trial_count: null, velocity: null },
      tiers: {},
    } as EnrichedGene)))));
  }
  return out;
}
