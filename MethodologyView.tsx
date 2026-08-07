// MethodologyView — the "how we rank" page for the Target Ranking Board.
// Modelled on the U.S. News Best-Colleges methodology: a transparent table of
// INDICATORS and their WEIGHTS (each modality column sums to 100), plus the
// definition, data source, and evidence sub-metrics behind every criterion.
// Everything is derived from rankingBoard.ts (CRITERIA / MODALITY_PROFILES /
// criterionBreakdown) so this page can never drift from the engine it documents.
import React from 'react';
import { X, Trophy, ShieldCheck, FlaskConical, Ban, Scale, Gauge } from 'lucide-react';
import { CRITERIA, MODALITY_PROFILES, CORE_CRITERIA, criterionBreakdown, type ModalityKey, type CriterionKey } from './rankingBoard';

const MODALITY_ORDER: ModalityKey[] = ['small_molecule', 'antibody', 'protac', 'mrna', 'gene_therapy'];
// Short column headers (the full labels are too wide for a 5-column table).
const MODALITY_SHORT: Record<ModalityKey, string> = {
  small_molecule: 'Small molecule', antibody: 'Antibody / ADC', protac: 'Degrader', mrna: 'mRNA / siRNA', gene_therapy: 'Gene therapy',
};

const wpct = (m: ModalityKey, k: CriterionKey) => Math.round((MODALITY_PROFILES[m].weights[k] || 0) * 100);

// A criterion is "prediction-weighted" if its scoring term comes from a model output
// (tractability, network) rather than measured evidence — derived from the breakdown.
function criterionKind(k: CriterionKey): 'fact' | 'prediction' {
  const terms = criterionBreakdown(k, {}).metrics.filter(m => m.role === 'term');
  return terms.some(t => t.kind === 'prediction') ? 'prediction' : 'fact';
}

