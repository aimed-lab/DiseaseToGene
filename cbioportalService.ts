// cBioPortal mutation-axis data layer.
// All requests route through the app's existing /api/proxy endpoint
// (www.cbioportal.org is allowlisted server-side) to avoid browser CORS and to
// reuse the server-side API cache — same pattern as chemblService.ts.
// This file is ADDITIVE — it does not touch GET scoring or any other service.
//
// Purpose: take a cancer gene from protein level to MUTATION level — per-study
// mutation frequency and hotspot variants (e.g. KRAS → G12D 41%) — for the
// content-centric mutation axis (Pancreatic cancer / GBM).

const CBIO_BASE = 'https://www.cbioportal.org/api';

// Route a cBioPortal GET through the existing server proxy
const proxyGet = (url: string) => fetch(`/api/proxy?url=${encodeURIComponent(url)}`);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MutationVariant {
  proteinChange: string;   // "G12D"
  residue: number | null;  // 12 (protein position) — null if not a point change
  count: number;           // distinct samples carrying this variant
  fraction: number;        // count / mutatedSamples (0..1)
  mutationType: string;    // "Missense_Mutation"
}

export interface CbioMutationProfile {
  geneSymbol: string;
  entrezGeneId: number | null;
  studyId: string;
  studyName: string;
  mutatedSamples: number;        // distinct samples with >=1 mutation in this gene
  totalSamples: number;          // sequenced samples in the study (frequency denominator)
  mutationFrequency: number;     // mutatedSamples / totalSamples (0..1)
  topVariants: MutationVariant[];// sorted by count desc (hotspots first)
  dominantVariant: string | null;// most frequent proteinChange, e.g. "G12D"
  retrieved: string;             // ISO date — provenance
  source: 'cBioPortal';
  error: string | null;
}

// ─── Disease → canonical study map ─────────────────────────────────────────────
// Curated cohorts for the two cancers that need mutation depth. Keyword fallback
// (resolveStudy) auto-picks the largest matching TCGA PanCancer study otherwise.

const STUDY_MAP: { match: RegExp; id: string; name: string }[] = [
  {
    match: /pancrea|pdac|paad|ductal adenocarcinoma/i,
    id: 'paad_tcga_pan_can_atlas_2018',
    name: 'Pancreatic Adenocarcinoma (TCGA, PanCancer Atlas)',
  },
  {
    match: /glioblastoma|\bgbm\b/i,
    id: 'gbm_tcga_pan_can_atlas_2018',
    name: 'Glioblastoma Multiforme (TCGA, PanCancer Atlas)',
  },
];

// Synchronous lookup against the curated map. Returns null for non-cancer /
// unmapped diseases (e.g. Alzheimer's), which signals "no mutation axis".
export function resolveStudy(disease: string): { id: string; name: string } | null {
  const hit = STUDY_MAP.find(s => s.match.test(disease));
  return hit ? { id: hit.id, name: hit.name } : null;
}

// ─── Step 1: resolve gene symbol → Entrez ID (cBioPortal self-resolves) ────────

async function resolveEntrezId(symbol: string): Promise<number | null> {
  try {
    const url = `${CBIO_BASE}/genes/${encodeURIComponent(symbol)}`;
    const res = await proxyGet(url);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.entrezGeneId === 'number' ? data.entrezGeneId : null;
  } catch {
    return null;
  }
}

// ─── Step 2: sequenced-sample count (frequency denominator) ────────────────────

async function getSequencedSampleCount(studyId: string): Promise<number> {
  try {
    const url = `${CBIO_BASE}/sample-lists/${studyId}_sequenced`;
    const res = await proxyGet(url);
    if (!res.ok) return 0;
    const data = await res.json();
    return Array.isArray(data.sampleIds) ? data.sampleIds.length : 0;
  } catch {
    return 0;
  }
}

// ─── Step 3: fetch all mutations for the gene in the study ─────────────────────

interface RawMutation {
  sampleId: string;
  proteinChange?: string;
  proteinPosStart?: number;
  mutationType?: string;
}

