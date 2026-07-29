import React, { useEffect, useState } from 'react';

interface Props {
  geneSymbol: string;
  currentDisease?: string;
  theme?: 'dark' | 'light';
}

interface NetworkData {
  winner_score?: number | null;   // WINNER personalised-PageRank importance (0–1)
  rwr_score?: number | null;      // RWR proximity to the top-ranked seeds (0–1)
  is_seed?: boolean;
  ranking_pval?: number | null;   // filled by the Python WINNER upgrade
  n_network_genes?: number;
  n_edges?: number;
}

// Network-biology drill-down: WINNER (importance in the STRING PPI network of the disease's
// top-ranked genes) + RWR (proximity to the top seeds). Reads the STORED 'network' axis — it
// is batch-computed, not a cheap live call — so it shows only after `d2t enrich <id> network`.
// ADDITIVE, fetch-on-mount, same lifecycle as the other drill-down panels.
export const NetworkPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentDisease) { setLoading(false); return; }
    let active = true;
    setLoading(true); setData(null);
    fetch(`/api/network?gene=${encodeURIComponent(geneSymbol)}&disease=${encodeURIComponent(currentDisease)}`)
      .then(r => r.json()).then(j => { if (!active) return; setData(j?.data ?? null); setLoading(false); })
      .catch(() => { if (active) { setData(null); setLoading(false); } });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!currentDisease) return null;

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#06b6d4'; // cyan — network
  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };
  const Header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Network biology · WINNER + RWR</span>
      <span title="WINNER = personalised-PageRank importance in the STRING interaction network of the disease's top-ranked genes. RWR = random-walk-with-restart proximity to the top seeds. Both are predictions, not measured facts." style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
      <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Prediction</span>
    </div>
  );

  if (loading) return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Loading network scores for {geneSymbol}…</div>;

  if (!data || (data.winner_score == null && data.rwr_score == null)) {
    return (
      <div style={wrap}>
        {Header}
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>
          No stored network score for {geneSymbol}{data == null ? '' : ' in this snapshot'}. Run <code>d2t enrich &lt;id&gt; network</code> to populate the axis.
        </div>
      </div>
    );
  }

  const bar = (val: number | null | undefined, color: string) => (
    <div style={{ width: '100%', height: 6, background: isDark ? '#111827' : '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(1, val ?? 0)) * 100}%`, height: '100%', background: color }} />
    </div>
  );

  return (
    <div style={wrap}>
      {Header}
      <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Network importance (WINNER)</span>
            <span style={{ fontWeight: 900, color: accent, fontVariantNumeric: 'tabular-nums' }}>{data.winner_score != null ? data.winner_score.toFixed(3) : '—'}</span>
          </div>
          {bar(data.winner_score, accent)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Seed proximity (RWR)</span>
            <span style={{ fontWeight: 900, color: '#8b5cf6', fontVariantNumeric: 'tabular-nums' }}>{data.rwr_score != null ? data.rwr_score.toFixed(3) : '—'}</span>
          </div>
          {bar(data.rwr_score, '#8b5cf6')}
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: text }}>
        {data.is_seed
          ? <span><strong style={{ color: '#d97706' }}>◆ Seed gene</strong> — one of the top-ranked genes the network walk starts from.</span>
          : <span style={{ color: muted }}>Expansion gene — scored by its connectivity to the seed set.</span>}
        {data.ranking_pval != null && <span style={{ color: muted }}> · ranking p = {data.ranking_pval}</span>}
      </div>
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>STRING v12 PPI</strong> · WINNER + RWR over the top {data.n_network_genes ?? '—'} ranked genes ({data.n_edges ?? '—'} edges). Higher = more central among the disease-associated proteins. A <strong>prediction</strong>, not a measurement.
      </div>
    </div>
  );
};

export default NetworkPanel;
