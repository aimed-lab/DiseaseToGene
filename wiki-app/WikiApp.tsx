// wiki-app/WikiApp.tsx — the provenance wiki. A separate full-page UI at /wiki: left tree,
// page, right "linked from" panel. Read-only. Login-only (index.tsx mounts it only past the
// auth gate, and every read goes through /api/wiki/* behind requireUser).
//
// The one rule: Oracle is the truth; this is a view of it. Pages render STORED rows only and
// link out to live sources marked as such. Snapshot is identity — every URL carries the
// snapshot id and never changes what it resolves to. Links between pages come from the
// snapshot's knowledge graph, both directions, never hand-built per page type.
//
// Two layers on every page: DATA (snapshot-versioned, from the store) and NARRATIVE
// (commit-versioned Markdown from wiki/). Each block says which it is.
import React, { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { ArrowLeft, Search, Sun, Moon, GitCommit, Database, FileText, Dna, Pill, FlaskConical, Route, BookOpen, Layers, ExternalLink, Info, Link2, ChevronRight } from 'lucide-react';
import { navigate, wikiUrl, wikiSlug, type WikiRoute, type WikiEntityKind } from '../nav';
import type { Theme } from '../types';
import { WLink } from './WLink';
import { ProvenanceBadge } from './ProvenanceBadge';
import { wikiApi, graphIndex, type WikiSummary, type WikiGene, type WikiEvidenceRow, type WikiScoreRow, type GraphIndex, type KgNode, type WikiSnapshotMeta } from './wikiApi';
import { resolveLineage, runForEvidenceType, runById, diseaseNarrative, authoredDocs, docBySlug, NARRATIVE_COMMIT, type LineageRecord, type LineageRun, type WikiDoc } from './content';
import { sourceInfo, trialUrl, pmidUrl, commitUrl, scriptUrl } from './sources';

// ── small utilities ─────────────────────────────────────────────────────────
function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): { data: T | null; error: string | null; loading: boolean } {
  const [s, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true; set(x => ({ ...x, loading: true, error: null }));
    fn().then(d => alive && set({ data: d, error: null, loading: false })).catch(e => alive && set({ data: null, error: String(e?.message || e), loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}
const fmt = (n: number | null | undefined, d = 3) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(d));
const fmtDate = (s?: string | null) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—');
const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString());
const AXIS_ORDER = ['expression_tvn', 'proteomics', 'dependency', 'safety', 'tissue', 'mutation', 'druggability', 'clinical', 'literature_epmc', 'network', 'literature', 'patents', 'annotation'];
const axisRank = (t: string) => { const i = AXIS_ORDER.indexOf(t); return i < 0 ? 99 : i; };
const AXIS_LABEL: Record<string, string> = { expression_tvn: 'Expression (mRNA, tumour vs normal)', proteomics: 'Proteomics (protein, tumour vs normal)', dependency: 'Dependency (CRISPR)', safety: 'Safety (constraint)', tissue: 'Tissue specificity', mutation: 'Somatic mutation', druggability: 'Druggability', clinical: 'Clinical (trials)', literature_epmc: 'Literature (scored)', network: 'Network (WINNER + RWR)', literature: 'Literature (PubMed, annotation)', patents: 'Patents (annotation)', annotation: 'Target annotation' };
const axisLabel = (t: string) => AXIS_LABEL[t] || t;
const KIND_ICON: Record<string, React.ComponentType<any>> = { gene: Dna, drug: Pill, trial: FlaskConical, pathway: Route, paper: BookOpen, tissue: Layers, variant: Dna, run: GitCommit, source: Database, disease: Info };

// ── theme tokens (Obsidian-shaped: quiet surfaces, one accent) ─────────────
function tokens(isDark: boolean) {
  return {
    page: isDark ? 'bg-[#1e1e1e] text-[#dcddde]' : 'bg-white text-[#2e3338]',
    rail: isDark ? 'bg-[#262626] border-white/10' : 'bg-[#f6f6f6] border-black/10',
    aside: isDark ? 'bg-[#232323] border-white/10' : 'bg-[#fafafa] border-black/10',
    muted: isDark ? 'text-neutral-400' : 'text-neutral-500',
    faint: isDark ? 'text-neutral-500' : 'text-neutral-400',
    link: isDark ? 'text-[#a596ff] hover:underline' : 'text-[#5b4fcf] hover:underline',
    accent: isDark ? 'text-[#a596ff]' : 'text-[#5b4fcf]',
    card: isDark ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-black/[0.02]',
    row: isDark ? 'border-white/5 hover:bg-white/[0.03]' : 'border-black/5 hover:bg-black/[0.02]',
    th: isDark ? 'text-neutral-400 border-white/10' : 'text-neutral-500 border-black/10',
    input: isDark ? 'bg-black/30 border-white/10 placeholder:text-neutral-500' : 'bg-white border-black/10 placeholder:text-neutral-400',
    dataTag: isDark ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' : 'bg-sky-50 text-sky-800 border-sky-200',
    narrTag: isDark ? 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' : 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200',
    prose: isDark ? 'prose prose-invert prose-sm max-w-none prose-a:text-[#a596ff]' : 'prose prose-sm max-w-none prose-a:text-[#5b4fcf]',
    treeActive: isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black',
    treeItem: isDark ? 'hover:bg-white/5 text-neutral-300' : 'hover:bg-black/5 text-neutral-700',
  };
}
type T = ReturnType<typeof tokens>;

// A block is either DATA (from the store, snapshot-versioned) or NARRATIVE (Markdown, commit-versioned).
function LayerTag({ t, kind, detail }: { t: T; kind: 'data' | 'narrative'; detail: string }) {
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${kind === 'data' ? t.dataTag : t.narrTag}`} title={detail}>{kind === 'data' ? <Database className="w-3 h-3" /> : <FileText className="w-3 h-3" />}{kind}<span className="normal-case tracking-normal opacity-70">· {detail}</span></span>;
}
function Section({ t, title, tag, children, right }: { t: T; title: string; tag?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h2 className="text-base font-semibold flex items-center gap-2">{title}{tag}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
function Notice({ t, children, tone = 'info' }: { t: T; children: React.ReactNode; tone?: 'info' | 'warn' | 'error' }) {
  const c = tone === 'error' ? 'border-red-500/40 text-red-300' : tone === 'warn' ? 'border-amber-500/40' : t.card;
  return <div className={`rounded border px-3 py-2 text-sm ${c}`}>{children}</div>;
}
function Loading({ t, what }: { t: T; what: string }) { return <p className={`text-sm ${t.muted}`}>Loading {what}…</p>; }
function KV({ t, rows }: { t: T; rows: Array<[string, React.ReactNode]> }) {
  return <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">{rows.map(([k, v]) => <React.Fragment key={k}><dt className={t.muted}>{k}</dt><dd className="min-w-0 break-words">{v}</dd></React.Fragment>)}</dl>;
}

// ── the app ─────────────────────────────────────────────────────────────────
export default function WikiApp({ theme, route, onToggleTheme }: { theme: Theme; route: WikiRoute; onToggleTheme: () => void }) {
  const isDark = theme === 'dark';
  const t = tokens(isDark);
  const snapshot = route.page === 'disease' || route.page === 'entity' ? route.snapshot : null;
  const summary = useAsync(() => (snapshot ? wikiApi.summary(snapshot) : Promise.resolve(null)), [snapshot]);
  const disease = summary.data?.snapshot.disease_name || (route.page === 'disease' || route.page === 'entity' ? route.disease : '');
  const lineage = useMemo(() => (snapshot && summary.data ? resolveLineage(snapshot, summary.data.snapshot.provenance) : null), [snapshot, summary.data]);
  const mainRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [route]);

  const ctx: PageCtx = { t, isDark, route, snapshot, disease, summary: summary.data, lineage };
  return (
    <div className={`h-screen w-screen flex ${t.page}`} style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <Tree ctx={ctx} onToggleTheme={onToggleTheme} />
      <div ref={mainRef} className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[880px] mx-auto px-8 py-6">
          <Crumbs ctx={ctx} />
          {summary.error && snapshot ? <Notice t={t} tone="error">Could not load snapshot #{snapshot}: {summary.error}</Notice>
            : route.page === 'index' ? <IndexPage ctx={ctx} />
            : route.page === 'doc' ? <DocPage ctx={ctx} slug={route.slug} />
            : !summary.data ? <Loading t={t} what={`snapshot #${snapshot}`} />
            : route.page === 'disease' ? <DiseasePage ctx={ctx} section={route.section} />
            : <EntityPage ctx={ctx} kind={route.kind} id={route.id} />}
          <footer className={`mt-16 pt-4 border-t text-xs ${t.faint} ${isDark ? 'border-white/10' : 'border-black/10'}`}>
            Oracle is the truth; this wiki is a view of it. Stored rows only — live links are marked. Narrative layer at commit <span className="font-mono">{NARRATIVE_COMMIT.slice(0, 7)}</span>.
          </footer>
        </div>
      </div>
      <Aside ctx={ctx} />
    </div>
  );
}

