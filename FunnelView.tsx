import React, { useState, useEffect, useMemo } from 'react';
import { fetchSnapshots, fetchSnapshotScores, fetchSnapshotEvidence, type RankingSnapshotMeta } from './supabase';
import { AXES, HEADLINE_AXES, COMPOSITE_AXES, type AxisDef, type FilterDef } from './evidenceRegistry';
import { runFunnel, DEFAULT_ELIGIBILITY, type FunnelGene, type EligibilityConfig } from './funnelEngine';
import GeneDetailDrawer from './GeneDetailDrawer';

// ── DB-backed Target Funnel — "narrowing flow" redesign ───────────────────────
// Reads one stored snapshot from Oracle, then runs the registry's tier gates as a
// step-ordered cascade (universe → T1 → … → T8). Each tier is a horizontal bar
// whose length is its surviving count; click a tier to tune its gate inline. A
// sticky bar summarises the shortlist; "View full shortlist" opens a results sheet
// where each gene shows pass/fail per axis + its composite, and clicking a row
// opens the full drill-down (drawer parity).
//
// INVARIANTS preserved from the design brief §6: registry-driven (UI iterates the
// registry — nothing hard-coded to 8), raw-value filters (real units, not the
// normalized axis), cascade semantics, direction-aware weighted-harmonic composite,
// DB-backed & read-only, drawer parity, graceful "pending" axes.

interface Props { theme?: 'dark' | 'light' }

type GeneFeature = {
  gene_symbol: string;
  rank: number | null;
  getScore: number | null;
  drugLabel: string | null;
  axis: Record<string, number | null>;   // normalized 0–1 per axis (ranking)
  raw: Record<string, number | null>;     // raw value per filter field (filtering, real units)
};

const safeParse = (s: any) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };
const num = (v: any) => (v == null || isNaN(Number(v)) ? null : Number(v));
const csvCell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const fmtN = (n: number) => n.toLocaleString('en-US');

// hex → rgba with alpha; and a lighten toward white for the bar gradient.
const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};
const lighten = (hex: string, t: number) => {
  const h = hex.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const m = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
};

