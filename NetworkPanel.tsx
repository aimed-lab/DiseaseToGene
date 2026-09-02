import React, { useEffect, useState } from 'react';

interface Props {
  geneSymbol: string;
  currentDisease?: string;
  theme?: 'dark' | 'light';
}

interface NetworkData {
  winner_score?: number | null;   // WINNER, max-normalised within the run (TP53-scale; compressed)
  winner_pct?: number | null;     // WINNER percentile within the run (0–100) — the criterion's feature
  winner_rank?: number | null;
  degree?: number | null;         // STRING partners among the graph's nodes
  rwr_score?: number | null;      // RWR proximity to the top-ranked seeds (0–1), same graph
  is_seed?: boolean;
  ranking_pval?: number | null;   // degree-preserving null — null until computed
  context?: string | null;        // "Alzheimer disease / Open Targets top 6,000 (snapshot 103)"
  status?: string | null;
  run_id?: number | null;
  implementation?: string | null; // "winner-net 0.1.1"
  n_network_genes?: number;
  n_edges?: number;
}

// Network-biology drill-down. Reads the STORED 'network' axis — disease-specific WINNER over
// the STRING subnetwork induced by the snapshot's Open Targets candidate set, expressed as a
// within-run percentile (Decisions doc §1, §10), plus RWR on the same graph as a separate
// exploratory measure. Batch-computed by WINNER/scripts/run_disease.mjs, not a live call.
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
      <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Network biology · WINNER</span>
      <span title="WINNER = personalised-PageRank centrality run on the STRING interactions among this disease's Open Targets candidate genes, reported as a percentile within that run. RWR = random-walk-with-restart proximity to the top-ranked seeds on the same graph. Both are predictions, not measured facts, and neither is comparable across graphs." style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
      <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Prediction</span>
    </div>
  );

  if (loading) return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Loading network scores for {geneSymbol}…</div>;

  if (!data || (data.winner_pct == null && data.winner_score == null && data.rwr_score == null)) {
    return (
      <div style={wrap}>
        {Header}
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>
          No stored disease-network score for {geneSymbol}{data == null ? '' : ' in this snapshot'} — it is outside the snapshot’s Open Targets candidate graph, or STRING v12.0 has no protein for it. Run <code>d2t enrich &lt;id&gt; network</code> to (re)build the axis.
        </div>
      </div>
    );
  }

  const bar = (val: number | null | undefined, color: string) => (
    <div style={{ width: '100%', height: 6, background: isDark ? '#111827' : '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(1, val ?? 0)) * 100}%`, height: '100%', background: color }} />
    </div>
  );
  const pct = data.winner_pct != null ? Number(data.winner_pct) : null;
  const label: React.CSSProperties = { color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 };

  return (
    <div style={wrap}>
      {Header}
      {data.context && (
        <div style={{ marginTop: 6, fontSize: 10, color: muted }}>
          Context: <strong style={{ color: text }}>{data.context}</strong>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={label}>Disease-network centrality</span>
            <span style={{ fontWeight: 900, color: accent, fontVariantNumeric: 'tabular-nums' }}>
              {pct != null ? `${pct.toFixed(1)}th pct` : (data.winner_score != null ? data.winner_score.toFixed(3) : '—')}
            </span>
          </div>
          {bar(pct != null ? pct / 100 : data.winner_score, accent)}
          <div style={{ marginTop: 4, fontSize: 10, color: muted }}>
            {pct != null && data.winner_rank != null && data.n_network_genes ? `rank ${data.winner_rank.toLocaleString()} of ${data.n_network_genes.toLocaleString()}` : ''}
            {data.winner_score != null ? `${pct != null && data.winner_rank != null ? ' · ' : ''}raw/max ${data.winner_score.toFixed(3)}` : ''}
            {data.degree != null ? ` · ${data.degree} partners in graph` : ''}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={label}>Seed proximity (RWR)</span>
            <span style={{ fontWeight: 900, color: '#8b5cf6', fontVariantNumeric: 'tabular-nums' }}>{data.rwr_score != null ? data.rwr_score.toFixed(3) : '—'}</span>
          </div>
          {bar(data.rwr_score, '#8b5cf6')}
          <div style={{ marginTop: 4, fontSize: 10, color: muted }}>Exploratory · not part of the Network criterion</div>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: text }}>
        {data.is_seed
          ? <span><strong style={{ color: '#d97706' }}>◆ Seed gene</strong> — one of the top-ranked candidates the random walk restarts from.</span>
          : <span style={{ color: muted }}>Not a seed — scored by its wiring to the rest of the candidate graph.</span>}
        {data.ranking_pval != null && <span style={{ color: muted }}> · ranking p = {data.ranking_pval}</span>}
      </div>
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>STRING v12.0 PPI (score ≥ 400)</strong>, induced on the snapshot’s candidate genes ({data.n_network_genes?.toLocaleString() ?? '—'} nodes, {data.n_edges?.toLocaleString() ?? '—'} edges)
        {data.implementation ? <> · scored by <strong style={{ color: text }}>{data.implementation}</strong> (aimed-lab/WINNER)</> : null}.
        Percentile is within this run only — never compare it with another disease or with the global interactome. WINNER tracks degree closely; a high value can mean “well connected” rather than “disease-specific”. A <strong>prediction</strong>, not a measurement.
      </div>
    </div>
  );
};

export default NetworkPanel;
