import React, { useState } from 'react';

// ── Pocket STRUCTURAL drill-down (descriptive evidence only) ────────────────────
// Detects binding pockets on the target's BEST structure (experimental PDB → else
// AlphaFold model → else none) and shows each pocket's DoGSite3 descriptors. This is
// NOT a scoring axis and does NOT show a druggability score — DoGSite3 outputs
// descriptors only, and the older "simpleScore"/"drugScore" is unpublished/unavailable,
// so we don't fabricate one. The funnel's "can we drug it" signal stays on Open Targets
// tractability. Button-triggered: a DoGSite3 run is a ~30-60s round-trip per target.

interface Props {
  geneSymbol: string;
  currentDisease?: string;
  theme?: 'dark' | 'light';
}

interface StructureRef {
  kind: 'experimental' | 'alphafold' | 'none';
  id: string | null; label: string; method: string | null;
  resolution: number | null; plddt: number | null; url: string | null;
}
interface PocketRow {
  name: string; volume: number; enclosure: number; depth: number;
  hydrophobicity: number; surfVol: number; primary: boolean;
}
interface Result {
  gene: string; uniprot: string | null; structure: StructureRef; engine: string;
  pockets: PocketRow[]; totalPockets: number; note: string; error?: string;
}

export const PocketStructurePanel: React.FC<Props> = ({ geneSymbol, theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const c = {
    card: isDark ? '#0f172a' : '#f8fafc', border: isDark ? '#1e293b' : '#e2e8f0',
    ink: isDark ? '#e2e8f0' : '#0f172a', muted: isDark ? '#64748b' : '#94a3b8',
    head: isDark ? '#0b1220' : '#f1f5f9', accent: '#4f46e5',
    primaryBg: isDark ? '#1e1b4b' : '#eef2ff', primaryInk: isDark ? '#c7d2fe' : '#4338ca',
    exp: '#0891b2', af: '#7c3aed', none: isDark ? '#64748b' : '#94a3b8',
    track: isDark ? '#1e293b' : '#e5e7eb',
  };

  const run = async () => {
    setLoading(true); setErr(null); setData(null);
    try {
      const r = await fetch(`/api/druggability/pockets?gene=${encodeURIComponent(geneSymbol)}`);
      const j: Result = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) { setErr(e?.message || 'Failed to analyze pockets'); }
    finally { setLoading(false); }
  };

  const srcColor = (k: string) => (k === 'experimental' ? c.exp : k === 'alphafold' ? c.af : c.none);
  const th: React.CSSProperties = { textAlign: 'right', fontSize: 9.5, fontWeight: 700, color: c.muted, padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'right', fontSize: 11.5, color: c.ink, padding: '5px 8px', fontFamily: 'ui-monospace, monospace' };

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, background: c.card, padding: 12, margin: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: c.ink }} title="Structure-based pocket descriptors from DoGSite3. Descriptive evidence only — this is NOT a druggability score and does not affect the ranking.">Pocket structure</span>
        <span style={{ fontSize: 10, color: c.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>DoGSite3 · descriptive</span>
        <button onClick={run} disabled={loading} style={{ marginLeft: 'auto', border: `1px solid ${c.border}`, background: loading ? c.track : c.accent, color: loading ? c.muted : '#fff', borderRadius: 8, padding: '5px 11px', fontSize: 11, fontWeight: 800, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Analyzing… (~30–60s)' : data ? 'Re-run' : 'Analyze pockets'}
        </button>
      </div>

      {!data && !loading && !err && (
        <div style={{ fontSize: 11, color: c.muted, marginTop: 8 }}>
          On-demand pocket detection for {geneSymbol} on its best 3D structure (experimental PDB if available, otherwise the AlphaFold model). Reports pocket geometry — <b>descriptive evidence, not a score</b>.
        </div>
      )}
      {err && <div style={{ fontSize: 11.5, color: '#dc2626', marginTop: 8 }}>{err}</div>}

      {data && (
        <div style={{ marginTop: 10 }}>
          {/* structure provenance — always show which structure was used */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: srcColor(data.structure.kind), borderRadius: 5, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '.03em' }}>
              {data.structure.kind === 'experimental' ? 'Experimental' : data.structure.kind === 'alphafold' ? 'AlphaFold' : 'No structure'}
            </span>
            <span style={{ fontSize: 11, color: c.ink }}>{data.structure.label}</span>
            {data.uniprot && <span style={{ fontSize: 10.5, color: c.muted }}>· {data.uniprot}</span>}
          </div>

          {/* explicit no-structure / no-pocket handling — never a zero/blank score */}
          {data.structure.kind === 'none' ? (
            <div style={{ fontSize: 12, color: c.muted, background: c.head, border: `1px dashed ${c.border}`, borderRadius: 8, padding: '10px 12px' }}>
              No structure available — pocket analysis not possible.
            </div>
          ) : data.pockets.length === 0 ? (
            <div style={{ fontSize: 12, color: c.muted, background: c.head, border: `1px dashed ${c.border}`, borderRadius: 8, padding: '10px 12px' }}>
              No pockets detected on this structure.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
                <thead>
                  <tr style={{ background: c.head }}>
                    <th style={{ ...th, textAlign: 'left' }}>Pocket</th>
                    <th style={th} title="Pocket volume (Å³)">Volume Å³</th>
                    <th style={th} title="Enclosure / buriedness, 0–1 (higher = more enclosed)">Enclosure</th>
                    <th style={th} title="Pocket depth (Å)">Depth Å</th>
                    <th style={th} title="Lipophilic character, 0–1 (higher = more hydrophobic)">Hydrophob.</th>
                    <th style={th} title="Shape: surface/volume (Å⁻¹). Lower = more compact/enclosed.">Shape (S/V)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pockets.map(p => (
                    <tr key={p.name} style={{ background: p.primary ? c.primaryBg : 'transparent', borderTop: `1px solid ${c.border}` }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: p.primary ? 800 : 600 }}>
                        {p.name}
                        {p.primary && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: c.primaryInk, background: isDark ? '#312e81' : '#e0e7ff', borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '.03em' }}>primary</span>}
                      </td>
                      <td style={td}>{p.volume}</td>
                      <td style={td}>{p.enclosure.toFixed(2)}</td>
                      <td style={td}>{p.depth.toFixed(1)}</td>
                      <td style={td}>{p.hydrophobicity.toFixed(2)}</td>
                      <td style={td}>{p.surfVol.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 9.5, color: c.muted, marginTop: 8, lineHeight: 1.4 }}>
            {data.note} <span style={{ opacity: 0.85 }}>Engine: {data.engine}. Primary = largest enclosed pocket shown.</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default PocketStructurePanel;
