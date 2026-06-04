// ChEMBL Druggability data layer.
// All requests route through the app's existing /api/proxy endpoint
// (www.ebi.ac.uk is already allowlisted server-side) to avoid browser CORS.
// This file is ADDITIVE — it does not touch Open Targets / ClinicalTrials / PubTator logic.

const CHEMBL_BASE = 'https://www.ebi.ac.uk/chembl/api/data';

// Route a ChEMBL GET through the existing server proxy
const proxyGet = (url: string) => fetch(`/api/proxy?url=${encodeURIComponent(url)}`);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChEMBLModalities {
  smallMolecule: boolean;
  antibody: boolean;
  protac: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export interface ChEMBLCompound {
  moleculeChemblId: string;
  ic50Nm: number | null;
  pchemblValue: number | null;
  assayDescription: string;
  documentYear: number | null;
  canonicalSmiles: string | null;
}

export interface ChEMBLDrugIndication {
  moleculeChemblId: string;
  diseaseName: string;
  maxPhase: number;
  meshHeading: string;
  clinicalTrialIds: string[];
}

export interface ChEMBLDruggability {
  targetChemblId: string | null;
  geneSymbol: string;
  modalities: ChEMBLModalities;
  bestCompound: ChEMBLCompound | null;
  totalCompounds: number;
  drugIndications: ChEMBLDrugIndication[];
  druggabilityScore: number;       // 0.0 to 1.0
  label: 'Known Drug Target' | 'Being Pursued' | 'Novel' | 'Uncharted';
  error: string | null;
}

// ─── Step 1: Search for ChEMBL target ID by gene symbol ───────────────────────

async function getTargetChemblId(geneSymbol: string): Promise<string | null> {
  try {
    const url = `${CHEMBL_BASE}/target/search?q=${encodeURIComponent(geneSymbol)}&organism=Homo+sapiens&format=json`;
    const res = await proxyGet(url);
    if (!res.ok) return null;
    const data = await res.json();

    if (!data.targets || data.targets.length === 0) return null;

    // Find best match: exact gene symbol match preferred
    const targets = data.targets as any[];
    const exact = targets.find(t =>
      t.target_components?.some((c: any) =>
        c.target_component_synonyms?.some((s: any) =>
          s.syn_type === 'GENE_SYMBOL' &&
          s.component_synonym?.toUpperCase() === geneSymbol.toUpperCase()
        )
      )
    );

    const best = exact || targets[0];
    return best?.target_chembl_id || null;
  } catch {
    return null;
  }
}

// ─── Step 2: Get GO terms and derive modalities ────────────────────────────────

async function getModalities(targetChemblId: string): Promise<ChEMBLModalities> {
  try {
    const url = `${CHEMBL_BASE}/target/${targetChemblId}?format=json`;
    const res = await proxyGet(url);
    if (!res.ok) return { smallMolecule: false, antibody: false, protac: false, confidence: 'low' };

    const data = await res.json();
    const xrefs: any[] = data.target_components?.[0]?.target_component_xrefs || [];

    const goComponents = xrefs
      .filter((x: any) => x.xref_src_db === 'GoComponent')
      .map((x: any) => x.xref_name?.toLowerCase() || '');

    const hasPDB = xrefs.some((x: any) => x.xref_src_db === 'PDB');

    const isExtracellular = goComponents.some(g =>
      g.includes('extracellular') || g.includes('plasma membrane') || g.includes('cell surface')
    );
    const isIntracellular = goComponents.some(g =>
      g.includes('cytosol') || g.includes('nucleus') || g.includes('cytoplasm')
    );

    const smallMolecule = hasPDB || isIntracellular;
    const antibody = isExtracellular;
    const protac = isIntracellular && !hasPDB;

    const confidence = goComponents.length > 3 ? 'high' : goComponents.length > 0 ? 'medium' : 'low';

    return { smallMolecule, antibody, protac, confidence };
  } catch {
    return { smallMolecule: false, antibody: false, protac: false, confidence: 'low' };
  }
}

// ─── Step 3: Get compounds / bioactivity ──────────────────────────────────────

async function getCompounds(targetChemblId: string): Promise<{ best: ChEMBLCompound | null; total: number }> {
  try {
    const url = `${CHEMBL_BASE}/activity?target_chembl_id=${targetChemblId}&standard_type=IC50&format=json&limit=25`;
    const res = await proxyGet(url);
    if (!res.ok) return { best: null, total: 0 };

    const data = await res.json();
    const activities: any[] = data.activities || [];
    const total = data.page_meta?.total_count || activities.length;

    if (activities.length === 0) return { best: null, total: 0 };

    // Find compound with best (lowest) IC50
    const valid = activities.filter((a: any) => a.standard_value && parseFloat(a.standard_value) > 0);
    if (valid.length === 0) return { best: null, total };

    valid.sort((a: any, b: any) => parseFloat(a.standard_value) - parseFloat(b.standard_value));
    const top = valid[0];

    return {
      best: {
        moleculeChemblId: top.molecule_chembl_id,
        ic50Nm: parseFloat(top.standard_value),
        pchemblValue: top.pchembl_value ? parseFloat(top.pchembl_value) : null,
        assayDescription: top.assay_description || '',
        documentYear: top.document_year || null,
        canonicalSmiles: top.canonical_smiles || null,
      },
      total,
    };
  } catch {
    return { best: null, total: 0 };
  }
}

// ─── Step 4: Get drug indications (via molecule IDs from activity) ─────────────

async function getDrugIndications(moleculeChemblId: string): Promise<ChEMBLDrugIndication[]> {
  try {
    const url = `${CHEMBL_BASE}/drug_indication?molecule_chembl_id=${moleculeChemblId}&format=json&limit=10`;
    const res = await proxyGet(url);
    if (!res.ok) return [];

    const data = await res.json();
    const indications: any[] = data.drug_indications || [];

    return indications.map((ind: any) => ({
      moleculeChemblId: ind.molecule_chembl_id,
      diseaseName: ind.efo_term || ind.mesh_heading || 'Unknown',
      maxPhase: parseFloat(ind.max_phase_for_ind) || 0,
      meshHeading: ind.mesh_heading || '',
      clinicalTrialIds: ind.indication_refs
        ?.filter((r: any) => r.ref_type === 'ClinicalTrials')
        .map((r: any) => r.ref_id)
        .join(',')
        .split(',')
        .filter(Boolean) || [],
    }));
  } catch {
    return [];
  }
}

// ─── Step 5: Get molecule drug-likeness details ────────────────────────────────

export async function getMoleculeDetails(moleculeChemblId: string): Promise<{
  maxPhase: number | null;
  ro5Violations: number;
  alogp: number | null;
  qed: number | null;
  molecularWeight: number | null;
  firstApproval: number | null;
} | null> {
  try {
    const url = `${CHEMBL_BASE}/molecule/${moleculeChemblId}?format=json`;
    const res = await proxyGet(url);
    if (!res.ok) return null;
    const data = await res.json();

    return {
      maxPhase: data.max_phase ? parseFloat(data.max_phase) : null,
      ro5Violations: data.molecule_properties?.num_ro5_violations ?? 0,
      alogp: data.molecule_properties?.alogp ? parseFloat(data.molecule_properties.alogp) : null,
      qed: data.molecule_properties?.qed_weighted ? parseFloat(data.molecule_properties.qed_weighted) : null,
      molecularWeight: data.molecule_properties?.full_mwt ? parseFloat(data.molecule_properties.full_mwt) : null,
      firstApproval: data.first_approval || null,
    };
  } catch {
    return null;
  }
}

// ─── Scoring + Label logic ────────────────────────────────────────────────────

function computeLabel(
  drugIndications: ChEMBLDrugIndication[],
  totalCompounds: number,
  bestCompound: ChEMBLCompound | null
): { label: ChEMBLDruggability['label']; score: number } {
  const hasApprovedDrug = drugIndications.some(d => d.maxPhase >= 4);
  const hasClinicalDrug = drugIndications.some(d => d.maxPhase >= 1);
  const hasPotentCompound = bestCompound?.ic50Nm !== null && bestCompound!.ic50Nm! < 100;

  if (hasApprovedDrug) return { label: 'Known Drug Target', score: 1.0 };
  if (hasClinicalDrug) return { label: 'Being Pursued', score: 0.85 };
  if (totalCompounds > 0 && hasPotentCompound) return { label: 'Novel', score: 0.65 };
  if (totalCompounds > 0) return { label: 'Novel', score: 0.5 };
  return { label: 'Uncharted', score: 0.0 };
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function getChEMBLDruggability(geneSymbol: string): Promise<ChEMBLDruggability> {
  const base: ChEMBLDruggability = {
    targetChemblId: null,
    geneSymbol,
    modalities: { smallMolecule: false, antibody: false, protac: false, confidence: 'low' },
    bestCompound: null,
    totalCompounds: 0,
    drugIndications: [],
    druggabilityScore: 0,
    label: 'Uncharted',
    error: null,
  };

  try {
    // Step 1 — resolve ChEMBL target ID
    const targetChemblId = await getTargetChemblId(geneSymbol);
    if (!targetChemblId) {
      return { ...base, error: 'Target not found in ChEMBL' };
    }
    base.targetChemblId = targetChemblId;

    // Steps 2, 3 in parallel
    const [modalities, compoundResult] = await Promise.all([
      getModalities(targetChemblId),
      getCompounds(targetChemblId),
    ]);

    base.modalities = modalities;
    base.bestCompound = compoundResult.best;
    base.totalCompounds = compoundResult.total;

    // Step 4 — drug indications from best compound
    if (compoundResult.best) {
      base.drugIndications = await getDrugIndications(compoundResult.best.moleculeChemblId);
    }

    // Score + label
    const { label, score } = computeLabel(base.drugIndications, base.totalCompounds, base.bestCompound);
    base.label = label;
    base.druggabilityScore = score;

    return base;
  } catch (err: any) {
    return { ...base, error: err?.message || 'Unknown error' };
  }
}

// ─── Batch function for gene list (rate limited) ──────────────────────────────

export async function getChEMBLBatch(
  geneSymbols: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, ChEMBLDruggability>> {
  const results = new Map<string, ChEMBLDruggability>();
  const DELAY_MS = 300; // be polite to ChEMBL servers

  for (let i = 0; i < geneSymbols.length; i++) {
    const gene = geneSymbols[i];
    results.set(gene, await getChEMBLDruggability(gene));
    onProgress?.(i + 1, geneSymbols.length);
    if (i < geneSymbols.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}
