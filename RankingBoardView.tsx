// RankingBoardView — the CollaboFest flagship output (Phase 1+2).
// A US-News-style target ranking board: targets ranked by a TRANSPARENT weighted
// sum across 8 criteria (leader = 100), where the MODALITY selector re-weights the
// criteria (and gates ineligible targets) so the ranking reshuffles live. Click a
// target for its report card — per-criterion score + definition + the evidence.
// Reads /api/dashboard/genes (no new endpoint); all scoring is client-side via
// rankingBoard.ts.
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Trophy, Search, X, Sliders, RotateCcw, Award } from 'lucide-react';
import { fetchSnapshots, authenticatedFetch, type RankingSnapshotMeta } from './supabase';
import { CRITERIA, MODALITY_PROFILES, buildBoard, normaliseWeights, type CriterionKey, type ModalityKey, type ScoredGene } from './rankingBoard';
import type { Theme } from './types';

const MODALITY_ORDER: ModalityKey[] = ['small_molecule', 'antibody', 'protac', 'mrna', 'gene_therapy'];

async function getJson(url: string): Promise<any> {
  const r = await authenticatedFetch(url);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error(`${url} → ${r.status} (is the dev server restarted?)`);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || `${url} → ${r.status}`);
  return j;
}

export default function RankingBoardView({ theme, diseaseName }: { theme: Theme; diseaseName?: string }) {
  const isDark = theme === 'dark';
  // One calm accent for every criterion bar — the shade deepens with the score, so value
  // still reads at a glance without an 8-colour rainbow.
  const barBg = (v: number) => isDark ? `rgba(96,165,250,${(0.35 + 0.6 * v).toFixed(3)})` : `rgba(37,99,235,${(0.28 + 0.62 * v).toFixed(3)})`;
  const [snapshots, setSnapshots] = useState<RankingSnapshotMeta[]>([]);
  const [snapId, setSnapId] = useState('');
  const [genes, setGenes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modality, setModality] = useState<ModalityKey>('small_molecule');
  const [weightOverride, setWeightOverride] = useState<Record<CriterionKey, number> | null>(null);
  const [showWeights, setShowWeights] = useState(false);
  const [selectedSym, setSelectedSym] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState<string | null>(null);
  const [neighborSet, setNeighborSet] = useState<Set<string>>(new Set());
  const [neighborsLoading, setNeighborsLoading] = useState(false);
  const [liveConnectivity, setLiveConnectivity] = useState<number | null>(null);   // fallback network signal from the same neighbours call

  // ── load snapshots, then the disease's gene set ──
  useEffect(() => {
    fetchSnapshots().then(s => {
      setSnapshots(s);
      const dq = (diseaseName || '').toLowerCase();
      const match = dq ? s.find(x => String(x.disease_name || '').toLowerCase().includes(dq)) : null;
      setSnapId(String((match || s[0])?.id || ''));
    }).catch(e => { setError(String(e?.message || e)); setLoading(false); });
  }, [diseaseName]);

  useEffect(() => {
    if (!snapId) return;
    let alive = true;
    setLoading(true); setError(null); setSelectedSym(null);
    getJson(`/api/dashboard/genes?snapshotId=${encodeURIComponent(snapId)}&limit=20000`)
      .then(j => { if (alive) { setGenes(j?.rows || []); setLoading(false); } })
      .catch(e => { if (alive) { setError(String(e?.message || e)); setLoading(false); } });
    return () => { alive = false; };
  }, [snapId]);

  // switching modality resets to that modality's default weights
  useEffect(() => { setWeightOverride(null); }, [modality]);

  const board = useMemo(() => buildBoard(genes, modality, weightOverride || undefined), [genes, modality, weightOverride]);
  const rawWeights = weightOverride || MODALITY_PROFILES[modality].weights;
  const effWeights = useMemo(() => normaliseWeights(rawWeights), [rawWeights]);
  // selected target derived from its symbol, so the report card stays in sync when the modality re-ranks
  const selected = useMemo(() => (selectedSym ? board.scored.find(s => s.symbol === selectedSym) || null : null), [board, selectedSym]);

  // ── RWR recommender: live STRING neighbours of the selected target ──
  useEffect(() => {
    if (!selectedSym) { setNeighborSet(new Set()); setLiveConnectivity(null); return; }
    let alive = true; setNeighborsLoading(true);
    getJson(`/api/graph/neighbors?gene=${encodeURIComponent(selectedSym)}`)
      .then(j => {
        if (!alive) return;
        const nbs = j.neighbors || [];
        setNeighborSet(new Set(nbs.map((n: any) => String(n.symbol).toUpperCase())));
        // fallback network signal: connectivity from the SAME call (no extra request) — a rough
        // proxy for centrality for genes outside the top-2000 WINNER set. Not fed into the overall.
        setLiveConnectivity(nbs.length ? Math.max(0, Math.min(1, nbs.length / 50)) : 0);
        setNeighborsLoading(false);
      })
      .catch(() => { if (alive) { setNeighborSet(new Set()); setLiveConnectivity(null); setNeighborsLoading(false); } });
    return () => { alive = false; };
  }, [selectedSym]);

  // network neighbours that OUTRANK the selected target — "you may also like" (better profile)
  const betterNeighbors = useMemo(() => {
    if (!selected || neighborSet.size === 0) return [];
    return board.scored
      .filter(s => neighborSet.has(s.symbol.toUpperCase()) && s.boardRank < selected.boardRank && !s.gated)
      .slice(0, 3)
      .map(nb => ({
        nb,
        wins: CRITERIA.map(c => ({ label: c.label, d: (nb.criteria[c.key] ?? 0) - (selected.criteria[c.key] ?? 0) }))
          .filter(x => x.d > 0.12).sort((a, b) => b.d - a.d).slice(0, 3).map(x => x.label),
      }));
  }, [selected, neighborSet, board]);

  const pinnedGene = useMemo(() => pinned ? board.scored.find(s => s.symbol === pinned) : null, [board, pinned]);
  const shown = useMemo(() => {
    const top = board.scored.slice(0, 150);
    if (pinnedGene && !top.some(s => s.symbol === pinnedGene.symbol)) top.push(pinnedGene);
    return top;
  }, [board, pinnedGene]);

  const runFind = () => {
    const q = query.trim().toUpperCase(); if (!q) return;
    const hit = board.scored.find(s => s.symbol.toUpperCase() === q) || board.scored.find(s => s.symbol.toUpperCase().includes(q));
    if (hit) { setPinned(hit.symbol); setSelectedSym(hit.symbol); }
  };
  const setWeight = (k: CriterionKey, v: number) => {
    const base = { ...(weightOverride || MODALITY_PROFILES[modality].weights) };
    base[k] = v / 100; setWeightOverride(base);
  };

  const card = isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200';
  const snapMeta = snapshots.find(s => String(s.id) === snapId);

  if (loading) return <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /><p className="text-sm">Building the ranking board…</p></div>;
  if (error) return <div className="h-full flex flex-col items-center justify-center gap-2 text-center p-8"><Trophy className="w-10 h-10 text-slate-400 mb-2" /><p className="text-sm font-semibold text-red-500">Couldn't load the board</p><p className="text-xs text-slate-500 max-w-md">{error}</p></div>;

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <div className={`px-4 py-2.5 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} space-y-2.5`}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Target Ranking Board</span>
          </div>
          <select value={snapId} onChange={e => setSnapId(e.target.value)} className={`text-xs rounded-md border px-2 py-1 outline-none ${card} ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {snapshots.map(s => <option key={s.id} value={String(s.id)}>{s.disease_name} · #{s.id}</option>)}
          </select>
          <span className="text-[11px] text-slate-500">{board.scored.length.toLocaleString()} targets · leader = 100</span>
          <div className="flex-1" />
          <div className={`flex items-center gap-1 rounded-md border px-2 ${card}`}>
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runFind()} placeholder="Is my target…?" className={`bg-transparent text-xs py-1.5 w-32 outline-none ${isDark ? 'text-white placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'}`} />
          </div>
          <button onClick={() => setShowWeights(v => !v)} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-semibold ${card} ${isDark ? 'text-slate-200' : 'text-slate-700'}`}><Sliders className="w-3.5 h-3.5" /> Weights</button>
        </div>
        {/* modality selector — the lever */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Modality</span>
          {MODALITY_ORDER.map(m => (
            <button key={m} onClick={() => setModality(m)} title={MODALITY_PROFILES[m].note}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${modality === m ? 'bg-blue-600 border-blue-600 text-white' : (isDark ? 'bg-transparent border-slate-700 text-slate-300 hover:border-blue-500' : 'bg-transparent border-slate-200 text-slate-700 hover:border-blue-500')}`}>
              {MODALITY_PROFILES[m].label}
            </button>
          ))}
          <span className="text-[11px] text-slate-500 ml-1 hidden lg:inline">— {MODALITY_PROFILES[modality].note}</span>
        </div>
        {/* weight sliders (adjustable) */}
        {showWeights && (
          <div className={`grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 p-3 rounded-lg border ${card}`}>
            {CRITERIA.map(c => (
              <div key={c.key} className="flex flex-col gap-0.5">
                <div className="flex justify-between items-center text-[10px]"><span className="font-semibold text-slate-600 dark:text-slate-300">{c.label}</span><span className="text-slate-500 tabular-nums">{Math.round(effWeights[c.key] * 100)}%</span></div>
                <input type="range" min={0} max={40} value={Math.round((rawWeights[c.key] || 0) * 100)} onChange={e => setWeight(c.key, Number(e.target.value))} className="w-full accent-blue-600 h-1" />
              </div>
            ))}
            <button onClick={() => setWeightOverride(null)} className="col-span-2 md:col-span-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-blue-600"><RotateCcw className="w-3 h-3" /> Reset to {MODALITY_PROFILES[modality].label} defaults</button>
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* the board */}
        <div className="flex-1 overflow-auto min-w-0">
          <table className="w-full text-[12px] border-collapse">
            <thead className={`sticky top-0 z-10 ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
              <tr className={`${isDark ? 'text-slate-400 border-slate-800' : 'text-slate-500 border-slate-200'} border-b`}>
                <th className="text-left font-bold px-3 py-2 w-12">#</th>
                <th className="text-left font-bold px-2 py-2">Target</th>
                {CRITERIA.map(c => <th key={c.key} title={`${c.label}: ${c.definition}`} className="text-center font-semibold px-1 py-2 w-[68px]">{c.label}</th>)}
                <th className="text-right font-bold px-3 py-2 w-24">Overall</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(s => {
                const isPinned = s.symbol === pinned;
                const medal = s.boardRank <= 3 && !s.gated;
                return (
                  <tr key={s.symbol} onClick={() => setSelectedSym(s.symbol)}
                    className={`cursor-pointer border-b ${isDark ? 'border-slate-800/60 hover:bg-slate-800/40' : 'border-slate-100 hover:bg-blue-50/40'} ${isPinned ? (isDark ? 'bg-blue-950/40 ring-1 ring-blue-500' : 'bg-blue-50 ring-1 ring-blue-400') : ''} ${s.gated ? 'opacity-45' : ''}`}>
                    <td className="px-3 py-1.5 font-bold tabular-nums">
                      {medal ? <span className="inline-flex items-center gap-0.5"><Award className={`w-3.5 h-3.5 ${s.boardRank === 1 ? 'text-amber-400' : s.boardRank === 2 ? 'text-slate-400' : 'text-amber-700'}`} />{s.boardRank}</span> : s.boardRank}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{s.symbol}</span>
                      {isPinned && <span className="ml-1.5 text-[9px] font-bold uppercase text-blue-500">your target</span>}
                      {s.gated && <span className="ml-1.5 text-[9px] text-slate-400" title={s.gateNote}>· gated</span>}
                    </td>
                    {CRITERIA.map(c => { const v = s.criteria[c.key]; return (
                      <td key={c.key} className="px-1 py-1.5">
                        <div className={`h-1.5 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`} title={v == null ? 'no data' : `${c.label}: ${(v * 100).toFixed(0)}`}>
                          {v != null && <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, v * 100)}%`, background: barBg(v) }} />}
                        </div>
                      </td>
                    ); })}
                    <td className="px-3 py-1.5 text-right">
                      <span className={`font-black tabular-nums ${s.display >= 80 ? 'text-emerald-500' : s.display >= 50 ? (isDark ? 'text-white' : 'text-slate-900') : 'text-slate-400'}`}>{s.display}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {board.scored.length > shown.length && <p className="text-center text-[11px] text-slate-500 py-3">Showing top {shown.length} of {board.scored.length.toLocaleString()} — search to find any target.</p>}
        </div>

        {/* report card */}
        {selected && (
          <div className={`w-80 shrink-0 border-l overflow-y-auto ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            <div className={`p-4 border-b flex items-start justify-between ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <div>
                <div className={`text-lg font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>{selected.symbol}</div>
                <div className="text-[11px] text-slate-500">Rank #{selected.boardRank} · overall {selected.display}/100 · {selected.coverage}/8 criteria · {MODALITY_PROFILES[modality].label}</div>
                {selected.gated && <div className="text-[11px] text-amber-500 mt-1">⚠ {selected.gateNote}</div>}
              </div>
              <button onClick={() => setSelectedSym(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-3 space-y-3">
              {/* RWR recommender — network neighbours that outrank this target */}
              {neighborsLoading ? (
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> finding network neighbours…</div>
              ) : betterNeighbors.length > 0 ? (
                <div className={`rounded-lg border p-2.5 ${isDark ? 'bg-blue-950/30 border-blue-800/50' : 'bg-blue-50/60 border-blue-200'}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300 mb-1">You may also like</p>
                  <p className="text-[10px] text-slate-500 mb-2">Targets connected to {selected.symbol} in the STRING network that rank higher:</p>
                  <div className="space-y-1">
                    {betterNeighbors.map(({ nb, wins }) => (
                      <button key={nb.symbol} onClick={() => setSelectedSym(nb.symbol)} className={`w-full flex items-center gap-2 p-1.5 rounded-md text-left transition-colors ${isDark ? 'hover:bg-blue-900/40' : 'hover:bg-blue-100'}`}>
                        <span className="text-[11px] font-bold text-slate-400 tabular-nums w-7">#{nb.boardRank}</span>
                        <span className={`text-[12px] font-bold w-14 ${isDark ? 'text-white' : 'text-slate-900'}`}>{nb.symbol}</span>
                        <span className="text-[12px] font-black text-emerald-500 tabular-nums w-8">{nb.display}</span>
                        <span className="text-[9px] text-slate-500 flex-1 truncate">{wins.length ? `stronger: ${wins.join(', ')}` : 'higher overall'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : neighborSet.size > 0 ? (
                <div className={`rounded-lg border p-2.5 text-[11px] ${card} text-emerald-600 dark:text-emerald-400`}>✓ No network neighbour outranks {selected.symbol} — it's the strongest target in its neighbourhood.</div>
              ) : null}
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Score by criterion</p>
              {CRITERIA.map(c => {
                const v = selected.criteria[c.key]; const w = effWeights[c.key];
                // Network fallback: no stored WINNER (gene outside the top-2000 set) → show live
                // connectivity from the neighbours we already fetched. Labeled, and NOT in the overall.
                const isLiveNet = c.key === 'network' && v == null && liveConnectivity != null;
                const shownV = isLiveNet ? liveConnectivity : v;
                return (
                <div key={c.key} className={`rounded-lg border p-2.5 ${card}`}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className={`text-[12px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{c.label}</span>
                    <span className="text-[11px] tabular-nums">
                      {shownV == null ? <span className="text-slate-400">no data</span>
                        : isLiveNet ? <span className="text-slate-500">~{(shownV * 100).toFixed(0)} · live</span>
                        : <span className={isDark ? 'text-white' : 'text-slate-900'}>{(shownV * 100).toFixed(0)}/100</span>} <span className="text-slate-400">· wt {Math.round(w * 100)}%</span></span>
                  </div>
                  <div className={`h-1.5 rounded-full mb-1.5 ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>{shownV != null && <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, shownV * 100)}%`, background: isLiveNet ? (isDark ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.45)') : barBg(shownV) }} />}</div>
                  <p className="text-[10px] text-slate-500 leading-snug">{c.definition}</p>
                  <p className="text-[9px] text-slate-400 mt-1">Source: {c.source}</p>
                  {isLiveNet && <p className="text-[9px] text-slate-400 mt-1 italic">Live connectivity ({neighborSet.size} STRING partners) — outside the top-2000 WINNER set, shown for context, not counted in the overall.</p>}
                  {!isLiveNet && evidenceLine(c.key, selected.raw) && <p className={`text-[10px] mt-1.5 font-medium ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>{evidenceLine(c.key, selected.raw)}</p>}
                </div>
              ); })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// The concrete evidence value behind each criterion for this gene (the "what supports the score").
function evidenceLine(key: CriterionKey, g: any): string | null {
  const n = (x: any, d = 2) => (x == null ? null : Number(x).toFixed(d));
  switch (key) {
    case 'genetics': return [g.genetic_score != null ? `OT genetic ${n(g.genetic_score)}` : null, g.mutation_freq != null ? `${Math.round(g.mutation_freq * 100)}% mutated` : null].filter(Boolean).join(' · ') || null;
    case 'expression': return [g.expr_log2fc != null ? `mRNA log2FC ${n(g.expr_log2fc)}` : null, g.prot_log2fc != null ? `protein log2FC ${n(g.prot_log2fc)}` : null].filter(Boolean).join(' · ') || null;
    case 'dependency': return g.chronos != null ? `DepMap Chronos ${n(g.chronos)}` : null;
    case 'tractability': return [g.druggability_score != null ? `OT ${n(g.druggability_score)}` : null, g.tractable_modalities != null ? `${g.tractable_modalities} tractable modalities` : null].filter(Boolean).join(' · ') || null;
    case 'safety': return [g.loeuf != null ? `LOEUF ${n(g.loeuf)}` : null, g.is_common_essential ? 'pan-essential' : null, g.n_safety_liabilities ? `${g.n_safety_liabilities} liabilities` : null].filter(Boolean).join(' · ') || null;
    case 'clinical': return g.max_disease_phase ? `max Phase ${g.max_disease_phase} · ${g.n_disease_trials ?? 0} trials` : (g.n_disease_trials ? `${g.n_disease_trials} trials` : null);
    case 'literature': return g.velocity != null ? `velocity ${Math.round(g.velocity * 100)}% · ${g.n_publications ?? 0} papers` : null;
    case 'network': return g.winner_score != null ? `WINNER ${n(g.winner_score)}${g.is_seed ? ' · seed' : ''}` : null;
  }
  return null;
}
