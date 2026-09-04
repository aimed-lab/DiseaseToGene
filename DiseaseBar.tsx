import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, Loader2 } from 'lucide-react';
import { fetchSnapshots, type RankingSnapshotMeta } from './supabase';
import { accentFor } from './diseaseAccent';
import type { Theme } from './types';

// The global disease context, on every view, directly under the header.
//
// Which disease is loaded is the single most important piece of state in the app, and it
// was legible only from an 11-px pill. This bar makes it unmissable: the disease name in
// large type, the snapshot it comes from, and the disease's accent colour as the bar's tint
// — so ranking, evidence, graph and funnel below are all read as belonging to it. One
// control switches disease from anywhere (it loads that disease's latest snapshot through
// the same path the history drawer uses, so there is one way to change disease, not two).
// With nothing loaded it turns into the call to action.

interface Props {
  theme: Theme;
  activeDisease: { id: string; name: string } | null;
  onSwitch: (snapshotId: string) => void | Promise<void>;
  busy?: boolean;
}

export default function DiseaseBar({ theme, activeDisease, onSwitch, busy }: Props) {
  const isDark = theme === 'dark';
  const [snaps, setSnaps] = useState<RankingSnapshotMeta[]>([]);
  useEffect(() => { let alive = true; fetchSnapshots().then(s => { if (alive) setSnaps(s); }).catch(() => {}); return () => { alive = false; }; }, [activeDisease?.id]);

  // One entry per disease: its latest snapshot.
  const diseases = useMemo(() => {
    const by = new Map<string, RankingSnapshotMeta>();
    for (const s of snaps) { const k = s.disease_id || s.disease_name; const p = by.get(k); if (!p || Number(s.id) > Number(p.id)) by.set(k, s); }
    return [...by.values()].sort((a, b) => String(a.disease_name).localeCompare(String(b.disease_name)));
  }, [snaps]);
  const current = useMemo(() => {
    if (!activeDisease) return null;
    const q = activeDisease.name.toLowerCase();
    return diseases.find(d => d.disease_id === activeDisease.id) || diseases.find(d => String(d.disease_name).toLowerCase().includes(q) || q.includes(String(d.disease_name).toLowerCase())) || null;
  }, [diseases, activeDisease]);

  const a = accentFor(activeDisease);
  const text = isDark ? '#f1f5f9' : '#0f172a';
  const muted = isDark ? '#94a3b8' : '#64748b';
  const chip: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 6, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)', color: muted, whiteSpace: 'nowrap' };

  const select = (
    <div className="relative inline-flex items-center">
      <select
        value=""
        disabled={busy}
        onChange={e => { const id = e.target.value; if (id) onSwitch(id); }}
        title={activeDisease ? 'Switch to another disease (loads its latest snapshot)' : 'Choose a disease to begin'}
        className="appearance-none text-[11px] font-black uppercase tracking-wider rounded-md pl-3 pr-7 py-1.5 outline-none cursor-pointer text-white disabled:opacity-60"
        style={{ background: a.hex }}>
        <option value="" disabled>{activeDisease ? 'Switch disease' : 'Choose a disease…'}</option>
        {diseases.map(d => (
          <option key={d.id} value={String(d.id)} disabled={!!activeDisease && d.disease_id === activeDisease.id}>
            {d.disease_name} · {d.gene_count != null ? `${Number(d.gene_count).toLocaleString()} genes` : `#${d.id}`}
          </option>
        ))}
      </select>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white absolute right-2 pointer-events-none" /> : <ChevronDown className="w-3.5 h-3.5 text-white absolute right-2 pointer-events-none" />}
    </div>
  );

  if (!activeDisease) {
    return (
      <div role="status" className="px-4 md:px-6 py-2 flex items-center gap-3 border-b" style={{ background: a.soft, borderColor: a.hex, borderBottomWidth: 2 }}>
        <Activity className="w-4 h-4 shrink-0" style={{ color: a.hex }} />
        <span className="text-[13px] font-bold" style={{ color: text }}>No disease selected</span>
        <span className="text-[12px] hidden sm:inline" style={{ color: muted }}>— every ranking, evidence panel and graph is scoped to one disease. Pick one to begin.</span>
        <div className="flex-1" />
        {select}
      </div>
    );
  }

  return (
    <div role="banner" aria-label={`Disease context: ${activeDisease.name}`}
      className="px-4 md:px-6 py-1.5 flex items-center gap-3 border-b min-w-0"
      style={{ background: a.soft, borderColor: a.hex, borderBottomWidth: 2 }}>
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.hex, boxShadow: `0 0 0 3px ${a.soft}` }} />
      <span className="text-[9px] font-black uppercase tracking-widest shrink-0" style={{ color: a.strong }}>Disease</span>
      <span className="text-[15px] md:text-[17px] font-black tracking-tight truncate" style={{ color: text }} title={activeDisease.name}>{activeDisease.name}</span>
      <div className="hidden md:flex items-center gap-1.5 min-w-0">
        <span style={chip} title="Ontology id">{activeDisease.id}</span>
        {current && <span style={chip} title="Latest stored snapshot for this disease">snapshot #{current.id}{current.version != null ? ` · v${current.version}` : ''}</span>}
        {current?.gene_count != null && <span style={chip}>{Number(current.gene_count).toLocaleString()} genes</span>}
      </div>
      <span className="hidden lg:inline text-[11px] truncate" style={{ color: muted }}>Everything on this page — ranking, evidence, targets, graph — is for this disease.</span>
      <div className="flex-1" />
      {select}
    </div>
  );
}
