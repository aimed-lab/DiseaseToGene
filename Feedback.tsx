// Feedback.tsx — in-app feedback. Replaced the header's "Feedback → GitHub issues" link, so
// users never need the repo. Two pieces:
//   <FeedbackDialog>  the user's form (category, message) with the context the app attaches
//                     shown to them verbatim, plus their own past submissions and status.
//   <FeedbackInbox>   the admin's list in the Settings console: filter by status, mark
//                     seen/done, keep a private note.
// Storage is Supabase (docs/sql/feedback.sql) via the server: POST /api/feedback,
// GET /api/feedback/mine, GET/PATCH /api/admin/feedback. See server.ts.
import React, { useEffect, useState } from 'react';
import { MessageSquare, X, Loader2, CheckCircle2, Bug, Database, Lightbulb, HelpCircle, ChevronDown } from 'lucide-react';
import { authenticatedFetch } from './supabase';

export type FeedbackCategory = 'bug' | 'data' | 'feature' | 'other';
export interface FeedbackContext { url?: string; view?: string; disease?: string | null; snapshot_id?: number | null; model?: string | null; user_agent?: string }
export interface FeedbackRow { id: string; created_at: string; category: FeedbackCategory; message: string; status: 'new' | 'seen' | 'done'; context: FeedbackContext; email?: string | null; admin_note?: string | null; reviewed_at?: string | null }

const CATEGORIES: Array<{ id: FeedbackCategory; label: string; hint: string; icon: React.ComponentType<any> }> = [
  { id: 'bug', label: 'Something is broken', hint: 'an error, a blank panel, a button that does nothing', icon: Bug },
  { id: 'data', label: 'A number looks wrong', hint: 'a score, a count, a source that does not match', icon: Database },
  { id: 'feature', label: 'I wish it could…', hint: 'a view, a filter, an export you need', icon: Lightbulb },
  { id: 'other', label: 'Something else', hint: 'anything at all', icon: HelpCircle },
];
const catOf = (id: string) => CATEGORIES.find(c => c.id === id) ?? CATEGORIES[3];
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const STATUS_TONE: Record<string, string> = { new: 'bg-blue-500/15 text-blue-500', seen: 'bg-amber-500/15 text-amber-500', done: 'bg-emerald-500/15 text-emerald-500' };

async function getJson<T>(url: string): Promise<T> { const r = await authenticatedFetch(url); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j; }
async function sendJson<T>(url: string, method: string, body: any): Promise<T> { const r = await authenticatedFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j; }

