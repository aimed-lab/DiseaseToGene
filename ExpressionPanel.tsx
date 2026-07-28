import React, { useEffect, useState } from 'react';
import { getExpression, type ExpressionProfile } from './expressionService';

interface Props {
  geneSymbol: string;
  currentDisease?: string;   // expression reference is pancreatic — render only for PDAC
  theme?: 'dark' | 'light';
}

// The reference table is pancreatic (TCGA-PAAD vs GTEx pancreas). Only show this
// panel for pancreatic diseases so other diseases don't see a mismatched signal.
const isPancreatic = (d: string) => /pancrea|pdac|paad|ductal adenocarcinoma/i.test(d || '');

// Dysregulation axis (tumor-vs-normal expression). Reads the preloaded reference
// table via /api/expression. Self-contained + fetch-on-mount. ADDITIVE.
export const ExpressionPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<ExpressionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const show = isPancreatic(currentDisease);

  useEffect(() => {
    if (!show) { setLoading(false); return; }
    let active = true;
    setLoading(true); setData(null);
    getExpression(geneSymbol).then(r => { if (!active) return; setData(r); setLoading(false); });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!show) return null;

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#0d9488'; // teal — expression
  const trackBg = isDark ? '#1e293b' : '#f1f5f9';

  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };

  if (loading) {
    return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Loading tumor-vs-normal expression for {geneSymbol}…</div>;
  }
  if (data?.notLoaded) {
    return (
      <div style={wrap}>
        <Header accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>
          Expression reference table not built yet. Run <code>node scripts/build_expression.mjs &lt;cohort&gt;</code> to populate it.
        </div>
      </div>
    );
  }
  if (!data || data.error || data.log2fc == null) {
    return (
      <div style={wrap}>
        <Header accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>
          {data?.error || `No expression record for ${geneSymbol}`}
        </div>
      </div>
    );
  }

  const upColor = '#dc2626', downColor = '#2563eb';
  const dirColor = data.direction === 'up' ? upColor : data.direction === 'down' ? downColor : muted;
  const dirLabel = data.direction === 'up' ? '▲ Up in tumor'
    : data.direction === 'down' ? '▼ Down in tumor'
    : '— Unchanged';
  const magPct = Math.round(data.dysregulation * 100);

  return (
    <div style={wrap}>
      <Header accent={accent} muted={muted} />

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 10, marginBottom: 10 }}>
        <div>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>log2 fold-change</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: dirColor }}>
            {data.log2fc > 0 ? '+' : ''}{data.log2fc.toFixed(2)}
          </div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 12, color: dirColor }}>{dirLabel}</div>
        {data.pValue != null && (
          <div style={{ marginLeft: 'auto', color: muted, fontSize: 11 }}>
            p = {data.pValue < 1e-4 ? data.pValue.toExponential(1) : data.pValue.toFixed(4)}
          </div>
        )}
      </div>

      {/* tumor vs normal medians */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
        <Stat label="Tumor median" value={data.tumorMedian != null ? data.tumorMedian.toFixed(2) : '—'} sub={data.nTumor ? `n=${data.nTumor}` : ''} text={text} muted={muted} />
        <Stat label="Normal median" value={data.normalMedian != null ? data.normalMedian.toFixed(2) : '—'} sub={data.nNormal ? `n=${data.nNormal}` : ''} text={text} muted={muted} />
        <div style={{ flex: 1 }}>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, marginBottom: 4 }}>Dysregulation</div>
          <div style={{ height: 6, borderRadius: 999, background: trackBg, overflow: 'hidden' }}>
            <div style={{ width: `${magPct}%`, height: '100%', background: accent }} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>{data.source}</strong> · log2(TPM+0.001), uniform Toil pipeline
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; sub: string; text: string; muted: string }> = ({ label, value, sub, text, muted }) => (
  <div>
    <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>{label}</div>
    <div style={{ fontWeight: 900, fontSize: 15, color: text }}>{value} <span style={{ fontSize: 10, fontWeight: 600, color: muted }}>{sub}</span></div>
  </div>
);

const Header: React.FC<{ accent: string; muted: string }> = ({ accent, muted }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Dysregulation · Tumor vs Normal</span>
    <span
      title="Tumor-vs-normal differential expression: TCGA-PAAD tumors vs GTEx healthy pancreas, both processed through the UCSC Xena Toil pipeline (same units). Positive log2FC = over-expressed in tumor. 'Associated with disease' is not the same as 'actually dysregulated' — this axis tests the latter."
      style={{ fontSize: 10, color: muted, cursor: 'help' }}
    >ⓘ</span>
    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      TCGA / GTEx
    </span>
  </div>
);

export default ExpressionPanel;
