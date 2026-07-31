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
const PAGE = 500;     // page size for paginated pulls (evidence is large)

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

// Collect every row of a paginated ORDS query (follows hasMore/offset).
async function ordsGetAll(path: string, params: Record<string, any> = {}): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  for (;;) {
    const j = await ordsGet(path, { ...params, limit: PAGE, offset });
    const items: any[] = Array.isArray(j.items) ? j.items : [];
    all.push(...items);
    if (!j.hasMore || items.length === 0) break;
    offset += items.length;
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
