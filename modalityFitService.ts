// modalityFitService.ts ─────────────────────────────────────────────────────
// F-MOD — On-demand "modality fit" analysis for ONE target (the professor's
// modality bar-chart). Whole-protein, hybrid engine:
//   1) gather HARD evidence deterministically (OT tractability + developed drugs,
//      DoGSite pocket descriptors, UniProt localization / active-site / sequence),
//   2) assign an anchored TIER per modality from DETERMINISTIC rules + hard gates,
//   3) let Gemini write ONLY the one-line rationale for each fixed tier (temperature 0,
//      restricted to that tier's deterministic `basis`).
// Tiers are reproducible facts-plus-rules, never model output — that separation is the
// point of the design. Public APIs only → runs locally and on Vercel.

import { getModalityProfile } from './modalityService.js';
import { getPocketStructure } from './dogsiteService.js';

// The shared vocabulary (goals, thresholds, taxonomy, tiers) lives in modalityConstants.ts
// so modalityGlossary.ts can document the exact values these rules use, without dragging
// this server module into the browser bundle. Re-exported here: importers are unchanged.
export {
  MECHANISTIC_GOALS, isGoal, MODALITY_THRESHOLDS,
  MODALITY_CATEGORIES, MODALITY_TAXONOMY, TIER_RANK, TIER_DEF,
} from './modalityConstants.js';
export type { MechanisticGoal, ModalityCategory, Tier } from './modalityConstants.js';

import {
  MECHANISTIC_GOALS, MODALITY_THRESHOLDS, MODALITY_TAXONOMY, TIER_RANK, TIER_DEF,
  type MechanisticGoal, type ModalityCategory, type Tier,
} from './modalityConstants.js';

export interface ModalityEvidence {
  gene: string;
  uniprot: string | null;
  subcellularLocations: string[];
  isMembrane: boolean;
  isSecreted: boolean;
  isIntracellular: boolean;
  // 5a — antibody accessibility, consolidated from multiple sources (stronger than a location string):
  hasTransmembrane: boolean;        // UniProt transmembrane feature(s)
  hasSignalPeptide: boolean;        // UniProt signal peptide
  surfaceAccess: 'surface' | 'secreted' | 'intracellular' | 'unknown';
  surfaceSource: string;            // which evidence set the call
  sequenceLength: number | null;
  cysCount: number | null;
  lysineCount: number | null;       // 5e — lysines available for ubiquitin transfer (PROTAC)
  isUbiquitinated: boolean;         // 5f — known ubiquitination (UniProt "Ubl conjugation") → degradation-compatible
  activeSiteCount: number | null;   // annotated catalytic/active-site residues
  likelyEnzyme: boolean;
  pocket: {
    hasStructure: boolean;
    structureLabel: string | null;
    totalPockets: number;
    druggablePockets: number;           // 5g — pockets with a druggable SHAPE (enclosed, drug-sized) among those returned
    bestEnclosure: number | null;       // 5g — best enclosure among druggable pockets (0–1)
    topVolume: number | null;
    topEnclosure: number | null;
    topDepth: number | null;
    druggabilityProxy: number | null;   // 0–1 heuristic from descriptors (NOT the published drugScore)
  };
  tractabilityBuckets: { code: string; modality: string; labels: string[] }[];
  provenModalities: { family: string; drugCount: number; topStage: string }[];
  chemblActivities: number | null;   // 5b — measured bioactivities in ChEMBL (empirical "chemical matter exists")
  ppiPartners: number | null;        // 5c — high-confidence STRING partners (an interface exists to disrupt)
  exonCount: number | null;          // 5d — canonical-transcript exon count (splice-switching ASO feasibility)
  notes: string[];
}

export interface ModalityAssessment {
  category: ModalityCategory;
  modality: string;
  tier: Tier;
  gate: string | null;   // the hard requirement that blocked/capped it (audit trail)
  basis: string[];       // evidence bullets that justify the tier (deterministic)
  rationale?: string;    // one-line explanation of the tier — LLM, restricted to `basis`
}

export interface ModalityFitResult {
  gene: string; goal: MechanisticGoal; goalText: string;
  evidence: ModalityEvidence;
  modalities: ModalityAssessment[];
  provenance: string;
  generatedNote: string;
}

