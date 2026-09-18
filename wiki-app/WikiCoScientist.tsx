// wiki-app/WikiCoScientist.tsx — the co-scientist, on the wiki.
//
// The same teammate as in the app (same /api/ai/gemini-chat route, same stored-data tools,
// same model picker), reading the wiki page with the user: it is told which disease,
// snapshot and entity is on screen, answers from stored rows, and cites the wiki page of
// every fact. Two things are wiki-specific:
//   • "Draft a page" — it writes a NARRATIVE page for the entity on screen in the schema of
//     wiki/genes/ (front-matter + five sections), labelled generated_by: agent, every number
//     cited to a stored row. This is the narrator, on demand, one page at a time.
//   • Every answer can be downloaded as a .md file, so a draft becomes a file the user can
//     edit, send to PLEASER, or open a pull request with — the wiki itself stays read-only.
// The conversation survives navigation AND a reload: it is kept in sessionStorage (this tab,
// this sign-in), and a wiki link inside an answer routes through the client — it was a full
// page load before, which threw the chat away every time the user followed a citation.
// The panel can be dragged wider or narrower at its left edge and minimised to a pill.
import React, { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageSquare, X, Send, Download, Copy, Loader2, RotateCcw, FileText, Minus } from 'lucide-react';
import { authenticatedFetch } from '../supabase';
import { navigate, wikiSlug, type WikiRoute } from '../nav';
import type { WikiSummary } from './wikiApi';

type Msg = { role: 'user' | 'assistant'; content: string; at: number; draft?: boolean };
type ModelChoice = { id: string; label: string; available?: boolean };

const STORE_KEY = 'd2t.wiki.coscientist';
const MIN_W = 320, MAX_W = 760, DEFAULT_W = 400;
type Saved = { messages: Msg[]; model: string | null; open: boolean; width: number };
function load(): Saved {
  try { const j = JSON.parse(sessionStorage.getItem(STORE_KEY) || ''); if (j && Array.isArray(j.messages)) return { messages: j.messages.slice(-60), model: j.model ?? null, open: !!j.open, width: Math.min(MAX_W, Math.max(MIN_W, Number(j.width) || DEFAULT_W)) }; } catch { /* first visit, private window, or cleared storage */ }
  return { messages: [], model: null, open: false, width: DEFAULT_W };
}
function save(v: Saved) { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* storage may be unavailable; the panel still works for this page */ } }
const session: Saved = load();

const SYSTEM = `You are the Disease2Target co-scientist: a teammate reading the provenance wiki with the user.
The wiki is a read-only view of ONE snapshot's stored evidence: scores, evidence rows with provenance, and a knowledge graph. Nothing on it is fetched live.
Rules:
- Answer from stored rows via your tools (target dossier, evidence, clinical trials, network neighbours, query_graph, find_in_store). Never invent a number, a trial id, a drug or a paper.
- Cite the wiki page (wiki_url) once, as a link, for every stored fact you use. Say "not in this snapshot" when it is not.
- Facts (measured, curated) and predictions (board rank, tractability, network centrality) are labelled separately; keep them apart.
- Be concise. Tables when comparing; prose when explaining.`;

const DRAFT_SCHEMA = (kind: string, id: string, disease: string, snapshot: number) => `Write the NARRATIVE wiki page for ${kind} ${id} in ${disease}, snapshot ${snapshot}. Use your tools to read the stored rows first; do not write from memory.
Output Markdown ONLY (no preamble), exactly in this schema:

---
title: ${id} in ${disease}
${kind}: ${id}
snapshot: ${snapshot}
generated_by: agent
audit_status: not_audited
sources: [list every wiki_url and source_url you cite]
---
## Why ${kind === 'gene' ? 'this gene is on the board' : 'this matters here'}
(rank, score, which axes carry it — each number cited)
## Evidence by axis
(one line per axis: what the row says, its source, its wiki link)
## Druggability and trials
(drugs, phase, NCT ids — only what the rows hold; say if a drug is listed via DGIdb and unscored)
## Interacting partners worth a look
(from the network neighbours: better-ranked partners, with their board rank and wiki links)
## What the data does not show
(the honest gaps — missing axes, null results, low-confidence rows)

Every number must come from a stored row and cite its wiki page. Narrative explains; it never restates numbers as new facts. If a section has nothing in the store, write "Nothing stored for this in snapshot ${snapshot}."`;

