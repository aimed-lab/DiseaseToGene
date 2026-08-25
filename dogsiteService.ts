// dogsiteService.ts ───────────────────────────────────────────────────────────
// Pocket STRUCTURAL DRILL-DOWN (descriptive evidence only — NOT a scoring axis).
//
// The funnel's "can we drug it" axis stays on Open Targets tractability buckets.
// This service backs a per-target "Pocket structure" panel in the detail drawer:
// it detects binding pockets on the target's best 3D structure and reports each
// pocket's geometric/physicochemical DESCRIPTORS. It does NOT emit a druggability
// score — DoGSite3 (Graef et al. 2023) computes descriptors only; the SVM
// "drugScore" of the older DoGSiteScorer is not exposed by any current DoGSite tool,
// and its "simpleScore" coefficients were never published, so we do not fabricate one.
//
// Flow:  gene → UniProt → BEST structure (experimental PDB, else AlphaFold, else none)
//        → DoGSite3 descriptors (proteins.plus v2 API, or the local binary if enabled)
//        → top-3 pockets by volume, largest enclosed flagged "primary".
//
// DEPLOY: the default engine is the proteins.plus REST API (public; runs on Vercel;
// it IS DoGSite3 server-side, so the descriptor set is identical to the local binary).
// The local DoGSite3 v1.2.0 binary is an OPTIONAL engine (USE_DOGSITE3=1 + DOGSITE3_BIN),
// server/Docker only, kept internal per the ZBH license (no redistribution).

const BASE = 'https://proteins.plus/api/v2';
const H = { Accept: 'application/json', 'Content-Type': 'application/json' };
// AlphaFold blocks requests without a User-Agent; PDBe/RCSB are fine with one too.
const UA = 'Disease2Target/1.0 (academic research; contact via app)';

// ── public result types (consumed by the panel) ──
export interface StructureRef {
  kind: 'experimental' | 'alphafold' | 'none';
  id: string | null;            // PDB id (experimental) or UniProt accession (AlphaFold)
  label: string;                // human-readable provenance, e.g. "Experimental · X-ray 1.70 Å · PDB 7VVB"
  method: string | null;        // experimental method, when known
  resolution: number | null;    // Å (experimental)
  plddt: number | null;         // mean pLDDT 0–100 (AlphaFold model confidence)
  url: string | null;           // structure file URL used
}
export interface PocketRow {
  name: string;                 // DoGSite pocket id, e.g. "P_1"
  volume: number;               // Å³
  enclosure: number;            // 0..1 (buriedness; higher = more enclosed)
  depth: number;                // Å
  hydrophobicity: number;       // 0..1 (lipophilic character)
  surfVol: number;              // Å⁻¹ surface/volume (shape: lower = more compact/enclosed)
  primary: boolean;             // the largest enclosed pocket among those shown
}
export interface PocketStructure {
  gene: string;
  uniprot: string | null;
  structure: StructureRef;
  engine: string;               // "DoGSite3 (proteins.plus)" | "DoGSite3 v1.2.0 (local)"
  pockets: PocketRow[];         // top 3 by volume
  totalPockets: number;         // total top-level pockets detected
  note: string;
  error?: string;
}

// A raw descriptor row, common to both engines.
interface RawPocket { name: string; volume: number; enclosure: number; depth: number; hydrophobicity: number; surfVol: number; }

const jget = async (path: string): Promise<any> => {
  const r = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
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
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

// Poll budget. DoGSite runs as a submit-and-poll job on proteins.plus, and the ORIGINAL
// budget here (40 tries x 3s) allowed 120s PER JOB — twice per structure, so up to 240s.
// A serverless function is capped far below that (vercel.json maxDuration), so a cold gene
// exceeded the whole request budget on pocket detection alone and the caller got a 504.
//
// The budget is now WALL-CLOCK and shared across both jobs of one structure, so the worst
// case is predictable rather than a function of how many polls happened to fit. Losing the
// pocket data is safe: gatherModalityEvidence already degrades to a stated note
// ("No 3D structure resolved — pocket-based reasoning is limited") rather than guessing.
const POCKET_BUDGET_MS = Number(process.env.DOGSITE_BUDGET_MS || 20_000);
const POLL_WAIT_MS = 1_500;

async function pollJob(path: string, deadline: number): Promise<any> {
  while (Date.now() < deadline) {
    const j = await jget(path);
    const st = String(j.status || '').toLowerCase();
    if (st === 'success' || st === 'completed') return j;
    if (st === 'failure' || st === 'error') throw new Error('job failed: ' + (j.error || 'unknown'));
    if (Date.now() + POLL_WAIT_MS >= deadline) break;
    await sleep(POLL_WAIT_MS);
  }
  throw new Error('job timed out');
}

// ── gene → reviewed human UniProt accession ──
export async function geneToUniprot(symbol: string): Promise<string | null> {
  const q = encodeURIComponent(`gene_exact:${symbol} AND organism_id:9606 AND reviewed:true`);
  const r = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=${q}&fields=accession&format=json&size=1`,
    { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const d: any = await r.json();
  return d?.results?.[0]?.primaryAccession ?? null;
}

// ── structure resolution: experimental PDB → AlphaFold → none ──
// Best experimental structure via PDBe "best_structures" (ranked by coverage/resolution).
async function bestExperimental(uniprot: string): Promise<StructureRef | null> {
  try {
    const r = await fetch(`https://www.ebi.ac.uk/pdbe/graph-api/mappings/best_structures/${uniprot}`,
      { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!r.ok) return null;
    const j: any = await r.json();
    const rows: any[] = j?.[uniprot] || [];
    if (!rows.length) return null;
    const top = rows[0]; // already ranked best-first
    const pdb = String(top.pdb_id || '').toUpperCase();
    if (!pdb) return null;
    const res = typeof top.resolution === 'number' ? top.resolution : null;
    const method = top.experimental_method || null;
    const label = `Experimental · ${method || 'structure'}${res != null ? ` · ${res.toFixed(2)} Å` : ''} · PDB ${pdb}`;
    return { kind: 'experimental', id: pdb, label, method, resolution: res, plddt: null,
      url: `https://files.rcsb.org/download/${pdb}.pdb` };
  } catch { return null; }
}

