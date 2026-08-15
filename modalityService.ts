// modalityService.ts ────────────────────────────────────────────────────────
// "Which modality can drug it?" — the right question the funnel's single ChEMBL
// "Druggability" bucket flattened. Per target it returns TWO structurally separate
// things (the professor's fact/prediction rule, enforced in the data model):
//
//   fact       — DEVELOPED drugs BY MODALITY (Open Targets drugAndClinicalCandidates:
//                drug.drugType + drug.maximumClinicalStage). "ERBB2 has an approved
//                antibody, an approved ADC, and approved small molecules." A hard fact.
//   prediction — per-modality TRACTABILITY assessment (Open Targets tractability:
//                SM / AB / PR / OC buckets). "PHGDH looks tractable by small molecule
//                (has a high-quality pocket)." An assessment, kept in its own field.
//
// The two NEVER share a field or a score — the UI renders them in distinct blocks.
//
// Design guardrails (per the Claude-Science review):
//  • Do NOT gate the funnel on developed-drug maturity — that rewards crowded targets
//    and would kill novel first-in-class targets (PHGDH has 0 developed drugs). The
//    `fact` is a SCORED annotation; the only thing safe to gate on is `prediction`
//    (is there ≥1 plausible modality) — surfaced as `tractableModalities`.
//  • Public OT GraphQL only → works locally and on Vercel.

const OT = 'https://api.platform.opentargets.org/api/v4/graphql';
// Open Targets' edge (nginx) 403s any request with no User-Agent. Node's fetch sends none
// by default, so every server-side OT call silently failed — which is what left `fact.developed`
// empty and stopped the "Precedented" modality tier from ever firing. Browsers were unaffected
// (they send their own UA), so this only ever broke the server path.
const OT_UA = 'Disease2Target/1.0 (academic research; contact via app)';

// OT maximumClinicalStage enum → ordinal + human label (for maturity ANNOTATION, not gating).
const STAGE_RANK: Record<string, number> = {
  APPROVAL: 4, PHASE_4: 4, PHASE_3: 3, PHASE_2_3: 2.5, PHASE_2: 2, PHASE_1_2: 1.5,
  PHASE_1: 1, EARLY_PHASE_1: 0.5, PRECLINICAL: 0,
};
const STAGE_LABEL: Record<string, string> = {
  APPROVAL: 'Approved', PHASE_4: 'Phase IV', PHASE_3: 'Phase III', PHASE_2_3: 'Phase II/III',
  PHASE_2: 'Phase II', PHASE_1_2: 'Phase I/II', PHASE_1: 'Phase I', EARLY_PHASE_1: 'Early Phase I',
  PRECLINICAL: 'Preclinical',
};
// OT tractability modality codes → readable names.
const TRACT_MODALITY: Record<string, string> = {
  SM: 'Small molecule', AB: 'Antibody', PR: 'PROTAC / degrader', OC: 'Other (clinical precedence)',
};
// Coarse family grouping for drugType (display only — the raw drugType is kept as the key).
// NOTE (per review caveat): this map is validated on the common values; the long tail
// (Enzyme, Oligosaccharide, Unknown, …) falls through to 'Other' and can be refined once
// the full drugType distribution across the genome is surveyed.
const MODALITY_FAMILY: Record<string, string> = {
  'Small molecule': 'Small molecule',
  'Antibody': 'Biologic', 'Antibody drug conjugate': 'Biologic', 'Protein': 'Biologic', 'Enzyme': 'Biologic',
  'Oligonucleotide': 'Oligonucleotide (RNA/ASO)',
  'Cell': 'Cell / gene therapy', 'Gene': 'Cell / gene therapy',
  'Oligosaccharide': 'Other', 'Unknown': 'Unknown',
};
export const modalityFamily = (drugType: string): string => MODALITY_FAMILY[drugType] || 'Other';

