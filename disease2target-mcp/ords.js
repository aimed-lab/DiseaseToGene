// ords.js ─────────────────────────────────────────────────────────────────────
// Standalone READ-ONLY client for the Disease2Target ORDS bridge.
//
// This is a self-contained copy of the read layer used by the main app
// (ordsService.ts). It has NO dependency on the rest of the repo, so this folder
// can be handed over and run on its own. Node 18+ (global fetch) required.
//
// The bridge is public and read-only. No credentials are needed. Override the
// host only if the deployment moves (see .env.example):
//   ORDS_BASE_URL=https://aimed.uab.edu/apex/d2towner
// ------------------------------------------------------------------------------

const DEFAULT_BASE = 'https://aimed.uab.edu/apex/d2towner';
const MODULE = 'd2t';
// ORDS serves up to 10k rows per page; big pages + parallel waves make a full-snapshot
// evidence pull (~55k rows) take seconds rather than minutes.
const PAGE = 5000;
const PAGE_CONCURRENCY = 6;   // parallel page requests per wave

export const baseUrl = () => (process.env.ORDS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');

async function ordsGet(path, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${baseUrl()}/${MODULE}/${path}${qs ? `?${qs}` : ''}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`ORDS GET ${path} -> ${r.status}`);
  return r.json();
}

// One page, with a single retry — a transient blip on one page of a parallel wave should
// not sink the whole pull.
async function ordsPage(path, params, offset) {
  const call = () => ordsGet(path, { ...params, limit: PAGE, offset })
    .then(j => (Array.isArray(j.items) ? j.items : []));
  try { return await call(); } catch { return await call(); }
}

// Collect every row of a paginated ORDS query. Fetch page 0 to learn whether there is more,
// then fan the remaining pages out in parallel waves rather than walking them one at a time.
async function ordsGetAll(path, params = {}) {
  const first = await ordsGet(path, { ...params, limit: PAGE, offset: 0 });
  const firstItems = Array.isArray(first.items) ? first.items : [];
  const all = [...firstItems];
  if (!first.hasMore || firstItems.length < PAGE) return all;

  let offset = firstItems.length;
  for (;;) {
    const offsets = Array.from({ length: PAGE_CONCURRENCY }, (_, i) => offset + i * PAGE);
    const waves = await Promise.all(offsets.map(o => ordsPage(path, params, o)));
    let ended = false;
    for (const items of waves) { all.push(...items); if (items.length < PAGE) ended = true; }
    if (ended) break;
    offset += PAGE_CONCURRENCY * PAGE;
    if (offset > 5_000_000) break;   // backstop against an unbounded loop
  }
  return all;
}

const safeParse = (v) => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
};

// ── read functions — same shapes the main app returns ──

export async function listSnapshots(diseaseId) {
  return ordsGetAll('snapshots', { disease_id: diseaseId });
}

export async function getSnapshot(id) {
  const j = await ordsGet(`snapshots/${id}`);
  const row = Array.isArray(j.items) ? j.items[0] : j;
  if (!row) return null;
  return { ...row, weights: safeParse(row.weights), provenance: safeParse(row.provenance), targets: safeParse(row.targets) ?? [] };
}

export async function listRankingScores(snapshotId) {
  return ordsGetAll(`snapshots/${snapshotId}/scores`);
}

export async function snapshotEvidence(snapshotId) {
  return ordsGetAll(`snapshots/${snapshotId}/evidence`);
}

export async function evidenceForGene(gene) {
  if (!gene) return [];
  const rows = await ordsGetAll(`evidence/gene/${encodeURIComponent(gene)}`);
  return rows.map((r) => ({ ...r, value_json: safeParse(r.value_json) ?? r.value_json }));
}

// ── network tables (NETWORK_RUN / NETWORK_SCORE / GENE_IDENTIFIER_MAPPING, Sep 2026) ──
// Every WINNER run with its graph context. A run is a property of gene + graph + parameters;
// scores from different runs are never comparable (is_primary marks the one the board uses).
export async function networkRuns(snapshotId) {
  return ordsGetAll('network/runs', { snapshot_id: snapshotId });
}

// One gene across ALL runs (disease candidate graphs, expanded graphs, the global interactome
// when loaded), each row labelled with its context and a STATUS that says why a score is or
// is not there (PRESENT / ABSENT_FROM_GRAPH / NOT_IN_CANDIDATE_SET).
export async function networkForGene(gene) {
  if (!gene) return [];
  return ordsGetAll(`network/gene/${encodeURIComponent(gene)}`);
}

// How the Open Targets symbol resolved to a STRING protein (EXACT / ALIAS / OVERRIDE /
// AMBIGUOUS / COLLISION / ABSENT_FROM_STRING). Tells "renamed" apart from "missing".
export async function mappingForGene(gene) {
  if (!gene) return [];
  return ordsGetAll(`network/mapping/${encodeURIComponent(gene)}`);
}

// ── live STRING partners (public STRING API; the only non-ORDS call in this folder) ──
export async function stringNeighbors(gene, { minScore = 400, limit = 60 } = {}) {
  const url = `https://string-db.org/api/json/interaction_partners?identifiers=${encodeURIComponent(gene)}&species=9606&required_score=${minScore}&limit=${limit}&caller_identity=disease2target_mcp`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .map(x => ({ symbol: String(x.preferredName_B || '').toUpperCase(), score: Number(x.score) || 0 }))
    .filter(n => n.symbol && n.symbol !== String(gene).toUpperCase());
}
