// RankingBoardView — the CollaboFest flagship output (Phase 1+2).
// A US-News-style target ranking board: targets ranked by a TRANSPARENT weighted
// sum across 8 criteria (leader = 100), where the MODALITY selector re-weights the
// criteria (and gates ineligible targets) so the ranking reshuffles live. Click a
// target for its report card — per-criterion score + definition + the evidence.
// Reads /api/dashboard/genes (no new endpoint); all scoring is client-side via
// rankingBoard.ts.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Trophy, Search, X, Sliders, RotateCcw, Award, ChevronDown, ChevronUp, ChevronsUpDown, BookOpen, FileText, Atom, Microscope, Download } from 'lucide-react';
import { fetchSnapshots, authenticatedFetch, type RankingSnapshotMeta } from './supabase';
import { navigate } from './nav';
import { CRITERIA, MODALITY_PROFILES, LIT_WINDOWS, buildBoard, criterionBreakdown, computeVerdict, findBetterAlternatives, type CriterionKey, type ModalityKey, type ScoredGene, type SubMetric, type CriterionBreakdown, type LitWindow } from './rankingBoard';
import { buildTargetReportHTML, type ReportCriterion } from './targetReport';
import type { Theme } from './types';
import { setActiveBoardSnapshot, setBoardFocus, setBoardTop } from './boardStore';
import { isAgora, AGORA_COUNT } from './agoraNominated';

// Only READY modalities are offered. The others (antibody/PROTAC/RNA/gene therapy) are
// deferred until they have modality-specific criteria — see rankingBoard.ts `ready`.
const MODALITY_ORDER: ModalityKey[] = (['small_molecule', 'antibody', 'protac', 'mrna', 'gene_therapy'] as ModalityKey[])
  .filter(m => MODALITY_PROFILES[m].ready);

const ALL_KEYS = CRITERIA.map(c => c.key);

// A weight vector → integer points summing to 100, renormalised over the ACTIVE criteria only
// (so a snapshot missing an axis — e.g. dependency for Alzheimer's — spreads its budget across the
// criteria that actually have data, and the total still reads 100).
function pointsOfWeights(w: Record<CriterionKey, number>, active: CriterionKey[] = ALL_KEYS): Record<CriterionKey, number> {
  const sum = active.reduce((s, k) => s + Math.max(0, w[k] || 0), 0) || 1;
  const o = {} as Record<CriterionKey, number>; let acc = 0;
  for (const c of CRITERIA) { o[c.key] = active.includes(c.key) ? Math.round(100 * Math.max(0, w[c.key] || 0) / sum) : 0; acc += o[c.key]; }
  let diff = 100 - acc;   // fix rounding so the active points total exactly 100
  const order = active.slice().sort((a, b) => o[b] - o[a]);
  for (let i = 0; diff !== 0 && i < order.length; i++) { const k = order[i]; const nv = o[k] + (diff > 0 ? 1 : -1); if (nv >= 0) { o[k] = nv; diff += diff > 0 ? -1 : 1; } }
  return o;
}

async function getJson(url: string): Promise<any> {
  const r = await authenticatedFetch(url);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error(`${url} → ${r.status} (is the dev server restarted?)`);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || `${url} → ${r.status}`);
  return j;
}

interface SingleCellProfile {
  gene: string;
  specificity: string | null;
  distribution: string | null;
  specificityScore: number | null;
  cellTypes: { cellType: string; ncpm: number }[];
  nSpecificCellTypes: number;
  resolved: boolean;
  source: string;
}

type ThProps = {
  col: string; label: string; hint: string; align: 'left' | 'center' | 'right';
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  onSort: (key: string) => void;
  onResize: (e: React.PointerEvent, key: string) => void;
  isDark: boolean;
};
const Th = ({ col, label, hint, align, sort, onSort, onResize, isDark }: ThProps) => {
  const active = sort?.key === col;
  const Icon = !active ? ChevronsUpDown : sort!.dir === 'desc' ? ChevronDown : ChevronUp;
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  // Spelled out, not interpolated: Tailwind only ships classes it can see as literals,
  // so `text-${align}` would be purged from the build and silently do nothing.
  const textAlign = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`relative font-bold px-2 py-2 select-none ${textAlign}`} title={hint}>
      <button onClick={() => onSort(col)}
        className={`w-full flex items-center gap-1 ${justify} group ${active ? (isDark ? 'text-blue-300' : 'text-blue-600') : ''}`}>
        <span className="truncate">{label}</span>
        {/* The inactive chevron stays faint until hover so eight of these don't shout. */}
        <Icon className={`w-3 h-3 shrink-0 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`} />
      </button>
      {/* Grab strip on the column's trailing edge. Wider than it looks, so it is catchable. */}
      <span onPointerDown={e => onResize(e, col)}
        className="absolute top-0 right-0 h-full w-2 translate-x-1/2 cursor-col-resize z-20 flex justify-center group/rz">
        <span className={`w-px h-full ${isDark ? 'bg-slate-700 group-hover/rz:bg-blue-400' : 'bg-slate-200 group-hover/rz:bg-blue-500'}`} />
      </span>
    </th>
  );
};

