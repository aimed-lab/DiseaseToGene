import React, { useEffect, useState } from 'react';
import { getGnomadConstraint, type GnomadConstraint } from './gnomadService';

interface Props {
  geneSymbol: string;
  currentDisease?: string;   // unused — constraint is disease-independent; kept for a uniform panel signature
  theme?: 'dark' | 'light';
}

// Safety axis (gnomAD constraint). Live per-gene pLI / LOEUF. Disease-independent,
// so it renders for every gene. Self-contained + fetch-on-mount, same lifecycle as
// MutationPanel / DruggabilityPanel. ADDITIVE — touches no existing logic.
export const ConstraintPanel: React.FC<Props> = ({ geneSymbol, theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<GnomadConstraint | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setData(null);
    getGnomadConstraint(geneSymbol).then(r => { if (!active) return; setData(r); setLoading(false); });
    return () => { active = false; };
  }, [geneSymbol]);

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#d97706'; // amber — safety
  const trackBg = isDark ? '#1e293b' : '#f1f5f9';

  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };

  if (loading) {
    return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Fetching gnomAD constraint for {geneSymbol}…</div>;
  }
  if (!data || data.error || (data.pli == null && data.loeuf == null)) {
    return (
      <div style={wrap}>
        <Header accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>
          {data?.error || `No gnomAD constraint record for ${geneSymbol}`}
        </div>
      </div>
    );
  }

  const concernPct = Math.round(data.safetyConcern * 100);
  const classColor =
    data.constraintClass === 'LoF-intolerant' ? '#dc2626'
    : data.constraintClass === 'LoF-tolerant' ? '#16a34a'
    : muted;

  return (
    <div style={wrap}>
      <Header accent={accent} muted={muted} />

      <div style={{ display: 'flex', gap: 16, marginTop: 10, marginBottom: 10 }}>
        <Metric label="pLI" value={data.pli != null ? data.pli.toFixed(3) : '—'} text={text} muted={muted}
          hint="Probability the gene is loss-of-function intolerant (0–1). ≥0.9 = knockout poorly tolerated." />
        <Metric label="LOEUF" value={data.loeuf != null ? data.loeuf.toFixed(2) : '—'} text={text} muted={muted}
          hint="Observed/expected LoF upper bound. Lower = more constrained. <0.6 = constrained (gnomAD v4)." />
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Class</div>
          <div style={{ fontWeight: 900, fontSize: 13, color: classColor }}>{data.constraintClass}</div>
        </div>
      </div>

      {/* Safety-concern bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>
          Knockdown safety concern
        </span>
        <span style={{ fontWeight: 900, fontSize: 14, color: accent }}>{concernPct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: trackBg, overflow: 'hidden' }}>
        <div style={{ width: `${concernPct}%`, height: '100%', background: accent }} />
      </div>
      <div style={{ color: muted, fontSize: 10, marginTop: 3 }}>
        Constrained genes are needed by healthy cells — a caution flag for knockdown/degrader strategies, not a disqualifier.
      </div>

      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>{data.source}</strong>
        {data.geneId && <> · {data.geneId}</>} · Retrieved: {data.retrieved}
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; text: string; muted: string; hint: string }> = ({ label, value, text, muted, hint }) => (
  <div title={hint} style={{ cursor: 'help' }}>
    <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>{label}</div>
    <div style={{ fontWeight: 900, fontSize: 16, color: text }}>{value}</div>
  </div>
);

const Header: React.FC<{ accent: string; muted: string }> = ({ accent, muted }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Safety · Constraint</span>
    <span
      title="gnomAD genetic constraint. pLI / LOEUF measure how strongly the human population selects against loss-of-function variants in this gene. High constraint = essential in healthy tissue = higher on-target toxicity risk if drugged by knockdown. Real population-genetics metrics, not predictions."
      style={{ fontSize: 10, color: muted, cursor: 'help' }}
    >ⓘ</span>
    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      gnomAD
    </span>
  </div>
);

export default ConstraintPanel;
