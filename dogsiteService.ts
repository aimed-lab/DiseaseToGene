// dogsiteService.ts ───────────────────────────────────────────────────────────
// Region-specific (pocket-level) druggability via DoGSiteScorer (proteins.plus v2
// REST API). This is the "protein tier" the professor asked for: druggability is a
// property of a POCKET, not of the whole protein (PHGDH: catalytic pocket druggable,
// RNA-binding surface not). Runs SERVER-SIDE (multi-step upload→submit→poll→descriptors
// flow + CORS), public-API only (no Oracle) so it works locally and on Vercel.
//
// The v2 API (the endpoint we call here) returns validated pocket DESCRIPTORS
// (volume, enclosure, depth, hydrophobicity) but does NOT surface DoGSite's own
// SVM drugScore — so as an INTERIM we compute a transparent estimate from those
// descriptors. NOTE: DoGSite's real drugScore IS available from the v1 REST API
// (bindingSitePredictionGranularity=1); switching to it is the planned fix — the
// interim estimate correlates only moderately with the real drugScore (ρ≈0.80 on
// 1kzk) and can mis-rank pockets, so treat drugEst as provisional.
// Determinant background: Schmidtke-Barril 2010 (volume / hydrophobicity / geometry);
// Volkamer 2012 (DoGSiteScorer). 'enclosure' and 'depth' are DoGSite's descriptor
// names, not Schmidtke-Barril terms.

const BASE = 'https://proteins.plus/api/v2';
const H = { 'Accept': 'application/json', 'Content-Type': 'application/json' };

export interface Pocket {
  name: string;
  drugEst: number;      // 0..1 transparent druggability estimate
  volume: number;       // Å³
  enclosure: number;    // 0..1 (buriedness)
  hydrophobicity: number;
  depth: number;        // Å
  druggable: boolean;   // drugEst >= 0.5
}
export interface PocketDruggability {
  gene: string;
  uniprot: string | null;
  source: string;                 // 'AlphaFold O43175' etc.
  pockets: Pocket[];              // top-level pockets, ranked by drugEst
  bestDrug: number;               // max pocket drugEst
  nDruggable: number;             // count of druggable pockets
  note: string;
  error?: string;
}

const jget = async (path: string): Promise<any> => {
  const r = await fetch(BASE + path, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
};
const jpost = async (path: string, body: any): Promise<any> => {
  const r = await fetch(BASE + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json();
};
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };
const clip = (x: number) => Math.max(0, Math.min(1, x));

// Poll a proteins.plus job resource until it succeeds. Cached jobs return instantly.
async function pollJob(path: string, tries = 40, waitMs = 3000): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const j = await jget(path);
    const st = String(j.status || '').toLowerCase();
    if (st === 'success' || st === 'completed') return j;
    if (st === 'failure' || st === 'error') throw new Error('job failed: ' + (j.error || 'unknown'));
    await sleep(waitMs);
  }
  throw new Error('job timed out');
}

// Resolve a gene symbol → reviewed human UniProt accession (for the AlphaFold model).
export async function geneToUniprot(symbol: string): Promise<string | null> {
  const q = encodeURIComponent(`gene_exact:${symbol} AND organism_id:9606 AND reviewed:true`);
  const r = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=${q}&fields=accession&format=json&size=1`,
    { headers: { 'Accept': 'application/json' } });
  if (!r.ok) return null;
  const d: any = await r.json();
  return d?.results?.[0]?.primaryAccession ?? null;
}

// Transparent per-pocket druggability from DoGSite's own descriptors (literature
// determinants: volume, enclosure/buriedness, hydrophobicity, depth).
function drugEstimate(p: any): number {
  const vol = num(p.volume), enc = num(p.enclosure), hyd = num(p.hydrophobicity), depth = num(p.depth);
  return Math.round((0.35 * clip((vol - 100) / 500) + 0.30 * clip(enc) + 0.20 * clip(hyd) + 0.15 * clip((depth - 8) / 12)) * 100) / 100;
}

// Full pocket-druggability run for one gene (via its AlphaFold model on proteins.plus).
export async function getPocketDruggability(gene: string, uniprotIn?: string | null): Promise<PocketDruggability> {
  const base: PocketDruggability = { gene, uniprot: uniprotIn ?? null, source: '', pockets: [], bestDrug: 0, nDruggable: 0, note: '' };
  try {
    const uniprot = uniprotIn || await geneToUniprot(gene);
    if (!uniprot) return { ...base, error: `Could not resolve ${gene} to a UniProt accession` };
    base.uniprot = uniprot; base.source = `AlphaFold ${uniprot}`;

    // 1) upload the AlphaFold model by UniProt code
    const up = await jpost('/molecule_handler/upload/', { uniprot_code: uniprot, use_cache: true });
    const upJob = await pollJob(`/molecule_handler/upload/jobs/${up.job_id}/`);
    const proteinId = upJob.output_protein;
    if (!proteinId) return { ...base, error: 'upload produced no protein' };

    // 2) submit DoGSiteScorer, 3) poll, 4) fetch descriptors
    const ds = await jpost('/dogsite/', { protein_id: String(proteinId), calc_subpockets: true, ligand_bias: false });
    const dsJob = await pollJob(`/dogsite/jobs/${ds.job_id}/`);
    const info = await jget(`/dogsite/info/${dsJob.dogsite_info}/`);
    const list: any[] = Array.isArray(info.info) ? info.info : [];

    // top-level pockets only (name "P_n"; subpockets are "P_n_m")
    const pockets: Pocket[] = list
      .filter(p => p && typeof p.name === 'string' && (p.name.match(/_/g) || []).length === 1 && p.volume != null)
      .map(p => {
        const drugEst = drugEstimate(p);
        return { name: p.name, drugEst, volume: Math.round(num(p.volume)), enclosure: Math.round(num(p.enclosure) * 100) / 100, hydrophobicity: Math.round(num(p.hydrophobicity) * 100) / 100, depth: Math.round(num(p.depth) * 10) / 10, druggable: drugEst >= 0.5 };
      })
      .sort((a, b) => b.drugEst - a.drugEst);

    base.pockets = pockets;
    base.bestDrug = pockets.length ? pockets[0].drugEst : 0;
    base.nDruggable = pockets.filter(p => p.druggable).length;
    base.note = `${pockets.length} pockets · ${base.nDruggable} druggable · DoGSiteScorer pockets; INTERIM descriptor-based estimate (DoGSite's real drugScore is available via the v1 API — switch pending; treat scores as provisional)`;
    return base;
  } catch (e: any) {
    return { ...base, error: String(e?.message || e).slice(0, 200) };
  }
}