export default function RankingBoardView({ theme, diseaseName }: { theme: Theme; diseaseName?: string }) {
  const isDark = theme === 'dark';
  // One calm accent for every criterion bar — the shade deepens with the score, so value
  // still reads at a glance without an 8-colour rainbow.
  const barBg = (v: number) => isDark ? `rgba(96,165,250,${(0.35 + 0.6 * v).toFixed(3)})` : `rgba(37,99,235,${(0.28 + 0.62 * v).toFixed(3)})`;
  const [snapshots, setSnapshots] = useState<RankingSnapshotMeta[]>([]);
  const [snapId, setSnapId] = useState('');
  const [genes, setGenes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);   // seconds spent on the current fetch (so the wait feels alive)
  // Null once the whole set has landed; while set, the board is ranking on a SUBSET of
  // the criteria and must say so rather than look finished.
  const [progress, setProgress] = useState<{ complete: boolean; axesReady: string[]; evidenceLoaded: number } | null>(null);
  const stillLoading = !!progress && !progress.complete;

  // ── Column sort ─────────────────────────────────────────────────────────
  // null = the board's own ranking, which is the point of the tool; a sort is a
  // temporary lens over it. Cycle desc → asc → back to the ranking.
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  // ── Dataset ─────────────────────────────────────────────────────────────
  // Which curation a gene came from. A VIEW over the same board — scores, ranks and
  // weights are untouched, so a gene sits at the same rank whichever dataset is
  // selected. Agora is Alzheimer's-only, so the control hides itself entirely when no
  // gene in the snapshot is nominated rather than offering an empty filter.
  type DatasetKey = 'all' | 'agora';
  const [dataset, setDataset] = useState<DatasetKey>('all');
  // Literature window — which publication count the Literature criterion scores on. Both
  // counts are already stored per gene (all time, and the harvest's 3-year window), so this
  // re-scores instantly with no fetch. Unlike the dataset filter this DOES change scores.
  const [litWindow, setLitWindow] = useState<LitWindow>('all');
  const toggleSort = (key: string) =>
    setSort(p => (p?.key === key ? (p.dir === 'desc' ? { key, dir: 'asc' } : null) : { key, dir: 'desc' }));

  // ── Column widths ────────────────────────────────────────────────────
  const DEFAULT_W: Record<string, number> = { rank: 56, target: 130, overall: 96 };
  const CRITERION_W = 76;
  const [colW, setColW] = useState<Record<string, number>>({});
  const widthOf = (k: string) => colW[k] ?? DEFAULT_W[k] ?? CRITERION_W;
  const drag = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const startResize = (e: React.PointerEvent, key: string) => {
    e.preventDefault(); e.stopPropagation();          // never let the handle trigger the header's sort
    drag.current = { key, startX: e.clientX, startW: widthOf(key) };
    const move = (ev: PointerEvent) => {
      const d = drag.current; if (!d) return;
      setColW(p => ({ ...p, [d.key]: Math.max(44, d.startW + (ev.clientX - d.startX)) }));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [error, setError] = useState<string | null>(null);

  const [modality, setModality] = useState<ModalityKey>('small_molecule');
  const [weightOverride, setWeightOverride] = useState<Record<CriterionKey, number> | null>(null);   // APPLIED weights (drives the board)
  const [draft, setDraft] = useState<Record<CriterionKey, number>>(() => pointsOfWeights(MODALITY_PROFILES.small_molecule.weights));   // 100-point budget being edited
  const [showWeights, setShowWeights] = useState(false);
  const [selectedSym, setSelectedSym] = useState<string | null>(null);
  const [expandedCrit, setExpandedCrit] = useState<CriterionKey | null>(null);   // which criterion tile is drilled into
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState<string | null>(null);
  const [neighborSet, setNeighborSet] = useState<Set<string>>(new Set());
  const [neighborsLoading, setNeighborsLoading] = useState(false);
  // Cell-type resolution for the selected target (HPA single-cell). Fetched lazily per
  // selection, not for the whole board: it is drill-down context, not a ranking input.
  const [scProfile, setScProfile] = useState<SingleCellProfile | null>(null);
  const [scLoading, setScLoading] = useState(false);

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
    setLoading(true); setError(null); setSelectedSym(null); setGenes([]); setProgress(null);
    (async () => {
      while (alive) {
        let j: any;
        try {
          j = await getJson(`/api/dashboard/genes?snapshotId=${encodeURIComponent(snapId)}&limit=20000&progressive=1`);
        } catch (e: any) {
          if (alive) { setError(String(e?.message || e)); setLoading(false); }
          return;
        }
        if (!alive) return;
        const rows: any[] = j?.rows || [];
        const p = j?.progressive ?? { complete: true, axesReady: [], evidenceLoaded: 0 };
        // Only leave the spinner once there is a board worth showing — rows arrive
        // only after at least one axis is COMPLETE, so this is never a partial-axis board.
        if (rows.length) { setGenes(rows); setLoading(false); }
        setProgress(p);
        if (p.complete) { setLoading(false); return; }
        await new Promise(r => setTimeout(r, 1500));
      }
    })();
  return () => { alive = false; };
  }, [snapId]);

  // never sit on a non-ready modality (defensive against a stale value); fall back to the first ready one
  useEffect(() => { if (!MODALITY_PROFILES[modality].ready) setModality(MODALITY_ORDER[0] || 'small_molecule'); }, [modality]);

  // Tick an elapsed-seconds counter while a fetch is in flight, so the loading screen
  // shows live progress (the first evidence pull can take several seconds).
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, [loading]);

  const board = useMemo(() => buildBoard(genes, modality, weightOverride || undefined, { litWindow }), [genes, modality, weightOverride, litWindow]);
  // Criteria that actually have data in this snapshot (dependency drops out for a non-cancer disease
  // like Alzheimer's) — drives every criterion loop below, so absent axes never show.
  const datasetCounts = useMemo(() => {
    let agora = 0;
    for (const g of board.scored) if (isAgora(g.symbol)) agora++;
    return { all: board.scored.length, agora };
  }, [board]);
  const activeKeys = board.activeCriteria;
  const activeSig = activeKeys.join(',');
  const activeDefs = useMemo(() => CRITERIA.filter(c => activeKeys.includes(c.key)), [activeSig]);
  const tableWidth = useMemo(
    () => widthOf('rank') + widthOf('target') + widthOf('overall') + activeKeys.reduce((n, k) => n + widthOf(k), 0),
    [colW, activeSig],
  );
  const thShared = { sort, onSort: toggleSort, onResize: startResize, isDark };
  const effWeights = board.weights;   // active-renormalised (sums to 1 over the criteria with data)
  // Within-category (0–1) standing: an absolute criterion score scaled by the field leader in
  // that column, so the strongest gene fills its bar. DISPLAY only — the overall score is unchanged.
  const relOf = (v: number | null | undefined, key: CriterionKey): number | null =>
    v == null || !isFinite(v) ? null : Math.max(0, Math.min(1, v / (board.criterionMax[key] || 1)));
  // switching modality OR loading a snapshot with a different set of active criteria resets the budget
  useEffect(() => { setWeightOverride(null); setDraft(pointsOfWeights(MODALITY_PROFILES[modality].weights, activeKeys)); }, [modality, activeSig]);
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
        // proxy for genes with no stored WINNER row (outside the candidate graph, or absent from
        // STRING at this version). Not fed into the overall.
        setLiveConnectivity(nbs.length ? Math.max(0, Math.min(1, nbs.length / 50)) : 0);
        setNeighborsLoading(false);
      })
      .catch(() => { if (alive) { setNeighborSet(new Set()); setLiveConnectivity(null); setNeighborsLoading(false); } });
    return () => { alive = false; };
  }, [selectedSym]);

  // F1.2 — comparable targets that OUTRANK the selected one (same family + network neighbours),
  // each with the criteria it wins on. Shared pure fn (report reuses it). Network needs the
  // neighbour fetch; family works from the board rows alone, so this shows even before neighbours load.
  const betterAlternatives = useMemo(
    () => selected ? findBetterAlternatives(selected, board.scored, activeKeys, { neighbors: neighborSet, limit: 5 }) : [],
    [selected, board, activeKeys, neighborSet],
  );

  // F1.3 — assemble a self-contained HTML report from the SAME verdict / alternatives /
  // breakdowns shown on screen, and open it in a new tab (print → Save as PDF). Falls back
  // to a download if the popup is blocked.
  const generateReport = () => {
    if (!selected || !verdict) return;
    const snapMeta = snapshots.find(s => String(s.id) === snapId);
    const snapshotLabel = snapMeta ? `snapshot #${snapMeta.id}${snapMeta.version ? ` v${snapMeta.version}` : ''}` : null;
    const criteria: ReportCriterion[] = activeDefs.map(c => {
      const v = selected.criteria[c.key]; const rel = relOf(v, c.key);
      return {
        key: c.key, label: c.label, definition: c.definition, source: c.source,
        standing: rel != null ? rel * 100 : null,
        weightPct: (effWeights[c.key] || 0) * 100,
        hasData: v != null,
        breakdown: criterionBreakdown(c.key, selected.raw, { litWindow }),
      };
    });
    const html = buildTargetReportHTML({
      gene: selected.symbol,
      diseaseName: diseaseName || 'disease',
      modalityLabel: MODALITY_PROFILES[modality].label,
      snapshotLabel,
      verdict, criteria, alternatives: betterAlternatives,
      generatedAt: new Date().toLocaleString(),
      appUrl: 'target.smartdrugdiscovery.com',
    });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    if (!win) {   // popup blocked → download instead
      const a = document.createElement('a');
      a.href = url; a.download = `${selected.symbol}_${(diseaseName || 'disease').replace(/\s+/g, '_')}_report.html`; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // ── F1.1 Verdict — the decision-tool answer. Computed by the shared pure fn in
  // rankingBoard.ts (same one the generated report will use), so card + report never drift.
  const verdict = useMemo(
    () => selected ? computeVerdict(selected, board.scored.length, activeKeys, effWeights, board.criterionMax) : null,
    [selected, board, activeKeys, effWeights],
  );

  const pinnedGene = useMemo(() => pinned ? board.scored.find(s => s.symbol === pinned) : null, [board, pinned]);
  const shown = useMemo(() => {
    let ordered = dataset === 'agora' ? board.scored.filter(g => isAgora(g.symbol)) : board.scored;
    if (sort) {
      const val = (s: any) => sort.key === 'rank' ? s.boardRank
        : sort.key === 'target' ? s.symbol
        : sort.key === 'overall' ? s.display
        : s.criteria[sort.key as CriterionKey];
      ordered = [...ordered].sort((a, b) => {
        const av = val(a), bv = val(b);
        // No-data always sinks, in BOTH directions — otherwise sorting ascending on a
        // sparse criterion fills the screen with genes that have nothing to show.
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const c = typeof av === 'string' ? String(av).localeCompare(String(bv)) : (av as number) - (bv as number);
        return sort.dir === 'asc' ? c : -c;
      });
    }
    const top = ordered.slice(0, 150);
    // A searched target floats to the TOP (with its true rank shown), so it's never buried at the
    // bottom of the list — whether it ranked inside the top 150 or far below it.
    if (!pinnedGene) return top;
    const rest = top.filter(s => s.symbol !== pinnedGene.symbol);
    return [pinnedGene, ...rest].slice(0, 150);
  }, [board, pinnedGene, sort, dataset]);

  useEffect(() => {
    let alive = true;
    setScProfile(null);
    if (!selectedSym) return;
    setScLoading(true);
    getJson(`/api/singlecell?gene=${encodeURIComponent(selectedSym)}`)
      .then(p => { if (alive) setScProfile(p as SingleCellProfile); })
      .catch(() => { if (alive) setScProfile(null); })   // 404 = HPA has nothing; the panel just hides
      .finally(() => { if (alive) setScLoading(false); });
    return () => { alive = false; };
  }, [selectedSym]);

  const runFind = () => {
    const q = query.trim().toUpperCase(); if (!q) return;
    const hit = board.scored.find(s => s.symbol.toUpperCase() === q) || board.scored.find(s => s.symbol.toUpperCase().includes(q));
    if (hit) { setPinned(hit.symbol); setSelectedSym(hit.symbol); }
  };
  // ── 100-point weight budget (over the criteria with data in this snapshot) ──
  // ── Export ────────────────────────────────────────────────────────────────
  // Everything the board shows is ALREADY in the browser — the whole gene set is
  // fetched once and scored client-side — so the export costs the server nothing and
  // is instant. It must not go back to /api/dashboard/genes, which is the slow path.
  //
  // The file carries its own provenance header. The ranking is a function of the
  // MODALITY and the WEIGHTS the user chose, so the same snapshot exports differently
  // depending on settings that live only in this component. A CSV without them cannot
  // be reproduced or even correctly interpreted later. '#' comments are the convention
  // for scientific data files (VCF/GTF) and are skippable: pandas read_csv(comment='#').
  const [exportN, setExportN] = useState<string>('500');

  const exportCsv = () => {
    const snap = snapshots.find(s => String(s.id) === String(snapId));
    const total = board.scored.length;
    const n = exportN === 'all' ? total : Math.min(Number(exportN) || 500, total);
    const rows = board.scored.slice(0, n);

    // Raw evidence columns — the measured values behind the scores, not the scores.
    const RAW: [string, (r: any) => any][] = [
      ['genetic_score', r => r.genetic_score], ['mutation_freq', r => r.mutation_freq],
      ['expr_log2fc', r => r.expr_log2fc], ['expr_low_confidence', r => r.expr_low_conf],
      ['prot_log2fc', r => r.prot_log2fc], ['chronos', r => r.chronos],
      ['frac_dependent', r => r.frac_dependent], ['loeuf', r => r.loeuf],
      ['druggability_score', r => r.druggability_score], ['tractability', r => r.tractability],
      ['proven_modalities', r => r.proven_modalities], ['n_drugs', r => r.n_drugs],
      ['n_disease_trials', r => r.n_disease_trials], ['max_disease_phase', r => r.max_disease_phase],
      ['n_stopped_trials', r => r.n_stopped_trials], ['n_publications', r => r.n_publications],
      ['literature_velocity', r => r.velocity], ['n_patents', r => r.n_patents],
      ['target_class', r => r.target_class], ['is_common_essential', r => r.is_common_essential],
      ['surface_or_secreted', r => r.surface_or_secreted], ['tissue_tau', r => r.tissue_tau],
      ['n_safety_liabilities', r => r.n_safety_liabilities],
      ['winner_score', r => r.winner_score], ['rwr_score', r => r.rwr_score],
      ['evidence_completeness', r => r.completeness],
    ];

    const head = [
      'gene_symbol', 'board_rank', 'source_rank', 'score_0_100', 'weighted_score_0_1',
      'criteria_with_data', 'gated', 'gate_reason',
      ...activeKeys.map(k => `score__${k}`),   // normalised 0-1 inputs to the weighted sum
      ...RAW.map(([h]) => h),                  // the measured evidence behind them
    ];

    const cell = (v: any) => {
      if (v == null) return '';
      const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const body = rows.map(s => [
      s.symbol, s.boardRank, s.sourceRank, s.display, s.overall,
      s.coverage, s.gated ? 'yes' : 'no', s.gateNote ?? '',
      ...activeKeys.map(k => s.criteria[k]),
      ...RAW.map(([, get]) => get(s.raw || {})),
    ].map(cell).join(','));

    const dropped = ALL_KEYS.filter(k => !activeKeys.includes(k));
    const meta = [
      `# Disease2Target — Target Ranking Board export`,
      `# snapshot: #${snapId}${snap ? ` — ${snap.disease_name}` : ''}`,
      `# modality: ${MODALITY_PROFILES[modality].label}`,
      `# weights (applied, renormalised over criteria with data):`,
      ...activeDefs.map(c => `#   ${c.label.padEnd(14)} ${Math.round((effWeights[c.key] || 0) * 100)}%   [${c.source}]`),
      dropped.length
        ? `# criteria DROPPED — no data in this snapshot, so they scored nothing: ${dropped.join(', ')}`
        : `# all 8 criteria carry data in this snapshot`,
      `# rows: ${rows.length.toLocaleString()} of ${total.toLocaleString()} ranked targets`,
      `# score_0_100 is relative to this snapshot's leader; it is NOT comparable across snapshots`,
      `# exported: ${new Date().toISOString()}`,
      `#`,
    ];

    const blob = new Blob(['﻿' + [...meta, head.join(','), ...body].join('\n')],
      { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ranking_board_snapshot${snapId}_${modality}_top${rows.length}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const draftTotal = activeKeys.reduce((s, k) => s + (draft[k] || 0), 0);
  const draftValid = draftTotal === 100;
  const appliedPoints = pointsOfWeights(weightOverride || MODALITY_PROFILES[modality].weights, activeKeys);
  const dirty = activeKeys.some(k => (draft[k] || 0) !== (appliedPoints[k] || 0));
  const setDraftPoint = (k: CriterionKey, v: number) => setDraft(d => ({ ...d, [k]: Math.max(0, Math.min(100, Math.round(v))) }));
  // Apply is the SAVE step — only allowed when the budget totals exactly 100.
  const applyWeights = () => { if (!draftValid) return; const w = {} as Record<CriterionKey, number>; for (const k of activeKeys) w[k] = (draft[k] || 0) / 100; setWeightOverride(w); };
  const resetWeights = () => { setWeightOverride(null); setDraft(pointsOfWeights(MODALITY_PROFILES[modality].weights, activeKeys)); };
  // Proportionally snap the draft so it totals exactly 100 (integer, remainder to the largest slices).
  const rebalanceWeights = () => {
    const t = draftTotal;
    if (t <= 0) { setDraft(pointsOfWeights(MODALITY_PROFILES[modality].weights, activeKeys)); return; }
    const scaled = {} as Record<CriterionKey, number>; let acc = 0;
    for (const k of activeKeys) { scaled[k] = Math.round((draft[k] || 0) / t * 100); acc += scaled[k]; }
    let diff = 100 - acc;
    const order = activeKeys.slice().sort((a, b) => (scaled[b] - scaled[a]));
    for (let i = 0; diff !== 0 && i < order.length; i++) { const k = order[i]; const nv = scaled[k] + (diff > 0 ? 1 : -1); if (nv >= 0) { scaled[k] = nv; diff += diff > 0 ? -1 : 1; } }
    setDraft(scaled);
  };

  const card = isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200';
  const snapMeta = snapshots.find(s => String(s.id) === snapId);

  // Tell the co-pilot what the board is showing. The board deliberately does NOT
  // write researchState.activeDisease (see boardStore.ts) - this publishes the fact
  // without triggering the reload cascade that would cause.
  useEffect(() => {
    setActiveBoardSnapshot(snapMeta ? {
      id: Number(snapMeta.id),
      disease_name: String(snapMeta.disease_name || ''),
      gene_count: snapMeta.gene_count != null ? Number(snapMeta.gene_count) : null,
      version: (snapMeta as any).version != null ? Number((snapMeta as any).version) : null,
      // Which axes this snapshot actually scores on. The methodology page documents
      // the published weights; without this it cannot say that some were dropped and
      // the budget renormalised over the rest.
      activeCriteria: [...activeKeys],
      inactiveCriteria: CRITERIA.map(c => c.key).filter(k => !activeKeys.includes(k)),
      modality,
    } : null);
  }, [snapMeta?.id, snapMeta?.disease_name, snapMeta?.gene_count, activeSig, modality]);

  // …and what is selected / at the top, so the co-pilot answers about the screen.
  useEffect(() => {
    setBoardTop(board.scored.slice(0, 10).map(s => s.symbol), litWindow);
    setBoardFocus(selected ? {
      symbol: selected.symbol, boardRank: selected.boardRank, total: board.scored.length, display: selected.display,
      tier: verdict?.tier, criteria: selected.criteria, weights: effWeights,
      strengths: verdict?.strengths, drags: verdict?.drags,
    } : null);
    return () => { setBoardFocus(null); };
  }, [selected, verdict, board, effWeights, litWindow]);

  if (loading) {
    // Rotating status so the user sees it's actively working, not frozen.
    const stage = elapsed < 2 ? 'Connecting to the evidence store…'
      : elapsed < 6 ? 'Fetching evidence across all axes…'
      : elapsed < 12 ? 'Assembling per-target evidence…'
      : 'Scoring and ranking targets…';
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
        <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
        <div>
          <p className={`text-sm font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>Getting evidence… <span className="tabular-nums font-normal text-slate-400">{elapsed}s</span></p>
          <p className="text-xs text-slate-400 mt-1">{stage}</p>
        </div>
        <p className="text-[11px] text-slate-400 max-w-xs leading-snug">Pulling this disease's full evidence set from the store. First load only — it's cached afterward, so reopening is instant.</p>
      </div>
    );
  }
  if (error) return <div className="h-full flex flex-col items-center justify-center gap-2 text-center p-8"><Trophy className="w-10 h-10 text-slate-400 mb-2" /><p className="text-sm font-semibold text-red-500">Couldn't load the board</p><p className="text-xs text-slate-500 max-w-md">{error}</p></div>;


  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <div className={`px-4 py-2.5 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} space-y-2.5`}>
        {stillLoading && (
          <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${isDark ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-300 bg-amber-50'}`}>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
            <span className={`text-[11px] font-semibold ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
              Provisional ranking — {activeKeys.length} of {CRITERIA.length} criteria loaded
            </span>
            <span className="text-[11px] text-amber-700/80 dark:text-amber-400/70 truncate">
              · still fetching {CRITERIA.filter(c => !activeKeys.includes(c.key)).map(c => c.label).join(', ')}. Order will change as they arrive.
            </span>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Target Ranking Board</span>
          </div>
          <select value={snapId} onChange={e => setSnapId(e.target.value)} className={`text-xs rounded-md border px-2 py-1 outline-none ${card} ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {snapshots.map(s => <option key={s.id} value={String(s.id)}>Snapshot #{s.id}{(s as any).version != null ? ` · v${(s as any).version}` : ''}</option>)}
          </select>
          <span className="text-[11px] text-slate-500">
            {dataset === 'all'
              ? `${board.scored.length.toLocaleString()} targets`
              : `${shown.length.toLocaleString()} shown of ${datasetCounts[dataset].toLocaleString()}`} · leader = 100
          </span>
          {/* Dataset — which curation the gene came from. Hidden entirely when this
              snapshot has no Agora genes, because Agora only covers Alzheimer's and an
              always-visible control that does nothing on other diseases is worse than
              no control. Filtering does NOT rescale: a gene keeps its rank and score,
              so the numbers mean the same thing in either dataset. */}
          {datasetCounts.agora > 0 && (
            <select
              value={dataset}
              onChange={e => setDataset(e.target.value as DatasetKey)}
              title="Scope the board to a gene set. Ranks and scores are unchanged."
              className={`text-xs rounded-md border px-2 py-1 outline-none ${card} ${isDark ? 'text-white' : 'text-slate-900'}`}>
              <option value="all">All targets · {datasetCounts.all.toLocaleString()}</option>
              <option value="agora">Agora nominated · {datasetCounts.agora.toLocaleString()}</option>
            </select>
          )}
          {/* Literature window — scores the Literature criterion on the all-time or 3-year
              publication count. Changes scores (unlike the dataset filter), so it is labelled. */}
          <select
            value={litWindow}
            onChange={e => setLitWindow(e.target.value as LitWindow)}
            title="Which publication count the Literature criterion scores on. Re-scores the board."
            className={`text-xs rounded-md border px-2 py-1 outline-none ${card} ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {LIT_WINDOWS.map(w => <option key={w.key} value={w.key}>Literature · {w.label}</option>)}
          </select>
          <div className="flex-1" />
          <div className={`flex items-center gap-1 rounded-md border px-2 ${card}`}>
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runFind()} placeholder="Is my target…?" className={`bg-transparent text-xs py-1.5 w-32 outline-none ${isDark ? 'text-white placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'}`} />
          </div>
          {/* Export — the row count sits beside the button so the scope is visible before
              clicking, rather than hidden behind a menu. */}
          <div className={`flex items-center rounded-md border ${card}`}>
            <select value={exportN} onChange={e => setExportN(e.target.value)}
              title="How many ranked targets to include, taken from the top of the current ranking"
              className={`bg-transparent text-[11px] font-semibold pl-2 pr-1 py-1.5 outline-none ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
              <option value="100">Top 100</option>
              <option value="500">Top 500</option>
              <option value="1000">Top 1000</option>
              <option value="all">All {board.scored.length.toLocaleString()}</option>
            </select>
            <button onClick={exportCsv} disabled={!board.scored.length}
              title="Download these targets as CSV — scores, the criteria behind them, and the raw evidence values. Includes the modality and weights used, without which the ranking cannot be reproduced."
              className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 text-[11px] font-semibold border-l ${isDark ? 'border-slate-700 text-slate-200' : 'border-slate-200 text-slate-700'} ${board.scored.length ? '' : 'opacity-40'}`}>
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
          <button onClick={() => setShowWeights(v => !v)} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-semibold ${card} ${isDark ? 'text-slate-200' : 'text-slate-700'}`}><Sliders className="w-3.5 h-3.5" /> Weights</button>
          <button onClick={() => navigate('/Methodologies')} title="How the board scores and ranks targets — opens /Methodologies" className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-semibold ${card} ${isDark ? 'text-slate-200' : 'text-slate-700'}`}><BookOpen className="w-3.5 h-3.5" /> Methodology</button>
        </div>
        {/* Modality conditions the weights, so WHICH one the board is ranking for is context
            the numbers need — without it the ranking reads as universal when it is not.
            But it is only a CONTROL when there is something to switch to: with a single
            validated modality, a highlighted pill implies a choice that does not exist, so
            it renders as a statement and becomes a selector again when a second ships.
            The deferred modalities live in Methodology, which gives each one its pending
            criteria and the reasoning; repeating them here charged every look at the board
            for a roadmap notice that is only news once. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Modality</span>
          {MODALITY_ORDER.length > 1 ? MODALITY_ORDER.map(m => (
            <button key={m} onClick={() => setModality(m)} title={MODALITY_PROFILES[m].note}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${modality === m ? 'bg-blue-600 border-blue-600 text-white' : (isDark ? 'bg-transparent border-slate-700 text-slate-300 hover:border-blue-500' : 'bg-transparent border-slate-200 text-slate-700 hover:border-blue-500')}`}>
              {MODALITY_PROFILES[m].label}
            </button>
          )) : (
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${isDark ? 'border-slate-700 text-slate-200' : 'border-slate-200 text-slate-800'}`}>
              {MODALITY_PROFILES[modality].label}
            </span>
          )}
          <span className="text-[11px] text-slate-500 ml-1 hidden lg:inline">— {MODALITY_PROFILES[modality].note}</span>
        </div>
        {/* weight budget — 100 points allocated across the 8 criteria; must total 100 to apply */}
        {showWeights && (
          <div className={`p-3 rounded-lg border ${card} space-y-2.5`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Weight budget — allocate 100 points</span>
              <div className="flex items-center gap-2">
                <span className={`text-[12px] font-black tabular-nums ${draftValid ? 'text-emerald-500' : 'text-amber-500'}`}>{draftTotal} / 100{draftValid ? ' ✓' : ''}</span>
                {/* budget meter */}
                <div className={`w-24 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} title={`${draftTotal} of 100 points allocated`}>
                  <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, draftTotal)}%`, background: draftValid ? '#10b981' : (draftTotal > 100 ? '#ef4444' : '#f59e0b') }} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
              {activeDefs.map(c => (
                <div key={c.key} className="flex flex-col gap-0.5">
                  <div className="flex justify-between items-center text-[10px]"><span className="font-semibold text-slate-600 dark:text-slate-300">{c.label}</span><span className="text-slate-500 tabular-nums">{draft[c.key] || 0} pt</span></div>
                  <input type="range" min={0} max={60} value={draft[c.key] || 0} onChange={e => setDraftPoint(c.key, Number(e.target.value))} className="w-full accent-blue-600 h-1" />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[10px] min-h-[1rem]">
                {!draftValid ? <span className="text-amber-500 font-medium">{draftTotal > 100 ? `Remove ${draftTotal - 100}` : `Add ${100 - draftTotal}`} point{Math.abs(draftTotal - 100) === 1 ? '' : 's'} to reach 100 — or rebalance.</span>
                  : dirty ? <span className="text-blue-500 font-medium">Ready to apply.</span>
                  : <span className="text-emerald-500 font-medium">✓ Applied — the board reflects these weights.</span>}
              </p>
              <div className="flex items-center gap-1.5">
                {!draftValid && <button onClick={rebalanceWeights} className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border ${isDark ? 'border-slate-700 text-slate-300 hover:border-blue-500' : 'border-slate-200 text-slate-600 hover:border-blue-500'}`}>Rebalance to 100</button>}
                <button onClick={resetWeights} className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border ${isDark ? 'border-slate-700 text-slate-300 hover:border-blue-500' : 'border-slate-200 text-slate-600 hover:border-blue-500'}`}><RotateCcw className="w-3 h-3" /> Defaults</button>
                <button onClick={applyWeights} disabled={!draftValid || !dirty}
                  className={`text-[11px] font-bold px-3 py-1 rounded-md border transition-colors ${draftValid && dirty ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700' : (isDark ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed')}`}>
                  Apply weights
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* the board */}
        <div className="flex-1 overflow-auto min-w-0">
          {/* table-fixed + colgroup so the drag handles actually govern width; the table is
              allowed to exceed the pane (min-w-full) and the wrapper scrolls horizontally. */}
          <table className="text-[12px] border-collapse table-fixed min-w-full" style={{ width: tableWidth }}>
            <colgroup>
              <col style={{ width: widthOf('rank') }} />
              <col style={{ width: widthOf('target') }} />
              {activeDefs.map(c => <col key={c.key} style={{ width: widthOf(c.key) }} />)}
              <col style={{ width: widthOf('overall') }} />
            </colgroup>
            <thead className={`sticky top-0 z-10 ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
              <tr className={`${isDark ? 'text-slate-400 border-slate-800' : 'text-slate-500 border-slate-200'} border-b`}>
                <Th col="rank"    align="left"   label="#"       hint="Rank on the board" {...thShared} />
                <Th col="target"  align="left"   label="Target"  hint="Gene symbol" {...thShared} />
                {activeDefs.map(c => (
                  <Th key={c.key} col={c.key} align="center" label={c.label} hint={`${c.label}: ${c.definition}`} {...thShared} />
                ))}
                <Th col="overall" align="right"  label="Overall" hint="Weighted score across the active criteria" {...thShared} />
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
                    {activeDefs.map(c => { const v = s.criteria[c.key]; const rel = relOf(v, c.key); return (
                      <td key={c.key} className="px-1 py-1.5">
                        <div className={`h-1.5 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`} title={v == null || rel == null ? 'no data' : `${c.label}: ${(rel * 100).toFixed(0)}/100 vs field (absolute ${(v * 100).toFixed(0)})`}>
                          {rel != null && <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, rel * 100)}%`, background: barBg(rel) }} />}
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
                <div className="text-[11px] text-slate-500">Rank #{selected.boardRank} · overall {selected.display}/100 · {selected.coverage}/{activeDefs.length} criteria · {MODALITY_PROFILES[modality].label}</div>
                {selected.gated && <div className="text-[11px] text-amber-500 mt-1">⚠ {selected.gateNote}</div>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={generateReport} title="Generate a shareable target report (opens in a new tab)"
                  className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md border transition-colors ${isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
                  <FileText className="w-3.5 h-3.5" /> Report
                </button>
                <button onClick={() => setSelectedSym(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="p-3 space-y-3">
              {/* F1.1 — Verdict: the decision-tool answer, not just a score */}
              {verdict && (
                <div className={`rounded-lg border p-3 ${
                  verdict.isTop ? (isDark ? 'bg-emerald-950/30 border-emerald-800/50' : 'bg-emerald-50 border-emerald-200')
                  : verdict.tone === 'low' ? (isDark ? 'bg-rose-950/20 border-rose-900/50' : 'bg-rose-50 border-rose-200')
                  : (isDark ? 'bg-slate-800/40 border-slate-700' : 'bg-slate-50 border-slate-200')
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] font-black uppercase tracking-widest ${
                      verdict.isTop ? 'text-emerald-600 dark:text-emerald-300'
                      : verdict.tone === 'low' ? 'text-rose-600 dark:text-rose-300'
                      : 'text-slate-500'}`}>{verdict.tier}</span>
                    <span className="text-[10px] font-bold text-slate-400 tabular-nums">top {Math.max(1, Math.round(verdict.pctTop * 100))}%</span>
                  </div>
                  <p className={`text-[12px] font-semibold mt-1 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    #{verdict.rank.toLocaleString()} of {verdict.total.toLocaleString()}{diseaseName ? ` for ${diseaseName}` : ''}
                  </p>
                  {verdict.strengths.length > 0 && (
                    <p className="text-[11px] mt-1.5 leading-snug text-slate-500">
                      <span className="font-bold text-emerald-500">Strong on:</span> {verdict.strengths.join(', ')}
                    </p>
                  )}
                  {(verdict.drags.length > 0 || verdict.gaps.length > 0) && (
                    <p className="text-[11px] mt-0.5 leading-snug text-slate-500">
                      <span className="font-bold text-amber-500">Held back by:</span>{' '}
                      {[...verdict.drags, ...verdict.gaps.map(g => `${g} (no data)`)].join(', ')}
                    </p>
                  )}
                  {!verdict.isTop && (
                    <p className="text-[10px] mt-1.5 text-slate-400 italic">Not among the top candidates — see stronger alternatives below.</p>
                  )}
                </div>
              )}
              {/* F1.2 — Stronger alternatives: comparable targets (same family / network) that outrank this one */}
              {betterAlternatives.length > 0 ? (
                <div className={`rounded-lg border p-2.5 ${isDark ? 'bg-blue-950/30 border-blue-800/50' : 'bg-blue-50/60 border-blue-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">Stronger alternatives</p>
                    {neighborsLoading && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
                  </div>
                  <p className="text-[10px] text-slate-500 mb-2">Comparable targets that rank higher than {selected.symbol} — by protein family or STRING network:</p>
                  <div className="space-y-1">
                    {betterAlternatives.map(a => (
                      <button key={a.symbol} onClick={() => setSelectedSym(a.symbol)}
                        title={`#${a.boardRank} ${a.symbol} · score ${a.display} · comparable by ${a.tags.join(' + ')}${a.wins.length ? ` · beats ${selected.symbol} on: ${a.wins.join(', ')}` : ` · higher overall score than ${selected.symbol}`}`}
                        className={`w-full p-1.5 rounded-md text-left transition-colors ${isDark ? 'hover:bg-blue-900/40' : 'hover:bg-blue-100'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-400 tabular-nums w-8">#{a.boardRank}</span>
                          <span className={`text-[12px] font-bold w-14 shrink-0 ${isDark ? 'text-white' : 'text-slate-900'}`}>{a.symbol}</span>
                          <span className="text-[12px] font-black text-emerald-500 tabular-nums w-7">{a.display}</span>
                          <span className="flex gap-0.5 shrink-0 ml-auto">
                            {a.tags.map(t => (
                              <span key={t} className={`text-[8px] font-bold uppercase px-1 py-px rounded ${t === 'family' ? 'bg-violet-500/15 text-violet-500' : 'bg-cyan-500/15 text-cyan-500'}`}>{t}</span>
                            ))}
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-500 mt-0.5 pl-10 leading-snug">
                          {a.wins.length ? <><span className="text-emerald-500 font-semibold">beats {selected.symbol} on:</span> {a.wins.join(', ')}</> : 'higher overall score'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : neighborsLoading ? (
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> finding comparable targets…</div>
              ) : (selected && !verdict?.isTop) ? (
                <div className={`rounded-lg border p-2.5 text-[11px] ${card} text-emerald-600 dark:text-emerald-400`}>✓ No comparable target (same family or network) outranks {selected.symbol}.</div>
              ) : null}
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Score by criterion</p>
                <span className="text-[9px] text-slate-400">bars = standing vs. field (best = 100)</span>
              </div>
              {activeDefs.map(c => {
                const v = selected.criteria[c.key]; const w = effWeights[c.key];
                // Network fallback: no stored WINNER (gene outside the candidate graph, or not in
                // STRING) → show live connectivity from the neighbours we already fetched. Labeled,
                // and NOT in the overall.
                const isLiveNet = c.key === 'network' && v == null && liveConnectivity != null;
                // Within-category standing (leader = 100) drives the bar + headline; the drill-down
                // keeps the absolute values. Live-net keeps its own proxy (no field basis).
                const rel = relOf(v, c.key);
                const barV = isLiveNet ? liveConnectivity : rel;
                const open = expandedCrit === c.key;
                return (
                <div key={c.key} className={`rounded-lg border ${card} ${open ? (isDark ? 'ring-1 ring-blue-500/50' : 'ring-1 ring-blue-300') : ''}`}>
                  {/* clickable header — toggles the deep dive */}
                  <button onClick={() => setExpandedCrit(open ? null : c.key)}
                    className={`w-full text-left p-2.5 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}>
                    <div className="flex justify-between items-baseline mb-1 gap-2">
                      <span className={`text-[12px] font-bold flex items-center gap-1 ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />{c.label}
                      </span>
                      <span className="text-[11px] tabular-nums whitespace-nowrap">
                        {v == null && !isLiveNet ? <span className="text-slate-400">no data</span>
                          : isLiveNet ? <span className="text-slate-500">~{((barV ?? 0) * 100).toFixed(0)} · live</span>
                          : <span className={isDark ? 'text-white' : 'text-slate-900'}>{((rel ?? 0) * 100).toFixed(0)}<span className="text-slate-400 font-normal"> vs field</span></span>} <span className="text-slate-400">· wt {Math.round(w * 100)}%</span></span>
                    </div>
                    <div className={`h-1.5 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>{barV != null && <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, barV * 100)}%`, background: isLiveNet ? (isDark ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.45)') : barBg(barV) }} />}</div>
                    {!open && <p className="text-[9px] text-slate-400 mt-1.5">{c.definition.length > 70 ? c.definition.slice(0, 68) + '…' : c.definition} <span className="text-blue-500 font-semibold">· details</span></p>}
                  </button>
                  {open && (
                    <div className={`px-2.5 pb-2.5 pt-0.5 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                      <p className="text-[10px] text-slate-500 leading-snug mt-2">{c.definition}</p>
                      <p className="text-[9px] text-slate-400 mt-1">Source: {c.source}</p>
                      {isLiveNet ? (
                        <p className="text-[9px] text-slate-400 mt-2 italic">Live connectivity ({neighborSet.size} STRING partners) — no stored disease-network score for this gene: it is outside the snapshot’s Open Targets candidate graph, or STRING v12.0 has no protein for it. Shown for context, not counted in the overall.</p>
                      ) : (
                        <DeepDive breakdown={criterionBreakdown(c.key, selected.raw, { litWindow })} isDark={isDark} barBg={barBg} />
                      )}
                    </div>
                  )}
                </div>
              ); })}
              {/* Cell-type resolution — the cell-level counterpart of tissue tau. Read-only
                  context: it does NOT feed the score, so it cannot silently move a ranking. */}
              {(scLoading || scProfile?.resolved) && (
                <div className={`mt-1 p-2.5 rounded-lg border ${card}`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Microscope className="w-3.5 h-3.5 text-violet-500" />
                    <span className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Cell types</span>
                    {scProfile?.specificity && (
                      <span className="ml-auto text-[9.5px] font-bold text-violet-500">{scProfile.specificity}</span>
                    )}
                  </div>
                  {scLoading && <div className="text-[11px] text-slate-500">Looking up cell-type expression…</div>}
                  {!scLoading && scProfile?.resolved && (
                    <>
                      {scProfile.cellTypes.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {scProfile.cellTypes.slice(0, 4).map(c => {
                            const max = scProfile.cellTypes[0].ncpm || 1;
                            return (
                              <div key={c.cellType} className="flex items-center gap-2">
                                <span className={`text-[10.5px] truncate flex-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`} title={c.cellType}>{c.cellType}</span>
                                <div className={`h-1.5 w-14 rounded-full shrink-0 ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                                  <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${Math.max(6, (c.ncpm / max) * 100)}%` }} />
                                </div>
                                <span className="text-[10px] tabular-nums text-slate-400 w-14 text-right shrink-0">{c.ncpm.toLocaleString()}</span>
                              </div>
                            );
                          })}
                          {scProfile.cellTypes.length > 4 && (
                            <span className="text-[10px] text-slate-400 mt-0.5">+{scProfile.cellTypes.length - 4} more cell types</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500">
                          {scProfile.distribution ?? 'Broadly expressed'} — no cell type stands out.
                        </div>
                      )}
                      <p className="text-[9.5px] text-slate-400 mt-2 leading-snug">
                        HPA single-cell, <strong>normal tissue</strong> — where the target is expressed, not where it is
                        dysregulated in disease.
                      </p>
                    </>
                  )}
                </div>
              )}
              {/* Modality fit opens on its own full-width page, with this target preselected */}
              <button onClick={() => navigate(`/Modality?gene=${encodeURIComponent(selected.symbol)}`)}
                title={`Which therapeutic modality suits ${selected.symbol}? Opens the full Modality Fit page.`}
                className={`w-full flex items-center justify-center gap-1.5 mt-1 px-2.5 py-2 rounded-lg border text-[11px] font-bold transition-colors ${card} ${isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`}>
                <Atom className="w-3.5 h-3.5 text-blue-500" /> Modality fit for {selected.symbol} →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// The per-criterion deep dive — every underlying metric with its raw value, how it
// participates (weighted term / multiplicative factor / context), a bar for the exact
// 0–1 contribution the score uses, and a fact-vs-prediction tag. Fed by criterionBreakdown().
function DeepDive({ breakdown, isDark, barBg }: { breakdown: CriterionBreakdown; isDark: boolean; barBg: (v: number) => string }) {
  const roleChip = (m: SubMetric) => {
    if (m.role === 'term') return `${m.weightPct}% of score`;
    if (m.role === 'factor') return 'multiplier';
    return 'context';
  };
  return (
    <div className="mt-2.5 space-y-2">
      <div className={`text-[9px] leading-snug rounded-md px-2 py-1.5 ${isDark ? 'bg-slate-800/60 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
        <span className="font-black uppercase tracking-wider text-[8px] mr-1">How it combines</span>{breakdown.formula}
        <span className="italic"> Values below are absolute (the tile bar shows standing vs. the field).</span>
      </div>
      {breakdown.metrics.map((m, i) => {
        const dim = m.value == null;
        return (
          <div key={i} className={`rounded-md p-2 ${isDark ? 'bg-slate-800/40' : 'bg-slate-50'} ${dim ? 'opacity-55' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{m.label}</span>
              <span className={`text-[11px] tabular-nums font-bold whitespace-nowrap ${dim ? 'text-slate-400 font-normal' : (isDark ? 'text-white' : 'text-slate-900')}`}>{m.value ?? '—'}</span>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <span className={`text-[8px] font-bold uppercase tracking-wide px-1 py-px rounded ${m.role === 'context' ? (isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-500') : (isDark ? 'bg-blue-950 text-blue-300' : 'bg-blue-100 text-blue-700')}`}>{roleChip(m)}</span>
              <span className={`text-[8px] font-bold uppercase tracking-wide px-1 py-px rounded ${m.kind === 'fact' ? (isDark ? 'bg-emerald-950 text-emerald-400' : 'bg-emerald-100 text-emerald-700') : (isDark ? 'bg-violet-950 text-violet-300' : 'bg-violet-100 text-violet-700')}`}>{m.kind}</span>
            </div>
            {m.sub != null && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className={`flex-1 h-1 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}><div className="h-1 rounded-full" style={{ width: `${Math.max(3, m.sub * 100)}%`, background: barBg(m.sub) }} /></div>
                <span className="text-[9px] text-slate-500 tabular-nums w-8 text-right">{(m.sub * 100).toFixed(0)}</span>
              </div>
            )}
            {m.note && <p className="text-[9px] text-slate-500 leading-snug mt-1.5">{m.note}</p>}
          </div>
        );
      })}
    </div>
  );
}