// ── UniProt: subcellular location, TRANSMEMBRANE + SIGNAL peptide (5a), active sites, sequence ──
async function fetchUniProt(gene: string): Promise<Partial<ModalityEvidence> & { _keywords?: string }> {
  try {
    const q = `gene_exact:${encodeURIComponent(gene)} AND organism_id:9606 AND reviewed:true`;
    const url = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(q)}&fields=accession,cc_subcellular_location,ft_act_site,ft_transmem,ft_signal,keyword,sequence&format=json&size=1`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return {};
    const j: any = await r.json();
    const e = j?.results?.[0];
    if (!e) return {};
    const seq: string = e.sequence?.value || '';
    const locs: string[] = [];
    for (const c of e.comments || []) {
      if (c.commentType === 'SUBCELLULAR LOCATION') {
        for (const l of c.subcellularLocations || []) { const v = l.location?.value; if (v) locs.push(v); }
      }
    }
    const feats: any[] = e.features || [];
    const activeSites = feats.filter(f => f.type === 'Active site').length;
    const hasTransmembrane = feats.some(f => f.type === 'Transmembrane');
    const hasSignalPeptide = feats.some(f => f.type === 'Signal');
    const keywords = (e.keywords || []).map((k: any) => String(k.name || '').toLowerCase()).join(' ');
    // 5f — ubiquitination evidence: the "Ubl conjugation" keyword, or a ubiquitin isopeptide cross-link.
    const isUbiquitinated = /ubl conjugation/.test(keywords) ||
      feats.some(f => f.type === 'Cross-link' && /isopeptide|ubiquitin/i.test(f.description || ''));
    const locStr = locs.join(' ').toLowerCase();
    const isMembrane = hasTransmembrane || /membrane/.test(locStr) || /membrane/.test(keywords);
    const isSecreted = /secreted|extracellular/.test(locStr) || /secreted/.test(keywords);
    return {
      uniprot: e.primaryAccession || null,
      subcellularLocations: locs,
      isMembrane, isSecreted,
      isIntracellular: locs.length > 0 && !isSecreted && !isMembrane,
      hasTransmembrane, hasSignalPeptide,
      sequenceLength: seq.length || null,
      cysCount: seq ? (seq.match(/C/g) || []).length : null,
      lysineCount: seq ? (seq.match(/K/g) || []).length : null,
      isUbiquitinated,
      activeSiteCount: activeSites || null,
      likelyEnzyme: activeSites > 0,
      _keywords: keywords,
    };
  } catch { return {}; }
}

// ── Transient-failure handling for the public evidence APIs. All of them (ChEMBL, HPA,
// STRING, Ensembl) blip under the benchmark's parallel load, and a blip silently degrades
// a target's evidence to null — which reads as "no evidence" rather than "not fetched".
// `getJSON` throws only on RETRYABLE failures (network error, 429, 5xx); a definitive 4xx
// returns null so we don't hammer it. `withRetry` gives each fetcher one second chance. ──
const UA = 'Disease2Target/1.0 (academic research; contact via app)';

async function getJSON(url: string, headers: Record<string, string> = {}): Promise<any> {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers } });
  if (!r.ok) {
    if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);  // transient → retry
    return null;                                                                   // definitive → give up
  }
  return r.json();
}

// Two retries with a widening gap (0.4s, 1.2s): a single short retry is not enough — an
// Ensembl 500 blip took out the JUN single-exon gate in a benchmark run because both
// attempts fell inside the same bad window.
async function withRetry<T>(attempt: () => Promise<T>, fallback: T, delaysMs = [400, 1200]): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await attempt(); }
    catch {
      if (i >= delaysMs.length) return fallback;
      await new Promise(r => setTimeout(r, delaysMs[i]));
    }
  }
}

// ── HPA (Human Protein Atlas): a second surface/secretome opinion for antibody accessibility. ──
const HPA_NONE = { hpaSurface: null, hpaSecreted: null };
async function fetchHPA(gene: string): Promise<{ hpaSurface: boolean | null; hpaSecreted: boolean | null }> {
  return withRetry(async () => {
    const url = `https://www.proteinatlas.org/api/search_download.php?search=${encodeURIComponent(gene)}&format=json&columns=g,pc&compress=no`;
    const j: any = await getJSON(url);
    const rows: any[] = Array.isArray(j) ? j : [];
    const row = rows.find(x => String(x.Gene || x.g || '').toUpperCase() === gene.toUpperCase()) || rows[0];
    if (!row) return HPA_NONE;
    const pc = String(row['Protein class'] ?? row.pc ?? '').toLowerCase();
    if (!pc) return HPA_NONE;
    return {
      hpaSurface:  /membrane|cd markers|transporter|receptor|voltage-gated|g-protein coupled/.test(pc),
      hpaSecreted: /secreted|plasma protein/.test(pc),
    };
  }, HPA_NONE);
}

