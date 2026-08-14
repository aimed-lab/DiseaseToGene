// modalityFitService.ts ─────────────────────────────────────────────────────
// F-MOD — On-demand "modality fit" analysis for ONE target (the professor's
// modality bar-chart). Whole-protein, hybrid engine:
//   1) gather HARD evidence deterministically (OT tractability + developed drugs,
//      DoGSite pocket descriptors, UniProt localization / active-site / sequence),
//   2) let Gemini synthesise a 0–5 plausibility + one-line rationale per modality,
//      GROUNDED strictly in that evidence and the chosen mechanistic goal.
// Scores are AI-assessed PREDICTIONS (kept separate from the facts, per the
// project's fact/prediction rule). Public APIs only → runs locally and on Vercel.

import { getModalityProfile } from './modalityService.js';
import { getPocketStructure } from './dogsiteService.js';

// ── Mechanistic goal (changes the scoring — e.g. catalytic sparing) ──
export type MechanisticGoal = 'inhibit' | 'degrade' | 'reduce_level' | 'spare_catalytic';
export const MECHANISTIC_GOALS: Record<MechanisticGoal, string> = {
  inhibit:        'Inhibit or block the target’s function (engage and antagonise it).',
  degrade:        'Remove the target protein entirely via induced degradation.',
  reduce_level:   'Lower the amount of target protein / mRNA (knockdown or expression modulation).',
  spare_catalytic:'Modulate the target WITHOUT abolishing its catalytic/enzymatic activity (spare the active site).',
};
export const isGoal = (g: any): g is MechanisticGoal => typeof g === 'string' && g in MECHANISTIC_GOALS;

// ── The 12-modality taxonomy, grouped into the 5 chart categories ──
export const MODALITY_CATEGORIES = ['Biologic', 'RNA/genetic', 'Peptide', 'Induced-proximity', 'Small molecule'] as const;
export type ModalityCategory = typeof MODALITY_CATEGORIES[number];
export const MODALITY_TAXONOMY: { category: ModalityCategory; modality: string }[] = [
  { category: 'Biologic',        modality: 'Antibody / intrabody' },
  { category: 'Biologic',        modality: 'Interaction-disrupting biologic' },
  { category: 'RNA/genetic',     modality: 'Expression / genetic modulation' },
  { category: 'RNA/genetic',     modality: 'RNA knockdown (siRNA/gapmer ASO)' },
  { category: 'RNA/genetic',     modality: 'Splice-switching ASO' },
  { category: 'Peptide',         modality: 'Stapled / macrocyclic peptide' },
  { category: 'Peptide',         modality: 'Linear peptide' },
  { category: 'Induced-proximity', modality: 'Molecular glue' },
  { category: 'Induced-proximity', modality: 'PROTAC / degrader' },
  { category: 'Small molecule',  modality: 'Covalent ligand' },
  { category: 'Small molecule',  modality: 'Fragments' },
  { category: 'Small molecule',  modality: 'Conventional small molecule' },
];

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
  activeSiteCount: number | null;   // annotated catalytic/active-site residues
  likelyEnzyme: boolean;
  pocket: {
    hasStructure: boolean;
    structureLabel: string | null;
    totalPockets: number;
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

// Anchored ordinal tiers replace the old 0–5 LLM number (per the methodology review):
// they calibrate far better and are set DETERMINISTICALLY, so the tool is reproducible.
export type Tier = 'Precedented' | 'Plausible' | 'Speculative' | 'Blocked';
export const TIER_RANK: Record<Tier, number> = { Blocked: 0, Speculative: 1, Plausible: 2, Precedented: 3 };
export const TIER_DEF: Record<Tier, string> = {
  Precedented: 'A drug of this modality has reached the clinic for this target.',
  Plausible:   'Hard requirements met and tractability supportive, but no drug yet.',
  Speculative: 'Requirements met but key evidence is weak or not gathered.',
  Blocked:     'A hard requirement fails — this modality cannot work here.',
};

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
      activeSiteCount: activeSites || null,
      likelyEnzyme: activeSites > 0,
      _keywords: keywords,
    };
  } catch { return {}; }
}

// ── HPA (Human Protein Atlas): a second surface/secretome opinion for antibody accessibility. ──
async function fetchHPA(gene: string): Promise<{ hpaSurface: boolean | null; hpaSecreted: boolean | null }> {
  try {
    const url = `https://www.proteinatlas.org/api/search_download.php?search=${encodeURIComponent(gene)}&format=json&columns=g,pc&compress=no`;
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Disease2Target/1.0 (academic research)' } });
    if (!r.ok) return { hpaSurface: null, hpaSecreted: null };
    const j: any = await r.json();
    const rows: any[] = Array.isArray(j) ? j : [];
    const row = rows.find(x => String(x.Gene || x.g || '').toUpperCase() === gene.toUpperCase()) || rows[0];
    if (!row) return { hpaSurface: null, hpaSecreted: null };
    const pc = String(row['Protein class'] ?? row.pc ?? '').toLowerCase();
    if (!pc) return { hpaSurface: null, hpaSecreted: null };
    return {
      hpaSurface:  /membrane|cd markers|transporter|receptor|voltage-gated|g-protein coupled/.test(pc),
      hpaSecreted: /secreted|plasma protein/.test(pc),
    };
  } catch { return { hpaSurface: null, hpaSecreted: null }; }
}

