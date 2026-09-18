// AssessmentView.tsx ────────────────────────────────────────────────────────
// Target Assessment: up to four targets side by side on the Ranking Board's own evidence
// (the 8 criteria and their sub-metrics, from the snapshot store) plus modality fit per
// category, a plain-language verdict per target, an AI trade-off narrative written only
// from that evidence, and a DOCX export of the same. Reached from the rail's Assess panel.
//
// Replaces the previous assessment, which scored on the legacy GET list and live
// ClinicalTrials/PubMed calls — numbers that disagreed with the board and could not be
// traced to a snapshot. Every value here has a wiki page behind it.
import React, { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { Microscope, Sparkles, FileDown, X, Loader2, ChevronDown, ChevronRight, BookOpen, AlertTriangle, Atom } from 'lucide-react';
import { authenticatedFetch } from './supabase';
import { navigate, wikiUrl } from './nav';
import { MECHANISTIC_GOALS } from './modalityConstants';
import { type CriterionKey } from './rankingBoard';
import {
  ASSESS_MAX, CATEGORY_ORDER, criterionLabel, headline, isCore, narrativePrompt,
  type Assessment, type AssessedTarget, type MechanisticGoal, type Tier,
} from './assessment';

type Theme = 'light' | 'dark';

const TIER_STYLE: Record<Tier, { bg: string; fg: string; dark: string }> = {
  Precedented: { bg: 'bg-emerald-50 border-emerald-200', fg: 'text-emerald-700', dark: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' },
  Plausible:   { bg: 'bg-blue-50 border-blue-200',       fg: 'text-blue-700',    dark: 'bg-blue-500/10 border-blue-500/30 text-blue-300' },
  Speculative: { bg: 'bg-amber-50 border-amber-200',     fg: 'text-amber-700',   dark: 'bg-amber-500/10 border-amber-500/30 text-amber-300' },
  Blocked:     { bg: 'bg-slate-100 border-slate-200',    fg: 'text-slate-500',   dark: 'bg-slate-800/60 border-slate-700 text-slate-400' },
};
const TierChip = ({ tier, isDark, lead }: { tier: Tier | undefined; isDark: boolean; lead?: boolean }) => {
  if (!tier) return <span className={`text-[10px] ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>—</span>;
  const s = TIER_STYLE[tier];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${isDark ? s.dark : `${s.bg} ${s.fg}`} ${lead ? 'ring-2 ring-offset-1 ring-blue-500/60 dark:ring-offset-slate-900' : ''}`}>
      {tier}
    </span>
  );
};

const toneCls = (tone: string | undefined, isDark: boolean) =>
  tone === 'top' || tone === 'strong' ? (isDark ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-emerald-700 bg-emerald-50 border-emerald-200')
  : tone === 'low' ? (isDark ? 'text-rose-300 bg-rose-500/10 border-rose-500/30' : 'text-rose-700 bg-rose-50 border-rose-200')
  : (isDark ? 'text-slate-300 bg-slate-800/60 border-slate-700' : 'text-slate-600 bg-slate-50 border-slate-200');

// ── DOCX ─────────────────────────────────────────────────────────────────────
async function buildDocx(a: Assessment, goal: MechanisticGoal, narrative: string) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, BorderStyle, ShadingType } = await import('docx');
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text: string, opts: { bold?: boolean; shaded?: boolean; w?: number } = {}) =>
    new TableCell({
      borders, width: { size: opts.w ?? 2000, type: WidthType.DXA },
      shading: opts.shaded ? { fill: 'F1F5F9', type: ShadingType.CLEAR } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold, size: 18 })] })],
    });
  const para = (text: string, opts: { bold?: boolean; size?: number; italics?: boolean } = {}) =>
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 20, italics: opts.italics })] });
  const syms = a.targets.map(t => t.symbol);
  const head = (first: string) => new TableRow({ tableHeader: true, children: [cell(first, { bold: true, shaded: true, w: 2600 }), ...syms.map(s => cell(s, { bold: true, shaded: true }))] });

  const children: any[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Target Assessment', bold: true, size: 36 })] }),
    para(`${a.disease} · snapshot #${a.snapshotId} · ${a.total.toLocaleString()} targets on the Ranking Board · weights: ${a.modality.replace('_', ' ')} · literature: ${a.litWindow} · modality goal: ${goal.replace('_', ' ')}`, { size: 18 }),
    para(`Generated ${new Date().toISOString().slice(0, 10)} by Disease2Target. Criterion values are the Ranking Board's own scores from the snapshot store; modality tiers are from the modality-fit service. Nothing here is fetched live from PubMed or ClinicalTrials.gov.`, { size: 16, italics: true }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Verdicts', bold: true, size: 26 })] }),
    ...a.targets.map(t => para(`${t.symbol}: ${headline(t, a.total)}${t.scored ? ` · overall ${t.scored.display}/100` : ''}`)),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Evidence by criterion (0–100; leader = 100 on the board)', bold: true, size: 26 })] }),
    new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [
      head('Criterion (weight)'),
      ...a.activeCriteria.map(k => new TableRow({ children: [
        cell(`${criterionLabel(k)} (${Math.round(a.weights[k] * 100)}%)${isCore(k) ? '' : ' · context'}`, { w: 2600 }),
        ...a.targets.map(t => { const v = t.scored?.criteria[k]; return cell(v == null ? (t.found ? 'no data' : 'n/a') : `${Math.round(v * 100)}${a.leaders[k] === t.symbol ? ' ★' : ''}`); }),
      ] })),
    ] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Sub-metrics', bold: true, size: 26 })] }),
  ];
  for (const k of a.activeCriteria) {
    const labels = [...new Set(a.targets.flatMap(t => (t.breakdown[k]?.metrics ?? []).filter(m => m.role !== 'context').map(m => m.label)))];
    if (!labels.length) continue;
    children.push(para(criterionLabel(k), { bold: true }));
    children.push(new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [
      head('Metric'),
      ...labels.map(l => new TableRow({ children: [cell(l, { w: 2600 }), ...a.targets.map(t => cell(String(t.breakdown[k]?.metrics.find(m => m.label === l)?.value ?? '—')))] })),
    ] }));
  }
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `Modality fit — goal: ${goal.replace('_', ' ')}`, bold: true, size: 26 })] }));
  children.push(new Table({ width: { size: 9000, type: WidthType.DXA }, rows: [
    head('Category'),
    ...CATEGORY_ORDER.map(c => new TableRow({ children: [cell(c, { w: 2600 }), ...a.targets.map(t => cell(t.modality?.resolved ? (t.modality.byCategory[c] ?? '—') : 'n/a'))] })),
    new TableRow({ children: [cell('Best modality', { bold: true, w: 2600 }), ...a.targets.map(t => cell(t.modality?.best ? `${t.modality.best.modality} (${t.modality.best.tier})` : '—'))] }),
    new TableRow({ children: [cell('Blocked', { bold: true, w: 2600 }), ...a.targets.map(t => cell(t.modality?.blocked?.length ? t.modality.blocked.join(', ') : '—'))] }),
  ] }));
  if (narrative) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'AI trade-off narrative', bold: true, size: 26 })] }));
    children.push(para('Written by the co-scientist model from the evidence above only. A summary to argue with, not a source.', { size: 16, italics: true }));
    for (const line of narrative.split('\n').filter(l => l.trim())) children.push(para(line.replace(/\*\*/g, '').replace(/^#+\s*/, '')));
  }
  return new Document({ sections: [{ children }] });
}

// ── view ─────────────────────────────────────────────────────────────────────
export default function AssessmentView({ assessment, loading, error, modalityLoading, goal, onGoalChange, theme, onClose }: {
  assessment: Assessment | null;
  loading: boolean;            // scoring against the board
  error: string | null;
  modalityLoading: boolean;    // the modality batch is still running
  goal: MechanisticGoal;
  onGoalChange: (g: MechanisticGoal) => void;
  theme: Theme;
  onClose: () => void;
}) {
  const isDark = theme === 'dark';
  const [narrative, setNarrative] = useState('');
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [dlLoading, setDlLoading] = useState(false);
  const [open, setOpen] = useState<Set<CriterionKey>>(new Set());
  const a = assessment;
  const found = useMemo(() => a?.targets.filter(t => t.found) ?? [], [a]);

  const muted = isDark ? 'text-slate-500' : 'text-slate-400';
  const ink = isDark ? 'text-slate-100' : 'text-slate-900';
  const card = isDark ? 'border-slate-800 bg-[#0d1424]' : 'border-slate-200 bg-white';
  const toggle = (k: CriterionKey) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const runNarrative = async () => {
    if (!a || !found.length) return;
    setNarrativeLoading(true);
    try {
      const resp = await authenticatedFetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: narrativePrompt(a, goal) }) });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || `AI request failed (${resp.status})`);
      setNarrative(j.text ?? '');
    } catch (e: any) { setNarrative(`Error: ${e.message}`); }
    finally { setNarrativeLoading(false); }
  };
  const download = async () => {
    if (!a) return;
    setDlLoading(true);
    try {
      const { Packer } = await import('docx');
      const { saveAs } = await import('file-saver');
      const buffer = await Packer.toBuffer(await buildDocx(a, goal, narrative));
      saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        `Assessment_${a.targets.map(t => t.symbol).join('_')}_${a.disease.replace(/\s+/g, '_').slice(0, 30)}_s${a.snapshotId}.docx`);
    } finally { setDlLoading(false); }
  };
  const geneWiki = (sym: string) => a ? wikiUrl.entity(a.disease, a.snapshotId, 'gene', sym) : '#';

  const cols = Math.max(1, Math.min(ASSESS_MAX, a?.targets.length ?? 1));

  return (
    <div className={`h-full flex flex-col rounded-2xl border overflow-hidden shadow-xl ${isDark ? 'bg-[#0b111c]/95 border-slate-800/80' : 'bg-white/95 border-slate-200'}`}>
      {/* header */}
      <div className={`flex items-center justify-between gap-3 px-5 py-3 border-b flex-shrink-0 ${isDark ? 'bg-[#0b111c] border-slate-800' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-xl flex-shrink-0 ${isDark ? 'bg-blue-600/10' : 'bg-blue-50'}`}><Microscope className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} /></div>
          <div className="min-w-0">
            <p className={`text-[9px] font-black uppercase tracking-widest ${muted}`}>Target Assessment</p>
            <p className={`text-[13px] font-bold truncate ${ink}`}>
              {a ? <>{a.disease} <span className={`font-medium ${muted}`}>· snapshot #{a.snapshotId} · {a.total.toLocaleString()} targets · {a.modality.replace('_', ' ')} weights</span></> : 'Scoring…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {a && found.length > 0 && (
            <>
              <button onClick={runNarrative} disabled={narrativeLoading || modalityLoading} title={modalityLoading ? 'Waiting for the modality tiers' : 'Write a trade-off narrative from this evidence only'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all disabled:opacity-40 ${isDark ? 'bg-purple-600/15 text-purple-300 hover:bg-purple-600/25 border border-purple-500/20' : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'}`}>
                {narrativeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}AI trade-off
              </button>
              <button onClick={download} disabled={dlLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all disabled:opacity-40 ${isDark ? 'bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'}`}>
                {dlLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}Report
              </button>
            </>
          )}
          <button onClick={onClose} title="Close" className={`p-1.5 rounded-lg flex-shrink-0 transition-colors ${isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {error && (
          <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-[12px] ${isDark ? 'border-rose-900/50 bg-rose-950/20 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}
        {loading && !a && (
          <div className="h-64 flex flex-col items-center justify-center gap-3">
            <Loader2 className={`w-6 h-6 animate-spin ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            <p className={`text-[11px] font-bold ${muted}`}>Scoring against the Ranking Board…</p>
            <p className={`text-[10px] ${muted}`}>First load pulls the disease's evidence set from the store; it is cached afterwards.</p>
          </div>
        )}

        {a && (
          <>
            {/* verdict cards */}
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {a.targets.map(t => {
                const v = t.verdict, s = t.scored;
                return (
                  <div key={t.symbol} className={`rounded-2xl border overflow-hidden ${card}`}>
                    <div className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-100 bg-slate-50'}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className={`text-[16px] font-black font-mono ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>{t.symbol}</h3>
                        {t.found
                          ? <a href={geneWiki(t.symbol)} onClick={e => { e.preventDefault(); navigate(geneWiki(t.symbol)); }} title="Provenance — every value on its wiki page"
                              className={`inline-flex items-center gap-1 text-[10px] font-bold ${isDark ? 'text-slate-400 hover:text-blue-300' : 'text-slate-500 hover:text-blue-700'}`}><BookOpen className="w-3 h-3" />wiki</a>
                          : <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border ${isDark ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>not in snapshot</span>}
                      </div>
                      {s && <span className={`text-[20px] font-black tabular-nums ${s.display >= 80 ? (isDark ? 'text-emerald-300' : 'text-emerald-600') : ink}`}>{s.display}<span className={`text-[10px] font-bold ${muted}`}>/100</span></span>}
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      {v && s ? (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${toneCls(v.tone, isDark)}`}>{v.tier}</span>
                            <span className={`text-[11px] font-semibold ${ink}`}>#{v.rank.toLocaleString()} of {v.total.toLocaleString()}</span>
                            <span className={`text-[10px] ${muted}`}>· {s.coverage}/{a.activeCriteria.length} criteria with data</span>
                          </div>
                          {v.strengths.length > 0 && <p className={`text-[11px] leading-snug ${isDark ? 'text-slate-300' : 'text-slate-600'}`}><b className={isDark ? 'text-emerald-300' : 'text-emerald-700'}>Strong on:</b> {v.strengths.join(', ')}</p>}
                          {v.drags.length > 0 && <p className={`text-[11px] leading-snug ${isDark ? 'text-slate-300' : 'text-slate-600'}`}><b className={isDark ? 'text-amber-300' : 'text-amber-700'}>Held back by:</b> {v.drags.join(', ')}</p>}
                          {v.gaps.length > 0 && <p className={`text-[11px] leading-snug ${muted}`}><b>No data:</b> {v.gaps.join(', ')}</p>}
                          <div className="flex items-center gap-2 pt-1">
                            <Atom className={`w-3.5 h-3.5 ${muted}`} />
                            {modalityLoading && !t.modality ? <span className={`text-[10px] ${muted}`}>modality fit…</span>
                              : t.modality?.resolved && t.modality.best
                                ? <span className={`text-[11px] ${ink}`}>{t.modality.best.modality} <TierChip tier={t.modality.best.tier} isDark={isDark} /></span>
                                : <span className={`text-[10px] ${muted}`}>{t.modality?.error ? 'modality fit unavailable' : t.modality ? 'no modality reaches this target' : '—'}</span>}
                          </div>
                        </>
                      ) : (
                        <p className={`text-[11px] leading-snug ${muted}`}>No stored evidence for {t.symbol} in this disease's snapshot, so it cannot be scored here. Check the symbol, or load the disease it belongs to.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* criteria matrix */}
            {found.length > 0 && (
              <div className={`rounded-2xl border overflow-hidden ${card}`}>
                <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-100 bg-slate-50'}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Evidence by criterion</p>
                  <p className={`text-[10px] ${muted}`}>bar = standing against the board's field leader · ★ = leads among these targets · click a row for the sub-metrics</p>
                </div>
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className={`${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      <th className="text-left font-bold px-4 py-2 w-[220px]">Criterion</th>
                      {a.targets.map(t => <th key={t.symbol} className="text-left font-black font-mono px-3 py-2">{t.symbol}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {a.activeCriteria.map(k => {
                      const isOpen = open.has(k);
                      const labels = [...new Set(a.targets.flatMap(t => (t.breakdown[k]?.metrics ?? []).map(m => m.label)))];
                      return (
                        <React.Fragment key={k}>
                          <tr onClick={() => toggle(k)} className={`cursor-pointer border-t ${isDark ? 'border-slate-800 hover:bg-slate-800/40' : 'border-slate-100 hover:bg-slate-50'}`}>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-1.5">
                                {isOpen ? <ChevronDown className={`w-3 h-3 ${muted}`} /> : <ChevronRight className={`w-3 h-3 ${muted}`} />}
                                <span className={`font-bold ${ink}`}>{criterionLabel(k)}</span>
                                <span className={`tabular-nums ${muted}`}>{Math.round(a.weights[k] * 100)}%</span>
                                {!isCore(k) && <span className={`text-[8px] font-black uppercase tracking-wider px-1 rounded ${isDark ? 'bg-slate-800 text-slate-500' : 'bg-slate-100 text-slate-500'}`} title="Context criterion — missing data is neutral, not a penalty">ctx</span>}
                              </div>
                            </td>
                            {a.targets.map(t => {
                              const v = t.scored?.criteria[k]; const rel = t.rel[k]; const lead = a.leaders[k] === t.symbol;
                              return (
                                <td key={t.symbol} className="px-3 py-2 align-middle">
                                  {!t.found ? <span className={muted}>n/a</span> : v == null ? <span className={`italic ${muted}`}>no data</span> : (
                                    <div className="flex items-center gap-2">
                                      <div className={`h-1.5 w-20 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                                        <div className="h-full rounded-full" style={{ width: `${Math.round((rel ?? 0) * 100)}%`, background: lead ? 'var(--disease-accent)' : (isDark ? '#64748b' : '#94a3b8') }} />
                                      </div>
                                      <span className={`font-black tabular-nums ${lead ? (isDark ? 'text-blue-300' : 'text-blue-700') : ink}`}>{Math.round(v * 100)}</span>
                                      {lead && <span className={isDark ? 'text-blue-300' : 'text-blue-700'} title="leads among these targets">★</span>}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                          {isOpen && labels.map(l => (
                            <tr key={l} className={`border-t ${isDark ? 'border-slate-800/60 bg-slate-900/30' : 'border-slate-100 bg-slate-50/60'}`}>
                              <td className={`px-4 py-1.5 pl-9 ${muted}`} title={a.targets.map(t => t.breakdown[k]?.metrics.find(m => m.label === l)?.note).find(Boolean) || ''}>{l}</td>
                              {a.targets.map(t => {
                                const m = t.breakdown[k]?.metrics.find(x => x.label === l);
                                return <td key={t.symbol} className={`px-3 py-1.5 tabular-nums ${m?.role === 'context' ? muted : ink}`}>{m?.value ?? '—'}</td>;
                              })}
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* modality fit */}
            {found.length > 0 && (
              <div className={`rounded-2xl border overflow-hidden ${card}`}>
                <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-3 flex-wrap ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-100 bg-slate-50'}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Modality fit <span className="normal-case tracking-normal font-medium">— best tier per category for the goal</span></p>
                  <label className={`flex items-center gap-2 text-[11px] ${ink}`}>
                    <span className={muted}>goal</span>
                    <select value={goal} onChange={e => onGoalChange(e.target.value as MechanisticGoal)}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold outline-none ${isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`}>
                      {(Object.keys(MECHANISTIC_GOALS) as MechanisticGoal[]).map(g => <option key={g} value={g}>{g.replace('_', ' ')}</option>)}
                    </select>
                    {modalityLoading && <Loader2 className={`w-3.5 h-3.5 animate-spin ${muted}`} />}
                  </label>
                </div>
                <p className={`px-4 pt-2 text-[10px] ${muted}`}>{MECHANISTIC_GOALS[goal]}</p>
                <table className="w-full text-[11px] border-collapse mt-1">
                  <thead>
                    <tr className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                      <th className="text-left font-bold px-4 py-2 w-[220px]">Category</th>
                      {a.targets.map(t => <th key={t.symbol} className="text-left font-black font-mono px-3 py-2">{t.symbol}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORY_ORDER.map(c => (
                      <tr key={c} className={`border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                        <td className={`px-4 py-2 font-bold ${ink}`}>{c}</td>
                        {a.targets.map(t => (
                          <td key={t.symbol} className="px-3 py-2">
                            {!t.found ? <span className={muted}>n/a</span>
                              : !t.modality ? (modalityLoading ? <Loader2 className={`w-3 h-3 animate-spin ${muted}`} /> : <span className={muted}>—</span>)
                              : !t.modality.resolved ? <span className={`italic ${muted}`} title={t.modality.error || ''}>{t.modality.error ? 'unavailable' : 'not recognised'}</span>
                              : <TierChip tier={t.modality.byCategory[c]} isDark={isDark} lead={a.modalityLeaders[c]?.includes(t.symbol)} />}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className={`border-t ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-100 bg-slate-50/60'}`}>
                      <td className={`px-4 py-2 font-bold ${ink}`}>Best modality</td>
                      {a.targets.map(t => <td key={t.symbol} className={`px-3 py-2 ${ink}`}>{t.modality?.best ? <>{t.modality.best.modality} <TierChip tier={t.modality.best.tier} isDark={isDark} /></> : <span className={muted}>—</span>}</td>)}
                    </tr>
                    <tr className={`border-t ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-100 bg-slate-50/60'}`}>
                      <td className={`px-4 py-2 font-bold ${ink}`}>Blocked</td>
                      {a.targets.map(t => <td key={t.symbol} className={`px-3 py-2 ${muted}`}>{t.modality?.blocked?.length ? t.modality.blocked.join(', ') : '—'}</td>)}
                    </tr>
                  </tbody>
                </table>
                <p className={`px-4 py-2 text-[10px] ${muted}`}>Tiers are deterministic rules over ChEMBL, UniProt, PDB, Open Targets and DepMap evidence for each gene (see the Modality page for the per-modality reasoning). A ring marks the category leader among these targets.</p>
              </div>
            )}

            {/* narrative */}
            {narrative && (
              <div className={`rounded-2xl border overflow-hidden ${card}`}>
                <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-100 bg-slate-50'}`}>
                  <Sparkles className={`w-3.5 h-3.5 ${isDark ? 'text-purple-300' : 'text-purple-600'}`} />
                  <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>AI trade-off</p>
                  <p className={`text-[10px] ${muted}`}>· written from the evidence above only — a summary to argue with, not a source</p>
                </div>
                <div className={`markdown-body px-5 py-4 text-[12.5px] leading-relaxed ${isDark ? 'text-slate-200' : 'text-slate-800'}`}><Markdown>{narrative}</Markdown></div>
              </div>
            )}

            <p className={`text-[10px] ${muted}`}>
              Criterion scores are the Ranking Board's own (snapshot #{a.snapshotId}, {a.modality.replace('_', ' ')} weights, literature window "{a.litWindow}"); each gene's wiki page lists the study, statistic, script and commit behind every value. No live PubMed or ClinicalTrials.gov calls are made here.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