// ── the user's form ──────────────────────────────────────────────────────────
export function FeedbackDialog({ isDark, context, onClose }: { isDark: boolean; context: FeedbackContext; onClose: () => void }) {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<FeedbackRow[] | null>(null);
  const [showMine, setShowMine] = useState(false);
  const ctx: FeedbackContext = { ...context, url: typeof window !== 'undefined' ? window.location.pathname + window.location.search : context.url, user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : undefined };

  useEffect(() => { getJson<FeedbackRow[]>('/api/feedback/mine').then(setMine).catch(() => setMine([])); }, [sent]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!message.trim() || sending) return;
    setSending(true); setError(null);
    try { await sendJson('/api/feedback', 'POST', { category, message: message.trim(), context: ctx }); setSent(true); setMessage(''); }
    catch (err: any) { setError(err?.message || 'Could not send'); }
    finally { setSending(false); }
  };

  const panel = isDark ? 'bg-[#0d1424] border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const field = isDark ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400';
  return (
    <div onClick={onClose} className="fixed inset-0 z-[99999] bg-slate-950/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div onClick={e => e.stopPropagation()} className={`w-full max-w-lg rounded-2xl border shadow-2xl ${panel}`}>
        <div className={`flex items-center justify-between px-5 py-3 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
          <div className="flex items-center gap-2 text-[13px] font-bold"><MessageSquare className="w-4 h-4" /> Feedback</div>
          <button onClick={onClose} aria-label="Close" className={`p-1 rounded ${muted} hover:opacity-80`}><X className="w-4 h-4" /></button>
        </div>
        {sent ? (
          <div className="px-5 py-8 text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
            <p className="text-[13px] font-semibold">Thanks — sent.</p>
            <p className={`text-[12px] ${muted}`}>An admin will see it in the console. You can check its status below.</p>
            <div className="flex justify-center gap-2 pt-1">
              <button onClick={() => setSent(false)} className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold ${isDark ? 'border-slate-700' : 'border-slate-300'}`}>Send another</button>
              <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-semibold">Close</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map(c => (
                <button type="button" key={c.id} onClick={() => setCategory(c.id)}
                  className={`text-left rounded-xl border px-3 py-2 transition-colors ${category === c.id ? 'border-blue-500 bg-blue-500/10' : (isDark ? 'border-slate-800 hover:bg-slate-800/60' : 'border-slate-200 hover:bg-slate-50')}`}>
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold"><c.icon className="w-3.5 h-3.5" />{c.label}</div>
                  <div className={`text-[10.5px] mt-0.5 ${muted}`}>{c.hint}</div>
                </button>))}
            </div>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} maxLength={4000} autoFocus
              placeholder={category === 'data' ? 'Which gene, which number, and what you expected instead…' : category === 'bug' ? 'What you did, what happened, what you expected…' : 'Tell us…'}
              className={`w-full rounded-xl border px-3 py-2 text-[13px] outline-none focus:border-blue-500 ${field}`} />
            <details className={`text-[11px] ${muted}`}>
              <summary className="cursor-pointer select-none">Attached automatically: where you are in the app</summary>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 mt-2 font-mono text-[10.5px]">
                {Object.entries(ctx).filter(([, v]) => v != null && v !== '').map(([k, v]) => <React.Fragment key={k}><dt className="opacity-70">{k}</dt><dd className="break-all">{String(v)}</dd></React.Fragment>)}
              </dl>
            </details>
            {error && <p className="text-[12px] text-red-500">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setShowMine(s => !s)} className={`text-[11px] ${muted} underline decoration-dotted`}>{showMine ? 'Hide' : 'Show'} my previous feedback{mine ? ` (${mine.length})` : ''}</button>
              <button type="submit" disabled={!message.trim() || sending} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-[12px] font-bold disabled:opacity-50">
                {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</> : 'Send'}
              </button>
            </div>
            {showMine && (
              <div className={`rounded-xl border divide-y max-h-56 overflow-y-auto ${isDark ? 'border-slate-800 divide-slate-800' : 'border-slate-200 divide-slate-100'}`}>
                {mine === null ? <p className={`p-3 text-[11px] ${muted}`}>Loading…</p> : mine.length === 0 ? <p className={`p-3 text-[11px] ${muted}`}>Nothing yet.</p> : mine.map(r => (
                  <div key={r.id} className="p-3 text-[12px]">
                    <div className="flex items-center gap-2 mb-1"><span className={`px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase tracking-wider ${STATUS_TONE[r.status]}`}>{r.status}</span><span className={`text-[10.5px] ${muted}`}>{catOf(r.category).label} · {fmt(r.created_at)}</span></div>
                    <p className="whitespace-pre-wrap">{r.message}</p>
                  </div>))}
              </div>)}
          </form>
        )}
      </div>
    </div>
  );
}