// ── 5b: ChEMBL bioactivity count — the empirical "chemical matter exists" anchor for small
// molecule (the reviewer: no in-silico score beats a measured ligand). UniProt → ChEMBL target
// → total activities. ──
async function fetchChEMBL(uniprot: string | null): Promise<{ chemblActivities: number | null }> {
  if (!uniprot) return { chemblActivities: null };
  return withRetry(async () => {
    const tj: any = await getJSON(`https://www.ebi.ac.uk/chembl/api/data/target.json?target_components__accession=${encodeURIComponent(uniprot)}&limit=5`);
    const ids: string[] = (tj?.targets || []).map((t: any) => t.target_chembl_id).filter(Boolean);
    if (!ids.length) return { chemblActivities: tj ? 0 : null };   // resolved-but-empty ≠ not fetched
    const aj: any = await getJSON(`https://www.ebi.ac.uk/chembl/api/data/activity.json?target_chembl_id=${ids[0]}&limit=1`);
    return { chemblActivities: aj?.page_meta?.total_count ?? null };
  }, { chemblActivities: null });
}

// ── 5c: STRING high-confidence interaction partners — an interface exists to disrupt
// (peptide / interaction-disrupting biologic). ──
async function fetchSTRING(gene: string): Promise<{ ppiPartners: number | null }> {
  return withRetry(async () => {
    const url = `https://string-db.org/api/json/interaction_partners?identifiers=${encodeURIComponent(gene)}&species=9606&required_score=700&limit=50`;
    const j: any = await getJSON(url);
    return { ppiPartners: Array.isArray(j) ? j.length : null };
  }, { ppiPartners: null });
}