export interface ModalityFactRow {
  modality: string;        // raw OT drugType, e.g. 'Small molecule', 'Antibody drug conjugate'
  family: string;          // coarse family (display)
  drugCount: number;
  topStage: string;        // human label of the most advanced stage in this modality
  topStageRank: number;    // 0..4
  approved: boolean;
}
export interface UnclassifiedDrugs {
  drugCount: number;              // drugs whose OT drugType is null/'Unknown' — NOT a modality
  names: string[];               // their names, so the long-tail can be resolved + mapped
  topStage: string; topStageRank: number;
}
// One developed drug, kept individually so the dossier can name it rather than only count it.
export interface DevelopedDrug {
  name: string;
  modality: string | null;        // raw OT drugType
  family: string | null;          // coarse family (ADC folds under Biologic)
  stage: string;                  // human stage label
  stageRank: number;              // 0..4, -1 unknown
  approved: boolean;
}
export interface ModalityFact {
  developed: ModalityFactRow[];   // KNOWN modalities with ≥1 developed drug, most-mature first (Unknown excluded)
  drugs: DevelopedDrug[];         // the individual drugs — "which drugs", not just "how many"
  totalDrugs: number;             // all developed drugs, incl. unclassified
  provenModalities: number;       // # distinct KNOWN modalities (raw drugType) — excludes Unknown
  provenFamilies: number;         // # distinct families (ADC folds under Biologic) — the coarser count
  bestStageRank: number;          // maturity of the most-advanced modality (annotation, NOT a gate)
  unclassified: UnclassifiedDrugs | null; // drugs with no drugType — surfaced, never counted as a modality
  provenance: string;
}
export interface ModalityPredRow { modality: string; code: string; labels: string[]; }
export interface ModalityPrediction {
  buckets: ModalityPredRow[];     // per assessment modality, the tractability buckets that are TRUE
  tractableModalities: number;    // # modalities with ≥1 true bucket — the ONLY thing safe to gate on
  provenance: string;
}
export interface ModalityProfile {
  gene: string;
  ensemblId: string | null;
  fact: ModalityFact;             // developed drugs by modality — SEPARATE field
  prediction: ModalityPrediction; // per-modality tractability — SEPARATE field
  note: string;
  error?: string;
}

