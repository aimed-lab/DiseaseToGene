import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Activity, Dna, GitBranch, CornerDownLeft } from 'lucide-react';
import { fetchSnapshots, type RankingSnapshotMeta } from './supabase';
import type { Theme, Target } from './types';

// One search box in the header lane, beside the view tabs — the app's single entry point for
// "take me to X". It answers three kinds of X:
//   disease  → loads that disease's latest snapshot (this is also how you SWITCH disease, so
//              the disease bar below no longer needs its own control)
//   target   → focuses that gene in the Target List
//   pathway  → expands inline to the genes in it, so one click gets from a pathway to a gene
// Empty query + focus lists every loaded disease, so it works as a picker as well as a search.

export interface GlobalSearchHandle { focus: () => void }

interface Props {
  theme: Theme;
  targets: Target[];
  activeDiseaseId?: string | null;
  onPickDisease: (snapshotId: string) => void | Promise<void>;
  onPickGene: (symbol: string) => void;
  busy?: boolean;
}

type Row =
  | { kind: 'disease'; key: string; label: string; sub: string; snapshotId: string; current: boolean }
  | { kind: 'gene'; key: string; label: string; sub: string; symbol: string }
  | { kind: 'pathway'; key: string; label: string; sub: string; genes: string[] };

const GROUP_LABEL: Record<Row['kind'], string> = { disease: 'Diseases', gene: 'Targets', pathway: 'Pathways' };
const GROUP_ICON: Record<Row['kind'], any> = { disease: Activity, gene: Dna, pathway: GitBranch };