// ── 5d: Ensembl canonical-transcript exon count — a single-exon gene has no splicing event
// to switch (splice-switching ASO is ruled out); multi-exon is necessary but not sufficient. ──
async function fetchEnsembl(gene: string): Promise<{ exonCount: number | null }> {
  return withRetry(async () => {
    const url = `https://rest.ensembl.org/lookup/symbol/homo_sapiens/${encodeURIComponent(gene)}?expand=1;content-type=application/json`;
    const j: any = await getJSON(url);
    const trs: any[] = j?.Transcript || [];
    if (!trs.length) return { exonCount: null };
    const canon = trs.find(t => t.is_canonical === 1) || trs.reduce((a, b) => ((b.Exon?.length || 0) > (a.Exon?.length || 0) ? b : a), trs[0]);
    return { exonCount: canon?.Exon?.length ?? null };
  }, { exonCount: null });
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
// Descriptor-based druggability PROXY (not the published drugScore). Bigger + more
// enclosed + more hydrophobic pocket ⇒ more small-molecule-tractable.
function druggabilityProxy(p: any): number | null {
  if (!p) return null;
  const vol = clamp01((p.volume || 0) / 1000);
  const enc = clamp01(p.enclosure || 0);
  const hyd = clamp01(p.hydrophobicity || 0);
  return Number((0.5 * vol + 0.3 * enc + 0.2 * hyd).toFixed(3));
}

// ── Did this symbol resolve to a real protein at all? ───────────────────────
// Every source degrades gracefully, which is right for a real gene whose structure or
// ChEMBL entry is missing — and wrong for a symbol that does not exist. A typo used to
// return a confident-looking result, because RNA/genetic modalities are structure-
// independent and therefore Plausible on no evidence whatsoever: "PHDGH" and
// "NOTAGENE123" both came back "Plausible · Expression / genetic modulation".
//
// Four independent services can each resolve a symbol (UniProt, Open Targets, STRING,
// Ensembl), so a real gene answers on at least one of them. Requiring ALL of them to be
// silent before declaring "not resolved" keeps a single API outage from wrongly rejecting
// a genuine target.
export function isEvidenceResolved(ev: ModalityEvidence): boolean {
  return !!ev.uniprot
    || ev.pocket.hasStructure
    || ev.chemblActivities != null
    || ev.ppiPartners != null
    || ev.exonCount != null
    || ev.tractabilityBuckets.length > 0
    || ev.provenModalities.length > 0;
}

// ── Evidence cache ──────────────────────────────────────────────────────────
// gatherModalityEvidence hits eight APIs and is dominated by one slow call (Ensembl: 25-36s
// cold). That is tolerable once for a single gene, and hopeless for a 50-gene board column.
// The result is a pure function of the gene, so it is cached for the process lifetime with a
// TTL: the batch pays the cost once, and a re-run of the same gene is instant.
const EVIDENCE_TTL_MS = 6 * 60 * 60 * 1000;   // 6h — public annotations do not move faster
const evidenceCache = new Map<string, { at: number; ev: ModalityEvidence }>();

export async function gatherModalityEvidenceCached(gene: string): Promise<ModalityEvidence> {
  const key = (gene || '').toUpperCase();
  const hit = evidenceCache.get(key);
  if (hit && Date.now() - hit.at < EVIDENCE_TTL_MS) return hit.ev;
  const ev = await gatherModalityEvidence(key);
  // Only cache a result that actually resolved the protein. Caching a failed gather would
  // pin a "no evidence" answer for six hours on what is usually a transient API blip.
  if (ev.uniprot || ev.pocket.hasStructure || ev.chemblActivities != null) {
    evidenceCache.set(key, { at: Date.now(), ev });
  }
  return ev;
}

// ── Compact per-gene summary, for the board column ──────────────────────────
// The full 12-row chart is far too much for a table cell. What a ranked list needs is the
// single best available route and whether anything is hard-blocked.
export interface ModalitySummary {
  gene: string;
  goal: MechanisticGoal;
  resolved: boolean;          // false = no source recognised this symbol; tiers are meaningless

  best: { modality: string; category: string; tier: Tier } | null;
  // Best tier reached within each of the 5 categories — this is what a comparison across
  // targets needs: "which of these is the better small-molecule target?" is a per-category
  // question, and a single overall best hides it.
  byCategory: Record<string, Tier>;
  counts: Record<Tier, number>;
  blocked: string[];          // modalities ruled out by a hard gate
  error?: string;
}

export async function summariseModality(gene: string, goal: MechanisticGoal): Promise<ModalitySummary> {
  const empty: Record<Tier, number> = { Precedented: 0, Plausible: 0, Speculative: 0, Blocked: 0 };
  try {
    const ev = await gatherModalityEvidenceCached(gene);
    // Do not tier an unrecognised symbol. Returning "Plausible" for a typo is worse than
    // returning nothing, because it looks like an answer.
    if (!isEvidenceResolved(ev)) {
      return { gene: gene.toUpperCase(), goal, resolved: false, best: null, counts: { ...empty }, byCategory: {}, blocked: [] };
    }
    const rows = assessModalities(ev, goal);          // already sorted best-tier-first
    const counts = { ...empty };
    const byCategory: Record<string, Tier> = {};
    for (const r of rows) {
      counts[r.tier]++;
      const cur = byCategory[r.category];
      if (!cur || TIER_RANK[r.tier] > TIER_RANK[cur]) byCategory[r.category] = r.tier;
    }
    const top = rows[0] ?? null;
    return {
      gene: gene.toUpperCase(), goal, resolved: true, counts, byCategory,
      best: top ? { modality: top.modality, category: top.category, tier: top.tier } : null,
      blocked: rows.filter(r => r.tier === 'Blocked').map(r => r.modality),
    };
  } catch (e: any) {
    return { gene: gene.toUpperCase(), goal, resolved: false, best: null, counts: { ...empty }, byCategory: {}, blocked: [], error: String(e?.message || e).slice(0, 160) };
  }
}

// Bounded-concurrency batch. The cap is deliberate: each miss costs several seconds of
// upstream API time, and firing 50 at once would both stall and risk rate-limiting.
export async function summariseModalityBatch(genes: string[], goal: MechanisticGoal, concurrency = 4): Promise<ModalitySummary[]> {
  const queue = [...genes];
  const out: ModalitySummary[] = [];
  const worker = async () => {
    for (;;) {
      const g = queue.shift();
      if (!g) return;
      out.push(await summariseModality(g, goal));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, genes.length)) }, worker));
  // Preserve caller order — workers finish out of order and a board column must line up.
  const byGene = new Map(out.map(r => [r.gene, r]));
  return genes.map(g => byGene.get(g.toUpperCase())!).filter(Boolean);
}

