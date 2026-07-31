import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
import { fetchSnapshots, authenticatedFetch, type RankingSnapshotMeta } from './supabase';

// ── Dashboard — an INTERACTIVE view of what is actually in the Oracle store ────
//
// The whole (deduped) gene set is fetched ONCE per snapshot and every interaction —
// search, filter, sort, export — runs client-side, so exploring is instant rather than
// a round-trip per keystroke.
//
// Three panes, ordered the way a reader needs them:
//   1. STATE OF THE DATA   coverage + data-quality warnings. Both are CLICKABLE and drive
//      the grid, so "1,143 duplicate rows" or "expression: 92%" becomes a filtered list
//      instead of a number you have to go and hunt for.
//   2. TARGET GRID         sortable, filterable, exportable. The filter chips encode the
//      questions this tool exists to answer — above all "novel & tractable": no drug, no
//      trial, but a druggable handle. That is the discovery query.
//   3. DOSSIER + COMPARE   a UniProt-style entry for one gene, or up to 4 pinned genes
//      side by side on the headline numbers.

// A chat-driven command applied to this dashboard (search / filter / sort / open a gene).
// The parent passes a NEW object each time so the effect re-fires even for identical asks.
export interface DashboardCommand {
  q?: string;
  chips?: Chip[];           // replace the whole chip set
  toggleChip?: Chip;        // flip one chip
  sortKey?: SortKey;
  sortDir?: 'asc' | 'desc';
  openGene?: string;
  snapshotId?: number;
  reset?: boolean;
}
interface Props { theme?: 'dark' | 'light'; command?: DashboardCommand | null }

type Axis = { axis: string; genes: number; pct: number };
type Overview = {
  snapshot: { id: number; version: number; disease_id: string; disease_name: string; created_at: string; label: string;
              rows: number; unique_genes: number; duplicates: number; evidence_rows: number };
  axes: Axis[];
  schema: { druggability: { legacy: number; v2: number }; clinical: { legacy: number; v2: number } };
  warnings: string[];
  notes?: string[];
};
type GeneRow = {
  gene_symbol: string; rank: number | null; score: number | null;
  n_drugs: number | null; tractable_modalities: number | null;
  n_disease_trials: number | null; trials_by_phase: { phase1: number; phase2: number; phase3: number; phase4: number } | null;
  max_disease_phase: number | null; n_publications: number | null; velocity: number | null;
  completeness: number; legacy: boolean;
  target_class?: string | null; is_common_essential?: boolean | null; surface_or_secreted?: boolean | null;
  tissue_tau?: number | null; n_patents?: number | null; n_stopped_trials?: number | null;
  winner_score?: number | null; rwr_score?: number | null; is_seed?: boolean | null;
};
type Attr = { key: string; label: string; value: string | number | null; unit?: string | null; source: string;
              level: 'fact' | 'prediction' | 'annotation'; confidence: 'high' | 'medium' | 'low' | 'not_fetched'; note?: string };
type Detail = {
  drugs: { name: string; modality: string | null; family: string | null; stage: string; approved: boolean }[];
  modalities: { modality: string; family: string; drugCount: number; topStage: string; approved: boolean }[];
  tractability: { modality: string; code: string; labels: string[] }[];
  trials: { id: string | null; url: string | null; phase: number; status: string | null; title: string | null;
            year: number | null; drug: string | null; why_stopped: string | null; stop_reasons: string[];
            sponsor?: string | null; collaborators?: string[]; start_date?: string | null; completion_date?: string | null;
            enrollment?: number | null; n_locations?: number; countries?: string[];
            locations?: { facility: string | null; city: string | null; state: string | null; country: string | null }[] }[];
  papers: { title: string; id: string; source: string; journal: string | null; year: string | null }[];
  safety_liabilities: { event: string | null; datasource: string | null; effects: string[] }[];
  variants: { change: string; count: number; fraction: number }[];
};
type Dossier = {
  gene_symbol: string; disease_name: string; rank: number | null; score: number | null; summary: string;
  headline: Record<string, any>;
  categories: { key: string; label: string; blurb: string; attrs: Attr[] }[];
  detail?: Detail;
  completeness: { score: number; present: number; total: number; missing: string[] };
  provenance: { sources: string[]; snapshot_id: number | null; generated_at: string };
};

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const pctS = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);

// Self-contained SVG spinner (no CSS-injection needed — the SMIL animateTransform rotates it).
const Spinner: React.FC<{ color?: string; size?: number }> = ({ color = '#2563eb', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0 }} aria-label="loading">
    <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeOpacity="0.2" strokeWidth="3" />
    <path d="M12 3 a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.75s" repeatCount="indefinite" />
    </path>
  </svg>
);
const AXIS_LABEL: Record<string, string> = {
  mutation: 'Somatic mutation', expression_tvn: 'Expression', dependency: 'Dependency', safety: 'Safety',
  druggability: 'Druggability', clinical: 'Clinical', literature_epmc: 'Literature (EPMC)', literature: 'Literature (PubMed)',
  annotation: 'Annotation / function', tissue: 'Tissue specificity', patents: 'Patents',
};

