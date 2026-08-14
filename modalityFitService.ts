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
  notes: string[];
}

export interface ModalityScore { category: ModalityCategory; modality: string; score: number; rationale: string; }
export interface ModalityFitResult {
  gene: string; goal: MechanisticGoal; goalText: string;
  evidence: ModalityEvidence;
  modalities: ModalityScore[];
  provenance: string;
  generatedNote: string;
}

// ── UniProt: subcellular location, active sites, sequence (length, Cys) ──
async function fetchUniProt(gene: string): Promise<Partial<ModalityEvidence>> {
  try {
    const q = `gene_exact:${encodeURIComponent(gene)} AND organism_id:9606 AND reviewed:true`;
    const url = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(q)}&fields=accession,cc_subcellular_location,ft_act_site,sequence&format=json&size=1`;
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
    const activeSites = (e.features || []).filter((f: any) => f.type === 'Active site').length;
    const locStr = locs.join(' ').toLowerCase();
    const isMembrane = /membrane/.test(locStr);
    const isSecreted = /secreted|extracellular/.test(locStr);
    return {
      uniprot: e.primaryAccession || null,
      subcellularLocations: locs,
      isMembrane, isSecreted,
      isIntracellular: locs.length > 0 && !isSecreted && !isMembrane,
      sequenceLength: seq.length || null,
      cysCount: seq ? (seq.match(/C/g) || []).length : null,
      activeSiteCount: activeSites || null,
      likelyEnzyme: activeSites > 0,
    };
  } catch { return {}; }
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
  const [modR, pkR, uniR] = await Promise.allSettled([
    getModalityProfile(gene),
    getPocketStructure(gene),
    fetchUniProt(gene),
  ]);
  const mod = modR.status === 'fulfilled' ? modR.value : null;
  const pk = pkR.status === 'fulfilled' ? pkR.value : null;
  const uni = (uniR.status === 'fulfilled' ? uniR.value : {}) as Partial<ModalityEvidence>;

  const top = pk?.pockets?.[0] || null;
  const notes: string[] = [];
  if (!pk || pk.structure?.kind === 'none') notes.push('No 3D structure resolved — pocket-based (small-molecule/covalent) reasoning is limited.');
  if (!mod || mod.error) notes.push('Open Targets tractability unavailable — modality assessment falls back to structure/sequence only.');
  if (!uni.uniprot) notes.push('UniProt annotation unavailable — localization / active-site reasoning is limited.');

  return {
    gene,
    uniprot: uni.uniprot ?? pk?.uniprot ?? null,
    subcellularLocations: uni.subcellularLocations ?? [],
    isMembrane: uni.isMembrane ?? false,
    isSecreted: uni.isSecreted ?? false,
    isIntracellular: uni.isIntracellular ?? false,
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
    notes,
  };
}

// ── M2: prompt + parse. Gemini scores each modality 0–5, grounded in the evidence. ──
export function buildModalityPrompt(ev: ModalityEvidence, goal: MechanisticGoal): string {
  const list = MODALITY_TAXONOMY.map(m => `- ${m.modality} [${m.category}]`).join('\n');
  const buckets = ev.tractabilityBuckets.length ? ev.tractabilityBuckets.map(b => `${b.modality}: ${b.labels.join('; ')}`).join(' | ') : 'none reported';
  const proven = ev.provenModalities.length ? ev.provenModalities.map(p => `${p.family} (${p.drugCount}, ${p.topStage})`).join(', ') : 'none (novel target)';
  return [
    `You are a drug-modality strategist. Rate how PLAUSIBLE each therapeutic modality is for the target ${ev.gene}, given ONLY the evidence below and the stated goal. Score 0 (disfavored) to 5 (favored). Be conservative when evidence is absent, and never invent facts not present here.`,
    ``,
    `MECHANISTIC GOAL: ${MECHANISTIC_GOALS[goal]}`,
    ``,
    `EVIDENCE for ${ev.gene}${ev.uniprot ? ` (UniProt ${ev.uniprot})` : ''}:`,
    `- Subcellular location: ${ev.subcellularLocations.join(', ') || 'unknown'} (intracellular=${ev.isIntracellular}, membrane=${ev.isMembrane}, secreted=${ev.isSecreted})`,
    `- Likely enzyme: ${ev.likelyEnzyme} (${ev.activeSiteCount ?? 0} annotated active-site residue(s))`,
    `- Sequence length: ${ev.sequenceLength ?? 'unknown'}; cysteine count: ${ev.cysCount ?? 'unknown'}`,
    `- Structure: ${ev.pocket.hasStructure ? ev.pocket.structureLabel : 'none resolved'}; pockets detected: ${ev.pocket.totalPockets}; top pocket volume ${ev.pocket.topVolume ?? 'NA'} Å³, enclosure ${ev.pocket.topEnclosure ?? 'NA'}; small-molecule druggability proxy ${ev.pocket.druggabilityProxy ?? 'NA'} (0-1; NOT a validated drugScore)`,
    `- Open Targets tractability buckets that are TRUE: ${buckets}`,
    `- Developed drugs by modality (fact): ${proven}`,
    ``,
    `Guidance: intracellular target ⇒ conventional antibodies score low (needs intrabody/nanobody delivery); no pocket / low druggability proxy ⇒ conventional small molecule, covalent and fragments score low; PROTAC/molecular glue need a ligandable handle (a pocket) to exist; splice-switching ASO needs multi-exon transcript biology; if the goal is "spare catalytic", any modality that lowers or removes the enzyme (knockdown, degradation) should be penalised.`,
    ``,
    `Rate ALL of these modalities:`,
    list,
    ``,
    `Return ONLY a JSON array, one object per modality, exactly: [{"modality": "<exact name from the list>", "score": <number 0-5, one decimal>, "rationale": "<max 90 chars, factual, tied to the evidence>"}]`,
  ].join('\n');
}

// Normalise a modality name for matching: drop a trailing " [Category]" suffix
// (the model tends to echo it), lowercase, and collapse whitespace/punctuation.
const normName = (s: string) => s.replace(/\s*\[[^\]]*\]\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function parseModalityScores(text: string, _ev: ModalityEvidence): ModalityScore[] {
  let arr: any[] = [];
  try {
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    arr = JSON.parse(s >= 0 && e > s ? text.slice(s, e + 1) : text);
  } catch { arr = []; }
  const byName = new Map<string, any>();
  for (const o of Array.isArray(arr) ? arr : []) {
    if (o && typeof o.modality === 'string') byName.set(normName(o.modality), o);
  }
  const lookup = (modality: string): any => {
    const key = normName(modality);
    if (byName.has(key)) return byName.get(key);
    // fall back to a prefix/contains match (handles minor wording drift)
    for (const [k, v] of byName) if (k.startsWith(key) || key.startsWith(k) || k.includes(key)) return v;
    return null;
  };
  // Always return the full taxonomy, so the chart is complete even if the model dropped a
  // row. Missing rows become an honest "not assessed" 0.
  return MODALITY_TAXONOMY.map(t => {
    const o = lookup(t.modality);
    const raw = Number(o?.score);
    const score = isFinite(raw) ? Math.max(0, Math.min(5, raw)) : 0;
    const rationale = (o?.rationale && String(o.rationale).trim()) || 'Not assessed from available evidence.';
    return { category: t.category, modality: t.modality, score, rationale: rationale.slice(0, 120) };
  }).sort((a, b) => b.score - a.score);
}
