// ordsService.ts ────────────────────────────────────────────────────────────
// READ-ONLY Oracle access over ORDS (Oracle REST Data Services), for hosts that
// cannot open a SQL*Net connection to the internal Oracle DB — i.e. Vercel.
//
// It mirrors the READ functions of oracleService.ts one-for-one and returns the
// SAME shapes (same JSON keys), so server.ts can swap between them transparently:
//   USE_ORDS=1  → reads go through ORDS (this module) over HTTPS
//   otherwise   → reads go through oracleService.ts (node-oracledb, internal only)
//
// It is READ-ONLY by construction: there are no write functions here. Harvest /
// save / delete stay on oracleService (they run inside UAB where Oracle is reachable).
//
// Config (env):
//   ORDS_BASE_URL     schema ORDS root, e.g. https://apex.uab.edu/ords/diseasetotarget_app
//                     (NO trailing slash, NO module segment — the module base 'd2t' is added here)
//   ORDS_CLIENT_ID    (optional) OAuth2 client-credentials id — if set, calls are Bearer-authenticated
//   ORDS_CLIENT_SECRET(optional) OAuth2 client-credentials secret
// If no client id/secret is set, endpoints are called unauthenticated (public read-only ORDS).

const MODULE = 'd2t'; // must match ORDS DEFINE_MODULE p_base_path ('/d2t/') — see docs/ORDS_Setup.md
// ORDS honours up to 10k rows/page (it clamps larger requests to 10k). A fully-enriched
// snapshot's evidence is ~50k+ rows, so we fetch big pages AND fan the later pages out in
// parallel waves — measured ~39s → ~8s for #102's 53k-row evidence pull.
const PAGE = 10000;       // rows per page (ORDS server-side max)
const PAGE_CONCURRENCY = 6; // parallel page requests per wave

const baseUrl = () => (process.env.ORDS_BASE_URL || '').replace(/\/+$/, '');
export const ordsEnabled = (): boolean => process.env.USE_ORDS === '1' && !!process.env.ORDS_BASE_URL;

const CLIENT_ID = () => process.env.ORDS_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.ORDS_CLIENT_SECRET || '';

// ── OAuth2 client-credentials token (cached until shortly before expiry) ──
let _tok: { value: string; exp: number } = { value: '', exp: 0 };
async function bearer(): Promise<string | null> {
  if (!CLIENT_ID()) return null; // unauthenticated (public read-only) mode
  if (_tok.value && Date.now() < _tok.exp - 30_000) return _tok.value;
  const basic = Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString('base64');
  const r = await fetch(`${baseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`ORDS token → ${r.status}`);
  const j: any = await r.json();
  _tok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return _tok.value;
}

async function ordsGet(path: string, params: Record<string, any> = {}): Promise<any> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${baseUrl()}/${MODULE}/${path}${qs ? `?${qs}` : ''}`;
  const token = await bearer();
  const r = await fetch(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!r.ok) throw new Error(`ORDS GET ${path} → ${r.status}`);
  return r.json();
}

// One page fetch with a single retry (a transient blip on one parallel page
// shouldn't sink the whole pull).
async function ordsPage(path: string, params: Record<string, any>, offset: number): Promise<any[]> {
  const call = () => ordsGet(path, { ...params, limit: PAGE, offset }).then(j => (Array.isArray(j.items) ? j.items : []));
  try { return await call(); } catch { return await call(); }
}

// Collect every row of a paginated ORDS query. Fetch page 0 to learn whether there's
// more, then fan out the remaining pages in parallel waves instead of walking them one
// at a time — the sequential walk was the dashboard's dominant cold-load latency.
async function ordsGetAll(path: string, params: Record<string, any> = {}): Promise<any[]> {
  const first = await ordsGet(path, { ...params, limit: PAGE, offset: 0 });
  const firstItems: any[] = Array.isArray(first.items) ? first.items : [];
  const all: any[] = [...firstItems];
  // A short page (or no hasMore) means we already have everything.
  if (!first.hasMore || firstItems.length < PAGE) return all;

  let offset = firstItems.length;
  for (;;) {
    const offsets = Array.from({ length: PAGE_CONCURRENCY }, (_, i) => offset + i * PAGE);
    const waves = await Promise.all(offsets.map(o => ordsPage(path, params, o)));
    let ended = false;
    for (const items of waves) { all.push(...items); if (items.length < PAGE) ended = true; }
    if (ended) break;
    offset += PAGE_CONCURRENCY * PAGE;
    if (offset > 5_000_000) break; // safety backstop against an unbounded loop
  }
  return all;
}

const safeParse = (v: any): any => {
  if (v == null) return null;
  if (typeof v !== 'string') return v; // ORDS may already return JSON columns as objects
  try { return JSON.parse(v); } catch { return null; }
};

// ── read functions — identical signatures + return shapes to oracleService.ts ──

export async function listSnapshots(diseaseId?: string): Promise<any[]> {
  return ordsGetAll('snapshots', { disease_id: diseaseId });
}

export async function getSnapshot(id: number): Promise<any | null> {
  const j = await ordsGet(`snapshots/${id}`);
  const row: any = Array.isArray(j.items) ? j.items[0] : j;
  if (!row) return null;
  return { ...row, weights: safeParse(row.weights), provenance: safeParse(row.provenance), targets: safeParse(row.targets) ?? [] };
}

export async function listRankingScores(snapshotId: number): Promise<any[]> {
  return ordsGetAll(`snapshots/${snapshotId}/scores`);
}

export async function snapshotEvidence(snapshotId: number): Promise<any[]> {
  return ordsGetAll(`snapshots/${snapshotId}/evidence`);
}

export async function evidenceGeneSymbols(diseaseId?: string): Promise<string[]> {
  const rows = await ordsGetAll('evidence/genes', { disease_id: diseaseId });
  return rows.map((x: any) => x.g).filter(Boolean);
}

export async function evidenceForGene(gene: string): Promise<any[]> {
  if (!gene) return [];
  const rows = await ordsGetAll(`evidence/gene/${encodeURIComponent(gene)}`);
  return rows.map((r: any) => ({ ...r, value_json: safeParse(r.value_json) ?? r.value_json }));
}

// ── Knowledge Graph — mirrors oracleService.kgGraph / kgStats one-for-one so
// /api/graph works over ORDS with no VPN (needs docs/sql/kg_ords_module.sql run once).
export async function kgGraph(snapshotId: number): Promise<{ nodes: any[]; edges: any[] }> {
  const [nodes, edges] = await Promise.all([
    ordsGetAll(`kg/${snapshotId}/nodes`),
    ordsGetAll(`kg/${snapshotId}/edges`),
  ]);
  return {
    nodes: nodes.map((r: any) => ({ ...r, props: safeParse(r.props) })),
    edges: edges.map((r: any) => ({ ...r, props: safeParse(r.props) })),
  };
}

export async function kgStats(snapshotId: number): Promise<{ nodes: Record<string, number>; edges: Record<string, number>; nodeTotal: number; edgeTotal: number }> {
  const rows = await ordsGetAll(`kg/${snapshotId}/stats`);
  const nodes: Record<string, number> = {}, edges: Record<string, number> = {};
  let nodeTotal = 0, edgeTotal = 0;
  for (const r of rows) {
    const c = Number(r.c) || 0;
    if (r.kind === 'node') { nodes[r.t] = c; nodeTotal += c; }
    else if (r.kind === 'edge') { edges[r.t] = c; edgeTotal += c; }
  }
  return { nodes, edges, nodeTotal, edgeTotal };
}
