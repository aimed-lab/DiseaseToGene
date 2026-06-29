import React, { useState, useEffect, useMemo } from 'react';
import { fetchSnapshots, fetchSnapshotScores, fetchSnapshotEvidence, type RankingSnapshotMeta } from './supabase';
import { AXES, HEADLINE_AXES, HARD_AXES, COMPOSITE_AXES, type AxisDef } from './evidenceRegistry';
import GeneDetailDrawer from './GeneDetailDrawer';

// ── DB-backed Target Funnel — vertical tier pipeline ──────────────────────────
// Reads a stored snapshot from Oracle, then runs the registry's tier gates as a
// step-ordered funnel (T0 at top → narrows downward). Tier NAMES sit on the left,
// COUNTS on the right. Hard gates narrow; soft gates rank. Filters act on each
// axis's RAW value in real units (log2FC, LOEUF, Chronos…); the normalized `axis`
// is used only for ranking. The gene list is on demand — click "View genes", then
// click any gene to open its full drill-down (works for snapshot genes too).
// Pure compute, no live API calls in the funnel itself.

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

export const FunnelView: React.FC<Props> = ({ theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [snapshots, setSnapshots] = useState<RankingSnapshotMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [features, setFeatures] = useState<GeneFeature[]>([]);
  const [diseaseName, setDiseaseName] = useState('');
  const [loading, setLoading] = useState(true);

  const [thresholds, setThresholds] = useState<Record<string, number>>(() => Object.fromEntries(HARD_AXES.map(a => [a.key, a.filter.default ?? 0])));
  const [cats, setCats] = useState<Record<string, string[]>>({});
  const [hardOn, setHardOn] = useState<Record<string, boolean>>(() => Object.fromEntries(HARD_AXES.map(a => [a.key, false])));
  const [requirePresent, setRequirePresent] = useState<Record<string, boolean>>({});
  const [openTier, setOpenTier] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [drawerGene, setDrawerGene] = useState<string | null>(null);

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
        const genetic = num(r.genetic_score);
        const frequency = mut ? num(mut.mutationFrequency) : null;
        const log2fc = dys ? num(dys.log2fc) : null;
        const chronos = dep ? num(dep.mean) : null;
        const loeuf = saf ? num(saf.loeuf) : null;
        const trial_count = clin ? num(clin.trial_count) : null;
        const velocity = lit ? num(lit.signal_velocity ?? lit.recent_paper_count) : null;
        return {
          gene_symbol: g,
          rank: num(r.rank),
          getScore: num(r.get_score),
          drugLabel: drug ? (drug.label ?? null) : null,
          axis: {
            genetic,
            mutation: mut ? num(mut.axis ?? mut.mutationFrequency) : null,
            dysregulation: dys ? num(dys.axis ?? (log2fc != null ? Math.abs(log2fc) / 4 : null)) : null,
            dependency: dep ? num(dep.axis ?? (chronos != null ? -chronos : null)) : null,
            druggability: num(r.target_score),
            safety: saf ? num(saf.axis ?? saf.pli) : null,
            clinical: clin ? num(clin.axis ?? clin.trial_count) : null,
            literature: lit ? num(lit.axis ?? lit.signal_velocity ?? lit.recent_paper_count) : null,
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

  const result = useMemo(() => {
    const total = features.length;
    let current = features.slice();
    const tierCounts: Record<string, number> = {};
    for (const ax of HARD_AXES) { current = current.filter(f => passesGate(ax, f)); tierCounts[ax.key] = current.length; }

    const norm: Record<string, (v: number | null) => number | null> = {};
    for (const ax of COMPOSITE_AXES) {
      const vals = current.map(f => valueOf(ax.key, f)).filter((v): v is number => v != null).sort((a, b) => a - b);
      const n = vals.length;
      norm[ax.key] = (v) => {
        if (v == null || n === 0) return null;
        let lo = 0, eq = 0;
        for (const x of vals) { if (x < v) lo++; else if (x === v) eq++; }
        const p = (lo + eq * 0.5) / n;
        return ax.direction === 'con' ? 1 - p : p;
      };
    }
    const scored = current.map(f => {
      const axisScores: Record<string, number | null> = {};
      let wsum = 0, whx = 0, present = 0;
      for (const ax of COMPOSITE_AXES) {
        const x = norm[ax.key](valueOf(ax.key, f));
        axisScores[ax.key] = x;
        if (x == null) continue;
        present++;
        wsum += ax.weight; whx += ax.weight / Math.max(x, 1e-3);
      }
      return { f, composite: wsum > 0 ? wsum / whx : null, completeness: COMPOSITE_AXES.length ? present / COMPOSITE_AXES.length : 0, axisScores };
    });
    scored.sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
    return { total, tierCounts, shortlist: scored };
  }, [features, thresholds, cats, hardOn, requirePresent, available]);

  // theme tokens
  const bg = isDark ? '#0b1220' : '#ffffff', border = isDark ? '#1e293b' : '#e2e8f0';
  const ink = isDark ? '#e2e8f0' : '#0f172a', muted = isDark ? '#64748b' : '#94a3b8';
  const cardBg = isDark ? '#0f172a' : '#fbfdff', track = isDark ? '#1e293b' : '#eef2f7';
  const accent = '#7c3aed', green = '#16a34a';
  const total = result.total || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const tint = (hex: string) => hex + (isDark ? '22' : '14');
  const activeGates = HARD_AXES.filter(a => hardOn[a.key] && available[a.key]).length;
  const pendingGates = HEADLINE_AXES.filter(a => !available[a.key]).length;

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

  const wrap: React.CSSProperties = { height: '100%', overflow: 'auto', background: bg, color: ink, border: `1px solid ${border}`, borderRadius: 12, position: 'relative' };
  const chip = (c: string, fill = false): React.CSSProperties => ({ fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999, color: fill ? '#fff' : c, background: fill ? c : tint(c), whiteSpace: 'nowrap' });

  // a single step in the vertical funnel — NAME on the left, COUNT on the right
  const StepRow = (ax: AxisDef) => {
    const on = !!hardOn[ax.key], has = !!available[ax.key];
    const count = result.tierCounts[ax.key] ?? result.total;
    const active = on && has && ax.type === 'hard';
    const isOpen = openTier === ax.key;
    const width = has ? Math.max(14, pct(count)) : 100;
    return (
      <div key={ax.key}>
        <div style={{ border: `1px solid ${active ? ax.color : border}`, borderRadius: 12, background: has ? cardBg : (isDark ? '#0c1322' : '#f8fafc'), opacity: has ? 1 : 0.74, width: `${width}%`, minWidth: 280, marginInline: 'auto', transition: 'width 160ms' }}>
          <div onClick={() => has && setOpenTier(o => o === ax.key ? null : ax.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: has ? 'pointer' : 'default' }}>
            {/* LEFT: tier name */}
            <div style={{ width: 28, height: 28, borderRadius: 7, background: ax.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 10, flexShrink: 0 }}>T{ax.tier}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: ink }}>{ax.label}</span>
                <span style={chip(ax.type === 'hard' ? '#334155' : ax.color)}>{ax.type}</span>
                {!has && <span style={chip('#b45309', true)}>pending</span>}
              </div>
              <div style={{ fontSize: 10.5, color: muted, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ax.question}</div>
            </div>
            {/* RIGHT: count */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: active ? ax.color : (has ? ink : muted) }}>{has ? count.toLocaleString() : '—'}</div>
              <div style={{ fontSize: 9, color: muted }}>{has ? `${pct(count)}%` : 'awaiting data'}</div>
            </div>
            {has && <span style={{ color: muted, fontSize: 11, transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>}
          </div>
          {isOpen && has && (
            <div style={{ borderTop: `1px solid ${border}`, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: muted, cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={e => setHardOn(p => ({ ...p, [ax.key]: e.target.checked }))} /> enable gate
                </label>
                <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: ax.color, textTransform: 'uppercase' }}>{ax.source}</span>
              </div>
              {ax.filter.kind === 'range' && (
                <div style={{ opacity: on ? 1 : 0.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: muted, marginBottom: 2 }}>
                    <span>keep genes with {ax.filter.field} {ax.filter.op === '<=' ? '≤' : '≥'}</span>
                    <span style={{ fontFamily: 'monospace', color: on ? ax.color : muted }}>{(thresholds[ax.key] ?? ax.filter.default ?? 0)} {ax.filter.unit}</span>
                  </div>
                  <input type="range" min={ax.filter.min ?? 0} max={ax.filter.max ?? 1} step={ax.filter.step ?? 0.01} value={thresholds[ax.key] ?? ax.filter.default ?? 0} disabled={!on}
                    onChange={e => setThresholds(p => ({ ...p, [ax.key]: parseFloat(e.target.value) }))} style={{ width: '100%', accentColor: ax.color }} />
                  <label style={{ fontSize: 10, color: muted, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <input type="checkbox" checked={!!requirePresent[ax.key]} disabled={!on} onChange={e => setRequirePresent(p => ({ ...p, [ax.key]: e.target.checked }))} /> drop genes with no {ax.filter.field} value
                  </label>
                </div>
              )}
              {ax.filter.kind === 'category' && (
                <div style={{ opacity: on ? 1 : 0.5 }}>
                  <div style={{ fontSize: 10.5, color: muted, marginBottom: 4 }}>keep only (none checked = keep all)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(ax.filter.categories || []).map(c => {
                      const sel = (cats[ax.key] || []).includes(c);
                      return (
                        <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: ink, background: sel ? tint(ax.color) : track, borderRadius: 999, padding: '3px 8px', cursor: on ? 'pointer' : 'default' }}>
                          <input type="checkbox" checked={sel} disabled={!on} onChange={() => setCats(p => { const cur = new Set(p[ax.key] || []); cur.has(c) ? cur.delete(c) : cur.add(c); return { ...p, [ax.key]: [...cur] }; })} /> {c}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'center', color: muted, fontSize: 12, lineHeight: '16px' }}>▼</div>
      </div>
    );
  };

  const orderedHeadline = [...HEADLINE_AXES].sort((a, b) => a.tier - b.tier);

  return (
    <div style={wrap}>
      {/* ── INFO BAR (top) ── */}
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${border}`, position: 'sticky', top: 0, background: bg, zIndex: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Target Funnel</div>
          <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setShowList(false); }} style={{ background: cardBg, color: ink, border: `1px solid ${border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
            {snapshots.length === 0 && <option value="">No stored snapshots</option>}
            {snapshots.map(s => <option key={s.id} value={String(s.id)}>{s.disease_name} · Tier {s.version} · {s.gene_count ?? '?'} genes · {(s.created_at || '').slice(0, 10)}</option>)}
          </select>
          <button onClick={() => setShowList(v => !v)} disabled={!result.shortlist.length} style={{ marginLeft: 'auto', border: `1px solid ${border}`, background: showList ? accent : 'transparent', color: showList ? '#fff' : ink, borderRadius: 8, padding: '7px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>{showList ? 'Hide genes' : `View genes (${result.shortlist.length})`}</button>
          <button onClick={exportCsv} disabled={!result.shortlist.length} style={{ border: 'none', background: accent, color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Export</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
          <Stat label="Universe" value={result.total.toLocaleString()} color={ink} muted={muted} />
          <span style={{ color: muted }}>→</span>
          <Stat label="Shortlist" value={result.shortlist.length.toLocaleString()} color={green} muted={muted} />
          <Stat label="Active gates" value={String(activeGates)} color={accent} muted={muted} />
          <Stat label="Pending axes" value={String(pendingGates)} color="#b45309" muted={muted} />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, color: muted, fontStyle: 'italic' }}>Loading snapshot from Oracle…</div>
      ) : !selectedId ? (
        <div style={{ padding: 40, color: muted, fontStyle: 'italic' }}>No stored snapshots yet — run a harvest job first.</div>
      ) : (
        <div style={{ padding: '18px', maxWidth: 760, margin: '0 auto' }}>
          {/* T0 universe */}
          <div>
            <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: track, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: '#334155', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 10 }}>T0</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 13 }}>Gene universe</div><div style={{ fontSize: 10.5, color: muted }}>full Open Targets set — no early triage</div></div>
              <div style={{ fontWeight: 900, fontSize: 16, color: ink }}>{result.total.toLocaleString()}</div>
            </div>
            <div style={{ textAlign: 'center', color: muted, fontSize: 12, lineHeight: '16px' }}>▼</div>
          </div>

          {orderedHeadline.map(StepRow)}

          {/* composite */}
          <div style={{ border: `1px solid ${accent}`, borderRadius: 12, background: tint(accent), padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, width: '70%', minWidth: 280, marginInline: 'auto' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 10 }}>T9</div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 13 }}>Composite ranking</div><div style={{ fontSize: 10.5, color: muted }}>weighted-harmonic of the rank-normalized axes</div></div>
            <button onClick={() => setShowList(true)} style={{ border: 'none', background: green, color: '#fff', borderRadius: 999, padding: '5px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>{result.shortlist.length.toLocaleString()} →</button>
          </div>
        </div>
      )}

      {/* ── on-demand gene list ── */}
      {showList && !loading && selectedId && (
        <div style={{ borderTop: `1px solid ${border}`, padding: '14px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Shortlist · click a gene for full detail</span>
            <span style={{ fontSize: 11, color: green, fontWeight: 800 }}>{result.shortlist.length} genes</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {result.shortlist.slice(0, 100).map((s, i) => (
              <div key={s.f.gene_symbol} onClick={() => setDrawerGene(s.f.gene_symbol)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', border: `1px solid ${border}`, borderRadius: 9, background: cardBg, cursor: 'pointer' }}>
                <span style={{ width: 26, textAlign: 'right', color: muted, fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                <span style={{ fontWeight: 800, color: accent, minWidth: 66 }}>{s.f.gene_symbol}</span>
                <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {COMPOSITE_AXES.map(ax => { const v = s.axisScores[ax.key]; return <span key={ax.key} title={`${ax.label}${available[ax.key] ? '' : ' (pending)'}`} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 999, background: v == null ? track : tint(ax.color), color: v == null ? muted : ax.color, fontWeight: 700 }}>{ax.key.slice(0, 3)} {v == null ? '–' : v.toFixed(2)}</span>; })}
                </div>
                <span style={{ fontSize: 10, color: muted }}>{Math.round(s.completeness * 100)}%</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 12, color: green, minWidth: 46, textAlign: 'right' }}>{s.composite == null ? '—' : s.composite.toFixed(3)}</span>
                <span style={{ color: muted, fontSize: 12 }}>›</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <GeneDetailDrawer geneSymbol={drawerGene} diseaseName={diseaseName} theme={theme} onClose={() => setDrawerGene(null)} />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string; muted: string }> = ({ label, value, color, muted }) => (
  <div><span style={{ fontWeight: 900, fontSize: 18, color }}>{value}</span><span style={{ fontSize: 10, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginLeft: 6 }}>{label}</span></div>
);

export default FunnelView;
