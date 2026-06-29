import React, { useState, useEffect, useMemo } from 'react';
import { fetchSnapshots, fetchSnapshotScores, fetchSnapshotEvidence, type RankingSnapshotMeta } from './supabase';
import GeneDetailDrawer from './GeneDetailDrawer';

interface Props {
  theme?: 'dark' | 'light';
  onSelectGene?: (symbol: string) => void;   // optional; rankings expands inline instead of navigating
}

// Treat "empty" evidence summaries as absent (no real data) so the matrix ✓ means
// genuine evidence. Robust for already-stored data; new harvests don't store empties.
const isMeaningful = (type: string, text?: string): boolean => {
  if (!text) return false;
  const t = text.toLowerCase();
  if (type === 'clinical') return !/^0 trials/.test(t);
  if (type === 'literature') return !/^0 papers/.test(t);
  if (type === 'druggability') return !t.includes('no drug data found');
  if (type === 'mutation') return !/^0\//.test(t);
  return true;
};

const COLS = [
  { key: 'open_targets', label: 'Open Targets', kind: 'ot' as const },
  { key: 'clinical', label: 'Clinical', kind: 'ev' as const },
  { key: 'literature', label: 'Literature', kind: 'ev' as const },
  { key: 'druggability', label: 'ChEMBL', kind: 'ev' as const },
  { key: 'mutation', label: 'Mutation', kind: 'ev' as const },
];

