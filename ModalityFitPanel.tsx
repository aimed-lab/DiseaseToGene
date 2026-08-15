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

type Tier = 'Precedented' | 'Plausible' | 'Speculative' | 'Blocked';
interface ModalityRow { category: string; modality: string; tier: Tier; gate: string | null; rationale?: string; }
interface Evidence {
  uniprot: string | null; subcellularLocations: string[]; likelyEnzyme: boolean; activeSiteCount: number | null;
  surfaceAccess?: string; surfaceSource?: string; isUbiquitinated?: boolean; lysineCount?: number | null;
  sequenceLength: number | null; cysCount: number | null;
  pocket: { hasStructure: boolean; structureLabel: string | null; totalPockets: number; druggablePockets?: number; topVolume: number | null; druggabilityProxy: number | null };
  tractabilityBuckets: { modality: string }[]; provenModalities: { family: string; drugCount: number; topStage: string }[];
  chemblActivities?: number | null; ppiPartners?: number | null; exonCount?: number | null; notes: string[];
}
interface FitResult { gene: string; goal: Goal; goalText: string; evidence: Evidence; modalities: ModalityRow[]; provenance: string; }

// Anchored tiers replace the old 0–5 number. Colour + a fill fraction for the bar.
const TIER_COLOR: Record<Tier, string> = { Precedented: '#059669', Plausible: '#2563eb', Speculative: '#d97706', Blocked: '#64748b' };
const TIER_FRAC:  Record<Tier, number> = { Precedented: 1, Plausible: 0.66, Speculative: 0.4, Blocked: 0.14 };
const TIER_ORDER: Tier[] = ['Precedented', 'Plausible', 'Speculative', 'Blocked'];

