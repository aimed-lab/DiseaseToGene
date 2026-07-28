// targetProfileService.ts ────────────────────────────────────────────────────
// ONE Open Targets call per gene that returns everything the dossier needs about the
// PROTEIN itself — identity, function, localisation, class, pathways, paralogs, safety
// liabilities, essentiality, chemical probes and OT's own prioritisation vector.
//
// WHY ONE CALL. These metrics span what would naively be ~6 separate axes. Fetched
// separately that is ~45,000 requests for a 7,500-gene harvest. Fetched together it is
// 7,500. The axes are then DERIVED from a single payload rather than each hitting the API.
//
// WHAT IS DELIBERATELY NOT HERE
//   baselineExpression — returns ~1,450 rows PER GENE (SRC), i.e. ~11M rows across a
//     harvest. Tissue specificity is instead built once into a local reference table
//     (data/tissue_specificity.json), the same pattern already used for expression,
//     DepMap and gnomAD. See scripts/build_tissue_specificity.mjs.
//   drugAndClinicalCandidates — heavy (EGFR has ~4,900 trial records) and already
//     fetched by modalityService/evidenceProviders for the druggability + clinical axes.
//
// THREE-STATE: a failed lookup returns null so the caller writes NO row, never a
// fabricated empty profile.

import { geneToEnsembl } from './modalityService.js';

const OT = 'https://api.platform.opentargets.org/api/v4/graphql';

