import React, { useState } from 'react';

// ── Pocket-level (region-specific) druggability — DoGSiteScorer "protein tier" ──
// The professor's point: druggability is a property of a POCKET, not the whole
// protein (PHGDH: catalytic pocket druggable, RNA-binding surface not). Button-
// triggered because a DoGSiteScorer run is a ~30-60s API round-trip per target
// (cached by proteins.plus afterwards). Calls /api/druggability/pockets. ADDITIVE.

interface Props {
  geneSymbol: string;
  currentDisease?: string;
  theme?: 'dark' | 'light';
}

interface Pocket { name: string; drugEst: number; volume: number; enclosure: number; hydrophobicity: number; depth: number; druggable: boolean; }
interface Result { gene: string; uniprot: string | null; source: string; pockets: Pocket[]; bestDrug: number; nDruggable: number; note: string; error?: string; }

export const PocketDruggabilityPanel: React.FC<Props> = ({ geneSymbol, theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const c = {
    card: isDark ? '#0f172a' : '#f8fafc', border: isDark ? '#1e293b' : '#e2e8f0',
    ink: isDark ? '#e2e8f0' : '#0f172a', muted: isDark ? '#64748b' : '#94a3b8',
    good: '#16a34a', mid: '#d97706', bad: '#dc2626', track: isDark ? '#1e293b' : '#e5e7eb',
  };

  const run = async () => {
    setLoading(true); setErr(null); setData(null);
    try {
      const r = await fetch(`/api/druggability/pockets?gene=${encodeURIComponent(geneSymbol)}`);
      const j: Result = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) { setErr(e?.message || 'Failed to analyze pockets'); }
    finally { setLoading(false); }
  };

  const barColor = (d: number) => (d >= 0.5 ? c.good : d >= 0.4 ? c.mid : c.bad);

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, background: c.card, padding: 12, margin: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: c.ink }} title="Region-specific druggability: DoGSiteScorer detects pockets on the AlphaFold structure and each pocket is scored from its validated descriptors (volume, enclosure, depth, hydrophobicity). Druggability is per-pocket, not whole-protein.">Pocket druggability</span>
        <span style={{ fontSize: 10, color: c.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>DoGSiteScorer · protein tier</span>
        <button onClick={run} disabled={loading} style={{ marginLeft: 'auto', border: `1px solid ${c.border}`, background: loading ? c.track : '#4f46e5', color: loading ? c.muted : '#fff', borderRadius: 8, padding: '5px 11px', fontSize: 11, fontWeight: 800, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Analyzing… (~30–60s)' : data ? 'Re-run' : 'Analyze pockets'}
        </button>
      </div>

      {!data && !loading && !err && (
        <div style={{ fontSize: 11, color: c.muted, marginTop: 8 }}>
          On-demand structure-based pocket analysis for {geneSymbol}. Distinguishes a druggable catalytic pocket from a flat, undruggable surface — so a target can be “druggable at pocket A, not at surface B.”
        </div>
      )}
      {err && <div style={{ fontSize: 11.5, color: c.bad, marginTop: 8 }}>{err}</div>}

      {data && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: c.ink }}><b>{data.nDruggable}</b> druggable pocket{data.nDruggable === 1 ? '' : 's'}</span>
            <span style={{ fontSize: 12, color: c.ink }}>best pocket <b style={{ color: barColor(data.bestDrug) }}>{data.bestDrug.toFixed(2)}</b></span>
            <span style={{ fontSize: 10.5, color: c.muted }}>{data.source}</span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {data.pockets.slice(0, 8).map(p => (
              <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '52px 1fr 46px', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: c.muted }}>{p.name}</span>
                <div style={{ height: 12, borderRadius: 6, background: c.track, overflow: 'hidden' }} title={`vol ${p.volume}Å³ · enclosure ${p.enclosure} · depth ${p.depth}Å · hydrophobicity ${p.hydrophobicity}`}>
                  <div style={{ height: '100%', width: `${Math.round(p.drugEst * 100)}%`, background: barColor(p.drugEst), borderRadius: 6 }} />
                </div>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: 700, color: barColor(p.drugEst), textAlign: 'right' }}>{p.drugEst.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9.5, color: c.muted, marginTop: 8, lineHeight: 1.4 }}>{data.note}</div>
        </div>
      )}
    </div>
  );
};

export default PocketDruggabilityPanel;