// An API route that does not exist yet (server not restarted) returns Vite's index.html,
// and `r.json()` then throws `Unexpected token '<'`. Fail with something actionable.
async function getJson(url: string): Promise<any> {
  const r = await authenticatedFetch(url);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(r.status === 404 || ct.includes('text/html')
      ? 'The dashboard API did not respond with JSON. The dev server is probably running older code — restart it (tsx does not auto-reload server.ts).'
      : `Unexpected response (HTTP ${r.status})`);
  }
  const j = await r.json();
  if (j?.error) throw new Error(j.error);
  return j;
}

type SortKey = 'rank' | 'score' | 'n_drugs' | 'tractable_modalities' | 'n_disease_trials' | 'n_publications' | 'velocity' | 'completeness' | 'tissue_tau' | 'n_patents' | 'winner_score';
type Chip = 'novel_tractable' | 'in_trials' | 'no_precedent' | 'has_drugs' | 'complete' | 'legacy_only' | 'tissue_restricted' | 'not_common_essential' | 'antibody_reachable' | 'trial_stopped';

const CHIPS: { id: Chip; label: string; title: string }[] = [
  { id: 'novel_tractable', label: 'Novel & tractable', title: 'No developed drug and no disease trial, but at least one modality assessed tractable — the discovery query this tool exists for.' },
  { id: 'in_trials', label: 'In disease trials', title: 'At least one drug hitting this target has a trial in this disease.' },
  { id: 'no_precedent', label: 'No clinical precedent', title: 'No drug targeting this gene is in a disease trial. Neutral novelty signal, not a negative.' },
  { id: 'has_drugs', label: 'Has developed drugs', title: 'At least one developed drug hits this target (any indication).' },
  { id: 'complete', label: 'Complete evidence', title: 'All nine evidence axes have data for this gene.' },
  { id: 'tissue_restricted', label: 'Tissue-restricted', title: 'GTEx tau >= 0.6 — expressed in few tissues, so drugging it is less likely to hit everything. Low tau is a safety concern.' },
  { id: 'not_common_essential', label: 'Not pan-essential', title: 'Excludes genes essential across most cell lines, whose CRISPR score reflects housekeeping rather than tumour selectivity.' },
  { id: 'antibody_reachable', label: 'Antibody-reachable', title: 'Surface or secreted, so an antibody or ADC can physically reach it.' },
  { id: 'trial_stopped', label: 'Has stopped trial', title: 'At least one disease trial was halted — open the dossier to see whether it was toxicity or a business decision.' },
  { id: 'legacy_only', label: 'Legacy rows', title: 'Evidence written before the 2026-07 fixes — counts are not comparable. Re-enrich.' },
];

