import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fetchSnapshots, type RankingSnapshotMeta } from './supabase';
import { accentFor } from './diseaseAccent';
import type { Theme } from './types';

// The loaded disease, in the header beside the wordmark. It reads as one phrase —
// "Disease2Target · exocrine pancreatic carcinoma" — so the disease is unmissable on every
// view without spending a whole row on it.
//
// This replaced a full-width band under the header. That band carried the MONDO id, the
// snapshot and the gene count, and every view already shows those in its own snapshot
// picker (board, evidence, rankings, funnel, graph), so the band cost a row of vertical
// space on every screen to repeat what was under it. Those identifiers now ride in this
// chip's tooltip, where they cost nothing.
//
// Clicking it opens the header search, which is where switching disease happens — one
// control, not two.

interface Props {
  theme: Theme;
  activeDisease: { id: string; name: string } | null;
  onChangeDisease: () => void;
}

export default function DiseaseChip({ theme, activeDisease, onChangeDisease }: Props) {
  const isDark = theme === 'dark';
  const [snaps, setSnaps] = useState<RankingSnapshotMeta[]>([]);
  useEffect(() => { let alive = true; fetchSnapshots().then(s => { if (alive) setSnaps(s); }).catch(() => {}); return () => { alive = false; }; }, [activeDisease?.id]);

  // The newest snapshot for the loaded disease — what the numbers on screen come from.
  const current = useMemo(() => {
    if (!activeDisease) return null;
    const q = activeDisease.name.toLowerCase();
    const mine = snaps.filter(s => s.disease_id === activeDisease.id || String(s.disease_name).toLowerCase().includes(q) || q.includes(String(s.disease_name).toLowerCase()));
    return mine.sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  }, [snaps, activeDisease]);

  const a = accentFor(activeDisease);

  if (!activeDisease) {
    return (
      <button
        onClick={onChangeDisease}
        title="Choose a disease — every view is scoped to it"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-black text-white shrink-0 transition-opacity hover:opacity-90"
        style={{ background: a.hex }}>
        Choose a disease
        <ChevronDown className="w-3.5 h-3.5 opacity-80" />
      </button>
    );
  }

  const detail = [
    activeDisease.id,
    current ? `snapshot #${current.id}${(current as any).version != null ? ` · v${(current as any).version}` : ''}` : null,
    current?.gene_count != null ? `${Number(current.gene_count).toLocaleString()} genes` : null,
  ].filter(Boolean).join('  ·  ');

  return (
    <button
      onClick={onChangeDisease}
      aria-label={`Disease: ${activeDisease.name}. Click to switch.`}
      title={`${activeDisease.name}\n${detail}\n\nClick to switch disease`}
      className="flex items-center gap-2 rounded-lg pl-2.5 pr-2 py-1.5 min-w-0 transition-colors"
      style={{ background: a.soft, border: `1px solid ${a.hex}40` }}>
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: a.hex }} />
      <span
        className="text-[13px] md:text-[14.5px] font-black tracking-tight truncate max-w-[150px] lg:max-w-[210px] xl:max-w-[300px]"
        style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}>
        {activeDisease.name}
      </span>
      <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" style={{ color: a.strong }} />
    </button>
  );
}