export const RankingsView: React.FC<Props> = ({ theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [snapshots, setSnapshots] = useState<RankingSnapshotMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [scores, setScores] = useState<any[]>([]);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'dashboard' | 'matrix'>('dashboard');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drawerGene, setDrawerGene] = useState<string | null>(null);
  const diseaseName = snapshots.find((s) => String(s.id) === selectedId)?.disease_name || '';

  useEffect(() => {
    let active = true;
    fetchSnapshots().then((s) => {
      if (!active) return;
      setSnapshots(s);
      if (s.length) setSelectedId(String(s[0].id));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setScores([]); setEvidence([]); return; }
    let active = true;
    setLoading(true); setExpanded(null);
    Promise.all([fetchSnapshotScores(selectedId), fetchSnapshotEvidence(selectedId)]).then(([sc, ev]) => {
      if (!active) return;
      setScores(sc); setEvidence(ev); setLoading(false);
    });
    return () => { active = false; };
  }, [selectedId]);

  // gene -> { evidence_type -> value_text }, keeping only meaningful evidence
  const byGene = useMemo(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const e of evidence) {
      const g = e.gene_symbol; if (!g) continue;
      if (!isMeaningful(e.evidence_type, e.value_text)) continue;
      (m[g] ||= {})[e.evidence_type] = e.value_text || '';
    }
    return m;
  }, [evidence]);

  const bg = isDark ? '#0b1220' : '#ffffff';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const ink = isDark ? '#e2e8f0' : '#0f172a';
  const muted = isDark ? '#64748b' : '#94a3b8';
  const headBg = isDark ? '#0f172a' : '#f8fafc';
  const detailBg = isDark ? '#0e1626' : '#f5f8ff';
  const accent = '#2563eb';
  const green = '#16a34a';
  const num = (v: any) => (v == null || isNaN(Number(v)) ? '—' : Number(v).toFixed(3));

  const wrap: React.CSSProperties = { height: '100%', overflow: 'auto', background: bg, color: ink, border: `1px solid ${border}`, borderRadius: 12 };
  const th: React.CSSProperties = { position: 'sticky', top: 0, background: headBg, padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '7px 10px', borderBottom: `1px solid ${border}`, fontSize: 12 };

  // The stored evidence detail for one gene (instant — no live fetch)
  const renderDetail = (g: string, colSpan: number) => {
    const ev = byGene[g] || {};
    const items: { label: string; text: string }[] = [];
    if (ev.clinical) items.push({ label: 'Clinical (ClinicalTrials.gov)', text: ev.clinical });
    if (ev.literature) items.push({ label: 'Literature (PubMed/EuropePMC/PubTator)', text: ev.literature });
    if (ev.druggability) items.push({ label: 'Druggability (ChEMBL)', text: ev.druggability });
    if (ev.mutation) items.push({ label: 'Mutation (cBioPortal)', text: ev.mutation });
    return (
      <tr>
        <td colSpan={colSpan} style={{ padding: '10px 16px', background: detailBg, borderBottom: `1px solid ${border}` }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: accent, marginBottom: 6 }}>{g} — stored evidence</div>
          {items.length === 0 ? (
            <div style={{ fontSize: 11, color: muted, fontStyle: 'italic' }}>Only Open Targets scores stored for this gene (no clinical/literature/ChEMBL/mutation evidence).</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.map((it) => (
                <div key={it.label} style={{ fontSize: 11.5, color: ink }}>
                  <span style={{ color: muted, fontWeight: 700 }}>{it.label}: </span>{it.text}
                </div>
              ))}
            </div>
          )}
        </td>
      </tr>
    );
  };

  const toggle = (g: string) => setExpanded((cur) => (cur === g ? null : g));

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${border}`, position: 'sticky', top: 0, background: bg, zIndex: 2, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Rankings <span style={{ color: muted, fontWeight: 600, fontSize: 12 }}>· from Oracle store</span></div>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ background: headBg, color: ink, border: `1px solid ${border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
          {snapshots.length === 0 && <option value="">No stored snapshots yet</option>}
          {snapshots.map((s) => (
            <option key={s.id} value={String(s.id)}>{s.disease_name} · Tier {s.version} · {s.gene_count ?? '?'} genes · {(s.created_at || '').slice(0, 10)} {s.label ? `(${s.label})` : ''}</option>
          ))}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, background: headBg, borderRadius: 8, padding: 3, border: `1px solid ${border}` }}>
          {(['dashboard', 'matrix'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ border: 'none', cursor: 'pointer', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, background: tab === t ? accent : 'transparent', color: tab === t ? '#fff' : muted }}>
              {t === 'matrix' ? 'Gene × Source' : 'Dashboard'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, color: muted, fontStyle: 'italic' }}>Loading from Oracle…</div>
      ) : !selectedId ? (
        <div style={{ padding: 40, color: muted, fontStyle: 'italic' }}>No stored rankings yet. Harvest a disease to create one.</div>
      ) : tab === 'dashboard' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'right' }}>#</th><th style={th}>Gene</th>
            <th style={{ ...th, textAlign: 'right' }}>GET</th><th style={{ ...th, textAlign: 'right' }}>Genetic</th>
            <th style={{ ...th, textAlign: 'right' }}>Expression</th><th style={{ ...th, textAlign: 'right' }}>Target</th>
            <th style={{ ...th, textAlign: 'right' }}>Literature</th><th style={{ ...th, textAlign: 'right' }}>PubTator</th>
            <th style={{ ...th, textAlign: 'right' }}>TAU</th>
          </tr></thead>
          <tbody>
            {scores.map((r) => (
              <React.Fragment key={r.gene_symbol}>
                <tr onClick={() => toggle(r.gene_symbol)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, textAlign: 'right', color: muted }}>{r.rank ?? ''}</td>
                  <td onClick={(e) => { e.stopPropagation(); setDrawerGene(r.gene_symbol); }} title="Open full drill-down" style={{ ...td, fontWeight: 800, color: accent, textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' }}>{r.gene_symbol}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: green }}>{num(r.get_score)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{num(r.genetic_score)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{num(r.expression_score)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{num(r.target_score)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{num(r.literature_score)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{num(r.pubtator_score)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{num(r.tau_tissue)}</td>
                </tr>
                {expanded === r.gene_symbol && renderDetail(r.gene_symbol, 9)}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'right' }}>#</th><th style={th}>Gene</th>
            {COLS.map((c) => <th key={c.key} style={{ ...th, textAlign: 'center' }}>{c.label}</th>)}
          </tr></thead>
          <tbody>
            {scores.map((r) => {
              const g = r.gene_symbol;
              return (
                <React.Fragment key={g}>
                  <tr onClick={() => toggle(g)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...td, textAlign: 'right', color: muted }}>{r.rank ?? ''}</td>
                    <td onClick={(e) => { e.stopPropagation(); setDrawerGene(g); }} title="Open full drill-down" style={{ ...td, fontWeight: 800, color: accent, textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' }}>{g}</td>
                    {COLS.map((c) => {
                      const present = c.kind === 'ot' ? (r.genetic_score != null || r.get_score != null) : !!byGene[g]?.[c.key];
                      const text = c.kind === 'ot' ? 'G / E / T' : byGene[g]?.[c.key];
                      return (
                        <td key={c.key} style={{ ...td, textAlign: 'center' }}>
                          {present
                            ? <span title={text} style={{ color: green, fontWeight: 700 }}>✓</span>
                            : <span style={{ color: muted }}>—</span>}
                        </td>
                      );
                    })}
                  </tr>
                  {expanded === g && renderDetail(g, COLS.length + 2)}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ padding: '10px 18px', fontSize: 10.5, color: muted, borderTop: `1px solid ${border}` }}>
        {tab === 'matrix'
          ? 'Each cell: ✓ = real stored evidence from that source, — = none. Click a row for stored evidence; click the gene name for the full live drill-down.'
          : 'GET scores per gene from the stored snapshot (Oracle). Click a row for stored evidence; click the gene name for the full live drill-down.'}
      </div>
      <GeneDetailDrawer geneSymbol={drawerGene} diseaseName={diseaseName} theme={theme} onClose={() => setDrawerGene(null)} />
    </div>
  );
};

export default RankingsView;
