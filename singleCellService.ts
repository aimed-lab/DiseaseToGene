// singleCellService.ts ───────────────────────────────────────────────────────
// Cell-type resolution for a target: WHICH cell types express it, and how selectively.
//
// This is the cell-level counterpart of the existing GTEx tissue-tau axis. Tissue tau says
// "this target is restricted to brain"; cell-type specificity says "…and within brain, to
// astrocytes". That distinction changes safety reasoning and delivery reasoning, which is
// why it is worth its own axis.
//
// Source: Human Protein Atlas, via the same search_download API the modality engine already
// uses. Deliberately NOT a bulk reference table like data/depmap_*.json: HPA's bulk
// single-cell file is not reachable (the documented path 404s, and the download page now
// exposes only the combined proteinatlas archive), and the API answers ONE gene per call —
// a multi-gene OR query returns []. Building a 20,000-call reference file would be a poor
// trade for data the board needs a few genes at a time, so this is a cached live lookup.
//
// IMPORTANT SCOPE LIMIT: HPA single-cell is NORMAL tissue. It says where a target IS
// expressed, never where it is DYSREGULATED in disease. Cell-type-specific *mechanism* in a
// disease needs a disease atlas (e.g. an Alzheimer's snRNA-seq dataset) and is a separate
// piece of work — do not read these values as disease evidence.

const UA = 'Disease2Target/1.0 (academic research; contact via app)';
const HPA = 'https://www.proteinatlas.org/api/search_download.php';

export interface SingleCellProfile {
  gene: string;
  specificity: string | null;        // HPA category, verbatim ("Cell type enhanced", …)
  distribution: string | null;       // HPA category, verbatim ("Detected in many", …)
  specificityScore: number | null;   // 0–1 ordinal rendering of the category (see below)
  cellTypes: { cellType: string; ncpm: number }[];   // the cell types HPA calls specific, richest first
  nSpecificCellTypes: number;
  resolved: boolean;                 // false = HPA returned nothing for this symbol
  source: string;
}

// HPA's specificity categories are ORDINAL, not numeric, so this is an explicit ranking of
// them rather than a computed score — inventing a continuous number from a category would
// imply precision HPA does not provide.
const SPECIFICITY_SCORE: Record<string, number> = {
  'cell type enriched': 1.0,          // strongest: a handful of cell types carry it
  'group enriched': 0.8,
  'cell type enhanced': 0.6,
  'low cell type specificity': 0.15,  // broadly expressed — a safety consideration
  'not detected': 0,
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; profile: SingleCellProfile }>();

const empty = (gene: string): SingleCellProfile => ({
  gene, specificity: null, distribution: null, specificityScore: null,
  cellTypes: [], nSpecificCellTypes: 0, resolved: false,
  source: 'Human Protein Atlas single-cell (normal tissue)',
});

export async function getSingleCellProfile(gene: string): Promise<SingleCellProfile> {
  const key = (gene || '').trim().toUpperCase();
  if (!key) return empty(gene);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.profile;

  try {
    const url = `${HPA}?search=${encodeURIComponent(key)}&format=json&columns=g,rnascs,rnascd,rnascsm&compress=no`;
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!r.ok) return empty(key);
    const rows: any[] = await r.json();
    // `search` is a SUBSTRING match, so a query for PHGDH also returns UBAC2 and friends.
    // Take the exact symbol or nothing — a near-match is a different gene, not a fallback.
    const row = (Array.isArray(rows) ? rows : []).find(x => String(x?.Gene || '').toUpperCase() === key);
    if (!row) return empty(key);

    const specificity = row['RNA single cell type specificity'] ?? null;
    const distribution = row['RNA single cell type distribution'] ?? null;
    const raw = row['RNA single cell type specific nCPM'];
    const cellTypes = raw && typeof raw === 'object'
      ? Object.entries(raw)
          .map(([cellType, v]) => ({ cellType, ncpm: Number(v) }))
          .filter(c => isFinite(c.ncpm))
          .sort((a, b) => b.ncpm - a.ncpm)
      : [];

    const profile: SingleCellProfile = {
      gene: key,
      specificity, distribution,
      specificityScore: specificity ? (SPECIFICITY_SCORE[String(specificity).toLowerCase()] ?? null) : null,
      cellTypes,
      nSpecificCellTypes: cellTypes.length,
      // A gene HPA knows always carries at least a specificity category. The nCPM map is
      // absent for broadly-expressed genes, so its emptiness is NOT evidence of absence.
      resolved: !!specificity || cellTypes.length > 0,
      source: 'Human Protein Atlas single-cell (normal tissue)',
    };
    if (profile.resolved) cache.set(key, { at: Date.now(), profile });
    return profile;
  } catch {
    return empty(key);
  }
}
