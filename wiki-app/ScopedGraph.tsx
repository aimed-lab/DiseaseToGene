// wiki-app/ScopedGraph.tsx — the knowledge graph, scoped to one entity.
//
// The Graph tab draws the whole snapshot (thousands of nodes). This draws ONE entity and its
// neighbourhood: the page's node in the middle, its direct neighbours around it, and — for a
// gene — the trials its drugs were tested in, so drug → trial reads as one picture. Built on
// the same cached, authenticated graph the rest of the wiki links from (graphIndex), so it
// costs no extra fetch and can never disagree with the chips beside it.
//
// Click a node → its wiki page. Same colours as KnowledgeGraphView so the two read as one.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { navigate, wikiUrl } from '../nav';
import type { GraphIndex, KgNode, KgEdge } from './wikiApi';

export const TYPE_COLOR: Record<string, string> = {
  gene: '#3b82f6', disease: '#ef4444', drug: '#22c55e', trial: '#a855f7',
  pathway: '#f59e0b', tissue: '#14b8a6', paper: '#94a3b8', variant: '#ec4899',
};
// PPI edges are the bulk of a gene's degree (KRAS: 154 of 196). They are shown last and
// capped, so drugs, trials and pathways — the therapeutic backbone — are never crowded out.
const TYPE_PRIORITY: Record<string, number> = { disease: 0, drug: 1, trial: 2, pathway: 3, variant: 4, tissue: 5, paper: 6, gene: 7 };

// d3 ships without types here (as in KnowledgeGraphView), so the simulation fields are declared by hand.
interface SimNode { key: string; type: string; label: string; degree: number; focus: boolean; hop: 1 | 2; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }
interface SimLink { source: string | SimNode; target: string | SimNode; rel: string }

export function scopeNeighbourhood(gi: GraphIndex, focusKey: string, limit: number): { nodes: SimNode[]; links: SimLink[]; total: number } {
  const focus = gi.node(focusKey);
  if (!focus) return { nodes: [], links: [], total: 0 };
  const seen = new Map<string, SimNode>();
  const add = (n: KgNode, hop: 1 | 2, isFocus = false) => { if (!seen.has(n.key)) seen.set(n.key, { key: n.key, type: n.type, label: n.label, degree: n.degree ?? 0, focus: isFocus, hop }); };
  add(focus, 1, true);
  // one hop, ordered so the backbone comes first and PPI fills what is left
  const one = gi.neighbours(focusKey).map(x => x.node);
  const uniq = [...new Map(one.map(n => [n.key, n])).values()]
    .sort((a, b) => (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9) || (b.degree ?? 0) - (a.degree ?? 0));
  const total = uniq.length;
  for (const n of uniq.slice(0, limit)) add(n, 1);
  // second hop only along the therapeutic backbone: drug → trial for a gene; gene → drug for a trial
  if (focus.type === 'gene' || focus.type === 'trial') {
    for (const n of [...seen.values()].filter(n => n.hop === 1 && (n.type === 'drug'))) {
      for (const x of gi.neighbours(n.key)) if (x.node.type === (focus.type === 'gene' ? 'trial' : 'gene') && seen.size < limit + 24) add(x.node, 2);
    }
  }
  const links: SimLink[] = [];
  const linkSeen = new Set<string>();
  for (const n of seen.values()) for (const e of gi.out(n.key)) {
    if (!seen.has(e.target)) continue;
    const id = `${e.source}→${e.target}:${e.rel}`; if (linkSeen.has(id)) continue; linkSeen.add(id);
    links.push({ source: e.source, target: e.target, rel: e.rel });
  }
  return { nodes: [...seen.values()], links, total };
}

