import express from "express";
import compression from "compression";
// Vite is a dev-only dependency — imported dynamically so it's never loaded in production
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { fetchCohortMutations, fetchDruggability, fetchClinical, fetchLiterature, fetchPubmedLiterature, resolveCbioStudy, resolveDiseaseScope } from "./evidenceProviders.js";
import { getPocketStructure } from "./dogsiteService.js";
import { getModalityProfile } from "./modalityService.js";
import { gatherModalityEvidence, assessModalities, buildRationalePrompt, attachRationales, summariseModalityBatch, isEvidenceResolved, MECHANISTIC_GOALS, isGoal, type MechanisticGoal } from "./modalityFitService.js";
import { enrichGene, enrichGenes } from "./enrichService.js";
import * as ordsSvc from "./ordsService.js"; // pure fetch client → safe to bundle for Vercel
import * as hermes from "./hermesService.js"; // PLEASER chat upstream — pure fetch client
import { deriveBoardRows } from "./boardRows.js"; // the Ranking Board's row shape (shared with benchmark + MCP)
import { buildBoard, MODALITY_PROFILES } from "./rankingBoard.js"; // the board engine — the co-pilot's "board rank" is the on-screen rank
import { GLOSSARY } from "./dashboardGlossary.js";        // pure data — safe on the server
import { MODALITY_GLOSSARY } from "./modalityGlossary.js"; // pure data — safe on the server
// NOTE: relative imports carry an explicit .js extension (Node-ESM requirement). On Vercel
// the server ships as unbundled ESM, so extensionless specifiers fail with ERR_MODULE_NOT_FOUND.
// .js resolves to the .ts source under tsx / esbuild / tsc alike.

// ── Supabase admin client (service role — server-side only, never sent to browser) ──
const supabaseAdmin = (() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Admin] SUPABASE_SERVICE_ROLE_KEY not set — /api/admin/* routes will return 503');
    }
    return null;
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
})();

const supabaseAuthVerifier = (() => {
  if (supabaseAdmin) return supabaseAdmin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
})();

const isProduction = process.env.NODE_ENV === 'production';
const logDev = (...args: unknown[]) => {
  if (!isProduction) console.error(...args);
};

type CachedApiResponse = {
  status: number;
  body: unknown;
  contentType?: string;
};

const API_CACHE_TABLE = process.env.SUPABASE_API_CACHE_TABLE || 'external_api_cache';
const API_CACHE_TTL_SECONDS = Number(process.env.API_CACHE_TTL_SECONDS || 60 * 60 * 24);
const apiCacheEnabled = !!supabaseAdmin && process.env.DISABLE_API_CACHE !== '1';

const cacheKey = (namespace: string, value: string) =>
  createHash('sha256').update(namespace).update('\0').update(value).digest('hex');

async function readApiCache(key: string): Promise<CachedApiResponse | null> {
  if (!apiCacheEnabled) return null;
  try {
    const { data, error } = await supabaseAdmin!
      .from(API_CACHE_TABLE)
      .select('response,status,content_type,expires_at')
      .eq('cache_key', key)
      .maybeSingle();
    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;
    const status = Number(data.status || 200);
    if (status < 200 || status >= 300) return null;
    return {
      status,
      body: data.response,
      contentType: data.content_type || undefined,
    };
  } catch (err) {
    logDev('[API cache] read failed:', err);
    return null;
  }
}

async function writeApiCache(key: string, cached: CachedApiResponse): Promise<void> {
  if (!apiCacheEnabled || cached.status < 200 || cached.status >= 300) return;
  try {
    const expiresAt = new Date(Date.now() + API_CACHE_TTL_SECONDS * 1000).toISOString();
    await supabaseAdmin!
      .from(API_CACHE_TABLE)
      .upsert({
        cache_key: key,
        response: cached.body,
        status: cached.status,
        content_type: cached.contentType || 'application/json',
        expires_at: expiresAt,
      }, { onConflict: 'cache_key' });
  } catch (err) {
    logDev('[API cache] write failed:', err);
  }
}

// Middleware: verify Supabase JWT and confirm caller is admin
async function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Admin API not configured (missing SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'Missing Authorization header' }); return; }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) { res.status(401).json({ error: 'Invalid or expired token' }); return; }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') { res.status(403).json({ error: 'Admin role required' }); return; }
  next();
}

async function requireAuthenticated(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!supabaseAuthVerifier) {
    res.status(503).json({ error: 'Authentication is not configured' });
    return;
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { data: { user }, error } = await supabaseAuthVerifier.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  next();
}

// Like requireAuthenticated, but also attaches the user to the request so
// endpoints can record who created/changed content (created_by, audit actor).
async function requireUser(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const verifier = supabaseAuthVerifier || supabaseAdmin;
  if (!verifier) { res.status(503).json({ error: 'Authentication is not configured' }); return; }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return; }
  const { data: { user }, error } = await verifier.auth.getUser(token);
  if (error || !user) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
  (req as any).appUser = { id: user.id, email: user.email };
  next();
}

// ── Oracle content store — loaded lazily so the oracledb driver is NEVER
// statically bundled into the serverless/edge build (same pattern used for
// the vite devDependency). Only loaded when USE_ORACLE_STORE=1 and reachable. ──
const oracleStoreEnabled = (): boolean =>
  process.env.USE_ORACLE_STORE === '1' &&
  !!process.env.ORACLE_USER && !!process.env.ORACLE_PASSWORD && !!process.env.ORACLE_CONNECT_STRING;

let _oracleSvc: any = null;
async function oracleSvc(): Promise<any> {
  if (_oracleSvc) return _oracleSvc;
  const spec = './oracleService.ts';   // non-literal specifier → bundlers leave it external
  _oracleSvc = await import(spec);
  return _oracleSvc;
}

// ── Read layer switch: on Vercel (no SQL*Net to Oracle) reads go through ORDS over
// HTTPS; internally they use node-oracledb. WRITES always use oracleSvc (ORDS is
// read-only), so harvest/save/delete stay on the internal path. Same function
// signatures + return shapes, so the endpoints below don't care which is used. ──
const ordsReadEnabled = (): boolean =>
  process.env.USE_ORDS === '1' && !!process.env.ORDS_BASE_URL;
async function readSvc(): Promise<any> {
  // ordsService is statically imported (above) so it bundles into the Vercel function.
  // oracleService stays a DYNAMIC import to keep the native oracledb driver out of the bundle.
  return ordsReadEnabled() ? ordsSvc : oracleSvc();
}
const readStoreEnabled = (): boolean => ordsReadEnabled() || oracleStoreEnabled();

// ── Module-level Express app — exported for Vercel serverless entry point ──────
export const app = express();

// ── Gemini model — single source of truth, overridable via env ────────────────
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const AI_RATE_LIMIT_WINDOW_MS = 60_000;
const AI_RATE_LIMIT_MAX_REQUESTS = Number(process.env.AI_RATE_LIMIT_MAX_REQUESTS || 20);
const aiRequestLog = new Map<string, number[]>();

const NCBI_MIN_INTERVAL_MS = process.env.NCBI_API_KEY ? 110 : 500;
let ncbiRequestQueue = Promise.resolve();
let ncbiNextRequestAt = 0;

const waitForNcbiSlot = (): Promise<void> => {
  const scheduled = ncbiRequestQueue.then(async () => {
    const waitMs = Math.max(0, ncbiNextRequestAt - Date.now());
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    ncbiNextRequestAt = Date.now() + NCBI_MIN_INTERVAL_MS;
  });
  ncbiRequestQueue = scheduled.catch(() => undefined);
  return scheduled;
};

// ── Shared Gemini REST helper (module-level so it's available at setup time) ───
const geminiGenerate = async (contents: object[], model = GEMINI_MODEL, responseMimeType?: string, temperature?: number) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const body: Record<string, unknown> = { contents };
  // Generous output budget so large structured extractions aren't truncated.
  const gen: Record<string, unknown> = { maxOutputTokens: 8192 };
  if (responseMimeType) gen.responseMimeType = responseMimeType;
  if (temperature != null) gen.temperature = temperature;   // 0 → reproducible (used by modality rationale)
  body.generationConfig = gen;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const raw = await r.text();
  let d: any;
  try {
    d = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini API returned an invalid response (${r.status})`);
  }
  if (!r.ok || d.error) {
    throw new Error(`Gemini API error ${d.error?.code || r.status}: ${d.error?.message || r.statusText}`);
  }
  const out = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  if (!out) {
    // Explain WHY it's empty instead of returning a blank string that callers misread.
    const reason = d.candidates?.[0]?.finishReason || d.promptFeedback?.blockReason || 'no text returned';
    throw new Error(`Gemini returned no text (${reason})`);
  }
  return out;
};

// ── Co-pilot upstreams ────────────────────────────────────────────────────────
// The co-pilot can run on Gemini (default) or on PLEASER's Hermes agent. They are
// NOT interchangeable: Gemini gets D2T's function declarations and can drive the
// app; Hermes ignores request-level tools entirely (see hermesService.ts), so it
// answers explanatory questions only. `tools` on each entry is what the client
// reads to say so in the UI rather than silently losing the ability to filter.
const GEMINI_CHOICE = { id: 'gemini', label: `Google ${GEMINI_MODEL}`, upstream: 'gemini' as const, tools: true };

// ── OpenAI upstream ───────────────────────────────────────────────────────────
// A third co-pilot upstream beside Gemini and PLEASER. The account's own allowance is the
// only cap: when it is hit, OpenAI's error is passed straight through. An app-side quota
// would just be a second, staler copy of a rule the key already enforces.
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const openaiEnabled = (): boolean => !!process.env.OPENAI_API_KEY;
const OPENAI_CHOICE = { id: 'openai', label: `OpenAI ${OPENAI_MODEL}`, upstream: 'openai' as const, tools: true };

// Gemini declares tool parameters with UPPERCASE types (OBJECT / STRING / ARRAY);
// OpenAI wants lowercase JSON Schema. One converter so the SAME tool definitions
// serve both upstreams and cannot drift apart.
const toOpenAiSchema = (s: any): any => {
  if (!s || typeof s !== 'object') return s;
  const out: any = { ...s };
  if (typeof out.type === 'string') out.type = out.type.toLowerCase();
  if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, toOpenAiSchema(v)]));
  if (out.items) out.items = toOpenAiSchema(out.items);
  return out;
};
const toOpenAiTools = (tools: any[]) => tools.map((t: any) => ({
  type: 'function',
  function: { name: t.name, description: t.description || '', parameters: toOpenAiSchema(t.parameters) || { type: 'object', properties: {} } },
}));
export const safeArgs = (s: any): any => { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); } catch { return {}; } };

/** One OpenAI chat-completions round trip. Errors (including rate limits) propagate so the
 *  caller shows OpenAI's own message rather than a guess about why it failed. */
async function openaiChat(messages: any[], tools?: any[]): Promise<any> {
  const body: Record<string, unknown> = { model: OPENAI_MODEL, messages };
  if (tools?.length) { body.tools = toOpenAiTools(tools); body.tool_choice = 'auto'; }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`OpenAI ${d.error?.code || r.status}: ${d.error?.message || r.statusText}`);
  return d.choices?.[0]?.message || {};
}

// Which Hermes models can be trusted with prompt-described tools. This is a
// per-MODEL property, not a per-upstream one, and it was measured rather than
// assumed: glm-air scored 13/13 across two probes (18 tools + glossary, and
// correctly declining to call anything on explanatory questions), while
// best-reasoning scored 1/4 — it knows its own PLEASER toolset and replies that
// the tools "don't exist here". Re-measure before adding a model to this list.
const HERMES_TOOL_MODELS = (process.env.HERMES_TOOL_MODELS || 'glm-air')
  .split(',').map(s => s.trim()).filter(Boolean);

let hermesModelCache: { at: number; models: hermes.HermesModel[] } | null = null;
const HERMES_MODEL_TTL_MS = 5 * 60_000;
const hermesModels = async (): Promise<hermes.HermesModel[]> => {
  if (!hermes.hermesEnabled()) return [];
  if (hermesModelCache && Date.now() - hermesModelCache.at < HERMES_MODEL_TTL_MS) return hermesModelCache.models;
  try {
    const models = await hermes.listModels();
    hermesModelCache = { at: Date.now(), models };
    return models;
  } catch (e: any) {
    // Unreachable PLEASER (off-network) must not break the picker — the user
    // still gets Gemini, and the reason is logged rather than thrown at them.
    console.warn('[Hermes] model list unavailable:', e?.message || e);
    return [];
  }
};

// One PLEASER chat per co-pilot session. PLEASER keeps the conversation
// server-side, so we hold the chat id and post only each new turn. Keyed by the
// caller's bearer token + their session id so one user's id cannot address
// another's chat. Chats are deleted on sign-off or after going idle: the pk_
// token is a single shared PLEASER account and we do not want every D2T user's
// transcript accumulating in it.
interface HermesSession { chatId: string; lastUsed: number; }
const hermesSessions = new Map<string, HermesSession>();
const HERMES_IDLE_MS = 30 * 60_000;
const hermesSessionKey = (req: express.Request, sessionId: string) =>
  createHash('sha256').update(`${req.headers.authorization || ''}|${sessionId}`).digest('hex');

// ── Prompt-described tool calling for Hermes ──────────────────────────────────
// PLEASER drops request-level tool declarations, so the tools are described in
// the message text and the reply is parsed back. Renders Gemini's
// functionDeclarations into a compact spec; enum values are kept because they
// are what stop the model inventing a view mode or a filter chip.
export const renderToolSpec = (tools: any[]): string => tools.map(t => {
  const props = t?.parameters?.properties || {};
  const req: string[] = t?.parameters?.required || [];
  const args = Object.entries(props).map(([k, v]: [string, any]) => {
    const enums = v?.enum || v?.items?.enum;
    const type = enums ? enums.join('|') : String(v?.type || 'any').toLowerCase();
    return `${k}${req.includes(k) ? '' : '?'}:${type}`;
  }).join(', ');
  return `- ${t.name} {${args}}${t.description ? ` — ${t.description}` : ''}`;
}).join('\n');

// ── Reference lookup, so the glossaries stop riding in every prompt ───────────
// The two glossary blocks are ~24,000 characters, and PLEASER replays the whole
// transcript each turn — so that cost was paid on EVERY message, not just the
// first. Measured: 75s for a first turn, ~25s after. Hermes now gets the list of
// term NAMES (cheap, and it needs them to know what is available) and fetches a
// definition only when someone actually asks for one. Gemini keeps the full
// blocks inline: it is fast enough that the round trip would be the worse trade.

/** Every term Hermes may look up — names only, no definitions. */
export const referenceTermIndex = (): string => {
  const names = [
    ...GLOSSARY.map(e => e.term),
    ...MODALITY_GLOSSARY.map(e => e.term),
  ];
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(', ');
};

/** Resolve a term to its full entry. Matches term, abbreviation or alias. */
export const lookupReference = (rawTerm: string): any => {
  const q = String(rawTerm || '').toLowerCase().trim();
  if (!q) return { error: 'term is required' };
  const hit = (s?: string) => Boolean(s && s.toLowerCase() === q);
  const loose = (s?: string) => Boolean(s && s.toLowerCase().includes(q));

  const dash = GLOSSARY.filter(e => hit(e.term) || hit(e.abbr) || (e.aliases || []).some(hit))
    .concat(GLOSSARY.filter(e => loose(e.term) || loose(e.abbr) || (e.aliases || []).some(loose)));
  const mod = MODALITY_GLOSSARY.filter(e => hit(e.term))
    .concat(MODALITY_GLOSSARY.filter(e => loose(e.term)));

  // Exact matches are concatenated ahead of loose ones, so dedupe keeps the
  // exact hit first — "tau" must not be beaten by a term that merely contains it.
  const entries = [...new Map([...dash, ...mod].map(e => [e.term, e])).values()].slice(0, 4);
  if (!entries.length) {
    return { term: rawTerm, found: false, note: 'No such term in the reference. Say so plainly rather than inventing a definition.' };
  }
  return { term: rawTerm, found: true, entries };
};

const REFERENCE_TOOL = {
  name: 'lookup_reference',
  description: 'Definition of any D2T term, column, metric, abbreviation, modality, goal or tier — with its range, formula, source and caveat. Call this whenever the user asks what something MEANS. Never answer a definition from memory.',
  parameters: { type: 'OBJECT', properties: { term: { type: 'STRING' } }, required: ['term'] },
};

export const HERMES_TOOL_PROTOCOL = `

TOOL CALLING — how you act on the application:
To call a tool, reply with ONLY a JSON object and nothing else:
{"tool":"<name>","args":{...}}
Rules:
- At most ONE tool per reply. No prose around the JSON, no code fences.
- Use the exact tool and argument names listed below.
- You may ALSO have disease2target tools of your own from an MCP server. Ignore
  them completely here. Only the tools listed below are scoped to the disease,
  snapshot and filters this user is actually looking at; yours are not, and mixing
  the two produces answers about a different dataset than the one on their screen.
- If a listed tool reports that something is missing or not loaded, that is a real
  answer about this user's session. It does NOT mean a server or an MCP is broken.
- For explanatory questions ("what does X mean?", "how is Y calculated?"), answer
  in plain prose with NO JSON — those are answered from the reference material above.
- If no tool fits, answer in prose.

AVAILABLE TOOLS:
`;

/**
 * Pull a tool call out of a Hermes reply. Returns null for ordinary prose, which
 * is the designed failure mode: an unparseable or unknown call degrades to being
 * shown as text rather than raising an error at the user. Validating the name
 * against the known set also stops prose that merely contains braces (a formula,
 * a JSON example) from being mistaken for a call.
 */
export const parseHermesToolCall = (text: string, known: Set<string>): { name: string; args: any } | null => {
  // Scan for the first BALANCED object rather than slicing first-{ to last-}.
  // glm-air intermittently emits a stray trailing brace
  // (`{"tool":"get_gene_evidence","args":{"gene":"PHGDH"}}}` — seen in the
  // benchmark), and the naive slice fails to parse that, which would have shown
  // the user raw JSON instead of an answer.
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false, obj: any = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { obj = JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      break;
    }
  }
  if (!obj || typeof obj.tool !== 'string' || !known.has(obj.tool)) return null;
  return { name: obj.tool, args: obj.args && typeof obj.args === 'object' ? obj.args : {} };
};