// ── M1: gather the evidence (each source independent; a failure degrades gracefully) ──
export async function gatherModalityEvidence(gene: string): Promise<ModalityEvidence> {
  const [modR, pkR, uniR, hpaR, strR, ensR] = await Promise.allSettled([
    getModalityProfile(gene),
    getPocketStructure(gene),
    fetchUniProt(gene),
    fetchHPA(gene),
    fetchSTRING(gene),
    fetchEnsembl(gene),
  ]);
  const mod = modR.status === 'fulfilled' ? modR.value : null;
  const pk = pkR.status === 'fulfilled' ? pkR.value : null;
  const uni = (uniR.status === 'fulfilled' ? uniR.value : {}) as Partial<ModalityEvidence>;
  const hpa = hpaR.status === 'fulfilled' ? hpaR.value : { hpaSurface: null, hpaSecreted: null };
  const ppi = strR.status === 'fulfilled' ? strR.value : { ppiPartners: null };
  const ens = ensR.status === 'fulfilled' ? ensR.value : { exonCount: null };
  // ChEMBL depends on the resolved UniProt accession, so fetch it after UniProt.
  const chembl = await fetchChEMBL(uni.uniprot ?? pk?.uniprot ?? null).catch(() => ({ chemblActivities: null }));

  const top = pk?.pockets?.[0] || null;
  // 5g — classify EACH detected pocket by druggable SHAPE, not just size. Per the review, a
  // huge (>1200 Å³) PPI-interface pocket is HARDER, not easier; drug-bindable pockets are
  // enclosed and drug-sized (~150–1200 Å³). Thresholds are explicit (not a hidden score).
  const pockets: any[] = pk?.pockets ?? [];
  const T = MODALITY_THRESHOLDS;
  const isDruggableShape = (p: any) => { const v = p?.volume ?? 0, e = p?.enclosure ?? 0; return v >= T.pocketMinVolume && v <= T.pocketMaxVolume && e >= T.pocketMinEnclosure; };
  const druggable = pockets.filter(isDruggableShape);
  const druggablePockets = druggable.length;
  const bestEnclosure = druggable.length ? Math.max(...druggable.map(p => p.enclosure ?? 0)) : null;
  const notes: string[] = [];
  if (!pk || pk.structure?.kind === 'none') notes.push('No 3D structure resolved — pocket-based (small-molecule/covalent) reasoning is limited.');
  if (pk && pk.structure?.kind === 'alphafold') notes.push('Pocket assessment is on an AlphaFold model (one, often-closed conformation) — a hypothesis, not a measurement.');
  if (pk && pk.structure?.kind !== 'none' && druggablePockets === 0 && (pk.totalPockets ?? 0) > 0) notes.push('No druggable-shaped pocket in this structure — cryptic/allosteric pockets are NOT predicted (apo/AF structures can hide sites; FTMap/PocketMiner not integrated).');
  if (!mod || mod.error) notes.push('Open Targets tractability unavailable — modality assessment falls back to structure/sequence only.');
  if (!uni.uniprot) notes.push('UniProt annotation unavailable — localization / active-site reasoning is limited.');

  // 5a — antibody accessibility. UniProt features (transmembrane, signal peptide, curated
  // location) are authoritative and specific. HPA "protein class" is noisy ("plasma proteins"
  // ≠ surface-accessible), so it ONLY breaks a genuine 'unknown' tie, and only for membrane —
  // never to call something secreted (that caused false positives on PHGDH/MAPT).
  // Surface = the curated TRANSMEMBRANE feature only. The location string "membrane" is
  // unreliable (cytoplasmic-face association, e.g. tau's "Cell membrane" ≠ extracellular epitope).
  const uSurface  = !!uni.hasTransmembrane;
  const uSecreted = !!(uni.isSecreted || (uni.hasSignalPeptide && !uni.hasTransmembrane));
  const uKnown    = uSurface || uSecreted || (uni.subcellularLocations?.length ?? 0) > 0;
  const surfaceAccess: ModalityEvidence['surfaceAccess'] =
    uSurface ? 'surface'
    : uSecreted ? 'secreted'
    : uKnown ? 'intracellular'
    : hpa.hpaSurface ? 'surface'
    : 'unknown';
  const srcBits: string[] = [];
  if (uni.hasTransmembrane) srcBits.push('UniProt transmembrane');
  if (uni.hasSignalPeptide) srcBits.push('UniProt signal peptide');
  if (uni.subcellularLocations?.length) srcBits.push('UniProt location');
  if (!uKnown && hpa.hpaSurface) srcBits.push('HPA membrane class');
  const surfaceSource = srcBits.join(' + ') || 'no accessibility evidence';
  if (surfaceAccess === 'unknown') notes.push('No localization/surfaceome evidence — antibody accessibility unconfirmed.');

  return {
    gene,
    uniprot: uni.uniprot ?? pk?.uniprot ?? null,
    subcellularLocations: uni.subcellularLocations ?? [],
    isMembrane: uni.isMembrane ?? false,
    isSecreted: uni.isSecreted ?? false,
    isIntracellular: uni.isIntracellular ?? false,
    hasTransmembrane: uni.hasTransmembrane ?? false,
    hasSignalPeptide: uni.hasSignalPeptide ?? false,
    surfaceAccess, surfaceSource,
    sequenceLength: uni.sequenceLength ?? null,
    cysCount: uni.cysCount ?? null,
    lysineCount: uni.lysineCount ?? null,
    isUbiquitinated: uni.isUbiquitinated ?? false,
    activeSiteCount: uni.activeSiteCount ?? null,
    likelyEnzyme: uni.likelyEnzyme ?? false,
    pocket: {
      hasStructure: !!(pk && pk.structure?.kind !== 'none'),
      structureLabel: pk?.structure?.label ?? null,
      totalPockets: pk?.totalPockets ?? 0,
      druggablePockets,
      bestEnclosure,
      topVolume: top?.volume ?? null,
      topEnclosure: top?.enclosure ?? null,
      topDepth: top?.depth ?? null,
      druggabilityProxy: druggabilityProxy(top),
    },
    tractabilityBuckets: (mod?.prediction?.buckets ?? []).map((b: any) => ({ code: b.code, modality: b.modality, labels: b.labels })),
    provenModalities: (mod?.fact?.developed ?? []).map((d: any) => ({ family: d.family, drugCount: d.drugCount, topStage: d.topStage })),
    chemblActivities: chembl.chemblActivities,
    ppiPartners: ppi.ppiPartners,
    exonCount: ens.exonCount,
    notes,
  };
}