export const DashboardView: React.FC<Props> = ({ theme = 'light', command = null }) => {
  const isDark = theme === 'dark';
  const [snapshots, setSnapshots] = useState<RankingSnapshotMeta[]>([]);
  const [snapId, setSnapId] = useState('');
  const [ov, setOv] = useState<Overview | null>(null);
  const [allRows, setAllRows] = useState<GeneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [gridLoading, setGridLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // interaction state
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<Set<Chip>>(new Set());
  const [axisFilter, setAxisFilter] = useState<{ axis: string; mode: 'has' | 'missing' } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'rank', dir: 'asc' });
  const [pinned, setPinned] = useState<string[]>([]);
  const [gene, setGene] = useState<string | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [dosLoading, setDosLoading] = useState(false);

  const bg = isDark ? '#0b111c' : '#ffffff';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const text = isDark ? '#e2e8f0' : '#0f172a';
  const muted = isDark ? '#64748b' : '#94a3b8';
  const accent = '#2563eb';
  const card: React.CSSProperties = { background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: 18 };

  useEffect(() => {
    fetchSnapshots().then(s => { setSnapshots(s); if (s.length) setSnapId(String(s[0].id)); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!snapId) return;
    let active = true;
    setLoading(true); setGridLoading(true); setErr(null);
    setOv(null); setAllRows([]); setGene(null); setDossier(null); setPinned([]); setAxisFilter(null); setChips(new Set());
    Promise.all([
      getJson(`/api/dashboard/overview?snapshotId=${encodeURIComponent(snapId)}`),
      getJson(`/api/dashboard/genes?snapshotId=${encodeURIComponent(snapId)}&limit=20000`),
    ])
      .then(([o, g]) => { if (!active) return; setOv(o); setAllRows(g?.rows || []); setLoading(false); setGridLoading(false); })
      .catch(e => { if (active) { setErr(String(e?.message || e)); setLoading(false); setGridLoading(false); } });
    return () => { active = false; };
  }, [snapId]);

  const toggleChip = (c: Chip) => setChips(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  // ── the interactive pipeline: filter → sort ────────────────────────────────
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    let out = allRows.filter(r => {
      if (needle && !r.gene_symbol.toUpperCase().includes(needle)) return false;
      if (chips.has('novel_tractable') && !((r.n_drugs ?? 0) === 0 && (r.n_disease_trials ?? 0) === 0 && (r.tractable_modalities ?? 0) > 0)) return false;
      if (chips.has('in_trials') && !((r.n_disease_trials ?? 0) > 0)) return false;
      if (chips.has('no_precedent') && (r.n_disease_trials ?? 0) > 0) return false;
      if (chips.has('has_drugs') && !((r.n_drugs ?? 0) > 0)) return false;
      if (chips.has('complete') && r.completeness < 1) return false;
      if (chips.has('legacy_only') && !r.legacy) return false;
      if (chips.has('tissue_restricted') && !((r.tissue_tau ?? 0) >= 0.6)) return false;
      if (chips.has('not_common_essential') && r.is_common_essential === true) return false;
      if (chips.has('antibody_reachable') && r.surface_or_secreted !== true) return false;
      if (chips.has('trial_stopped') && !((r.n_stopped_trials ?? 0) > 0)) return false;
      return true;
    });
    if (axisFilter) {
      // completeness is axes-present/7; a per-axis test needs the dossier, so approximate
      // with the columns we have — enough to answer "which genes lack druggability?".
      const probe: Record<string, (r: GeneRow) => boolean> = {
        druggability: r => r.n_drugs != null || r.tractable_modalities != null,
        clinical: r => r.n_disease_trials != null,
        literature_epmc: r => r.n_publications != null,
      };
      const f = probe[axisFilter.axis];
      if (f) out = out.filter(r => (axisFilter.mode === 'has' ? f(r) : !f(r)));
    }
    const { key, dir } = sort;
    const s = [...out].sort((a, b) => {
      const av = a[key] as number | null, bv = b[key] as number | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;                 // nulls always last
      if (bv == null) return -1;
      return dir === 'asc' ? av - bv : bv - av;
    });
    return s;
  }, [allRows, q, chips, axisFilter, sort]);

  const openDossier = (g: string) => {
    setGene(g); setDossier(null); setDosLoading(true);
    getJson(`/api/dashboard/dossier?snapshotId=${encodeURIComponent(snapId)}&gene=${encodeURIComponent(g)}`)
      .then(j => { setDossier(j); setDosLoading(false); })
      .catch(e => { setErr(String(e?.message || e)); setDosLoading(false); });
  };
  const togglePin = (g: string) => setPinned(p => p.includes(g) ? p.filter(x => x !== g) : (p.length >= 4 ? p : [...p, g]));

  // ── Apply a chat-driven command (from the co-pilot's dashboard_* tools) ──
  useEffect(() => {
    if (!command) return;
    if (command.reset) { setQ(''); setChips(new Set()); setAxisFilter(null); setSort({ key: 'rank', dir: 'asc' }); }
    if (command.snapshotId != null) setSnapId(String(command.snapshotId));
    if (command.q != null) setQ(command.q);
    if (command.chips) setChips(new Set(command.chips));
    if (command.toggleChip) toggleChip(command.toggleChip);
    if (command.sortKey) setSort({ key: command.sortKey, dir: command.sortDir || (command.sortKey === 'rank' ? 'asc' : 'desc') });
    if (command.openGene) openDossier(command.openGene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  const exportCsv = () => {
    const head = ['gene_symbol', 'rank', 'score', 'target_class', 'is_common_essential', 'surface_or_secreted', 'tissue_tau', 'n_drugs', 'tractable_modalities', 'n_disease_trials', 'phase1', 'phase2', 'phase3', 'max_disease_phase', 'n_stopped_trials', 'n_publications', 'velocity', 'n_patents', 'winner_score', 'rwr_score', 'is_seed', 'completeness', 'legacy'];
    const cell = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const body = rows.map(r => [r.gene_symbol, r.rank, r.score, r.target_class, r.is_common_essential, r.surface_or_secreted, r.tissue_tau, r.n_drugs, r.tractable_modalities, r.n_disease_trials,
      r.trials_by_phase?.phase1, r.trials_by_phase?.phase2, r.trials_by_phase?.phase3, r.max_disease_phase,
      r.n_stopped_trials, r.n_publications, r.velocity, r.n_patents, r.winner_score, r.rwr_score, r.is_seed, r.completeness.toFixed(3), r.legacy].map(cell).join(','));
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dashboard_snapshot_${snapId}_${rows.length}genes.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  // charts recompute from the FILTERED set, so they describe what you are looking at.
  // Count each TARGET once, in the bucket of the FURTHEST phase its disease trials reached.
  // (Summing raw per-gene trial counts double-counts: one gene has many trials, and one
  //  trial is shared across the several genes its drug hits — so that total exceeds the gene
  //  count and means little. "Genes by furthest phase" is bounded by #genes and interpretable.)
  const phaseData = useMemo(() => {
    const t = [0, 0, 0, 0]; // Phase 1..4
    for (const r of rows) {
      if (!(r.n_disease_trials != null && r.n_disease_trials > 0)) continue;
      const ph = Math.floor(r.max_disease_phase ?? 0);   // floor so PHASE2/3 (2.5) is counted as 2, never overstated
      if (ph >= 1) t[Math.min(4, ph) - 1]++;
    }
    return [{ name: 'Phase 1', v: t[0] }, { name: 'Phase 2', v: t[1] }, { name: 'Phase 3', v: t[2] }, { name: 'Phase 4', v: t[3] }];
  }, [rows]);
  const completenessData = useMemo(() => {
    const b = new Array(10).fill(0);                  // 0..9 axes
    for (const r of rows) b[Math.round(r.completeness * 9)]++;
    return b.map((v, i) => ({ name: `${i}/9`, v }));
  }, [rows]);

  const snap = ov?.snapshot;
  const maxAxis = useMemo(() => Math.max(1, ...(ov?.axes || []).map(a => a.genes)), [ov]);
  const sortBtn = (key: SortKey, label: string) => (
    <th key={key} onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
      title="Click to sort"
      style={{ padding: '6px 8px', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center',
        borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap', cursor: 'pointer', color: sort.key === key ? accent : muted, userSelect: 'none' }}>
      {label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, color: text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>Dashboard</h2>
        <select value={snapId} onChange={e => setSnapId(e.target.value)}
          style={{ background: bg, color: text, border: `1px solid ${border}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 700 }}>
          {snapshots.map(s => (
            <option key={s.id} value={s.id}>#{s.id} v{(s as any).version} · {s.disease_name} · {(s as any).gene_count} genes</option>
          ))}
        </select>
        {snap && <span style={{ fontSize: 11, color: muted }}>{snap.disease_id} · created {String(snap.created_at || '').slice(0, 10)}</span>}
      </div>

      {err && (
        <div style={{ ...card, borderColor: '#dc2626', color: '#dc2626', marginBottom: 16, fontSize: 12, lineHeight: 1.6 }}>
          {err}
        </div>
      )}
      {loading && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Spinner color={accent} size={24} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: text }}>Loading snapshot…</div>
            <div style={{ fontSize: 11, color: muted, marginTop: 1 }}>First load pulls the full evidence table, then it’s cached.</div>
          </div>
        </div>
      )}

      {ov && snap && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 14 }}>
            {[
              { k: 'Unique genes', v: fmt(snap.unique_genes), sub: snap.duplicates ? `${fmt(snap.duplicates)} duplicate rows` : 'no duplicates', bad: snap.duplicates > 0 },
              { k: 'Evidence rows', v: fmt(snap.evidence_rows), sub: `across ${ov.axes.length} axes`, bad: false },
              { k: 'Avg. evidence', v: allRows.length ? (allRows.reduce((a, r) => a + r.completeness, 0) / allRows.length * 9).toFixed(1) : '—', sub: 'of 9 axes per gene', bad: false },
              { k: 'Data issues', v: String(ov.warnings.length), sub: ov.warnings.length ? 'see below' : 'none — clean snapshot', bad: ov.warnings.length > 0 },
            ].map(c => (
              <div key={c.k} style={card}>
                <div style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: muted }}>{c.k}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: c.bad ? '#d97706' : (c.k === 'Data issues' ? '#16a34a' : accent), marginTop: 4 }}>{c.v}</div>
                <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {ov.warnings.length > 0 && (
            <div style={{ ...card, borderColor: '#d97706', background: isDark ? 'rgba(217,119,6,0.08)' : '#fffbeb', marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#b45309', marginBottom: 8 }}>
                Data quality — read before trusting these numbers
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
                {ov.warnings.map((w, i) => (
                  <li key={i}>
                    {w}
                    {/legacy|pre-fix/i.test(w) && (
                      <button onClick={() => toggleChip('legacy_only')}
                        style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: accent, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                        show affected genes
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Informational notes — routine, NOT problems. Quiet footnote, never an alarm. */}
          {(ov.notes?.length ?? 0) > 0 && (
            <div style={{ fontSize: 11, color: muted, marginBottom: 14, lineHeight: 1.6 }}>
              {ov.notes!.map((n, i) => <div key={i}>ⓘ {n}</div>)}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,1fr) minmax(280px,1fr)', gap: 12, marginBottom: 14 }}>
            <div style={card}>
              <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: muted, marginBottom: 10 }}>
                Evidence coverage by axis <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>— click a bar to filter</span>
              </div>
              {ov.axes.map(a => {
                const on = axisFilter?.axis === a.axis;
                return (
                  <div key={a.axis} onClick={() => setAxisFilter(on ? null : { axis: a.axis, mode: 'missing' })}
                    title="Click to show genes MISSING this axis; click again to clear"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, cursor: 'pointer', opacity: axisFilter && !on ? 0.45 : 1 }}>
                    <div style={{ width: 140, fontSize: 11, fontWeight: 700, color: on ? accent : text }}>{AXIS_LABEL[a.axis] || a.axis}</div>
                    <div style={{ flex: 1, height: 8, background: isDark ? '#111827' : '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${100 * a.genes / maxAxis}%`, height: '100%', background: on ? '#d97706' : accent, opacity: 0.85 }} />
                    </div>
                    <div style={{ width: 104, textAlign: 'right', fontSize: 11, fontVariantNumeric: 'tabular-nums', color: muted }}>{fmt(a.genes)} · {pctS(a.pct)}</div>
                  </div>
                );
              })}
            </div>

            <div style={card}>
              <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: muted, marginBottom: 6 }}>
                Targets by furthest trial phase <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>— each gene counted once, at its most advanced disease trial</span>
              </div>
              <div style={{ height: 90 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={phaseData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: muted }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: muted }} axisLine={false} tickLine={false} />
                    <RechartsTooltip contentStyle={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, fontSize: 11, color: text }} />
                    <Bar dataKey="v" radius={[3, 3, 0, 0]} fill={accent} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: muted, margin: '8px 0 6px' }}>Evidence completeness (axes present)</div>
              <div style={{ height: 90 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={completenessData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: muted }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: muted }} axisLine={false} tickLine={false} />
                    <RechartsTooltip contentStyle={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, fontSize: 11, color: text }} />
                    <Bar dataKey="v" radius={[3, 3, 0, 0]}>
                      {completenessData.map((_, i) => <Cell key={i} fill={i >= 7 ? '#16a34a' : i >= 4 ? '#d97706' : '#dc2626'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── grid ── */}
          <div style={{ ...card, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search gene…"
                style={{ background: isDark ? '#0f172a' : '#f8fafc', color: text, border: `1px solid ${border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, width: 160 }} />
              {CHIPS.map(c => {
                const on = chips.has(c.id);
                return (
                  <button key={c.id} onClick={() => toggleChip(c.id)} title={c.title}
                    style={{ fontSize: 10, fontWeight: 800, padding: '5px 9px', borderRadius: 999, cursor: 'pointer',
                      border: `1px solid ${on ? accent : border}`, background: on ? accent : 'transparent', color: on ? '#fff' : muted }}>
                    {c.label}
                  </button>
                );
              })}
              {axisFilter && (
                <button onClick={() => setAxisFilter(null)} style={{ fontSize: 10, fontWeight: 800, padding: '5px 9px', borderRadius: 999, border: '1px solid #d97706', background: '#d97706', color: '#fff', cursor: 'pointer' }}>
                  missing {AXIS_LABEL[axisFilter.axis] || axisFilter.axis} ✕
                </button>
              )}
              <span style={{ fontSize: 11, color: muted, marginLeft: 'auto' }}>
                {gridLoading ? 'loading…' : `${fmt(rows.length)} of ${fmt(allRows.length)} genes`}
              </span>
              <button onClick={exportCsv} disabled={!rows.length}
                style={{ fontSize: 10, fontWeight: 800, padding: '6px 10px', borderRadius: 8, border: `1px solid ${border}`, background: 'transparent', color: text, cursor: 'pointer' }}>
                Export CSV
              </button>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: bg }}>
                  <tr>
                    <th style={{ padding: '6px 8px', borderBottom: `1px solid ${border}` }} />
                    {sortBtn('rank', '#')}
                    <th style={{ padding: '6px 8px', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${border}`, color: muted, textAlign: 'left' }}>Gene</th>
                    {sortBtn('score', 'Score')}
                    {sortBtn('n_drugs', 'Drugs')}
                    {sortBtn('tractable_modalities', 'Tractable')}
                    {sortBtn('n_disease_trials', 'Trials')}
                    <th style={{ padding: '6px 8px', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${border}`, color: muted, whiteSpace: 'nowrap', textAlign: 'center' }}>P1/P2/P3</th>
                    <th style={{ padding: '6px 8px', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${border}`, color: muted, textAlign: 'left', whiteSpace: 'nowrap' }}>Class</th>
                    {sortBtn('tissue_tau', 'Tau')}
                    {sortBtn('n_publications', 'Papers')}
                    {sortBtn('velocity', 'Velocity')}
                    {sortBtn('winner_score', 'WINNER')}
                    {sortBtn('completeness', 'Evidence')}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 300).map(r => {
                    const tp = r.trials_by_phase;
                    const isPinned = pinned.includes(r.gene_symbol);
                    return (
                      <tr key={r.gene_symbol} style={{ background: gene === r.gene_symbol ? (isDark ? '#111827' : '#eff6ff') : 'transparent' }}>
                        <td style={{ padding: '4px 6px' }}>
                          <button onClick={() => togglePin(r.gene_symbol)} title={isPinned ? 'Unpin' : 'Pin to compare (max 4)'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: isPinned ? '#d97706' : muted, padding: 0 }}>
                            {isPinned ? '★' : '☆'}
                          </button>
                        </td>
                        <td onClick={() => openDossier(r.gene_symbol)} style={{ padding: '6px 8px', color: muted, fontVariantNumeric: 'tabular-nums', cursor: 'pointer', textAlign: 'center' }}>{r.rank ?? '—'}</td>
                        <td onClick={() => openDossier(r.gene_symbol)} style={{ padding: '6px 8px', fontWeight: 800, color: accent, cursor: 'pointer', textAlign: 'left' }}>
                          {r.gene_symbol}{r.legacy && <span title="Pre-fix evidence — re-enrich" style={{ marginLeft: 6, fontSize: 9, color: '#d97706' }}>legacy</span>}
                        </td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{r.score != null ? r.score.toFixed(3) : '—'}</td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{fmt(r.n_drugs)}</td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{fmt(r.tractable_modalities)}</td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{fmt(r.n_disease_trials)}</td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', color: muted, textAlign: 'center' }}>{tp ? `${tp.phase1}/${tp.phase2}/${tp.phase3}` : '—'}</td>
                        <td style={{ padding: '6px 8px', color: muted, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }} title={r.target_class || ''}>{r.target_class || '—'}{r.is_common_essential ? <span title="Pan-essential across most cell lines" style={{ marginLeft: 4, color: '#d97706', fontWeight: 900 }}>E</span> : null}</td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', color: (r.tissue_tau ?? 0) >= 0.6 ? '#16a34a' : muted, textAlign: 'center' }}>{r.tissue_tau != null ? r.tissue_tau.toFixed(2) : '—'}</td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{fmt(r.n_publications)}</td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{pctS(r.velocity)}</td>
                        <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }} title={r.is_seed ? 'Seed gene' : ''}>{r.winner_score != null ? r.winner_score.toFixed(3) : '—'}{r.is_seed ? <span style={{ marginLeft: 3, color: '#d97706', fontWeight: 900 }}>◆</span> : null}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <div title={`${Math.round(r.completeness * 9)} of 9 axes have evidence`} style={{ width: 56, height: 6, background: isDark ? '#111827' : '#f1f5f9', borderRadius: 3, overflow: 'hidden', display: 'inline-block' }}>
                            <div style={{ width: `${r.completeness * 100}%`, height: '100%', background: r.completeness >= 0.8 ? '#16a34a' : r.completeness >= 0.5 ? '#d97706' : '#dc2626' }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 300 && <div style={{ padding: 8, fontSize: 10, color: muted }}>Showing the first 300 of {fmt(rows.length)} — narrow with search or a filter, or export the full set.</div>}
              {!rows.length && !gridLoading && <div style={{ padding: 14, fontSize: 12, color: muted, fontStyle: 'italic' }}>No genes match these filters.</div>}
            </div>
          </div>

          {/* ── compare tray ── */}
          {pinned.length > 0 && (
            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: muted }}>Compare ({pinned.length}/4)</div>
                <button onClick={() => setPinned([])} style={{ fontSize: 10, color: accent, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>clear</button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 380 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '4px 10px', textAlign: 'left', color: muted, fontSize: 9, textTransform: 'uppercase' }}>Metric</th>
                      {pinned.map(g => <th key={g} style={{ padding: '4px 10px', textAlign: 'right', color: accent, fontWeight: 900 }}>{g}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ['Rank', (r: GeneRow) => r.rank], ['Score', (r: GeneRow) => r.score?.toFixed(3)],
                      ['Developed drugs', (r: GeneRow) => r.n_drugs], ['Tractable modalities', (r: GeneRow) => r.tractable_modalities],
                      ['Trials in disease', (r: GeneRow) => r.n_disease_trials], ['Max phase', (r: GeneRow) => r.max_disease_phase],
                      ['Publications', (r: GeneRow) => r.n_publications], ['Velocity', (r: GeneRow) => pctS(r.velocity)],
                      ['Target class', (r: GeneRow) => r.target_class], ['Pan-essential', (r: GeneRow) => r.is_common_essential == null ? null : (r.is_common_essential ? 'yes' : 'no')], ['Tissue tau', (r: GeneRow) => r.tissue_tau?.toFixed(2)], ['Patents', (r: GeneRow) => r.n_patents],
                      ['Network (WINNER)', (r: GeneRow) => r.winner_score != null ? r.winner_score.toFixed(3) + (r.is_seed ? ' ◆' : '') : null], ['Evidence axes', (r: GeneRow) => `${Math.round(r.completeness * 9)}/9`],
                    ] as [string, (r: GeneRow) => any][]).map(([label, get]) => (
                      <tr key={label}>
                        <td style={{ padding: '4px 10px', color: muted, borderTop: `1px solid ${border}` }}>{label}</td>
                        {pinned.map(g => {
                          const r = allRows.find(x => x.gene_symbol === g);
                          return <td key={g} style={{ padding: '4px 10px', textAlign: 'right', borderTop: `1px solid ${border}`, fontVariantNumeric: 'tabular-nums' }}>{r ? (get(r) ?? '—') : '—'}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {gene && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => { setGene(null); setDossier(null); }} style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
              {dosLoading && <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: muted }}><Spinner color={accent} size={18} /> Building dossier for {gene}…</div>}
              {!dosLoading && !dossier && <div style={{ color: muted }}>No dossier for {gene}.</div>}
              {dossier && <DossierPanel d={dossier} isDark={isDark} muted={muted} border={border} text={text} accent={accent} />}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const LEVEL_STYLE: Record<string, { bg: string; fg: string; label: string; title: string }> = {
  fact: { bg: 'rgba(22,163,74,0.12)', fg: '#16a34a', label: 'fact', title: 'A record of something that happened — a drug exists, a trial ran.' },
  prediction: { bg: 'rgba(217,119,6,0.12)', fg: '#d97706', label: 'prediction', title: 'A forward-looking assessment, not a record. Kept structurally separate from facts.' },
  annotation: { bg: 'rgba(100,116,139,0.12)', fg: '#64748b', label: 'annotation', title: 'Context only — must never drive a score.' },
};

// One attribute row. Long values (e.g. the OT function narrative, which can run several
// hundred characters) are CLAMPED to a few lines with a Show more / less toggle, so one
// verbose attribute can no longer blow the card's height out and bury the rest.
const LONG_VALUE = 160;   // chars beyond which a value collapses
const AttrRow: React.FC<{ a: Attr; muted: string; border: string; text: string }> = ({ a, muted, border, text }) => {
  const [open, setOpen] = useState(false);
  const ls = LEVEL_STYLE[a.level] || LEVEL_STYLE.annotation;
  const off = a.value == null;
  const valueStr = off ? '' : `${a.value}${a.unit ? ` ${a.unit}` : ''}`;
  const isLong = valueStr.length > LONG_VALUE;
  const clamp: React.CSSProperties = isLong && !open
    ? { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as any
    : {};
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', borderTop: `1px solid ${border}` }}>
      <div style={{ flex: 1, fontSize: 11, minWidth: 0 }}>
        <div style={{ color: muted }}>{a.label}</div>
        <div style={{ fontWeight: 700, color: off ? muted : text, fontStyle: off ? 'italic' : 'normal', lineHeight: 1.45, ...clamp }}>
          {off ? (a.confidence === 'not_fetched' ? 'not fetched' : '—') : valueStr}
        </div>
        {isLong && (
          <button onClick={() => setOpen(o => !o)}
            style={{ background: 'none', border: 'none', padding: 0, marginTop: 2, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#2563eb' }}>
            {open ? 'Show less' : 'Show more'}
          </button>
        )}
        {a.note && <div style={{ fontSize: 10, color: muted, marginTop: 2, lineHeight: 1.5 }}>{a.note}</div>}
        <div style={{ fontSize: 9, color: muted, marginTop: 2 }}>{a.source}</div>
      </div>
      <span title={ls.title} style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', background: ls.bg, color: ls.fg, padding: '2px 5px', borderRadius: 4, whiteSpace: 'nowrap' }}>{ls.label}</span>
      {a.confidence === 'low' && <span title="Low confidence — see the note" style={{ fontSize: 8, fontWeight: 900, color: '#d97706' }}>LOW</span>}
    </div>
  );
};

const DossierPanel: React.FC<{ d: Dossier; isDark: boolean; muted: string; border: string; text: string; accent: string }> =
({ d, isDark, muted, border, text, accent }) => (
  <div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: accent }}>{d.gene_symbol}</h3>
      <span style={{ fontSize: 11, color: muted }}>rank {d.rank ?? '—'} · {d.disease_name}</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: muted }}>
        evidence completeness {Math.round(d.completeness.score * 100)}% ({d.completeness.present}/{d.completeness.total})
        {d.completeness.missing.length > 0 && <span title={`Missing: ${d.completeness.missing.join(', ')}`}> · {d.completeness.missing.length} missing</span>}
      </span>
    </div>

    <p style={{ marginTop: 10, marginBottom: 14, fontSize: 13, lineHeight: 1.7, color: text }}>{d.summary}</p>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
      {d.categories.map(c => (
        <div key={c.key} style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em', color: accent }}>{c.label}</div>
          <div style={{ fontSize: 10, color: muted, marginBottom: 8 }}>{c.blurb}</div>
          {c.attrs.map(a => <AttrRow key={a.key} a={a} muted={muted} border={border} text={text} />)}
        </div>
      ))}
    </div>

    <DetailTables d={d} isDark={isDark} muted={muted} border={border} text={text} accent={accent} />

    <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, fontSize: 10, color: muted, lineHeight: 1.6 }}>
      Snapshot #{d.provenance.snapshot_id ?? '—'} · sources: {d.provenance.sources.join(' · ') || '—'}<br />
      Summary is generated deterministically from the stored values — no language model writes it, so it cannot state anything the evidence does not contain.
    </div>
  </div>
);

// ── row-shaped evidence rendered as real tables (drugs, trials, papers, variants) ──
const DetailTables: React.FC<{ d: Dossier; isDark: boolean; muted: string; border: string; text: string; accent: string }> =
({ d, isDark, muted, border, text, accent }) => {
  const dt = d.detail;
  if (!dt) return null;
  const has = (dt.drugs?.length || dt.trials?.length || dt.papers?.length || dt.variants?.length || dt.safety_liabilities?.length);
  if (!has) return null;
  const box: React.CSSProperties = { border: `1px solid ${border}`, borderRadius: 10, padding: 12, marginTop: 12 };
  const th: React.CSSProperties = { padding: '4px 8px', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, textAlign: 'left', borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '4px 8px', fontSize: 11, borderTop: `1px solid ${border}`, verticalAlign: 'top' };
  const head = (t: string, sub: string) => (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em', color: accent }}>{t}</div>
      <div style={{ fontSize: 10, color: muted }}>{sub}</div>
    </div>
  );
  return (
    <>
      {dt.modalities?.length > 0 && (
        <div style={box}>
          {head('Developed drugs by modality', 'Which kind of molecule has actually been made against this target — the fact, not a prediction.')}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Modality</th><th style={th}>Family</th><th style={th}>Drugs</th><th style={th}>Most advanced</th></tr></thead>
            <tbody>
              {dt.modalities.map(m => (
                <tr key={m.modality}>
                  <td style={{ ...td, fontWeight: 700 }}>{m.modality}</td>
                  <td style={{ ...td, color: muted }}>{m.family}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{m.drugCount}</td>
                  <td style={td}>{m.approved ? <strong style={{ color: '#16a34a' }}>{m.topStage}</strong> : m.topStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dt.drugs?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: text, lineHeight: 1.6 }}>
              <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', color: muted }}>Drugs · </span>
              {dt.drugs.slice(0, 14).map(x => `${x.name}${x.approved ? ' ✓' : ''}`).join(', ')}
              {dt.drugs.length > 14 ? ` +${dt.drugs.length - 14} more` : ''}
            </div>
          )}
        </div>
      )}

      {dt.tractability?.length > 0 && (
        <div style={box}>
          {head('Tractability assessment', 'A forward-looking prediction — WHY a modality is considered feasible. Never mixed with the drug facts above.')}
          {dt.tractability.map(t => (
            <div key={t.code} style={{ fontSize: 11, padding: '3px 0', borderTop: `1px solid ${border}` }}>
              <strong>{t.modality}</strong> <span style={{ color: muted }}>— {t.labels.join(' · ')}</span>
            </div>
          ))}
        </div>
      )}

      {dt.trials?.length > 0 && (
        <div style={box}>
          {head(`Clinical trials in ${d.disease_name}`, 'Each trial’s own phase in THIS disease. A stopped trial shows why — toxicity is a very different signal from a business decision.')}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Trial</th><th style={th}>Phase</th><th style={th}>Status</th><th style={th}>Year</th><th style={th}>Drug</th><th style={th}>Sponsor</th></tr></thead>
              <tbody>
                {dt.trials.map((t, i) => {
                  const meta: string[] = [];
                  if (t.n_locations) meta.push(`${t.n_locations} site${t.n_locations === 1 ? '' : 's'}${Array.isArray(t.countries) && t.countries.length ? ` · ${t.countries.slice(0, 3).join(', ')}${t.countries.length > 3 ? '…' : ''}` : ''}`);
                  if (t.enrollment) meta.push(`${t.enrollment.toLocaleString()} enrolled`);
                  if (t.completion_date) meta.push(`est. completion ${String(t.completion_date).slice(0, 4)}`);
                  return (
                  <React.Fragment key={t.id || i}>
                    <tr>
                      <td style={td}>{t.url ? <a href={t.url} target="_blank" rel="noreferrer" style={{ color: accent, textDecoration: 'none' }}>{(t.id || 'trial').toUpperCase()}</a> : (t.id || '—')}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{t.phase ? `P${t.phase}` : '—'}</td>
                      <td style={{ ...td, color: muted }}>{(t.status || '—').replace(/_/g, ' ').toLowerCase()}</td>
                      <td style={{ ...td, color: muted, fontVariantNumeric: 'tabular-nums' }}>{t.year ?? '—'}</td>
                      <td style={td}>{t.drug || '—'}</td>
                      <td style={{ ...td, color: muted }}>{t.sponsor || '—'}</td>
                    </tr>
                    {meta.length > 0 && (
                      <tr><td colSpan={6} style={{ ...td, borderTop: 'none', paddingTop: 0, fontSize: 10, color: muted }}>
                        📍 {meta.join(' · ')}
                      </td></tr>
                    )}
                    {t.why_stopped && (
                      <tr><td colSpan={6} style={{ ...td, borderTop: 'none', paddingTop: 0, fontSize: 10, color: '#b45309' }}>
                        ⚠ stopped: {t.why_stopped}{t.stop_reasons?.length ? ` (${t.stop_reasons.join(', ')})` : ''}
                      </td></tr>
                    )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dt.safety_liabilities?.length > 0 && (
        <div style={box}>
          {head('Recorded safety liabilities', 'Real adverse events associated with this target — evidence, not a genetic proxy.')}
          {dt.safety_liabilities.slice(0, 12).map((x, i) => (
            <div key={i} style={{ fontSize: 11, padding: '3px 0', borderTop: `1px solid ${border}` }}>
              <strong>{x.event || 'event'}</strong>
              {x.effects?.length ? <span style={{ color: muted }}> — {x.effects.join(', ')}</span> : null}
              {x.datasource ? <span style={{ color: muted, fontSize: 10 }}> · {x.datasource}</span> : null}
            </div>
          ))}
        </div>
      )}

      {dt.variants?.length > 0 && (
        <div style={box}>
          {head('Top variants', 'The specific changes seen in the cohort.')}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Change</th><th style={th}>Samples</th><th style={th}>Share</th></tr></thead>
            <tbody>
              {dt.variants.slice(0, 10).map(v => (
                <tr key={v.change}>
                  <td style={{ ...td, fontWeight: 700 }}>{v.change}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{v.count}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: muted }}>{Math.round((v.fraction ?? 0) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dt.papers?.length > 0 && (
        <div style={box}>
          {head('Recent publications', 'Newest first — the momentum behind the paper count.')}
          {dt.papers.map((p, i) => (
            <div key={p.id || i} style={{ fontSize: 11, padding: '4px 0', borderTop: `1px solid ${border}`, lineHeight: 1.5 }}>
              <a href={p.source === 'PMC' ? `https://europepmc.org/article/PMC/${p.id}` : `https://pubmed.ncbi.nlm.nih.gov/${p.id}/`}
                 target="_blank" rel="noreferrer" style={{ color: accent, textDecoration: 'none' }}>{p.title}</a>
              <div style={{ color: muted, fontSize: 10 }}>{[p.journal, p.year].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default DashboardView;
