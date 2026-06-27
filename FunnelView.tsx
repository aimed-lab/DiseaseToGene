import React, { useState, useEffect, useMemo } from 'react';
import { fetchSnapshots, fetchSnapshotScores, fetchSnapshotEvidence, type RankingSnapshotMeta } from './supabase';
import { AXES, HARD_AXES, COMPOSITE_AXES, type AxisDef } from './evidenceRegistry';

// ── DB-backed Target Funnel — registry-driven tier ladder ─────────────────────
// Reads a stored snapshot's RANKING_SCORES + EVIDENCE from Oracle, builds one
// feature object per gene, then runs the ordered tier gates from evidenceRegistry:
// hard gates NARROW the universe (top → bottom), soft gates RANK the survivors.
// Every gate — its label, source, weight, direction and FILTER — comes from the
// registry, so adding a tier/filter is one entry there, not a funnel rewrite.
// Pure compute, no live API calls. Rule: missing data = unknown (null), never 0.

interface Props { theme?: 'dark' | 'light' }

type GeneFeature = {
  gene_symbol: string;
  rank: number | null;
  getScore: number | null;
  drugLabel: string | null;
  maxPhase: string | null;
  [axisKey: string]: number | string | null;   // genetic / mutation / dysregulation / …
};

const safeParse = (s: any) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };
const pctNum = (v: any) => { if (v == null) return null; const n = parseFloat(String(v)); return isFinite(n) ? n : null; };
const num = (v: any) => (v == null || isNaN(Number(v)) ? null : Number(v));
const csvCell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const valueOf = (key: string, f: GeneFeature): number | null => {
  const v = f[key];
  return typeof v === 'number' && isFinite(v) ? v : null;
};
const categoryOf = (key: string, f: GeneFeature): string | null =>
  key === 'druggability' ? (f.drugLabel as string | null) : null;

