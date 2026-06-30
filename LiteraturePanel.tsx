import React, { useEffect, useState } from 'react';

interface Props {
  geneSymbol: string;
  currentDisease?: string;     // literature signal is disease-scoped
  theme?: 'dark' | 'light';
}

interface LitStat { paper_count: number; recent_count: number; velocity: number; }
interface LitResp { pubmed: LitStat | null; epmc: LitStat | null; }

// Literature axis. Shows BOTH literature sources the harvest stores — PubMed
// (gene-specific `SYMBOL[Gene Name]`, the funnel axis) and Europe PMC (broader
// full-text) — with the same numbers the funnel filters on. ADDITIVE.
export const LiteraturePanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<LitResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentDisease) { setLoading(false); return; }
    let active = true;
    setLoading(true); setData(null);
    fetch(`/api/literature?gene=${encodeURIComponent(geneSymbol)}&disease=${encodeURIComponent(currentDisease)}`)
      .then(r => r.json()).then(j => { if (!active) return; setData(j ?? null); setLoading(false); })
      .catch(() => { if (active) { setData(null); setLoading(false); } });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!currentDisease) return null;

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#0ea5e9'; // sky — literature
  const trackBg = isDark ? '#1e293b' : '#f1f5f9';
  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };

  if (loading) return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Querying PubMed & Europe PMC for {geneSymbol}…</div>;

  const pm = data?.pubmed, ep = data?.epmc;
  if ((!pm || pm.paper_count === 0) && (!ep || ep.paper_count === 0)) {
    return (
      <div style={wrap}>
        <Header accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>No publications linking {geneSymbol} and {currentDisease}</div>
      </div>
    );
  }

  const Source = (label: string, s: LitStat | null) => {
    if (!s || s.paper_count === 0) return null;
    const velPct = Math.round(s.velocity * 100);
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 78 }}>{label}</span>
          <div><div style={{ color: muted, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>Papers</div><div style={{ fontWeight: 900, fontSize: 16, color: text }}>{s.paper_count.toLocaleString()}</div></div>
          <div><div style={{ color: muted, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>Recent (3y)</div><div style={{ fontWeight: 900, fontSize: 16, color: text }}>{s.recent_count.toLocaleString()}</div></div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}><div style={{ color: muted, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>Velocity</div><div style={{ fontWeight: 900, fontSize: 16, color: accent }}>{velPct}%</div></div>
        </div>
        <div style={{ height: 5, borderRadius: 999, background: trackBg, overflow: 'hidden', marginTop: 4 }}>
          <div style={{ width: `${velPct}%`, height: '100%', background: accent }} />
        </div>
      </div>
    );
  };

  return (
    <div style={wrap}>
      <Header accent={accent} muted={muted} />
      {Source('PubMed', pm ?? null)}
      {Source('Europe PMC', ep ?? null)}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        PubMed = gene-specific (<code>{geneSymbol}[Gene Name]</code>); Europe PMC = broader full-text. Velocity = share of papers in the last 3 years.
      </div>
    </div>
  );
};

const Header: React.FC<{ accent: string; muted: string }> = ({ accent, muted }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Literature · PubMed + Europe PMC</span>
    <span title="Publications linking this gene and the active disease, from two complementary sources. PubMed uses the gene-specific [Gene Name] tag (cleaner); Europe PMC indexes full text (broader). Velocity = fraction from the last 3 years (rising interest). Real publication counts, not predictions." style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>NCBI / EBI</span>
  </div>
);

export default LiteraturePanel;
