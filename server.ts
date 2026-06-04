import express from "express";
// Vite is a dev-only dependency — imported dynamically so it's never loaded in production
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    return {
      status: Number(data.status || 200),
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

// ── Module-level Express app — exported for Vercel serverless entry point ──────
export const app = express();

// ── Gemini model — single source of truth, overridable via env ────────────────
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

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
  const d = await r.json();
  // Fix #11: surface API errors instead of silently returning empty string
  if (d.error) throw new Error(`Gemini API error ${d.error.code}: ${d.error.message}`);
  return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
};

// ── setupRoutes — synchronous, called at module level so Vercel gets a
//    fully-configured app immediately on import (fixes critical async race) ────
function setupRoutes() {
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

  // NVIDIA AI chat proxy
  app.post("/api/ai/chat", async (req, res) => {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "NVIDIA_API_KEY not configured" });
    try {
      const payload = { ...req.body, stream: false };
      const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (!text || !text.trim()) return res.status(502).json({ error: "Empty response from NVIDIA API" });
      try {
        res.json(JSON.parse(text));
      } catch {
        if (process.env.NODE_ENV !== 'production') console.error("NVIDIA non-JSON response:", text.slice(0, 500));
        res.status(502).json({ error: "Invalid JSON from NVIDIA API", raw: text.slice(0, 300) });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generic AI generate — text prompt → text response
  app.post("/api/ai/generate", async (req, res) => {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    try {
      if (process.env.NVIDIA_API_KEY) {
        const nvRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}` },
          body: JSON.stringify({ model: "NVIDIABuild-Autogen-66", messages: [{ role: 'user', content: prompt }], temperature: 0.3 })
        });
        const nvData = await nvRes.json();
        return res.json({ text: nvData.choices?.[0]?.message?.content?.trim() || "" });
      } else if (process.env.GEMINI_API_KEY) {
        const text = await geminiGenerate([{ parts: [{ text: prompt }] }]);
        return res.json({ text });
      } else {
        return res.status(503).json({ error: "No AI API key configured (GEMINI_API_KEY or NVIDIA_API_KEY)" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      const d = await r.json();
      // Fix #11: surface Gemini errors
      if (d.error) return res.status(502).json({ error: `Gemini API error ${d.error.code}: ${d.error.message}` });
      const candidate = d.candidates?.[0]?.content;
      const text = candidate?.parts?.find((p: any) => p.text)?.text?.trim() || "";
      const functionCalls = candidate?.parts?.filter((p: any) => p.functionCall).map((p: any) => p.functionCall) || [];
      res.json({ text, functionCalls });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      const upstream = await fetch(target, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'DiseaseToTarget/2.0' }
      });
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
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
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
