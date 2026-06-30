import React, { useEffect, useState } from 'react';

interface Props {
  geneSymbol: string;
  currentDisease?: string;     // clinical landscape is disease-scoped
  theme?: 'dark' | 'light';
}

interface ClinicalData { trial_count: number; max_phase: number; }

// Clinical axis (ClinicalTrials.gov). Shows trial activity for the gene in the
// active disease + highest phase reached — the SAME numbers the funnel filters on
// (the harvest stores these as 'clinical' evidence; here we fetch live per gene).
// ADDITIVE, fetch-on-mount, same lifecycle as the other drill-down panels.
export const ClinicalPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<ClinicalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentDisease) { setLoading(false); return; }
    let active = true;
    setLoading(true); setData(null);
    fetch(`/api/clinical?gene=${encodeURIComponent(geneSymbol)}&disease=${encodeURIComponent(currentDisease)}`)
      .then(r => r.json()).then(j => { if (!active) return; setData(j?.data ?? null); setLoading(false); })
      .catch(() => { if (active) { setData(null); setLoading(false); } });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!currentDisease) return null;

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#16a34a'; // green — clinical
  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };

  if (loading) return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Querying ClinicalTrials.gov for {geneSymbol}…</div>;

  if (!data || data.trial_count === 0) {
    return (
      <div style={wrap}>
        <Header accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>No registered trials mentioning {geneSymbol} in {currentDisease}</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <Header accent={accent} muted={muted} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 10 }}>
        <div>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Trials in disease</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: accent }}>{data.trial_count}</div>
        </div>
        <div>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Max phase</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: text }}>{data.max_phase ? `Phase ${data.max_phase}` : '—'}</div>
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>ClinicalTrials.gov</strong> · trials co-mentioning the gene and {currentDisease}
      </div>
    </div>
  );
};

const Header: React.FC<{ accent: string; muted: string }> = ({ accent, muted }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Clinical · ClinicalTrials.gov</span>
    <span title="Registered clinical trials that mention this gene/target in the active disease, and the highest trial phase reached. Signals existing clinical interest and remaining room. Real registry counts, not predictions." style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>ClinicalTrials</span>
  </div>
);

export default ClinicalPanel;
