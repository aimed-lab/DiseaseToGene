import React, { useState, useEffect, useRef } from 'react';
import { authenticatedFetch } from './supabase';

// F-MOD (M4/M5/M6) — On-demand modality-fit chart for one target. A goal selector +
// "Generate" button calls POST /api/modality-fit; the result renders as a horizontal
// bar chart (0–5) coloured by category, rationale on each bar (matching the professor's
// figure), with a "Download report" (HTML → print/Save-as-PDF) action. Scores are
// AI-assessed predictions; the hard evidence used is shown in the footer.

interface Props {
  geneSymbol: string;
  theme?: 'dark' | 'light';
  autoRun?: boolean;   // generate once on mount (used by the full-page view arriving with a preselected gene)
}

type Goal = 'inhibit' | 'degrade' | 'reduce_level' | 'spare_catalytic';
const GOALS: { key: Goal; label: string }[] = [
  { key: 'inhibit', label: 'Inhibit function' },
  { key: 'degrade', label: 'Degrade protein' },
  { key: 'reduce_level', label: 'Reduce level (knockdown)' },
  { key: 'spare_catalytic', label: 'Spare catalytic activity' },
];

const CATEGORY_COLOR: Record<string, string> = {
  'Biologic': '#22a03f', 'RNA/genetic': '#9b6dd6', 'Peptide': '#f08c1e',
  'Induced-proximity': '#8a5a4a', 'Small molecule': '#d13a2b',
};

interface ModalityScore { category: string; modality: string; score: number; rationale: string; }
interface Evidence {
  uniprot: string | null; subcellularLocations: string[]; likelyEnzyme: boolean; activeSiteCount: number | null;
  sequenceLength: number | null; cysCount: number | null;
  pocket: { hasStructure: boolean; structureLabel: string | null; totalPockets: number; topVolume: number | null; druggabilityProxy: number | null };
  tractabilityBuckets: { modality: string }[]; provenModalities: { family: string; drugCount: number; topStage: string }[]; notes: string[];
}
interface FitResult { gene: string; goal: Goal; goalText: string; evidence: Evidence; modalities: ModalityScore[]; provenance: string; }

