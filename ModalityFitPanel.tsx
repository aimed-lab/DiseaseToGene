import React, { useState, useEffect, useRef } from 'react';
import { authenticatedFetch } from './supabase';
import { setLastModalityResult } from './modalityStore';
import type { MechanisticGoal } from './modalityConstants';

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

// The goal union comes from modalityConstants so the dropdown cannot drift out of step with
// the rules — a locally retyped list is how a goal ends up in the UI that the engine ignores.
type Goal = MechanisticGoal;
const GOALS: { key: Goal; label: string }[] = [
  { key: 'inhibit', label: 'Inhibit function' },
  { key: 'degrade', label: 'Degrade protein' },
  { key: 'reduce_level', label: 'Reduce level (knockdown)' },
  { key: 'spare_catalytic', label: 'Spare catalytic activity' },
  { key: 'restore_function', label: 'Restore / increase function' },
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

// Anchored tiers replace the old 0–5 number. There is deliberately NO bar length or
// numeric score: the tier IS the resolution the evidence supports, and a 0–100 feasibility
// number would imply a within-tier ranking the data cannot justify (that was the v1 design
// the methodology review rejected). Colour identifies the tier; the tint carries it calmly.
const TIER_COLOR: Record<Tier, string> = { Precedented: '#059669', Plausible: '#2563eb', Speculative: '#d97706', Blocked: '#64748b' };
const TIER_ORDER: Tier[] = ['Precedented', 'Plausible', 'Speculative', 'Blocked'];
const TIER_BLURB: Record<Tier, string> = {
  Precedented: 'drug exists', Plausible: 'evidence supports', Speculative: 'unsupported', Blocked: 'ruled out',
};
// A soft wash of the tier colour. Speculative is the EXPECTED outcome for most modalities on
// a novel target, so it must read as neutral — a saturated amber fill plus a warning glyph
// turned the normal case into an alarm and drained the colour of meaning.
const TIER_TINT = (t: Tier, dark: boolean): string => {
  const light: Record<Tier, string> = { Precedented: '#e7f6f0', Plausible: '#e8effc', Speculative: '#fdf1e1', Blocked: '#eef1f5' };
  const night: Record<Tier, string> = { Precedented: '#0d2a23', Plausible: '#14203a', Speculative: '#2f2211', Blocked: '#20262e' };
  return dark ? night[t] : light[t];
};

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace';

// The rationales carry the specifics that make the page credible — "2,613 measured
// bioactivities", "26 lysines", "1.42 Å". Setting those in a tabular face at heavier weight
// lifts the evidence out of the connective prose instead of burying it in a sentence.
// Lookaround keeps alphanumeric codes intact: without it "PDB 6RJ3" would split into a
// bold "6" and a bold "3" with letters stranded between them.
const NUM_SPLIT = /((?<![A-Za-z])\d[\d,]*(?:\.\d+)?\s?(?:Å|%)?(?![A-Za-z]))/g;
// Tested with a SEPARATE non-global pattern: a /g regex carries lastIndex between calls, so
// reusing the split pattern for .test() would match every other fragment.
const NUM_ONLY = /^\d[\d,]*(?:\.\d+)?\s?(?:Å|%)?$/;
function emphasiseNumbers(txt?: string): React.ReactNode {
  if (!txt) return null;
  return txt.split(NUM_SPLIT).map((part, i) =>
    NUM_ONLY.test(part)
      ? <span key={i} style={{ fontFamily: MONO, fontWeight: 700, fontSize: '0.96em' }}>{part}</span>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

// The structure label is prose ("Experimental · X-ray diffraction · 1.42 Å · PDB 6RJ3"), so
// the 4-character PDB code is pulled out of it. Returns null for AlphaFold models and for
// anything unparseable, which is what suppresses the thumbnail rather than showing a broken one.
function pdbIdFrom(label: string | null): string | null {
  const m = label?.match(/PDB\s+([0-9][A-Za-z0-9]{3})\b/);
  return m ? m[1].toUpperCase() : null;
}

// One line of plain English above the strip, so the result lands before any chart is read.
function verdictLine(counts: Record<Tier, number>, total: number): string {
  const parts: string[] = [];
  if (counts.Precedented) parts.push(`${counts.Precedented} precedented route${counts.Precedented === 1 ? '' : 's'}`);
  if (counts.Plausible)   parts.push(`${counts.Plausible} plausible`);
  if (counts.Speculative) parts.push(`${counts.Speculative} speculative`);
  const head = parts.length ? parts.join(' · ') : `${total} modalities assessed`;
  const tail = counts.Blocked ? `${counts.Blocked} ruled out` : 'nothing ruled out';
  return `${head} · ${tail}.`;
}

// Evidence rendered as discrete fields so it can be scanned. `missing: true` marks a value
// that was NOT retrieved this run — a gathering gap, not a finding about the protein. The
// two look identical in prose and lead to opposite conclusions, so they are tinted apart.
function evidenceFields(e: Evidence): { k: string; v: string; missing?: boolean }[] {
  const f: { k: string; v: string; missing?: boolean }[] = [];
  f.push({ k: 'Developed drugs', v: e.provenModalities.length ? e.provenModalities.map(p => `${p.family} (${p.drugCount}, ${p.topStage})`).join(', ') : 'none — novel target' });
  f.push({ k: 'Location', v: e.surfaceAccess && e.surfaceAccess !== 'unknown' ? `${e.surfaceAccess} · ${e.surfaceSource ?? ''}`.trim() : 'not determined', missing: !e.surfaceAccess || e.surfaceAccess === 'unknown' });
  f.push({ k: '3D structure', v: e.pocket.hasStructure ? (e.pocket.structureLabel ?? 'resolved') : 'none resolved', missing: !e.pocket.hasStructure });
  if (e.pocket.hasStructure) f.push({ k: 'Pockets', v: `${e.pocket.druggablePockets ?? 0} druggable-shaped of ${e.pocket.totalPockets}` });
  f.push({ k: 'ChEMBL bioactivities', v: e.chemblActivities != null ? e.chemblActivities.toLocaleString() : 'not retrieved', missing: e.chemblActivities == null });
  f.push({ k: 'STRING partners', v: e.ppiPartners != null ? String(e.ppiPartners) : 'not retrieved', missing: e.ppiPartners == null });
  f.push({ k: 'Exons', v: e.exonCount != null ? String(e.exonCount) : 'not retrieved', missing: e.exonCount == null });
  f.push({ k: 'Enzyme', v: e.likelyEnzyme ? `yes · ${e.activeSiteCount} active sites` : 'no annotated active site' });
  if (e.cysCount != null) f.push({ k: 'Cysteines', v: String(e.cysCount) });
  // Lysines drive the degrader basis ("N lysines for ubiquitin transfer") but were missing
  // from the old footer, so the reasoning cited a number the evidence never showed.
  if (e.lysineCount != null) f.push({ k: 'Lysines', v: String(e.lysineCount) });
  f.push({ k: 'Ubiquitination', v: e.isUbiquitinated ? 'known' : 'not annotated' });
  if (e.tractabilityBuckets.length) f.push({ k: 'OT tractable', v: e.tractabilityBuckets.map(b => b.modality).join(', ') });
  return f;
}

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
      // Hand the result to the co-pilot so it can answer questions about this exact chart
      // (tiers, gates and the basis behind them) instead of reasoning from scratch.
      setLastModalityResult(j);
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

      {data && (() => {
        const groups = TIER_ORDER
          .map(t => ({ tier: t, rows: data.modalities.filter(m => m.tier === t) }))
          .filter(g => g.rows.length > 0);
        const counts = Object.fromEntries(TIER_ORDER.map(t => [t, data.modalities.filter(m => m.tier === t).length])) as Record<Tier, number>;
        const total = data.modalities.length;

        // A goal cap (e.g. "occupancy does not change protein level") fires across a whole
        // class of modalities. Repeating it on six rows is noise, so any gate shared by 3+
        // modalities is hoisted into one note and suppressed on the cards themselves.
        const gateCounts = new Map<string, number>();
        for (const m of data.modalities) if (m.gate) gateCounts.set(m.gate, (gateCounts.get(m.gate) ?? 0) + 1);
        const sharedGates = [...gateCounts.entries()].filter(([, n]) => n >= 3);
        const isShared = (g: string | null) => !!g && (gateCounts.get(g) ?? 0) >= 3;

        // The rationale is written FROM the gate, so printing both usually says the same
        // thing twice. Show the gate only when the rationale does not already open with it.
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const restatesGate = (m: ModalityRow) => {
          if (!m.gate || !m.rationale) return false;
          const head = norm(m.gate).split(' ').slice(0, 4).join(' ');
          return head.length > 8 && norm(m.rationale).includes(head);
        };

        const pdb = pdbIdFrom(data.evidence.pocket.structureLabel);

        return (
        <div style={{ marginTop: 14 }}>
          {/* Verdict: the whole result in one glance. Segment WIDTH here encodes the
              proportion of modalities per tier, which is a real quantity — unlike the old
              per-row bars, whose length merely restated the tier. */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {pdb && (
              <img
                src={`https://cdn.rcsb.org/images/structures/${pdb.toLowerCase()}_assembly-1.jpeg`}
                alt={`Structure ${pdb}`} width={72} height={72} loading="lazy"
                onError={ev => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
                style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: `1px solid ${border}`, background: isDark ? '#111827' : '#f1f5f9', flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: text, lineHeight: 1.4 }}>{verdictLine(counts, total)}</div>
              <div style={{ fontSize: 11.5, color: muted, marginTop: 2 }}>
                goal: <strong style={{ color: text, fontWeight: 600 }}>{data.goalText}</strong>
                {pdb && <> · structure <span style={{ fontFamily: MONO, fontWeight: 600 }}>{pdb}</span></>}
              </div>

              <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginTop: 9, background: isDark ? '#111827' : '#eef2f7' }}>
                {TIER_ORDER.filter(t => counts[t] > 0).map(t => (
                  <div key={t} title={`${counts[t]} ${t}`} style={{ width: `${(counts[t] / total) * 100}%`, background: TIER_COLOR[t] }} />
                ))}
              </div>

              <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap', marginTop: 7 }}>
                {TIER_ORDER.map(t => (
                  <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: counts[t] ? text : muted }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: TIER_COLOR[t], opacity: counts[t] ? 1 : 0.35 }} />
                    <span style={{ fontFamily: MONO, fontWeight: 700 }}>{counts[t]}</span> {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {sharedGates.length > 0 && (
            <div style={{ fontSize: 11.5, color: muted, marginTop: 14, lineHeight: 1.5, maxWidth: '70ch' }}>
              {sharedGates.map(([g, n]) => (
                <div key={g} style={{ marginBottom: 2 }}>
                  <strong style={{ color: text, fontWeight: 600 }}>Applies to {n} modalities:</strong> {g}.
                </div>
              ))}
            </div>
          )}

          {/* Groups are separated by noticeably more space than the cards inside them, so the
              grouping is legible before any text is read. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26, marginTop: 18 }}>
            {groups.map(({ tier, rows }) => (
              <div key={tier}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: TIER_COLOR[tier], background: TIER_TINT(tier, isDark),
                    border: `1px solid ${TIER_COLOR[tier]}33`, borderRadius: 999, padding: '3px 9px',
                  }}>{tier}</span>
                  <span style={{ fontSize: 10.5, color: muted }}>
                    <span style={{ fontFamily: MONO, fontWeight: 700 }}>{rows.length}</span> of{' '}
                    <span style={{ fontFamily: MONO, fontWeight: 700 }}>{total}</span> · {TIER_BLURB[tier]}
                  </span>
                  <span style={{ flex: 1, height: 1, background: border }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(268px, 1fr))', gap: 8 }}>
                  {rows.map(m => (
                    <div key={m.modality} style={{
                      borderLeft: `3px solid ${TIER_COLOR[tier]}`,   // spine keeps tier identity alive once the group header scrolls away
                      background: isDark ? '#0b1220' : '#f8fafc',
                      borderRadius: '0 8px 8px 0', padding: '9px 11px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 650, color: tier === 'Blocked' ? muted : text }}>{m.modality}</span>
                        {/* Class tags muted to grey so the tier colours own the colour channel. */}
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{m.category}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: text, opacity: 0.82, marginTop: 3, lineHeight: 1.5, maxWidth: '70ch' }}>
                        {m.gate && !isShared(m.gate) && !restatesGate(m) && <span style={{ fontWeight: 650 }}>{m.gate}. </span>}
                        {emphasiseNumbers(m.rationale)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* An empty Blocked group is a real finding — nothing was ruled out — so it is
                stated rather than silently omitted, which also completes the tier scale. */}
            {counts.Blocked === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: muted, background: 'transparent', border: `1px dashed ${border}`, borderRadius: 999, padding: '3px 9px',
                }}>Blocked</span>
                <span style={{ fontSize: 10.5, color: muted }}>
                  <span style={{ fontFamily: MONO, fontWeight: 700 }}>0</span> of{' '}
                  <span style={{ fontFamily: MONO, fontWeight: 700 }}>{total}</span> · nothing is ruled out for this goal
                </span>
                <span style={{ flex: 1, height: 1, background: border }} />
              </div>
            )}
          </div>

          {/* Evidence as an instrument readout: mono key/value chips in a tinted band.
              Fields that could not be fetched stay marked, because "not retrieved" and
              "no evidence exists" lead to opposite conclusions. */}
          <div style={{ marginTop: 20, padding: '11px 12px', borderRadius: 10, background: isDark ? '#0b1220' : '#f1f5f9', border: `1px solid ${border}` }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: muted, marginBottom: 8 }}>
              Evidence used{data.evidence.uniprot ? <span style={{ fontFamily: MONO, marginLeft: 6, letterSpacing: 0 }}>{data.evidence.uniprot}</span> : null}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {evidenceFields(data.evidence).map(f => (
                <span key={f.k} style={{
                  display: 'inline-flex', alignItems: 'baseline', gap: 6,
                  background: isDark ? '#111827' : '#ffffff', border: `1px solid ${f.missing ? `${TIER_COLOR.Speculative}55` : border}`,
                  borderRadius: 6, padding: '4px 8px', maxWidth: '100%',
                }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: muted }}>{f.k}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: f.missing ? TIER_COLOR.Speculative : text }}>{f.v}</span>
                </span>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: muted, lineHeight: 1.45, maxWidth: '70ch' }}>
              Tiers are set by <strong style={{ color: text }}>deterministic rules</strong> and are reproducible.
              Only the one-line rationale is model-written (temperature 0), restricted to the evidence above.
            </div>
            {data.evidence.notes.map((n, i) => (
              <div key={i} style={{ marginTop: 4, fontSize: 11, color: TIER_COLOR.Speculative, lineHeight: 1.4, maxWidth: '70ch' }}>{n}</div>
            ))}
          </div>
        </div>
        );
      })()}
    </div>
  );
};