// ── the admin's inbox ────────────────────────────────────────────────────────
export function FeedbackInbox({ isDark, onUnreadChange }: { isDark: boolean; onUnreadChange?: (n: number) => void }) {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'new' | 'seen' | 'done'>('new');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

  const load = () => getJson<FeedbackRow[]>('/api/admin/feedback').then(r => { setRows(r); setError(null); onUnreadChange?.(r.filter(x => x.status === 'new').length); }).catch(e => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const update = async (id: string, patch: Partial<Pick<FeedbackRow, 'status' | 'admin_note'>>) => {
    setBusy(id);
    try { const r = await sendJson<FeedbackRow>(`/api/admin/feedback/${id}`, 'PATCH', patch); setRows(rs => { const next = (rs || []).map(x => x.id === id ? r : x); onUnreadChange?.(next.filter(x => x.status === 'new').length); return next; }); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };
  const list = (rows || []).filter(r => filter === 'all' || r.status === filter);
  const counts = { all: rows?.length ?? 0, new: rows?.filter(r => r.status === 'new').length ?? 0, seen: rows?.filter(r => r.status === 'seen').length ?? 0, done: rows?.filter(r => r.status === 'done').length ?? 0 };

  return (
    <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800 bg-[#0d1424]' : 'border-slate-200 bg-white'}`}>
      <div className={`px-5 py-3 flex items-center gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        {(['new', 'seen', 'done', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase tracking-wider border ${filter === f ? 'bg-blue-600 border-blue-600 text-white' : (isDark ? 'border-slate-700 text-slate-300' : 'border-slate-300 text-slate-600')}`}>{f} <span className="opacity-70">{counts[f]}</span></button>))}
        <span className="flex-1" />
        <button onClick={load} className={`text-[11px] ${muted} underline decoration-dotted`}>refresh</button>
      </div>
      {error && <p className="px-5 py-3 text-[12px] text-red-500">{error}{error.includes('feedback') || error.includes('relation') ? ' — has docs/sql/feedback.sql been run in Supabase?' : ''}</p>}
      {rows === null ? <p className={`px-5 py-6 text-[12px] ${muted}`}>Loading…</p> : list.length === 0 ? <p className={`px-5 py-6 text-[12px] ${muted}`}>Nothing {filter === 'all' ? 'yet' : filter}.</p> : (
        <div className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}`}>
          {list.map(r => { const c = catOf(r.category); const isOpen = open === r.id; return (
            <div key={r.id} className="px-5 py-3">
              <button onClick={() => setOpen(isOpen ? null : r.id)} className="w-full text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase tracking-wider ${STATUS_TONE[r.status]}`}>{r.status}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold"><c.icon className="w-3 h-3" />{c.label}</span>
                  <span className={`text-[10.5px] ${muted}`}>{r.email || 'unknown user'} · {fmt(r.created_at)}{r.context?.disease ? ` · ${r.context.disease}` : ''}{r.context?.snapshot_id ? ` #${r.context.snapshot_id}` : ''}</span>
                  <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''} ${muted}`} />
                </div>
                <p className={`text-[12.5px] mt-1 ${isOpen ? 'whitespace-pre-wrap' : 'truncate'}`}>{r.message}</p>
              </button>
              {isOpen && (
                <div className="mt-3 space-y-3">
                  <dl className={`grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono text-[10.5px] ${muted}`}>
                    {Object.entries(r.context || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => <React.Fragment key={k}><dt className="opacity-70">{k}</dt><dd className="break-all">{String(v)}</dd></React.Fragment>)}
                  </dl>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(['new', 'seen', 'done'] as const).filter(s => s !== r.status).map(s => (
                      <button key={s} disabled={busy === r.id} onClick={() => update(r.id, { status: s })} className={`px-2.5 py-1 rounded-lg border text-[10.5px] font-black uppercase tracking-wider ${isDark ? 'border-slate-700' : 'border-slate-300'} disabled:opacity-50`}>mark {s}</button>))}
                    {r.reviewed_at && <span className={`text-[10.5px] ${muted}`}>reviewed {fmt(r.reviewed_at)}</span>}
                  </div>
                  <div className="flex items-start gap-2">
                    <textarea value={note[r.id] ?? r.admin_note ?? ''} onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))} rows={2} placeholder="Private admin note"
                      className={`flex-1 rounded-lg border px-2.5 py-1.5 text-[12px] outline-none ${isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300'}`} />
                    <button disabled={busy === r.id || (note[r.id] ?? r.admin_note ?? '') === (r.admin_note ?? '')} onClick={() => update(r.id, { admin_note: note[r.id] ?? '' })} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold disabled:opacity-40">Save note</button>
                  </div>
                </div>)}
            </div>); })}
        </div>)}
    </div>
  );
}
