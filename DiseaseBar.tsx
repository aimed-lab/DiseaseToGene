import React, { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { fetchSnapshots, type RankingSnapshotMeta } from './supabase';
import { accentFor } from './diseaseAccent';
import type { Theme } from './types';

// The global disease context, on every view, directly under the header.
//
// Which disease is loaded is the single most important piece of state in the app, so it gets
// its own band: the name in large type, then the identifiers that qualify it. It is purely
// informational — switching disease happens in the header search (one place, not two), which
// the "Change" button focuses. With nothing loaded the bar becomes the call to action.

interface Props {
  theme: Theme;
  activeDisease: { id: string; name: string } | null;
  onChangeDisease: () => void;
}

export default function DiseaseBar({ theme, activeDisease, onChangeDisease }: Props) {
  const isDark = theme === 'dark';
  const [snaps, setSnaps] = useState<RankingSnapshotMeta[]>([]);
  useEffect(() => { let alive = true; fetchSnapshots().then(s => { if (alive) setSnaps(s); }).catch(() => {}); return () => { alive = false; }; }, [activeDisease?.id]);

  // The newest snapshot for the loaded disease — the numbers on screen come from it.
  const current = useMemo(() => {
    if (!activeDisease) return null;
    const q = activeDisease.name.toLowerCase();
    const mine = snaps.filter(s => s.disease_id === activeDisease.id || String(s.disease_name).toLowerCase().includes(q) || q.includes(String(s.disease_name).toLowerCase()));
    return mine.sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  }, [snaps, activeDisease]);

  const a = accentFor(activeDisease);
  const text = isDark ? '#f1f5f9' : '#0f172a';
  const muted = isDark ? '#94a3b8' : '#64748b';

  const changeBtn = (
    <button
      onClick={onChangeDisease}
      title={activeDisease ? 'Switch disease — opens the search' : 'Choose a disease to begin'}
      className="text-[10.5px] font-bold rounded-md px-2 py-1 shrink-0 transition-colors"
      style={activeDisease
        ? { color: a.strong, border: `1px solid ${a.hex}55` }
        : { background: a.hex, color: '#fff', border: `1px solid ${a.hex}` }}>
      {activeDisease ? 'Change' : 'Choose a disease…'}
    </button>
  );

  if (!activeDisease) {
    return (
      <div role="status" className="px-4 md:px-6 py-2 flex items-center gap-3 border-b" style={{ background: a.soft, borderColor: a.hex, borderBottomWidth: 2 }}>
        <Activity className="w-4 h-4 shrink-0" style={{ color: a.hex }} />
        <span className="text-[13px] font-bold" style={{ color: text }}>No disease selected</span>
        <span className="text-[12px] hidden sm:inline" style={{ color: muted }}>— pick one; every view is scoped to it.</span>
        <div className="flex-1" />
        {changeBtn}
      </div>
    );
  }

  // Identifiers read as one quiet line after the name, separated by dots, rather than three
  // competing pills — the name is the thing to see, these only qualify it.
  const meta = [
    activeDisease.id,
    current ? `snapshot #${current.id}${(current as any).version != null ? ` · v${(current as any).version}` : ''}` : null,
    current?.gene_count != null ? `${Number(current.gene_count).toLocaleString()} genes` : null,
  ].filter(Boolean) as string[];

  return (
    <div role="banner" aria-label={`Disease context: ${activeDisease.name}`}
      className="px-4 md:px-6 py-1.5 flex items-baseline gap-x-3 gap-y-0.5 border-b min-w-0 flex-wrap"
      style={{ background: a.soft, borderColor: a.hex, borderBottomWidth: 2 }}>
      <span className="text-[9px] font-black uppercase tracking-widest shrink-0 self-center" style={{ color: a.strong }}>Disease</span>
      <span className="text-[15px] md:text-[17px] font-black tracking-tight truncate" style={{ color: text }} title={activeDisease.name}>{activeDisease.name}</span>
      {changeBtn}
      <span className="hidden md:inline text-[11px] truncate" style={{ color: muted }}>{meta.join('  ·  ')}</span>
    </div>
  );
}
