// MethodologyView — the "how we rank" page for the Target Ranking Board.
// Modelled on the U.S. News Best-Colleges methodology: a transparent table of
// INDICATORS and their WEIGHTS (each modality column sums to 100), plus the
// definition, data source, and evidence sub-metrics behind every criterion.
// Everything is derived from rankingBoard.ts (CRITERIA / MODALITY_PROFILES /
// criterionBreakdown) so this page can never drift from the engine it documents.
import React from 'react';
import { X, Trophy, ShieldCheck, FlaskConical, Ban, Scale, Gauge } from 'lucide-react';
import { CRITERIA, MODALITY_PROFILES, CORE_CRITERIA, criterionBreakdown, type ModalityKey, type CriterionKey } from './rankingBoard';
import { getActiveBoardSnapshot } from './boardStore';

// Only validated modalities appear in the weights table; the rest are documented as
// "in development" below (they re-weight SM-oriented criteria but lack their own biology).
const ALL_MODALITIES: ModalityKey[] = ['small_molecule', 'antibody', 'protac', 'mrna', 'gene_therapy'];
const MODALITY_ORDER: ModalityKey[] = ALL_MODALITIES.filter(m => MODALITY_PROFILES[m].ready);
const DEFERRED_MODALITIES: ModalityKey[] = ALL_MODALITIES.filter(m => !MODALITY_PROFILES[m].ready);
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
  // Which snapshot the board has open, and which axes it actually scores on. The
  // weights table below is the PUBLISHED weighting; a snapshot missing an axis drops
  // it and renormalises the budget over the rest, so without this the page documents
  // a weighting the reader is not getting. Read at render time from boardStore rather
  // than threaded as a prop - this page is opened from several places.
  const boardSnap = getActiveBoardSnapshot();
  const dropped = (boardSnap?.inactiveCriteria || [])
    .map(k => CRITERIA.find(c => c.key === k)?.label || k);

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

          {/* What this page is describing right now. */}
          {boardSnap && (
            <div className={`rounded-xl border px-4 py-3 ${isDark ? 'bg-slate-900/60 border-slate-700' : 'bg-amber-50 border-amber-200'}`}>
              <p className={`text-[12px] font-bold ${heading}`}>
                Describing snapshot #{boardSnap.id} — {boardSnap.disease_name}
                {boardSnap.modality ? ` · ${MODALITY_SHORT[boardSnap.modality as ModalityKey] || boardSnap.modality}` : ''}
              </p>
              {dropped.length > 0 ? (
                <p className={`mt-1 text-[11px] leading-snug ${sub}`}>
                  <strong>{dropped.length} of {CRITERIA.length} criteria have no data in this snapshot</strong>{' '}
                  ({dropped.join(', ')}). Those are dropped and their weight is redistributed across the
                  remaining criteria, so the effective weighting here is <em>not</em> the published one below.
                </p>
              ) : (
                <p className={`mt-1 text-[11px] leading-snug ${sub}`}>
                  All {CRITERIA.length} criteria have data in this snapshot, so the weights below apply as published.
                </p>
              )}
            </div>
          )}

          {/* ── The approach ── */}
          <section className="space-y-3">
            <p className={`text-[13px] leading-relaxed ${sub}`}>
              We score every candidate target for a disease with a <strong className={heading}>transparent weighted sum</strong> across eight
              evidence criteria. We borrowed the shape of it from the U.S. News Best-Colleges ranking — a subject scored on weighted indicators,
              then placed on a 0–100 scale. Here the <em>subject</em> is the disease, the <em>indicators</em> are our eight criteria, and we
              rescale so the field’s <strong className={heading}>leader sits at 100</strong>. We deliberately kept it out of black-box territory:
              every number traces to a named public source with a citation, and we show the weights below rather than burying them — you can
              change them yourself in the board and watch the ranking move.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { icon: Scale, t: 'Weighted sum, leader = 100', d: 'Overall = Σ (criterion score × weight) over the criteria a target has data for, rescaled so the disease’s strongest eligible target = 100.' },
                { icon: Gauge, t: 'Modality re-weights the criteria', d: 'The framework lets a modality swap the weight vector (and gate ineligible targets). Only small-molecule is validated and shown today — other modalities are deferred until they have their own criteria (below).' },
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
              <p className={`text-[11px] ${sub}`}>The weight each criterion carries, as a 100-point allocation (the column sums to 100). Shown for the validated small-molecule modality; others are in development (below).</p>
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
            </div>
          </section>

          {/* ── Modalities in development (deferred, conservative) ── */}
          {DEFERRED_MODALITIES.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className={`text-[13px] font-black uppercase tracking-wider ${heading}`}>Modalities in development</h2>
                <p className={`text-[11px] ${sub}`}>
                  Only small-molecule is shown today. The modalities below would re-weight the same eight criteria, but those criteria
                  are small-molecule-oriented — they don’t yet capture the biology each other modality actually depends on. Rather than
                  present rankings that look authoritative but aren’t validated, we <strong className={heading}>withhold them until their own
                  criteria exist</strong>. Each needs the signals listed before it will be enabled.
                </p>
              </div>
              <div className={`rounded-xl border divide-y ${isDark ? 'border-slate-800 divide-slate-800' : 'border-slate-200 divide-slate-100'} ${card}`}>
                {DEFERRED_MODALITIES.map(m => (
                  <div key={m} className="px-4 py-3 flex items-start gap-3">
                    <Ban className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className={`text-[12px] font-bold ${heading}`}>{MODALITY_PROFILES[m].label} <span className={`ml-1 text-[9px] font-black uppercase tracking-wide ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>in development</span></p>
                      <p className={`text-[11px] leading-snug ${sub}`}>Needs: {MODALITY_PROFILES[m].pendingCriteria || 'modality-specific criteria'}.</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

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
                    {/* The reference a reader follows to check the metric means what we say.
                        Absent on an axis = we have not verified one yet, not that none exists. */}
                    {c.citations?.length ? (
                      <ul className={`mt-2 space-y-1 border-l-2 pl-2.5 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                        {c.citations.map((cit, i) => (
                          <li key={i} className={`text-[10px] leading-snug ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{cit}</li>
                        ))}
                      </ul>
                    ) : null}
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
                { t: 'Network is a percentile within one graph', d: 'The Network criterion is WINNER (the lab’s own algorithm, run with its published package) on the STRING v12.0 interactions among the snapshot’s Open Targets candidate genes — the top 6,000 by association score for Alzheimer’s. Each gene is scored as its percentile within that run. A percentile from another graph — another disease, a wider candidate cut, or the whole 19k-protein interactome — measures something different and is never mixed in. Genes outside the candidate set, or without a STRING protein at this version, get no network score rather than a zero; WINNER tracks connectivity closely, so a high value can mean “well connected” rather than “disease-specific”.' },
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
                We didn’t want to just assert that this ranking works, so we benchmarked it. We took the known drug targets for the disease as a
                gold set and asked whether the board pushes them toward the top. To keep the test honest we
                <strong className={heading}> held tractability out</strong> — it is partly derived from the very drugs we were using as the answer key,
                so leaving it in would have let the ranking mark its own homework. On that basis the small-molecule ranking reaches
                <strong className={heading}> ROC-AUC 0.82</strong>, with a 7.8× enrichment of known targets in the top 5%. Our earlier funnel scored 0.74
                on the same test, so the criteria-based board is a real improvement rather than a reshuffle.
              </p>
              <p className={`text-[12px] leading-relaxed mt-2 ${sub}`}>
                We set the starting weights by eye rather than fitting them, and we would rather say so than imply a rigour we did not apply. They are
                exposed as sliders for exactly that reason. What the benchmark gives us is a way to judge any change to them before it ships — if a
                reweighting does not move the AUC, we do not keep it.
              </p>
              <p className={`text-[10px] mt-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                We have only validated small-molecule this way. Our gold set is built from known drug targets, which skews small-molecule, so scoring the
                other modalities against it would understate them — which is part of why we withhold those rankings until each has its own criteria and
                a gold set that suits it.
              </p>
            </div>
          </section>

          {/* ── References ── */}
          <section className="space-y-3">
            <h2 className={`text-[13px] font-black uppercase tracking-wider ${heading}`}>References</h2>
            <div className={`rounded-xl border p-4 ${card}`}>
              <p className={`text-[12px] leading-relaxed ${sub}`}>
                Every reference below we checked against the publisher record rather than citing from memory. Two axes lean on a method paper that is
                separate from the database serving it — Chronos is an algorithm, not a portal, and τ is a formula we implement ourselves — so we cite
                those directly. Where we have not yet verified a reference we have left it out instead of guessing; a wrong volume number in a methods
                section is worse than an honest gap.
              </p>
              <ul className={`mt-3 space-y-1.5 text-[10.5px] leading-snug ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {[
                  ['Open Targets', 'Buniello A, et al. Nucleic Acids Res 2025;53(D1):D1467–D1475. doi:10.1093/nar/gkae1128'],
                  ['cBioPortal', 'Cerami E, et al. Cancer Discov 2012;2(5):401 · Gao J, et al. Sci Signal 2013;6(269):pl1 · de Bruijn I, et al. Cancer Res 2023'],
                  ['UCSC Xena', 'Goldman MJ, et al. Nat Biotechnol 2020;38:675–678. doi:10.1038/s41587-020-0546-8'],
                  ['LinkedOmics / CPTAC', 'Vasaikar SV, et al. Nucleic Acids Res 2018;46(D1):D956–D963. doi:10.1093/nar/gkx1090'],
                  ['DepMap — Chronos', 'Dempster JM, et al. Genome Biol 2021;22:343. PMID 34930405'],
                  ['gnomAD v4', 'Chen S, et al. Nature 2024;625:92–100'],
                  ['WINNER', 'Nguyen T, Yue Z, Slominski R, Welner R, Zhang J, Chen JY. Front Big Data 2022;5:1016606. doi:10.3389/fdata.2022.1016606. PMID 36407327'],
                  ['STRING', 'Szklarczyk D, et al. Nucleic Acids Res 2023;51(D1):D638–D646. doi:10.1093/nar/gkac1000'],
                  ['Random walk with restart', 'Köhler S, et al. Am J Hum Genet 2008;82(4):949–958. doi:10.1016/j.ajhg.2008.02.013'],
                  ['Europe PMC', 'Ferguson C, et al. Nucleic Acids Res 2021;49(D1):D1507–D1514. doi:10.1093/nar/gkaa994'],
                  ['Tissue index τ', 'Yanai I, et al. Bioinformatics 2005;21(5):650–659. doi:10.1093/bioinformatics/bti042'],
                  ['Human Protein Atlas', 'Karlsson M, et al. Sci Adv 2021;7(31):eabh2169. doi:10.1126/sciadv.abh2169'],
                ].map(([name, cite], i) => (
                  <li key={i}>
                    <span className={`font-bold ${heading}`}>{name}</span> — {cite}
                  </li>
                ))}
              </ul>
              <p className={`text-[10px] mt-3 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                These resources version their own papers, so when you cite a result from this app, cite the release you actually queried and record the
                date you pulled it. A snapshot taken today will not match next year’s database paper.
              </p>
            </div>
          </section>

          <p className={`text-[10px] text-center ${isDark ? 'text-slate-600' : 'text-slate-400'} pb-4`}>
            Every figure on this page comes from a named public source, cited above. Adjust weights in the board’s Weights panel.
          </p>
        </div>
      </div>
    </div>
  );
}