// ── Self-contained HTML report (matches targetReport.ts styling) ──
function buildModalityReportHTML(d: FitResult): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const TCOL: Record<string, string> = { Precedented: '#059669', Plausible: '#2563eb', Speculative: '#d97706', Blocked: '#64748b' };
  const TTINT: Record<string, string> = { Precedented: '#e7f6f0', Plausible: '#e8effc', Speculative: '#fdf1e1', Blocked: '#eef1f5' };
  const CCOL: Record<string, string> = { 'Biologic': '#22a03f', 'RNA/genetic': '#9b6dd6', 'Peptide': '#f08c1e', 'Induced-proximity': '#8a5a4a', 'Small molecule': '#d13a2b' };

  // Same corrections as the on-screen panel: the tier is stated once per group rather than
  // re-encoded as a bar length, a goal cap shared by 3+ modalities is hoisted into one note,
  // and the gate is dropped when the rationale already opens with it.
  const gateCounts = new Map<string, number>();
  for (const m of d.modalities) if (m.gate) gateCounts.set(m.gate, (gateCounts.get(m.gate) ?? 0) + 1);
  const sharedGates = [...gateCounts.entries()].filter(([, n]) => n >= 3);
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const showGate = (m: FitResult['modalities'][number]) => {
    if (!m.gate || (gateCounts.get(m.gate) ?? 0) >= 3) return false;
    if (!m.rationale) return true;
    const head = norm(m.gate).split(' ').slice(0, 4).join(' ');
    return !(head.length > 8 && norm(m.rationale).includes(head));
  };

  const sharedNote = sharedGates.map(([g, n]) =>
    `<div class="shared"><b>Applies to ${n} modalities:</b> ${esc(g)}.</div>`).join('');

  const rows = (['Precedented', 'Plausible', 'Speculative', 'Blocked'] as const)
    .map(t => ({ t, ms: d.modalities.filter(m => m.tier === t) }))
    .filter(g => g.ms.length > 0)
    .map(({ t, ms }) => `
    <div class="grp">
      <div class="ghead"><span class="chip" style="color:${TCOL[t]};background:${TTINT[t]};border-color:${TCOL[t]}33">${esc(t).toUpperCase()}</span>
        <span class="gcount">${ms.length} of ${d.modalities.length} modalities</span></div>
      ${ms.map(m => `
      <div class="item">
        <div class="lbl"${t === 'Blocked' ? ' style="color:#94a3b8"' : ''}>${esc(m.modality)}
          <span class="cat" style="color:${CCOL[m.category] || '#64748b'}">${esc(m.category)}</span></div>
        <div class="rat">${showGate(m) ? `<b>${esc(m.gate)}. </b>` : ''}${esc(m.rationale)}</div>
      </div>`).join('')}
    </div>`).join('');
  const legend = ['Precedented', 'Plausible', 'Speculative', 'Blocked'].map(t => `<span class="lg"><i style="background:${TCOL[t]}"></i>${t}</span>`).join('');
  const e = d.evidence;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.gene)} — modality fit</title><style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:860px;margin:0 auto;padding:32px}
  .brand{font-size:11px;font-weight:800;color:#2563eb;text-transform:lowercase}
  h1{font-size:24px;margin:4px 0} .sub{color:#64748b;font-size:13px;margin:0 0 18px}
  .grp{margin:0 0 18px;break-inside:avoid}
  .ghead{display:flex;align-items:center;gap:9px;margin:0 0 8px;padding-bottom:5px;border-bottom:1px solid #e2e8f0}
  .chip{font-size:10px;font-weight:800;letter-spacing:.06em;border:1px solid;border-radius:999px;padding:3px 9px}
  .gcount{font-size:10.5px;color:#64748b}
  .shared{font-size:11.5px;color:#475569;margin:0 0 12px;line-height:1.5} .shared b{color:#0f172a}
  .item{margin:0 0 9px;break-inside:avoid}
  .lbl{font-size:12.5px;font-weight:650}
  .cat{font-size:10px;font-weight:700;margin-left:8px}
  .rat{font-size:11.5px;color:#334155;margin:2px 0 0;line-height:1.45}
  .legend{display:flex;gap:14px;margin:16px 0;flex-wrap:wrap} .lg{display:flex;align-items:center;gap:5px;font-size:11px;color:#475569} .lg i{width:11px;height:11px;border-radius:2px;display:inline-block}
  .ev{margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:1.6}
  .toolbar{margin-bottom:14px} button{font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:8px;border:1px solid #e2e8f0;background:#2563eb;color:#fff;cursor:pointer}
  @media print{.toolbar{display:none}}
  </style></head><body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="brand">target.smartdrugdiscovery.com</div>
  <h1>Modality fit for ${esc(d.gene)}</h1>
  <p class="sub">Whole-protein feasibility tiers · goal: <b>${esc(d.goalText)}</b> · Precedented &gt; Plausible &gt; Speculative &gt; Blocked. Tiers are rule-based (deterministic); rationale is model-written (temp 0).</p>
  ${sharedNote}${rows}
  <div class="legend">${legend}</div>
  <div class="ev"><b>Evidence:</b> ${e.uniprot ? `UniProt ${esc(e.uniprot)} · ` : ''}${e.pocket.hasStructure ? `${esc(e.pocket.structureLabel)} · ${e.pocket.totalPockets} pockets` : 'no structure'}${e.likelyEnzyme ? ` · enzyme (${e.activeSiteCount} active sites)` : ''}${e.cysCount != null ? ` · ${e.cysCount} Cys` : ''}${e.tractabilityBuckets.length ? ` · OT tractable: ${esc(e.tractabilityBuckets.map(b => b.modality).join(', '))}` : ''}${e.provenModalities.length ? ` · developed: ${esc(e.provenModalities.map(p => p.family).join(', '))}` : ' · no developed drugs (novel target)'}.
  <div style="margin-top:6px"><b>Provenance.</b> ${esc(d.provenance)}</div></div>
  </body></html>`;
}

export default ModalityFitPanel;