// ── 5b: ChEMBL bioactivity count — the empirical "chemical matter exists" anchor for small
// molecule (the reviewer: no in-silico score beats a measured ligand). UniProt → ChEMBL target
// → total activities. ──
async function fetchChEMBL(uniprot: string | null): Promise<{ chemblActivities: number | null }> {
  if (!uniprot) return { chemblActivities: null };
  try {
    const tr = await fetch(`https://www.ebi.ac.uk/chembl/api/data/target.json?target_components__accession=${encodeURIComponent(uniprot)}&limit=5`, { headers: { Accept: 'application/json' } });
    if (!tr.ok) return { chemblActivities: null };
    const tj: any = await tr.json();
    const ids: string[] = (tj?.targets || []).map((t: any) => t.target_chembl_id).filter(Boolean);
    if (!ids.length) return { chemblActivities: 0 };
    const ar = await fetch(`https://www.ebi.ac.uk/chembl/api/data/activity.json?target_chembl_id=${ids[0]}&limit=1`, { headers: { Accept: 'application/json' } });
    if (!ar.ok) return { chemblActivities: null };
    const aj: any = await ar.json();
    return { chemblActivities: aj?.page_meta?.total_count ?? null };
  } catch { return { chemblActivities: null }; }
}

// ── 5c: STRING high-confidence interaction partners — an interface exists to disrupt
// (peptide / interaction-disrupting biologic). ──
async function fetchSTRING(gene: string): Promise<{ ppiPartners: number | null }> {
  try {
    const url = `https://string-db.org/api/json/interaction_partners?identifiers=${encodeURIComponent(gene)}&species=9606&required_score=700&limit=50`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return { ppiPartners: null };
    const j: any = await r.json();
    return { ppiPartners: Array.isArray(j) ? j.length : null };
  } catch { return { ppiPartners: null }; }
}

// ── 5d: Ensembl canonical-transcript exon count — a single-exon gene has no splicing event
// to switch (splice-switching ASO is ruled out); multi-exon is necessary but not sufficient. ──
async function fetchEnsembl(gene: string): Promise<{ exonCount: number | null }> {
  const attempt = async (): Promise<number | null> => {
    const url = `https://rest.ensembl.org/lookup/symbol/homo_sapiens/${encodeURIComponent(gene)}?expand=1;content-type=application/json`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    const j: any = await r.json();
    const trs: any[] = j?.Transcript || [];
    if (!trs.length) return null;
    const canon = trs.find(t => t.is_canonical === 1) || trs.reduce((a, b) => ((b.Exon?.length || 0) > (a.Exon?.length || 0) ? b : a), trs[0]);
    return canon?.Exon?.length ?? null;
  };
  // Ensembl REST is flaky under parallel load — one retry absorbs a transient 429/blip.
  try { return { exonCount: await attempt() }; }
  catch { try { await new Promise(r => setTimeout(r, 400)); return { exonCount: await attempt() }; } catch { return { exonCount: null }; } }
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
  const notes: string[] = [];
  if (!pk || pk.structure?.kind === 'none') notes.push('No 3D structure resolved — pocket-based (small-molecule/covalent) reasoning is limited.');
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
    activeSiteCount: uni.activeSiteCount ?? null,
    likelyEnzyme: uni.likelyEnzyme ?? false,
    pocket: {
      hasStructure: !!(pk && pk.structure?.kind !== 'none'),
      structureLabel: pk?.structure?.label ?? null,
      totalPockets: pk?.totalPockets ?? 0,
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
  const hasPocket     = hasStruct && ev.pocket.totalPockets > 0;
  const smBucket      = ev.tractabilityBuckets.some(b => b.code === 'SM');
  const prBucket      = ev.tractabilityBuckets.some(b => b.code === 'PR');
  const hasCys        = (ev.cysCount ?? 0) > 0;
  const chemMatter    = (ev.chemblActivities ?? 0) >= 50;   // 5b — measured ligands exist
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
      else if (chemMatter || smBucket || hasPocket) {
        tier = 'Plausible';
        if (chemMatter) basis.push(`${ev.chemblActivities} measured bioactivities in ChEMBL — chemical matter exists`);
        else basis.push(smBucket ? 'Open Targets rates it small-molecule tractable' : `a binding pocket is present (${ev.pocket.totalPockets} detected)`);
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
      else if (hasPocket || prBucket) { tier = 'Plausible'; basis.push(prBucket ? 'Open Targets rates it PROTAC-tractable' : 'a ligandable pocket (handle) is present'); basis.push('still needs E3 co-expression + surface lysines (not gathered)'); }
      else { tier = 'Speculative'; basis.push('no ligandable handle found'); }
      if (modality.includes('Molecular glue')) { tier = cap(tier, 'Speculative'); basis.push('glues are largely serendipity-driven'); }
    } else if (isKnockdown(modality)) {
      tier = provenOligo && modality.includes('RNA knockdown') ? 'Precedented' : 'Plausible';
      basis.push('acts at the transcript level (structure-independent)'); basis.push('delivery to the disease tissue is the real constraint');
    } else if (isSplice(modality)) {
      const ex = ev.exonCount;
      if (ex != null && ex <= 1) { tier = 'Blocked'; gate = `single-exon transcript (${ex}) — no splicing event to switch`; }
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
      else if (isOccSM(modality)) { tier = cap(tier, 'Plausible'); basis.push('must bind allosterically (not the active site) to spare catalysis'); }
    } else if (goal === 'reduce_level') {
      if (isOccSM(modality) || isAntibody(modality) || isPeptide(modality) || isInterDis(modality)) {
        tier = cap(tier, 'Speculative'); if (!gate) gate = 'occupancy does not change protein level';
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