export const FunnelView: React.FC<Props> = ({ theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [snapshots, setSnapshots] = useState<RankingSnapshotMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [features, setFeatures] = useState<GeneFeature[]>([]);
  const [loading, setLoading] = useState(true);

  const [thresholds, setThresholds] = useState<Record<string, number>>(() => Object.fromEntries(HARD_AXES.map(a => [a.key, a.filter.default ?? 0])));
  const [cats, setCats] = useState<Record<string, string[]>>({});
  const [hardOn, setHardOn] = useState<Record<string, boolean>>(() => Object.fromEntries(HARD_AXES.map(a => [a.key, false])));
  const [requirePresent, setRequirePresent] = useState<Record<string, boolean>>({});
  const [openTier, setOpenTier] = useState<string | null>(null);
  const [pins, setPins] = useState<Record<string, 'pin' | 'drop'>>({});
  const [expandedGene, setExpandedGene] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchSnapshots().then(s => { if (!active) return; setSnapshots(s); if (s.length) setSelectedId(String(s[0].id)); setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setFeatures([]); return; }
    let active = true; setLoading(true); setExpandedGene(null);
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
        const dys = ev[g]?.expression_tvn, dep = ev[g]?.dependency, saf = ev[g]?.safety;   // contract-aware (axis first)
        return {
          gene_symbol: g,
          rank: num(r.rank),
          getScore: num(r.get_score),
          genetic: num(r.genetic_score),
          mutation: mut ? num(mut.axis ?? mut.mutationFrequency) : null,
          dysregulation: dys ? num(dys.axis ?? (dys.log2fc != null ? Math.abs(dys.log2fc) : null)) : null,
          dependency: dep ? num(dep.axis ?? dep.dependencyScore ?? (dep.mean != null ? -dep.mean : null)) : null,
          druggability: num(r.target_score),
          safety: saf ? num(saf.axis ?? saf.safetyConcern ?? saf.pli) : null,
          clinical: clin ? num(clin.axis ?? clin.trial_count) : null,
          literature: lit ? (pctNum(lit.axis ?? lit.signal_velocity) ?? num(lit.recent_paper_count)) : null,
          tissue: num(r.tau_tissue),
          drugLabel: drug ? (drug.display ?? drug.label ?? null) : null,
          maxPhase: clin ? (clin.max_phase ?? null) : null,
        };
      });
      setFeatures(feats); setLoading(false);
    });
    return () => { active = false; };
  }, [selectedId]);

  const available = useMemo(() => {
    const a: Record<string, boolean> = {};
    for (const ax of AXES) a[ax.key] = features.some(f => ax.filter.kind === 'category' ? categoryOf(ax.key, f) != null : valueOf(ax.key, f) != null);
    return a;
  }, [features]);

  // does a gene pass one hard gate?
  const passesGate = (ax: AxisDef, f: GeneFeature): boolean => {
    if (!hardOn[ax.key] || !available[ax.key]) return true;
    if (ax.filter.kind === 'category') {
      const sel = cats[ax.key] || [];
      if (sel.length === 0) return true;
      const c = categoryOf(ax.key, f);
      if (c == null) return !requirePresent[ax.key];
      return sel.includes(c);
    }
    const v = valueOf(ax.key, f);
    if (v == null) return !requirePresent[ax.key];
    const th = thresholds[ax.key] ?? ax.filter.default ?? 0;
    return ax.filter.op === '<=' ? v <= th : v >= th;
  };

  const result = useMemo(() => {
    const total = features.length;
    let current = features.slice();
    const tierCounts: Record<string, number> = {};
    for (const ax of HARD_AXES) {
      current = current.filter(f => passesGate(ax, f));
      tierCounts[ax.key] = current.length;
    }

    // rank-normalize each axis across survivors; con axes are inverted so the
    // composite is always "higher = better target".
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
        const xv = Math.max(x, 1e-3);
        wsum += ax.weight; whx += ax.weight / xv;
      }
      const composite = wsum > 0 ? wsum / whx : null;
      const completeness = COMPOSITE_AXES.length ? present / COMPOSITE_AXES.length : 0;
      return { f, composite, completeness, axisScores };
    });

    const dropped = new Set(Object.entries(pins).filter(([, v]) => v === 'drop').map(([k]) => k));
    const shortlist = scored.filter(s => !dropped.has(s.f.gene_symbol));
    shortlist.sort((a, b) => {
      const ap = pins[a.f.gene_symbol] === 'pin' ? 1 : 0, bp = pins[b.f.gene_symbol] === 'pin' ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (b.composite ?? -1) - (a.composite ?? -1);
    });
    return { total, tierCounts, shortlist };
  }, [features, thresholds, cats, hardOn, requirePresent, pins, available]);

  // theme tokens
  const bg = isDark ? '#0b1220' : '#ffffff', border = isDark ? '#1e293b' : '#e2e8f0';
  const ink = isDark ? '#e2e8f0' : '#0f172a', muted = isDark ? '#64748b' : '#94a3b8';
  const cardBg = isDark ? '#0f172a' : '#fbfdff', track = isDark ? '#1e293b' : '#eef2f7';
  const accent = '#7c3aed', green = '#16a34a';
  const total = result.total || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const tint = (hex: string) => hex + (isDark ? '22' : '14');
  const activeGates = HARD_AXES.filter(a => hardOn[a.key] && available[a.key]).length;
  const pendingGates = AXES.filter(a => a.headline && !available[a.key]).length;

  const exportCsv = () => {
    const cols = ['rank', 'gene', 'composite', 'get_score', 'completeness', ...COMPOSITE_AXES.map(a => a.key), 'drug_label'];
    const lines = [cols.join(',')];
    result.shortlist.forEach((s, i) => {
      const f = s.f;
      lines.push([i + 1, f.gene_symbol, s.composite?.toFixed(4) ?? '', f.getScore ?? '', Math.round(s.completeness * 100) + '%',
        ...COMPOSITE_AXES.map(a => valueOf(a.key, f) ?? ''), f.drugLabel ?? ''
      ].map(csvCell).join(','));
    });
    const snap = snapshots.find(s => String(s.id) === selectedId);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `funnel_shortlist_${(snap?.disease_name || 'snapshot').replace(/\s+/g, '_')}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const wrap: React.CSSProperties = { height: '100%', overflow: 'auto', background: bg, color: ink, border: `1px solid ${border}`, borderRadius: 12 };
  const chip = (c: string, fill = false): React.CSSProperties => ({ fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999, color: fill ? '#fff' : c, background: fill ? c : tint(c), whiteSpace: 'nowrap' });

  // one tier row: count gutter (left) + tier card
  const TierRow = (ax: AxisDef) => {
    const on = !!hardOn[ax.key], has = !!available[ax.key];
    const count = result.tierCounts[ax.key] ?? result.total;
    const active = on && has;
    const isOpen = openTier === ax.key;
    return (
      <div key={ax.key} style={{ display: 'flex', gap: 10, marginBottom: 7 }}>
        {/* count gutter */}
        <div style={{ width: 62, flexShrink: 0, textAlign: 'right', paddingTop: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: active ? ax.color : muted }}>{has ? count : '—'}</div>
          <div style={{ fontSize: 9, color: muted }}>{active ? `${pct(count)}%` : ''}</div>
        </div>
        {/* tier card */}
        <div style={{ flex: 1, border: `1px solid ${active ? ax.color : border}`, borderRadius: 12, background: has ? cardBg : (isDark ? '#0c1322' : '#f8fafc'), opacity: has ? 1 : 0.72 }}>
          <div onClick={() => has && setOpenTier(o => o === ax.key ? null : ax.key)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', cursor: has ? 'pointer' : 'default' }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: ax.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 10, flexShrink: 0 }}>T{ax.tier}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: ink }}>{ax.label}</div>
              <div style={{ fontSize: 10.5, color: muted, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ax.question}</div>
            </div>
            <span style={chip(ax.type === 'hard' ? '#334155' : ax.color)}>{ax.type}</span>
            {!has && <span style={chip('#b45309', true)}>pending</span>}
            {has && <span style={{ color: muted, fontSize: 11, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}>▾</span>}
          </div>
          {/* narrowing bar */}
          <div style={{ padding: '0 11px 9px' }}>
            <div style={{ height: 7, borderRadius: 999, background: track, overflow: 'hidden' }}>
              <div style={{ width: `${has ? Math.max(3, pct(count)) : 100}%`, height: '100%', background: active ? ax.color : track, transition: 'width 140ms' }} />
            </div>
          </div>
          {/* expandable filter panel */}
          {isOpen && has && (
            <div style={{ borderTop: `1px solid ${border}`, padding: '10px 11px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: muted, cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={e => setHardOn(p => ({ ...p, [ax.key]: e.target.checked }))} /> enable gate
                </label>
                <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: ax.color, textTransform: 'uppercase' }}>{ax.source}</span>
              </div>
              {ax.filter.kind === 'range' && (
                <div style={{ opacity: on ? 1 : 0.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: muted, marginBottom: 2 }}>
                    <span>keep {ax.filter.op === '<=' ? '≤' : '≥'} threshold</span>
                    <span style={{ fontFamily: 'monospace', color: on ? ax.color : muted }}>{(thresholds[ax.key] ?? ax.filter.default ?? 0)}{ax.filter.unit ? ` ${ax.filter.unit}` : ''}</span>
                  </div>
                  <input type="range" min={ax.filter.min ?? 0} max={ax.filter.max ?? 1} step={ax.filter.step ?? 0.01} value={thresholds[ax.key] ?? ax.filter.default ?? 0} disabled={!on}
                    onChange={e => setThresholds(p => ({ ...p, [ax.key]: parseFloat(e.target.value) }))} style={{ width: '100%', accentColor: ax.color }} />
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
                          <input type="checkbox" checked={sel} disabled={!on} onChange={() => setCats(p => { const cur = new Set(p[ax.key] || []); cur.has(c) ? cur.delete(c) : cur.add(c); return { ...p, [ax.key]: [...cur] }; })} />
                          {c}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {ax.filter.kind !== 'category' && (
                <label style={{ fontSize: 10, color: muted, display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                  <input type="checkbox" checked={!!requirePresent[ax.key]} disabled={!on} onChange={e => setRequirePresent(p => ({ ...p, [ax.key]: e.target.checked }))} />
                  require this axis present (drop unknowns)
                </label>
              )}
            </div>
          )}
          {!has && <div style={{ padding: '0 11px 9px', fontSize: 10, color: muted }}>Stored as <code>{ax.evidenceType}</code> evidence once harvested — this gate activates automatically.</div>}
        </div>
      </div>
    );
  };

  return (
    <div style={wrap}>
      {/* ── INFO BAR (top) ── */}
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${border}`, position: 'sticky', top: 0, background: bg, zIndex: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Target Funnel</div>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ background: cardBg, color: ink, border: `1px solid ${border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
            {snapshots.length === 0 && <option value="">No stored snapshots</option>}
            {snapshots.map(s => <option key={s.id} value={String(s.id)}>{s.disease_name} · Tier {s.version} · {s.gene_count ?? '?'} genes · {(s.created_at || '').slice(0, 10)}</option>)}
          </select>
          <button onClick={exportCsv} disabled={!result.shortlist.length} style={{ marginLeft: 'auto', border: 'none', background: accent, color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Export CSV</button>
        </div>
        {/* summary stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
          <Stat label="Universe" value={String(result.total)} color={ink} muted={muted} />
          <span style={{ color: muted }}>→</span>
          <Stat label="Shortlist" value={String(result.shortlist.length)} color={green} muted={muted} />
          <Stat label="Active gates" value={String(activeGates)} color={accent} muted={muted} />
          <Stat label="Pending axes" value={String(pendingGates)} color="#b45309" muted={muted} />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, color: muted, fontStyle: 'italic' }}>Loading snapshot from Oracle…</div>
      ) : !selectedId ? (
        <div style={{ padding: 40, color: muted, fontStyle: 'italic' }}>No stored snapshots yet — run a harvest job first.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '560px 1fr', gap: 0 }}>
          {/* LEFT — the tier funnel (counts in the gutter, tiers T0 → down) */}
          <div style={{ padding: '16px 18px', borderRight: `1px solid ${border}` }}>
            {/* T0 universe */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 7 }}>
              <div style={{ width: 62, flexShrink: 0, textAlign: 'right', paddingTop: 6 }}>
                <div style={{ fontWeight: 900, fontSize: 15, color: ink }}>{result.total}</div>
                <div style={{ fontSize: 9, color: muted }}>100%</div>
              </div>
              <div style={{ flex: 1, border: `1px solid ${border}`, borderRadius: 12, background: track, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: '#334155', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 10 }}>T0</div>
                  <div><div style={{ fontWeight: 800, fontSize: 13 }}>Gene universe</div><div style={{ fontSize: 10.5, color: muted }}>full Open Targets set — no early triage</div></div>
                </div>
              </div>
            </div>

            {HARD_AXES.map(TierRow)}
            {/* soft headline gates (rank only) */}
            {AXES.filter(a => a.type === 'soft' && a.headline).map(TierRow)}

            {/* composite */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <div style={{ width: 62, flexShrink: 0, textAlign: 'right', paddingTop: 8 }}>
                <div style={{ fontWeight: 900, fontSize: 15, color: green }}>{result.shortlist.length}</div>
              </div>
              <div style={{ flex: 1, border: `1px solid ${accent}`, borderRadius: 12, background: tint(accent), padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 10 }}>T9</div>
                  <div><div style={{ fontWeight: 800, fontSize: 13 }}>Composite ranking</div><div style={{ fontSize: 10.5, color: muted }}>weighted-harmonic of the rank-normalized axes</div></div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — ranked shortlist */}
          <div style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Shortlist · ranked survivors</span>
              <span style={{ fontSize: 11, color: green, fontWeight: 800 }}>{result.shortlist.length} targets</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {result.shortlist.slice(0, 60).map((s, i) => {
                const f = s.f; const isPin = pins[f.gene_symbol] === 'pin';
                return (
                  <div key={f.gene_symbol} style={{ border: `1px solid ${isPin ? accent : border}`, borderRadius: 10, background: cardBg }}>
                    <div onClick={() => setExpandedGene(x => x === f.gene_symbol ? null : f.gene_symbol)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', cursor: 'pointer' }}>
                      <span style={{ width: 22, textAlign: 'right', color: muted, fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                      <span style={{ fontWeight: 800, color: accent, minWidth: 66 }}>{f.gene_symbol}</span>
                      <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {COMPOSITE_AXES.map(ax => {
                          const v = s.axisScores[ax.key];
                          return <span key={ax.key} title={`${ax.label}${available[ax.key] ? '' : ' (pending)'}`} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 999, background: v == null ? track : tint(ax.color), color: v == null ? muted : ax.color, fontWeight: 700 }}>{ax.key.slice(0, 3)} {v == null ? '–' : v.toFixed(2)}</span>;
                        })}
                      </div>
                      <span title="data completeness" style={{ fontSize: 10, color: muted }}>{Math.round(s.completeness * 100)}%</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 12, color: green, minWidth: 46, textAlign: 'right' }}>{s.composite == null ? '—' : s.composite.toFixed(3)}</span>
                      <button onClick={(e) => { e.stopPropagation(); setPins(p => ({ ...p, [f.gene_symbol]: isPin ? undefined as any : 'pin' })); }} title="pin" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: isPin ? accent : muted, fontSize: 13 }}>📌</button>
                      <button onClick={(e) => { e.stopPropagation(); setPins(p => ({ ...p, [f.gene_symbol]: 'drop' })); }} title="drop" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: muted, fontSize: 13 }}>✕</button>
                    </div>
                    {expandedGene === f.gene_symbol && (
                      <div style={{ padding: '8px 12px', borderTop: `1px solid ${border}`, fontSize: 11, color: ink }}>
                        <div style={{ color: muted, marginBottom: 4 }}>GET {f.getScore?.toFixed(3) ?? '—'} · completeness {Math.round(s.completeness * 100)}% · {f.drugLabel || 'druggability unknown'}{f.maxPhase ? ` · max phase ${f.maxPhase}` : ''}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                          {COMPOSITE_AXES.map(ax => {
                            const raw = valueOf(ax.key, f); const nrm = s.axisScores[ax.key];
                            return <div key={ax.key}><span style={{ color: ax.color, fontWeight: 700 }}>{ax.label}: </span>{raw == null ? <em style={{ color: muted }}>{available[ax.key] ? 'unknown' : 'pending'}</em> : `${raw}  (norm ${nrm == null ? '—' : nrm.toFixed(2)})`}</div>;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {Object.values(pins).includes('drop') && (
              <button onClick={() => setPins({})} style={{ marginTop: 8, fontSize: 10, color: muted, background: 'none', border: `1px solid ${border}`, borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>Reset pins/drops</button>
            )}
            <div style={{ marginTop: 12, fontSize: 10.5, color: muted, borderTop: `1px solid ${border}`, paddingTop: 10, lineHeight: 1.5 }}>
              Click a tier on the left to open its filters. Hard gates narrow the universe; survivors rank by a weighted-harmonic composite (missing axes excluded, never zero; safety inverted so high constraint lowers rank). Gates marked <strong>pending</strong> activate once their evidence is stored.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string; muted: string }> = ({ label, value, color, muted }) => (
  <div>
    <span style={{ fontWeight: 900, fontSize: 18, color }}>{value}</span>
    <span style={{ fontSize: 10, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginLeft: 6 }}>{label}</span>
  </div>
);

export default FunnelView;
