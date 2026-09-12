// wiki-app/wikiApi.ts — the wiki's reads. Every call carries the Supabase session (the
// server's /api/wiki/* routes are behind requireUser) and is memoised per URL for the life
// of the page: a snapshot is immutable, so nothing fetched under its id ever goes stale.
import { authenticatedFetch } from '../supabase';

export interface WikiSnapshotMeta { id: number; disease_id: string; disease_name: string; version: string | number; created_at: string; created_by: string | null; label: string | null; gene_count: number | null }
export interface WikiAxisSummary { evidence_type: string; source: string; rows: number; scored: number }
export interface WikiSummary { snapshot: WikiSnapshotMeta & { weights?: any; provenance?: any }; evidence_rows: number; axes: WikiAxisSummary[] }
export interface WikiEvidenceRow {
  id?: number; snapshot_id?: number; disease_id?: string; gene_symbol: string; evidence_type: string; source: string;
  source_url?: string | null; value_text: string | null; value_json: any; retrieved_at?: string | null; generated_by?: string | null; audit_status?: string | null;
}
export interface WikiScoreRow { gene_symbol: string; rank: number | null; overall_score: number | null; get_score: number | null; [k: string]: any }
export interface WikiGene { snapshot_id: number; symbol: string; score: WikiScoreRow | null; evidence: WikiEvidenceRow[]; gene_count: number }
export interface KgNode { key: string; type: string; label: string; degree: number | null; props: any }
export interface KgEdge { source: string; target: string; rel: string; weight: number | null; confidence: string | null; src: string | null; props: any }
export interface WikiGraph { snapshot_id: number; stats: { nodes: Record<string, number>; edges: Record<string, number>; nodeTotal: number; edgeTotal: number }; nodes: KgNode[]; edges: KgEdge[] }

const memo = new Map<string, Promise<any>>();
async function get<T>(path: string): Promise<T> {
  let p = memo.get(path);
  if (!p) {
    p = authenticatedFetch(path).then(async r => {
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${r.status}`); }
      return r.json();
    }).catch(e => { memo.delete(path); throw e; });
    memo.set(path, p);
  }
  return p as Promise<T>;
}

export const wikiApi = {
  snapshots: () => get<WikiSnapshotMeta[]>('/api/wiki/snapshots'),
  summary: (id: number) => get<WikiSummary>(`/api/wiki/${id}/summary`),
  gene: (id: number, symbol: string) => get<WikiGene>(`/api/wiki/${id}/gene/${encodeURIComponent(symbol.toUpperCase())}`),
  evidenceByType: (id: number, type: string) => get<{ rows: WikiEvidenceRow[] }>(`/api/wiki/${id}/evidence?type=${encodeURIComponent(type)}`),
  evidenceBySource: (id: number, source: string) => get<{ rows: WikiEvidenceRow[] }>(`/api/wiki/${id}/evidence?source=${encodeURIComponent(source)}`),
  graph: (id: number) => get<WikiGraph>(`/api/wiki/${id}/graph`),
  scores: (id: number) => get<WikiScoreRow[]>(`/api/snapshots/${id}/scores`),
};

// ── Graph index: the wiki's link structure, built once per snapshot ─────────
// Every page's "links" and "linked from" come from here, both directions, never hand-built
// per page type. Keyed by node key (gene:KRAS, drug:<slug>, trial:NCT…).
export interface GraphIndex {
  node: (key: string) => KgNode | null;
  out: (key: string) => KgEdge[];     // edges leaving key
  in: (key: string) => KgEdge[];      // edges arriving at key
  neighbours: (key: string) => Array<{ node: KgNode; edge: KgEdge; direction: 'out' | 'in' }>;
  byType: (type: string) => KgNode[];
  stats: WikiGraph['stats'];
}
const indexMemo = new Map<number, Promise<GraphIndex>>();
export function graphIndex(snapshot: number): Promise<GraphIndex> {
  let p = indexMemo.get(snapshot);
  if (!p) {
    p = wikiApi.graph(snapshot).then(g => {
      const nodes = new Map<string, KgNode>(g.nodes.map(n => [n.key, n]));
      const outE = new Map<string, KgEdge[]>(), inE = new Map<string, KgEdge[]>();
      for (const e of g.edges) {
        (outE.get(e.source) ?? outE.set(e.source, []).get(e.source)!).push(e);
        (inE.get(e.target) ?? inE.set(e.target, []).get(e.target)!).push(e);
      }
      const byType = new Map<string, KgNode[]>();
      for (const n of g.nodes) (byType.get(n.type) ?? byType.set(n.type, []).get(n.type)!).push(n);
      return {
        node: k => nodes.get(k) ?? null,
        out: k => outE.get(k) ?? [],
        in: k => inE.get(k) ?? [],
        neighbours: k => [
          ...(outE.get(k) ?? []).map(e => ({ node: nodes.get(e.target)!, edge: e, direction: 'out' as const })).filter(x => x.node),
          ...(inE.get(k) ?? []).map(e => ({ node: nodes.get(e.source)!, edge: e, direction: 'in' as const })).filter(x => x.node),
        ],
        byType: t => byType.get(t) ?? [],
        stats: g.stats,
      };
    }).catch(e => { indexMemo.delete(snapshot); throw e; });
    indexMemo.set(snapshot, p);
  }
  return p;
}