// AlphaFold model (the API needs a User-Agent; it returns the exact file URL + mean pLDDT).
async function alphaFold(uniprot: string): Promise<StructureRef | null> {
  try {
    const r = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${uniprot}`,
      { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!r.ok) return null;
    const arr: any[] = await r.json();
    const e = arr?.[0];
    if (!e?.pdbUrl) return null;
    const plddt = typeof e.globalMetricValue === 'number' ? Math.round(e.globalMetricValue) : null;
    const label = `AlphaFold model${plddt != null ? ` · mean pLDDT ${plddt}` : ''} · ${uniprot}`;
    return { kind: 'alphafold', id: uniprot, label, method: 'AlphaFold (predicted)', resolution: null, plddt, url: e.pdbUrl };
  } catch { return null; }
}

async function resolveStructure(uniprot: string): Promise<StructureRef> {
  return (await bestExperimental(uniprot))
    || (await alphaFold(uniprot))
    || { kind: 'none', id: null, label: 'No experimental or AlphaFold structure available', method: null, resolution: null, plddt: null, url: null };
}

// ── engine A: proteins.plus v2 (DoGSite3 server-side) — the portable default ──
async function pocketsViaProteinsPlus(structure: StructureRef): Promise<RawPocket[]> {
  // upload the chosen structure (by PDB code, or AlphaFold-by-UniProt)
  const uploadBody = structure.kind === 'experimental'
    ? { pdb_code: structure.id, use_cache: true }
    : { uniprot_code: structure.id, use_cache: true };
  // One deadline shared by BOTH jobs — upload and DoGSite together cannot outlive the budget.
  const deadline = Date.now() + POCKET_BUDGET_MS;

  const up = await jpost('/molecule_handler/upload/', uploadBody);
  const upJob = await pollJob(`/molecule_handler/upload/jobs/${up.job_id}/`, deadline);
  const proteinId = upJob.output_protein;
  if (!proteinId) throw new Error('structure upload produced no protein');

  const ds = await jpost('/dogsite/', { protein_id: String(proteinId), calc_subpockets: false, ligand_bias: false });
  const dsJob = await pollJob(`/dogsite/jobs/${ds.job_id}/`, deadline);
  const info = await jget(`/dogsite/info/${dsJob.dogsite_info}/`);
  const list: any[] = Array.isArray(info.info) ? info.info : [];
  return list
    .filter(p => p && typeof p.name === 'string' && /^P_\d+$/.test(p.name)) // top-level pockets only
    .map(p => ({
      name: p.name, volume: num(p.volume), enclosure: num(p.enclosure),
      depth: num(p.depth), hydrophobicity: num(p.hydrophobicity), surfVol: num(p['surf/vol']),
    }));
}

// ── engine B: local DoGSite3 v1.2.0 binary (optional; server/Docker only) ──
export const DOGSITE3_BIN = process.env.DOGSITE3_BIN || '';
export const DOGSITE3_ENABLED = process.env.USE_DOGSITE3 === '1' && !!DOGSITE3_BIN;

async function pocketsViaLocalBinary(structure: StructureRef): Promise<RawPocket[]> {
  // Node-only deps, imported lazily so this module stays importable elsewhere.
  const { spawn } = await import('node:child_process');
  const { promises: fs } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `dogsite3-`));
  try {
    // fetch the structure file (RCSB for experimental, AlphaFold URL for the model)
    const sr = await fetch(structure.url!, { headers: { 'User-Agent': UA } });
    if (!sr.ok) throw new Error(`structure download ${structure.url} → ${sr.status}`);
    const ext = structure.kind === 'experimental' ? 'pdb' : 'pdb';
    const inFile = path.join(workDir, `in.${ext}`);
    await fs.writeFile(inFile, await sr.text(), 'utf8');

    const outBase = path.join(workDir, 'out');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(DOGSITE3_BIN, ['--proteinFile', inFile, '--writeDescToFile', '-o', outBase],
        { cwd: path.dirname(DOGSITE3_BIN) });
      let stderr = '';
      child.stderr.on('data', d => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', code => (code === 0 ? resolve() : reject(new Error(`dogsite3 exit ${code}: ${stderr.slice(0, 200)}`))));
    });

    // find + parse the descriptor TSV (header-driven, so column order changes don't break us)
    const files = await fs.readdir(workDir);
    const descName = files.find(f => f.startsWith('out') && /desc|\.txt$|\.tsv$/i.test(f));
    if (!descName) throw new Error(`no descriptor file (have: ${files.join(', ')})`);
    const text = await fs.readFile(path.join(workDir, descName), 'utf8');
    return parseDescriptorTSV(text);
  } finally {
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Header-driven parse of the DoGSite3 `--writeDescToFile` TSV (verified against v1.2.0).
export function parseDescriptorTSV(text: string): RawPocket[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];
  const header = lines[0].split('\t').map(h => h.trim());
  const col = (name: string) => header.indexOf(name);
  const ci = {
    name: col('name'), volume: col('volume'), enclosure: col('enclosure'),
    depth: col('depth'), hydrophobicity: col('hydrophobicity'), surfVol: col('surf/vol'),
  };
  if (ci.name < 0 || ci.volume < 0) return [];
  const out: RawPocket[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const name = (c[ci.name] || '').trim();
    if (!/^P_\d+$/.test(name)) continue; // top-level pockets only
    out.push({
      name, volume: num(c[ci.volume]), enclosure: num(c[ci.enclosure]),
      depth: num(c[ci.depth]), hydrophobicity: num(c[ci.hydrophobicity]), surfVol: num(c[ci.surfVol]),
    });
  }
  return out;
}

// ── shape the raw pockets into the top-3 display rows ──
function shapePockets(raw: RawPocket[]): { rows: PocketRow[]; total: number } {
  const byVolume = [...raw].sort((a, b) => b.volume - a.volume);
  const top3 = byVolume.slice(0, 3);
  // "primary" = the largest ENCLOSED pocket among those shown (enclosure ≥ 0.5);
  // if none of the shown pockets is enclosed, fall back to the largest by volume.
  const enclosedShown = top3.filter(p => p.enclosure >= 0.5).sort((a, b) => b.volume - a.volume);
  const primaryName = (enclosedShown[0] ?? top3[0])?.name ?? null;
  const rows = top3.map(p => ({
    name: p.name, volume: r0(p.volume), enclosure: r2(p.enclosure), depth: r1(p.depth),
    hydrophobicity: r2(p.hydrophobicity), surfVol: r2(p.surfVol), primary: p.name === primaryName,
  }));
  return { rows, total: raw.length };
}

// ── cache (DoGSite3 is deterministic per structure) ──
const cache = new Map<string, PocketStructure>();
const cacheKey = (engine: string, s: StructureRef) => `${engine}::${s.kind}:${s.id}`;

// ── main entry ──
export async function getPocketStructure(gene: string, uniprotIn?: string | null): Promise<PocketStructure> {
  const base: PocketStructure = {
    gene, uniprot: uniprotIn ?? null, engine: DOGSITE3_ENABLED ? 'DoGSite3 v1.2.0 (local)' : 'DoGSite3 (proteins.plus)',
    structure: { kind: 'none', id: null, label: '', method: null, resolution: null, plddt: null, url: null },
    pockets: [], totalPockets: 0, note: '',
  };
  try {
    const uniprot = uniprotIn || await geneToUniprot(gene);
    if (!uniprot) {
      base.structure.label = 'No structure available — could not resolve to a UniProt entry';
      base.note = `No structure available — pocket analysis not possible for ${gene}.`;
      return base;
    }
    base.uniprot = uniprot;

    const structure = await resolveStructure(uniprot);
    base.structure = structure;

    // explicit no-structure case — never render as a zero/blank score
    if (structure.kind === 'none') {
      base.note = `No experimental or AlphaFold structure available for ${gene} (${uniprot}) — pocket analysis not possible.`;
      return base;
    }

    const key = cacheKey(base.engine, structure);
    const hit = cache.get(key);
    if (hit) return { ...hit, gene, uniprot };

    const raw = DOGSITE3_ENABLED ? await pocketsViaLocalBinary(structure) : await pocketsViaProteinsPlus(structure);
    const { rows, total } = shapePockets(raw);
    base.pockets = rows;
    base.totalPockets = total;
    base.note = total === 0
      ? `No pockets detected on the ${structure.kind === 'experimental' ? 'experimental' : 'AlphaFold'} structure.`
      : `${total} pocket${total === 1 ? '' : 's'} detected · showing top ${rows.length} by volume · DoGSite3 descriptors (descriptive only — not a druggability score).`;

    cache.set(key, { ...base });
    return base;
  } catch (e: any) {
    return { ...base, error: String(e?.message || e).slice(0, 200) };
  }
}