async function otFetch(query: string, variables: any): Promise<any> {
  const r = await fetch(OT, { method: 'POST', headers: { 'content-type': 'application/json', 'User-Agent': OT_UA }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`OT ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error('OT: ' + String(j.errors?.[0]?.message || 'query error').slice(0, 160));
  return j.data;
}

// Symbol -> Ensembl id. Memoised for the process lifetime: a harvest resolves the SAME
// symbol once per axis (druggability, clinical, annotation, patents...), which for 7,500
// genes across 4 axes is 30,000 identical lookups. Caching turns that into 7,500.
// Negative results are cached too, so an unresolvable symbol is not retried per axis.
const ensemblCache = new Map<string, string | null>();
export async function geneToEnsembl(gene: string): Promise<string | null> {
  const key = (gene || '').toUpperCase();
  if (ensemblCache.has(key)) return ensemblCache.get(key)!;
  const d = await otFetch(`query($q:String!){ search(queryString:$q, entityNames:["target"]){ hits{ id name } } }`, { q: gene });
  const hits: any[] = d?.search?.hits || [];
  const id = (hits.find(h => h.name?.toUpperCase() === key) || hits[0])?.id || null;
  ensemblCache.set(key, id);
  return id;
}

const stageLabelFromRank = (rank: number): string => {
  const key = Object.keys(STAGE_RANK).find(k => STAGE_RANK[k] === rank);
  return key ? STAGE_LABEL[key] : (rank < 0 ? 'unknown stage' : '—');
};
const emptyFact = (): ModalityFact => ({ developed: [], drugs: [], totalDrugs: 0, provenModalities: 0, provenFamilies: 0, bestStageRank: -1, unclassified: null, provenance: 'Open Targets drugAndClinicalCandidates (drug.drugType, maximumClinicalStage)' });
const emptyPred = (): ModalityPrediction => ({ buckets: [], tractableModalities: 0, provenance: 'Open Targets tractability (per-modality assessment)' });

export async function getModalityProfile(gene: string): Promise<ModalityProfile> {
  const base: ModalityProfile = { gene, ensemblId: null, fact: emptyFact(), prediction: emptyPred(), note: '' };
  try {
    const ensemblId = await geneToEnsembl(gene);
    if (!ensemblId) return { ...base, error: `Could not resolve ${gene} to an Open Targets target` };
    base.ensemblId = ensemblId;

    const d = await otFetch(
      `query($id:String!){ target(ensemblId:$id){
         drugAndClinicalCandidates{ count rows{ drug{ name drugType maximumClinicalStage } } }
         tractability{ label modality value }
       } }`, { id: ensemblId });
    const t = d?.target;

    // ── FACT: developed drugs grouped by modality (raw drugType). Drugs with a null/
    // 'Unknown' drugType are a TAXONOMY GAP, not a modality — split them out (with names)
    // and never count them toward provenModalities. ──
    const rows: any[] = t?.drugAndClinicalCandidates?.rows || [];
    const byMod = new Map<string, { count: number; best: number }>();
    const unNames = new Set<string>();
    const drugList: DevelopedDrug[] = [];
    const seenDrug = new Set<string>();
    let unBest = -1, unCount = 0;
    for (const r of rows) {
      const rawType = r?.drug?.drugType;
      const rank = STAGE_RANK[r?.drug?.maximumClinicalStage] ?? -1;
      const name = r?.drug?.name ? String(r.drug.name) : null;
      // keep each drug once (a drug can appear on several rows), with its modality + stage
      if (name && !seenDrug.has(name.toUpperCase())) {
        seenDrug.add(name.toUpperCase());
        const known = rawType && rawType !== 'Unknown';
        drugList.push({
          name,
          modality: known ? rawType : null,
          family: known ? modalityFamily(rawType) : null,
          stage: stageLabelFromRank(rank), stageRank: rank, approved: rank >= 4,
        });
      }
      if (!rawType || rawType === 'Unknown') {
        unCount++; unBest = Math.max(unBest, rank);
        if (name) unNames.add(name);
        continue;
      }
      const cur = byMod.get(rawType) || { count: 0, best: -1 };
      cur.count++; cur.best = Math.max(cur.best, rank);
      byMod.set(rawType, cur);
    }
    drugList.sort((a, b) => b.stageRank - a.stageRank || a.name.localeCompare(b.name));
    const developed: ModalityFactRow[] = [...byMod.entries()].map(([modality, v]) => ({
      modality, family: modalityFamily(modality), drugCount: v.count,
      topStageRank: v.best, approved: v.best >= 4, topStage: stageLabelFromRank(v.best),
    })).sort((a, b) => b.topStageRank - a.topStageRank || b.drugCount - a.drugCount);
    base.fact = {
      developed,
      drugs: drugList.slice(0, 60),
      totalDrugs: rows.length,
      provenModalities: developed.length,                              // known modalities only
      provenFamilies: new Set(developed.map(m => m.family)).size,      // ADC folds under Biologic
      bestStageRank: developed.length ? developed[0].topStageRank : -1,
      unclassified: unCount ? { drugCount: unCount, names: [...unNames], topStage: stageLabelFromRank(unBest), topStageRank: unBest } : null,
      provenance: emptyFact().provenance,
    };

    // ── PREDICTION: per-modality tractability buckets that are TRUE ──
    const tract: any[] = t?.tractability || [];
    const byPred = new Map<string, string[]>();
    for (const x of tract) {
      if (!x?.value) continue;
      const code = x.modality || '?';
      if (!byPred.has(code)) byPred.set(code, []);
      byPred.get(code)!.push(x.label);
    }
    const buckets: ModalityPredRow[] = [...byPred.entries()].map(([code, labels]) => ({
      code, modality: TRACT_MODALITY[code] || code, labels,
    }));
    base.prediction = { buckets, tractableModalities: buckets.length, provenance: emptyPred().provenance };

    const pm = base.fact.provenModalities, pf = base.fact.provenFamilies, un = base.fact.unclassified;
    const tractSummary = `${base.prediction.tractableModalities} assessed tractable`;
    base.note = pm > 0
      ? `${pm} proven modalit${pm === 1 ? 'y' : 'ies'} (${pf} famil${pf === 1 ? 'y' : 'ies'})${un ? ` + ${un.drugCount} unclassified drug${un.drugCount === 1 ? '' : 's'}` : ''} · ${tractSummary} — fact and prediction shown separately.`
      : un
        ? `${un.drugCount} developed drug${un.drugCount === 1 ? '' : 's'} but drugType unclassified · ${tractSummary} — resolve the drugType before treating as a modality.`
        : `No developed drugs (novel target) · ${tractSummary} — the funnel must NOT reject this on developed drugs.`;
    return base;
  } catch (e: any) {
    return { ...base, error: String(e?.message || e).slice(0, 200) };
  }
}