interface PageCtx { t: T; isDark: boolean; route: WikiRoute; snapshot: number | null; disease: string; summary: WikiSummary | null; lineage: LineageRecord | null }

// ── left rail: the tree ─────────────────────────────────────────────────────
function Tree({ ctx, onToggleTheme }: { ctx: PageCtx; onToggleTheme: () => void }) {
  const { t, isDark, route, snapshot, disease, summary } = ctx;
  const snaps = useAsync(() => wikiApi.snapshots(), []);
  const [q, setQ] = useState('');
  const section = route.page === 'disease' ? (route.section || 'overview') : route.page === 'entity' ? route.kind : null;
  const item = (to: string, label: React.ReactNode, active: boolean, Icon?: React.ComponentType<any>, depth = 0) => (
    <WLink key={to + String(label)} to={to} className={`flex items-center gap-2 rounded px-2 py-1 text-[13px] ${active ? t.treeActive : t.treeItem}`}>
      <span style={{ width: depth * 12 }} />{Icon && <Icon className="w-3.5 h-3.5 opacity-70" />}<span className="truncate">{label}</span>
    </WLink>
  );
  const goGene = (e: React.FormEvent) => { e.preventDefault(); if (snapshot && q.trim()) navigate(wikiUrl.entity(disease, snapshot, 'gene', q.trim().toUpperCase())); };
  return (
    <nav className={`w-[260px] shrink-0 border-r flex flex-col ${t.rail}`}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <WLink to={wikiUrl.index()} className="font-semibold text-sm flex items-center gap-2"><GitCommit className={`w-4 h-4 ${t.accent}`} /> Provenance Wiki</WLink>
        <button onClick={onToggleTheme} className={`p-1 rounded ${t.treeItem}`} title="Theme">{isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}</button>
      </div>
      {snapshot && (
        <form onSubmit={goGene} className="px-3 pb-2">
          <div className={`flex items-center gap-1 rounded border px-2 ${t.input}`}>
            <Search className="w-3.5 h-3.5 opacity-50" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Go to gene…" className="bg-transparent text-xs py-1 w-full outline-none" />
          </div>
        </form>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
        <div>
          <div className={`px-2 pb-1 text-[10px] uppercase tracking-wider ${t.faint}`}>Snapshots</div>
          {snaps.data ? groupSnapshots(snaps.data).map(g => (
            <div key={g.disease_id}>
              {g.items.map(s => item(wikiUrl.disease(s.disease_name, s.id), <>{s.disease_name} <span className={`font-mono ${t.faint}`}>#{s.id}</span></>, snapshot === s.id, Database))}
            </div>
          )) : <div className={`px-2 text-xs ${t.faint}`}>{snaps.error || 'loading…'}</div>}
        </div>
        {snapshot && summary && (
          <div>
            <div className={`px-2 pb-1 text-[10px] uppercase tracking-wider ${t.faint}`}>{disease} · #{snapshot}</div>
            {item(wikiUrl.disease(disease, snapshot), 'Overview', section === 'overview', Info)}
            {item(wikiUrl.disease(disease, snapshot, 'genes'), 'Genes', section === 'genes' || section === 'gene', Dna)}
            {item(wikiUrl.disease(disease, snapshot, 'runs'), 'Runs (lineage)', section === 'runs' || section === 'run', GitCommit)}
            {item(wikiUrl.disease(disease, snapshot, 'sources'), 'Sources', section === 'sources' || section === 'source', Database)}
            {item(wikiUrl.disease(disease, snapshot, 'drugs'), 'Drugs', section === 'drugs' || section === 'drug', Pill)}
            {item(wikiUrl.disease(disease, snapshot, 'trials'), 'Trials', section === 'trials' || section === 'trial', FlaskConical)}
            {item(wikiUrl.disease(disease, snapshot, 'pathways'), 'Pathways', section === 'pathways' || section === 'pathway', Route)}
            {item(wikiUrl.disease(disease, snapshot, 'papers'), 'Papers', section === 'papers' || section === 'paper', BookOpen)}
          </div>
        )}
        <div>
          <div className={`px-2 pb-1 text-[10px] uppercase tracking-wider ${t.faint}`}>Docs · narrative</div>
          {authoredDocs().map(d => item(wikiUrl.doc(d.slug), d.title, route.page === 'doc' && route.slug === d.slug, FileText))}
          {authoredDocs().length === 0 && <div className={`px-2 text-xs ${t.faint}`}>none yet</div>}
        </div>
      </div>
      <div className={`px-2 py-2 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <a href="/" onClick={e => { e.preventDefault(); navigate('/'); }} className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${t.treeItem}`}><ArrowLeft className="w-3.5 h-3.5" /> Back to Disease2Target</a>
      </div>
    </nav>
  );
}
function groupSnapshots(list: WikiSnapshotMeta[]) {
  const m = new Map<string, { disease_id: string; items: WikiSnapshotMeta[] }>();
  for (const s of [...list].sort((a, b) => b.id - a.id)) (m.get(s.disease_id) ?? m.set(s.disease_id, { disease_id: s.disease_id, items: [] }).get(s.disease_id)!).items.push(s);
  return [...m.values()];
}

// ── breadcrumbs ─────────────────────────────────────────────────────────────
function Crumbs({ ctx }: { ctx: PageCtx }) {
  const { t, route, snapshot, disease } = ctx;
  const parts: Array<{ to?: string; label: string }> = [{ to: wikiUrl.index(), label: 'wiki' }];
  if (route.page === 'doc') parts.push({ label: 'docs' }, { label: route.slug });
  if ((route.page === 'disease' || route.page === 'entity') && snapshot) {
    parts.push({ to: wikiUrl.disease(disease, snapshot), label: `${wikiSlug(disease)} / #${snapshot}` });
    if (route.page === 'disease' && route.section) parts.push({ label: route.section });
    if (route.page === 'entity') parts.push({ to: wikiUrl.disease(disease, snapshot, route.kind + 's'), label: route.kind }, { label: route.id });
  }
  return (
    <div className={`flex items-center gap-1 text-xs mb-4 ${t.muted}`}>
      {parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <ChevronRight className="w-3 h-3 opacity-50" />}{p.to ? <WLink to={p.to} className="hover:underline">{p.label}</WLink> : <span>{p.label}</span>}</React.Fragment>)}
    </div>
  );
}

// ── right panel: linked from / provenance summary ───────────────────────────
function Aside({ ctx }: { ctx: PageCtx }) {
  const { t, isDark, route, snapshot, disease, lineage, summary } = ctx;
  const key = route.page === 'entity' && ['gene', 'drug', 'trial', 'pathway', 'paper', 'tissue', 'variant'].includes(route.kind) ? `${route.kind}:${route.id}` : null;
  const gi = useAsync(() => (snapshot && key ? graphIndex(snapshot) : Promise.resolve(null)), [snapshot, !!key]);
  const inbound = key && gi.data ? gi.data.in(key) : [];
  const outbound = key && gi.data ? gi.data.out(key) : [];
  return (
    <aside className={`w-[280px] shrink-0 border-l overflow-y-auto ${t.aside}`}>
      <div className="p-4 space-y-5 text-xs">
        {snapshot && summary && (
          <div>
            <div className={`uppercase tracking-wider text-[10px] mb-1 ${t.faint}`}>This snapshot</div>
            <KV t={t} rows={[
              ['id', <span className="font-mono">#{snapshot}</span>],
              ['harvested', fmtDate(summary.snapshot.created_at)],
              ['genes', num(summary.snapshot.gene_count)],
              ['evidence rows', num(summary.evidence_rows)],
              ['lineage', lineage ? <span className={lineage.kind === 'recorded' ? 'text-emerald-400' : 'text-amber-400'}>{lineage.kind}</span> : <span className="text-red-400">none</span>],
            ]} />
            <p className={`mt-2 ${t.faint}`}>Immutable. A new harvest is a new snapshot at a new URL.</p>
          </div>
        )}
        {key && (
          <>
            <div>
              <div className={`uppercase tracking-wider text-[10px] mb-1 ${t.faint} flex items-center gap-1`}><Link2 className="w-3 h-3" /> Linked from ({inbound.length})</div>
              {gi.loading ? <span className={t.faint}>loading graph…</span> : <LinkList ctx={ctx} items={inbound.map(e => ({ key: e.source, rel: e.rel }))} gi={gi.data} />}
            </div>
            <div>
              <div className={`uppercase tracking-wider text-[10px] mb-1 ${t.faint} flex items-center gap-1`}><Link2 className="w-3 h-3" /> Links to ({outbound.length})</div>
              {gi.loading ? null : <LinkList ctx={ctx} items={outbound.map(e => ({ key: e.target, rel: e.rel }))} gi={gi.data} />}
            </div>
          </>
        )}
        <div className={`pt-3 border-t ${isDark ? 'border-white/10' : 'border-black/10'} ${t.faint}`}>
          <p>Every fact carries two badges: where it came from (source · retrieved · audit) and what was done to it (run · script · commit).</p>
          <p className="mt-1"><span className="text-emerald-400">recorded</span> = written by the harvest. <span className="text-amber-400">reconstructed</span> = written by a person afterwards from git history.</p>
        </div>
      </div>
    </aside>
  );
}
function LinkList({ ctx, items, gi, limit = 40 }: { ctx: PageCtx; items: Array<{ key: string; rel: string }>; gi: GraphIndex | null; limit?: number }) {
  const { t, snapshot, disease } = ctx;
  if (!gi || !snapshot) return null;
  if (!items.length) return <span className={t.faint}>none</span>;
  const byRel = new Map<string, Array<{ key: string }>>();
  for (const i of items) (byRel.get(i.rel) ?? byRel.set(i.rel, []).get(i.rel)!).push(i);
  return (
    <div className="space-y-2">
      {[...byRel.entries()].map(([rel, xs]) => (
        <div key={rel}>
          <div className={`${t.faint} mb-0.5`}>{rel.replace(/_/g, ' ')} · {xs.length}</div>
          <div className="flex flex-wrap gap-1">
            {xs.slice(0, limit).map(x => <NodeChip key={x.key} ctx={ctx} node={gi.node(x.key)} nodeKey={x.key} />)}
            {xs.length > limit && <span className={t.faint}>+{xs.length - limit} more</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
function NodeChip({ ctx, node, nodeKey }: { ctx: PageCtx; node: KgNode | null; nodeKey: string }) {
  const { t, isDark, snapshot, disease } = ctx;
  const to = snapshot ? wikiUrl.node(disease, snapshot, nodeKey) : null;
  const label = node?.label || nodeKey.slice(nodeKey.indexOf(':') + 1);
  const Icon = KIND_ICON[nodeKey.split(':')[0]] || Info;
  const cls = `inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] max-w-full ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5'}`;
  return to ? <WLink to={to} className={cls} title={nodeKey}><Icon className="w-3 h-3 opacity-60 shrink-0" /><span className="truncate">{label}</span></WLink>
    : <span className={cls} title={nodeKey}><Icon className="w-3 h-3 opacity-60" /><span className="truncate">{label}</span></span>;
}

// ── pages ───────────────────────────────────────────────────────────────────
function IndexPage({ ctx }: { ctx: PageCtx }) {
  const { t } = ctx;
  const snaps = useAsync(() => wikiApi.snapshots(), []);
  return (
    <>
      <h1 className="text-2xl font-semibold mb-1">Provenance Wiki</h1>
      <p className={`text-sm mb-6 ${t.muted}`}>Every number on the Disease2Target board, traceable to the study, the statistic, the script and the commit. Read-only; one snapshot per page tree; nothing here is re-fetched at view time.</p>
      <Section t={t} title="Snapshots" tag={<LayerTag t={t} kind="data" detail="TARGET_RANKING_SNAPSHOTS" />}>
        {snaps.loading ? <Loading t={t} what="snapshots" /> : snaps.error ? <Notice t={t} tone="error">{snaps.error}</Notice> : (
          <table className="w-full text-sm">
            <thead><tr className={`text-left text-xs border-b ${t.th}`}><th className="py-1 pr-3">disease</th><th className="py-1 pr-3">snapshot</th><th className="py-1 pr-3">version</th><th className="py-1 pr-3">genes</th><th className="py-1 pr-3">harvested</th><th className="py-1">by</th></tr></thead>
            <tbody>{groupSnapshots(snaps.data!).flatMap(g => g.items).map(s => (
              <tr key={s.id} className={`border-b ${t.row}`}>
                <td className="py-1.5 pr-3"><WLink to={wikiUrl.disease(s.disease_name, s.id)} className={t.link}>{s.disease_name}</WLink> <span className={`font-mono text-xs ${t.faint}`}>{s.disease_id}</span></td>
                <td className="py-1.5 pr-3 font-mono">#{s.id}</td><td className="py-1.5 pr-3">{s.version}</td><td className="py-1.5 pr-3">{num(s.gene_count)}</td><td className="py-1.5 pr-3">{fmtDate(s.created_at)}</td><td className="py-1.5">{s.created_by || '—'}</td>
              </tr>))}</tbody>
          </table>)}
      </Section>
      <Section t={t} title="How to read this" tag={<LayerTag t={t} kind="narrative" detail={`commit ${NARRATIVE_COMMIT.slice(0, 7)}`} />}>
        <ul className="text-sm list-disc pl-5 space-y-1">
          {authoredDocs().map(d => <li key={d.slug}><WLink to={wikiUrl.doc(d.slug)} className={t.link}>{d.title}</WLink>{d.front.summary ? <span className={t.muted}> — {d.front.summary}</span> : null}</li>)}
        </ul>
      </Section>
    </>
  );
}

function DocPage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
  const { t } = ctx;
  const d = docBySlug(slug);
  if (!d) return <Notice t={t} tone="warn">No document called <span className="font-mono">{slug}</span> under wiki/docs/.</Notice>;
  return (
    <>
      <div className="mb-3"><LayerTag t={t} kind="narrative" detail={`${d.path} · commit ${NARRATIVE_COMMIT.slice(0, 7)}`} /></div>
      <article className={t.prose}><Markdown>{d.body}</Markdown></article>
    </>
  );
}

function DiseasePage({ ctx, section }: { ctx: PageCtx; section?: string }) {
  const { t, snapshot, disease, summary, lineage } = ctx;
  if (!summary || !snapshot) return null;
  const s = summary.snapshot;
  const narrative = diseaseNarrative(s.disease_name, s.disease_id);
  if (section === 'genes') return <GenesSection ctx={ctx} />;
  if (section === 'runs') return <RunsSection ctx={ctx} />;
  if (section === 'sources') return <SourcesSection ctx={ctx} />;
  if (section && ['drugs', 'trials', 'pathways', 'papers', 'tissues', 'variants'].includes(section)) return <NodeListSection ctx={ctx} type={section.replace(/s$/, '')} />;
  return (
    <>
      <h1 className="text-2xl font-semibold mb-0.5">{s.disease_name}</h1>
      <p className={`text-sm mb-5 ${t.muted}`}><span className="font-mono">{s.disease_id}</span> · snapshot <span className="font-mono">#{snapshot}</span> · v{s.version} · harvested {fmtDate(s.created_at)} by {s.created_by || '—'} · {num(s.gene_count)} genes · {num(summary.evidence_rows)} evidence rows</p>

      {narrative ? (
        <Section t={t} title="About this disease in Disease2Target" tag={<LayerTag t={t} kind="narrative" detail={`${narrative.path} · commit ${NARRATIVE_COMMIT.slice(0, 7)}`} />}>
          <article className={t.prose}><Markdown>{narrative.body}</Markdown></article>
        </Section>
      ) : <Notice t={t}>No narrative page yet for this disease (<span className="font-mono">wiki/diseases/{wikiSlug(s.disease_name)}.md</span>). Everything below is data.</Notice>}

      <Section t={t} title="Evidence axes in this snapshot" tag={<LayerTag t={t} kind="data" detail="EVIDENCE grouped by (evidence_type, source)" />}
        right={<WLink to={wikiUrl.disease(disease, snapshot, 'sources')} className={`text-xs ${t.link}`}>all sources →</WLink>}>
        <table className="w-full text-sm">
          <thead><tr className={`text-left text-xs border-b ${t.th}`}><th className="py-1 pr-3">axis</th><th className="py-1 pr-3">source</th><th className="py-1 pr-3 text-right">rows</th><th className="py-1 pr-3 text-right">scored</th><th className="py-1">run</th></tr></thead>
          <tbody>{[...summary.axes].sort((a, b) => axisRank(a.evidence_type) - axisRank(b.evidence_type)).map(a => {
            const run = runForEvidenceType(lineage, a.evidence_type);
            return (
              <tr key={a.evidence_type + a.source} className={`border-b ${t.row}`}>
                <td className="py-1.5 pr-3">{axisLabel(a.evidence_type)} <span className={`font-mono text-xs ${t.faint}`}>{a.evidence_type}</span></td>
                <td className="py-1.5 pr-3"><WLink to={wikiUrl.entity(disease, snapshot, 'source', wikiSlug(a.source))} className={t.link}>{a.source}</WLink></td>
                <td className="py-1.5 pr-3 text-right font-mono">{num(a.rows)}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{a.scored ? num(a.scored) : <span className={t.faint}>annotation</span>}</td>
                <td className="py-1.5"><RunChip ctx={ctx} run={run} /></td>
              </tr>);
          })}</tbody>
        </table>
      </Section>

      <Section t={t} title="Lineage" tag={<LayerTag t={t} kind="data" detail={lineage?.kind === 'recorded' ? 'snapshot.provenance.runs (store)' : lineage ? `${lineage.path} (repo)` : 'none'} />}
        right={<WLink to={wikiUrl.disease(disease, snapshot, 'runs')} className={`text-xs ${t.link}`}>every run →</WLink>}>
        <LineageSummary ctx={ctx} />
      </Section>

      <Section t={t} title="What the harvest recorded about itself" tag={<LayerTag t={t} kind="data" detail="snapshot.provenance (verbatim)" />}>
        <pre className={`text-xs rounded border p-3 overflow-x-auto ${t.card}`}>{JSON.stringify(s.provenance ?? null, null, 2)}</pre>
      </Section>

      <Section t={t} title="Ranked genes" tag={<LayerTag t={t} kind="data" detail="RANKING_SCORES" />} right={<WLink to={wikiUrl.disease(disease, snapshot, 'genes')} className={`text-xs ${t.link}`}>all {num(s.gene_count)} →</WLink>}>
        <GenesTable ctx={ctx} limit={25} />
      </Section>

      <Section t={t} title="Knowledge graph" tag={<LayerTag t={t} kind="data" detail="KG_NODES / KG_EDGES for this snapshot" />}>
        <GraphStats ctx={ctx} />
      </Section>
    </>
  );
}

function LineageSummary({ ctx }: { ctx: PageCtx }) {
  const { t, lineage } = ctx;
  if (!lineage) return <Notice t={t} tone="warn">No lineage record. The snapshot's provenance has no <span className="font-mono">runs[]</span> and there is no <span className="font-mono">wiki/lineage/</span> file for it. Fact badges will show source and date; run badges will say "no lineage".</Notice>;
  const conf = { high: 0, medium: 0, low: 0 }; for (const r of lineage.runs) if (r.confidence) conf[r.confidence]++;
  return (
    <div className="text-sm space-y-2">
      {lineage.kind === 'recorded'
        ? <p><span className="text-emerald-400 font-medium">Recorded by the harvest.</span> {lineage.runs.length} runs written into <span className="font-mono">snapshot.provenance.runs</span> as the axes were built.</p>
        : <Notice t={t} tone="warn"><span className="text-amber-400 font-medium">Reconstructed after the fact.</span> {lineage.runs.length} runs, written by {lineage.reconstructed_by || 'a person'} on {lineage.reconstructed_on || '—'} from {lineage.reconstructed_from || 'git history'}, stored at <span className="font-mono">{lineage.path}</span>. Confidence: {conf.high} high · {conf.medium} medium · {conf.low} low. Not the harvest's own testimony — read each run's note.</Notice>}
      <div className="flex flex-wrap gap-1">{lineage.runs.map(r => <RunChip key={r.id} ctx={ctx} run={r} />)}</div>
    </div>
  );
}
function RunChip({ ctx, run }: { ctx: PageCtx; run: LineageRun | null }) {
  const { t, isDark, snapshot, disease, lineage } = ctx;
  if (!run || !snapshot) return <span className={`text-xs ${t.faint}`}>no lineage</span>;
  const tone = lineage?.kind === 'recorded' ? (isDark ? 'border-emerald-500/40 text-emerald-300' : 'border-emerald-600/40 text-emerald-800') : (isDark ? 'border-amber-500/40 text-amber-300' : 'border-amber-600/40 text-amber-800');
  return <WLink to={wikiUrl.entity(disease, snapshot, 'run', run.id)} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:underline ${tone}`} title={`${run.script} @ ${run.commit}${run.confidence ? ` · confidence ${run.confidence}` : ''}`}><GitCommit className="w-3 h-3" />{run.id}<span className="font-mono opacity-70">@{run.commit.slice(0, 7)}</span>{run.confidence && run.confidence !== 'high' && <span className="opacity-70">· {run.confidence}</span>}</WLink>;
}

function GenesTable({ ctx, limit, filter }: { ctx: PageCtx; limit?: number; filter?: string }) {
  const { t, snapshot, disease } = ctx;
  const scores = useAsync(() => (snapshot ? wikiApi.scores(snapshot) : Promise.resolve([])), [snapshot]);
  if (scores.loading) return <Loading t={t} what="ranked genes" />;
  if (scores.error) return <Notice t={t} tone="error">{scores.error}</Notice>;
  const f = (filter || '').toUpperCase();
  let rows = (scores.data || []).filter(r => !f || String(r.gene_symbol).toUpperCase().includes(f)).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const total = rows.length; if (limit) rows = rows.slice(0, limit);
  return (
    <>
      <table className="w-full text-sm">
        <thead><tr className={`text-left text-xs border-b ${t.th}`}><th className="py-1 pr-3 text-right">rank</th><th className="py-1 pr-3">gene</th><th className="py-1 pr-3 text-right">overall</th><th className="py-1 pr-3 text-right">OT assoc.</th><th className="py-1 pr-3 text-right">genetic</th><th className="py-1 pr-3 text-right">expression</th><th className="py-1 text-right">literature</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.gene_symbol} className={`border-b ${t.row}`}>
            <td className="py-1 pr-3 text-right font-mono">{r.rank ?? '—'}</td>
            <td className="py-1 pr-3"><WLink to={wikiUrl.entity(disease, snapshot!, 'gene', r.gene_symbol)} className={`${t.link} font-medium`}>{r.gene_symbol}</WLink></td>
            <td className="py-1 pr-3 text-right font-mono">{fmt(r.overall_score)}</td><td className="py-1 pr-3 text-right font-mono">{fmt(r.get_score)}</td><td className="py-1 pr-3 text-right font-mono">{fmt(r.genetic_score)}</td><td className="py-1 pr-3 text-right font-mono">{fmt(r.expression_score)}</td><td className="py-1 text-right font-mono">{fmt(r.literature_score)}</td>
          </tr>))}</tbody>
      </table>
      {limit && total > limit && <p className={`text-xs mt-1 ${t.faint}`}>{num(total - limit)} more</p>}
    </>
  );
}
function GenesSection({ ctx }: { ctx: PageCtx }) {
  const { t, summary } = ctx; const [q, setQ] = useState('');
  return (
    <>
      <h1 className="text-xl font-semibold mb-1">Genes <span className={`text-sm font-normal ${t.muted}`}>{num(summary?.snapshot.gene_count)} in snapshot #{ctx.snapshot}</span></h1>
      <div className="mb-3"><LayerTag t={t} kind="data" detail="RANKING_SCORES · stored rank and scores" /></div>
      <div className={`flex items-center gap-1 rounded border px-2 mb-3 max-w-xs ${t.input}`}><Search className="w-3.5 h-3.5 opacity-50" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="filter by symbol" className="bg-transparent text-sm py-1 w-full outline-none" /></div>
      <GenesTable ctx={ctx} filter={q} limit={q ? undefined : 300} />
    </>
  );
}
function RunsSection({ ctx }: { ctx: PageCtx }) {
  const { t, lineage } = ctx;
  return (
    <>
      <h1 className="text-xl font-semibold mb-1">Runs <span className={`text-sm font-normal ${t.muted}`}>the lineage of snapshot #{ctx.snapshot}</span></h1>
      <div className="mb-4"><LayerTag t={t} kind="data" detail={lineage?.kind === 'recorded' ? 'snapshot.provenance.runs (store)' : lineage ? `${lineage.path} (repo)` : 'none'} /></div>
      <LineageSummary ctx={ctx} />
      {lineage && (
        <table className="w-full text-sm mt-4">
          <thead><tr className={`text-left text-xs border-b ${t.th}`}><th className="py-1 pr-3">run</th><th className="py-1 pr-3">axis</th><th className="py-1 pr-3">ran</th><th className="py-1 pr-3">script</th><th className="py-1 pr-3">commit</th><th className="py-1">confidence</th></tr></thead>
          <tbody>{lineage.runs.map(r => (
            <tr key={r.id} className={`border-b ${t.row}`}>
              <td className="py-1.5 pr-3"><RunChip ctx={ctx} run={r} /></td><td className="py-1.5 pr-3">{r.axis}{r.evidence_type && r.evidence_type !== r.axis ? <span className={`font-mono text-xs ${t.faint}`}> {r.evidence_type}</span> : null}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{fmtDate(r.ran_at)}</td><td className="py-1.5 pr-3 font-mono text-xs">{r.script}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{commitUrl(r.commit) ? <a href={commitUrl(r.commit)!} target="_blank" rel="noreferrer" className={t.link}>{r.commit.slice(0, 7)}</a> : r.commit}</td>
              <td className="py-1.5">{r.confidence || '—'}</td>
            </tr>))}</tbody>
        </table>)}
      {lineage?.body && (
        <Section t={t} title="How this record was reconstructed" tag={<LayerTag t={t} kind="narrative" detail={`${lineage.path} · commit ${NARRATIVE_COMMIT.slice(0, 7)}`} />}>
          <article className={`${t.prose} mt-2`}><Markdown>{lineage.body}</Markdown></article>
        </Section>)}
    </>
  );
}
function SourcesSection({ ctx }: { ctx: PageCtx }) {
  const { t, summary, snapshot, disease, lineage } = ctx;
  const bySource = new Map<string, { rows: number; types: string[] }>();
  for (const a of summary?.axes || []) { const b = bySource.get(a.source) ?? bySource.set(a.source, { rows: 0, types: [] }).get(a.source)!; b.rows += a.rows; b.types.push(a.evidence_type); }
  return (
    <>
      <h1 className="text-xl font-semibold mb-1">Sources <span className={`text-sm font-normal ${t.muted}`}>{bySource.size} in snapshot #{snapshot}</span></h1>
      <div className="mb-4"><LayerTag t={t} kind="data" detail="distinct EVIDENCE.source" /></div>
      <div className="space-y-2">{[...bySource.entries()].map(([src, b]) => { const info = sourceInfo(src); return (
        <div key={src} className={`rounded border p-3 ${t.card}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap"><WLink to={wikiUrl.entity(disease, snapshot!, 'source', wikiSlug(src))} className={`${t.link} font-medium`}>{src}</WLink><span className={`text-xs ${t.muted}`}>{num(b.rows)} rows · {b.types.join(', ')}</span></div>
          {info && <p className={`text-sm mt-1 ${t.muted}`}>{info.what}</p>}
        </div>); })}</div>
    </>
  );
}
function GraphStats({ ctx }: { ctx: PageCtx }) {
  const { t, snapshot, disease } = ctx;
  const gi = useAsync(() => (snapshot ? graphIndex(snapshot) : Promise.resolve(null)), [snapshot]);
  if (gi.loading) return <Loading t={t} what="graph" />; if (gi.error) return <Notice t={t} tone="error">{gi.error}</Notice>; if (!gi.data) return null;
  const st = gi.data.stats;
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {(Object.entries(st.nodes) as Array<[string, number]>).sort((a, b) => b[1] - a[1]).map(([type, n]) => { const Icon = KIND_ICON[type] || Info; const to = ['drug', 'trial', 'pathway', 'paper', 'tissue', 'variant', 'gene'].includes(type) ? wikiUrl.disease(disease, snapshot!, type + 's') : null; const inner = <><Icon className="w-3.5 h-3.5 opacity-60" /> {type} <span className="font-mono">{num(n)}</span></>; return to ? <WLink key={type} to={to} className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${t.card} hover:underline`}>{inner}</WLink> : <span key={type} className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${t.card}`}>{inner}</span>; })}
      <span className={`self-center text-xs ${t.faint}`}>{num(st.edgeTotal)} edges: {(Object.entries(st.edges) as Array<[string, number]>).map(([r, n]) => `${r} ${num(n)}`).join(' · ')}</span>
    </div>
  );
}
function NodeListSection({ ctx, type }: { ctx: PageCtx; type: string }) {
  const { t, snapshot, disease } = ctx; const [q, setQ] = useState('');
  const gi = useAsync(() => (snapshot ? graphIndex(snapshot) : Promise.resolve(null)), [snapshot]);
  if (gi.loading) return <Loading t={t} what={`${type}s`} />; if (gi.error) return <Notice t={t} tone="error">{gi.error}</Notice>; if (!gi.data) return null;
  const f = q.toLowerCase();
  const nodes = gi.data.byType(type).filter(n => !f || n.label.toLowerCase().includes(f) || n.key.toLowerCase().includes(f)).sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
  return (
    <>
      <h1 className="text-xl font-semibold mb-1 capitalize">{type}s <span className={`text-sm font-normal ${t.muted}`}>{num(gi.data.byType(type).length)} in the graph of #{snapshot}</span></h1>
      <div className="mb-3"><LayerTag t={t} kind="data" detail={`KG_NODES where node_type = ${type}`} /></div>
      <div className={`flex items-center gap-1 rounded border px-2 mb-3 max-w-xs ${t.input}`}><Search className="w-3.5 h-3.5 opacity-50" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="filter" className="bg-transparent text-sm py-1 w-full outline-none" /></div>
      <table className="w-full text-sm">
        <thead><tr className={`text-left text-xs border-b ${t.th}`}><th className="py-1 pr-3">{type}</th><th className="py-1 pr-3 text-right">degree</th><th className="py-1">properties</th></tr></thead>
        <tbody>{nodes.slice(0, 500).map(n => (
          <tr key={n.key} className={`border-b ${t.row}`}>
            <td className="py-1 pr-3"><WLink to={wikiUrl.node(disease, snapshot!, n.key) || '#'} className={t.link}>{n.label}</WLink></td>
            <td className="py-1 pr-3 text-right font-mono">{n.degree ?? '—'}</td>
            <td className={`py-1 text-xs ${t.muted}`}>{propsLine(n.props)}</td>
          </tr>))}</tbody>
      </table>
      {nodes.length > 500 && <p className={`text-xs mt-1 ${t.faint}`}>{num(nodes.length - 500)} more — narrow the filter</p>}
    </>
  );
}
const propsLine = (p: any) => p && typeof p === 'object' ? Object.entries(p).filter(([, v]) => v != null && v !== '' && typeof v !== 'object').slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';

// ── entity pages ────────────────────────────────────────────────────────────
function EntityPage({ ctx, kind, id }: { ctx: PageCtx; kind: WikiEntityKind; id: string }) {
  if (kind === 'gene') return <GenePage ctx={ctx} symbol={id.toUpperCase()} />;
  if (kind === 'run') return <RunPage ctx={ctx} id={id} />;
  if (kind === 'source') return <SourcePage ctx={ctx} slug={id} />;
  return <GraphEntityPage ctx={ctx} kind={kind} id={id} />;
}

function GenePage({ ctx, symbol }: { ctx: PageCtx; symbol: string }) {
  const { t, isDark, snapshot, disease, lineage } = ctx;
  const g = useAsync(() => wikiApi.gene(snapshot!, symbol), [snapshot, symbol]);
  const gi = useAsync(() => graphIndex(snapshot!), [snapshot]);
  if (g.loading) return <Loading t={t} what={symbol} />;
  if (g.error) return <Notice t={t} tone="error">{g.error}</Notice>;
  const gene = g.data!;
  const ann = gene.evidence.find(r => r.evidence_type === 'annotation')?.value_json;
  const rows = [...gene.evidence].sort((a, b) => axisRank(a.evidence_type) - axisRank(b.evidence_type));
  const neighbours = gi.data ? gi.data.neighbours(`gene:${symbol}`) : [];
  const byType = new Map<string, typeof neighbours>(); for (const n of neighbours) (byType.get(n.node.type) ?? byType.set(n.node.type, []).get(n.node.type)!).push(n);
  return (
    <>
      <h1 className="text-2xl font-semibold mb-0.5 flex items-baseline gap-3">{symbol}{ann?.approved_name && <span className={`text-base font-normal ${t.muted}`}>{ann.approved_name}</span>}</h1>
      <p className={`text-sm mb-5 ${t.muted}`}>
        {gene.score ? <>rank <span className="font-mono">{gene.score.rank}</span> of {num(gene.gene_count)} · overall <span className="font-mono">{fmt(gene.score.overall_score)}</span> · OT association <span className="font-mono">{fmt(gene.score.get_score)}</span></> : 'no score row in this snapshot'}
        {ann?.biotype ? <> · {ann.biotype}</> : null}{ann?.display ? <> · {ann.display}</> : null}
      </p>

      <Section t={t} title={`Stored evidence · ${rows.length} rows`} tag={<LayerTag t={t} kind="data" detail={`EVIDENCE where gene_symbol = ${symbol} and snapshot_id = ${snapshot}`} />}>
        <div className="space-y-2">{rows.map(r => <EvidenceCard key={r.id ?? r.evidence_type + r.source} ctx={ctx} row={r} />)}</div>
        {rows.length === 0 && <Notice t={t}>No evidence rows for {symbol} in snapshot #{snapshot}.</Notice>}
      </Section>

      <Section t={t} title="In the knowledge graph" tag={<LayerTag t={t} kind="data" detail="KG_EDGES touching this gene, both directions" />}>
        {gi.loading ? <Loading t={t} what="graph" /> : neighbours.length === 0 ? <p className={`text-sm ${t.muted}`}>Not in the graph of this snapshot.</p> : (
          <div className="space-y-3">{[...byType.entries()].sort((a, b) => b[1].length - a[1].length).map(([type, xs]) => (
            <div key={type}><div className={`text-xs mb-1 ${t.muted}`}>{type} · {xs.length}</div><div className="flex flex-wrap gap-1">{dedupe(xs).slice(0, 60).map(x => <NodeChip key={x.node.key} ctx={ctx} node={x.node} nodeKey={x.node.key} />)}{xs.length > 60 && <span className={`text-xs ${t.faint}`}>+{xs.length - 60}</span>}</div></div>))}</div>)}
      </Section>
    </>
  );
}
const dedupe = <X extends { node: KgNode }>(xs: X[]) => { const seen = new Set<string>(); return xs.filter(x => (seen.has(x.node.key) ? false : (seen.add(x.node.key), true))); };

function EvidenceCard({ ctx, row }: { ctx: PageCtx; row: WikiEvidenceRow }) {
  const { t, isDark, snapshot, disease, lineage } = ctx;
  const vj = row.value_json || {};
  const run = runForEvidenceType(lineage, row.evidence_type);
  const [open, setOpen] = useState(false);
  const axis = typeof vj.axis === 'number' ? vj.axis : null;
  return (
    <div className={`rounded border p-3 ${t.card}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-medium">{axisLabel(row.evidence_type)} <span className={`font-mono text-xs ${t.faint}`}>{row.evidence_type}</span></div>
          <div className="text-sm mt-0.5">{vj.display || row.value_text || '—'}</div>
        </div>
        <div className="text-right shrink-0">
          {axis != null ? <><div className="font-mono text-lg leading-5">{fmt(axis)}</div><div className={`text-[10px] ${t.faint}`}>axis · {vj.direction || '—'}{vj.low_confidence ? ' · low confidence' : ''}</div></> : <div className={`text-xs ${t.faint}`}>{vj.role || 'annotation'} · not scored</div>}
        </div>
      </div>
      <div className="mt-2"><ProvenanceBadge row={row} run={run} lineage={lineage} disease={disease} snapshot={snapshot!} isDark={isDark} /></div>
      <button onClick={() => setOpen(o => !o)} className={`mt-2 text-[11px] ${t.link}`}>{open ? 'hide' : 'show'} stored value_json</button>
      {open && <pre className={`mt-1 text-[11px] rounded border p-2 overflow-x-auto max-h-80 ${isDark ? 'border-white/10 bg-black/30' : 'border-black/10 bg-white'}`}>{JSON.stringify(vj, null, 2)}</pre>}
    </div>
  );
}

function RunPage({ ctx, id }: { ctx: PageCtx; id: string }) {
  const { t, isDark, snapshot, disease, lineage } = ctx;
  const run = runById(lineage, id);
  const rows = useAsync(() => (run?.evidence_type && snapshot ? wikiApi.evidenceByType(snapshot, run.evidence_type) : Promise.resolve({ rows: [] as WikiEvidenceRow[] })), [snapshot, run?.evidence_type]);
  const [q, setQ] = useState('');
  if (!run) return <Notice t={t} tone="warn">No run <span className="font-mono">{id}</span> in the lineage of snapshot #{snapshot}.</Notice>;
  const tone = lineage?.kind === 'recorded' ? 'text-emerald-400' : 'text-amber-400';
  const list = (rows.data?.rows || []).filter(r => !q || r.gene_symbol.toUpperCase().includes(q.toUpperCase()));
  return (
    <>
      <h1 className="text-2xl font-semibold mb-0.5 font-mono">{run.id}</h1>
      <p className={`text-sm mb-4 ${t.muted}`}>{axisLabel(run.axis)} · <span className={tone}>{lineage?.kind}</span>{run.confidence ? <> · confidence <b>{run.confidence}</b></> : null}</p>
      {lineage?.kind === 'reconstructed' && <div className="mb-4"><Notice t={t} tone="warn">This run record was <b>reconstructed</b> from git history{lineage.reconstructed_on ? ` on ${lineage.reconstructed_on}` : ''}, not written by the harvest. {run.note || ''}</Notice></div>}
      <Section t={t} title="What ran" tag={<LayerTag t={t} kind="data" detail={lineage?.kind === 'recorded' ? 'snapshot.provenance.runs' : lineage?.path || ''} />}>
        <KV t={t} rows={[
          ['script', <span className="font-mono">{scriptUrl(run.script, run.commit) ? <a href={scriptUrl(run.script, run.commit)!} target="_blank" rel="noreferrer" className={t.link}>{run.script}</a> : run.script}</span>],
          ['commit', <span className="font-mono">{commitUrl(run.commit) ? <a href={commitUrl(run.commit)!} target="_blank" rel="noreferrer" className={t.link}>{run.commit}</a> : run.commit}{run.commit_note ? <span className={`font-sans ${t.muted}`}> — {run.commit_note}</span> : null}</span>],
          ['ran at', <span className="font-mono">{fmtDate(run.ran_at)}</span>],
          ['source', <WLink to={wikiUrl.entity(disease, snapshot!, 'source', wikiSlug(run.source))} className={t.link}>{run.source}</WLink>],
          ['source version', run.source_version || '—'],
          ['evidence type', <span className="font-mono">{run.evidence_type || '—'}</span>],
        ]} />
      </Section>
      {run.params && (
        <Section t={t} title="Parameters" tag={<LayerTag t={t} kind="data" detail="run.params" />}>
          <KV t={t} rows={Object.entries(run.params).map(([k, v]) => [k, <span className="font-mono text-xs">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>])} />
        </Section>)}
      <Section t={t} title={`Rows this run produced${rows.data ? ` · ${num(rows.data.rows.length)}` : ''}`} tag={<LayerTag t={t} kind="data" detail={`EVIDENCE where evidence_type = ${run.evidence_type} and snapshot_id = ${snapshot}`} />}>
        {rows.loading ? <Loading t={t} what="rows (first load of a snapshot's evidence takes ~30 s)" /> : rows.error ? <Notice t={t} tone="error">{rows.error}</Notice> : (
          <>
            <div className={`flex items-center gap-1 rounded border px-2 mb-2 max-w-xs ${t.input}`}><Search className="w-3.5 h-3.5 opacity-50" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="filter by gene" className="bg-transparent text-sm py-1 w-full outline-none" /></div>
            <table className="w-full text-sm">
              <thead><tr className={`text-left text-xs border-b ${t.th}`}><th className="py-1 pr-3">gene</th><th className="py-1 pr-3 text-right">axis</th><th className="py-1">stored value</th></tr></thead>
              <tbody>{list.slice(0, 300).map(r => (
                <tr key={r.gene_symbol} className={`border-b ${t.row}`}>
                  <td className="py-1 pr-3"><WLink to={wikiUrl.entity(disease, snapshot!, 'gene', r.gene_symbol)} className={t.link}>{r.gene_symbol}</WLink></td>
                  <td className="py-1 pr-3 text-right font-mono">{typeof r.value_json?.axis === 'number' ? fmt(r.value_json.axis) : '—'}</td>
                  <td className={`py-1 text-xs ${t.muted}`}>{r.value_json?.display || r.value_text}</td>
                </tr>))}</tbody>
            </table>
            {list.length > 300 && <p className={`text-xs mt-1 ${t.faint}`}>{num(list.length - 300)} more — narrow the filter</p>}
          </>)}
      </Section>
    </>
  );
}

function SourcePage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
  const { t, snapshot, disease, summary, lineage } = ctx;
  const label = summary?.axes.find(a => wikiSlug(a.source) === slug)?.source || null;
  const info = sourceInfo(label);
  const rows = useAsync(() => (label && snapshot ? wikiApi.evidenceBySource(snapshot, label) : Promise.resolve({ rows: [] as WikiEvidenceRow[] })), [snapshot, label]);
  const [q, setQ] = useState('');
  if (!label) return <Notice t={t} tone="warn">No source <span className="font-mono">{slug}</span> in snapshot #{snapshot}.</Notice>;
  const runs = (lineage?.runs || []).filter(r => r.source === label || (info && sourceInfo(r.source)?.key === info.key));
  const types = [...new Set((rows.data?.rows || []).map(r => r.evidence_type))];
  const list = (rows.data?.rows || []).filter(r => !q || r.gene_symbol.toUpperCase().includes(q.toUpperCase()));
  return (
    <>
      <h1 className="text-2xl font-semibold mb-0.5">{label}</h1>
      {info && <p className={`text-sm mb-4 ${t.muted}`}>{info.what}</p>}
      <Section t={t} title="In this snapshot" tag={<LayerTag t={t} kind="data" detail={`EVIDENCE where source = "${label}"`} />}>
        <KV t={t} rows={[
          ['rows', rows.data ? num(rows.data.rows.length) : '…'],
          ['evidence types', types.map(x => <span key={x} className="font-mono mr-2">{x}</span>)],
          ['runs', runs.length ? <div className="flex flex-wrap gap-1">{runs.map(r => <RunChip key={r.id} ctx={ctx} run={r} />)}</div> : <span className={t.faint}>no lineage names this source</span>],
          ['live', info ? <a href={info.live({ gene: '', vj: null, disease }) || '#'} target="_blank" rel="noreferrer" className={`${t.link} inline-flex items-center gap-1`}><ExternalLink className="w-3 h-3" /> {info.name} — live today, not the stored record</a> : '—'],
        ]} />
      </Section>
      <Section t={t} title="Every row it contributed" tag={<LayerTag t={t} kind="data" detail="stored rows only" />}>
        {rows.loading ? <Loading t={t} what="rows (first load of a snapshot's evidence takes ~30 s)" /> : rows.error ? <Notice t={t} tone="error">{rows.error}</Notice> : (
          <>
            <div className={`flex items-center gap-1 rounded border px-2 mb-2 max-w-xs ${t.input}`}><Search className="w-3.5 h-3.5 opacity-50" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="filter by gene" className="bg-transparent text-sm py-1 w-full outline-none" /></div>
            <table className="w-full text-sm">
              <thead><tr className={`text-left text-xs border-b ${t.th}`}><th className="py-1 pr-3">gene</th><th className="py-1 pr-3">type</th><th className="py-1 pr-3 text-right">axis</th><th className="py-1">stored value</th></tr></thead>
              <tbody>{list.slice(0, 300).map(r => (
                <tr key={r.gene_symbol + r.evidence_type} className={`border-b ${t.row}`}>
                  <td className="py-1 pr-3"><WLink to={wikiUrl.entity(disease, snapshot!, 'gene', r.gene_symbol)} className={t.link}>{r.gene_symbol}</WLink></td>
                  <td className="py-1 pr-3 font-mono text-xs">{r.evidence_type}</td>
                  <td className="py-1 pr-3 text-right font-mono">{typeof r.value_json?.axis === 'number' ? fmt(r.value_json.axis) : '—'}</td>
                  <td className={`py-1 text-xs ${t.muted}`}>{r.value_json?.display || r.value_text}</td>
                </tr>))}</tbody>
            </table>
            {list.length > 300 && <p className={`text-xs mt-1 ${t.faint}`}>{num(list.length - 300)} more — narrow the filter</p>}
          </>)}
      </Section>
    </>
  );
}

// drug / trial / pathway / paper / tissue / variant — one page shape, driven by the graph.
function GraphEntityPage({ ctx, kind, id }: { ctx: PageCtx; kind: WikiEntityKind; id: string }) {
  const { t, snapshot, disease } = ctx;
  const key = `${kind}:${id}`;
  const gi = useAsync(() => graphIndex(snapshot!), [snapshot]);
  if (gi.loading) return <Loading t={t} what={kind} />; if (gi.error) return <Notice t={t} tone="error">{gi.error}</Notice>;
  const node = gi.data!.node(key);
  if (!node) return <Notice t={t} tone="warn">No {kind} <span className="font-mono">{id}</span> in the graph of snapshot #{snapshot}.</Notice>;
  const neighbours = gi.data!.neighbours(key);
  const groups = new Map<string, typeof neighbours>();
  for (const n of neighbours) { const g = `${n.direction === 'out' ? '→' : '←'} ${n.edge.rel.replace(/_/g, ' ')} · ${n.node.type}`; (groups.get(g) ?? groups.set(g, []).get(g)!).push(n); }
  const external = kind === 'trial' ? trialUrl(id) : kind === 'paper' ? pmidUrl(id) : null;
  const Icon = KIND_ICON[kind] || Info;
  const props = node.props && typeof node.props === 'object' ? Object.entries(node.props).filter(([, v]) => v != null && v !== '') : [];
  // Which genes here does this entity touch, and with what evidence? Trials and drugs answer
  // "every target this hits in this snapshot" from edges alone — no per-page query.
  return (
    <>
      <h1 className="text-2xl font-semibold mb-0.5 flex items-center gap-2"><Icon className={`w-5 h-5 ${t.accent}`} />{node.label}</h1>
      <p className={`text-sm mb-4 ${t.muted}`}>{kind} · <span className="font-mono">{key}</span> · degree {node.degree ?? neighbours.length}{external && <> · <a href={external} target="_blank" rel="noreferrer" className={`${t.link} inline-flex items-center gap-1`}><ExternalLink className="w-3 h-3" /> live record</a></>}</p>
      {props.length > 0 && (
        <Section t={t} title="Stored properties" tag={<LayerTag t={t} kind="data" detail="KG_NODES.props_json" />}>
          <KV t={t} rows={props.map(([k, v]) => [k, <span className="font-mono text-xs">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>])} />
        </Section>)}
      <Section t={t} title={`Connections · ${neighbours.length}`} tag={<LayerTag t={t} kind="data" detail="KG_EDGES, both directions; each edge carries its own source" />}>
        <div className="space-y-3">{[...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([g, xs]) => (
          <div key={g}>
            <div className={`text-xs mb-1 ${t.muted}`}>{g} · {xs.length} <span className={t.faint}>· edge source: {[...new Set(xs.map(x => x.edge.src).filter(Boolean))].join(', ') || '—'}</span></div>
            <div className="flex flex-wrap gap-1">{dedupe(xs).slice(0, 80).map(x => <NodeChip key={x.node.key} ctx={ctx} node={x.node} nodeKey={x.node.key} />)}{xs.length > 80 && <span className={`text-xs ${t.faint}`}>+{xs.length - 80}</span>}</div>
          </div>))}</div>
        {neighbours.length === 0 && <p className={`text-sm ${t.muted}`}>No edges.</p>}
      </Section>
    </>
  );
}