// ── M2a: DETERMINISTIC tier engine. Hard modality×goal + localization gates set the
// tier; the LLM never touches it (per the review — reproducible, calibrated, auditable). ──
const cap = (a: Tier, b: Tier): Tier => (TIER_RANK[a] <= TIER_RANK[b] ? a : b);

export function assessModalities(ev: ModalityEvidence, goal: MechanisticGoal): ModalityAssessment[] {
  const extracellular = ev.surfaceAccess === 'surface' || ev.surfaceAccess === 'secreted'; // antibody-accessible (5a)
  const secreted      = ev.surfaceAccess === 'secreted';                // no cytoplasmic portion → no UPS access for degraders
  const hasStruct     = ev.pocket.hasStructure;
  const hasPocket     = hasStruct && ev.pocket.totalPockets > 0;                 // ANY pocket = a handle (PROTAC)
  const hasDruggablePocket = (ev.pocket.druggablePockets ?? 0) > 0;              // 5g — a druggable-SHAPED pocket (SM)
  const multiPocket   = (ev.pocket.totalPockets ?? 0) >= MODALITY_THRESHOLDS.multiPocketMin;                      // 5g — an allosteric option may exist
  const smBucket      = ev.tractabilityBuckets.some(b => b.code === 'SM');
  const prBucket      = ev.tractabilityBuckets.some(b => b.code === 'PR');
  const hasCys        = (ev.cysCount ?? 0) > 0;
  const chemMatter    = (ev.chemblActivities ?? 0) >= MODALITY_THRESHOLDS.chemblChemicalMatter;   // 5b — measured ligands exist
  const hasPPI        = (ev.ppiPartners ?? 0) > 0;           // 5c — an interface to disrupt
  const fams          = new Set(ev.provenModalities.map(p => p.family));
  const provenSM      = fams.has('Small molecule');
  const provenBio     = fams.has('Biologic');
  const provenOligo   = fams.has('Oligonucleotide (RNA/ASO)');

  const isDegrader  = (m: string) => m.includes('PROTAC') || m.includes('Molecular glue');
  const isKnockdown = (m: string) => m.includes('RNA knockdown') || m.includes('Expression / genetic');
  const isSplice    = (m: string) => m.includes('Splice-switching');
  const isOccSM     = (m: string) => m.includes('Conventional small molecule') || m.includes('Covalent') || m.includes('Fragments');
  const isPeptide   = (m: string) => m.includes('peptide');
  const isAntibody  = (m: string) => m.includes('Antibody');
  const isInterDis  = (m: string) => m.includes('Interaction-disrupting');

  const out = MODALITY_TAXONOMY.map(({ category, modality }) => {
    const basis: string[] = [];
    let tier: Tier = 'Speculative';
    let gate: string | null = null;

    // ── base tier from evidence + clinical precedent ──
    if (isOccSM(modality)) {
      if (modality.includes('Conventional') && provenSM) { tier = 'Precedented'; basis.push('a small-molecule drug is developed for this target'); }
      else if (chemMatter || smBucket || hasDruggablePocket) {
        tier = 'Plausible';
        if (chemMatter) basis.push(`${ev.chemblActivities} measured bioactivities in ChEMBL — chemical matter exists`);
        else if (hasDruggablePocket) basis.push(`${ev.pocket.druggablePockets} druggable-shaped pocket(s) of ${ev.pocket.totalPockets} (enclosed, drug-sized)`);
        else basis.push('Open Targets rates it small-molecule tractable');
      } else if (hasPocket) {
        tier = 'Speculative'; basis.push(`${ev.pocket.totalPockets} pocket(s) detected but none druggable-shaped (shallow or large/interface)`);
      } else { tier = 'Speculative'; basis.push('no pocket, tractability, or ChEMBL chemical-matter evidence'); }
      if (modality.includes('Covalent') && !hasCys) { tier = cap(tier, 'Speculative'); basis.push('no cysteines for a covalent warhead'); }
      if (modality.includes('Fragments') && !hasStruct) { tier = cap(tier, 'Speculative'); basis.push('no 3D structure for fragment screening'); }
    } else if (isAntibody(modality)) {
      if (extracellular) {
        tier = provenBio ? 'Precedented' : 'Plausible';
        basis.push(provenBio ? 'a biologic is developed for this target' : `target is ${ev.surfaceAccess} — antibody-accessible (${ev.surfaceSource})`);
      } else if (ev.surfaceAccess === 'intracellular') {
        tier = 'Speculative';
        gate = 'intracellular — a conventional antibody cannot reach it (intrabody only, delivery-hard)';
        basis.push(`intracellular (${ev.surfaceSource})`);
      } else {
        tier = 'Speculative';
        gate = 'antibody accessibility unconfirmed (no surface/secreted evidence)';
        basis.push('no localization/surfaceome evidence');
      }
    } else if (isInterDis(modality)) {
      if (hasPPI) { tier = 'Plausible'; basis.push(`${ev.ppiPartners} high-confidence STRING partners — an interface exists to disrupt`); }
      else { tier = 'Speculative'; basis.push('no high-confidence interaction partners found'); }
    } else if (isDegrader(modality)) {
      if (secreted) { tier = 'Blocked'; gate = 'secreted/extracellular — no ubiquitin–proteasome access'; }
      else if (hasPocket || prBucket) {
        tier = 'Plausible';
        basis.push(prBucket ? 'Open Targets rates it PROTAC-tractable' : 'a ligandable pocket (handle) is present');
        if (ev.isUbiquitinated) basis.push('known ubiquitination — degradation-compatible');        // 5f
        if (ev.lysineCount != null) basis.push(`${ev.lysineCount} lysines for ubiquitin transfer`);   // 5e
        basis.push('CRBN/VHL E3 ligases broadly expressed (confirm in disease tissue)');
      } else { tier = 'Speculative'; basis.push('no ligandable handle (pocket) found'); }
      if (modality.includes('Molecular glue')) { tier = cap(tier, 'Speculative'); basis.push('glues are largely serendipity-driven'); }
    } else if (isKnockdown(modality)) {
      tier = provenOligo && modality.includes('RNA knockdown') ? 'Precedented' : 'Plausible';
      basis.push('acts at the transcript level (structure-independent)'); basis.push('delivery to the disease tissue is the real constraint');
    } else if (isSplice(modality)) {
      const ex = ev.exonCount;
      if (ex != null && ex <= MODALITY_THRESHOLDS.singleExonMax) { tier = 'Blocked'; gate = `single-exon transcript (${ex}) — no splicing event to switch`; }
      else if (ex != null) { tier = 'Speculative'; basis.push(`multi-exon transcript (${ex} exons) — splicing exists, but a specific targetable event is unconfirmed`); }
      else { tier = 'Speculative'; basis.push('transcript/exon model not resolved'); }
    } else if (isPeptide(modality)) {
      if (hasPPI) { tier = 'Plausible'; basis.push(`${ev.ppiPartners} high-confidence STRING partners — a PPI interface to target`); }
      else { tier = 'Speculative'; basis.push('no clear interaction interface'); }
      basis.push('intracellular delivery/permeability is the constraint');
      if (modality.includes('Linear')) { tier = cap(tier, 'Speculative'); basis.push('linear peptides: poor permeability & stability'); }
    }

    // ── goal × modality compatibility (hard caps) ──
    if (goal === 'spare_catalytic') {
      if (isDegrader(modality) || isKnockdown(modality)) { tier = 'Blocked'; gate = 'removes the protein — cannot spare its catalytic activity'; }
      else if (isSplice(modality)) { tier = cap(tier, 'Speculative'); basis.push('alters the transcript — catalytic function not guaranteed'); }
      else if (isOccSM(modality)) {
        tier = cap(tier, 'Plausible');
        if (ev.likelyEnzyme && multiPocket) basis.push('multiple pockets present — an allosteric (non-catalytic) site is plausible');
        else basis.push('must bind allosterically (not the active site) to spare catalysis');
      }
    } else if (goal === 'reduce_level') {
      if (isOccSM(modality) || isAntibody(modality) || isPeptide(modality) || isInterDis(modality)) {
        tier = cap(tier, 'Speculative'); if (!gate) gate = 'occupancy does not change protein level';
      }
    } else if (goal === 'restore_function') {
      // Gain of function inverts most of the scheme: anything that REMOVES the target
      // defeats the goal, while splice correction becomes the lead modality rather than a
      // capped afterthought (nusinersen, eteplirsen, risdiplam).
      if (isDegrader(modality) || isKnockdown(modality)) {
        if (modality.includes('Expression / genetic')) {
          // Expression modulation is bidirectional — gene replacement and upregulation
          // increase functional protein, so it is NOT blocked here.
          basis.push('expression modulation can raise as well as lower protein level');
        } else {
          tier = 'Blocked'; gate = 'removes the target — cannot restore its function';
        }
      } else if (isSplice(modality)) {
        // The exon gate above already Blocked single-exon transcripts; a multi-exon gene has
        // a splicing event that CAN be redirected, which is exactly this goal's mechanism.
        if (tier !== 'Blocked') { tier = 'Plausible'; basis.push('splice correction directly restores functional protein when a targetable event exists'); }
      } else if (isInterDis(modality)) {
        tier = cap(tier, 'Speculative'); basis.push('disrupting an interface does not restore function');
      } else if (isOccSM(modality) || isAntibody(modality) || isPeptide(modality)) {
        basis.push('requires an activating/corrector mechanism, not blockade — less common than inhibition');
      }
    } else if (goal === 'degrade') {
      if (isOccSM(modality) || isAntibody(modality) || isPeptide(modality) || isInterDis(modality)) {
        tier = cap(tier, 'Speculative'); basis.push('inhibits but does not remove the protein');
      }
    }
    // goal 'inhibit' — no additional caps

    return { category, modality, tier, gate, basis };
  });

  return out.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
}