export const FunnelView: React.FC<Props> = ({ theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [snapshots, setSnapshots] = useState<RankingSnapshotMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [features, setFeatures] = useState<GeneFeature[]>([]);
  const [diseaseName, setDiseaseName] = useState('');
  const [loading, setLoading] = useState(true);

  // Every headline tier can act as a filter step (the registry's hard/soft split
  // only sets the DEFAULT intent; here each tier narrows when its gate is enabled,
  // so the funnel is a true top-to-bottom cascade T1→T8).
  const [thresholds, setThresholds] = useState<Record<string, number>>(() => Object.fromEntries(HEADLINE_AXES.map(a => [a.key, a.filter.default ?? 0])));
  const [cats, setCats] = useState<Record<string, string[]>>({});
  const [hardOn, setHardOn] = useState<Record<string, boolean>>(() => Object.fromEntries(HEADLINE_AXES.map(a => [a.key, false])));
  const [requirePresent, setRequirePresent] = useState<Record<string, boolean>>({});
  const [openTier, setOpenTier] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [drawerGene, setDrawerGene] = useState<string | null>(null);
  const [infoTier, setInfoTier] = useState<string | null>(null);   // ⓘ tier explainer sidebar

  const resetGates = () => {
    setThresholds(Object.fromEntries(HEADLINE_AXES.map(a => [a.key, a.filter.default ?? 0])));
    setCats({}); setHardOn(Object.fromEntries(HEADLINE_AXES.map(a => [a.key, false]))); setRequirePresent({});
  };

  useEffect(() => {
    let active = true;
    fetchSnapshots().then(s => { if (!active) return; setSnapshots(s); if (s.length) setSelectedId(String(s[0].id)); setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setFeatures([]); return; }
    let active = true; setLoading(true);
    const snap = snapshots.find(s => String(s.id) === selectedId);
    setDiseaseName(snap?.disease_name || '');
    Promise.all([fetchSnapshotScores(selectedId), fetchSnapshotEvidence(selectedId)]).then(([scores, evidence]) => {
      if (!active) return;
      const ev: Record<string, Record<string, any>> = {};
      for (const e of evidence as any[]) {
        const g = e.gene_symbol; if (!g) continue;
        (ev[g] ||= {})[e.evidence_type] = safeParse(e.value_json) || {};
      }
      const feats: GeneFeature[] = (scores as any[]).map(r => {
        const g = r.gene_symbol;
        const mut = ev[g]?.mutation, drug = ev[g]?.druggability, clin = ev[g]?.clinical, lit = ev[g]?.literature;
        const dys = ev[g]?.expression_tvn, dep = ev[g]?.dependency, saf = ev[g]?.safety;
        // Raw values pulled straight from the stored value_json contract — the
        // SAME fields the gene drawer panels display, so funnel == drawer.
        const genetic = num(r.genetic_score);
        const frequency = mut ? num(mut.frequency) : null;
        const log2fc = dys ? num(dys.log2fc) : null;
        const chronos = dep ? num(dep.mean) : null;
        const loeuf = saf ? num(saf.loeuf) : null;
        const trial_count = clin ? num(clin.trial_count) : null;
        const velocity = lit ? num(lit.velocity) : null;
        return {
          gene_symbol: g,
          rank: num(r.rank),
          getScore: num(r.get_score),
          drugLabel: drug ? (drug.label ?? null) : null,
          axis: {
            genetic,
            mutation: mut ? num(mut.axis ?? frequency) : null,
            dysregulation: dys ? num(dys.axis ?? (log2fc != null ? Math.abs(log2fc) / 4 : null)) : null,
            dependency: dep ? num(dep.axis ?? (chronos != null ? -chronos : null)) : null,
            druggability: drug ? num(drug.axis ?? drug.score) : num(r.target_score),
            safety: saf ? num(saf.axis ?? saf.pli) : null,
            clinical: clin ? num(clin.axis ?? clin.trial_count) : null,
            literature: lit ? num(lit.axis ?? velocity) : null,
            tissue: num(r.tau_tissue),
          },
          raw: { genetic, frequency, log2fc, chronos, loeuf, trial_count, velocity },
        };
      });
      setFeatures(feats); setLoading(false);
    });
    return () => { active = false; };
  }, [selectedId, snapshots]);

  const valueOf = (key: string, f: GeneFeature) => f.axis[key] ?? null;
  const rawOf = (field: string | undefined, f: GeneFeature) => (field ? f.raw[field] ?? null : null);
  const categoryOf = (key: string, f: GeneFeature) => (key === 'druggability' ? f.drugLabel : null);

  const available = useMemo(() => {
    const a: Record<string, boolean> = {};
    for (const ax of AXES) a[ax.key] = features.some(f => valueOf(ax.key, f) != null);
    return a;
  }, [features]);

  const passesGate = (ax: AxisDef, f: GeneFeature): boolean => {
    if (!hardOn[ax.key] || !available[ax.key]) return true;
    if (ax.filter.kind === 'category') {
      const sel = cats[ax.key] || [];
      if (sel.length === 0) return true;
      const c = categoryOf(ax.key, f);
      if (c == null) return !requirePresent[ax.key];
      return sel.includes(c);
    }
    const v = rawOf(ax.filter.field, f);
    if (v == null) return !requirePresent[ax.key];
    const th = thresholds[ax.key] ?? ax.filter.default ?? 0;
    return ax.filter.op === '<=' ? v <= th : v >= th;
  };

  // ── TWO-STAGE engine (funnelEngine.ts, per Disease2Target_App_Design.md) ──────
  // Stage 1 eligibility (permissive OR-nexus + optional tractability) removes only
  // out-of-scope genes; Stage 2 ranks the rest by a weighted-ARITHMETIC composite of
  // externally-normalized axes minus bounded risk penalties. This replaces the old
  // strict hard-gate cascade + within-survivor harmonic composite, which — verified
  // on 12 canonical PDAC genes — collapsed to zero and deleted KRAS at the LOEUF gate.
  const result = useMemo(() => {
    const total = features.length;
    const genes: FunnelGene[] = features.map(f => ({
      gene_symbol: f.gene_symbol,
      otOverall: f.getScore,               // OT overall/indirect association (not the always-0 genetic datatype)
      frequency: f.raw.frequency ?? null,
      log2fc: f.raw.log2fc ?? null,
      chronos: f.raw.chronos ?? null,
      loeuf: f.raw.loeuf ?? null,
      drugLabel: f.drugLabel,
      trialCount: f.raw.trial_count ?? null,
      velocity: f.raw.velocity ?? null,
      tissueTau: f.axis.tissue ?? null,
    }));
    // Eligibility config follows the funnel's own gate controls where the user has
    // enabled them, otherwise the design defaults. The genetic/mutation/dependency
    // controls feed the OR-nexus; the druggability toggle turns on the tractability gate.
    const cfg: EligibilityConfig = {
      nexus: true,
      otMin: hardOn['genetic'] ? (thresholds['genetic'] ?? DEFAULT_ELIGIBILITY.otMin) : DEFAULT_ELIGIBILITY.otMin,
      mutMin: hardOn['mutation'] ? (thresholds['mutation'] ?? DEFAULT_ELIGIBILITY.mutMin) : DEFAULT_ELIGIBILITY.mutMin,
      depMax: hardOn['dependency'] ? (thresholds['dependency'] ?? DEFAULT_ELIGIBILITY.depMax) : DEFAULT_ELIGIBILITY.depMax,
      tractability: !!hardOn['druggability'],
    };
    const eng = runFunnel(genes, cfg);
    const byGene = new Map(features.map(f => [f.gene_symbol, f] as const));
    const shortlist = eng.ranked
      .filter(s => byGene.has(s.gene.gene_symbol))
      .map(s => ({ f: byGene.get(s.gene.gene_symbol)!, composite: s.score, completeness: s.completeness, axisScores: s.axisScores }));
    // tierCounts drive the narrowing-flow bars: the OR-nexus axes show the post-nexus
    // survivor count, druggability shows post-tractability, and the score-only axes
    // show the eligible set (they rank, they do not narrow).
    const tierCounts: Record<string, number> = {};
    for (const ax of HEADLINE_AXES) {
      tierCounts[ax.key] = (ax.key === 'genetic' || ax.key === 'mutation' || ax.key === 'dependency')
        ? eng.stage1.afterNexus
        : ax.key === 'druggability' ? eng.stage1.afterTractability : eng.eligibleCount;
    }
    return { total, tierCounts, shortlist };
  }, [features, thresholds, cats, hardOn, requirePresent, available]);

  // ── theme tokens (match the design language) ────────────────────────────────
  const t = isDark
    ? { bg: '#0c0f14', panel: '#13181f', panel2: '#171d26', line: '#242c38', line2: '#1d242e', tx: '#e6edf3', dim: '#9aa6b4', faint: '#5f6b7a', accent: '#3b6fe0', accentWeak: '#16233f' }
    : { bg: '#f3f5f8', panel: '#ffffff', panel2: '#f7f9fc', line: '#e6e9ef', line2: '#eef1f6', tx: '#10151d', dim: '#5a6573', faint: '#8a93a3', accent: '#3b6fe0', accentWeak: '#eaf0fd' };
  const grad = `linear-gradient(90deg, ${t.accent}, ${lighten(t.accent, 0.34)})`;
  const mono = "'IBM Plex Mono', ui-monospace, monospace";

  const total = result.total || 1;
  const wPct = (n: number) => Math.max((n / total) * 100, 13).toFixed(1);
  const activeGates = HEADLINE_AXES.filter(a => hardOn[a.key] && available[a.key]).length;
  const pendingGates = HEADLINE_AXES.filter(a => !available[a.key]).length;
  const orderedHeadline = useMemo(() => [...HEADLINE_AXES].sort((a, b) => a.tier - b.tier), []);

  // Dropdown: show EVERY stored snapshot, grouped by disease (newest version first
  // within each group, since snapshots arrive newest-first) so any run — not just
  // the latest — can be selected.
  const snapshotGroups = useMemo(() => {
    const m = new Map<string, RankingSnapshotMeta[]>();
    for (const s of snapshots) { const k = s.disease_name || s.disease_id; const arr = m.get(k); if (arr) arr.push(s); else m.set(k, [s]); }
    return [...m.entries()].map(([disease, items]) => ({ disease, items }));
  }, [snapshots]);

  const exportCsv = () => {
    const cols = ['rank', 'gene', 'composite', 'get_score', 'completeness', ...COMPOSITE_AXES.map(a => a.key)];
    const lines = [cols.join(',')];
    result.shortlist.forEach((s, i) => lines.push([i + 1, s.f.gene_symbol, s.composite?.toFixed(4) ?? '', s.f.getScore ?? '', Math.round(s.completeness * 100) + '%', ...COMPOSITE_AXES.map(a => valueOf(a.key, s.f) ?? '')].map(csvCell).join(',')));
    const snap = snapshots.find(s => String(s.id) === selectedId);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `funnel_${(snap?.disease_name || 'snapshot').replace(/\s+/g, '_')}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // preset cut-offs for a range gate. Prefer the registry's hand-picked presets
  // (tuned to each axis's real distribution); fall back to a generic linear spread.
  const rangePresets = (f: FilterDef) => {
    if (f.presets && f.presets.length) return f.presets.map(p => ({ label: p.label, value: p.value }));
    const step = f.step || 0.01; const dec = (String(step).split('.')[1] || '').length;
    const round = (v: number) => +(Math.round(v / step) * step).toFixed(dec);
    const lo = f.min ?? 0, hi = f.max ?? 1, def = f.default ?? 0;
    const arr: [string, number][] = f.op === '<='
      ? [['Lenient', hi], ['Suggested', def], ['Strict', def + (lo - def) * 0.5], ['Very strict', def + (lo - def) * 0.82]]
      : [['Lenient', lo], ['Suggested', def], ['Strict', def + (hi - def) * 0.45], ['Very strict', def + (hi - def) * 0.8]];
    return arr.map(([label, v]) => ({ label, value: round(Math.max(lo, Math.min(hi, v))) }));
  };
  // human-readable threshold: percent axes (frequency, velocity) show as %, else value + unit
  const fmtThresh = (f: FilterDef, v: number) => f.percent ? `${+(v * 100).toFixed(2)}%` : `${v}${f.unit ? ' ' + f.unit : ''}`;
  const catPresets = (list: string[]) => [
    { label: 'All categories', set: list.slice() },
    { label: 'Validated + in development', set: list.filter(c => /Validated|Development/i.test(c)) },
    { label: 'Validated only', set: list.filter(c => /Validated/i.test(c)) },
    { label: 'Exclude “no drug data”', set: list.filter(c => !/No Drug|None/i.test(c)) },
  ];

  // plain-English "how the gate reads" sentence for the ⓘ tier explainer
  const filterReadsFor = (ax: AxisDef): string =>
    (ax.type === 'soft' ? 'Soft tier — left off it only ranks survivors; enable it to also filter. ' : '')
    + (ax.filter.kind === 'category'
        ? 'Keeps genes whose category is in your selected set (none selected = keep all).'
        : `Keeps genes whose ${ax.filter.field} is ${ax.filter.op === '<=' ? 'at most (≤)' : 'at least (≥)'} the threshold${ax.filter.unit ? ` (${ax.filter.unit})` : ''}. ${ax.direction === 'con' ? 'A higher value counts AGAINST the target and inverts in the ranking.' : 'Higher is a stronger case for the target.'}`);

  // ── small UI atoms ──────────────────────────────────────────────────────────
  const Toggle = ({ on, has, color, onClick }: { on: boolean; has: boolean; color: string; onClick: () => void }) => (
    <button onClick={onClick} title={has ? 'Enable gate' : 'No data in this snapshot'} disabled={!has}
      style={{ flex: '0 0 auto', width: 38, height: 21, borderRadius: 12, border: 'none', cursor: has ? 'pointer' : 'not-allowed', padding: 2, display: 'flex', background: on && has ? color : t.line, transition: 'background .15s' }}>
      <span style={{ width: 17, height: 17, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'transform .15s', transform: `translateX(${on && has ? 17 : 0}px)` }} />
    </button>
  );

  const badge = (bg: string): React.CSSProperties => ({ flex: '0 0 auto', width: 42, height: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 10, color: '#fff', background: bg });

  // a single tier in the narrowing flow
  const FlowRow = ({ ax, prev, count }: { ax: AxisDef; prev: number; count: number }) => {
    const has = !!available[ax.key];
    const on = !!hardOn[ax.key] && has;
    const isOpen = openTier === ax.key;
    const drop = prev > 0 ? Math.round((prev - count) / prev * 100) : 0;
    const isRange = ax.filter.kind === 'range';
    const ruleText = !has
      ? 'no data in snapshot'
      : ax.filter.kind === 'category'
        ? ((cats[ax.key] || []).length === 0 || (cats[ax.key] || []).length === (ax.filter.categories || []).length ? 'any category' : (cats[ax.key] || []).join(' / '))
        : `${ax.filter.op === '<=' ? '≤' : '≥'} ${fmtThresh(ax.filter, thresholds[ax.key] ?? ax.filter.default ?? 0)}`;
    const thr = thresholds[ax.key] ?? ax.filter.default ?? 0;
    const presetMatch = isRange ? rangePresets(ax.filter).find(p => Math.abs(p.value - thr) < 1e-9) : undefined;

    return (
      <div>
        <div onClick={() => has && setOpenTier(o => o === ax.key ? null : ax.key)}
          style={{ display: 'grid', gridTemplateColumns: '46px 1fr 150px', alignItems: 'center', gap: 15, cursor: has ? 'pointer' : 'default' }}>
          <span style={badge(ax.color)}>
            <span style={{ fontSize: 8, letterSpacing: '.12em', fontWeight: 700, opacity: .85 }}>TIER</span>
            <span style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, lineHeight: 1, marginTop: 1 }}>{ax.tier}</span>
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.tx, whiteSpace: 'nowrap' }}>{ax.label}</span>
              <button onClick={(e) => { e.stopPropagation(); setInfoTier(o => o === ax.key ? null : ax.key); }} title="What is this tier? Source & filter info"
                style={{ flex: '0 0 auto', width: 16, height: 16, borderRadius: '50%', border: `1px solid ${infoTier === ax.key ? ax.color : t.line}`, background: infoTier === ax.key ? ax.color : 'transparent', color: infoTier === ax.key ? '#fff' : t.faint, fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 700, fontSize: 10, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>i</button>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{ruleText}</span>
            </div>
            <div style={{ position: 'relative', height: 26, width: has ? `${wPct(count)}%` : '13%', borderRadius: 7, background: has ? (on ? grad : hexA(t.accent, 0.22)) : 'transparent', border: has ? 'none' : `1px dashed ${t.line}`, display: 'flex', alignItems: 'center', transition: 'width .28s cubic-bezier(.3,.7,.3,1)' }}>
              <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 5, background: has ? 'rgba(0,0,0,.24)' : 'transparent', fontFamily: mono, fontSize: 11.5, fontWeight: 600, color: has ? '#fff' : t.faint }}>{fmtN(count)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
            <span style={{ fontSize: 11.5, color: t.faint, whiteSpace: 'nowrap' }}>{fmtN(prev)} in → <span style={{ fontWeight: 700, color: drop > 0 ? '#e0567a' : t.faint }}>−{drop}%</span></span>
            {has && <span style={{ fontSize: 10, color: t.faint, transition: 'transform .18s', transform: `rotate(${isOpen ? 90 : 0}deg)` }}>▸</span>}
          </div>
        </div>

        {isOpen && (
          <div style={{ margin: '11px 0 2px 61px', background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 10, padding: '13px 15px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: t.dim, lineHeight: 1.35 }}>{ax.question}</div>
                <div style={{ fontSize: 10, color: t.faint, marginTop: 3, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Source · {ax.source}</div>
              </div>
              <Toggle on={!!hardOn[ax.key]} has={has} color={ax.color} onClick={() => has && setHardOn(p => ({ ...p, [ax.key]: !p[ax.key] }))} />
            </div>

            {!has && <div style={{ marginTop: 10, fontSize: 10.5, fontWeight: 600, color: t.faint }}>No data in this snapshot — gate disabled.</div>}

            {has && isRange && (
              <div style={{ marginTop: 12, opacity: on ? 1 : .55 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10.5, color: t.faint }}>{ax.filter.op === '<=' ? 'keep ≤ threshold' : 'keep ≥ threshold'}</span>
                  <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: t.tx }}>{ax.filter.op === '<=' ? '≤ ' : '≥ '}{fmtThresh(ax.filter, thr)}</span>
                </div>
                <input type="range" min={ax.filter.min ?? 0} max={ax.filter.max ?? 1} step={ax.filter.step ?? 0.01} value={thr} disabled={!on}
                  onChange={e => setThresholds(p => ({ ...p, [ax.key]: parseFloat(e.target.value) }))} style={{ width: '100%', height: 4, accentColor: ax.color, cursor: on ? 'pointer' : 'default' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontFamily: mono, fontSize: 9.5, color: t.faint }}>
                  <span>{fmtThresh(ax.filter, ax.filter.min ?? 0)}</span><span>{fmtThresh(ax.filter, ax.filter.max ?? 1)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <select value={presetMatch ? String(presetMatch.value) : ''} disabled={!on}
                    onChange={e => { if (e.target.value !== '') setThresholds(p => ({ ...p, [ax.key]: parseFloat(e.target.value) })); }}
                    style={{ flex: 1, minWidth: 150, appearance: 'none', background: t.panel, border: `1px solid ${t.line}`, color: t.tx, font: 'inherit', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, cursor: on ? 'pointer' : 'default' }}>
                    <option value="">Preset cut-off…</option>
                    {rangePresets(ax.filter).map(p => <option key={p.label} value={String(p.value)}>{p.label} · {ax.filter.op === '<=' ? '≤ ' : '≥ '}{fmtThresh(ax.filter, p.value)}</option>)}
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
                    <span style={{ fontSize: 10, color: t.faint, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Exact{ax.filter.percent ? ' %' : (ax.filter.unit ? ' ' + ax.filter.unit : '')}</span>
                    <input type="number"
                      min={(ax.filter.min ?? 0) * (ax.filter.percent ? 100 : 1)}
                      max={(ax.filter.max ?? 1) * (ax.filter.percent ? 100 : 1)}
                      step={(ax.filter.step ?? 0.01) * (ax.filter.percent ? 100 : 1)}
                      value={ax.filter.percent ? +(thr * 100).toFixed(2) : thr} disabled={!on}
                      onChange={e => { const raw = parseFloat(e.target.value); if (!Number.isNaN(raw)) setThresholds(p => ({ ...p, [ax.key]: ax.filter.percent ? raw / 100 : raw })); }}
                      style={{ width: 80, background: t.panel, border: `1px solid ${t.line}`, color: t.tx, fontFamily: mono, fontSize: 11.5, padding: '6px 8px', borderRadius: 8 }} />
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 10, fontSize: 10, color: t.faint, cursor: on ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={!!requirePresent[ax.key]} disabled={!on} onChange={e => setRequirePresent(p => ({ ...p, [ax.key]: e.target.checked }))} />
                  also drop genes with no {ax.filter.field} value
                </label>
              </div>
            )}

            {has && ax.filter.kind === 'category' && (
              <div style={{ marginTop: 12, opacity: on ? 1 : .55 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(ax.filter.categories || []).map(c => {
                    const sel = (cats[ax.key] || []).includes(c);
                    return (
                      <button key={c} disabled={!on} onClick={() => setCats(p => { const cur = new Set(p[ax.key] || []); cur.has(c) ? cur.delete(c) : cur.add(c); return { ...p, [ax.key]: [...cur] }; })}
                        style={{ font: 'inherit', fontSize: 10.5, fontWeight: 500, padding: '5px 9px', borderRadius: 7, cursor: on ? 'pointer' : 'default', border: `1px solid ${sel ? 'transparent' : t.line}`, color: sel ? '#fff' : t.dim, background: sel ? ax.color : t.panel }}>{c}</button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <select value="" disabled={!on}
                    onChange={e => { const i = parseInt(e.target.value, 10); if (!Number.isNaN(i)) setCats(p => ({ ...p, [ax.key]: catPresets(ax.filter.categories || [])[i].set })); }}
                    style={{ flex: 1, minWidth: 160, appearance: 'none', background: t.panel, border: `1px solid ${t.line}`, color: t.tx, font: 'inherit', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, cursor: on ? 'pointer' : 'default' }}>
                    <option value="">Quick select…</option>
                    {catPresets(ax.filter.categories || []).map((p, i) => <option key={p.label} value={String(i)}>{p.label}</option>)}
                  </select>
                  <button disabled={!on} onClick={() => setCats(p => ({ ...p, [ax.key]: (ax.filter.categories || []).slice() }))} style={{ font: 'inherit', fontSize: 10.5, fontWeight: 600, color: t.dim, background: t.panel, border: `1px solid ${t.line}`, borderRadius: 7, padding: '6px 11px', cursor: on ? 'pointer' : 'default' }}>All</button>
                  <button disabled={!on} onClick={() => setCats(p => ({ ...p, [ax.key]: [] }))} style={{ font: 'inherit', fontSize: 10.5, fontWeight: 600, color: t.dim, background: t.panel, border: `1px solid ${t.line}`, borderRadius: 7, padding: '6px 11px', cursor: on ? 'pointer' : 'default' }}>None</button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: t.faint, cursor: on ? 'pointer' : 'default' }}>
                    <input type="checkbox" checked={!!requirePresent[ax.key]} disabled={!on} onChange={e => setRequirePresent(p => ({ ...p, [ax.key]: e.target.checked }))} /> require a category
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // flow rows with running "in" count for the drop readout
  let prevCount = result.total;
  const flowRows = orderedHeadline.map(ax => { const count = result.tierCounts[ax.key] ?? result.total; const row = { ax, prev: prevCount, count }; prevCount = count; return row; });
  const topGenes = result.shortlist.slice(0, 6).map(s => s.f.gene_symbol);
  const snapMeta = snapshots.find(s => String(s.id) === selectedId);
  const infoAx = infoTier ? AXES.find(a => a.key === infoTier) : null;

  const stats = [
    { label: 'Universe', value: fmtN(result.total), color: t.tx },
    { label: 'Shortlist', value: fmtN(result.shortlist.length), color: t.accent },
    { label: 'Active gates', value: String(activeGates), color: t.tx },
    { label: 'Pending', value: String(pendingGates), color: pendingGates ? '#e0567a' : t.faint },
  ];

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'IBM Plex Sans', system-ui, sans-serif", color: t.tx, background: t.bg, border: `1px solid ${t.line}`, borderRadius: 12 }}>
      {/* ── HEADER ── */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', height: 54, borderBottom: `1px solid ${t.line}`, background: t.panel, flex: '0 0 auto', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid #fff' }} />
          </div>
          <span style={{ fontWeight: 700, letterSpacing: '.16em', fontSize: 13, color: t.tx }}>FUNNEL</span>
        </div>
        <div style={{ height: 22, width: 1, background: t.line }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 10, color: t.faint, textTransform: 'uppercase', letterSpacing: '.09em', fontWeight: 600 }}>Snapshot</span>
          <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setResultsOpen(false); setOpenTier(null); }}
            style={{ appearance: 'none', background: t.panel2, border: `1px solid ${t.line}`, color: t.tx, font: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {snapshots.length === 0 && <option value="">No stored snapshots</option>}
            {snapshotGroups.map(g => (
              <optgroup key={g.disease} label={g.disease}>
                {g.items.map(s => <option key={s.id} value={String(s.id)}>v{s.version} · {s.gene_count ?? '?'} genes · {(s.created_at || '').slice(0, 10)}</option>)}
              </optgroup>
            ))}
          </select>
          {snapMeta && <span style={{ fontSize: 11, color: t.faint }}>· {(snapMeta.created_at || '').slice(0, 10)}</span>}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${t.line}`, borderRadius: 9, overflow: 'hidden' }}>
          {stats.map((s, i) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6px 13px', minWidth: 64, borderLeft: i ? `1px solid ${t.line}` : 'none', background: t.panel }}>
              <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 600, lineHeight: 1, color: s.color }}>{s.value}</span>
              <span style={{ fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase', color: t.faint, fontWeight: 600, marginTop: 3 }}>{s.label}</span>
            </div>
          ))}
        </div>
        <button onClick={exportCsv} disabled={!result.shortlist.length} style={{ display: 'flex', alignItems: 'center', gap: 6, background: t.panel2, border: `1px solid ${t.line}`, color: t.tx, font: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '7px 12px', borderRadius: 8, cursor: result.shortlist.length ? 'pointer' : 'not-allowed', opacity: result.shortlist.length ? 1 : .5 }}>↓ Export CSV</button>
      </header>

      {/* ── BODY ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: t.bg }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, color: t.faint, fontStyle: 'italic' }}>Loading snapshot from Oracle…</div>
          ) : !selectedId ? (
            <div style={{ padding: 40, color: t.faint, fontStyle: 'italic' }}>No stored snapshots yet — run a harvest job first.</div>
          ) : (
            <div style={{ padding: '20px 26px 30px', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.tx }}>Narrowing flow</div>
                  <div style={{ fontSize: 11, color: t.faint, marginTop: 3 }}>Universe of {fmtN(result.total)} → {fmtN(result.shortlist.length)} shortlisted · {activeGates} gates active · click a tier to tune its gate</div>
                </div>
                <button onClick={resetGates} style={{ background: t.panel, border: `1px solid ${t.line}`, color: t.accent, font: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '7px 13px', borderRadius: 8, flex: '0 0 auto' }}>Reset gates</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* universe pool row */}
                <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr 150px', alignItems: 'center', gap: 15 }}>
                  <span style={badge(isDark ? '#3a4150' : '#9aa3b2')}>
                    <span style={{ fontSize: 8, letterSpacing: '.12em', fontWeight: 700, opacity: .85 }}>POOL</span>
                    <span style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, lineHeight: 1, marginTop: 1 }}>0</span>
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.tx }}>Gene universe</span>
                      <span style={{ fontFamily: mono, fontSize: 10.5, color: t.faint }}>full Open Targets set — no early triage</span>
                    </div>
                    <div style={{ position: 'relative', height: 26, width: '100%', borderRadius: 7, background: isDark ? '#39424f' : '#c9d0db', display: 'flex', alignItems: 'center' }}>
                      <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 5, background: 'rgba(0,0,0,.22)', fontFamily: mono, fontSize: 11.5, fontWeight: 600, color: '#fff' }}>{fmtN(result.total)}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 11.5, color: t.faint }}>{fmtN(result.total)} in → <span style={{ fontWeight: 700 }}>−0%</span></div>
                </div>

                {flowRows.map(r => <FlowRow key={r.ax.key} ax={r.ax} prev={r.prev} count={r.count} />)}
              </div>
            </div>
          )}
        </div>

        {/* ── sticky shortlist bar ── */}
        {!loading && selectedId && (
          <div onClick={() => result.shortlist.length && setResultsOpen(true)} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', height: 60, borderTop: `1px solid ${t.line}`, background: t.panel, cursor: result.shortlist.length ? 'pointer' : 'default', boxShadow: '0 -2px 14px rgba(8,12,20,.05)', zIndex: 3 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: '0 0 auto' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: t.tx }}>Shortlist</span>
              <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 600, color: t.accent }}>{fmtN(result.shortlist.length)}</span>
              <span style={{ fontSize: 11.5, color: t.faint }}>ranked targets</span>
            </div>
            <div style={{ height: 20, width: 1, background: t.line, flex: '0 0 auto' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 10, color: t.faint, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, flex: '0 0 auto' }}>Top</span>
              {topGenes.map(g => <span key={g} style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: t.dim, background: t.panel2, border: `1px solid ${t.line}`, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap', flex: '0 0 auto' }}>{g}</span>)}
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: t.accent, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 5 }}>View full shortlist <span style={{ fontSize: 14 }}>▴</span></span>
          </div>
        )}
      </div>

      {/* ── RESULTS SHEET ── */}
      {resultsOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 15, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={() => setResultsOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(8,12,20,.34)' }} />
          <div style={{ position: 'relative', height: '84vh', background: t.bg, borderTop: `1px solid ${t.line}`, borderRadius: '16px 16px 0 0', boxShadow: '0 -16px 50px rgba(8,12,20,.22)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '16px 22px 13px', flex: '0 0 auto', borderBottom: `1px solid ${t.line}`, background: t.panel }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: t.tx }}>Shortlist</span>
                  <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: t.accent }}>{fmtN(result.shortlist.length)} targets</span>
                </div>
                <div style={{ fontSize: 11.5, color: t.faint, marginTop: 3 }}>Two-stage: eligible genes ranked by weighted-arithmetic composite (constraint = risk penalty, not a gate) · click a row for full evidence + pocket-level druggability (DoGSiteScorer protein tier)</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, fontSize: 10.5, color: t.faint }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: t.accent, opacity: .8 }} />passes gate</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: t.line }} />below / off</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, border: `1px dashed ${t.faint}` }} />no data</span>
                </div>
                <button onClick={() => setResultsOpen(false)} style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 8, color: t.dim, fontSize: 15, cursor: 'pointer' }}>✕</button>
              </div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px 24px' }}>
              <div style={{ minWidth: 820, border: `1px solid ${t.line}`, borderRadius: 11, overflow: 'hidden', background: t.panel }}>
                <div style={{ display: 'grid', gridTemplateColumns: `44px minmax(116px,150px) repeat(${HEADLINE_AXES.length},minmax(38px,1fr)) 56px 96px`, alignItems: 'center', background: t.panel2, borderBottom: `1px solid ${t.line}`, position: 'sticky', top: 0, zIndex: 1 }}>
                  <div style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: t.faint }}>#</div>
                  <div style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: t.faint }}>Gene</div>
                  {orderedHeadline.map(ax => (
                    <div key={ax.key} title={`${ax.label} — ${ax.source}`} style={{ padding: '9px 4px', display: 'flex', justifyContent: 'center', borderLeft: `1px solid ${t.line2}` }}>
                      <span style={{ width: 26, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, fontFamily: mono, fontSize: 10, fontWeight: 600, color: '#fff', background: ax.color }}>T{ax.tier}</span>
                    </div>
                  ))}
                  <div style={{ padding: '9px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: t.faint, textAlign: 'center', borderLeft: `1px solid ${t.line2}` }}>Compl.</div>
                  <div style={{ padding: '9px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: t.faint, textAlign: 'right', borderLeft: `1px solid ${t.line2}` }}>Composite</div>
                </div>

                {result.shortlist.length === 0 && <div style={{ padding: '48px 20px', textAlign: 'center', color: t.faint, fontSize: 13 }}>No genes are eligible — every gene lacks a disease link (OT / mutation / dependency). Loosen the nexus thresholds.</div>}

                {result.shortlist.slice(0, 300).map((s, idx) => {
                  const compPct = Math.round((s.composite ?? 0) * 100);
                  return (
                    <div key={s.f.gene_symbol} onClick={() => setDrawerGene(s.f.gene_symbol)} style={{ display: 'grid', gridTemplateColumns: `44px minmax(116px,150px) repeat(${HEADLINE_AXES.length},minmax(38px,1fr)) 56px 96px`, alignItems: 'center', borderTop: `1px solid ${t.line2}`, cursor: 'pointer', background: idx % 2 ? (isDark ? 'rgba(255,255,255,.015)' : 'rgba(0,0,0,.012)') : 'transparent' }}>
                      <div style={{ padding: '11px 10px', fontFamily: mono, fontSize: 13, fontWeight: 600, color: idx < 3 ? t.accent : t.dim }}>{idx + 1}</div>
                      <div style={{ padding: '11px 10px', minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: t.tx }}>{s.f.gene_symbol}</div>
                        <div style={{ fontSize: 10.5, color: t.faint }}>{s.completeness >= 0.999 ? 'complete evidence' : `${Math.round(s.completeness * 100)}% evidence`}</div>
                      </div>
                      {orderedHeadline.map(ax => {
                        const has = !!available[ax.key];
                        const v = ax.filter.kind === 'category' ? null : rawOf(ax.filter.field, s.f);
                        const cat = ax.filter.kind === 'category' ? categoryOf(ax.key, s.f) : null;
                        const present = ax.filter.kind === 'category' ? cat != null : v != null;
                        const on = !!hardOn[ax.key] && has;
                        const pass = on ? passesGate(ax, s.f) : true;
                        let chipStyle: React.CSSProperties;
                        let label: string;
                        if (!present || !has) { chipStyle = { color: t.faint, border: `1px dashed ${t.line}` }; label = '–'; }
                        else if (on && !pass) { chipStyle = { color: t.faint, background: t.line2, textDecoration: 'line-through' }; label = ax.filter.kind === 'category' ? '×' : String(v); }
                        else { chipStyle = { color: isDark ? '#fff' : ax.color, background: hexA(ax.color, isDark ? 0.30 : 0.16), border: `1px solid ${hexA(ax.color, 0.3)}` }; label = ax.filter.kind === 'category' ? '✓' : (v != null ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : '–'); }
                        return (
                          <div key={ax.key} style={{ padding: '8px 4px', display: 'flex', justifyContent: 'center', borderLeft: `1px solid ${t.line2}` }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 34, padding: '3px 5px', borderRadius: 6, fontFamily: mono, fontSize: 10.5, fontWeight: 600, ...chipStyle }}>{label}</span>
                          </div>
                        );
                      })}
                      <div style={{ padding: '11px 6px', textAlign: 'center', borderLeft: `1px solid ${t.line2}` }}>
                        <span style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 500, color: t.dim }}>{Math.round(s.completeness * 100)}%</span>
                      </div>
                      <div style={{ padding: '11px 10px', borderLeft: `1px solid ${t.line2}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7 }}>
                          <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: t.tx }}>{s.composite == null ? '—' : s.composite.toFixed(2)}</span>
                        </div>
                        <div style={{ marginTop: 5, height: 5, borderRadius: 3, background: t.line2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${compPct}%`, background: t.accent, borderRadius: 3 }} /></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ⓘ TIER EXPLAINER SIDEBAR ── */}
      {infoAx && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 18 }}>
          <div onClick={() => setInfoTier(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(8,12,20,.34)' }} />
          <aside style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 384, maxWidth: '92vw', background: t.panel, borderLeft: `1px solid ${t.line}`, boxShadow: '-16px 0 50px rgba(8,12,20,.22)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${t.line}`, background: hexA(infoAx.color, isDark ? 0.16 : 0.08) }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ flex: '0 0 auto', width: 42, height: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 10, color: '#fff', background: infoAx.color }}>
                  <span style={{ fontSize: 8, letterSpacing: '.12em', fontWeight: 700, opacity: .85 }}>TIER</span>
                  <span style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, lineHeight: 1, marginTop: 1 }}>{infoAx.tier}</span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: t.tx }}>{infoAx.label}</div>
                  <div style={{ fontSize: 11.5, color: t.dim, marginTop: 2, lineHeight: 1.35 }}>{infoAx.question}</div>
                </div>
                <button onClick={() => setInfoTier(null)} style={{ flex: '0 0 auto', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.panel, border: `1px solid ${t.line}`, borderRadius: 8, color: t.dim, fontSize: 15, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#fff', background: infoAx.color, padding: '3px 9px', borderRadius: 999 }}>{infoAx.source}</span>
                {[infoAx.type === 'hard' ? 'Hard gate' : 'Soft · ranks', infoAx.direction === 'con' ? 'Counts against' : 'Higher = better', available[infoAx.key] ? 'Data present' : 'Pending'].map(tag => (
                  <span key={tag} style={{ fontSize: 9.5, fontWeight: 600, color: t.dim, background: t.panel, border: `1px solid ${t.line}`, padding: '3px 9px', borderRadius: 999 }}>{tag}</span>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {([['What it measures', infoAx.measures], ['Where it comes from', infoAx.provenance], ['How the gate reads', filterReadsFor(infoAx)]] as [string, string | undefined][])
                .filter(([, body]) => !!body).map(([label, body]) => (
                  <div key={label} style={{ borderLeft: `3px solid ${infoAx.color}`, paddingLeft: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: t.faint, marginBottom: 5 }}>{label}</div>
                    <div style={{ fontSize: 12.5, color: t.tx, lineHeight: 1.55 }}>{body}</div>
                  </div>
                ))}
              {infoAx.caveat && (
                <div style={{ padding: '11px 12px', background: hexA('#d97706', isDark ? 0.16 : 0.10), border: `1px solid ${hexA('#d97706', 0.4)}`, borderRadius: 9, color: isDark ? '#f0c27a' : '#9a6207', fontSize: 12.5, lineHeight: 1.55 }}>
                  <span style={{ fontWeight: 700 }}>⚠ Caution · </span>{infoAx.caveat}
                </div>
              )}
              <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: `1px solid ${t.line}`, display: 'flex', gap: 18, fontSize: 11, color: t.faint }}>
                <span>Composite weight · <span style={{ fontFamily: mono, color: t.dim, fontWeight: 600 }}>{infoAx.weight.toFixed(1)}</span></span>
                <span>Evidence · <span style={{ color: t.dim, fontWeight: 600 }}>{infoAx.evidenceType ?? 'scores table'}</span></span>
              </div>
            </div>
          </aside>
        </div>
      )}

      <GeneDetailDrawer geneSymbol={drawerGene} diseaseName={diseaseName} theme={theme} onClose={() => setDrawerGene(null)} />
    </div>
  );
};

export default FunnelView;