function pageOf(route: WikiRoute, disease: string, summary: WikiSummary | null) {
  if (route.page === 'entity') return { disease, snapshot: route.snapshot, kind: route.kind as string, id: route.id, label: `${route.kind} ${route.kind === 'trial' ? route.id.toUpperCase() : route.id}` };
  if (route.page === 'disease') return { disease, snapshot: route.snapshot, kind: 'disease', id: disease, label: `${disease}${route.section ? ` · ${route.section}` : ''}`, section: route.section };
  if (route.page === 'doc') return { disease: '', snapshot: null, kind: 'doc', id: route.slug, label: `doc ${route.slug}` };
  return { disease: '', snapshot: null, kind: 'index', id: '', label: 'wiki index' };
}

export function WikiCoScientist({ route, disease, snapshot, summary, isDark }: { route: WikiRoute; disease: string; snapshot: number | null; summary: WikiSummary | null; isDark: boolean }) {
  const [open, setOpen] = useState(session.open);
  const [messages, setMessages] = useState<Msg[]>(session.messages);
  const [width, setWidth] = useState(session.width);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [model, setModel] = useState<string | null>(session.model);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const page = pageOf(route, disease, summary);

  useEffect(() => { Object.assign(session, { open, messages, model, width }); save(session); }, [open, messages, model, width]);

  // drag the left edge: width = distance from the pointer to the right edge of the window
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault(); dragging.current = true;
    const move = (ev: PointerEvent) => { if (!dragging.current) return; setWidth(Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - ev.clientX))); };
    const up = () => { dragging.current = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // a citation inside an answer is a normal <a href="/wiki/…">; route it through the client so
  // the page changes and the conversation stays (modifier clicks still open a new tab)
  const onAnswerClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a'); if (!a) return;
    const href = a.getAttribute('href') || '';
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (href.startsWith('/')) { e.preventDefault(); navigate(href); return; }
    try { const u = new URL(href, window.location.href); if (u.origin === window.location.origin) { e.preventDefault(); navigate(u.pathname + u.search + u.hash); return; } } catch { /* not a URL; let the browser decide */ }
    a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
  };
  useEffect(() => {
    if (model) return;
    authenticatedFetch('/api/ai/models').then(r => r.json()).then(j => {
      const list: ModelChoice[] = (j?.models || []).filter((m: any) => m.available !== false);
      setModels(list); setModel(j?.default || list[0]?.id || 'openai');
    }).catch(() => setModel('openai'));
  }, [model]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, busy, open]);

  const send = async (text: string, draft = false) => {
    const content = text.trim(); if (!content || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: draft ? `Draft the narrative page for ${page.label}.` : content, at: Date.now() }];
    setMessages(next); setInput(''); setBusy(true); setError(null);
    try {
      const body = {
        model: model || 'openai',
        systemInstruction: SYSTEM,
        // the last few turns are enough context; the tools re-read the store every time
        messages: [...next.slice(-12, -1).map(m => ({ role: m.role, content: m.content })), { role: 'user', content }],
        disease: page.disease || undefined,
        snapshotId: page.snapshot || undefined,
        screen: {
          view: 'wiki',
          disease: page.disease ? { id: summary?.snapshot.disease_id, name: page.disease } : null,
          snapshot: page.snapshot ? { id: page.snapshot, disease_name: page.disease, gene_count: summary?.snapshot.gene_count ?? null } : null,
          listFocus: page.kind === 'gene' ? page.id : null,
        },
      };
      const r = await authenticatedFetch('/api/ai/gemini-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const answer = String(j?.text || '').trim() || '(no answer)';
      setMessages(m => [...m, { role: 'assistant', content: answer, at: Date.now(), draft }]);
    } catch (e: any) { setError(e?.message || 'The co-scientist did not answer'); }
    finally { setBusy(false); }
  };

  const draftPage = () => {
    if (!page.snapshot || page.kind === 'index' || page.kind === 'doc') return;
    send(DRAFT_SCHEMA(page.kind, page.id, page.disease, page.snapshot), true);
  };

  const download = (m: Msg) => {
    const base = page.snapshot ? `${wikiSlug(page.disease)}-${page.kind === 'disease' ? 'overview' : `${page.kind}-${page.id}`}-${page.snapshot}` : 'co-scientist';
    const name = `${base}${m.draft ? '' : `-${new Date(m.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`}.md`;
    const blob = new Blob([m.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = (m: Msg) => { navigator.clipboard?.writeText(m.content).catch(() => {}); };

  const suggestions: Array<{ label: string; text: string }> = page.kind === 'gene'
    ? [{ label: `Why is ${page.id} ranked where it is?`, text: `Why is ${page.id} ranked where it is in this snapshot? Which axes carry it and which hold it back?` },
       { label: 'Better-ranked partners', text: `Which interacting partners of ${page.id} rank higher on the board in this snapshot, and why?` },
       { label: 'Trials and drugs', text: `What drugs and clinical trials does the store hold for ${page.id} in ${page.disease}? Note any that are listed via DGIdb and unscored.` }]
    : page.kind === 'disease'
    ? [{ label: 'Summarise this harvest', text: `Summarise what snapshot ${page.snapshot} of ${page.disease} holds: axes present, top of the board, what is missing.` },
       { label: 'Top targets and why', text: `What are the top 10 targets on the board for ${page.disease} in this snapshot, and what carries each one?` }]
    : page.kind === 'drug' || page.kind === 'trial' || page.kind === 'pathway'
    ? [{ label: `Explain this ${page.kind}`, text: `What does the store hold about ${page.kind} ${page.id} in ${page.disease}, and which genes does it connect to?` }]
    : [{ label: 'What is this wiki?', text: 'What is the provenance wiki, what is a snapshot, and how do I read the badges on a row?' }];

  const panel = isDark ? 'bg-[#1b1b1b] border-white/10 text-[#dcddde]' : 'bg-white border-black/10 text-[#2e3338]';
  const muted = isDark ? 'text-neutral-400' : 'text-neutral-500';
  const chip = isDark ? 'border-white/15 hover:bg-white/10' : 'border-black/15 hover:bg-black/5';
  const bubbleUser = isDark ? 'bg-[#5b4fcf]/30' : 'bg-[#5b4fcf]/10';
  const bubbleBot = isDark ? 'bg-white/[0.04] border border-white/10' : 'bg-black/[0.03] border border-black/10';
  const prose = isDark ? 'prose prose-invert prose-sm max-w-none prose-a:text-[#a596ff]' : 'prose prose-sm max-w-none prose-a:text-[#5b4fcf]';
  const canDraft = !!page.snapshot && page.kind !== 'index' && page.kind !== 'doc';

  if (!open) return (
    <button onClick={() => setOpen(true)} title={messages.length ? 'Reopen the conversation' : 'Ask the co-scientist about this page'}
      className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-[#5b4fcf] text-white pl-3 pr-4 py-2 text-xs font-semibold shadow-xl hover:scale-105 transition-transform">
      <MessageSquare className="w-4 h-4" /> Co-scientist{messages.length ? <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{messages.length}</span> : null}
    </button>
  );

  return (
    <div className={`fixed inset-y-0 right-0 z-40 w-full flex flex-col border-l shadow-2xl ${panel}`} style={{ maxWidth: '100vw', width: `min(100vw, ${width}px)` }}>
      <div onPointerDown={startDrag} title="Drag to resize" className="hidden sm:block absolute inset-y-0 -left-1 w-2 cursor-col-resize" />
      <div className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-[#5b4fcf] dark:text-[#a596ff]">Co-scientist</div>
          <div className={`text-[11px] truncate ${muted}`} title={page.label}>reading: {page.label}{page.snapshot ? ` · snapshot ${page.snapshot}` : ''}</div>
        </div>
        <div className="flex items-center gap-1">
          {models.length > 1 && (
            <select value={model || ''} onChange={e => setModel(e.target.value)} title="Model" className={`text-[10px] rounded border px-1 py-0.5 max-w-[120px] ${isDark ? 'bg-black/30 border-white/10' : 'bg-white border-black/10'}`}>
              {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>)}
          {messages.length > 0 && <button onClick={() => { if (window.confirm('Start a new conversation? The current one will be cleared.')) setMessages([]); }} title="New conversation" className={`p-1 rounded ${muted} hover:opacity-80`}><RotateCcw className="w-3.5 h-3.5" /></button>}
          <button onClick={() => setOpen(false)} title="Minimise — the conversation is kept" className={`p-1 rounded ${muted} hover:opacity-80`}><Minus className="w-4 h-4" /></button>
          <button onClick={() => { if (!messages.length || window.confirm('Close and clear this conversation?')) { setMessages([]); setOpen(false); } }} title="Close and clear" className={`p-1 rounded ${muted} hover:opacity-80`}><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div ref={scrollRef} onClick={onAnswerClick} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className={`text-xs ${muted} space-y-2`}>
            <p>I read the same stored rows this page shows and cite them. Ask about what is on screen, or have me draft a narrative page from it.</p>
          </div>)}
        {messages.map((m, i) => (
          <div key={i} className={`rounded-xl px-3 py-2 text-[13px] ${m.role === 'user' ? `${bubbleUser} ml-8` : `${bubbleBot} mr-2`}`}>
            {m.role === 'user' ? <div className="whitespace-pre-wrap">{m.content}</div> : (
              <>
                {m.draft && <div className={`mb-1 text-[10px] uppercase tracking-wider font-bold ${muted}`}><FileText className="inline w-3 h-3 mr-1" />draft page · generated by agent · not audited</div>}
                <div className={prose}><Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown></div>
                <div className={`flex items-center gap-2 mt-2 text-[10.5px] ${muted}`}>
                  <button onClick={() => download(m)} className="inline-flex items-center gap-1 hover:underline" title="Save this answer as a Markdown file"><Download className="w-3 h-3" /> Download .md</button>
                  <button onClick={() => copy(m)} className="inline-flex items-center gap-1 hover:underline"><Copy className="w-3 h-3" /> Copy</button>
                </div>
              </>)}
          </div>))}
        {busy && <div className={`flex items-center gap-2 text-xs ${muted}`}><Loader2 className="w-3.5 h-3.5 animate-spin" /> reading the store…</div>}
        {error && <div className="text-xs text-red-500">{error}</div>}
      </div>

      <div className={`border-t px-3 py-2 space-y-2 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map(s => <button key={s.label} disabled={busy} onClick={() => send(s.text)} className={`rounded-full border px-2.5 py-1 text-[11px] ${chip} disabled:opacity-50`}>{s.label}</button>)}
          {canDraft && <button disabled={busy} onClick={draftPage} title="Write a narrative page for what is on screen, in the wiki's page schema, from stored rows" className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold border-[#5b4fcf] text-[#5b4fcf] dark:text-[#a596ff] dark:border-[#a596ff] hover:bg-[#5b4fcf]/10 disabled:opacity-50`}><FileText className="inline w-3 h-3 mr-1" />Draft a page</button>}
        </div>
        <form onSubmit={e => { e.preventDefault(); send(input); }} className={`flex items-end gap-2 rounded-xl border px-2 py-1.5 ${isDark ? 'bg-black/30 border-white/10' : 'bg-white border-black/10'}`}>
          <textarea value={input} onChange={e => setInput(e.target.value)} rows={2} placeholder={page.snapshot ? `Ask about ${page.label}…` : 'Ask about the wiki…'}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            className="flex-1 bg-transparent text-[13px] outline-none resize-none" />
          <button type="submit" disabled={!input.trim() || busy} className="p-1.5 rounded-lg bg-[#5b4fcf] text-white disabled:opacity-40" title="Send"><Send className="w-3.5 h-3.5" /></button>
        </form>
      </div>
    </div>
  );
}