export const ModalityFitPanel: React.FC<Props> = ({ geneSymbol, theme = 'light', autoRun = false }) => {
  const isDark = theme === 'dark';
  const [goal, setGoal] = useState<Goal>('inhibit');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const wrap: React.CSSProperties = { border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12, background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text };

  const run = async () => {
    setLoading(true); setError(null); setData(null);
    try {
      const r = await authenticatedFetch('/api/modality-fit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gene: geneSymbol, goal }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j as FitResult);
    } catch (e: any) { setError(e.message || 'Failed to generate modality analysis.'); }
    finally { setLoading(false); }
  };

  // Auto-generate once when the full-page view arrives with a preselected gene.
  useEffect(() => {
    if (autoRun && geneSymbol && !autoRan.current) { autoRan.current = true; run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, geneSymbol]);

  const downloadReport = () => {
    if (!data) return;
    const html = buildModalityReportHTML(data);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (!w) { const a = document.createElement('a'); a.href = url; a.download = `${data.gene}_modality_fit.html`; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Modality fit · {geneSymbol}</span>
        <span title="Which therapeutic modality suits this target. Hard evidence (structure, pockets, tractability, localization) gathered live; 0–5 plausibility scored by AI against your goal." style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: '#f08c1e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI-assessed</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Goal</label>
        <select value={goal} onChange={e => setGoal(e.target.value as Goal)}
          style={{ background: isDark ? '#111827' : '#f8fafc', color: text, border: `1px solid ${border}`, borderRadius: 8, padding: '6px 8px', fontSize: 12 }}>
          {GOALS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <button onClick={run} disabled={loading}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Analyzing…' : data ? 'Re-run' : 'Generate modality analysis'}
        </button>
        {data && <button onClick={downloadReport} style={{ background: 'transparent', color: text, border: `1px solid ${border}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Download report</button>}
      </div>

      {loading && <div style={{ color: muted, fontStyle: 'italic', marginTop: 12 }}>Gathering structure, pockets, tractability &amp; localization, then scoring {geneSymbol}…</div>}
      {error && <div style={{ color: '#f43f5e', marginTop: 12, fontWeight: 600 }}>{error}</div>}

      {data && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: muted, marginBottom: 8 }}>Plausibility for {data.gene} (0 = disfavored, 5 = favored) · goal: <strong style={{ color: text }}>{data.goalText}</strong></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {data.modalities.map(m => (
              <div key={m.modality}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(84px, 120px) 1fr', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, textAlign: 'right', color: text, lineHeight: 1.15 }}>{m.modality}</div>
                  <div style={{ position: 'relative', height: 18, background: isDark ? '#111827' : '#eef2f7', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${(m.score / 5) * 100}%`, minWidth: 3, background: CATEGORY_COLOR[m.category] || '#64748b', borderRadius: 4, transition: 'width .3s ease' }} />
                    <span style={{ position: 'absolute', left: 6, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 9.5, fontWeight: 800, color: m.score >= 0.5 ? '#fff' : text }}>{m.score.toFixed(1)}</span>
                  </div>
                </div>
                {/* rationale on its own line, dark — readable regardless of bar length */}
                <div style={{ fontSize: 9.5, color: muted, marginTop: 3, lineHeight: 1.35 }}>{m.rationale}</div>
              </div>
            ))}
          </div>

          {/* legend */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            {Object.entries(CATEGORY_COLOR).map(([cat, col]) => (
              <span key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: muted }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: col }} />{cat}
              </span>
            ))}
          </div>

          {/* evidence footer */}
          <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
            <strong style={{ color: text }}>Evidence:</strong> {data.evidence.uniprot ? `UniProt ${data.evidence.uniprot} · ` : ''}
            {data.evidence.pocket.hasStructure ? `${data.evidence.pocket.structureLabel} · ${data.evidence.pocket.totalPockets} pockets` : 'no structure'}
            {data.evidence.likelyEnzyme ? ` · enzyme (${data.evidence.activeSiteCount} active site${data.evidence.activeSiteCount === 1 ? '' : 's'})` : ''}
            {data.evidence.cysCount != null ? ` · ${data.evidence.cysCount} Cys` : ''}
            {data.evidence.tractabilityBuckets.length ? ` · OT tractable: ${data.evidence.tractabilityBuckets.map(b => b.modality).join(', ')}` : ''}
            {data.evidence.provenModalities.length ? ` · developed: ${data.evidence.provenModalities.map(p => p.family).join(', ')}` : ' · no developed drugs (novel)'}
            <div style={{ marginTop: 4, fontStyle: 'italic' }}>Scores are an <strong>AI assessment</strong> (a prediction), grounded in the facts above — not a measurement.</div>
            {data.evidence.notes.map((n, i) => <div key={i} style={{ marginTop: 2 }}>⚠ {n}</div>)}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Self-contained HTML report (matches targetReport.ts styling) ──
function buildModalityReportHTML(d: FitResult): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const COL: Record<string, string> = { 'Biologic': '#22a03f', 'RNA/genetic': '#9b6dd6', 'Peptide': '#f08c1e', 'Induced-proximity': '#8a5a4a', 'Small molecule': '#d13a2b' };
  const rows = d.modalities.map(m => `
    <div class="item">
      <div class="row">
        <div class="lbl">${esc(m.modality)}</div>
        <div class="track"><div class="fill" style="width:${(m.score / 5) * 100}%;background:${COL[m.category] || '#64748b'}"></div>
          <span class="score" style="color:${m.score >= 0.5 ? '#fff' : '#0f172a'}">${m.score.toFixed(1)}</span></div>
      </div>
      <div class="rat">${esc(m.rationale)}</div>
    </div>`).join('');
  const legend = Object.entries(COL).map(([c, col]) => `<span class="lg"><i style="background:${col}"></i>${esc(c)}</span>`).join('');
  const e = d.evidence;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.gene)} — modality fit</title><style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:860px;margin:0 auto;padding:32px}
  .brand{font-size:11px;font-weight:800;color:#2563eb;text-transform:lowercase}
  h1{font-size:24px;margin:4px 0} .sub{color:#64748b;font-size:13px;margin:0 0 18px}
  .item{margin:10px 0;break-inside:avoid}
  .row{display:grid;grid-template-columns:170px 1fr;gap:10px;align-items:center}
  .lbl{font-size:11px;font-weight:600;text-align:right}
  .track{position:relative;height:20px;background:#eef2f7;border-radius:4px;overflow:hidden}
  .fill{position:absolute;top:0;left:0;bottom:0;min-width:3px;border-radius:4px}
  .score{position:absolute;left:7px;top:0;bottom:0;display:flex;align-items:center;font-size:10px;font-weight:800}
  .rat{font-size:10.5px;color:#475569;margin:3px 0 0 180px;line-height:1.4}
  .legend{display:flex;gap:14px;margin:16px 0;flex-wrap:wrap} .lg{display:flex;align-items:center;gap:5px;font-size:11px;color:#475569} .lg i{width:11px;height:11px;border-radius:2px;display:inline-block}
  .ev{margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:1.6}
  .toolbar{margin-bottom:14px} button{font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:8px;border:1px solid #e2e8f0;background:#2563eb;color:#fff;cursor:pointer}
  @media print{.toolbar{display:none} .rat{margin-left:180px}}
  </style></head><body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="brand">target.smartdrugdiscovery.com</div>
  <h1>Modality ranking for ${esc(d.gene)}</h1>
  <p class="sub">Whole-protein modality fit · goal: <b>${esc(d.goalText)}</b> · plausibility 0 (disfavored) → 5 (favored)</p>
  ${rows}
  <div class="legend">${legend}</div>
  <div class="ev"><b>Evidence:</b> ${e.uniprot ? `UniProt ${esc(e.uniprot)} · ` : ''}${e.pocket.hasStructure ? `${esc(e.pocket.structureLabel)} · ${e.pocket.totalPockets} pockets` : 'no structure'}${e.likelyEnzyme ? ` · enzyme (${e.activeSiteCount} active sites)` : ''}${e.cysCount != null ? ` · ${e.cysCount} Cys` : ''}${e.tractabilityBuckets.length ? ` · OT tractable: ${esc(e.tractabilityBuckets.map(b => b.modality).join(', '))}` : ''}${e.provenModalities.length ? ` · developed: ${esc(e.provenModalities.map(p => p.family).join(', '))}` : ' · no developed drugs (novel target)'}.
  <div style="margin-top:6px"><b>Provenance.</b> ${esc(d.provenance)}</div></div>
  </body></html>`;
}

export default ModalityFitPanel;