export default function MethodologyView({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const card = isDark ? 'bg-[#0d1424] border-slate-800' : 'bg-white border-slate-200';
  const sub = isDark ? 'text-slate-400' : 'text-slate-600';
  const heading = isDark ? 'text-slate-100' : 'text-slate-900';

  const KindTag = ({ kind }: { kind: 'fact' | 'prediction' }) => (
    <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded ${kind === 'fact' ? (isDark ? 'bg-emerald-950 text-emerald-400' : 'bg-emerald-100 text-emerald-700') : (isDark ? 'bg-violet-950 text-violet-300' : 'bg-violet-100 text-violet-700')}`}>
      {kind === 'fact' ? <ShieldCheck className="w-2.5 h-2.5" /> : <FlaskConical className="w-2.5 h-2.5" />}{kind}
    </span>
  );

  return (
    <div className={`fixed inset-0 flex flex-col ${isDark ? 'bg-[#080e18]' : 'bg-slate-50'}`} style={{ zIndex: 99998 }}>
      {/* header */}
      <div className={`shrink-0 border-b px-6 py-3.5 flex items-center justify-between ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
        <div className="flex items-center gap-2.5">
          <Trophy className="w-5 h-5 text-amber-500" />
          <div>
            <h1 className={`text-base font-black ${heading}`}>Ranking Methodology</h1>
            <p className={`text-[11px] ${sub}`}>How the Target Ranking Board scores and orders targets</p>
          </div>
        </div>
        <button onClick={onClose} className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-9">

          {/* ── The approach ── */}
          <section className="space-y-3">
            <p className={`text-[13px] leading-relaxed ${sub}`}>
              For a chosen disease, every candidate target is scored by a <strong className={heading}>transparent weighted sum</strong> across
              eight evidence criteria — the same idea behind the U.S. News Best-Colleges ranking (a subject scored on weighted indicators, then
              placed on a 0–100 scale). Here the <em>subject</em> is the disease, the <em>indicators</em> are the eight evidence criteria, and
              the field <strong className={heading}>leader is rescaled to 100</strong>. Nothing is a black box: each number traces to a named
              public source, and the weights are shown below and adjustable in the board.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { icon: Scale, t: 'Weighted sum, leader = 100', d: 'Overall = Σ (criterion score × weight) over the criteria a target has data for, rescaled so the disease’s strongest eligible target = 100.' },
                { icon: Gauge, t: 'Modality is the lever', d: 'Choosing small-molecule vs antibody vs siRNA swaps the weight vector (and can gate ineligible targets), so the ranking reshuffles live.' },
                { icon: ShieldCheck, t: 'Fact vs prediction, never mixed', d: 'Measured evidence and model predictions are tagged separately. Novel targets are not punished for lacking trials or papers.' },
              ].map((b, i) => (
                <div key={i} className={`rounded-xl border p-3.5 ${card}`}>
                  <b.icon className="w-4 h-4 text-blue-500 mb-2" />
                  <p className={`text-[12px] font-bold mb-1 ${heading}`}>{b.t}</p>
                  <p className={`text-[10.5px] leading-snug ${sub}`}>{b.d}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Indicators & weights (US-News-style table) ── */}
          <section className="space-y-3">
            <div>
              <h2 className={`text-[13px] font-black uppercase tracking-wider ${heading}`}>Indicators &amp; weights</h2>
              <p className={`text-[11px] ${sub}`}>The weight each criterion carries by modality. Every column sums to 100 points — the professor’s 100-point allocation.</p>
            </div>
            <div className={`rounded-xl border overflow-x-auto ${card}`}>
              <table className="w-full text-[12px] border-collapse min-w-[560px]">
                <thead>
                  <tr className={`${isDark ? 'text-slate-400 border-slate-800' : 'text-slate-500 border-slate-200'} border-b`}>
                    <th className="text-left font-bold px-4 py-2.5">Indicator</th>
                    {MODALITY_ORDER.map(m => <th key={m} className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">{MODALITY_SHORT[m]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {CRITERIA.map(c => (
                    <tr key={c.key} className={`border-b ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
                      <td className="px-4 py-2.5">
                        <span className={`font-semibold ${heading}`}>{c.label}</span>
                        {CORE_CRITERIA.has(c.key) && <span className={`ml-2 text-[8px] font-black uppercase tracking-wide px-1 py-px rounded ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>core</span>}
                      </td>
                      {MODALITY_ORDER.map(m => { const p = wpct(m, c.key); return (
                        <td key={m} className={`px-3 py-2.5 text-right tabular-nums font-semibold ${p === 0 ? 'text-slate-400' : 'text-blue-600 dark:text-blue-400'}`}>{p}%</td>
                      ); })}
                    </tr>
                  ))}
                  <tr className={`${isDark ? 'bg-slate-800/40' : 'bg-slate-100'} font-black`}>
                    <td className={`px-4 py-2.5 uppercase text-[11px] tracking-wider ${heading}`}>Total</td>
                    {MODALITY_ORDER.map(m => { const total = CRITERIA.reduce((s, c) => s + wpct(m, c.key), 0); return (
                      <td key={m} className={`px-3 py-2.5 text-right tabular-nums ${total === 100 ? (isDark ? 'text-slate-200' : 'text-slate-800') : 'text-red-500'}`}>{total}%</td>
                    ); })}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] ${sub}`}>
              <span className="inline-flex items-center gap-1"><span className={`text-[8px] font-black uppercase px-1 py-px rounded ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>core</span> missing data here penalises the score (real evidence gap)</span>
              <span className="inline-flex items-center gap-1"><Ban className="w-3 h-3 text-amber-500" /> Antibody / ADC also <strong>gates</strong>: only surface or secreted targets are eligible.</span>
              <span>Tractability is 0% for mRNA / gene therapy — no binding pocket is required.</span>
            </div>
          </section>

          {/* ── Per-criterion detail ── */}
          <section className="space-y-3">
            <h2 className={`text-[13px] font-black uppercase tracking-wider ${heading}`}>What each indicator measures</h2>
            <div className="space-y-3">
              {CRITERIA.map(c => {
                const bd = criterionBreakdown(c.key, {});
                return (
                  <div key={c.key} className={`rounded-xl border p-4 ${card}`}>
                    <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13px] font-black ${heading}`}>{c.label}</span>
                        {CORE_CRITERIA.has(c.key) ? <span className={`text-[8px] font-black uppercase tracking-wide px-1 py-px rounded ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>core</span> : <span className={`text-[8px] font-black uppercase tracking-wide px-1 py-px rounded ${isDark ? 'bg-slate-800/60 text-slate-500' : 'bg-slate-50 text-slate-400'}`}>context</span>}
                        <KindTag kind={criterionKind(c.key)} />
                      </div>
                    </div>
                    <p className={`text-[12px] leading-snug ${sub}`}>{c.definition}</p>
                    <p className={`text-[10px] mt-1.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Source: {c.source}</p>
                    <p className={`text-[10px] mt-2 italic ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{bd.formula}</p>
                    {/* the evidence sub-metrics behind the score */}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {bd.metrics.map((mm, i) => (
                        <span key={i} className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border ${isDark ? 'border-slate-800 bg-slate-800/40 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                          <span className="font-semibold">{mm.label}</span>
                          <span className={`text-[8px] font-bold uppercase tracking-wide ${mm.role === 'term' ? 'text-blue-500' : mm.role === 'factor' ? 'text-amber-500' : 'text-slate-400'}`}>{mm.role === 'term' ? `${mm.weightPct}%` : mm.role === 'factor' ? 'multiplier' : 'context'}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Scaling, gates, novelty ── */}
          <section className="space-y-3">
            <h2 className={`text-[13px] font-black uppercase tracking-wider ${heading}`}>How scores are combined</h2>
            <div className={`rounded-xl border divide-y ${isDark ? 'border-slate-800 divide-slate-800' : 'border-slate-200 divide-slate-100'} ${card}`}>
              {[
                { t: 'Weighted sum over present criteria', d: 'Each criterion score (0–1) is multiplied by its weight and summed. A missing criterion contributes 0 — so breadth of evidence matters, and a single-signal gene can’t tie a fully-evidenced target.' },
                { t: 'Leader rescaled to 100', d: 'The strongest eligible target sets the top of the scale; every other target is shown as a share of it (like a U.S. News overall score of 100).' },
                { t: 'Bars are normalised within each category', d: 'Because criteria live on different absolute scales (genetics tops out low; dependency near 1), each column’s bar is scaled so the field leader fills it — the number you read is standing vs. the field. The overall still uses the absolute weighted values.' },
                { t: 'Gates must gate', d: 'A modality gate (e.g. antibody → surface/secreted) sinks ineligible targets (×0.05) and sorts them strictly below every eligible one, so the leader is always eligible.' },
                { t: 'Novelty is protected', d: 'Context criteria (clinical, literature, network) are neutral when absent, so a genuinely novel target with no trials or papers isn’t penalised for lack of attention.' },
              ].map((r, i) => (
                <div key={i} className="px-4 py-3">
                  <p className={`text-[12px] font-bold mb-0.5 ${heading}`}>{r.t}</p>
                  <p className={`text-[11px] leading-snug ${sub}`}>{r.d}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Validation ── */}
          <section className="space-y-3">
            <h2 className={`text-[13px] font-black uppercase tracking-wider ${heading}`}>Validation</h2>
            <div className={`rounded-xl border p-4 ${card}`}>
              <p className={`text-[12px] leading-relaxed ${sub}`}>
                The board is <strong className={heading}>benchmarked</strong>, not just asserted. Using known drug targets for the disease as a
                gold set — with <strong className={heading}>tractability held out</strong> to avoid leakage — the small-molecule ranking reaches
                <strong className={heading}> ROC-AUC 0.82</strong> (enrichment 7.8× in the top 5%), ahead of the earlier funnel’s 0.74. Other
                modalities: degrader 0.78, mRNA 0.70, gene therapy 0.68, antibody 0.64. Weights are first-proposal values calibrated by eye and
                exposed as sliders — the benchmark is how any change is judged before it ships.
              </p>
              <p className={`text-[10px] mt-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                Antibody grading is judged against a small-molecule-biased gold set, so its number understates real antibody performance — an
                antibody-specific gold set is the honest fix.
              </p>
            </div>
          </section>

          <p className={`text-[10px] text-center ${isDark ? 'text-slate-600' : 'text-slate-400'} pb-4`}>
            Every figure on this page is computed from a named public source (Open Targets · cBioPortal · UCSC Xena · CPTAC · DepMap · gnomAD · ClinicalTrials.gov · Europe PMC · STRING). Adjust weights in the board’s Weights panel.
          </p>
        </div>
      </div>
    </div>
  );
}
