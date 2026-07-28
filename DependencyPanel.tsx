import React, { useEffect, useState } from 'react';
import { getDependency, type DependencyProfile } from './depmapService';

interface Props {
  geneSymbol: string;
  currentDisease?: string;   // dependency reference is pancreatic-lineage — render only for PDAC
  theme?: 'dark' | 'light';
}

const isPancreatic = (d: string) => /pancrea|pdac|paad|ductal adenocarcinoma/i.test(d || '');

// Dependency axis (DepMap CRISPR / Chronos). Reads the preloaded pancreatic-lineage
// reference table via /api/depmap. Self-contained + fetch-on-mount. ADDITIVE.
export const DependencyPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<DependencyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const show = isPancreatic(currentDisease);

  useEffect(() => {
    if (!show) { setLoading(false); return; }
    let active = true;
    setLoading(true); setData(null);
    getDependency(geneSymbol).then(r => { if (!active) return; setData(r); setLoading(false); });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!show) return null;

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#7c3aed'; // violet — dependency
  const trackBg = isDark ? '#1e293b' : '#f1f5f9';

  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };

  if (loading) {
    return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Loading DepMap dependency for {geneSymbol}…</div>;
  }
  if (data?.notLoaded) {
    return (
      <div style={wrap}>
        <Header accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>
          DepMap reference table not built yet. Run <code>node scripts/build_depmap.mjs &lt;cohort&gt;</code> to populate it.
        </div>
      </div>
    );
  }
  if (!data || data.error || data.meanChronos == null) {
    return (
      <div style={wrap}>
        <Header accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>
          {data?.error || `${geneSymbol} not screened in DepMap`}
        </div>
      </div>
    );
  }

  // Bar fills from the right (negative = dependency). Use absolute strength.
  const strengthPct = Math.round(data.dependencyScore * 100);
  const classColor =
    data.dependencyClass === 'Strong dependency' ? '#dc2626'
    : data.dependencyClass === 'Dependency' ? accent
    : muted;

  return (
    <div style={wrap}>
      <Header accent={accent} muted={muted} />

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 10, marginBottom: 10 }}>
        <div>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Mean gene-effect (Chronos)</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: classColor }}>{data.meanChronos.toFixed(2)}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 12, color: classColor }}>{data.dependencyClass}</div>
        {data.nLines != null && (
          <div style={{ marginLeft: 'auto', color: muted, fontSize: 11 }}>{data.nLines} pancreatic lines</div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Dependency strength</span>
        <span style={{ fontWeight: 900, fontSize: 14, color: accent }}>{strengthPct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: trackBg, overflow: 'hidden' }}>
        <div style={{ width: `${strengthPct}%`, height: '100%', background: accent }} />
      </div>
      <div style={{ color: muted, fontSize: 10, marginTop: 3 }}>
        0 = knockout has no effect · −1 = median common-essential (strong) · positive = knockout helps growth
        {data.fracDependent != null && <> · {Math.round(data.fracDependent * 100)}% of lines dependent</>}
      </div>

      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>{data.source}</strong>
        {data.minChronos != null && <> · strongest line {data.minChronos.toFixed(2)}</>}
      </div>
    </div>
  );
};

const Header: React.FC<{ accent: string; muted: string }> = ({ accent, muted }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Dependency · DepMap CRISPR</span>
    <span
      title="DepMap CRISPR (Chronos) gene-effect averaged across pancreatic cancer cell lines. Asks whether the tumor functionally NEEDS the gene to survive — separating drivers from passengers. Real genome-wide knockout screen results, not predictions."
      style={{ fontSize: 10, color: muted, cursor: 'help' }}
    >ⓘ</span>
    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      DepMap
    </span>
  </div>
);

export default DependencyPanel;
