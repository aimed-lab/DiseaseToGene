import React, { useEffect, useState } from 'react';

interface Props {
  geneSymbol: string;
  currentDisease?: string;
  theme?: 'dark' | 'light';
}

// One gene's record from data/proteomics_<cohort>.json (same shape as the expression table).
interface ProteomicsData {
  log2fc?: number | null;         // tumor_median − normal_median (log2 protein abundance)
  p?: number | string | null;     // Mann-Whitney tumor vs normal
  tumor_median?: number | null;
  normal_median?: number | null;
  n_tumor?: number | null;
  n_normal?: number | null;
}

// Proteomics drill-down: CPTAC mass-spec PROTEIN tumor-vs-normal fold-change (built like the
// expression axis, from matched tumour + normal-adjacent samples). Protein is closer to the
// druggable reality than mRNA, and agreement/disagreement with the transcript is informative.
// Reference-file backed (disease must have a CPTAC cohort in the registry + the table built).
export const ProteomicsPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<ProteomicsData | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'none' | 'notbuilt'>('loading');

  useEffect(() => {
    if (!currentDisease) { setState('none'); return; }
    let active = true;
    setState('loading'); setData(null);
    fetch(`/api/proteomics?gene=${encodeURIComponent(geneSymbol)}&disease=${encodeURIComponent(currentDisease)}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!active) return;
        if (j?.notLoaded) { setState('notbuilt'); return; }
        setMeta(j?.meta ?? null);
        setData(j?.data ?? null);
        setState(j?.data ? 'ok' : 'none');
      })
      .catch(() => { if (active) setState('none'); });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!currentDisease) return null;

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#db2777'; // pink — proteomics
  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };
  const Header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Proteomics · CPTAC protein (tumor vs normal)</span>
      <span title="Mass-spec protein abundance from CPTAC — tumour median vs matched normal-adjacent median, as a log2 fold-change. Protein is closer to the druggable reality than mRNA; agreement with the expression axis strengthens a target." style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
      <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>CPTAC</span>
    </div>
  );

  if (state === 'loading') return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Loading CPTAC protein data for {geneSymbol}…</div>;
  if (state === 'notbuilt') return (
    <div style={wrap}>{Header}
      <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>Proteomics reference not built yet. Run <code>node scripts/build_proteomics.mjs &lt;cohort&gt;</code> to populate it.</div>
    </div>
  );
  if (state === 'none' || !data || data.log2fc == null) return (
    <div style={wrap}>{Header}
      <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>No CPTAC protein record for {geneSymbol} in {currentDisease} (no CPTAC cohort for this disease, or protein not quantified).</div>
    </div>
  );

  const fc = Number(data.log2fc);
  const up = fc >= 0;
  const dirColor = up ? '#dc2626' : '#2563eb';
  const dirLabel = up ? 'Protein-elevated' : 'Protein-reduced';
  const mag = Math.max(0, Math.min(1, Math.abs(fc) / 3)); // |log2FC|/3 capped for the bar

  return (
    <div style={wrap}>
      {Header}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 10 }}>
        <div>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Protein log2FC</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: dirColor, fontVariantNumeric: 'tabular-nums' }}>{fc > 0 ? '+' : ''}{fc.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Direction</div>
          <div style={{ fontWeight: 900, fontSize: 14, color: dirColor }}>{dirLabel}</div>
        </div>
        {data.p != null && (
          <div>
            <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>p-value</div>
            <div style={{ fontWeight: 900, fontSize: 14, color: text, fontVariantNumeric: 'tabular-nums' }}>{String(data.p)}</div>
          </div>
        )}
      </div>
      <div style={{ height: 8, background: isDark ? '#111827' : '#f1f5f9', borderRadius: 4, marginTop: 12, overflow: 'hidden' }}>
        <div style={{ width: `${mag * 100}%`, height: '100%', background: dirColor }} />
      </div>
      <div style={{ marginTop: 10, color: text, fontSize: 11, lineHeight: 1.5 }}>
        Tumour median <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{data.tumor_median != null ? Number(data.tumor_median).toFixed(2) : '—'}</strong> vs
        normal <strong style={{ fontVariantNumeric: 'tabular-nums' }}> {data.normal_median != null ? Number(data.normal_median).toFixed(2) : '—'}</strong>
        {data.n_tumor != null && <span style={{ color: muted }}> · {data.n_tumor} tumour / {data.n_normal ?? '—'} normal samples</span>}
      </div>
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>{meta?.source || 'CPTAC mass-spec proteomics'}</strong>. Protein-level tumour-vs-normal — read alongside the mRNA expression panel.
      </div>
    </div>
  );
};

export default ProteomicsPanel;