// How to handle whatever a tool hands back. Written after glm-air received the
// perfectly clear result "KRAS isn't in the current target list. Load its disease
// first" and, instead of relaying it, apologised for a broken "MCP tools
// interface" and offered to try other data sources. Two causes worth blocking:
// a tool result is often an INSTRUCTION rather than data, and Hermes has its own
// PLEASER MCP tooling it can confuse this with.
// ── Screen context + evidence rules for the co-pilot ─────────────────────────
// Requirement (Jake, Sep 2026): the AI must understand the current screen and the current
// disease, and cite the platform's evidence rather than answer from general knowledge.
// The client sends what the user is looking at; this renders it once for both the chat
// and the research agent, so the two cannot drift.
export interface ScreenContext {
  view?: string;
  disease?: { id?: string; name?: string } | null;
  snapshot?: { id?: number; disease_name?: string; gene_count?: number | null; version?: number | null; modality?: string; activeCriteria?: string[] } | null;
  focus?: { symbol: string; boardRank?: number; total?: number; display?: number; tier?: string; criteria?: Record<string, number | null>; weights?: Record<string, number>; strengths?: string[]; drags?: string[] } | null;
  listFocus?: string | null;
  topGenes?: string[];
  litWindow?: string;
}
const VIEW_LABEL: Record<string, string> = { board: 'Target Ranking Board', dashboard: 'Evidence explorer', list: 'Target List', funnel: 'Prioritisation Funnel', rankings: 'Rankings / Gene × Source matrix', graph: 'Knowledge Graph', modality: 'Modality fit', jobs: 'Jobs', enrichment: 'Enrichment' };
export function renderScreenBlock(s?: ScreenContext | null): string {
  if (!s || (!s.disease?.name && !s.view && !s.snapshot?.id)) return '';
  const L: string[] = ['WHAT THE USER IS LOOKING AT RIGHT NOW — answer in this context; do not switch disease unless the user names another one:'];
  if (s.disease?.name) L.push(`- Disease: ${s.disease.name}${s.disease.id ? ` (${s.disease.id})` : ''}`);
  if (s.view) L.push(`- Screen: ${VIEW_LABEL[s.view] || s.view}`);
  if (s.snapshot?.id) L.push(`- Snapshot on the board: #${s.snapshot.id}${s.snapshot.version != null ? ` v${s.snapshot.version}` : ''}${s.snapshot.disease_name ? ` — ${s.snapshot.disease_name}` : ''}${s.snapshot.gene_count != null ? `, ${s.snapshot.gene_count} genes` : ''}${s.snapshot.modality ? `; modality ${s.snapshot.modality}` : ''}${s.snapshot.activeCriteria?.length ? `; criteria with data: ${s.snapshot.activeCriteria.join(', ')}` : ''}${s.litWindow ? `; literature window: ${s.litWindow === 'recent3y' ? 'last 3 years' : 'all time'}` : ''}`);
  if (s.focus?.symbol) {
    const f = s.focus;
    L.push(`- Selected gene on the board: ${f.symbol}${f.boardRank != null ? ` — board rank ${f.boardRank}${f.total ? ` of ${f.total}` : ''}` : ''}${f.display != null ? `, score ${Number(f.display).toFixed(1)} (leader = 100)` : ''}${f.tier ? `, tier "${f.tier}"` : ''}`);
    if (f.criteria) L.push(`  criterion scores (0–100): ${Object.entries(f.criteria).filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(Number(v) * 100)}`).join(', ')}${f.weights ? ` · weights: ${Object.entries(f.weights).filter(([, w]) => Number(w) > 0).map(([k, w]) => `${k} ${Math.round(Number(w) * 100)}%`).join(', ')}` : ''}`);
    if (f.strengths?.length) L.push(`  leads on: ${f.strengths.join('; ')}`);
    if (f.drags?.length) L.push(`  held back by: ${f.drags.join('; ')}`);
  } else if (s.listFocus) L.push(`- Selected gene: ${s.listFocus}`);
  if (s.topGenes?.length) L.push(`- Top of the board right now: ${s.topGenes.join(', ')}`);
  return L.join('\n');
}
export const EVIDENCE_RULES = `EVIDENCE RULES (non-negotiable):
- Every number, rank, count, phase, score or paper you state MUST come from a tool result in this conversation or from the screen context above. If you have not called a tool yet, call one — never answer an evidence question from general knowledge.
- "Compare A and B" / "why is A above B" → call compare_genes. "How is A related to B" → call gene_relationship. One gene's full picture → get_gene_evidence first, then deep_dive_gene only if the stored summary is not enough. deep_dive_gene is LIVE and slower: at most two genes per question, never for lists or ranking questions.
- Stored snapshot evidence is the ranking's truth; a live deep-dive value is extra context. If the two disagree, say which is which and that the snapshot is what the board ranks on.
- Label each fact with its source and snapshot inline, e.g. "(Europe PMC, snapshot #103)" or "(STRING, live)". End with a short "Sources" list. Keep FACTS (mutation, expression, proteomics, dependency, safety, trials, papers) separate from PREDICTIONS (Open Targets association, board rank, WINNER centrality, tractability).
- If the store has nothing for a gene in this disease, say exactly that. Do not fill the gap from memory.
- Stay in the current disease context unless the user names another disease.`;

const TOOL_RESULT_RULES = `Now answer the user in prose. Do NOT call another tool.
- These results came from the Disease2Target application itself. They did NOT come
  from MCP, and nothing here is broken — do not diagnose, speculate about servers,
  configuration or interfaces, and do not offer other data sources.
- A result is often an INSTRUCTION rather than data. If it says something is not
  loaded, not found, or asks the user to do something first, relay exactly that in
  one plain sentence and stop. That is a correct answer, not a failure.
- Report only what the result says. Do not add numbers or findings it does not contain.
- NEVER WIDEN THE SCOPE OF A NEGATIVE. "Not in the loaded list" is not "not in the
  snapshot", and "not in this snapshot" is not "not in the database" or "not a
  known gene". Repeat the exact scope the tool reported and nothing larger. A gene
  ranked below the loaded page is present in the data and simply not fetched yet —
  reporting it as absent is a factual error a researcher may act on.
- If a tool errors, say only that the lookup failed and what you were trying to
  fetch. Do not diagnose the cause and do not conclude anything about the data
  from a failure to retrieve it.`;

/**
 * Did the model try to call a tool and produce something we could not read?
 * Such a reply must never reach the user as-is — "degrade to prose" is only
 * sensible when the reply IS prose, and a broken call is raw JSON.
 */
export const looksLikeToolAttempt = (text: string): boolean => /"tool"\s*:/.test(text);

const reapIdleHermesChats = () => {
  const now = Date.now();
  for (const [key, s] of hermesSessions) {
    if (now - s.lastUsed < HERMES_IDLE_MS) continue;
    hermesSessions.delete(key);
    void hermes.deleteChat(s.chatId);
  }
};

// ── setupRoutes — synchronous, called at module level so Vercel gets a
//    fully-configured app immediately on import (fixes critical async race) ────
function setupRoutes() {
  app.set('trust proxy', 1);

  // The dashboard and Ranking Board each pull a whole snapshot's gene set in one
  // response — megabytes of highly repetitive JSON, which was going over the wire
  // uncompressed. gzip is the cheapest win available on that payload.
  app.use(compression());

  // Fix #6 CORS — allow same-origin and configured origin
  app.use((_req, res, next) => {
    const origin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // Fix #2: body-parse BEFORE all routes (including healthz)
  // /api/ai/analyze-paper carries base64 PDFs and is parsed by its own 25mb
  // parser — skip it here so the global 2mb limit doesn't reject large papers.
  app.use((req, res, next) => {
    if (req.path === '/api/ai/analyze-paper' || req.path === '/api/snapshots' || req.path === '/api/evidence' || req.path === '/api/harvest') return next();
    express.json({ limit: '2mb' })(req, res, next);
  });
  app.use(express.urlencoded({ limit: '2mb', extended: true }));

  // Fix #4: health check — used by Render, Railway, Docker, Vercel
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

  // ── AI Endpoints ─────────────────────────────────────────────────────────────

  app.use('/api/ai', requireAuthenticated, (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const recent = (aiRequestLog.get(key) || []).filter(ts => now - ts < AI_RATE_LIMIT_WINDOW_MS);
    if (recent.length >= AI_RATE_LIMIT_MAX_REQUESTS) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'AI request limit reached. Try again in one minute.' });
      return;
    }
    recent.push(now);
    aiRequestLog.set(key, recent);
    if (aiRequestLog.size > 1000) {
      for (const [client, timestamps] of aiRequestLog) {
        if (timestamps.every(ts => now - ts >= AI_RATE_LIMIT_WINDOW_MS)) aiRequestLog.delete(client);
      }
    }
    next();
  });

  // Which co-pilot upstreams this deployment can offer. Gemini is always listed
  // (the key is checked at call time); Hermes appears only when PLEASER is
  // configured AND currently reachable, so an off-network user sees one option
  // instead of a dropdown entry that always errors.
  app.get("/api/ai/models", async (_req, res) => {
    const models: any[] = [{ ...GEMINI_CHOICE, available: Boolean(process.env.GEMINI_API_KEY) }];
    if (openaiEnabled()) models.push({ ...OPENAI_CHOICE, available: true });
    for (const m of await hermesModels()) {
      models.push({ id: `hermes:${m.id}`, label: `${m.label} · PLEASER`, upstream: 'hermes', tools: HERMES_TOOL_MODELS.includes(m.id), available: true });
    }
    res.json({ models, default: GEMINI_CHOICE.id });
  });

  // End a Hermes co-pilot session and delete its chat from the shared PLEASER
  // account. Idempotent — an unknown session is a no-op, not a 404.
  app.delete("/api/ai/chat-session", async (req, res) => {
    const sessionId = String((req.body || {}).sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const key = hermesSessionKey(req, sessionId);
    const sess = hermesSessions.get(key);
    if (!sess) return res.json({ ended: false });
    hermesSessions.delete(key);
    res.json({ ended: await hermes.deleteChat(sess.chatId) });
  });

  // Generic AI generate — text prompt → text response
  app.post("/api/ai/generate", async (req, res) => {
    const { prompt } = req.body || {};
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: "prompt is required" });
    }
    if (prompt.length > 50_000) {
      return res.status(413).json({ error: "prompt exceeds the 50,000 character limit" });
    }
    // Gemini is the default here; OpenAI stands in only when Gemini is absent.
    if (!process.env.GEMINI_API_KEY && !openaiEnabled()) {
      return res.status(503).json({ error: "No AI upstream configured (set GEMINI_API_KEY or OPENAI_API_KEY)" });
    }
    try {
      if (process.env.GEMINI_API_KEY) {
        return res.json({ text: await geminiGenerate([{ parts: [{ text: prompt.trim() }] }]) });
      }
      const msg = await openaiChat([{ role: 'user', content: prompt.trim() }]);
      return res.json({ text: String(msg.content || '').trim() });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // Multi-turn co-pilot chat with optional tools + systemInstruction.
  // Kept at its original path so existing callers are unaffected; `model` selects
  // the upstream and defaults to Gemini.
  app.post("/api/ai/gemini-chat", async (req, res) => {
    const { messages, systemInstruction, tools, model, sessionId } = req.body || {};
    if (!messages?.length) return res.status(400).json({ error: "messages required" });

    // ── Hermes upstream ───────────────────────────────────────────────────────
    // PLEASER drops request-level tool declarations, so `tools` is never
    // forwarded as a field — it is rendered into the prompt and the reply is
    // parsed back. The co-pilot's tools are two different species and each needs
    // a different answer:
    //   DATA tools (get_gene_evidence, get_clinical_trials, …) read the store, so
    //     they run HERE and loop the result back for synthesis.
    //   ACTION tools (focus_gene, dashboard_filter, …) mutate React state in the
    //     browser, so they are returned as `functionCalls` for the client's
    //     existing executor. Hermes runs on PLEASER's server and can never reach
    //     the user's browser itself — this is the half an MCP server could not do.
    if (typeof model === 'string' && model.startsWith('hermes:')) {
      if (!hermes.hermesEnabled()) return res.status(503).json({ error: 'PLEASER is not configured on this server' });
      const hermesModel = model.slice('hermes:'.length);
      const known = await hermesModels();
      if (known.length && !known.some(m => m.id === hermesModel)) {
        return res.status(400).json({ error: `Unknown PLEASER model "${hermesModel}"` });
      }
      const toolsOn = HERMES_TOOL_MODELS.includes(hermesModel) && Array.isArray(tools) && tools.length > 0;

      // A name sent by the client wins over the same name in AGENT_TOOLS
      // (`rank_targets` exists in both with different arguments) — the client's
      // version re-ranks what is actually on screen, which is what the user means.
      const clientNames = new Set<string>((tools || []).map((t: any) => t?.name).filter(Boolean));
      const dataTools = [...AGENT_TOOLS.filter(t => !clientNames.has(t.name)), REFERENCE_TOOL];
      const dataNames = new Set(dataTools.map(t => t.name));
      const knownTools = new Set<string>([...clientNames, ...dataNames]);

      const lastUserIdx = messages.map((m: any) => m.role).lastIndexOf('user');
      if (lastUserIdx < 0) return res.status(400).json({ error: 'no user message to send' });
      // Anything after the last user turn is the client reporting back what it did
      // with an action tool (its second pass). Forward those as the new turn rather
      // than resending the original question, which would just repeat the request.
      const clientToolResults = messages.slice(lastUserIdx + 1)
        .map((m: any) => String(m.content || '').trim()).filter(Boolean);
      const turnText = clientToolResults.length
        ? `Results of the tool you called:\n${clientToolResults.join('\n')}\n\n${TOOL_RESULT_RULES}`
        : String(messages[lastUserIdx].content || '');
      if (!turnText) return res.status(400).json({ error: 'no user message to send' });

      try {
        reapIdleHermesChats();
        const key = hermesSessionKey(req, String(sessionId || 'default'));
        let sess = hermesSessions.get(key);
        let text: string;

        if (!sess) {
          // First turn of a session. PLEASER has no system-prompt field, so the
          // instruction rides in front of the first question rather than as a
          // separate priming turn — one round trip instead of two, and PLEASER's
          // server-side history carries it forward to every later turn.
          const preamble = [
            systemInstruction || '',
            toolsOn ? HERMES_TOOL_PROTOCOL + renderToolSpec([...(tools || []), ...dataTools]) : '',
          ].filter(Boolean).join('\n');
          const chatId = await hermes.createChat('Disease2Target co-pilot');
          const primed = preamble
            ? `${preamble}\n\n--- The user's question follows. Answer it under the instructions above. ---\n\n${turnText}`
            : turnText;
          try {
            text = await hermes.sendMessage(chatId, primed, hermesModel);
          } catch (e) {
            // Don't register a session whose priming turn never landed, or the
            // retry would reuse the chat and skip the instruction entirely.
            void hermes.deleteChat(chatId);
            throw e;
          }
          sess = { chatId, lastUsed: Date.now() };
          hermesSessions.set(key, sess);
        } else {
          text = await hermes.sendMessage(sess.chatId, turnText, hermesModel);
        }
        sess.lastUsed = Date.now();

        if (!toolsOn) return res.json({ text, functionCalls: [], upstream: 'hermes', model });

        // Resolve data tools here, up to a small step budget. Each hop is a full
        // Hermes round trip (6–15s measured), so the ceiling is deliberately low —
        // an unbounded loop would be minutes of silence for the user.
        const trace: string[] = [];
        for (let step = 0; step < 3; step++) {
          const call = parseHermesToolCall(text, knownTools);
          if (!call) break;                                    // prose — done
          if (!dataNames.has(call.name)) {
            // An action tool: hand it to the browser, which owns that state.
            return res.json({ text: '', functionCalls: [call], upstream: 'hermes', model, trace });
          }
          let result: any;
          try {
            // Reference lookups are a local data read, not a store query — they
            // resolve in microseconds, which is the whole point of moving the
            // glossaries out of the prompt.
            result = call.name === REFERENCE_TOOL.name
              ? lookupReference(call.args?.term)
              : await execAgentTool(call.name, call.args, { disease: req.body?.disease, snapshotId: req.body?.snapshotId });
          } catch (e: any) { result = { error: String(e?.message || e) }; }
          trace.push(call.name);
          // Cap the payload: a full evidence dossier can dwarf the context and the
          // useful part is always at the top of the object.
          const payload = JSON.stringify(result).slice(0, 20_000);
          text = await hermes.sendMessage(
            sess.chatId,
            `Result of ${call.name}:\n${payload}\n\n${TOOL_RESULT_RULES.replace('Do NOT call another tool.', 'Call another tool only if you genuinely cannot answer yet.')}`,
            hermesModel,
          );
          sess.lastUsed = Date.now();
        }
        // Never return JSON to the chat bubble: either a call survived the step
        // budget, or the model attempted one we could not parse. Both would render
        // as raw braces to the user.
        if (parseHermesToolCall(text, knownTools) || looksLikeToolAttempt(text)) {
          text = 'I could not finish gathering that in the available steps. Try a narrower question, or switch to Gemini.';
        }
        return res.json({ text, functionCalls: [], upstream: 'hermes', model, trace });
      } catch (err: any) {
        return res.status(502).json({ error: err.message });
      }
    }

    // ── OpenAI upstream ───────────────────────────────────────────────────────
    // Same shape as the Gemini branch below: DATA tools run here in a loop, browser
    // ACTION tools are returned for the client's executor.
    if (model === 'openai') {
      if (!openaiEnabled()) return res.status(503).json({ error: 'OPENAI_API_KEY is not configured on this server' });
      const screen: ScreenContext | undefined = req.body?.screen;
      const sysText = [systemInstruction || '', renderScreenBlock(screen), EVIDENCE_RULES].filter(Boolean).join('\n\n');
      const clientNames = new Set<string>((tools || []).map((t: any) => t?.name).filter(Boolean));
      const dataTools = AGENT_TOOLS.filter(t => !clientNames.has(t.name));
      const dataNames = new Set(dataTools.map(t => t.name));
      const allTools = [...(tools || []), ...dataTools];
      const toolCtx = { disease: req.body?.disease || screen?.disease?.name, snapshotId: req.body?.snapshotId || screen?.snapshot?.id, modality: screen?.snapshot?.modality, litWindow: screen?.litWindow };
      const convo: any[] = [{ role: 'system', content: sysText }];
      for (const m of messages as any[]) convo.push({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content || '') });
      const trace: any[] = [];
      const pendingClient: any[] = [];
      try {
        for (let step = 0; step < 4; step++) {
          const msg = await openaiChat(convo, allTools);
          const calls: any[] = msg.tool_calls || [];
          const text = String(msg.content || '').trim();
          const dataCalls = calls.filter(c => dataNames.has(c.function?.name));
          pendingClient.push(...calls.filter(c => !dataNames.has(c.function?.name)).map(c => ({ name: c.function.name, args: safeArgs(c.function.arguments) })));
          if (!dataCalls.length) {
            if (trace.length) console.log(`[copilot·openai] ${trace.map(t => `${t.tool}(${JSON.stringify(t.args)})`).join(' → ')}`);
            return res.json({ text, functionCalls: pendingClient, trace });
          }
          convo.push(msg);
          // OpenAI requires a tool message for EVERY tool_call in the assistant turn,
          // so browser actions get an acknowledgement rather than being left unanswered.
          for (const c of calls) {
            const nm = c.function?.name;
            const args = safeArgs(c.function?.arguments);
            let result: any;
            if (dataNames.has(nm)) {
              try { result = await execAgentTool(nm, args, toolCtx); } catch (e: any) { result = { error: String(e?.message || e) }; }
              trace.push({ tool: nm, args });
            } else result = { queued: 'this browser action runs after you answer; assume it happens' };
            convo.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 20_000) });
          }
        }
        return res.json({ text: 'I could not finish gathering that within the OpenAI step budget. Try a narrower question, or switch to Gemini.', functionCalls: pendingClient, trace });
      } catch (e: any) {
        return res.status(502).json({ error: e?.message || 'OpenAI error', trace });
      }
    }

    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ error: "GEMINI_API_KEY not configured" });
    try {
      // Gemini REST API requires conversation to start with 'user' role
      const mappedMessages = messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));
      // Drop any leading 'model' turns (e.g. the initial assistant greeting)
      const firstUserIdx = mappedMessages.findIndex((m: { role: string }) => m.role === 'user');
      const contents = firstUserIdx >= 0 ? mappedMessages.slice(firstUserIdx) : mappedMessages;

      // ── Gemini: one co-pilot, two kinds of tool ─────────────────────────────
      // DATA tools (the research agent's: get_gene_evidence, compare_genes, deep_dive_gene, …)
      // read the store, so they run HERE in a loop and their results go back to the model.
      // ACTION tools (focus_gene, dashboard_filter, …) mutate browser state, so they are
      // collected and returned as `functionCalls` for the client's executor, as before.
      // Before this, the default chat could not reach the evidence at all — only the
      // "/research" side door could — so "compare PHGDH and APOE" got a generic answer.
      const screen: ScreenContext | undefined = req.body?.screen;
      const sysText = [systemInstruction || '', renderScreenBlock(screen), EVIDENCE_RULES].filter(Boolean).join('\n\n');
      const clientNames = new Set<string>((tools || []).map((t: any) => t?.name).filter(Boolean));
      const dataTools = AGENT_TOOLS.filter(t => !clientNames.has(t.name));
      const dataNames = new Set(dataTools.map(t => t.name));
      const allTools = [...(tools || []), ...dataTools];
      const trace: any[] = [];
      const pendingClient: any[] = [];
      const toolCtx = { disease: req.body?.disease || screen?.disease?.name, snapshotId: req.body?.snapshotId || screen?.snapshot?.id, modality: screen?.snapshot?.modality, litWindow: screen?.litWindow };
      for (let step = 0; step < 6; step++) {
        const body: Record<string, unknown> = { contents, systemInstruction: { parts: [{ text: sysText }] } };
        if (allTools.length) body.tools = [{ functionDeclarations: allTools }];
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        const raw = await r.text();
        let d: any;
        try { d = JSON.parse(raw); } catch { return res.status(502).json({ error: `Gemini API returned an invalid response (${r.status})` }); }
        if (!r.ok || d.error) return res.status(502).json({ error: `Gemini API error ${d.error?.code || r.status}: ${d.error?.message || r.statusText}` });
        const parts: any[] = d.candidates?.[0]?.content?.parts || [];
        const calls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);
        const dataCalls = calls.filter((c: any) => dataNames.has(c.name));
        const clientCalls = calls.filter((c: any) => !dataNames.has(c.name));
        const text = parts.find((p: any) => p.text)?.text?.trim() || '';
        pendingClient.push(...clientCalls);
        if (!dataCalls.length) { if (trace.length) console.log(`[copilot] ${trace.map(t => `${t.tool}(${JSON.stringify(t.args)})`).join(' → ')}`); return res.json({ text, functionCalls: pendingClient, trace }); }
        contents.push({ role: 'model', parts });
        const resp: any[] = [];
        for (const c of dataCalls) {
          let result: any;
          try { result = await execAgentTool(c.name, c.args || {}, toolCtx); } catch (e: any) { result = { error: String(e?.message || e) }; }
          trace.push({ tool: c.name, args: c.args || {} });
          resp.push({ functionResponse: { name: c.name, response: { result } } });
        }
        // Gemini expects a response for every call in the turn; browser actions are queued
        // and will run after the answer, so say so rather than leave the model waiting.
        for (const c of clientCalls) resp.push({ functionResponse: { name: c.name, response: { result: { queued: 'this browser action runs after you answer; assume it happens' } } } });
        contents.push({ role: 'user', parts: resp });
      }
      res.json({ text: 'I could not finish gathering that in the available steps. Try a narrower question.', functionCalls: pendingClient, trace });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // PDF paper analysis — Fix #3: route-specific 25mb limit for base64 PDFs
  app.post("/api/ai/analyze-paper", express.json({ limit: '25mb' }), async (req, res) => {
    const { base64, mimeType = 'application/pdf', prompt } = req.body || {};
    if (!base64 || !prompt) return res.status(400).json({ error: "base64 and prompt required" });
    try {
      const contents = [{ parts: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }] }];
      const text = await geminiGenerate(contents, GEMINI_MODEL, 'application/json');
      res.json({ text });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── Liveness probe. Unauthenticated and dependency-free ON PURPOSE: it answers
  // "is this process up and serving?", which is what a container orchestrator asks.
  // It reports which read path is active but NEVER any credential or host detail. ──
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      readPath: ordsReadEnabled() ? 'ords' : (oracleStoreEnabled() ? 'oracle' : 'none'),
      writesEnabled: oracleStoreEnabled(),
    });
  });

  // ── Oracle content store (lazy-loaded; gated by USE_ORACLE_STORE=1) ───────────
  app.get("/api/oracle/health", async (_req, res) => {
    if (!oracleStoreEnabled()) return res.status(503).json({ ok: false, error: "Oracle store disabled (set USE_ORACLE_STORE=1 + creds)" });
    try {
      const svc = await oracleSvc();
      const ok = await svc.ping();
      res.json({ ok, db: ok ? "reachable" : "unexpected" });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // Save a ranking snapshot (header + per-gene scores + audit) to Oracle
  app.post("/api/snapshots", requireUser, express.json({ limit: "12mb" }), async (req, res) => {
    if (!oracleStoreEnabled()) return res.status(503).json({ ok: false, error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
      const r = await svc.saveSnapshot({ ...req.body, created_by: (req as any).appUser?.id ?? null });
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // List snapshots (metadata only)
  app.get("/api/snapshots", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await readSvc();
      res.json(await svc.listSnapshots(req.query.diseaseId as string | undefined));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Load one full snapshot (with targets)
  app.get("/api/snapshots/:id", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await readSvc();
      const snap = await svc.getSnapshot(Number(req.params.id));
      if (!snap) return res.status(404).json({ error: "Snapshot not found" });
      res.json(snap);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Delete a snapshot
  app.delete("/api/snapshots/:id", requireUser, async (req, res) => {
    if (!oracleStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
      await svc.deleteSnapshot(Number(req.params.id), (req as any).appUser?.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Per-gene scores for a snapshot (Rankings dashboard)
  app.get("/api/snapshots/:id/scores", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await readSvc();
      res.json(await svc.listRankingScores(Number(req.params.id)));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Evidence rows for a snapshot (Gene × Source matrix)
  app.get("/api/snapshots/:id/evidence", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await readSvc();
      res.json(await svc.snapshotEvidence(Number(req.params.id)));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // ── Diagnostics ───────────────────────────────────────────────────────────────
  // Reports, FROM INSIDE the running function, which Oracle read path is active and whether
  // a live call works — so a 500 on Vercel can be diagnosed without guessing. Reveals only
  // config flags + the ORDS host (no secrets). Intentionally open (no requireUser) so it is
  // reachable even if auth itself is the problem. Safe to remove once production is stable.
  app.get('/api/_diag', async (_req, res) => {
    let ordsHost: string | null = null;
    try { ordsHost = process.env.ORDS_BASE_URL ? new URL(process.env.ORDS_BASE_URL).host : null; } catch { ordsHost = 'INVALID_URL'; }
    const info: any = {
      node: process.version,
      onVercel: !!process.env.VERCEL,
      flags: {
        USE_ORDS_is_1: process.env.USE_ORDS === '1',
        USE_ORDS_raw: process.env.USE_ORDS ?? null,          // to catch "true"/"TRUE"/" 1 "
        ORDS_BASE_URL_set: !!process.env.ORDS_BASE_URL,
        ords_host: ordsHost,
        USE_ORACLE_STORE: process.env.USE_ORACLE_STORE ?? null,
        has_supabase: !!process.env.SUPABASE_URL,
      },
      readPath: ordsReadEnabled() ? 'ords' : (oracleStoreEnabled() ? 'oracle(node-oracledb — cannot reach internal Oracle from Vercel)' : 'DISABLED (503)'),
    };
    try {
      const svc = await readSvc();
      const t0 = Date.now();
      const snaps = await svc.listSnapshots();
      info.liveTest = { ok: true, ms: Date.now() - t0, snapshots: Array.isArray(snaps) ? snaps.length : 0 };
    } catch (e: any) {
      info.liveTest = { ok: false, error: String(e?.message || e).slice(0, 400) };
    }

    // ── Gemini ────────────────────────────────────────────────────────────────
    // "The key does not work in production" has several distinct causes that look
    // identical from the browser: the variable is unset on this host, the key carries an
    // HTTP-referrer/IP restriction that a serverless egress address fails, the model name
    // has been retired upstream, or quota is exhausted. Each returns a DIFFERENT upstream
    // error, so the fix is to surface that error rather than guess between them. The key
    // itself is never echoed — only whether it is present, and what Google said about it.
    const gkey = process.env.GEMINI_API_KEY || '';
    info.gemini = { key_set: !!gkey, key_length: gkey.length || null, model: GEMINI_MODEL };
    if (gkey) {
      try {
        const t0 = Date.now();
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${gkey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }) },
        );
        const raw = await r.text();
        let parsed: any = null; try { parsed = JSON.parse(raw); } catch { /* non-JSON body */ }
        info.gemini.liveTest = r.ok && !parsed?.error
          ? { ok: true, ms: Date.now() - t0, status: r.status }
          : { ok: false, status: r.status, code: parsed?.error?.code ?? null,
              upstreamStatus: parsed?.error?.status ?? null,
              error: String(parsed?.error?.message || raw).slice(0, 300) };
      } catch (e: any) {
        info.gemini.liveTest = { ok: false, error: String(e?.message || e).slice(0, 300) };
      }
    }

    // ── PLEASER / Hermes ──────────────────────────────────────────────────────
    // The composer's model picker renders only when MORE THAN ONE model is available
    // (index.tsx: `aiModels.length > 1`), which is deliberate — an unreachable PLEASER
    // should change nothing visually rather than offer a dropdown entry that always
    // errors. The consequence is that "the picker is missing" and "PLEASER is not
    // configured on this host" look identical from the browser, so report both halves:
    // whether the two variables are present, and whether the upstream actually answers.
    // The token is never echoed.
    let pleaserHost: string | null = null;
    try { pleaserHost = process.env.PLEASER_BASE_URL ? new URL(process.env.PLEASER_BASE_URL).host : null; }
    catch { pleaserHost = 'INVALID_URL'; }
    info.pleaser = {
      base_url_set: !!process.env.PLEASER_BASE_URL,
      host: pleaserHost,
      token_set: !!process.env.PLEASER_TOKEN,
    };
    try {
      const t0 = Date.now();
      const ms = await hermesModels();
      info.pleaser.liveTest = { ok: true, ms: Date.now() - t0, models: ms.length, ids: ms.map(m => m.id).slice(0, 8) };
    } catch (e: any) {
      info.pleaser.liveTest = { ok: false, error: String(e?.message || e).slice(0, 300) };
    }
    // What the composer will actually render, so the answer needs no cross-referencing.
    const modelCount = (info.gemini?.key_set ? 1 : 0) + (info.pleaser.liveTest?.models ?? 0);
    info.modelPicker = { modelCount, visible: modelCount > 1, rule: 'index.tsx renders the picker only when modelCount > 1' };

    // Which of the expected variables this running function can actually SEE. Names only —
    // never values. "Set it in the dashboard and redeploy" fails silently in several ways
    // that look identical from outside: added to Preview/Development instead of Production,
    // a trailing space or typo in the key, or a redeploy served from build cache. Listing
    // the keys that matched distinguishes all of them at a glance, and a key that is absent
    // here was never delivered to this process regardless of what the dashboard shows.
    info.envKeysSeen = Object.keys(process.env)
      .filter(k => /^(PLEASER|GEMINI|ORDS|USE_|SUPABASE)/i.test(k))
      .sort();

    res.json(info);
  });

  // ── Dashboard ───────────────────────────────────────────────────────────────
  // Overview of what is actually IN the store for a snapshot, plus per-gene dossiers.
  // A snapshot is 7k score rows + 33k evidence rows, and pulling that over ORDS takes
  // ~30s, so it is loaded ONCE per snapshot and memoised — the dashboard then answers
  // from memory. TTL keeps it fresh after a re-enrich without a server restart.
  const dashCache = new Map<number, { at: number; meta: any; scores: any[]; evidence: any[] }>();
  const DASH_TTL_MS = 10 * 60 * 1000;
  const loadSnapshotCached = async (id: number) => {
    const hit = dashCache.get(id);
    if (hit && Date.now() - hit.at < DASH_TTL_MS) return hit;
    const svc = await readSvc();
    const [meta, scores, evidence] = await Promise.all([
      svc.getSnapshot(id), svc.listRankingScores(id), svc.snapshotEvidence(id),
    ]);
    const entry = { at: Date.now(), meta, scores: scores || [], evidence: evidence || [] };
    dashCache.set(id, entry);
    return entry;
  };


  // Building the dashboard row set costs a JSON.parse per evidence CLOB — nine to
  // eleven per gene, so tens of thousands of parses for a full snapshot. That ran on
  // EVERY request, and then most of the result was discarded by the limit. Only the
  // raw Oracle read was cached, so each board load paid the whole derivation again.
  // Keyed on the raw entry's timestamp: when that refreshes, this derives afresh.
  const dashRowsCache = new Map<number, { at: number; rows: any[] }>();
  // The row shape lives in boardRows.ts — shared with the benchmark and the MCP server, so
  // the three cannot drift apart.
  const deriveRows = (scores: any[], evidence: any[]) => deriveBoardRows(scores, evidence);

  const dashboardRows = (id: number, entry: { at: number; scores: any[]; evidence: any[] }) => {
    const hit = dashRowsCache.get(id);
    if (hit && hit.at === entry.at) return hit.rows;
    const rows = deriveRows(entry.scores, entry.evidence);
    dashRowsCache.set(id, { at: entry.at, rows });
    return rows;
  };

  // ── NOT DONE: the durable fix lives in ORDS, not here ──────────────────────
  // Everything below makes the WAIT usable. It does not make the transfer smaller, and
  // the transfer is the actual cost: ~55k evidence rows at ~2,400 rows/sec ≈ 23s, scaling
  // linearly with gene count. Two ways to cut it at the source, cheapest first:
  //
  //   1. Project the columns. deriveRows() pulls ~25 scalars out of each row's value_json
  //      CLOB and discards the rest, yet the whole CLOB crosses the wire. An ORDS view
  //      that extracts those scalars server-side (JSON_VALUE) would cut bytes hard without
  //      changing row count or any shape this file depends on. Small, low-risk, do first.
  //
  //   2. Pivot to one row per gene. Fold a gene's ~9 axis rows into a single row in Oracle:
  //      55k rows becomes ~6k. Bigger win, bigger job — needs SQL plus an ORDS module
  //      deploy (precedent: docs/sql/kg_ords_module.sql). Note that measured cost is
  //      ~700ms fixed + 0.65ms/row, and a narrow score row costs ~0.25ms against an
  //      evidence row's ~0.65ms, so the gain is partly per-row and partly bytes: expect a
  //      real improvement, but do NOT assume it divides the time by nine.
  //
  // How much this matters depends on where the app runs. On a long-lived internal server
  // the caches below absorb the cost after the first open, so it is a nice-to-have. On
  // Vercel or anything serverless it is NOT: process memory does not survive between
  // invocations, so the caches never warm and EVERY user pays the full pull. If this ever
  // ships serverless, do (1) and (2) before it does.

  // ── Progressive board load ─────────────────────────────────────────────
  // ORDS delivers ~2,400 rows/sec and a snapshot carries ~55k evidence rows, so the
  // whole set cannot arrive quickly — but it arrives grouped BY AXIS, one axis at a
  // time across every gene. buildBoard() already drops criteria with no coverage and
  // renormalises the weight budget over the rest, so a board built from the axes that
  // HAVE landed is internally consistent: it ranks on what it has, and sharpens as more
  // arrives. That is worth showing at 5s. A board built from a partial axis would not
  // be — it would score some genes on a criterion and not others — so the trailing,
  // possibly-incomplete axis is withheld until the next wave proves it finished.
  interface ProgLoad {
    meta: any | null; scores: any[]; evidence: any[];
    loaded: number; done: boolean; error: string | null;
    derivedFor: number; derived: any[];   // memo, keyed on evidence length, so polling is free
  }
  const progLoads = new Map<number, ProgLoad>();

  const completeAxisRows = (rows: any[], done: boolean): any[] => {
    if (done || rows.length === 0) return rows;
    const trailing = rows[rows.length - 1].evidence_type;
    let end = rows.length;
    while (end > 0 && rows[end - 1].evidence_type === trailing) end--;
    return end === rows.length ? rows : rows.slice(0, end);
  };

  const startProgressive = (id: number): ProgLoad => {
    const existing = progLoads.get(id);
    if (existing) return existing;
    const st: ProgLoad = { meta: null, scores: [], evidence: [], loaded: 0, done: false, error: null, derivedFor: -1, derived: [] };
    progLoads.set(id, st);
    void (async () => {
      const svc = await readSvc();
      const [meta, scores] = await Promise.all([svc.getSnapshot(id), svc.listRankingScores(id)]);
      st.meta = meta; st.scores = scores || [];
      if (typeof svc.snapshotEvidenceWaves !== 'function') {
        // Non-ORDS (internal node-oracledb) path has no wave fetcher — one shot.
        st.evidence = (await svc.snapshotEvidence(id)) || [];
        st.loaded = st.evidence.length; st.done = true;
      } else {
        await svc.snapshotEvidenceWaves(id, (rows: any[], loaded: number, done: boolean) => {
          st.evidence.push(...rows); st.loaded = loaded; if (done) st.done = true;
        });
        st.done = true;
      }
      // Hand the finished set to the normal caches so non-progressive readers
      // (DashboardView, exports) take the fast path instead of re-fetching.
      const entry = { at: Date.now(), meta: st.meta, scores: st.scores, evidence: st.evidence };
      dashCache.set(id, entry as any);
      dashRowsCache.set(id, { at: entry.at, rows: deriveRows(st.scores, st.evidence) });
    })().catch(e => { st.error = String(e?.message ?? e); st.done = true; });
    return st;
  };

  app.get("/api/dashboard/overview", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const id = Number(req.query.snapshotId);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "snapshotId required" });
      const { meta, scores, evidence } = await loadSnapshotCached(id);
      if (!meta) return res.status(404).json({ error: `Snapshot #${id} not found` });

      // per-axis coverage (distinct genes with a row) + schema-version detection
      const byAxis: Record<string, Set<string>> = {};
      let legacyDrug = 0, v2Drug = 0, legacyClin = 0, v2Clin = 0, lowConf = 0;
      for (const e of evidence as any[]) {
        (byAxis[e.evidence_type] ??= new Set()).add(e.gene_symbol);
        let j: any = null; try { j = typeof e.value_json === 'string' ? JSON.parse(e.value_json) : e.value_json; } catch { /* ignore */ }
        if (!j) continue;
        if (j.low_confidence) lowConf++;
        if (e.evidence_type === 'druggability') (j.proven_modalities === undefined ? legacyDrug++ : v2Drug++);
        if (e.evidence_type === 'clinical') (j.n_drugs_in_disease_trials === undefined ? legacyClin++ : v2Clin++);
      }
      const uniqueGenes = new Set((scores as any[]).map(r => String(r.gene_symbol).toUpperCase()));
      const duplicates = scores.length - uniqueGenes.size;
      // Show coverage in PIPELINE order (identity → biology → tractability → clinical → context),
      // not by count — the fullest axis floating to the top is the least informative thing to see.
      const AXIS_ORDER = ['annotation', 'mutation', 'expression_tvn', 'dependency', 'safety', 'tissue', 'druggability', 'clinical', 'literature_epmc', 'literature', 'patents'];
      const axes = Object.entries(byAxis)
        .map(([axis, set]) => ({ axis, genes: set.size, pct: uniqueGenes.size ? set.size / uniqueGenes.size : 0 }))
        .sort((a, b) => {
          const ai = AXIS_ORDER.indexOf(a.axis), bi = AXIS_ORDER.indexOf(b.axis);
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        });

      // GENUINE problems only — things that make the data wrong or misleading. A clean fresh
      // snapshot should surface ZERO of these (no duplicates, no legacy, nothing missing).
      const warnings: string[] = [];
      if (duplicates > 0) warnings.push(`${duplicates.toLocaleString()} duplicate gene rows in RANKING_SCORES (${uniqueGenes.size.toLocaleString()} unique of ${scores.length.toLocaleString()}) — re-harvest or run scripts/dedupe_ranking_scores.sql.`);
      if (legacyDrug > 0) warnings.push(`${legacyDrug.toLocaleString()} druggability rows are pre-fix (ChEMBL bioactivity counts, not developed drugs) — re-enrich this axis.`);
      if (legacyClin > 0) warnings.push(`${legacyClin.toLocaleString()} clinical rows are pre-fix (ClinicalTrials.gov free-text, not gene-attributed) — re-enrich this axis.`);
      for (const a of ['expression_tvn', 'dependency', 'safety', 'mutation', 'druggability', 'clinical', 'literature_epmc'])
        if (!byAxis[a]) warnings.push(`Axis "${a}" has no rows at all — never harvested for this snapshot.`);

      // NOTES are informational, NOT problems — low-confidence flags are expected and routine
      // (an expression value at the pseudocount floor, or velocity on very few papers). Kept
      // separate so they never inflate the "data issues" count or read as an alarm.
      const notes: string[] = [];
      if (lowConf > 0) notes.push(`${lowConf.toLocaleString()} values are flagged low-confidence (routine — expression at the pseudocount floor, or literature velocity on <5 papers). Their axes are down-weighted, not wrong.`);

      res.json({
        snapshot: {
          id, version: meta.version, disease_id: meta.disease_id, disease_name: meta.disease_name,
          created_at: meta.created_at, label: meta.label,
          rows: scores.length, unique_genes: uniqueGenes.size, duplicates,
          evidence_rows: evidence.length,
        },
        axes,
        schema: { druggability: { legacy: legacyDrug, v2: v2Drug }, clinical: { legacy: legacyClin, v2: v2Clin } },
        warnings,
        notes,
      });
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  app.get("/api/dashboard/dossier", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const id = Number(req.query.snapshotId);
      const gene = String(req.query.gene || '').toUpperCase().trim();
      if (!Number.isFinite(id) || !gene) return res.status(400).json({ error: "snapshotId and gene required" });
      const { meta, scores, evidence } = await loadSnapshotCached(id);
      if (!meta) return res.status(404).json({ error: `Snapshot #${id} not found` });
      const scoreRow = (scores as any[]).find(r => String(r.gene_symbol).toUpperCase() === gene) || null;
      const ev = (evidence as any[]).filter(e => String(e.gene_symbol).toUpperCase() === gene);
      if (!scoreRow && !ev.length) return res.status(404).json({ error: `${gene} is not in snapshot #${id}` });
      const { buildGeneDossier } = await import('./dossierService.js');
      const { fetchPatents } = await import('./evidenceProviders.js');
      // Patents are not harvested into a snapshot yet — fetched live (annotation only).
      const patents = await fetchPatents(gene, meta.disease_name || '').catch(() => null);
      res.json(buildGeneDossier({
        gene_symbol: gene, disease_id: meta.disease_id, disease_name: meta.disease_name,
        snapshot_id: id, scoreRow, evidence: ev, patents,
      }));
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // Ranked list backing the dashboard grid (headline counters per gene, no live calls).
  app.get("/api/dashboard/genes", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const id = Number(req.query.snapshotId);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "snapshotId required" });
      // The dashboard pulls the whole (deduped) gene set once and then filters/sorts
      // client-side, so interaction is instant instead of a round-trip per keystroke.
      const limit = Math.min(20000, Math.max(1, Number(req.query.limit) || 100));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const q = String(req.query.q || '').toUpperCase().trim();
      // Progressive: return whatever complete axes have landed and say how far along we
      // are, so the board can render at ~5s instead of waiting ~26s for the whole set.
      if (req.query.progressive === '1') {
        const st = startProgressive(id);
        if (st.error) return res.status(502).json({ error: st.error });
        const usable = completeAxisRows(st.evidence, st.done);
        if (st.derivedFor !== usable.length) { st.derived = deriveRows(st.scores, usable); st.derivedFor = usable.length; }
        const axes = [...new Set(usable.map((e: any) => e.evidence_type))];
        const filtered = q ? st.derived.filter((r: any) => String(r.gene_symbol).toUpperCase().includes(q)) : st.derived;
        return res.json({
          total: filtered.length,
          rows: filtered.slice(offset, offset + limit),
          progressive: { complete: st.done, evidenceLoaded: st.loaded, axesReady: axes, scoresReady: st.scores.length > 0 },
        });
      }

      const snapEntry = await loadSnapshotCached(id);
      if (!snapEntry.meta) return res.status(404).json({ error: `Snapshot #${id} not found` });

      const all = dashboardRows(id, snapEntry);
      const rowsAll = q ? all.filter((r: any) => String(r.gene_symbol).toUpperCase().includes(q)) : all;
      res.json({ total: rowsAll.length, rows: rowsAll.slice(offset, offset + limit) });
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // Save paper-derived evidence cards to Oracle (EVIDENCE table)
  app.post("/api/evidence", requireUser, express.json({ limit: "12mb" }), async (req, res) => {
    if (!oracleStoreEnabled()) return res.status(503).json({ ok: false, error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
      const r = await svc.saveEvidenceCards(req.body?.cards || [], (req as any).appUser?.id);
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // Gene symbols that have stored evidence (for the EVIDENCE badge)
  app.get("/api/evidence/genes", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await readSvc();
      res.json(await svc.evidenceGeneSymbols(req.query.diseaseId as string | undefined));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Evidence rows for one gene (for the Stored Evidence panel)
  app.get("/api/evidence", requireUser, async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await readSvc();
      res.json(await svc.evidenceForGene(req.query.gene as string));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Harvest → snapshot + per-gene scores + per-source evidence
  app.post("/api/harvest", requireUser, express.json({ limit: "25mb" }), async (req, res) => {
    if (!oracleStoreEnabled()) return res.status(503).json({ ok: false, error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
      const r = await svc.saveHarvest({ ...req.body, created_by: (req as any).appUser?.id ?? null });
      res.json({ ok: true, ...r });
    } catch (e: any) {
      console.error("[/api/harvest] FAILED:", e);
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // ── External API Proxy ───────────────────────────────────────────────────────

  const ALLOWED_PROXY_HOSTS = [
    'clinicaltrials.gov',
    'www.ebi.ac.uk',
    'eutils.ncbi.nlm.nih.gov',
    'www.proteinatlas.org',
    'www.cbioportal.org',
  ];

  // Pocket STRUCTURAL drill-down (descriptive evidence only — NOT a scoring axis).
  // Detects pockets on the target's best structure (experimental PDB → AlphaFold →
  // none) and returns per-pocket DoGSite3 descriptors. Public API only (no Oracle),
  // so it works locally and on Vercel; on-demand ~30-60s round-trip (cached by
  // proteins.plus and by structure id here). No druggability score is emitted.
  app.get("/api/druggability/pockets", async (req, res) => {
    const gene = String(req.query.gene || '').trim().toUpperCase();
    const uniprot = req.query.uniprot ? String(req.query.uniprot) : undefined;
    if (!gene) return res.status(400).json({ error: "Missing gene param" });
    try {
      res.json(await getPocketStructure(gene, uniprot));
    } catch (e: any) {
      res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
    }
  });

  // Modality-aware druggability — "which modality can drug it?" Returns developed drugs
  // BY MODALITY (fact) and per-modality tractability (prediction) as SEPARATE fields.
  // Public OT API only (works on Vercel). Descriptive/scored — the funnel must not gate
  // on developed-drug maturity (novel targets have none), so this is on-demand evidence.
  app.get("/api/druggability/modality", async (req, res) => {
    const gene = String(req.query.gene || '').trim().toUpperCase();
    if (!gene) return res.status(400).json({ error: "Missing gene param" });
    try {
      res.json(await getModalityProfile(gene));
    } catch (e: any) {
      res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
    }
  });

  // On-demand per-tier evidence for a gene NOT in a snapshot (paper/CSV/manual candidate).
  // Fetches each funnel tier live from the same public sources the harvest uses, so an
  // added gene ranks in the funnel immediately. Public-API only (works on Vercel).
  app.get("/api/enrich-gene", async (req, res) => {
    const gene = String(req.query.gene || '').trim();
    if (!gene) return res.status(400).json({ error: "Missing gene param" });
    try {
      res.json(await enrichGene(gene, String(req.query.diseaseId || ''), String(req.query.diseaseName || '')));
    } catch (e: any) {
      res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
    }
  });
  app.post("/api/enrich-genes", express.json({ limit: "1mb" }), async (req, res) => {
    const { genes, diseaseId, diseaseName } = req.body || {};
    if (!Array.isArray(genes) || !genes.length) return res.status(400).json({ error: "Missing genes[]" });
    try {
      res.json(await enrichGenes(genes.slice(0, 100).map(String), String(diseaseId || ''), String(diseaseName || '')));
    } catch (e: any) {
      res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
    }
  });

  // Paper → genes: Gemini reads an uploaded PDF (natively) or pasted text and returns the
  // human gene SYMBOLS the paper discusses as disease-relevant. These flow into the funnel's
  // "add candidates" → on-demand enrichment. Needs GEMINI_API_KEY on the server.
  app.post("/api/paper/extract-genes", express.json({ limit: "25mb" }), async (req, res) => {
    const { pdfBase64, text, disease } = req.body || {};
    if (!pdfBase64 && !text) return res.status(400).json({ error: "Provide pdfBase64 or text" });
    const prompt =
      `Extract the official human gene SYMBOLS (HGNC) this biomedical paper` +
      (disease ? ` about ${disease}` : '') +
      ` discusses as disease-relevant — genes it studies, reports mutated / differentially expressed / ` +
      `dependent, or proposes as drug targets. Exclude generic terms, cell lines, drug names, assays, and ` +
      `non-gene acronyms. Use the approved symbol (e.g. ERBB2 not HER2). Respond as JSON: {"genes":["KRAS","TP53"]}.`;
    const parts: any[] = [{ text: prompt }];
    if (pdfBase64) parts.push({ inlineData: { mimeType: 'application/pdf', data: String(pdfBase64) } });
    else parts.push({ text: `\n\nPAPER TEXT:\n${String(text).slice(0, 120000)}` });
    try {
      const out = await geminiGenerate([{ role: 'user', parts }], GEMINI_MODEL, 'application/json');
      let parsed: any; try { parsed = JSON.parse(out); } catch { parsed = null; }
      const raw: any[] = Array.isArray(parsed?.genes) ? parsed.genes : [];
      const genes = [...new Set(raw.map(g => String(g).trim().toUpperCase())
        .filter(g => /^[A-Z][A-Z0-9\-]{0,14}$/.test(g)))];   // basic HGNC-symbol shape
      res.json({ genes, count: genes.length });
    } catch (e: any) {
      res.status(502).json({ error: String(e?.message || e).slice(0, 300) });
    }
  });

  app.get("/api/proxy", async (req, res) => {
    const target = req.query.url as string;
    if (!target) return res.status(400).json({ error: "Missing url param" });
    let parsed: URL;
    try { parsed = new URL(target); } catch { return res.status(400).json({ error: "Invalid url" }); }
    if (!ALLOWED_PROXY_HOSTS.some(h => parsed.hostname === h)) {
      return res.status(403).json({ error: "Host not allowed" });
    }
    const key = cacheKey('proxy', target);
    const cached = await readApiCache(key);
    if (cached) {
      res.status(cached.status).set('Content-Type', cached.contentType || 'application/json');
      if (typeof cached.body === 'string') return res.send(cached.body);
      return res.send(JSON.stringify(cached.body));
    }
    try {
      const upstreamUrl = new URL(parsed.toString());
      const isNcbi = upstreamUrl.hostname === 'eutils.ncbi.nlm.nih.gov';
      if (isNcbi && process.env.NCBI_API_KEY && !upstreamUrl.searchParams.has('api_key')) {
        upstreamUrl.searchParams.set('api_key', process.env.NCBI_API_KEY);
      }

      let upstream: Response | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (isNcbi) await waitForNcbiSlot();
        upstream = await fetch(upstreamUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'DiseaseToTarget/2.0 (nkurmach@uab.edu)',
          }
        });
        const retryable = upstream.status === 429 || upstream.status >= 500;
        if (!retryable || attempt === 4) break;
        await upstream.arrayBuffer();
        const retryAfter = Number(upstream.headers.get('Retry-After'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : (upstream.status === 429 ? 1000 : 500) * 2 ** attempt;
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
      if (!upstream) throw new Error('External API request did not start');
      const text = await upstream.text();
      const contentType = upstream.headers.get('Content-Type') || 'application/json';
      await writeApiCache(key, { status: upstream.status, body: text, contentType });
      res.status(upstream.status).set('Content-Type', contentType).send(text);
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post("/api/ot-graphql", async (req, res) => {
    const { query, variables } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });
    const key = cacheKey('ot-graphql', JSON.stringify({ query, variables }));
    const cached = await readApiCache(key);
    if (cached) return res.status(cached.status).json(cached.body);
    try {
      const upstream = await fetch('https://api.platform.opentargets.org/api/v4/graphql', {
        method: 'POST',
        // OT 403s requests with no User-Agent (Node's fetch sends none) — see modalityService.ts.
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Disease2Target/1.0 (academic research; contact via app)' },
        body: JSON.stringify({ query, variables }),
      });
      const data = await upstream.json();
      await writeApiCache(key, { status: upstream.status, body: data, contentType: 'application/json' });
      res.status(upstream.status).json(data);
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── gnomAD constraint (safety axis) — live GraphQL proxy, same pattern as ot-graphql ──
  // ADDITIVE: powers the Constraint drill-down (pLI / LOEUF). Cached server-side.
  app.post("/api/gnomad-graphql", async (req, res) => {
    const { query, variables } = req.body || {};
    if (!query) return res.status(400).json({ error: "Missing query" });
    const key = cacheKey('gnomad-graphql', JSON.stringify({ query, variables }));
    const cached = await readApiCache(key);
    if (cached) return res.status(cached.status).json(cached.body);
    try {
      const upstream = await fetch('https://gnomad.broadinstitute.org/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const data = await upstream.json();
      await writeApiCache(key, { status: upstream.status, body: data, contentType: 'application/json' });
      res.status(upstream.status).json(data);
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── Preloaded reference compendia (DepMap dependency, tumor-vs-normal expression) ──
  // ADDITIVE: these are bulk datasets with no reliable per-gene live API, so they
  // are built once by the scripts in /scripts and served from /data as gene-keyed
  // JSON. Lazily read + cached in memory. Missing file → 503 {notLoaded:true} so
  // the drill-down panels degrade gracefully ("reference data not loaded yet").
  const refCache = new Map<string, any>();
  const loadRef = (file: string): any => {
    if (refCache.has(file)) return refCache.get(file);
    let parsed: any = null;
    try { parsed = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', file), 'utf-8')); } catch { parsed = null; }
    refCache.set(file, parsed);
    return parsed;
  };
  const serveRef = (file: string, label: string) => (req: express.Request, res: express.Response) => {
    const gene = String(req.query.gene || '').toUpperCase().trim();
    if (!gene) return res.status(400).json({ error: "Missing gene param" });
    const ref = loadRef(file);
    if (!ref) return res.status(503).json({ error: `${label} reference data not loaded`, notLoaded: true });
    res.json({ gene, meta: ref.meta ?? null, data: ref.genes?.[gene] ?? null });
  };
  app.get("/api/depmap", serveRef('depmap_pancreatic.json', 'DepMap'));
  app.get("/api/expression", serveRef('expression_paad.json', 'Expression'));
  app.get("/api/gnomad", serveRef('gnomad_constraint.json', 'gnomAD'));

  // ── Cell-type resolution (HPA single-cell) ──────────────────────────────────
  // Not a serveRef reference table: HPA has no reachable bulk single-cell file and its API
  // answers one gene per call, so this is a cached live lookup instead. Same public-data
  // posture as the other reference endpoints, so no auth.
  app.get("/api/singlecell", async (req, res) => {
    const gene = String(req.query.gene || '').toUpperCase().trim();
    if (!gene) return res.status(400).json({ error: "Missing gene param" });
    try {
      const { getSingleCellProfile } = await import('./singleCellService.js');
      const profile = await getSingleCellProfile(gene);
      if (!profile.resolved) return res.status(404).json({ error: `No HPA single-cell data for "${gene}"`, notLoaded: true });
      res.json(profile);
    } catch (e: any) {
      res.status(502).json({ error: e?.message || 'single-cell lookup failed' });
    }
  });

  // ── Live per-gene clinical / literature (same providers the harvest stores) ──
  // Power the gene-drawer Clinical & Literature panels so the drill-down shows the
  // SAME numbers the funnel filters on (the funnel reads these from stored Oracle
  // evidence; here we compute them live for any gene on demand). Cached server-side.
  app.get("/api/clinical", async (req, res) => {
    const gene = String(req.query.gene || '').toUpperCase().trim();
    const disease = String(req.query.disease || '').trim();
    if (!gene || !disease) return res.status(400).json({ error: "gene and disease required" });
    // Namespace is versioned so a scoping change invalidates stale entries:
    //   _ot  — axis moved from ClinicalTrials.gov free-text to the Open Targets trial graph (#3)
    //   _ot2 — disease scope fixed: resolve name->ontology id + multi-token hints (a single
    //          first-word hint made "exocrine pancreatic carcinoma" miss trials tagged
    //          "pancreatic adenocarcinoma", silently undercounting SRC 5 -> 4).
    //   _ot3 — per-trial records enriched from ClinicalTrials.gov (year, sponsor, sites)
    const key = cacheKey('clinical_ot3', `${gene}::${disease}`);
    const cached = await readApiCache(key); if (cached) return res.json(cached.body);
    try {
      const { fetchClinical, resolveDiseaseScope } = await import('./evidenceProviders.js');
      // #3: clinical is now disease-SCOPED via the OT trial graph — resolve the ontology
      // scope first (diseaseId optional; the name hint alone still scopes correctly).
      const scope = await resolveDiseaseScope(String(req.query.diseaseId || ''), disease);
      const data = await fetchClinical(gene, scope);
      await writeApiCache(key, { status: 200, body: { gene, data }, contentType: 'application/json' });
      res.json({ gene, data });
    } catch (e: any) { res.status(502).json({ error: e?.message || 'clinical fetch failed' }); }
  });
  // Network axis (WINNER + RWR) — read from the STORED evidence (it is a batch-computed axis,
  // not a cheap live call). Resolves the disease's latest snapshot and returns that gene's row.
  app.get("/api/network", async (req, res) => {
    const gene = String(req.query.gene || '').toUpperCase().trim();
    const disease = String(req.query.disease || '').trim();
    if (!gene || !disease) return res.status(400).json({ error: "gene and disease required" });
    if (!readStoreEnabled()) return res.json({ gene, data: null });
    try {
      const svc = await readSvc();
      const snaps = await svc.listSnapshots();
      const dq = disease.toLowerCase();
      const snap = (snaps as any[])
        .filter(s => { const n = String(s.disease_name || '').toLowerCase(); return n.includes(dq) || dq.includes(n); })
        .sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!snap) return res.json({ gene, data: null });
      const rows = await svc.evidenceForGene(gene);
      const net = (rows as any[]).find(r => Number(r.snapshot_id) === Number(snap.id) && r.evidence_type === 'network');
      const vj = net ? (typeof net.value_json === 'string' ? JSON.parse(net.value_json) : net.value_json) : null;
      res.json({ gene, snapshot_id: snap.id, data: vj });
    } catch (e: any) { res.status(502).json({ error: e?.message || 'network fetch failed' }); }
  });
  // ── Knowledge Graph (KG_NODES / KG_EDGES, projected by `d2t.ts kg <id>`) ──────
  // The unified, queryable graph: genes/diseases/drugs/trials/pathways/tissues/papers/
  // variants as nodes, the evidence relationships (incl. persisted STRING PPI) as edges.
  // Reads through readSvc(), so the graph works over ORDS (no VPN) as well as Oracle —
  // ordsService.kgGraph/kgStats mirror the Oracle ones (needs docs/sql/kg_ords_module.sql
  // run once). The comment here used to say the KG tables were Oracle-only; they are not.
  // Resolve ?snapshot=<id> directly, or ?disease=<name> → that disease's newest snapshot.
  async function resolveKgSnapshot(svc: any, snapshotQ: string, diseaseQ: string): Promise<any | null> {
    const snaps: any[] = await svc.listSnapshots();
    const sorted = [...snaps].sort((a, b) => Number(b.id) - Number(a.id));
    if (snapshotQ && /^\d+$/.test(snapshotQ)) return sorted.find(s => Number(s.id) === Number(snapshotQ)) || null;
    if (diseaseQ) {
      const dq = diseaseQ.toLowerCase();
      return sorted.find(s => { const n = String(s.disease_name || '').toLowerCase(); return n.includes(dq) || dq.includes(n); }) || null;
    }
    return sorted[0] || null;   // default: newest snapshot
  }
  app.get("/api/graph/stats", async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await readSvc();
      const snap = await resolveKgSnapshot(svc, String(req.query.snapshot || ''), String(req.query.disease || ''));
      if (!snap) return res.status(404).json({ error: "no snapshot found" });
      const stats = await svc.kgStats(Number(snap.id));
      res.json({ snapshot_id: snap.id, disease_name: snap.disease_name, disease_id: snap.disease_id, ...stats });
    } catch (e: any) { res.status(502).json({ error: e?.message || 'kg stats failed' }); }
  });
  app.get("/api/graph", async (req, res) => {
    if (!readStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await readSvc();
      const snap = await resolveKgSnapshot(svc, String(req.query.snapshot || ''), String(req.query.disease || ''));
      if (!snap) return res.status(404).json({ error: "no snapshot found" });
      const [{ nodes, edges }, stats] = await Promise.all([svc.kgGraph(Number(snap.id)), svc.kgStats(Number(snap.id))]);
      res.json({ snapshot_id: snap.id, disease_name: snap.disease_name, disease_id: snap.disease_id, stats, nodes, edges });
    } catch (e: any) { res.status(502).json({ error: e?.message || 'kg fetch failed' }); }
  });
  // Live STRING network neighbours for ONE gene — powers the Ranking Board's "better
  // neighbours" recommender (the RWR/Amazon "you may also like"). One STRING call, no store.
  app.get("/api/graph/neighbors", async (req, res) => {
    const gene = String(req.query.gene || '').toUpperCase().trim();
    if (!gene) return res.status(400).json({ error: "gene required" });
    try {
      const minScore = Number(process.env.STRING_MIN_SCORE) || 400;
      const url = `https://string-db.org/api/json/interaction_partners?identifiers=${encodeURIComponent(gene)}&species=9606&required_score=${minScore}&limit=60&caller_identity=diseasetotarget_app`;
      const r = await fetch(url);
      if (!r.ok) return res.json({ gene, neighbors: [] });
      const rows: any[] = await r.json().catch(() => []);
      const neighbors = (Array.isArray(rows) ? rows : [])
        .map(x => ({ symbol: String(x.preferredName_B || '').toUpperCase(), score: Number(x.score) || 0 }))
        .filter(n => n.symbol && n.symbol !== gene);
      res.json({ gene, neighbors });
    } catch (e: any) { res.status(502).json({ error: e?.message || 'neighbors fetch failed' }); }
  });
  // Proteomics axis — CPTAC tumor-vs-normal protein log2FC. Disease-aware reference file
  // (built like expression: build_proteomics.py <cohort> → data/proteomics_<cohort>.json).
  app.get("/api/proteomics", async (req, res) => {
    const gene = String(req.query.gene || '').toUpperCase().trim();
    const disease = String(req.query.disease || '').trim();
    if (!gene || !disease) return res.status(400).json({ error: "gene and disease required" });
    const { resolveCohort } = await import('./diseaseRegistry.js');
    const ref = resolveCohort(disease, String(req.query.diseaseId || ''))?.proteomics;
    if (!ref) return res.json({ gene, data: null });   // no CPTAC cohort for this disease
    const table = loadRef(ref.ref_file);
    if (!table) return res.status(503).json({ gene, error: 'Proteomics reference not built yet', notLoaded: true });
    res.json({ gene, meta: table.meta ?? null, scale: ref.log2fc_scale ?? 3, data: table.genes?.[gene] ?? null });
  });
  // ── Research agent — a multi-step evidence-reasoning loop over the read store ──
  // The co-pilot's single-shot chat can filter the loaded list; this lets the model PLAN and
  // call evidence tools across several steps, then synthesise. Same Gemini setup as
  // /api/ai/gemini-chat, but the tool loop runs server-side against Oracle/ORDS.
  async function agentSnapshot(disease?: string, snapshotId?: number) {
    const svc = await readSvc();
    const snaps: any[] = await svc.listSnapshots();
    const sorted = [...snaps].sort((a, b) => Number(b.id) - Number(a.id));
    if (snapshotId) return sorted.find(s => Number(s.id) === Number(snapshotId)) || sorted[0];
    const dq = String(disease || '').toLowerCase().trim();
    if (!dq) return sorted[0];
    return sorted.find(s => { const n = String(s.disease_name || '').toLowerCase(); return n.includes(dq) || dq.includes(n); }) || sorted[0];
  }
  const AGENT_TOOLS = [
    { name: 'list_diseases', description: 'List the diseases loaded in the platform (name, snapshot id, gene count). Call first if unsure which disease is available.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'rank_targets', description: 'Top targets for a disease by the Open Targets overall association (the candidate-selection order, NOT the board composite) with component scores.', parameters: { type: 'OBJECT', properties: { disease: { type: 'STRING' }, top_n: { type: 'NUMBER' } } } },
    { name: 'get_gene_evidence', description: 'All stored evidence for ONE gene in the current disease snapshot, one summary line per axis: mutation, expression, proteomics, dependency, safety, tissue, druggability, clinical, literature, network, annotation — plus its board standing.', parameters: { type: 'OBJECT', properties: { gene: { type: 'STRING' }, disease: { type: 'STRING' } }, required: ['gene'] } },
    { name: 'get_clinical_trials', description: 'Per-trial clinical records for a gene: NCT id, phase, status, year, sponsor, why-stopped.', parameters: { type: 'OBJECT', properties: { gene: { type: 'STRING' }, disease: { type: 'STRING' } }, required: ['gene'] } },
    { name: 'find_novel_tractable', description: 'Druggable targets with NO developed drug and NO disease trial yet — the discovery query.', parameters: { type: 'OBJECT', properties: { disease: { type: 'STRING' }, limit: { type: 'NUMBER' } } } },
    { name: 'compare_genes', description: 'Side-by-side comparison of 2–4 genes in the current disease: board rank and score (leader = 100), every criterion score with its weight, and each stored evidence axis with its source. Use for "compare X vs Y" and "why is X ranked above Y".', parameters: { type: 'OBJECT', properties: { genes: { type: 'ARRAY', items: { type: 'STRING' } }, disease: { type: 'STRING' } }, required: ['genes'] } },
    { name: 'gene_relationship', description: 'How two genes relate in the current disease: direct STRING interaction and its score, shared interaction partners, both genes\' board standing, and papers that mention both together with the disease (Europe PMC). Use for "how is A related to B".', parameters: { type: 'OBJECT', properties: { gene_a: { type: 'STRING' }, gene_b: { type: 'STRING' }, disease: { type: 'STRING' } }, required: ['gene_a', 'gene_b'] } },
    { name: 'deep_dive_gene', description: 'LIVE deep dive for ONE gene — the same detail the app\'s target card shows: cohort-aware expression and protein change, dependency, constraint, tissue, per-trial records, latest papers, network centrality with context, STRING neighbours, single-cell, modality fit. Slower (3–8 s) and NOT part of the ranking. Use only for the one or two genes the question names, after get_gene_evidence.', parameters: { type: 'OBJECT', properties: { gene: { type: 'STRING' }, disease: { type: 'STRING' } }, required: ['gene'] } },
  ];
  const jparse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };

  // The board, computed server-side with the SAME engine the UI uses (rankingBoard.ts over
  // boardRows.ts), so "board rank" in an answer is the rank on screen. One entry cached; it
  // is invalidated by the snapshot entry's timestamp.
  const agentBoardCache = new Map<string, { board: any; rows: any[]; bySymbol: Map<string, any>; total: number }>();
  async function agentBoard(snapId: number, modality?: string, litWindow?: string) {
    const entry = await loadSnapshotCached(snapId);
    const m = (modality && (MODALITY_PROFILES as any)[modality]) ? modality : 'small_molecule';
    const lw = litWindow === 'recent3y' ? 'recent3y' : 'all';
    const key = `${snapId}:${m}:${lw}:${entry.at}`;
    const hit = agentBoardCache.get(key); if (hit) return hit;
    const rows = dashboardRows(snapId, entry);
    const board = buildBoard(rows, m as any, undefined, { litWindow: lw });
    const bySymbol = new Map<string, any>(board.scored.map((s: any) => [String(s.symbol).toUpperCase(), s]));
    const val = { board, rows, bySymbol, total: board.scored.length };
    agentBoardCache.clear(); agentBoardCache.set(key, val);
    return val;
  }
  const standingOf = (b: { board: any; bySymbol: Map<string, any>; total: number }, gene: string) => {
    const s = b.bySymbol.get(gene); if (!s) return null;
    return {
      board_rank: s.boardRank, of: b.total, score_leader_100: +Number(s.display).toFixed(1), open_targets_rank: s.sourceRank ?? null, gated: !!s.gated,
      criteria_0_100: Object.fromEntries(Object.entries(s.criteria).map(([k, v]) => [k, v == null ? null : Math.round(Number(v) * 100)])),
      weights_pct: Object.fromEntries(Object.entries(b.board.weights).filter(([, w]) => Number(w) > 0).map(([k, w]) => [k, Math.round(Number(w) * 100)])),
    };
  };
  // One summary line per axis, with its source, from the stored snapshot rows.
  const evidenceOf = async (svc: any, snapId: number, gene: string) => {
    const rows = (await svc.evidenceForGene(gene)).filter((r: any) => Number(r.snapshot_id) === Number(snapId));
    const evidence: Record<string, any> = {}, sources: Record<string, string> = {};
    for (const r of rows) { const j = jparse(r.value_json); evidence[r.evidence_type] = (j && (j.display || j.value_text)) || r.value_text || j; if (r.source) sources[r.evidence_type] = String(r.source); }
    return { found: rows.length > 0, evidence, sources };
  };
  const stringPartners = async (gene: string, limit = 100): Promise<Array<{ symbol: string; score: number }>> => {
    try {
      const r = await fetch(`https://string-db.org/api/json/interaction_partners?identifiers=${encodeURIComponent(gene)}&species=9606&required_score=400&limit=${limit}&caller_identity=diseasetotarget_app`);
      if (!r.ok) return [];
      const rows: any[] = await r.json().catch(() => []);
      return (Array.isArray(rows) ? rows : []).map(x => ({ symbol: String(x.preferredName_B || '').toUpperCase(), score: Number(x.score) || 0 })).filter(n => n.symbol && n.symbol !== gene);
    } catch { return []; }
  };
  const fetchJsonTimeout = async (url: string, ms: number): Promise<any> => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) return { error: `HTTP ${r.status}` }; return await r.json(); }
    catch (e: any) { return { error: String(e?.name === 'AbortError' ? 'timeout' : e?.message || e) }; }
    finally { clearTimeout(t); }
  };
  const trimJson = (v: any, max = 2500): any => { const s = JSON.stringify(v ?? null); return s.length <= max ? v : { truncated: true, preview: s.slice(0, max) }; };
  // Ontology labels are not the phrase papers use. Europe PMC has 2 records for
  // "exocrine pancreatic carcinoma", 233 for its exact synonym "pancreatic carcinoma" and
  // 2,247 for the broader "pancreatic cancer" — so searching the label alone makes a
  // well-studied gene pair look unstudied. The co-mention query therefore searches the
  // label OR its Open Targets EXACT synonyms, and reports the broad-synonym count
  // separately rather than folding a superset of the disease into one number.
  const diseaseTermsCache = new Map<string, { exact: string[]; broad: string[] }>();
  async function diseaseSearchTerms(diseaseId: string, label: string): Promise<{ exact: string[]; broad: string[] }> {
    const key = `${diseaseId}|${label}`;
    const hit = diseaseTermsCache.get(key); if (hit) return hit;
    const exact: string[] = [], broad: string[] = [];
    try {
      const d = await otFetch(`query($id:String!){ disease(efoId:$id){ synonyms{ relation terms } } }`, { id: diseaseId });
      for (const s of d?.disease?.synonyms || []) {
        if (s.relation === 'hasExactSynonym') exact.push(...(s.terms || []));
        else if (s.relation === 'hasBroadSynonym') broad.push(...(s.terms || []));
      }
    } catch { /* no synonyms reachable — the label alone still works */ }
    const norm = (a: string[]) => [...new Set(a.map(t => String(t || '').trim()).filter(t => t.length > 3))].slice(0, 8);
    const val = { exact: norm([label, ...exact]), broad: norm(broad) };
    diseaseTermsCache.set(key, val);
    return val;
  }
  const orPhrases = (terms: string[]) => terms.map(t => `"${t}"`).join(' OR ');
  // Users say "FAK", the store says PTK2. Resolve an alias to the symbol the snapshot uses
  // (STRING's preferred name is HGNC for human), so board lookups, evidence lookups and
  // edge matching all use one name. Returns the input unchanged when it is already known.
  const aliasCache = new Map<string, string>();
  const resolveGeneSymbol = async (sym: string, known?: Map<string, any>): Promise<{ symbol: string; alias_of?: string }> => {
    const s = String(sym || '').toUpperCase().trim();
    if (!s) return { symbol: s };
    if (known?.has(s)) return { symbol: s };
    const hit = aliasCache.get(s); if (hit) return hit === s ? { symbol: s } : { symbol: hit, alias_of: s };
    try {
      const r = await fetch(`https://string-db.org/api/json/get_string_ids?identifiers=${encodeURIComponent(s)}&species=9606&limit=1&caller_identity=diseasetotarget_app`);
      const rows: any[] = r.ok ? await r.json().catch(() => []) : [];
      const pref = String(rows?.[0]?.preferredName || '').toUpperCase();
      const resolved = pref && (!known || known.has(pref)) ? pref : s;
      aliasCache.set(s, resolved);
      return resolved === s ? { symbol: s } : { symbol: resolved, alias_of: s };
    } catch { return { symbol: s }; }
  };

  async function execAgentTool(name: string, args: any, ctx: { disease?: string; snapshotId?: number; modality?: string; litWindow?: string }): Promise<any> {
    const svc = await readSvc();
    const snap = await agentSnapshot(args?.disease || ctx.disease, ctx.snapshotId);
    if (!snap) return { error: 'no snapshot loaded' };
    const up = (v: any) => String(v || '').toUpperCase().trim();
    if (name === 'compare_genes') {
      const raw = Array.isArray(args?.genes) ? args.genes : String(args?.genes || '').split(/[,\s]+/);
      const genes = [...new Set(raw.map(up).filter(Boolean))].slice(0, 4) as string[];
      if (genes.length < 2) return { error: 'give at least two gene symbols' };
      const b = await agentBoard(Number(snap.id), ctx.modality, ctx.litWindow);
      const out: any = { disease: snap.disease_name, snapshot_id: snap.id, modality: ctx.modality || 'small_molecule', genes: {} };
      for (const g0 of genes) {
        const r = await resolveGeneSymbol(g0, b.bySymbol); const g = r.symbol;
        const ev = await evidenceOf(svc, Number(snap.id), g);
        out.genes[r.alias_of ? `${g} (HGNC symbol for ${r.alias_of})` : g] = { in_snapshot: b.bySymbol.has(g), board: standingOf(b, g), evidence: ev.evidence, evidence_sources: ev.sources };
      }
      out.how_to_read = 'board = the composite the Ranking Board shows (prediction). evidence = stored per-axis facts for this snapshot; cite each with its source and the snapshot id.';
      return out;
    }
    if (name === 'gene_relationship') {
      const b = await agentBoard(Number(snap.id), ctx.modality, ctx.litWindow);
      const ra = await resolveGeneSymbol(args?.gene_a, b.bySymbol), rb = await resolveGeneSymbol(args?.gene_b, b.bySymbol);
      const a = ra.symbol, bb = rb.symbol;
      if (!a || !bb) return { error: 'gene_a and gene_b are required' };
      const { epmcHits, epmcTopPapers } = await import('./evidenceProviders.js');
      // Co-mention query uses both the HGNC symbol and the alias the user typed (FAK OR PTK2),
      // and the disease label OR its exact synonyms (see diseaseSearchTerms).
      const term = (r: { symbol: string; alias_of?: string }) => (r.alias_of ? `(${r.symbol} OR ${r.alias_of})` : r.symbol);
      const dTerms = await diseaseSearchTerms(String(snap.disease_id || ''), String(snap.disease_name || ''));
      const coQuery = `${term(ra)} AND ${term(rb)} AND (${orPhrases(dTerms.exact)})`;
      const broadQuery = dTerms.broad.length ? `${term(ra)} AND ${term(rb)} AND (${orPhrases(dTerms.broad)})` : null;
      const [pair, pa, pb, coHits, broadHits, coPapers, evA, evB] = await Promise.all([
        fetch(`https://string-db.org/api/json/network?identifiers=${encodeURIComponent(a + '\r' + bb)}&species=9606&required_score=150&caller_identity=diseasetotarget_app`).then(r => (r.ok ? r.json() : [])).catch(() => []),
        stringPartners(a), stringPartners(bb),
        epmcHits(coQuery).catch(() => null),
        broadQuery ? epmcHits(broadQuery).catch(() => null) : Promise.resolve(null),
        epmcTopPapers(coQuery, 5).catch(() => []),
        evidenceOf(svc, Number(snap.id), a), evidenceOf(svc, Number(snap.id), bb),
      ]);
      // STRING returns PREFERRED names (PTK2 for FAK); match on the resolved pair, either order.
      const want = new Set([a, bb]);
      const edge = (Array.isArray(pair) ? pair : []).find((e: any) => want.has(up(e.preferredName_A)) && want.has(up(e.preferredName_B)) && up(e.preferredName_A) !== up(e.preferredName_B));
      const pbMap = new Map(pb.map(n => [n.symbol, n.score]));
      const shared = pa.filter(n => pbMap.has(n.symbol)).map(n => ({ symbol: n.symbol, score_with_a: n.score, score_with_b: pbMap.get(n.symbol) })).sort((x, y) => Math.min(y.score_with_a, y.score_with_b!) - Math.min(x.score_with_a, x.score_with_b!)).slice(0, 15);
      const sharedInSnap = shared.map(s => ({ ...s, board_rank: b.bySymbol.get(s.symbol)?.boardRank ?? null }));
      return {
        disease: snap.disease_name, snapshot_id: snap.id,
        genes: { a: ra.alias_of ? `${a} (HGNC symbol for ${ra.alias_of})` : a, b: rb.alias_of ? `${bb} (HGNC symbol for ${rb.alias_of})` : bb },
        direct_interaction: edge
          ? { string_combined_score: Number(edge.score), evidence_channels: { experimental: edge.escore, database: edge.dscore, textmining: edge.tscore, coexpression: edge.ascore }, source: 'STRING v12 (live)',
              interaction_type: Number(edge.escore) > 0 ? `physical interaction supported by experimental evidence (experimental channel ${edge.escore})` : 'FUNCTIONAL ASSOCIATION ONLY — curated pathway/complex membership and/or literature co-occurrence; STRING has NO experimental binding evidence for this pair. Do not call it a direct or physical interaction.',
              how_to_read: 'combined score 0–1; database = curated pathway/complex membership, textmining = co-occurrence in abstracts, experimental = physical-interaction assays, coexpression = correlated expression.' }
          : { string_combined_score: null, note: 'no STRING interaction at combined score >= 0.15 (live)' },
        shared_partners: { count: shared.length, top: sharedInSnap, source: 'STRING v12 interaction_partners (live), partners at score >= 0.4' },
        board: { [a]: standingOf(b, a), [bb]: standingOf(b, bb) },
        stored_evidence: { [a]: evA.evidence, [bb]: evB.evidence, sources: { [a]: evA.sources, [bb]: evB.sources }, note: `per-axis facts from snapshot #${snap.id} — dependency, mutation, expression, clinical are the lines that say what each gene IS in this disease` },
        co_mentions: {
          papers_mentioning_both_with_disease: coHits,
          disease_terms_searched: dTerms.exact,
          papers_under_broader_disease_terms: broadHits,
          broader_terms: dTerms.broad,
          top_papers: coPapers,
          source: 'Europe PMC (live)', query: coQuery,
          how_to_read: 'The main count searches the disease label OR its exact synonyms, because ontology labels are often not the phrase papers use. The broader count uses broad synonyms, which cover a superset of this disease — quote it as such, never as this disease alone.',
        },
        pathway_overlap: 'not computed (use the Knowledge Graph view for pathway co-membership)',
      };
    }
    if (name === 'deep_dive_gene') {
      const b = await agentBoard(Number(snap.id), ctx.modality, ctx.litWindow);
      const rg = await resolveGeneSymbol(args?.gene, b.bySymbol); const g = rg.symbol;
      if (!g) return { error: 'gene is required' };
      const dn = String(snap.disease_name || ''), did = String(snap.disease_id || '');
      const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
      const q = (p: string) => fetchJsonTimeout(`${base}${p}`, 12_000);
      const [stored, enrich, clinical, lit, net, nbrs, prot, modality, sc] = await Promise.all([
        evidenceOf(svc, Number(snap.id), g),
        q(`/api/enrich-gene?gene=${g}&diseaseId=${encodeURIComponent(did)}&diseaseName=${encodeURIComponent(dn)}`),
        q(`/api/clinical?gene=${g}&disease=${encodeURIComponent(dn)}&diseaseId=${encodeURIComponent(did)}`),
        q(`/api/literature?gene=${g}&disease=${encodeURIComponent(dn)}`),
        q(`/api/network?gene=${g}&disease=${encodeURIComponent(dn)}`),
        q(`/api/graph/neighbors?gene=${g}`),
        q(`/api/proteomics?gene=${g}&disease=${encodeURIComponent(dn)}&diseaseId=${encodeURIComponent(did)}`),
        q(`/api/druggability/modality?gene=${g}`),
        q(`/api/singlecell?gene=${g}`),
      ]);
      const trials = clinical?.data?.trials;
      return {
        gene: g, disease: dn, snapshot_id: snap.id,
        board: standingOf(b, g),
        stored_snapshot_evidence: stored.evidence, stored_sources: stored.sources,
        live: {
          note: 'Fetched live from the same providers the target card uses. Context only — NOT what the board ranks on. Dates and counts may differ from the snapshot.',
          expression_and_axes: trimJson(enrich, 3000),
          proteomics: trimJson(prot?.data ? { meta: prot.meta, scale: prot.scale, data: prot.data } : prot, 2000),
          clinical: trimJson(clinical?.data ? { ...clinical.data, trials: Array.isArray(trials) ? trials.slice(0, 10) : trials } : clinical, 3000),
          literature: trimJson(lit, 2500),
          network: trimJson(net?.data ?? net, 1200),
          string_neighbors_top15: Array.isArray(nbrs?.neighbors) ? nbrs.neighbors.slice(0, 15).map((n: any) => ({ ...n, board_rank: b.bySymbol.get(String(n.symbol).toUpperCase())?.boardRank ?? null })) : nbrs,
          modality_fit: trimJson(modality, 2000),
          single_cell: trimJson(sc, 1500),
        },
      };
    }
    if (name === 'list_diseases') {
      const snaps: any[] = await svc.listSnapshots();
      const byD = new Map<string, any>();
      for (const s of snaps) { const p = byD.get(s.disease_id); if (!p || Number(s.id) > Number(p.id)) byD.set(s.disease_id, s); }
      return { diseases: [...byD.values()].map(s => ({ disease: s.disease_name, snapshot_id: s.id, genes: s.gene_count })) };
    }
    if (name === 'rank_targets') {
      const { scores } = await loadSnapshotCached(Number(snap.id));
      const n = Math.max(1, Math.min(50, Number(args?.top_n) || 15));
      const top = [...(scores as any[])].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, n)
        .map(r => ({ gene: r.gene_symbol, rank: r.rank, ot_assoc: r.get_score ?? r.overall_score, genetic: r.genetic_score, expression: r.expression_score, target: r.target_score, literature: r.literature_score }));
      return { disease: snap.disease_name, snapshot_id: snap.id, targets: top };
    }
    if (name === 'get_gene_evidence') {
      let board: any = null, bySym: Map<string, any> | undefined;
      try { const b = await agentBoard(Number(snap.id), ctx.modality, ctx.litWindow); bySym = b.bySymbol; } catch { /* board optional */ }
      const rg = await resolveGeneSymbol(args?.gene, bySym); const gene = rg.symbol;
      const ev = await evidenceOf(svc, Number(snap.id), gene);
      try { if (bySym) board = standingOf({ board: (await agentBoard(Number(snap.id), ctx.modality, ctx.litWindow)).board, bySymbol: bySym, total: bySym.size }, gene); } catch { /* board optional */ }
      if (!ev.found && !board) return { gene, disease: snap.disease_name, snapshot_id: snap.id, evidence: null, note: 'no stored evidence for this gene in this snapshot' };
      return { gene, disease: snap.disease_name, snapshot_id: snap.id, board, evidence: ev.evidence, evidence_sources: ev.sources };
    }
    if (name === 'get_clinical_trials') {
      const gene = String(args?.gene || '').toUpperCase();
      const row = (await svc.evidenceForGene(gene)).find((r: any) => Number(r.snapshot_id) === Number(snap.id) && r.evidence_type === 'clinical');
      const cl = row ? jparse(row.value_json) : null;
      if (!cl) return { gene, trials: [], note: 'no clinical precedent in this disease (a neutral novelty signal)' };
      return { gene, n_drugs: cl.n_drugs_in_disease_trials, max_phase: cl.max_disease_trial_phase, trials: (cl.trials || []).slice(0, 15).map((t: any) => ({ nct: t.id, phase: t.phase, status: t.status, year: t.year, drug: t.drug, sponsor: t.sponsor, why_stopped: t.why_stopped })) };
    }
    if (name === 'find_novel_tractable') {
      const { scores, evidence } = await loadSnapshotCached(Number(snap.id));
      const drug = new Map<string, any>(), clin = new Map<string, any>();
      for (const r of evidence as any[]) { const g = String(r.gene_symbol).toUpperCase(); const j = jparse(r.value_json); if (r.evidence_type === 'druggability' && j) drug.set(g, j); else if (r.evidence_type === 'clinical' && j) clin.set(g, j); }
      const rankOf = new Map((scores as any[]).map(r => [String(r.gene_symbol).toUpperCase(), r.rank]));
      const hits: any[] = [];
      for (const [g, d] of drug) { const nD = d.total_compounds ?? 0, tract = d.tractable_modalities ?? 0; const c = clin.get(g); const nT = c ? (c.n_disease_trials ?? c.n_drugs_in_disease_trials ?? 0) : 0; if (nD === 0 && nT === 0 && tract > 0) hits.push({ gene: g, rank: rankOf.get(g) ?? null, tractable_modalities: tract }); }
      hits.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
      const lim = Math.max(1, Math.min(50, Number(args?.limit) || 25));
      return { disease: snap.disease_name, found: hits.length, targets: hits.slice(0, lim) };
    }
    return { error: `unknown tool ${name}` };
  }
  app.post("/api/ai/agent", async (req, res) => {
    const { question, disease, snapshotId } = req.body || {};
    if (!question) return res.status(400).json({ error: "question required" });
    const gkey = process.env.GEMINI_API_KEY;
    if (!gkey) return res.status(503).json({ error: "GEMINI_API_KEY not configured" });
    const screen: ScreenContext | undefined = req.body?.screen;
    const sys = [
      `You are the Disease2Target research agent. Answer research questions about disease targets by CALLING TOOLS to gather evidence — in as many steps as needed — then synthesising. Be concise; when the question is a comparison or a ranking, end with a short ranked answer.${disease ? `\nCurrent disease context: ${disease}.` : ''}`,
      renderScreenBlock(screen),
      EVIDENCE_RULES,
    ].filter(Boolean).join('\n\n');
    const contents: any[] = [{ role: 'user', parts: [{ text: String(question) }] }];
    const trace: any[] = [];
    try {
      let answer = '';
      for (let step = 0; step < 8; step++) {
        const body = { contents, systemInstruction: { parts: [{ text: sys }] }, tools: [{ functionDeclarations: AGENT_TOOLS }] };
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${gkey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d: any = await r.json().catch(() => ({}));
        if (!r.ok || d.error) return res.status(502).json({ error: `Gemini: ${d.error?.message || r.status}`, trace });
        const parts = d.candidates?.[0]?.content?.parts || [];
        const calls = parts.filter((pp: any) => pp.functionCall).map((pp: any) => pp.functionCall);
        const text = parts.find((pp: any) => pp.text)?.text?.trim();
        if (!calls.length) { answer = text || '(no answer produced)'; break; }
        contents.push({ role: 'model', parts });
        const respParts: any[] = [];
        for (const c of calls) {
          let result: any; try { result = await execAgentTool(c.name, c.args || {}, { disease: disease || screen?.disease?.name, snapshotId: snapshotId || screen?.snapshot?.id, modality: screen?.snapshot?.modality, litWindow: screen?.litWindow }); } catch (e: any) { result = { error: String(e?.message || e) }; }
          trace.push({ tool: c.name, args: c.args || {} });
          respParts.push({ functionResponse: { name: c.name, response: { result } } });
        }
        contents.push({ role: 'user', parts: respParts });
      }
      if (trace.length) console.log(`[agent] ${trace.map(t => `${t.tool}(${JSON.stringify(t.args)})`).join(' → ')}`);
      res.json({ answer: answer || '(stopped after max reasoning steps)', trace });
    } catch (e: any) { res.status(502).json({ error: e?.message || 'agent error', trace }); }
  });
  app.get("/api/literature", async (req, res) => {
    const gene = String(req.query.gene || '').toUpperCase().trim();
    const disease = String(req.query.disease || '').trim();
    if (!gene || !disease) return res.status(400).json({ error: "gene and disease required" });
    const key = cacheKey('literature', `${gene}::${disease}::both`);
    const cached = await readApiCache(key); if (cached) return res.json(cached.body);
    try {
      const { fetchLiterature, fetchPubmedLiterature } = await import('./evidenceProviders.js');
      const [pubmed, epmc] = await Promise.all([fetchPubmedLiterature(gene, disease), fetchLiterature(gene, disease)]);
      const body = { gene, pubmed, epmc };
      await writeApiCache(key, { status: 200, body, contentType: 'application/json' });
      res.json(body);
    } catch (e: any) { res.status(502).json({ error: e?.message || 'literature fetch failed' }); }
  });

  // ── Background Jobs ──────────────────────────────────────────────────────────
  // In-process job runner. POST /api/jobs creates a job that runs in the
  // background (one at a time); GET lists/inspects them. A harvest job pulls the
  // Open Targets associated-target universe for a disease (any disease, any gene
  // count) and stores it as an Oracle snapshot via oracleService. Jobs persist to
  // data/jobs.json so history survives restarts.
  type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  interface JobRec {
    id: string; type: string; disease_query: string; disease_id: string | null; disease_name: string | null;
    gene_count: number; status: JobStatus; progress: number; processed: number; total: number;
    log: string[]; snapshot_id: number | null; snapshot_version: number | null; error: string | null;
    created_by: string | null; created_at: string; started_at: string | null; finished_at: string | null;
    genes?: string[]; target_snapshot_id?: number | null;   // for type 'add_genes' / 'enrich'
    axes?: string[];                                          // for type 'enrich' — selected evidence axes
  }
  const JOBS_FILE = path.join(process.cwd(), 'data', 'jobs.json');
  let JOBS: JobRec[] = [];
  try { JOBS = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')) || []; } catch { JOBS = []; }
  const persistJobs = () => { try { fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true }); fs.writeFileSync(JOBS_FILE, JSON.stringify(JOBS.slice(-100))); } catch { /* best effort */ } };
  const jobLog = (j: JobRec, m: string) => { j.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (j.log.length > 200) j.log = j.log.slice(-200); };
  // any job left 'running'/'queued' by a previous process is stale → mark failed
  for (const j of JOBS) if (j.status === 'running' || j.status === 'queued') { j.status = 'failed'; j.error = 'Interrupted by server restart'; }
  persistJobs();

  const OT_URL = 'https://api.platform.opentargets.org/api/v4/graphql';
  const otFetch = async (query: string, variables: any): Promise<any> => {
    // OT 403s requests with no User-Agent (Node's fetch sends none) — see modalityService.ts.
    const r = await fetch(OT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Disease2Target/1.0 (academic research; contact via app)' }, body: JSON.stringify({ query, variables }) });
    const j = await r.json();
    if (j.errors) throw new Error('Open Targets: ' + JSON.stringify(j.errors).slice(0, 200));
    return j.data;
  };
  const DT_MAP: Record<string, string> = { genetic_association: 'geneticScore', rna_expression: 'expressionScore', literature: 'literatureScore', known_drug: 'targetScore' };

  const resolveDisease = async (q: string): Promise<{ id: string; name: string }> => {
    const s = q.trim();
    if (/^[A-Za-z]+_\d+$/.test(s)) {
      const d = await otFetch(`query($id:String!){ disease(efoId:$id){ id name } }`, { id: s });
      if (d?.disease) return { id: d.disease.id, name: d.disease.name };
    }
    const d = await otFetch(`query($q:String!){ search(queryString:$q, entityNames:["disease"], page:{index:0,size:1}){ hits{ id name } } }`, { q: s });
    const hit = d?.search?.hits?.[0];
    if (!hit) throw new Error(`No disease found for "${q}"`);
    return { id: hit.id, name: hit.name };
  };

  // ── Evidence providers (the 3 cheap axes) — write the value_json contract ──────
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  // Literature denominator guard: velocity = recent/total, so below this many papers the ratio
  // is quantised noise (2 papers -> only 0, 0.5 or 1 possible). Null the axis instead.
  const MIN_LIT_PAPERS = 5;
  const toNum = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

  // server-side gnomAD constraint (safety axis). Reads the preloaded v4.0
  // constraint table first (instant — built by scripts/build_gnomad_constraint.mjs),
  // and only falls back to the live v4 GraphQL API for genes the table is missing.
  // This removes the per-gene network loop that was the slowest step of a harvest.
  const gnomadConstraint = async (symbol: string): Promise<{ pli: number | null; loeuf: number | null } | null> => {
    const tbl = loadRef('gnomad_constraint.json');
    const hit = tbl?.genes?.[symbol];
    if (hit) return { pli: toNum(hit.pli), loeuf: toNum(hit.loeuf) };
    try {
      const r = await fetch('https://gnomad.broadinstitute.org/api', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: 'query($s:String!){ gene(gene_symbol:$s, reference_genome:GRCh38){ gnomad_constraint{ pLI oe_lof_upper } } }', variables: { s: symbol } }),
      });
      const j: any = await r.json();
      const c = j?.data?.gene?.gnomad_constraint;
      if (!c) return null;
      return { pli: toNum(c.pLI), loeuf: toNum(c.oe_lof_upper) };
    } catch { return null; }
  };

  // Enrichment pass: compute the 3 cheap axes and store them as contract-shaped
  // EVIDENCE rows (idempotent). Expression + dependency are pancreatic-only bulk
  // lookups; safety (gnomAD) runs for any disease, throttled per gene.
  const enrichAxes = async (job: JobRec, snapshotId: number, diseaseId: string, diseaseName: string, genes: string[], genesOnly = false, axisSel?: string[]) => {
    const isPancreatic = /pancrea|pdac|paad|ductal adenocarcinoma/i.test(diseaseName || '');
    // axisSel = which axes to run; undefined/empty = all. Lets callers enrich a
    // snapshot with only the axes they pick (e.g. just the slow druggability/clinical/literature).
    const want = (a: string) => !axisSel || axisSel.length === 0 || axisSel.includes(a);
    const isCancelled = () => (JOBS.find(x => x.id === job.id)?.status) === 'cancelled';
    const rows: any[] = [];

    // Save evidence INCREMENTALLY, one axis at a time, with retry — instead of one
    // giant write at the very end. A transient Oracle/VPN blip (e.g. NJS-510 connect
    // timeout) then costs at most the current axis, which retries — not the entire
    // multi-hour run. Failures are logged loudly, never swallowed.
    let savedTotal = 0; const failedAxes: string[] = [];
    const flush = async (label: string) => {
      if (!rows.length) return;
      const batch = rows.splice(0, rows.length);
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const svc = await oracleSvc();
          const res = await svc.saveAxisEvidence(snapshotId, diseaseId, batch, job.created_by || 'job', genesOnly);
          savedTotal += res.count;
          jobLog(job, `Saved ${res.count} ${label} rows to Oracle (running total ${savedTotal})`); persistJobs();
          return;
        } catch (e: any) {
          const msg = String(e?.message || e).slice(0, 120);
          if (attempt < 3) { jobLog(job, `Save ${label} failed (try ${attempt}/3): ${msg} — retrying…`); persistJobs(); await new Promise(r => setTimeout(r, 8000 * attempt)); }
          else { failedAxes.push(label); jobLog(job, `WARNING: ${label} NOT saved after 3 tries: ${msg}`); persistJobs(); }
        }
      }
    };

    if (isPancreatic) {
      const ex = want('expression') ? loadRef('expression_paad.json') : null;
      if (ex?.genes) {
        let n = 0;
        for (const g of genes) {
          const d = ex.genes[g]; if (!d) continue;
          const log2fc = toNum(d.log2fc);
          const up = (log2fc ?? 0) >= 0;
          // #4/#5: direction from log2FC sign; flag near-zero-normal (pseudocount floor -9.966) as
          // low-confidence and cap the stored magnitude (axis saturates at |log2FC|>=4 regardless).
          const normalFloored = toNum(d.normal_median) != null && toNum(d.normal_median)! <= -9.9;
          const cappedLog2fc = log2fc != null ? Math.max(-10, Math.min(10, log2fc)) : null;
          const axis = cappedLog2fc != null ? clamp01(Math.abs(cappedLog2fc) / 4) : null;
          rows.push({ gene_symbol: g, evidence_type: 'expression_tvn', source: ex.meta?.source || 'UCSC Xena Toil (TCGA-PAAD vs GTEx)',
            value_text: `${up ? 'up' : 'down'} log2FC ${log2fc}${normalFloored ? ' (low-confidence: normal floor)' : ''}`,
            value_json: { axis, direction: up ? 'pro' : 'con', display: `${up ? 'up' : 'down'} log2FC ${log2fc} (p ${d.p})${normalFloored ? ' · low-confidence' : ''}`, log2fc, log2fc_capped: cappedLog2fc, low_confidence: normalFloored, p: d.p, tumor_median: d.tumor_median, normal_median: d.normal_median } });
          n++;
        }
        jobLog(job, `Expression axis: ${n} genes`); persistJobs();
      }
      const dp = want('dependency') ? loadRef('depmap_pancreatic.json') : null;
      if (dp?.genes) {
        let n = 0;
        for (const g of genes) {
          const d = dp.genes[g]; if (!d) continue;
          const mean = toNum(d.mean);
          const axis = mean != null ? clamp01(-mean) : null;
          rows.push({ gene_symbol: g, evidence_type: 'dependency', source: dp.meta?.source || 'DepMap CRISPR (Chronos, Pancreas)',
            value_text: `Chronos ${mean}`,
            value_json: { axis, direction: 'pro', display: `Chronos ${mean}${d.frac_dependent != null ? ` · ${Math.round(d.frac_dependent * 100)}% lines` : ''}`, mean, min: d.min, frac_dependent: d.frac_dependent, n_lines: d.n_lines } });
          n++;
        }
        jobLog(job, `Dependency axis: ${n} genes`); persistJobs();
      }
    }
    await flush('expression + dependency');

    // safety — gnomAD, per gene, small concurrency
    let safeN = 0; const CONC = 6;
    for (let i = 0; want('safety') && i < genes.length; i += CONC) {
      if (isCancelled()) { jobLog(job, 'Cancelled during enrichment'); persistJobs(); break; }
      const got = await Promise.all(genes.slice(i, i + CONC).map(async g => ({ g, c: await gnomadConstraint(g) })));
      for (const { g, c } of got) {
        if (!c || (c.pli == null && c.loeuf == null)) continue;
        // #7: gnomAD LOEUF (oe_lof_upper) is bounded ~[0,2]; drop artifacts above (e.g. SSX1=4.93).
        const loeuf = c.loeuf != null && c.loeuf <= 3 ? c.loeuf : null;
        const concern = loeuf != null ? clamp01(1 - loeuf / 1.5) : (c.pli != null ? clamp01(c.pli) : 0);
        rows.push({ gene_symbol: g, evidence_type: 'safety', source: 'gnomAD v4',
          value_text: `pLI ${c.pli} · LOEUF ${loeuf}`,
          value_json: { axis: concern, direction: 'con', display: `pLI ${c.pli != null ? c.pli.toFixed(2) : '—'} · LOEUF ${loeuf != null ? loeuf.toFixed(2) : '—'}`, pli: c.pli, loeuf } });
        safeN++;
      }
      if (i % (CONC * 10) === 0) { jobLog(job, `Safety axis: ${safeN}/${genes.length}…`); persistJobs(); }
    }
    jobLog(job, `Safety axis: ${safeN} genes`); persistJobs();
    await flush('safety');

    // mutation — cBioPortal, ONE bulk cohort pull (per disease study), aggregated
    // per gene. Skipped for diseases with no mapped cancer cohort.
    if (want('mutation') && resolveCbioStudy(diseaseName)) {
      try {
        const cohort = await fetchCohortMutations(diseaseName);
        if (cohort && cohort.size) {
          let n = 0;
          for (const g of genes) {
            const d = cohort.get(g); if (!d) continue;
            const freq = toNum(d.frequency);
            const pct = freq != null ? Math.round(freq * 100) : null;
            rows.push({ gene_symbol: g, evidence_type: 'mutation', source: `cBioPortal · ${d.study_name}`,
              value_text: `${pct ?? '?'}% mutated${d.dominant_variant ? ` · ${d.dominant_variant}` : ''}`,
              value_json: { axis: freq != null ? clamp01(freq) : null, direction: 'pro',
                display: `${pct ?? '?'}% of cohort${d.dominant_variant ? ` · ${d.dominant_variant}` : ''}`,
                frequency: freq, mutated_samples: d.mutated_samples, total_samples: d.total_samples,
                dominant_variant: d.dominant_variant, top_variants: d.top_variants, study_id: d.study_id } });
            n++;
          }
          jobLog(job, `Mutation axis: ${n} genes (cohort ${cohort.size})`); persistJobs();
        } else { jobLog(job, 'Mutation axis: no cohort data'); persistJobs(); }
      } catch (e: any) { jobLog(job, 'Mutation axis warning: ' + String(e?.message || e).slice(0, 160)); persistJobs(); }
    }
    await flush('mutation');

    // druggability — Open Targets (drugs by modality + tractability), per gene, small concurrency.
    let drugN = 0; const DCONC = 5;
    for (let i = 0; want('druggability') && i < genes.length; i += DCONC) {
      if (isCancelled()) { jobLog(job, 'Cancelled during druggability'); persistJobs(); break; }
      const got = await Promise.all(genes.slice(i, i + DCONC).map(async g => ({ g, d: await fetchDruggability(g).catch(() => null) })));
      for (const { g, d } of got) {
        if (!d) continue;   // null = not-fetched → skip (3-state; never write a fabricated no-drug)
        rows.push({ gene_symbol: g, evidence_type: 'druggability', source: 'Open Targets (drugAndClinicalCandidates + tractability)',
          value_text: `${d.label}${d.total_compounds ? ` · ${d.total_compounds} drugs` : ''}${d.tractable_modalities ? ` · ${d.tractable_modalities} tractable` : ''}`,
          value_json: { axis: clamp01(d.score), direction: 'pro', label: d.label,
            display: `${d.label}${d.total_compounds ? ` · ${d.total_compounds} developed drug${d.total_compounds === 1 ? '' : 's'}` : ''}${d.tractable_modalities ? ` · ${d.tractable_modalities} tractable modalit${d.tractable_modalities === 1 ? 'y' : 'ies'}` : ''}`,
            score: d.score, total_compounds: d.total_compounds, target_max_phase: d.target_max_phase,
            proven_modalities: d.proven_modalities, tractable_modalities: d.tractable_modalities,
            ensembl_id: d.target_chembl_id, best_ic50_nm: d.best_ic50_nm } });
        drugN++;
      }
      if (i % (DCONC * 20) === 0) { jobLog(job, `Druggability axis: ${drugN}/${genes.length}…`); persistJobs(); }
    }
    jobLog(job, `Druggability axis: ${drugN} genes`); persistJobs();
    await flush('druggability');

    // clinical — #3: OT target→drug→trial graph, disease-scoped + gene-attributed
    // (replaces CT.gov free-text, which had no gene field and matched substrings).
    let clinN = 0; const CCONC = 5;
    const clinScope = want('clinical') ? await resolveDiseaseScope(diseaseId, diseaseName) : null;
    if (clinScope) jobLog(job, `Clinical axis: disease scope = ${clinScope.ids.size} ontology ids`);
    for (let i = 0; want('clinical') && clinScope && i < genes.length; i += CCONC) {
      if (isCancelled()) { jobLog(job, 'Cancelled during clinical'); persistJobs(); break; }
      const got = await Promise.all(genes.slice(i, i + CCONC).map(async g => ({ g, c: await fetchClinical(g, clinScope).catch(() => null) })));
      for (const { g, c } of got) {
        if (!c || c.n_drugs_in_disease_trials === 0) continue;   // no clinical precedent — neutral, not stored
        const phaseTxt = c.max_disease_trial_phase ? ` · max Phase ${c.max_disease_trial_phase}` : '';
        rows.push({ gene_symbol: g, evidence_type: 'clinical', source: 'Open Targets (target drug trials, disease-scoped)',
          value_text: `${c.n_drugs_in_disease_trials} drug${c.n_drugs_in_disease_trials === 1 ? '' : 's'} in trials${phaseTxt}`,
          value_json: { axis: c.axis, direction: 'pro',
            display: `${c.n_drugs_in_disease_trials} drug${c.n_drugs_in_disease_trials === 1 ? '' : 's'} in ${diseaseName} trials${phaseTxt}`,
            trial_count: c.trial_count, max_phase: c.max_phase,
            n_drugs_in_disease_trials: c.n_drugs_in_disease_trials, max_disease_trial_phase: c.max_disease_trial_phase,
            drug_names: c.drug_names } });
        clinN++;
      }
      if (i % (CCONC * 20) === 0) { jobLog(job, `Clinical axis: ${clinN}/${genes.length}…`); persistJobs(); }
    }
    jobLog(job, `Clinical axis: ${clinN} genes`); persistJobs();
    await flush('clinical');

    // literature — BOTH sources per gene (disease-scoped), small concurrency.
    //   'literature_epmc' = Europe PMC full-text — THE SINGLE SCORING SOURCE (one corpus)
    //   'literature'      = PubMed [Gene Name]  — ANNOTATION ONLY (axis null)
    // PubMed is more precise per paper but rate-limited and ~20x smaller, so its velocity sits
    // on a tiny denominator. Scoring a mix of the two made genes incomparable (same gene: ~0.28
    // velocity gap). Both are still stored so a case study can cite either.
    let litN = 0, epmcN = 0; const LCONC = 5;
    for (let i = 0; want('literature') && i < genes.length; i += LCONC) {
      if (isCancelled()) { jobLog(job, 'Cancelled during literature'); persistJobs(); break; }
      const got = await Promise.all(genes.slice(i, i + LCONC).map(async g => ({
        g,
        pm: await fetchPubmedLiterature(g, diseaseName).catch(() => null),
        ep: await fetchLiterature(g, diseaseName).catch(() => null),
      })));
      for (const { g, pm, ep } of got) {
        if (pm && pm.paper_count > 0) {
          rows.push({ gene_symbol: g, evidence_type: 'literature', source: 'PubMed',
            value_text: `${pm.paper_count} papers${pm.recent_count ? ` · ${pm.recent_count} recent` : ''} (annotation)`,
            value_json: { axis: null, role: 'annotation', direction: 'pro',
              display: `${pm.paper_count} papers · ${Math.round(pm.velocity * 100)}% in last 3y (annotation, not scored)`,
              paper_count: pm.paper_count, recent_count: pm.recent_count, velocity: pm.velocity } });
          litN++;
        }
        if (ep && ep.paper_count > 0) {
          const thin = ep.paper_count < MIN_LIT_PAPERS;   // denominator guard — see constant
          rows.push({ gene_symbol: g, evidence_type: 'literature_epmc', source: 'Europe PMC',
            value_text: `${ep.paper_count} papers${ep.recent_count ? ` · ${ep.recent_count} recent` : ''}${thin ? ' (low-confidence: few papers)' : ''}`,
            value_json: { axis: thin ? null : clamp01(ep.velocity), role: 'scoring', low_confidence: thin, direction: 'pro',
              display: `${ep.paper_count} papers · ${Math.round(ep.velocity * 100)}% in last 3y${thin ? ' · low-confidence' : ''}`,
              paper_count: ep.paper_count, recent_count: ep.recent_count, velocity: ep.velocity } });
          epmcN++;
        }
      }
      if (i % (LCONC * 20) === 0) { jobLog(job, `Literature axis: PubMed ${litN} · EuropePMC ${epmcN}/${genes.length}…`); persistJobs(); }
    }
    jobLog(job, `Literature axis: PubMed ${litN} · Europe PMC ${epmcN} genes`); persistJobs();
    await flush('literature');

    if (failedAxes.length) jobLog(job, `PARTIAL — saved ${savedTotal} evidence rows, but these axes FAILED to store: ${failedAxes.join(', ')}. Oracle was unreachable; re-run to complete them.`);
    else if (savedTotal === 0) jobLog(job, 'No axis evidence to store');
    else jobLog(job, `Enrichment complete — ${savedTotal} evidence rows saved across all axes.`);
    persistJobs();
  };

  // Best-effort Open Targets association for one gene + disease, so a manually
  // added gene carries its real OT scores (e.g. SRC's low PDAC score) alongside
  // the other axes. Falls back to nulls if not found — the gene is still added.
  const otGeneAssociation = async (symbol: string, efo: string): Promise<any> => {
    const base: any = { symbol, name: null, overallScore: null, getScore: null, geneticScore: null, expressionScore: null, literatureScore: null, targetScore: null };
    try {
      const s = await otFetch(`query($q:String!){ search(queryString:$q, entityNames:["target"], page:{index:0,size:1}){ hits{ id name } } }`, { q: symbol });
      const hit = s?.search?.hits?.[0]; if (!hit) return base;
      const d = await otFetch(`query($id:String!){ target(ensemblId:$id){ approvedSymbol approvedName associatedDiseases(page:{index:0,size:500}){ rows{ disease{ id } score datatypeScores{ id score } } } } }`, { id: hit.id });
      const tg = d?.target;
      if (tg) { base.symbol = tg.approvedSymbol || symbol; base.name = tg.approvedName || null; }
      const row = (tg?.associatedDiseases?.rows || []).find((r: any) => r.disease?.id === efo);
      if (row) {
        base.overallScore = row.score; base.getScore = row.score;
        for (const ds of (row.datatypeScores || [])) {
          const k = DT_MAP[ds.id];
          if (k === 'geneticScore') base.geneticScore = ds.score;
          else if (k === 'expressionScore') base.expressionScore = ds.score;
          else if (k === 'literatureScore') base.literatureScore = ds.score;
          else if (k === 'targetScore') base.targetScore = ds.score;
        }
      }
      return base;
    } catch { return base; }
  };

  // Add-genes job: append manually-supplied genes to an existing snapshot and
  // enrich them with the same axes — so e.g. SRC joins the funnel universe.
  const runAddGenesJob = async (job: JobRec) => {
    const cancelled = (): boolean => (JOBS.find(x => x.id === job.id)?.status) === 'cancelled';
    job.status = 'running'; job.started_at = new Date().toISOString(); persistJobs();
    try {
      const genes = [...new Set((job.genes || []).map(g => String(g).trim().toUpperCase()).filter(Boolean))];
      if (!genes.length) throw new Error('No genes provided');
      if (!job.target_snapshot_id) throw new Error('No target snapshot selected');
      jobLog(job, `Resolving disease "${job.disease_query}"…`); persistJobs();
      const dis = await resolveDisease(job.disease_query);
      job.disease_id = dis.id; job.disease_name = dis.name; persistJobs();
      const targets: any[] = [];
      for (let i = 0; i < genes.length; i++) {
        if (cancelled()) { jobLog(job, 'Cancelled'); job.finished_at = new Date().toISOString(); persistJobs(); return; }
        targets.push(await otGeneAssociation(genes[i], dis.id));
        job.processed = i + 1; job.total = genes.length; job.progress = ((i + 1) / genes.length) * 0.5;
        jobLog(job, `Open Targets lookup ${genes[i]} (${i + 1}/${genes.length})`); persistJobs();
      }
      const svc = await oracleSvc();
      const added = await svc.addGenesToSnapshot(job.target_snapshot_id, dis.id, dis.name, targets);
      job.snapshot_id = job.target_snapshot_id;
      jobLog(job, `Added ${added.count} gene(s) to snapshot #${job.target_snapshot_id} — enriching…`); persistJobs();
      await enrichAxes(job, job.target_snapshot_id, dis.id, dis.name, targets.map(t => t.symbol), true);
      job.status = 'done'; job.progress = 1; job.finished_at = new Date().toISOString();
      jobLog(job, `Done — ${genes.join(', ')} added to snapshot #${job.target_snapshot_id}.`); persistJobs();
    } catch (e: any) {
      if (!cancelled()) { job.status = 'failed'; job.error = String(e?.message || e).slice(0, 500); jobLog(job, 'Failed: ' + job.error); }
      job.finished_at = new Date().toISOString(); persistJobs();
    }
  };

  // Enrich an EXISTING snapshot with only the selected axes — runs the chosen
  // evidence providers over all genes already in the snapshot (no OT re-harvest,
  // no new snapshot). Lets you top up a snapshot that only has the fast axes with
  // the slow druggability/clinical/literature axes, or refresh a single axis.
  const runEnrichJob = async (job: JobRec) => {
    const cancelled = (): boolean => (JOBS.find(x => x.id === job.id)?.status) === 'cancelled';
    job.status = 'running'; job.started_at = new Date().toISOString(); job.progress = 0.05; persistJobs();
    try {
      if (!job.target_snapshot_id) throw new Error('No target snapshot selected');
      const svc = await oracleSvc();
      const snap = await svc.getSnapshot(job.target_snapshot_id);
      if (!snap) throw new Error(`Snapshot #${job.target_snapshot_id} not found`);
      job.disease_id = snap.disease_id; job.disease_name = snap.disease_name; job.snapshot_id = job.target_snapshot_id;
      const scores = await svc.listRankingScores(job.target_snapshot_id);
      const genes = [...new Set((scores as any[]).map(r => String(r.gene_symbol)).filter(Boolean))];
      if (!genes.length) throw new Error('Snapshot has no genes');
      job.total = genes.length; job.gene_count = genes.length; job.processed = genes.length; persistJobs();
      jobLog(job, `Enriching snapshot #${job.target_snapshot_id} (${genes.length} genes) — axes: ${(job.axes || []).join(', ') || 'all'}`); persistJobs();
      await enrichAxes(job, job.target_snapshot_id, snap.disease_id, snap.disease_name, genes, false, job.axes);
      job.status = 'done'; job.progress = 1; job.finished_at = new Date().toISOString();
      jobLog(job, 'Done.'); persistJobs();
    } catch (e: any) {
      if (!cancelled()) { job.status = 'failed'; job.error = String(e?.message || e).slice(0, 500); jobLog(job, 'Failed: ' + job.error); }
      job.finished_at = new Date().toISOString(); persistJobs();
    }
  };

  const runHarvestJob = async (job: JobRec) => {
    // Read status via the registry so TS doesn't narrow it away — the DELETE
    // handler flips it to 'cancelled' on this same object from another request.
    const cancelled = (): boolean => (JOBS.find(x => x.id === job.id)?.status) === 'cancelled';
    job.status = 'running'; job.started_at = new Date().toISOString(); jobLog(job, `Resolving disease "${job.disease_query}"…`); persistJobs();
    try {
      const dis = await resolveDisease(job.disease_query);
      job.disease_id = dis.id; job.disease_name = dis.name; jobLog(job, `Disease: ${dis.name} (${dis.id})`); persistJobs();
      const PAGE = 50; const targets: any[] = []; let count = 0;
      for (let page = 0; targets.length < job.gene_count; page++) {
        if (cancelled()) { jobLog(job, 'Cancelled by user'); job.finished_at = new Date().toISOString(); persistJobs(); return; }
        const data = await otFetch(
          `query($id:String!,$size:Int!,$page:Int!){ disease(efoId:$id){ associatedTargets(page:{index:$page,size:$size}){ count rows{ score target{ approvedSymbol approvedName } datatypeScores{ id score } } } } }`,
          { id: dis.id, size: PAGE, page });
        const at = data?.disease?.associatedTargets; if (!at) break;
        count = at.count || count;
        const rows = at.rows || []; if (!rows.length) break;
        for (const r of rows) {
          if (targets.length >= job.gene_count) break;
          const t: any = { symbol: r.target?.approvedSymbol, name: r.target?.approvedName, overallScore: r.score, getScore: r.score };
          for (const ds of (r.datatypeScores || [])) { const k = DT_MAP[ds.id]; if (k) t[k] = ds.score; }
          if (t.symbol) targets.push(t);
        }
        job.processed = targets.length; job.total = Math.min(job.gene_count, count || job.gene_count);
        job.progress = job.total ? Math.min(1, targets.length / job.total) : 0;
        jobLog(job, `Fetched ${targets.length}/${job.total} genes`); persistJobs();
      }
      if (!targets.length) throw new Error('No associated targets returned for this disease');
      jobLog(job, `Writing snapshot to Oracle (${targets.length} genes)…`); persistJobs();
      const svc = await oracleSvc();
      const r = await svc.saveSnapshot({
        disease_id: dis.id, disease_name: dis.name, label: 'Job harvest', gene_count: targets.length, targets,
        provenance: { source: 'Open Targets associatedTargets', job_id: job.id, gene_count_requested: job.gene_count },
        created_by: job.created_by,
      });
      job.snapshot_id = r.id; job.snapshot_version = r.version; job.progress = 0.9;
      jobLog(job, `Snapshot #${r.id} (Tier ${r.version}) saved — enriching evidence axes…`); persistJobs();
      try { await enrichAxes(job, r.id, dis.id, dis.name, targets.map((t: any) => t.symbol)); }
      catch (e: any) { jobLog(job, 'Evidence enrichment warning: ' + String(e?.message || e).slice(0, 200)); persistJobs(); }
      job.status = 'done'; job.progress = 1; job.finished_at = new Date().toISOString();
      jobLog(job, 'Done.'); persistJobs();
    } catch (e: any) {
      if (!cancelled()) { job.status = 'failed'; job.error = String(e?.message || e).slice(0, 500); jobLog(job, 'Failed: ' + job.error); }
      job.finished_at = new Date().toISOString(); persistJobs();
    }
  };

  let jobRunning = false;
  const pumpJobs = async () => {
    if (jobRunning) return;
    const next = JOBS.find(j => j.status === 'queued');
    if (!next) return;
    jobRunning = true;
    const run = next.type === 'add_genes' ? runAddGenesJob : next.type === 'enrich' ? runEnrichJob : runHarvestJob;
    try { await run(next); } catch { /* runner self-handles */ } finally { jobRunning = false; setImmediate(pumpJobs); }
  };

  app.post("/api/jobs", requireUser, express.json({ limit: "256kb" }), (req, res) => {
    const { disease_query, gene_count, type, genes, target_snapshot_id, axes } = req.body || {};
    // 'enrich' derives its disease from the snapshot, so it needs no disease_query.
    if (type !== 'enrich' && (!disease_query || !String(disease_query).trim())) return res.status(400).json({ error: "disease_query required" });
    const base = {
      id: 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      disease_query: String(disease_query || '').slice(0, 120), disease_id: null, disease_name: null,
      status: 'queued' as JobStatus, progress: 0, processed: 0, total: 0, log: [], snapshot_id: null, snapshot_version: null, error: null,
      created_by: (req as any).appUser?.id ?? null, created_at: new Date().toISOString(), started_at: null, finished_at: null,
    };
    let job: JobRec;
    if (type === 'add_genes') {
      const list = Array.isArray(genes) ? genes.map((g: any) => String(g)).filter(Boolean).slice(0, 500) : [];
      if (!list.length) return res.status(400).json({ error: "genes required" });
      if (!target_snapshot_id) return res.status(400).json({ error: "target_snapshot_id required" });
      job = { ...base, type: 'add_genes', gene_count: list.length, genes: list, target_snapshot_id: Number(target_snapshot_id) };
    } else if (type === 'enrich') {
      const ax = Array.isArray(axes) ? axes.map((a: any) => String(a)).filter(Boolean) : [];
      if (!target_snapshot_id) return res.status(400).json({ error: "target_snapshot_id required" });
      if (!ax.length) return res.status(400).json({ error: "axes required" });
      job = { ...base, type: 'enrich', gene_count: 0, target_snapshot_id: Number(target_snapshot_id), axes: ax };
    } else {
      // Cap raised to cover the full OT universe (pancreatic ~7.3k associated
      // targets). The harvest loop also stops when OT returns no more rows, so a
      // large request naturally settles at the true universe size.
      job = { ...base, type: 'harvest_ot', gene_count: Math.max(10, Math.min(25000, Number(gene_count) || 500)) };
    }
    JOBS.push(job); persistJobs(); setImmediate(pumpJobs);
    res.status(201).json(job);
  });
  app.get("/api/jobs", requireUser, (_req, res) => res.json(JOBS.slice().reverse().slice(0, 100)));
  app.get("/api/jobs/:id", requireUser, (req, res) => {
    const j = JOBS.find(x => x.id === req.params.id);
    if (!j) return res.status(404).json({ error: "Job not found" });
    res.json(j);
  });
  app.delete("/api/jobs/:id", requireUser, (req, res) => {
    const j = JOBS.find(x => x.id === req.params.id);
    if (!j) return res.status(404).json({ error: "Job not found" });
    if (j.status === 'queued' || j.status === 'running') { j.status = 'cancelled'; persistJobs(); }
    res.json(j);
  });

  // ── PubTator Proxy ───────────────────────────────────────────────────────────

  const fetchPubTator = async (url: string, retries = 3, backoff = 1000): Promise<any> => {
    const key = cacheKey('pubtator', url);
    const cached = await readApiCache(key);
    if (cached) return cached.body;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DiseaseToTarget/2.0)',
          'Accept': 'application/json',
          'Connection': 'close'
        }
      });
      if (response.status === 429 && retries > 0) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return fetchPubTator(url, retries - 1, backoff * 2);
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      await writeApiCache(key, { status: response.status, body: data, contentType: 'application/json' });
      return data;
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, backoff));
        return fetchPubTator(url, retries - 1, backoff * 2);
      }
      throw error;
    }
  };

  app.get("/api/pubtator/search", async (req, res) => {
    const queryParams = new URLSearchParams(req.query as any);
    const url = `https://www.ncbi.nlm.nih.gov/research/pubtator3-api/search/?${queryParams.toString()}`;
    try {
      res.json(await fetchPubTator(url));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/pubtator/export", async (req, res) => {
    const queryParams = new URLSearchParams(req.query as any);
    const url = `https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson?${queryParams.toString()}`;
    try {
      res.json(await fetchPubTator(url));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Resolve the active invite code: DB (admin-rotatable) first, then env fallback.
  const getActiveInviteCode = async (): Promise<string | null> => {
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from('app_config').select('value').eq('key', 'signup_invite_code').maybeSingle();
        const v: any = data?.value;
        const dbCode = v && typeof v === 'object' ? v.code : (typeof v === 'string' ? v : null);
        if (dbCode && String(dbCode).trim()) return String(dbCode).trim();
      } catch { /* fall through to env */ }
    }
    return process.env.SIGNUP_INVITE_CODE?.trim() || null;
  };

  // ── F-MOD batch: one compact summary per gene, for the Ranking Board column ──
  // Deliberately capped and opt-in. Each cache miss costs several seconds of upstream API
  // time (a cold run is ~5s/gene at concurrency 4), so this is triggered by the user for the
  // genes actually on screen, never on page load. Evidence is cached per gene for 6h, so a
  // second page — or a different goal on the same genes — returns immediately.
  app.post("/api/modality-fit/batch", requireUser, async (req, res) => {
    const raw = Array.isArray(req.body?.genes) ? req.body.genes : [];
    const goal: MechanisticGoal = isGoal(req.body?.goal) ? req.body.goal : 'inhibit';
    // Capped to what can actually FINISH inside the function budget. Evidence is gathered
    // per gene and a cold gene costs tens of seconds, so the old cap of 60 could not return
    // under any circumstances — it just burned the budget and 504'd. The UI offers 12; the
    // API must not promise more than the UI, and neither may exceed the deadline.
    const genes: string[] = [...new Set(raw.map((g: any) => String(g || '').trim().toUpperCase()).filter(Boolean) as string[])].slice(0, 12);
    if (!genes.length) { res.status(400).json({ error: 'genes[] is required' }); return; }
    try {
      const rows = await summariseModalityBatch(genes, goal);
      res.json({ goal, goalText: MECHANISTIC_GOALS[goal], count: rows.length, rows });
    } catch (e: any) {
      res.status(502).json({ error: e?.message || 'modality batch failed' });
    }
  });

  // ── F-MOD: on-demand modality-fit analysis for one target ────────────────────
  // Gathers hard evidence (OT tractability + developed drugs, DoGSite pocket, UniProt
  // localization/active-site/sequence), then Gemini scores each modality 0–5 grounded
  // in that evidence + the chosen mechanistic goal. Scores are AI-assessed predictions.
  app.post("/api/modality-fit", requireUser, async (req, res) => {
    const gene = String(req.body?.gene || '').trim();
    const goal: MechanisticGoal = isGoal(req.body?.goal) ? req.body.goal : 'inhibit';
    if (!gene) { res.status(400).json({ error: 'gene is required' }); return; }
    try {
      const evidence = await gatherModalityEvidence(gene);
      // A symbol no source recognises gets no tiers: the rules would happily return
      // "Plausible" for a structure-independent modality on zero evidence, which reads as
      // an answer rather than as a bad gene symbol.
      if (!isEvidenceResolved(evidence)) {
        res.status(404).json({ error: `No target data found for "${gene}". Check the gene symbol — UniProt, Open Targets, STRING and Ensembl all returned nothing for it.` });
        return;
      }
      // Tiers are DETERMINISTIC (reproducible, auditable). The LLM only writes the one-line
      // rationale for each fixed tier, at temperature 0, restricted to the deterministic basis.
      const rows = assessModalities(evidence, goal);
      let modalities = rows;
      try {
        const text = await geminiGenerate([{ role: 'user', parts: [{ text: buildRationalePrompt(evidence, goal, rows) }] }], GEMINI_MODEL, 'application/json', 0);
        modalities = attachRationales(rows, text);
      } catch {
        // rationale is optional — tiers stand on their own; fall back to deterministic text
        modalities = attachRationales(rows, '');
      }
      res.json({
        gene, goal, goalText: MECHANISTIC_GOALS[goal], evidence, modalities,
        provenance: `Tiers: deterministic rules over Open Targets tractability + developed drugs, DoGSite3 pockets, UniProt (localization/active-site/sequence). Rationale only: ${GEMINI_MODEL} at temperature 0, restricted to the listed evidence. Tiers are reproducible; rationale text is a model-written explanation.`,
        generatedNote: `Whole-protein modality assessment for ${gene} under goal "${goal}".`,
      });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // ── Invite-gated self-registration ───────────────────────────────────────────
  // Validates a shared invite code server-side, then creates an auto-confirmed
  // account via the admin client so the user can sign in immediately.
  app.post('/api/auth/register', async (req, res) => {
    const expected = await getActiveInviteCode();
    if (!expected) {
      res.status(503).json({ error: 'Registration is not enabled (no invite code configured).' });
      return;
    }
    if (!supabaseAdmin) {
      res.status(503).json({ error: 'Registration not available (missing SUPABASE_SERVICE_ROLE_KEY).' });
      return;
    }
    const { email, password, inviteCode } = req.body || {};
    if (!email || !password) { res.status(400).json({ error: 'Email and password are required.' }); return; }
    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' }); return;
    }
    if (!inviteCode || inviteCode !== expected) {
      res.status(403).json({ error: 'Invalid invite code.' }); return;
    }
    try {
      const { error } = await supabaseAdmin.auth.admin.createUser({
        email: String(email).trim(),
        password,
        email_confirm: true,          // auto-confirm so they can sign in right away
      });
      if (error) {
        const msg = /already.*registered|already been registered|duplicate/i.test(error.message)
          ? 'An account with this email already exists.'
          : error.message;
        res.status(400).json({ error: msg });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: view the current invite code + where it comes from
  app.get('/api/admin/invite-code', requireAdmin, async (_req, res) => {
    const code = await getActiveInviteCode();
    res.json({ code: code || '', enabled: !!code });
  });

  // Admin: set/rotate the invite code (stored in app_config, overrides env).
  // An empty string clears the DB value (falls back to env, or disables if none).
  app.put('/api/admin/invite-code', requireAdmin, async (req, res) => {
    const { code } = req.body || {};
    if (typeof code !== 'string') { res.status(400).json({ error: 'code must be a string' }); return; }
    try {
      const { error } = await supabaseAdmin!
        .from('app_config')
        .upsert({ key: 'signup_invite_code', value: { code: code.trim() }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      const active = await getActiveInviteCode();
      res.json({ ok: true, code: active || '', enabled: !!active });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin User Management ────────────────────────────────────────────────────

  app.get('/api/admin/users', requireAdmin, async (_req, res) => {
    try {
      const [{ data: authData, error: authErr }, { data: profiles }] = await Promise.all([
        supabaseAdmin!.auth.admin.listUsers({ perPage: 1000 }),
        supabaseAdmin!.from('user_profiles').select('id, name, institution, role, created_at'),
      ]);
      if (authErr) throw authErr;
      const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const users = (authData?.users ?? []).map((u: any) => {
        const p: any = profileMap.get(u.id) ?? {};
        return {
          id: u.id, email: u.email ?? '—',
          name: p.name ?? null, institution: p.institution ?? null,
          role: p.role ?? 'user', created_at: u.created_at,
          last_sign_in: u.last_sign_in_at ?? null, confirmed: !!u.confirmed_at,
        };
      });
      res.json(users);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
    const { role } = req.body as { role: string };
    if (!['admin', 'user'].includes(role)) {
      res.status(400).json({ error: 'role must be "admin" or "user"' }); return;
    }
    try {
      const { error } = await supabaseAdmin!.from('user_profiles').update({ role }).eq('id', req.params.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
      const { error } = await supabaseAdmin!.auth.admin.deleteUser(req.params.id as string);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Static file serving (production, non-Vercel) ────────────────────────────
  // Fix #7: use process.cwd() instead of __dirname so path resolves correctly
  // regardless of whether server.ts is run directly or compiled to dist-server/
  if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }
}

// Call setupRoutes synchronously — app is fully configured before any await
setupRoutes();

// ── startServer — only runs when NOT on Vercel ───────────────────────────────
// Handles Vite dev middleware (async) and app.listen()
async function startServer() {
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Fix #12: guard with VERCEL too in case NODE_ENV isn't explicitly set.
  // The specifier is held in a variable so bundlers (Vercel/esbuild, nft) do NOT
  // statically pull vite — a devDependency — into the serverless function.
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = await import(vitePkg);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      if (!isProduction) console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

// On Vercel, the serverless entry (api/index.ts) imports `app` directly; the
// dev/standalone bootstrap below is skipped there (guards above no-op listen).
startServer();
