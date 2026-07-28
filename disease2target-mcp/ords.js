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
const PAGE = 500;

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

// Collect every row of a paginated ORDS query (follows hasMore/offset).
async function ordsGetAll(path, params = {}) {
  const all = [];
  let offset = 0;
  for (;;) {
    const j = await ordsGet(path, { ...params, limit: PAGE, offset });
    const items = Array.isArray(j.items) ? j.items : [];
    all.push(...items);
    if (!j.hasMore || items.length === 0) break;
    offset += items.length;
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
