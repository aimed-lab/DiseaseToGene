// KnowledgeGraphView — the unified, queryable knowledge graph for a snapshot.
// Reads GET /api/graph (KG_NODES + KG_EDGES, projected by `d2t.ts kg <id>`) and
// renders it as an interactive d3 force-directed graph on a <canvas> (canvas, not
// SVG, so ~20k edges stay smooth). Filter by node type / relationship, search a
// gene, double-click to focus its ego network, click for a provenance-honest
// details panel. Nothing here recomputes biology — it just explores what the
// projector already materialised in Oracle.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Loader2, Search, Crosshair, X, Network, ExternalLink } from 'lucide-react';
import type { Theme } from './types';

interface KgNode { key: string; type: string; label: string; degree: number; props: any; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null; }
interface KgEdge { source: any; target: any; rel: string; weight: number | null; confidence: string | null; src: string | null; props: any; }
interface KgPayload { snapshot_id: number; disease_name: string; disease_id: string; stats: { nodes: Record<string, number>; edges: Record<string, number>; nodeTotal: number; edgeTotal: number }; nodes: KgNode[]; edges: KgEdge[]; }

const TYPE_COLOR: Record<string, string> = {
  gene: '#3b82f6', disease: '#ef4444', drug: '#22c55e', trial: '#a855f7',
  pathway: '#f59e0b', tissue: '#14b8a6', paper: '#94a3b8', variant: '#ec4899',
};
const TYPE_ORDER = ['gene', 'disease', 'drug', 'trial', 'pathway', 'tissue', 'variant', 'paper'];
const REL_ORDER = ['interacts_with', 'associated_with', 'targeted_by', 'tested_in', 'for', 'in_pathway', 'dysregulated_in', 'has_variant', 'paralog_of', 'peaks_in', 'mentioned_in', 'studied_in'];
const REL_LABEL: Record<string, string> = {
  interacts_with: 'PPI (STRING)', associated_with: 'gene→disease', targeted_by: 'gene→drug', tested_in: 'drug→trial',
  for: 'trial→disease', in_pathway: 'gene→pathway', dysregulated_in: 'dysregulated', has_variant: 'gene→variant',
  paralog_of: 'paralog', peaks_in: 'gene→tissue', mentioned_in: 'gene→paper', studied_in: 'disease→paper',
};
// Default visible set — the "therapeutic backbone" + PPI. Papers/pathways/variants are
// toggled off initially so the first canvas is legible; the checkboxes reveal them.
const DEFAULT_TYPES = new Set(['gene', 'disease', 'drug', 'trial', 'tissue']);
const DEFAULT_RELS = new Set(['interacts_with', 'associated_with', 'targeted_by', 'tested_in', 'for', 'peaks_in']);