async function otFetch(query: string, variables: Record<string, unknown>): Promise<any> {
  const r = await fetch(OT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`OT ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error('OT: ' + String(j.errors?.[0]?.message || 'query error').slice(0, 160));
  return j.data;
}

export interface SafetyLiability { event: string | null; eventId: string | null; datasource: string | null }
export interface TargetProfile {
  ensembl_id: string;
  symbol: string | null;
  approved_name: string | null;
  biotype: string | null;
  uniprot_id: string | null;
  genomic_location: string | null;
  // function / classification
  target_class: string | null;            // most specific class label, e.g. "Kinase"
  target_classes: string[];
  function_description: string | null;    // the primary narrative — the dossier's biology
  subcellular_locations: string[];
  pathways: string[];
  pathway_count: number;
  hallmarks: string[];
  // safety
  safety_liabilities: SafetyLiability[];
  n_safety_liabilities: number;
  // essentiality — the flag the scoring engine has a penalty slot for but never had data
  is_common_essential: boolean | null;
  // tools
  n_chemical_probes: number;
  n_high_quality_probes: number;
  has_tep: boolean;
  // relationships
  paralogs: string[];
  // OT's own target-quality vector (independent cross-check on our ranking)
  prioritisation: Record<string, number>;
}

// Membrane/secreted localisation decides whether an antibody is even possible, so the raw
// location strings are kept AND reduced to this one actionable flag.
//
// It must be strict about WHICH membrane. A naive /membrane|extracellular/ test calls
// PHGDH (cytosolic) surface-accessible because its location list includes "extracellular
// exosome", and calls any mitochondrial protein accessible too — both wrong, and the wrong
// answer here would suggest an antibody against a target no antibody can reach.
// So: require a PLASMA-membrane / secreted term, and reject organelle membranes.
// Also reject "Cytoplasmic side": KRAS is lipid-anchored to the plasma membrane but faces
// INWARD, so it is not antibody-accessible despite matching "Cell membrane".
//
// LIMITATION, stated plainly: OT's location list is a union of sources, so a weak
// annotation from one dataset can flip this flag (PHGDH is cytosolic yet carries a
// "Plasma membrane" entry). Treat it as a heuristic shortlist, not a determination —
// the raw `subcellular_locations` are stored precisely so a reader can check.
const SURFACE_RE = /(cell|plasma) membrane|cell surface|cell projection|\bsecreted\b|extracellular (space|region|matrix)/i;
const INTERNAL_RE = /mitochondri|endoplasmic|golgi|nucle|lysosom|peroxisom|endosom|vacuol|exosome|cytoplasmic side/i;
export const isSurfaceOrSecreted = (locs: string[]): boolean =>
  locs.some(l => SURFACE_RE.test(l) && !INTERNAL_RE.test(l));

export async function fetchTargetProfile(symbol: string): Promise<TargetProfile | null> {
  try {
    const ensemblId = await geneToEnsembl(symbol);
    if (!ensemblId) return null;                       // unresolved → not-fetched (3-state)
    const d = await otFetch(
      `query($e:String!){ target(ensemblId:$e){
         id approvedSymbol approvedName biotype
         proteinIds{ id source }
         genomicLocation{ chromosome start end strand }
         targetClass{ id label level }
         functionDescriptions
         subcellularLocations{ location termSL labelSL }
         pathways{ pathwayId pathway topLevelTerm }
         hallmarks{ attributes{ name } }
         safetyLiabilities{ event eventId datasource }
         isEssential
         chemicalProbes{ id isHighQuality }
         tep{ name uri }
         homologues{ homologyType targetGeneSymbol speciesName }
         prioritisation{ items{ key value } }
       } }`, { e: ensemblId });
    const t = d?.target;
    if (!t) return null;

    const uni = (t.proteinIds || []).find((p: any) => /uniprot/i.test(p?.source || ''))?.id ?? null;
    const gl = t.genomicLocation;
    const classes: string[] = [...new Set((t.targetClass || []).map((c: any) => String(c?.label || '')).filter(Boolean))] as string[];
    const locs: string[] = [...new Set((t.subcellularLocations || []).map((s: any) => String(s?.location || '')).filter(Boolean))] as string[];
    const paths: string[] = [...new Set((t.pathways || []).map((p: any) => String(p?.pathway || '')).filter(Boolean))] as string[];
    const halls: string[] = [...new Set(((t.hallmarks?.attributes) || []).map((h: any) => String(h?.name || '')).filter(Boolean))] as string[];
    const probes: any[] = t.chemicalProbes || [];
    // Human paralogs only — cross-species homologues are not the redundancy signal we want.
    const paralogs: string[] = [...new Set((t.homologues || [])
      .filter((h: any) => /paralog/i.test(h?.homologyType || '') && /human/i.test(h?.speciesName || ''))
      .map((h: any) => String(h?.targetGeneSymbol || '')).filter(Boolean))] as string[];
    const prio: Record<string, number> = {};
    for (const it of (t.prioritisation?.items || [])) {
      const v = Number(it?.value);
      if (it?.key && Number.isFinite(v)) prio[String(it.key)] = v;
    }

    return {
      ensembl_id: t.id,
      symbol: t.approvedSymbol ?? null,
      approved_name: t.approvedName ?? null,
      biotype: t.biotype ?? null,
      uniprot_id: uni,
      genomic_location: gl ? `chr${gl.chromosome}:${gl.start}-${gl.end}${gl.strand === -1 ? ' (-)' : ' (+)'}` : null,
      target_class: classes[classes.length - 1] ?? null,     // most specific level last
      target_classes: classes,
      function_description: (t.functionDescriptions || [])[0] ?? null,
      subcellular_locations: locs,
      pathways: paths.slice(0, 25),
      pathway_count: paths.length,
      hallmarks: halls,
      safety_liabilities: (t.safetyLiabilities || []).slice(0, 25).map((s: any) => ({
        event: s?.event ?? null, eventId: s?.eventId ?? null, datasource: s?.datasource ?? null,
      })),
      n_safety_liabilities: (t.safetyLiabilities || []).length,
      is_common_essential: typeof t.isEssential === 'boolean' ? t.isEssential : null,
      n_chemical_probes: probes.length,
      n_high_quality_probes: probes.filter((p: any) => p?.isHighQuality).length,
      has_tep: !!t.tep,
      paralogs: paralogs.slice(0, 25),
      prioritisation: prio,
    };
  } catch { return null; }                              // fetch failed → not-fetched (3-state)
}
