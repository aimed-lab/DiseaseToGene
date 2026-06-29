import express from "express";
// Vite is a dev-only dependency — imported dynamically so it's never loaded in production
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

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
const geminiGenerate = async (contents: object[], model = GEMINI_MODEL, responseMimeType?: string) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const body: Record<string, unknown> = { contents };
  // Generous output budget so large structured extractions aren't truncated.
  body.generationConfig = responseMimeType
    ? { responseMimeType, maxOutputTokens: 8192 }
    : { maxOutputTokens: 8192 };
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

// ── setupRoutes — synchronous, called at module level so Vercel gets a
//    fully-configured app immediately on import (fixes critical async race) ────
function setupRoutes() {
  app.set('trust proxy', 1);

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

  // Generic AI generate — text prompt → text response
  app.post("/api/ai/generate", async (req, res) => {
    const { prompt } = req.body || {};
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: "prompt is required" });
    }
    if (prompt.length > 50_000) {
      return res.status(413).json({ error: "prompt exceeds the 50,000 character limit" });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "GEMINI_API_KEY not configured" });
    }
    try {
      const text = await geminiGenerate([{ parts: [{ text: prompt.trim() }] }]);
      return res.json({ text });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // Multi-turn Gemini chat with optional tools + systemInstruction
  app.post("/api/ai/gemini-chat", async (req, res) => {
    const { messages, systemInstruction, tools } = req.body || {};
    if (!messages?.length) return res.status(400).json({ error: "messages required" });
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

      const body: Record<string, unknown> = { contents };
      if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
      if (tools?.length) body.tools = [{ functionDeclarations: tools }];
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      const raw = await r.text();
      let d: any;
      try {
        d = JSON.parse(raw);
      } catch {
        return res.status(502).json({ error: `Gemini API returned an invalid response (${r.status})` });
      }
      if (!r.ok || d.error) {
        return res.status(502).json({
          error: `Gemini API error ${d.error?.code || r.status}: ${d.error?.message || r.statusText}`,
        });
      }
      const candidate = d.candidates?.[0]?.content;
      const text = candidate?.parts?.find((p: any) => p.text)?.text?.trim() || "";
      const functionCalls = candidate?.parts?.filter((p: any) => p.functionCall).map((p: any) => p.functionCall) || [];
      res.json({ text, functionCalls });
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
    if (!oracleStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
      res.json(await svc.listSnapshots(req.query.diseaseId as string | undefined));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Load one full snapshot (with targets)
  app.get("/api/snapshots/:id", requireUser, async (req, res) => {
    if (!oracleStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
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
    if (!oracleStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
      res.json(await svc.listRankingScores(Number(req.params.id)));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Evidence rows for a snapshot (Gene × Source matrix)
  app.get("/api/snapshots/:id/evidence", requireUser, async (req, res) => {
    if (!oracleStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
      res.json(await svc.snapshotEvidence(Number(req.params.id)));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
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
    if (!oracleStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
      res.json(await svc.evidenceGeneSymbols(req.query.diseaseId as string | undefined));
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // Evidence rows for one gene (for the Stored Evidence panel)
  app.get("/api/evidence", requireUser, async (req, res) => {
    if (!oracleStoreEnabled()) return res.status(503).json({ error: "Oracle store disabled" });
    try {
      const svc = await oracleSvc();
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
    genes?: string[]; target_snapshot_id?: number | null;   // for type 'add_genes'
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
    const r = await fetch(OT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ query, variables }) });
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
  const toNum = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

  // server-side gnomAD constraint (safety axis) — one GraphQL call per gene
  const gnomadConstraint = async (symbol: string): Promise<{ pli: number | null; loeuf: number | null } | null> => {
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
  const enrichAxes = async (job: JobRec, snapshotId: number, diseaseId: string, diseaseName: string, genes: string[], genesOnly = false) => {
    const isPancreatic = /pancrea|pdac|paad|ductal adenocarcinoma/i.test(diseaseName || '');
    const isCancelled = () => (JOBS.find(x => x.id === job.id)?.status) === 'cancelled';
    const rows: any[] = [];

    if (isPancreatic) {
      const ex = loadRef('expression_paad.json');
      if (ex?.genes) {
        let n = 0;
        for (const g of genes) {
          const d = ex.genes[g]; if (!d) continue;
          const log2fc = toNum(d.log2fc);
          const axis = log2fc != null ? clamp01(Math.abs(log2fc) / 4) : null;
          const up = (log2fc ?? 0) >= 0;
          rows.push({ gene_symbol: g, evidence_type: 'expression_tvn', source: ex.meta?.source || 'UCSC Xena Toil (TCGA-PAAD vs GTEx)',
            value_text: `${up ? 'up' : 'down'} log2FC ${log2fc}`,
            value_json: { axis, direction: 'pro', display: `${up ? 'up' : 'down'} log2FC ${log2fc} (p ${d.p})`, log2fc, p: d.p, tumor_median: d.tumor_median, normal_median: d.normal_median } });
          n++;
        }
        jobLog(job, `Expression axis: ${n} genes`); persistJobs();
      }
      const dp = loadRef('depmap_pancreatic.json');
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

    // safety — gnomAD, per gene, small concurrency
    let safeN = 0; const CONC = 6;
    for (let i = 0; i < genes.length; i += CONC) {
      if (isCancelled()) { jobLog(job, 'Cancelled during enrichment'); persistJobs(); break; }
      const got = await Promise.all(genes.slice(i, i + CONC).map(async g => ({ g, c: await gnomadConstraint(g) })));
      for (const { g, c } of got) {
        if (!c || (c.pli == null && c.loeuf == null)) continue;
        const concern = c.loeuf != null ? clamp01(1 - c.loeuf / 1.5) : (c.pli != null ? clamp01(c.pli) : 0);
        rows.push({ gene_symbol: g, evidence_type: 'safety', source: 'gnomAD v4',
          value_text: `pLI ${c.pli} · LOEUF ${c.loeuf}`,
          value_json: { axis: concern, direction: 'con', display: `pLI ${c.pli != null ? c.pli.toFixed(2) : '—'} · LOEUF ${c.loeuf != null ? c.loeuf.toFixed(2) : '—'}`, pli: c.pli, loeuf: c.loeuf } });
        safeN++;
      }
      if (i % (CONC * 10) === 0) { jobLog(job, `Safety axis: ${safeN}/${genes.length}…`); persistJobs(); }
    }
    jobLog(job, `Safety axis: ${safeN} genes`); persistJobs();

    if (!rows.length) { jobLog(job, 'No axis evidence to store'); persistJobs(); return; }
    const svc = await oracleSvc();
    const res = await svc.saveAxisEvidence(snapshotId, diseaseId, rows, job.created_by || 'job', genesOnly);
    jobLog(job, `Stored ${res.count} evidence rows: ${res.types.join(', ')}`); persistJobs();
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
    const run = next.type === 'add_genes' ? runAddGenesJob : runHarvestJob;
    try { await run(next); } catch { /* runner self-handles */ } finally { jobRunning = false; setImmediate(pumpJobs); }
  };

  app.post("/api/jobs", requireUser, express.json({ limit: "256kb" }), (req, res) => {
    const { disease_query, gene_count, type, genes, target_snapshot_id } = req.body || {};
    if (!disease_query || !String(disease_query).trim()) return res.status(400).json({ error: "disease_query required" });
    const base = {
      id: 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      disease_query: String(disease_query).slice(0, 120), disease_id: null, disease_name: null,
      status: 'queued' as JobStatus, progress: 0, processed: 0, total: 0, log: [], snapshot_id: null, snapshot_version: null, error: null,
      created_by: (req as any).appUser?.id ?? null, created_at: new Date().toISOString(), started_at: null, finished_at: null,
    };
    let job: JobRec;
    if (type === 'add_genes') {
      const list = Array.isArray(genes) ? genes.map((g: any) => String(g)).filter(Boolean).slice(0, 500) : [];
      if (!list.length) return res.status(400).json({ error: "genes required" });
      if (!target_snapshot_id) return res.status(400).json({ error: "target_snapshot_id required" });
      job = { ...base, type: 'add_genes', gene_count: list.length, genes: list, target_snapshot_id: Number(target_snapshot_id) };
    } else {
      job = { ...base, type: 'harvest_ot', gene_count: Math.max(10, Math.min(5000, Number(gene_count) || 500)) };
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
