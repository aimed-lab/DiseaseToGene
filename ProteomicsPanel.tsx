import React, { useEffect, useState } from 'react';

// Proteomics drill-down — one gene's record from data/proteomics_<cohort>.json, the
// protein-level counterpart of the expression panel. Protein is closer to the druggable
// reality than mRNA, and agreement or disagreement with the transcript is informative.
//
// Two study designs share this panel and it must not confuse them:
//   tumour vs normal   — CPTAC (cancers). Carries tumour/normal medians and sample counts.
//   case vs control    — AMP-AD brain proteome (Alzheimer's). Carries a 95% CI, an
//                        FDR-corrected p, the brain region, and the other regions' values.
// The file's meta.design says which; a CPTAC file has no such field and keeps the tumour
// wording. Nothing here guesses from the disease name.
//
// The bar is drawn on the cohort's own log2fc_scale (sent by the route), not a fixed ÷3.
// AD brain effects are ~20x smaller than tumour-vs-normal; ÷3 made every AD bar a sliver.

export interface ProteomicsData {
  log2fc?: number | null;
  p?: number | string | null;        // CPTAC: Mann-Whitney p. AMP-AD: FDR-corrected p (p_raw kept separately).
  p_raw?: number | null;
  ci_lwr?: number | null;
  ci_upr?: number | null;
  tissue?: string | null;            // brain region the headline value comes from
  uniprot?: string | null;
  n_tissues?: number | null;
  tissues?: Record<string, { log2fc: number; p: number }> | null;
  tumor_median?: number | null;
  normal_median?: number | null;
  n_tumor?: number | null;
  n_normal?: number | null;
}

interface Props { geneSymbol: string; currentDisease?: string; theme?: 'light' | 'dark'; }

