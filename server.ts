import express from "express";
// Vite is a dev-only dependency — imported dynamically so it's never loaded in production
import path from "path";
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
  if (responseMimeType) body.generationConfig = { responseMimeType };
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
  return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
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
  app.use(express.json({ limit: '2mb' }));
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

  // ── External API Proxy ───────────────────────────────────────────────────────

  const ALLOWED_PROXY_HOSTS = [
    'clinicaltrials.gov',
    'www.ebi.ac.uk',
    'eutils.ncbi.nlm.nih.gov',
    'www.proteinatlas.org',
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