// ── M2b: rationale ONLY. The LLM writes one line per modality EXPLAINING the fixed tier,
// restricted to the provided basis — it cannot change the tier or add new facts (temp 0). ──
export function buildRationalePrompt(ev: ModalityEvidence, goal: MechanisticGoal, rows: ModalityAssessment[]): string {
  const lines = rows.map(r => `- ${r.modality} → TIER=${r.tier}${r.gate ? ` · GATE: ${r.gate}` : ''} · BASIS: ${r.basis.join('; ') || 'none'}`).join('\n');
  return [
    `For target ${ev.gene}, each therapeutic modality below has ALREADY been assigned a tier (Precedented > Plausible > Speculative > Blocked) by deterministic rules, for the goal: "${MECHANISTIC_GOALS[goal]}".`,
    `Write a ONE-LINE rationale (max 90 chars) for each modality that EXPLAINS its tier using ONLY the BASIS/GATE listed for it. Do NOT change the tier. Do NOT introduce any fact not in its basis. Plain, factual.`,
    ``,
    lines,
    ``,
    `Return ONLY a JSON array: [{"modality":"<exact name>","rationale":"<=90 chars"}]`,
  ].join('\n');
}

const normName = (s: string) => s.replace(/\s*\[[^\]]*\]\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Attach the LLM rationales to the deterministic rows (tier is never touched). If the model
// dropped a row or errored, fall back to a rationale synthesised from the basis/gate.
export function attachRationales(rows: ModalityAssessment[], text: string): ModalityAssessment[] {
  let arr: any[] = [];
  try { const s = text.indexOf('['), e = text.lastIndexOf(']'); arr = JSON.parse(s >= 0 && e > s ? text.slice(s, e + 1) : text); } catch { arr = []; }
  const byName = new Map<string, string>();
  for (const o of Array.isArray(arr) ? arr : []) if (o && typeof o.modality === 'string' && o.rationale) byName.set(normName(o.modality), String(o.rationale));
  return rows.map(r => {
    const key = normName(r.modality);
    let rat = byName.get(key) || '';
    if (!rat) for (const [k, v] of byName) if (k.startsWith(key) || key.startsWith(k)) { rat = v; break; }
    if (!rat) rat = r.gate || r.basis[0] || TIER_DEF[r.tier];   // deterministic fallback
    return { ...r, rationale: rat.slice(0, 120) };
  });
}
