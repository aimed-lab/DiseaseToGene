import React, { useEffect, useState } from 'react';
import { getCbioMutations, resolveStudy, type CbioMutationProfile } from './cbioportalService';

interface Props {
  geneSymbol: string;
  currentDisease?: string;     // app's active disease — decides the cBioPortal study
  theme?: 'dark' | 'light';
}

// Mutation axis (cBioPortal). Renders ONLY for diseases mapped to a cancer study
// (Pancreatic cancer / GBM); returns null otherwise so non-cancer cards stay clean.
// Self-contained + fetch-on-mount, same lifecycle as DruggabilityPanel.
export const MutationPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<CbioMutationProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // No mutation axis for non-cancer / unmapped diseases — skip the fetch entirely.
  const study = resolveStudy(currentDisease);

  useEffect(() => {
    if (!study) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setData(null);
    getCbioMutations(geneSymbol, currentDisease).then(result => {
      if (!active) return;          // avoid setState after unmount / gene switch
      setData(result);
      setLoading(false);
    });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!study) return null;          // non-cancer disease → no block at all

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#dc2626';         // red — mutation axis
  const trackBg = isDark ? '#1e293b' : '#f1f5f9';

  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };

  if (loading) {
    return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Fetching cBioPortal mutations for {geneSymbol}…</div>;
  }

  // Gene resolved but no mutations recorded, or gene not in cBioPortal
  if (!data || data.error || data.mutatedSamples === 0) {
    return (
      <div style={wrap}>
        <Header isDark={isDark} accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>
          {data?.error ? data.error : `No ${geneSymbol} mutations recorded in ${data?.studyName || study.name}`}
        </div>
      </div>
    );
  }

  const freqPct = (data.mutationFrequency * 100).toFixed(0);

  return (
    <div style={wrap}>
      <Header isDark={isDark} accent={accent} muted={muted} />

      {/* Frequency */}
      <div style={{ marginTop: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>
            Mutated in cohort
          </span>
          <span style={{ fontWeight: 900, fontSize: 16, color: accent }}>{freqPct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: trackBg, overflow: 'hidden' }}>
          <div style={{ width: `${freqPct}%`, height: '100%', background: accent }} />
        </div>
        <div style={{ color: muted, fontSize: 10, marginTop: 3 }}>
          {data.mutatedSamples} of {data.totalSamples} sequenced samples
          {data.dominantVariant && <> · dominant <strong style={{ color: text }}>{data.dominantVariant}</strong></>}
        </div>
      </div>

      {/* Top variants / hotspots */}
      <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, marginBottom: 5 }}>
        Top variants
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {data.topVariants.slice(0, 6).map(v => {
          const pct = (v.fraction * 100).toFixed(0);
          return (
            <div key={v.proteinChange} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, minWidth: 52, color: text }}>{v.proteinChange}</span>
              <div style={{ flex: 1, height: 5, borderRadius: 999, background: trackBg, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: accent, opacity: 0.75 }} />
              </div>
              <span style={{ minWidth: 58, textAlign: 'right', color: muted, fontSize: 11 }}>
                {v.count} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>

      {/* Provenance footer */}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>cBioPortal</strong> · {data.studyName}
        <br />
        Study ID: {data.studyId} · Retrieved: {data.retrieved}
      </div>
    </div>
  );
};

const Header: React.FC<{ isDark: boolean; accent: string; muted: string }> = ({ accent, muted }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Mutation Axis</span>
    <span
      title="cBioPortal mutation data for the disease's reference TCGA cohort. Frequency = sequenced samples carrying ≥1 mutation in this gene. Top variants = recurrent protein changes (hotspots), e.g. KRAS G12D. Counts are real per-patient calls from the named study — not predicted."
      style={{ fontSize: 10, color: muted, cursor: 'help' }}
    >ⓘ</span>
    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      cBioPortal
    </span>
  </div>
);

export default MutationPanel;
