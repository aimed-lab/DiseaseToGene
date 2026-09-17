// HarvestPanel.tsx — Settings → Harvest (admin only): queue a harvest for the RC cloud VM
// and watch it run. The browser only asks; the VM's queue worker (scripts/harvestQueue.ts)
// does the work and reports back through the same Supabase row (docs/sql/harvest_jobs.sql).
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, RefreshCw, XCircle, CheckCircle2, AlertTriangle, Server, BookOpen } from 'lucide-react';
import { authenticatedFetch } from './supabase';
import { navigate, wikiUrl } from './nav';

type Job = {
  id: string; created_at: string; requested_email: string | null; disease: string; gene_count: number; options: any;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; claimed_by: string | null; started_at: string | null; finished_at: string | null;
  snapshot_id: number | null; commit: string | null; progress: string | null; log_tail: string | null; summary: string | null; audit_status: 'passed' | 'failed' | 'skipped' | null; error: string | null;
};
type Worker = { host: string; last_seen: string; commit: string | null; running_job: string | null; note: string | null; alive: boolean };
type Cohort = { key: string; name: string; mondo: string; tables: { expression: boolean; dependency: boolean; proteomics: boolean } };

const ago = (iso: string | null) => { if (!iso) return '—'; const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`; };
const dur = (a: string | null, b: string | null) => { if (!a) return ''; const s = ((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 1000; return s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };

export function HarvestPanel({ isDark }: { isDark: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [diseases, setDiseases] = useState<Cohort[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disease, setDisease] = useState('');
  const [count, setCount] = useState(6000);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const ink = isDark ? 'text-slate-100' : 'text-slate-900';
  const card = isDark ? 'border-slate-800 bg-[#0d1424]' : 'border-slate-200 bg-white';
  const input = `rounded-lg border px-3 py-2 text-[12px] outline-none ${isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`;

  const load = useCallback(async () => {
    try {
      const r = await authenticatedFetch('/api/admin/harvest');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setJobs(j.jobs || []); setWorkers(j.workers || []); setDiseases(j.diseases || []); setErr(null);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  const queue = async () => {
    const d = disease.trim(); if (!d) return;
    setBusy(true);
    try {
      const r = await authenticatedFetch('/api/admin/harvest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disease: d, gene_count: count }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setDisease(''); await load();
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    const r = await authenticatedFetch(`/api/admin/harvest/${id}/cancel`, { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || `HTTP ${r.status}`); }
    await load();
  };

  const alive = workers.some(w => w.alive);
  const active = jobs.find(j => j.status === 'running');
  const badge = (s: Job['status']) => {
    const m: Record<Job['status'], string> = {
      queued: isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700',
      running: isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-700',
      done: isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700',
      failed: isDark ? 'bg-rose-500/15 text-rose-300' : 'bg-rose-50 text-rose-700',
      cancelled: isDark ? 'bg-slate-800 text-slate-500' : 'bg-slate-100 text-slate-500',
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${m[s]}`}>{s}</span>;
  };

  return (
    <div className={`rounded-2xl border overflow-hidden ${card}`}>
      {/* worker status + form */}
      <div className={`px-5 py-3 border-b flex items-center gap-3 flex-wrap ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <Server className={`w-4 h-4 ${alive ? (isDark ? 'text-emerald-300' : 'text-emerald-600') : muted}`} />
        <span className={`text-[12px] ${ink}`}>
          {workers.length === 0 ? 'No worker has reported yet' : workers.map(w => `${w.host} · ${w.alive ? 'listening' : `last seen ${ago(w.last_seen)}`}${w.commit ? ` · ${w.commit}` : ''}`).join(' · ')}
        </span>
        <button onClick={load} title="Refresh" className={`ml-auto p-1.5 rounded-lg ${isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      <div className={`px-5 py-4 border-b flex items-end gap-3 flex-wrap ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <label className="flex flex-col gap-1">
          <span className={`text-[10px] font-black uppercase tracking-wider ${muted}`}>Disease</span>
          <input list="harvest-diseases" value={disease} onChange={e => setDisease(e.target.value)} placeholder="e.g. glioblastoma" className={`${input} w-72`} />
          <datalist id="harvest-diseases">{diseases.map(d => <option key={d.key} value={d.name} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className={`text-[10px] font-black uppercase tracking-wider ${muted}`}>Candidate genes</span>
          <input type="number" min={100} max={20000} step={500} value={count} onChange={e => setCount(Number(e.target.value))} className={`${input} w-32`} />
        </label>
        <button onClick={queue} disabled={busy || !disease.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-[12px] font-bold disabled:opacity-40 hover:bg-blue-700">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Queue harvest
        </button>
        <p className={`basis-full text-[10.5px] ${muted}`}>
          Runs on the RC cloud VM, 2–4 h. Every axis, the knowledge graph, the lineage record and the audit run without anyone watching.
          {(() => { const c = diseases.find(d => d.name.toLowerCase() === disease.trim().toLowerCase()); if (!disease.trim()) return null; if (!c) return ' This disease has no reference cohort: expression, dependency and proteomics will be skipped; the other nine axes still run.'; const missing = Object.entries(c.tables).filter(([, v]) => !v).map(([k]) => k); return missing.length ? ` Reference tables not built for: ${missing.join(', ')} — those axes will be skipped.` : ' All reference tables are present.'; })()}
          {' '}<b>A finished harvest becomes this disease's newest snapshot, which the app shows by default.</b>
        </p>
      </div>

      {err && <div className={`px-5 py-2 text-[12px] flex items-center gap-2 ${isDark ? 'text-rose-300' : 'text-rose-700'}`}><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}

      {/* jobs */}
      <div className="divide-y divide-slate-200/60 dark:divide-slate-800">
        {loading && <div className={`px-5 py-6 text-[12px] ${muted}`}>Loading…</div>}
        {!loading && jobs.length === 0 && !err && <div className={`px-5 py-6 text-[12px] ${muted}`}>No harvests queued yet.</div>}
        {jobs.map(j => (
          <div key={j.id} className="px-5 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              {badge(j.status)}
              <span className={`text-[13px] font-bold ${ink}`}>{j.disease}</span>
              <span className={`text-[11px] ${muted}`}>{j.gene_count.toLocaleString()} genes · asked {ago(j.created_at)}{j.requested_email ? ` by ${j.requested_email}` : ''}</span>
              {j.status === 'running' && <span className={`text-[11px] ${isDark ? 'text-blue-300' : 'text-blue-700'}`}><Loader2 className="inline w-3 h-3 animate-spin mr-1" />{j.progress || 'running'} · {dur(j.started_at, null)}</span>}
              {(j.status === 'done' || j.status === 'failed') && <span className={`text-[11px] ${muted}`}>{dur(j.started_at, j.finished_at)}{j.commit ? ` · ${j.commit}` : ''}</span>}
              {j.snapshot_id && <a href={wikiUrl.disease(j.disease, j.snapshot_id)} onClick={e => { e.preventDefault(); navigate(wikiUrl.disease(j.disease, j.snapshot_id!)); }} className={`inline-flex items-center gap-1 text-[11px] font-bold ${isDark ? 'text-blue-300' : 'text-blue-700'}`}><BookOpen className="w-3 h-3" />snapshot #{j.snapshot_id}</a>}
              {j.audit_status === 'passed' && <span className={`inline-flex items-center gap-1 text-[11px] ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}><CheckCircle2 className="w-3 h-3" />audit passed</span>}
              {j.audit_status === 'failed' && <span className={`inline-flex items-center gap-1 text-[11px] ${isDark ? 'text-rose-300' : 'text-rose-700'}`}><AlertTriangle className="w-3 h-3" />audit failed — read the summary</span>}
              <span className="ml-auto flex items-center gap-2">
                {(j.log_tail || j.summary) && <button onClick={() => setOpen(open === j.id ? null : j.id)} className={`text-[11px] font-bold ${muted} hover:underline`}>{open === j.id ? 'hide' : j.status === 'running' ? 'log' : 'summary'}</button>}
                {j.status === 'queued' && <button onClick={() => cancel(j.id)} className={`inline-flex items-center gap-1 text-[11px] font-bold ${isDark ? 'text-rose-300' : 'text-rose-700'}`}><XCircle className="w-3 h-3" />cancel</button>}
              </span>
            </div>
            {j.error && <p className={`mt-1 text-[11px] ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>{j.error}</p>}
            {open === j.id && (
              <pre className={`mt-2 max-h-72 overflow-auto rounded-lg p-3 text-[10.5px] leading-snug whitespace-pre-wrap ${isDark ? 'bg-slate-950 text-slate-300' : 'bg-slate-50 text-slate-700'}`}>{j.status === 'running' ? (j.log_tail || '') : (j.summary || j.log_tail || '')}</pre>
            )}
          </div>
        ))}
      </div>
      {!alive && jobs.some(j => j.status === 'queued') && (
        <div className={`px-5 py-2 text-[11px] flex items-center gap-2 ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}><AlertTriangle className="w-3.5 h-3.5" />No worker is listening — the job will start when the VM's queue worker is running (README §4b).</div>
      )}
      {active && <div className={`px-5 py-2 text-[10.5px] ${muted}`}>Only one harvest runs at a time; queued jobs start when this one finishes.</div>}
    </div>
  );
}