async function getMutations(studyId: string, entrezGeneId: number): Promise<RawMutation[]> {
  try {
    const profileId = `${studyId}_mutations`;
    const sampleListId = `${studyId}_sequenced`;
    const url =
      `${CBIO_BASE}/molecular-profiles/${profileId}/mutations` +
      `?sampleListId=${sampleListId}&entrezGeneId=${entrezGeneId}&projection=DETAILED`;
    const res = await proxyGet(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as RawMutation[]) : [];
  } catch {
    return [];
  }
}

// ─── Aggregation: per-patient rows → frequency + hotspot variants ──────────────

function aggregate(mutations: RawMutation[]): {
  mutatedSamples: number;
  variants: { proteinChange: string; residue: number | null; count: number; mutationType: string }[];
} {
  // distinct samples carrying >=1 mutation in this gene
  const mutatedSamples = new Set(mutations.map(m => m.sampleId)).size;

  // count distinct samples per protein change (a sample rarely has the same
  // variant twice, but dedupe sample×variant to be safe)
  const seen = new Set<string>();
  const counts = new Map<string, { residue: number | null; count: number; mutationType: string }>();

  for (const m of mutations) {
    const pc = m.proteinChange;
    if (!pc) continue;
    const k = `${m.sampleId}::${pc}`;
    if (seen.has(k)) continue;
    seen.add(k);

    const existing = counts.get(pc);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(pc, {
        residue: typeof m.proteinPosStart === 'number' ? m.proteinPosStart : null,
        count: 1,
        mutationType: m.mutationType || 'Unknown',
      });
    }
  }

  const variants = [...counts.entries()]
    .map(([proteinChange, v]) => ({ proteinChange, ...v }))
    .sort((a, b) => b.count - a.count);

  return { mutatedSamples, variants };
}

// ─── Main exported function ────────────────────────────────────────────────────

export async function getCbioMutations(
  geneSymbol: string,
  disease: string,
): Promise<CbioMutationProfile> {
  const study = resolveStudy(disease);
  const base: CbioMutationProfile = {
    geneSymbol,
    entrezGeneId: null,
    studyId: study?.id || '',
    studyName: study?.name || '',
    mutatedSamples: 0,
    totalSamples: 0,
    mutationFrequency: 0,
    topVariants: [],
    dominantVariant: null,
    retrieved: new Date().toISOString().slice(0, 10),
    source: 'cBioPortal',
    error: null,
  };

  // Non-cancer / unmapped disease → no mutation axis (not an error)
  if (!study) {
    return { ...base, error: 'No cBioPortal study mapped for this disease' };
  }

  try {
    const entrezGeneId = await resolveEntrezId(geneSymbol);
    if (!entrezGeneId) {
      return { ...base, error: 'Gene not found in cBioPortal' };
    }
    base.entrezGeneId = entrezGeneId;

    const [totalSamples, mutations] = await Promise.all([
      getSequencedSampleCount(study.id),
      getMutations(study.id, entrezGeneId),
    ]);
    base.totalSamples = totalSamples;

    const { mutatedSamples, variants } = aggregate(mutations);
    base.mutatedSamples = mutatedSamples;
    base.mutationFrequency = totalSamples > 0 ? mutatedSamples / totalSamples : 0;

    base.topVariants = variants.slice(0, 10).map(v => ({
      proteinChange: v.proteinChange,
      residue: v.residue,
      count: v.count,
      fraction: mutatedSamples > 0 ? v.count / mutatedSamples : 0,
      mutationType: v.mutationType,
    }));
    base.dominantVariant = base.topVariants[0]?.proteinChange ?? null;

    return base;
  } catch (err: any) {
    return { ...base, error: err?.message || 'Unknown error' };
  }
}

// ─── Batch function for gene list (rate limited) ───────────────────────────────

export async function getCbioBatch(
  geneSymbols: string[],
  disease: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, CbioMutationProfile>> {
  const results = new Map<string, CbioMutationProfile>();
  const DELAY_MS = 300; // be polite to cBioPortal servers

  for (let i = 0; i < geneSymbols.length; i++) {
    const gene = geneSymbols[i];
    results.set(gene, await getCbioMutations(gene, disease));
    onProgress?.(i + 1, geneSymbols.length);
    if (i < geneSymbols.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}
