import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Activity, ArrowRight, FlaskConical } from 'lucide-react';
import { fetchSnapshots, type RankingSnapshotMeta } from './supabase';
import type { Theme } from './types';

// Shown in the content area whenever no disease is loaded, in place of every view.
//
// Before this, the Ranking Board fell back to the newest snapshot when no disease was
// selected, so the app opened showing a full glioblastoma ranking while the header still
// read "Choose a disease". A ranking you can read without knowing which disease it belongs
// to is worse than an empty screen, and Evidence, Funnel and Score Matrix each defaulted
// independently, so they could disagree with one another.
//
// Picking here goes through the same handler the header search uses, so there is still one
// way to choose a disease.

interface Props {
  theme: Theme;
  onPick: (snapshotId: string) => void | Promise<void>;
  busy?: boolean;
}

export default function WelcomeView({ theme, onPick, busy }: Props) {
  const isDark = theme === 'dark';
  const [snaps, setSnaps] = useState<RankingSnapshotMeta[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchSnapshots().then(s => { if (alive) setSnaps(s); }).catch(() => { if (alive) { setSnaps([]); setFailed(true); } });
    return () => { alive = false; };
  }, []);

  // One card per disease: its newest snapshot, which is what loading it will open.
  const diseases = useMemo(() => {
    const by = new Map<string, RankingSnapshotMeta>();
    for (const s of snaps || []) {
      const k = s.disease_id || s.disease_name;
      const prev = by.get(k);
      if (!prev || Number(s.id) > Number(prev.id)) by.set(k, s);
    }
    return [...by.values()].sort((a, b) => String(a.disease_name).localeCompare(String(b.disease_name)));
  }, [snaps]);

  const text = isDark ? 'text-slate-100' : 'text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const card = isDark ? 'bg-[#0d1424] border-slate-800 hover:border-slate-600' : 'bg-white border-slate-200 hover:border-slate-400';

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl text-white flex items-center justify-center shadow-lg shrink-0" style={{ background: 'var(--disease-accent)' }}>
            <FlaskConical className="w-5 h-5" />
          </div>
          <h1 className={`text-2xl font-black tracking-tight ${text}`}>Choose a disease to begin</h1>
        </div>
        <p className={`text-[13px] leading-relaxed mb-8 ${muted}`}>
          Every ranking, evidence panel, target and graph in this app is scoped to one disease.
          Pick one below and the whole workspace loads for it. You can switch at any time from the
          header, or by pressing <kbd className={`px-1.5 py-0.5 rounded border text-[11px] font-bold ${isDark ? 'border-slate-700' : 'border-slate-300'}`}>/</kbd> to search.
        </p>

        {snaps === null ? (
          <div className={`flex items-center gap-2 ${muted}`}><Loader2 className="w-4 h-4 animate-spin" /><span className="text-[13px]">Loading the diseases in the store…</span></div>
        ) : diseases.length === 0 ? (
          <div className={`rounded-xl border p-6 ${card}`}>
            <p className={`text-[13px] font-bold mb-1 ${text}`}>{failed ? 'The store could not be reached' : 'No diseases are loaded yet'}</p>
            <p className={`text-[12px] leading-relaxed ${muted}`}>
              {failed
                ? 'The snapshot list did not load. If the app reads Oracle directly, check the VPN, then reload.'
                : 'Harvest one first with the CLI: npx tsx --env-file=.env scripts/d2t.ts harvest "glioblastoma" 6000'}
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {diseases.map(d => (
              <button
                key={d.id}
                disabled={busy}
                onClick={() => onPick(String(d.id))}
                className={`group text-left rounded-xl border p-4 transition-colors disabled:opacity-60 ${card}`}>
                <div className="flex items-start gap-2.5">
                  <Activity className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--disease-accent)' }} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[14.5px] font-black tracking-tight truncate ${text}`} title={String(d.disease_name)}>{d.disease_name}</div>
                    <div className={`text-[11px] mt-1 ${muted}`}>
                      {d.gene_count != null ? `${Number(d.gene_count).toLocaleString()} genes` : `snapshot #${d.id}`}
                      {' · '}snapshot #{d.id}{(d as any).version != null ? ` · v${(d as any).version}` : ''}
                    </div>
                    <div className={`text-[11px] ${muted}`}>{d.disease_id}{d.created_at ? ` · ${String(d.created_at).slice(0, 10)}` : ''}</div>
                  </div>
                  {busy
                    ? <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--disease-accent)' }} />
                    : <ArrowRight className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--disease-accent)' }} />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