export const ModalityFitPanel: React.FC<Props> = ({ geneSymbol, theme = 'light', autoRun = false }) => {
  const isDark = theme === 'dark';
  const [goal, setGoal] = useState<Goal>('inhibit');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const autoRan = useRef(false);

  // Tick a visible elapsed counter while the analysis runs. A first-time gene can take
  // ~30-40s (the Ensembl transcript lookup dominates), and a single static line gave no
  // sign the request was still alive — users assumed it had hung.
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [loading]);

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
        <span title="Which therapeutic modality suits this target. Hard evidence (structure, pockets, tractability, localization) gathered live; the feasibility TIER is set by deterministic rules (goal × modality + localization gates). Only the one-line rationale is model-written (temp 0)." style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: '#0e7490', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Rule-based tiers</span>
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

      {loading && (
        <div style={{
          marginTop: 12, padding: '14px 16px', borderRadius: 10,
          border: `1px solid ${border}`, background: isDark ? '#0b1220' : '#f8fafc',
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span className="spinner" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2, borderTopColor: '#2563eb' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: text }}>
              Analyzing {geneSymbol}… <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: muted }}>{elapsed}s</span>
            </div>
            <div style={{ fontSize: 12.5, color: text, opacity: 0.85, marginTop: 5, lineHeight: 1.5 }}>
              Gathering Open Targets tractability &amp; developed drugs, DoGSite3 pockets, UniProt
              localization, ChEMBL bioactivity, STRING partners and Ensembl exons — then applying
              the tier rules.
            </div>
            {elapsed >= 10 && (
              <div style={{ fontSize: 12, color: muted, marginTop: 7 }}>
                Still running — a gene analysed for the first time usually takes 30–40 seconds.
                Results are cached upstream, so a re-run is much faster.
              </div>
            )}
          </div>
        </div>
      )}
      {error && <div style={{ color: '#f43f5e', marginTop: 12, fontWeight: 600 }}>{error}</div>}

      {data && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: muted, marginBottom: 8 }}>Feasibility tier for {data.gene} · goal: <strong style={{ color: text }}>{data.goalText}</strong></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {data.modalities.map(m => (
              <div key={m.modality}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(84px, 120px) 1fr', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, textAlign: 'right', color: m.tier === 'Blocked' ? muted : text, lineHeight: 1.15, textDecoration: m.tier === 'Blocked' ? 'line-through' : 'none' }}>{m.modality}</div>
                  <div style={{ position: 'relative', height: 18, background: isDark ? '#111827' : '#eef2f7', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${TIER_FRAC[m.tier] * 100}%`, minWidth: 3, background: TIER_COLOR[m.tier], borderRadius: 4, transition: 'width .3s ease', opacity: m.tier === 'Blocked' ? 0.55 : 1 }} />
                    <span style={{ position: 'absolute', left: 7, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 9, fontWeight: 800, color: '#fff', letterSpacing: '0.02em' }}>{m.tier.toUpperCase()}</span>
                    <span style={{ position: 'absolute', right: 6, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 8, fontWeight: 700, color: CATEGORY_COLOR[m.category] || muted }}>{m.category}</span>
                  </div>
                </div>
                {/* rationale + hard-gate on their own line, dark — readable and print-safe */}
                <div style={{ fontSize: 9.5, color: muted, marginTop: 3, lineHeight: 1.35 }}>
                  {m.gate && <span style={{ color: TIER_COLOR[m.tier === 'Blocked' ? 'Blocked' : 'Speculative'], fontWeight: 700 }}>⚠ {m.gate}. </span>}
                  {m.rationale}
                </div>
              </div>
            ))}
          </div>

          {/* tier legend */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
            {TIER_ORDER.map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: muted }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: TIER_COLOR[t] }} />{t}
              </span>
            ))}
          </div>

          {/* evidence footer */}
          <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
            <strong style={{ color: text }}>Evidence:</strong> {data.evidence.uniprot ? `UniProt ${data.evidence.uniprot} · ` : ''}
            {data.evidence.surfaceAccess ? `access: ${data.evidence.surfaceAccess}${data.evidence.surfaceSource ? ` (${data.evidence.surfaceSource})` : ''} · ` : ''}
            {data.evidence.pocket.hasStructure ? `${data.evidence.pocket.structureLabel} · ${data.evidence.pocket.totalPockets} pockets${data.evidence.pocket.druggablePockets != null ? ` (${data.evidence.pocket.druggablePockets} druggable-shaped)` : ''}` : 'no structure'}
            {data.evidence.likelyEnzyme ? ` · enzyme (${data.evidence.activeSiteCount} active site${data.evidence.activeSiteCount === 1 ? '' : 's'})` : ''}
            {data.evidence.cysCount != null ? ` · ${data.evidence.cysCount} Cys` : ''}
            {data.evidence.tractabilityBuckets.length ? ` · OT tractable: ${data.evidence.tractabilityBuckets.map(b => b.modality).join(', ')}` : ''}
            {data.evidence.chemblActivities != null ? ` · ChEMBL: ${data.evidence.chemblActivities.toLocaleString()} bioactivities` : ''}
            {data.evidence.ppiPartners != null ? ` · STRING: ${data.evidence.ppiPartners} hi-conf partners` : ''}
            {data.evidence.exonCount != null ? ` · ${data.evidence.exonCount} exons` : ''}
            {data.evidence.isUbiquitinated ? ' · known ubiquitination' : ''}
            {data.evidence.provenModalities.length ? ` · developed: ${data.evidence.provenModalities.map(p => p.family).join(', ')}` : ' · no developed drugs (novel)'}
            <div style={{ marginTop: 4, fontStyle: 'italic' }}>Tiers are set by <strong>deterministic rules</strong> (reproducible). Only the one-line rationale is model-written (temperature 0), restricted to the evidence above.</div>
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
  const TCOL: Record<string, string> = { Precedented: '#059669', Plausible: '#2563eb', Speculative: '#d97706', Blocked: '#64748b' };
  const TFRAC: Record<string, number> = { Precedented: 1, Plausible: 0.66, Speculative: 0.4, Blocked: 0.14 };
  const rows = d.modalities.map(m => `
    <div class="item">
      <div class="row">
        <div class="lbl"${m.tier === 'Blocked' ? ' style="text-decoration:line-through;color:#94a3b8"' : ''}>${esc(m.modality)}</div>
        <div class="track"><div class="fill" style="width:${TFRAC[m.tier] * 100}%;background:${TCOL[m.tier]};opacity:${m.tier === 'Blocked' ? 0.55 : 1}"></div>
          <span class="tier">${esc(m.tier).toUpperCase()}</span><span class="cat" style="color:${({ 'Biologic': '#22a03f', 'RNA/genetic': '#9b6dd6', 'Peptide': '#f08c1e', 'Induced-proximity': '#8a5a4a', 'Small molecule': '#d13a2b' } as Record<string, string>)[m.category] || '#64748b'}">${esc(m.category)}</span></div>
      </div>
      <div class="rat">${m.gate ? `<b style="color:${TCOL[m.tier]}">⚠ ${esc(m.gate)}. </b>` : ''}${esc(m.rationale)}</div>
    </div>`).join('');
  const legend = ['Precedented', 'Plausible', 'Speculative', 'Blocked'].map(t => `<span class="lg"><i style="background:${TCOL[t]}"></i>${t}</span>`).join('');
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
  .tier{position:absolute;left:8px;top:0;bottom:0;display:flex;align-items:center;font-size:9px;font-weight:800;color:#fff;letter-spacing:.03em}
  .cat{position:absolute;right:7px;top:0;bottom:0;display:flex;align-items:center;font-size:8px;font-weight:700}
  .rat{font-size:10.5px;color:#475569;margin:3px 0 0 180px;line-height:1.4}
  .legend{display:flex;gap:14px;margin:16px 0;flex-wrap:wrap} .lg{display:flex;align-items:center;gap:5px;font-size:11px;color:#475569} .lg i{width:11px;height:11px;border-radius:2px;display:inline-block}
  .ev{margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:1.6}
  .toolbar{margin-bottom:14px} button{font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:8px;border:1px solid #e2e8f0;background:#2563eb;color:#fff;cursor:pointer}
  @media print{.toolbar{display:none} .rat{margin-left:180px}}
  </style></head><body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="brand">target.smartdrugdiscovery.com</div>
  <h1>Modality fit for ${esc(d.gene)}</h1>
  <p class="sub">Whole-protein feasibility tiers · goal: <b>${esc(d.goalText)}</b> · Precedented &gt; Plausible &gt; Speculative &gt; Blocked. Tiers are rule-based (deterministic); rationale is model-written (temp 0).</p>
  ${rows}
  <div class="legend">${legend}</div>
  <div class="ev"><b>Evidence:</b> ${e.uniprot ? `UniProt ${esc(e.uniprot)} · ` : ''}${e.pocket.hasStructure ? `${esc(e.pocket.structureLabel)} · ${e.pocket.totalPockets} pockets` : 'no structure'}${e.likelyEnzyme ? ` · enzyme (${e.activeSiteCount} active sites)` : ''}${e.cysCount != null ? ` · ${e.cysCount} Cys` : ''}${e.tractabilityBuckets.length ? ` · OT tractable: ${esc(e.tractabilityBuckets.map(b => b.modality).join(', '))}` : ''}${e.provenModalities.length ? ` · developed: ${esc(e.provenModalities.map(p => p.family).join(', '))}` : ' · no developed drugs (novel target)'}.
  <div style="margin-top:6px"><b>Provenance.</b> ${esc(d.provenance)}</div></div>
  </body></html>`;
}

export default ModalityFitPanel;