export const ProteomicsPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<ProteomicsData | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [scale, setScale] = useState<number>(3);
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
        setScale(Number(j?.scale) > 0 ? Number(j.scale) : 3);
        setData(j?.data ?? null);
        setState(j?.data ? 'ok' : 'none');
      })
      .catch(() => { if (active) setState('none'); });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!currentDisease) return null;

  const cc = meta?.design === 'case_control';
  const frame = cc
    ? { title: 'Proteomics · AMP-AD brain protein (AD vs control)', badge: 'AMP-AD', short: 'AMP-AD brain protein',
        tip: 'Mass-spec protein abundance in post-mortem brain, Alzheimer’s vs control, as a log2 fold-change with a 95% CI and an FDR-corrected p. Protein is closer to the druggable reality than mRNA; agreement with the expression axis strengthens a target.',
        foot: 'Protein-level AD vs control brain — read alongside the mRNA expression panel.' }
    : { title: 'Proteomics · CPTAC protein (tumor vs normal)', badge: 'CPTAC', short: 'CPTAC protein',
        tip: 'Mass-spec protein abundance from CPTAC — tumour median vs matched normal-adjacent median, as a log2 fold-change. Protein is closer to the druggable reality than mRNA; agreement with the expression axis strengthens a target.',
        foot: 'Protein-level tumour-vs-normal — read alongside the mRNA expression panel.' };

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#db2777'; // pink — proteomics
  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };
  const label: React.CSSProperties = { color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 };
  const Header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>{frame.title}</span>
      <span title={frame.tip} style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
      <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{frame.badge}</span>
    </div>
  );

  if (state === 'loading') return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Loading protein data for {geneSymbol}…</div>;
  if (state === 'notbuilt') return (
    <div style={wrap}>{Header}
      <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>Proteomics reference not built yet. Run <code>node scripts/build_proteomics.mjs &lt;cohort&gt;</code> (cancers) or <code>node scripts/build_proteomics_ad.mjs</code> (Alzheimer's) to populate it.</div>
    </div>
  );
  if (state === 'none' || !data || data.log2fc == null) return (
    <div style={wrap}>{Header}
      <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>No protein record for {geneSymbol} in {currentDisease} (no proteomics cohort for this disease, or protein not quantified).</div>
    </div>
  );

  const fc = Number(data.log2fc);
  const up = fc >= 0;
  const dirColor = up ? '#dc2626' : '#2563eb';
  const dirLabel = up ? 'Protein-elevated' : 'Protein-reduced';
  const mag = Math.max(0, Math.min(1, Math.abs(fc) / scale));
  const hasCI = data.ci_lwr != null && data.ci_upr != null;
  const sig = (p: number | string | null | undefined) => p != null && Number(p) < 0.05;
  const fmtP = (p: number | string | null | undefined) => p == null ? '—' : Number(p) < 1e-3 ? Number(p).toExponential(1) : Number(p).toFixed(3);
  const hasMedians = data.tumor_median != null || data.normal_median != null;
  const regions = data.tissues ? Object.entries(data.tissues) : [];

  return (
    <div style={wrap}>
      {Header}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={label}>Protein log2FC{hasCI ? ' · 95% CI' : ''}</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: dirColor, fontVariantNumeric: 'tabular-nums' }}>
            {fc > 0 ? '+' : ''}{fc.toFixed(2)}
            {hasCI && <span style={{ fontSize: 11, fontWeight: 600, color: muted, marginLeft: 6 }}>[{Number(data.ci_lwr) > 0 ? '+' : ''}{Number(data.ci_lwr).toFixed(2)}, {Number(data.ci_upr) > 0 ? '+' : ''}{Number(data.ci_upr).toFixed(2)}]</span>}
          </div>
        </div>
        <div>
          <div style={label}>Direction</div>
          <div style={{ fontWeight: 900, fontSize: 14, color: dirColor }}>{dirLabel}</div>
        </div>
        {data.p != null && (
          <div>
            <div style={label}>{cc ? 'Corrected p' : 'p-value'}</div>
            <div style={{ fontWeight: 900, fontSize: 14, color: sig(data.p) ? text : muted, fontVariantNumeric: 'tabular-nums' }}>{fmtP(data.p)}{sig(data.p) ? '' : ' (n.s.)'}</div>
          </div>
        )}
        {data.tissue && (
          <div>
            <div style={label}>Region</div>
            <div style={{ fontWeight: 900, fontSize: 14, color: text }}>{data.tissue}</div>
          </div>
        )}
      </div>
      <div style={{ height: 8, background: isDark ? '#111827' : '#f1f5f9', borderRadius: 4, marginTop: 12, overflow: 'hidden' }}
           title={`|log2FC| ÷ ${scale} — the cohort's own scale; ${scale} log2 units saturates the bar`}>
        <div style={{ width: `${mag * 100}%`, height: '100%', background: dirColor }} />
      </div>

      {hasMedians && (
        <div style={{ marginTop: 10, color: text, fontSize: 11, lineHeight: 1.5 }}>
          Tumour median <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{data.tumor_median != null ? Number(data.tumor_median).toFixed(2) : '—'}</strong> vs
          normal <strong style={{ fontVariantNumeric: 'tabular-nums' }}> {data.normal_median != null ? Number(data.normal_median).toFixed(2) : '—'}</strong>
          {data.n_tumor != null && <span style={{ color: muted }}> · {data.n_tumor} tumour / {data.n_normal ?? '—'} normal samples</span>}
        </div>
      )}

      {regions.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...label, marginBottom: 4 }}>By brain region</div>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            <tbody>
              {regions.map(([region, r]) => {
                const chosen = region === data.tissue;
                const rc = r.log2fc >= 0 ? '#dc2626' : '#2563eb';
                return (
                  <tr key={region} style={{ color: chosen ? text : muted, fontWeight: chosen ? 800 : 500 }}>
                    <td style={{ padding: '1px 14px 1px 0' }}>{region}{chosen ? ' ·' : ''}</td>
                    <td style={{ padding: '1px 14px 1px 0', color: rc, textAlign: 'right' }}>{r.log2fc > 0 ? '+' : ''}{r.log2fc.toFixed(2)}</td>
                    <td style={{ padding: '1px 0', textAlign: 'right' }}>p {fmtP(r.p)}{sig(r.p) ? '' : ' n.s.'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.tissue && <div style={{ color: muted, fontSize: 10, marginTop: 3 }}>Headline value is {data.tissue} (the most-sampled region) when measured; otherwise the region with the smallest corrected p.</div>}
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>{meta?.source || `${frame.short} mass-spec proteomics`}</strong>. {frame.foot}
      </div>
    </div>
  );
};

export default ProteomicsPanel;