export default function KnowledgeGraphView({ theme, diseaseName }: { theme: Theme; diseaseName?: string }) {
  const isDark = theme === 'dark';
  const [data, setData] = useState<KgPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visTypes, setVisTypes] = useState<Set<string>>(new Set(DEFAULT_TYPES));
  const [visRels, setVisRels] = useState<Set<string>>(new Set(DEFAULT_RELS));
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<KgNode | null>(null);
  const [search, setSearch] = useState('');
  const [geneLimit, setGeneLimit] = useState<number | 'all'>(100);   // show the top-N genes by rank (declutters the hairball)

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<d3.Simulation<any, any> | null>(null);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());     // persist layout across filter changes
  const tformRef = useRef(d3.zoomIdentity);
  const sizeRef = useRef({ w: 800, h: 600 });
  const selRef = useRef<string | null>(null);
  const focusRef = useRef<string | null>(null);

  // ── load the graph ──
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    fetch(`/api/graph${diseaseName ? `?disease=${encodeURIComponent(diseaseName)}` : ''}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`); return r.json(); })
      .then((j: KgPayload) => { if (alive) { setData(j); setLoading(false); } })
      .catch(e => { if (alive) { setError(String(e?.message || e)); setLoading(false); } });
    return () => { alive = false; };
  }, [diseaseName]);

  // adjacency (for ego-focus + neighbour highlight), built once per dataset
  const adj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!data) return m;
    for (const e of data.edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.key;
      const t = typeof e.target === 'string' ? e.target : e.target.key;
      (m.get(s) ?? m.set(s, new Set()).get(s)!).add(t);
      (m.get(t) ?? m.set(t, new Set()).get(t)!).add(s);
    }
    return m;
  }, [data]);

  // ── the filtered view (nodes + links actually drawn) ──
  const view = useMemo(() => {
    if (!data) return { nodes: [] as KgNode[], links: [] as KgEdge[] };
    const focusSet = focus ? new Set<string>([focus, ...(adj.get(focus) ?? [])]) : null;
    const nodeByKey = new Map(data.nodes.map(n => [n.key, n]));
    // Gene budget: keep only the top-N genes by rank (peripheral, rank-less paralog nodes drop
    // out first). Non-gene nodes are unaffected here; they still render only if they stay
    // connected to a visible gene. The focused gene is always allowed.
    const geneRank = (n: KgNode) => (typeof n.props?.rank === 'number' ? n.props.rank : Number.POSITIVE_INFINITY);
    // While focused, the ego network already bounds the view — don't also apply the gene budget
    // (otherwise a focused gene's higher-rank neighbours would vanish).
    const allowedGenes: Set<string> | null = (geneLimit === 'all' || focus) ? null
      : new Set(data.nodes.filter(n => n.type === 'gene').sort((a, b) => geneRank(a) - geneRank(b)).slice(0, geneLimit).map(n => n.key));
    const geneOK = (key: string, n?: KgNode) => { const node = n ?? nodeByKey.get(key); if (!node) return false; return !(node.type === 'gene' && allowedGenes && !allowedGenes.has(key) && key !== focus); };
    const links = data.edges.filter(e => {
      if (!visRels.has(e.rel)) return false;
      const s = typeof e.source === 'string' ? e.source : e.source.key;
      const t = typeof e.target === 'string' ? e.target : e.target.key;
      const sn = nodeByKey.get(s), tn = nodeByKey.get(t);
      if (!sn || !tn || !visTypes.has(sn.type) || !visTypes.has(tn.type)) return false;
      if (!geneOK(s, sn) || !geneOK(t, tn)) return false;
      if (focusSet && !(focusSet.has(s) && focusSet.has(t))) return false;
      return true;
    });
    const connected = new Set<string>();
    for (const e of links) { connected.add(typeof e.source === 'string' ? e.source : e.source.key); connected.add(typeof e.target === 'string' ? e.target : e.target.key); }
    // Render nodes of visible types that survive the gene budget and are connected (or the disease hub, or the focus).
    const nodes = data.nodes.filter(n => visTypes.has(n.type) && geneOK(n.key, n) && (connected.has(n.key) || n.type === 'disease' || n.key === focus) && (!focusSet || focusSet.has(n.key)));
    // seed persisted positions so filtering doesn't scramble the layout
    for (const n of nodes) { const p = posRef.current.get(n.key); if (p) { n.x = p.x; n.y = p.y; } }
    return { nodes, links: links.map(e => ({ ...e, source: typeof e.source === 'string' ? e.source : e.source.key, target: typeof e.target === 'string' ? e.target : e.target.key })) };
  }, [data, visTypes, visRels, focus, adj, geneLimit]);

  const radius = useCallback((n: KgNode) => Math.max(2.5, Math.min(16, 3 + Math.sqrt(n.degree || 1))), []);

  // ── simulation + canvas rendering ──
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap || !view.nodes.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => { const r = wrap.getBoundingClientRect(); sizeRef.current = { w: r.width, h: r.height }; canvas.width = r.width * dpr; canvas.height = r.height * dpr; canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px'; };
    resize();
    const { w, h } = sizeRef.current;
    const ctx = canvas.getContext('2d')!;
    const nodes = view.nodes, links = view.links;

    const sim = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links as any).id((d: any) => d.key).distance((l: any) => l.rel === 'interacts_with' ? 40 : 60).strength(0.25))
      .force('charge', d3.forceManyBody().strength(-90).distanceMax(400))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collide', d3.forceCollide().radius((d: any) => radius(d) + 2))
      .alpha(0.9).alphaDecay(0.03);
    simRef.current = sim;

    const draw = () => {
      const t = tformRef.current;
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      ctx.translate(t.x, t.y); ctx.scale(t.k, t.k);
      const sel = selRef.current;
      const hi = sel ? new Set<string>([sel, ...(adj.get(sel) ?? [])]) : null;
      // edges
      ctx.lineWidth = 0.6 / t.k;
      for (const l of links as any[]) {
        const s = l.source, tg = l.target; if (!s.x || !tg.x) continue;
        const on = !hi || (hi.has(s.key) && hi.has(tg.key));
        ctx.strokeStyle = l.rel === 'interacts_with'
          ? (on ? 'rgba(59,130,246,0.35)' : (isDark ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.06)'))
          : (on ? (isDark ? 'rgba(148,163,184,0.28)' : 'rgba(100,116,139,0.28)') : (isDark ? 'rgba(148,163,184,0.04)' : 'rgba(100,116,139,0.05)'));
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tg.x, tg.y); ctx.stroke();
      }
      // nodes
      ctx.font = `${11 / t.k}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const n of nodes as any[]) {
        if (n.x == null) continue;
        const on = !hi || hi.has(n.key);
        const r = radius(n);
        ctx.globalAlpha = on ? 1 : 0.15;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLOR[n.type] || '#888'; ctx.fill();
        if (n.key === sel) { ctx.lineWidth = 2 / t.k; ctx.strokeStyle = isDark ? '#fff' : '#0f172a'; ctx.stroke(); }
        // label the hubs / zoomed-in / selected neighbourhood
        if (on && (n.degree > 18 || t.k > 1.6 || (hi && hi.has(n.key) && sel))) {
          ctx.globalAlpha = on ? 0.9 : 0.15;
          ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a';
          ctx.fillText(n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label, n.x, n.y - r - 6 / t.k);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    sim.on('tick', () => { for (const n of nodes as any[]) if (n.x != null) posRef.current.set(n.key, { x: n.x, y: n.y }); draw(); });

    // ── pointer → sim-space, and node hit-test ──
    const toSim = (clientX: number, clientY: number) => { const r = canvas.getBoundingClientRect(); const t = tformRef.current; return { x: (clientX - r.left - t.x) / t.k, y: (clientY - r.top - t.y) / t.k }; };
    const pick = (clientX: number, clientY: number): KgNode | null => {
      const { x, y } = toSim(clientX, clientY);
      let best: KgNode | null = null, bd = Infinity;
      for (const n of nodes as any[]) { if (n.x == null) continue; const d = (n.x - x) ** 2 + (n.y - y) ** 2; const rr = (radius(n) + 5) ** 2; if (d < rr && d < bd) { bd = d; best = n; } }
      return best;
    };

    // ── zoom / pan — but let a mousedown/touch that lands ON a node fall through to drag ──
    const zoom = d3.zoom<HTMLCanvasElement, unknown>().scaleExtent([0.1, 8])
      .filter((ev: any) => {
        if (ev.type === 'wheel') return true;                 // wheel always zooms
        const cx = ev.clientX ?? ev.touches?.[0]?.clientX, cy = ev.clientY ?? ev.touches?.[0]?.clientY;
        return !(cx != null && pick(cx, cy));                 // pan only when NOT starting on a node
      })
      .on('zoom', (ev) => { tformRef.current = ev.transform; draw(); });
    const sel = d3.select(canvas);
    sel.call(zoom as any);
    sel.call(zoom.transform as any, tformRef.current);         // restore prior transform

    // ── drag a node (rest of the graph reacts via the sim) · click to select · dbl-click to focus ──
    let dragNode: KgNode | null = null, downXY: [number, number] | null = null, moved = false;
    const onDown = (ev: MouseEvent) => {
      downXY = [ev.clientX, ev.clientY]; moved = false;
      dragNode = pick(ev.clientX, ev.clientY);
      if (dragNode) { (dragNode as any).fx = (dragNode as any).x; (dragNode as any).fy = (dragNode as any).y; canvas.style.cursor = 'grabbing'; }
    };
    const onMove = (ev: MouseEvent) => {
      const wasMoving = moved;
      if (downXY && Math.hypot(ev.clientX - downXY[0], ev.clientY - downXY[1]) > 3) moved = true;
      if (dragNode && moved) { if (!wasMoving) sim.alphaTarget(0.3).restart(); const p = toSim(ev.clientX, ev.clientY); (dragNode as any).fx = p.x; (dragNode as any).fy = p.y; }
    };
    const onUp = (ev: MouseEvent) => {
      if (dragNode) {
        (dragNode as any).fx = null; (dragNode as any).fy = null; sim.alphaTarget(0);   // release → physics resumes
        if (!moved) { selRef.current = dragNode.key; setSelected(dragNode); draw(); }   // a click, not a drag → select
        dragNode = null; canvas.style.cursor = 'grab';
      } else if (downXY && !moved) {                                                     // click on empty space → clear selection
        selRef.current = null; setSelected(null); draw();
      }
      downXY = null;
    };
    // grab-cursor affordance when hovering a node (only when not mid-drag)
    const onHover = (ev: MouseEvent) => { if (dragNode) return; canvas.style.cursor = pick(ev.clientX, ev.clientY) ? 'grab' : 'default'; };
    const onDbl = (ev: MouseEvent) => { const n = pick(ev.clientX, ev.clientY); if (n) { focusRef.current = n.key; setFocus(n.key); } };
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onHover);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('dblclick', onDbl);
    const ro = new ResizeObserver(() => { resize(); const c = sizeRef.current; (sim.force('center') as any)?.x(c.w / 2)?.y(c.h / 2); sim.alpha(0.3).restart(); });
    ro.observe(wrap);

    return () => {
      sim.stop(); ro.disconnect();
      canvas.removeEventListener('mousedown', onDown); canvas.removeEventListener('mousemove', onHover);
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('dblclick', onDbl); sel.on('.zoom', null);
    };
  }, [view, isDark, radius, adj]);

  // search → select + center on a matching node
  const runSearch = () => {
    if (!data || !search.trim()) return;
    const q = search.trim().toLowerCase();
    const hit = data.nodes.find(n => n.label.toLowerCase() === q || n.key.toLowerCase() === `gene:${q}`) || data.nodes.find(n => n.label.toLowerCase().includes(q));
    if (hit) { if (!visTypes.has(hit.type)) setVisTypes(new Set([...visTypes, hit.type])); selRef.current = hit.key; setSelected(hit); setFocus(hit.key); }
  };

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); setter(n); };

  const card = isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200';
  const chip = (active: boolean, color?: string) => `flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold border transition-all ${active ? (isDark ? 'bg-slate-800 border-slate-600 text-white' : 'bg-slate-100 border-slate-300 text-slate-900') : (isDark ? 'bg-transparent border-slate-800 text-slate-500' : 'bg-transparent border-slate-200 text-slate-400')}`;

  if (loading) return <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /><p className="text-sm">Loading knowledge graph…</p></div>;
  if (error) {
    // A DB-connectivity failure (VPN down / Oracle unreachable) is NOT a "not built"
    // problem — tell the user what actually went wrong so they don't rebuild needlessly.
    const isConn = /timed out|NJS-|ORA-\d|connect|ECONN|network|unreachable|transportConnect|503|Oracle store disabled/i.test(error);
    return <div className="h-full flex flex-col items-center justify-center gap-2 text-center p-8">
      <Network className="w-10 h-10 text-slate-400 mb-2" />
      <p className="text-sm font-semibold text-red-500">{isConn ? 'Database unreachable' : "Couldn't load the graph"}</p>
      <p className="text-xs text-slate-500 max-w-md break-words">{error}</p>
      {isConn
        ? <p className="text-xs text-slate-400 mt-2">Oracle is internal-only — check you're on the <b>UAB VPN</b>, then <button onClick={() => { setLoading(true); setError(null); fetch(`/api/graph${diseaseName ? `?disease=${encodeURIComponent(diseaseName)}` : ''}`).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`); return r.json(); }).then((j: KgPayload) => { setData(j); setLoading(false); }).catch(e => { setError(String(e?.message || e)); setLoading(false); }); }} className="underline font-semibold">retry</button>. The graph is already built — no rebuild needed.</p>
        : <p className="text-xs text-slate-400 mt-2">If the graph was never built for this snapshot, run: <code className="px-1 rounded bg-slate-500/10">npx tsx --env-file=.env scripts/d2t.ts kg 102</code></p>}
    </div>;
  }
  if (!data) return null;

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} flex-wrap`}>
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-blue-500" />
          <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Knowledge Graph</span>
          <span className="text-[11px] text-slate-500">{data.disease_name} · #{data.snapshot_id}</span>
        </div>
        <span className="text-[11px] text-slate-500">{data.stats.nodeTotal.toLocaleString()} nodes · {data.stats.edgeTotal.toLocaleString()} edges · showing {view.nodes.length}/{view.links.length}</span>
        <div className="flex-1" />
        <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${card}`} title="Limit the graph to the top-N genes by rank — the fastest way to cut the hairball">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Genes</span>
          <select value={String(geneLimit)} onChange={e => setGeneLimit(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className={`bg-transparent text-xs outline-none cursor-pointer ${isDark ? 'text-white' : 'text-slate-900'}`}>
            <option value="25">Top 25</option>
            <option value="50">Top 50</option>
            <option value="100">Top 100</option>
            <option value="200">Top 200</option>
            <option value="300">Top 300</option>
            <option value="all">All ({(data.stats.nodes.gene ?? 0).toLocaleString()})</option>
          </select>
        </div>
        <div className={`flex items-center gap-1 rounded-md border px-2 ${card}`}>
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()} placeholder="Find a gene…" className={`bg-transparent text-xs py-1.5 w-32 outline-none ${isDark ? 'text-white placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'}`} />
        </div>
        {focus && <button onClick={() => { setFocus(null); focusRef.current = null; }} className={chip(true)}><Crosshair className="w-3 h-3" /> Focus: {data.nodes.find(n => n.key === focus)?.label} <X className="w-3 h-3" /></button>}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* filters rail */}
        <div className={`w-44 shrink-0 border-r overflow-y-auto p-3 space-y-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Node types</p>
            <div className="space-y-1">
              {TYPE_ORDER.filter(t => data.stats.nodes[t]).map(t => (
                <button key={t} onClick={() => toggle(visTypes, t, setVisTypes)} className={`w-full ${chip(visTypes.has(t))}`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TYPE_COLOR[t] }} />
                  <span className="capitalize flex-1 text-left">{t}</span>
                  <span className="text-slate-500">{data.stats.nodes[t]}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Relationships</p>
            <div className="space-y-1">
              {REL_ORDER.filter(r => data.stats.edges[r]).map(r => (
                <button key={r} onClick={() => toggle(visRels, r, setVisRels)} className={`w-full ${chip(visRels.has(r))}`}>
                  <span className="flex-1 text-left truncate" title={r}>{REL_LABEL[r] || r}</span>
                  <span className="text-slate-500">{data.stats.edges[r]}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed pt-1">Drag a node to move it · click for details · double-click to focus its neighbours · scroll to zoom · drag the background to pan.</p>
        </div>

        {/* canvas */}
        <div ref={wrapRef} className={`flex-1 relative min-h-0 ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}>
          <canvas ref={canvasRef} className="absolute inset-0" />
          {/* details panel */}
          {selected && (
            <div className={`absolute top-3 right-3 w-72 rounded-lg border shadow-xl p-3.5 ${card}`}>
              <div className="flex items-start gap-2 mb-2">
                <span className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: TYPE_COLOR[selected.type] }} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold break-words ${isDark ? 'text-white' : 'text-slate-900'}`}>{selected.label}</p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{selected.type} · degree {selected.degree}</p>
                </div>
                <button onClick={() => { setSelected(null); selRef.current = null; }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {Object.entries(selected.props || {}).filter(([, v]) => v != null && v !== '' && typeof v !== 'object').map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 text-[11px]">
                    <span className="text-slate-500 capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className={`text-right break-words ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{String(v)}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => { setFocus(selected.key); focusRef.current = selected.key; }} className={`flex-1 ${chip(true)} justify-center`}><Crosshair className="w-3 h-3" /> Focus neighbours</button>
                {selected.type === 'trial' && selected.props?.url && <a href={selected.props.url} target="_blank" rel="noreferrer" className={`${chip(true)} justify-center`}><ExternalLink className="w-3 h-3" /></a>}
                {selected.type === 'paper' && selected.props?.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${selected.props.pmid}`} target="_blank" rel="noreferrer" className={`${chip(true)} justify-center`}><ExternalLink className="w-3 h-3" /></a>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