export const GlobalSearch = forwardRef<GlobalSearchHandle, Props>(function GlobalSearch(
  { theme, targets, activeDiseaseId, onPickDisease, onPickGene, busy }, ref,
) {
  const isDark = theme === 'dark';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [snaps, setSnaps] = useState<RankingSnapshotMeta[]>([]);
  const [drill, setDrill] = useState<{ label: string; genes: string[] } | null>(null);   // a pathway opened inline
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => { inputRef.current?.focus(); setOpen(true); } }), []);

  useEffect(() => { let alive = true; fetchSnapshots().then(s => { if (alive) setSnaps(s); }).catch(() => {}); return () => { alive = false; }; }, [activeDiseaseId]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // "/" from anywhere focuses the search, the way every search-first app behaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !t?.isContentEditable) {
        e.preventDefault(); inputRef.current?.focus(); setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // One entry per disease: its newest snapshot.
  const diseases = useMemo(() => {
    const by = new Map<string, RankingSnapshotMeta>();
    for (const s of snaps) { const k = s.disease_id || s.disease_name; const p = by.get(k); if (!p || Number(s.id) > Number(p.id)) by.set(k, s); }
    return [...by.values()].sort((a, b) => String(a.disease_name).localeCompare(String(b.disease_name)));
  }, [snaps]);

  const pathways = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of targets) for (const p of (t.pathways || [])) {
      const label = String((p as any)?.label || '').trim(); if (!label) continue;
      const arr = m.get(label); if (arr) { if (!arr.includes(t.symbol)) arr.push(t.symbol); } else m.set(label, [t.symbol]);
    }
    return m;
  }, [targets]);

  const rows: Row[] = useMemo(() => {
    if (drill) return drill.genes.map(sym => {
      const t = targets.find(x => x.symbol === sym);
      return { kind: 'gene' as const, key: `d:${sym}`, label: sym, sub: t?.name || drill.label, symbol: sym };
    });
    const term = q.trim().toLowerCase();
    const dRows: Row[] = diseases
      .filter(d => !term || String(d.disease_name).toLowerCase().includes(term) || String(d.disease_id).toLowerCase().includes(term))
      .slice(0, 6)
      .map(d => ({ kind: 'disease', key: `s:${d.id}`, label: String(d.disease_name), sub: `${d.gene_count != null ? `${Number(d.gene_count).toLocaleString()} genes · ` : ''}snapshot #${d.id}`, snapshotId: String(d.id), current: !!activeDiseaseId && d.disease_id === activeDiseaseId }));
    if (!term) return dRows;
    const gRows: Row[] = targets
      .filter(t => t.symbol.toLowerCase().includes(term) || String(t.name || '').toLowerCase().includes(term))
      .sort((a, b) => (a.symbol.toLowerCase() === term ? -1 : b.symbol.toLowerCase() === term ? 1 : a.symbol.length - b.symbol.length))
      .slice(0, 6)
      .map(t => ({ kind: 'gene', key: `g:${t.symbol}`, label: t.symbol, sub: String(t.name || 'target'), symbol: t.symbol }));
    const pRows: Row[] = [...pathways.entries()]
      .filter(([label]) => label.toLowerCase().includes(term))
      .slice(0, 4)
      .map(([label, genes]) => ({ kind: 'pathway', key: `p:${label}`, label, sub: `${genes.length} loaded target${genes.length === 1 ? '' : 's'}`, genes }));
    return [...dRows, ...gRows, ...pRows];
  }, [q, drill, diseases, targets, pathways, activeDiseaseId]);

  useEffect(() => { setCursor(0); }, [q, drill]);

  const pick = (r: Row) => {
    if (r.kind === 'disease') { if (!r.current) onPickDisease(r.snapshotId); setOpen(false); setQ(''); inputRef.current?.blur(); }
    else if (r.kind === 'gene') { onPickGene(r.symbol); setOpen(false); setQ(''); setDrill(null); inputRef.current?.blur(); }
    else { setDrill({ label: r.label, genes: r.genes }); }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { if (drill) setDrill(null); else { setOpen(false); inputRef.current?.blur(); } return; }
    if (e.key === 'Backspace' && !q && drill) { setDrill(null); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[cursor]; if (r) pick(r); }
  };

  const border = isDark ? 'border-slate-700' : 'border-slate-200';
  const panel = isDark ? 'bg-[#0d1424] border-slate-700' : 'bg-white border-slate-200';
  const muted = isDark ? 'text-slate-500' : 'text-slate-400';

  let lastKind: string | null = null;

  return (
    <div ref={boxRef} className="hidden md:block relative ml-auto w-[210px] xl:w-[280px] shrink-0">
      <div className={`flex items-center gap-2 rounded-lg border px-2.5 h-9 transition-colors ${border} ${isDark ? 'bg-slate-900/60 focus-within:border-slate-500' : 'bg-slate-50 focus-within:border-slate-400'}`}>
        {busy ? <Loader2 className={`w-3.5 h-3.5 animate-spin shrink-0 ${muted}`} /> : <Search className={`w-3.5 h-3.5 shrink-0 ${muted}`} />}
        {drill && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 max-w-[90px] truncate text-white" style={{ background: 'var(--disease-accent)' }} title={drill.label}>{drill.label}</span>
        )}
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={drill ? 'genes in pathway…' : 'Search disease, target, pathway…'}
          aria-label="Search diseases, targets and pathways"
          className={`bg-transparent text-[12px] w-full outline-none ${isDark ? 'text-slate-100 placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'}`}
        />
        {!q && !drill && <kbd className={`hidden xl:block text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${border} ${muted}`}>/</kbd>}
      </div>

      {open && (
        <div className={`absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border shadow-2xl overflow-hidden ${panel}`}>
          {drill && (
            <button onClick={() => setDrill(null)} className={`w-full text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider border-b ${border} ${muted} ${isDark ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'}`}>
              ← back to all results
            </button>
          )}
          <div className="max-h-[340px] overflow-y-auto py-1">
            {rows.length === 0 ? (
              <div className={`px-3 py-4 text-[12px] ${muted}`}>
                {q.trim() ? <>Nothing matches “{q.trim()}”. Targets and pathways come from the loaded list — a gene ranked below it may still be in the snapshot; ask the co-pilot.</> : 'No diseases loaded yet.'}
              </div>
            ) : rows.map((r, i) => {
              const Icon = GROUP_ICON[r.kind];
              const head = r.kind !== lastKind && !drill ? (lastKind = r.kind, GROUP_LABEL[r.kind]) : (lastKind = r.kind, null);
              const active = i === cursor;
              return (
                <React.Fragment key={r.key}>
                  {head && <div className={`px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest ${muted}`}>{head}</div>}
                  <button
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(r)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${active ? (isDark ? 'bg-slate-800' : 'bg-slate-100') : ''}`}>
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--disease-accent)' }} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[12.5px] font-bold truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{r.label}</span>
                      <span className={`block text-[10.5px] truncate ${muted}`}>{r.sub}</span>
                    </span>
                    {r.kind === 'disease' && (r as any).current
                      ? <span className={`text-[9px] font-black uppercase tracking-wider shrink-0 ${muted}`}>current</span>
                      : active && <CornerDownLeft className={`w-3 h-3 shrink-0 ${muted}`} />}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

export default GlobalSearch;