export function ScopedGraph({ gi, focusKey, disease, snapshot, isDark, height = 340 }: { gi: GraphIndex; focusKey: string; disease: string; snapshot: number; isDark: boolean; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [limit, setLimit] = useState(40);
  const [hover, setHover] = useState<SimNode | null>(null);
  const scoped = useMemo(() => scopeNeighbourhood(gi, focusKey, limit), [gi, focusKey, limit]);
  const types = useMemo(() => [...new Set(scoped.nodes.map(n => n.type))].sort((a, b) => (TYPE_PRIORITY[a] ?? 9) - (TYPE_PRIORITY[b] ?? 9)), [scoped]);

  useEffect(() => {
    const svg = d3.select(ref.current!); svg.selectAll('*').remove();
    const width = ref.current!.clientWidth || 800;
    const nodes: SimNode[] = scoped.nodes.map(n => ({ ...n }));
    const byKey = new Map(nodes.map(n => [n.key, n]));
    const links: SimLink[] = scoped.links.map(l => ({ ...l, source: byKey.get(l.source as string)!, target: byKey.get(l.target as string)! })).filter(l => l.source && l.target);
    const g = svg.append('g');
    svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 4]).on('zoom', ev => g.attr('transform', ev.transform)) as any);
    const edgeStroke = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';
    const link = g.append('g').selectAll('line').data(links).join('line').attr('stroke', edgeStroke).attr('stroke-width', d => d.rel === 'interacts_with' ? 1 : 1.6);
    const node = g.append('g').selectAll<SVGGElement, SimNode>('g').data(nodes).join('g').style('cursor', 'pointer')
      .on('click', (_e, d) => { const to = wikiUrl.node(disease, snapshot, d.key); if (to && !d.focus) navigate(to); })
      .on('mouseenter', (_e, d) => setHover(d)).on('mouseleave', () => setHover(null))
      .call(d3.drag<SVGGElement, SimNode>()
        .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }) as any);
    node.append('circle').attr('r', d => d.focus ? 11 : d.hop === 2 ? 4.5 : 6.5).attr('fill', d => TYPE_COLOR[d.type] || '#888')
      .attr('stroke', d => d.focus ? (isDark ? '#fff' : '#111') : 'none').attr('stroke-width', 2).attr('opacity', d => d.hop === 2 ? 0.75 : 1);
    node.append('text').text(d => (d.type === 'trial' || d.type === 'paper' ? d.label.toUpperCase() : d.label).slice(0, 28))
      .attr('x', d => (d.focus ? 14 : 9)).attr('y', 4).attr('font-size', d => d.focus ? 12 : 10).attr('font-weight', d => d.focus ? 700 : 400)
      .attr('fill', isDark ? '#dcddde' : '#2e3338').attr('paint-order', 'stroke').attr('stroke', isDark ? '#1e1e1e' : '#fff').attr('stroke-width', 3)
      .style('pointer-events', 'none').attr('opacity', d => (d.hop === 2 || d.type === 'gene' && !d.focus && nodes.length > 30) ? 0.6 : 1);
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.key).distance(d => (d.rel === 'interacts_with' ? 70 : 90)).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-180))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<SimNode>().radius(d => (d.focus ? 24 : 14)))
      .on('tick', () => {
        link.attr('x1', d => (d.source as SimNode).x!).attr('y1', d => (d.source as SimNode).y!).attr('x2', d => (d.target as SimNode).x!).attr('y2', d => (d.target as SimNode).y!);
        node.attr('transform', d => `translate(${d.x},${d.y})`);
      });
    const f = nodes.find(n => n.focus); if (f) { f.fx = width / 2; f.fy = height / 2; }
    return () => { sim.stop(); };
  }, [scoped, isDark, disease, snapshot, height]);

  if (!scoped.nodes.length) return null;
  return (
    <div className={`rounded border overflow-hidden ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-white'}`}>
      <svg ref={ref} width="100%" height={height} style={{ display: 'block' }} />
      <div className={`flex items-center justify-between gap-3 flex-wrap px-3 py-1.5 text-[11px] border-t ${isDark ? 'border-white/10 text-neutral-400' : 'border-black/10 text-neutral-500'}`}>
        <div className="flex items-center gap-2 flex-wrap">
          {types.map(t => <span key={t} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />{t}</span>)}
          <span className="opacity-60">· {scoped.nodes.length - 1} of {scoped.total} neighbours{scoped.total > limit ? ' (backbone first, then PPI by degree)' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {hover && !hover.focus && <span className="truncate max-w-[280px]">{hover.type} · {hover.label}</span>}
          {scoped.total > limit && <button onClick={() => setLimit(l => l + 40)} className="underline">show more</button>}
          {limit > 40 && <button onClick={() => setLimit(40)} className="underline">fewer</button>}
        </div>
      </div>
    </div>
  );
}
