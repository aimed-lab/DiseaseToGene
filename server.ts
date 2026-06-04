import express from "express";
// Vite is a dev-only dependency — imported dynamically so it's never loaded in production
import { Client } from "@notionhq/client";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Supabase admin client (service role — server-side only, never sent to browser) ──
const supabaseAdmin = (() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[Admin] SUPABASE_SERVICE_ROLE_KEY not set — /api/admin/* routes will return 503');
    return null;
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
})();

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

// ── Wiki vault path ────────────────────────────────────────────────────────────
const VAULT_PATH = process.env.WIKI_VAULT_PATH || path.join(__dirname, "wiki-vault");

// Fix #10 (path traversal): sanitize folder names and validate gene symbols
const sanitizeFolder = (name: string) => {
  const s = name.replace(/['"]/g, '').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').trim();
  if (!s || s === '.') throw new Error(`Invalid folder name: "${name}"`);
  return s;
};

// Fix #10: validate gene symbols to prevent path traversal
const sanitizeGene = (gene: string) => {
  if (!/^[A-Za-z][A-Za-z0-9]{0,19}$/.test(gene)) throw new Error(`Invalid gene symbol: "${gene}"`);
  return gene.toUpperCase();
};

// Fix #10: ensure resolved path stays inside vault
const safeVaultPath = (...parts: string[]) => {
  const resolved = path.resolve(VAULT_PATH, ...parts);
  if (!resolved.startsWith(path.resolve(VAULT_PATH))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
};

const signalEmoji = (val: number | undefined, thresholds = [0.7, 0.4]) => {
  if (val === undefined || val === null) return '—';
  if (val >= thresholds[0]) return '🟢';
  if (val >= thresholds[1]) return '🟡';
  return '🔴';
};

function buildWikiMarkdown(payload: any): string {
  const { diseaseId, diseaseName, gene, evidence, aiSummary, relatedGenes } = payload;
  const now = new Date().toISOString().split('T')[0];
  const diseaseFolderName = sanitizeFolder(diseaseName);

  const tags = ['disease2target'];
  if ((evidence.getScore ?? 0) >= 0.7) tags.push('high-priority');
  if ((evidence.litVelocityNum ?? 0) >= 30) tags.push('emerging');
  if (!evidence.ctTrials || evidence.ctTrials === 0) tags.push('no-trials');
  else tags.push(`phase-${(evidence.maxPhase ?? 'unknown').toLowerCase().replace(/_/g, '-')}`);
  tags.push(diseaseFolderName.toLowerCase());

  const frontmatter = `---
disease: "${diseaseName}"
disease_id: "${diseaseId}"
gene: "${gene.symbol}"
gene_name: "${gene.name}"
get_score: ${evidence.getScore?.toFixed(4) ?? 'N/A'}
genetic: ${evidence.geneticScore?.toFixed(4) ?? 'N/A'}
expression: ${evidence.expressionScore?.toFixed(4) ?? 'N/A'}
target: ${evidence.targetScore?.toFixed(4) ?? 'N/A'}
lit_velocity: "${evidence.litVelocity ?? '—'}"
lit_total_papers: ${evidence.litTotal ?? 0}
lit_recent_papers: ${evidence.litRecent ?? 0}
ct_trials: ${evidence.ctTrials ?? 0}
ct_max_phase: "${evidence.maxPhase ?? 'N/A'}"
ct_active: ${evidence.ctActive ?? false}
epmc_total: ${evidence.epmcTotal ?? 0}
epmc_recent: ${evidence.epmcRecent ?? 0}
epmc_velocity: "${evidence.epmcVelocity ?? '—'}"
tau_tissue: ${evidence.tauTissue?.toFixed(4) ?? 'N/A'}
tau_single_cell: ${evidence.tauSingleCell?.toFixed(4) ?? 'N/A'}
bimodality_score: ${evidence.bimodalityScore?.toFixed(4) ?? 'N/A'}
bimodality_tissue: "${evidence.bimodalityTissue ?? '—'}"
status: draft
tags: [${tags.join(', ')}]
saved: "${now}"
---`;

  const scoreTable = `| Metric | Value | Signal |
|--------|-------|--------|
| **GET Score** | ${evidence.getScore?.toFixed(4) ?? '—'} | ${signalEmoji(evidence.getScore)} |
| Genetic (G) | ${evidence.geneticScore?.toFixed(4) ?? '—'} | ${signalEmoji(evidence.geneticScore)} |
| Expression (E) | ${evidence.expressionScore?.toFixed(4) ?? '—'} | ${signalEmoji(evidence.expressionScore)} |
| Target (T) | ${evidence.targetScore?.toFixed(4) ?? '—'} | ${signalEmoji(evidence.targetScore)} |
| Lit Velocity | ${evidence.litVelocity ?? '—'} | ${signalEmoji(evidence.litVelocityNum, [30, 10])} |
| Lit Total Papers | ${evidence.litTotal ?? '—'} | |
| Lit Recent (3y) | ${evidence.litRecent ?? '—'} | |
| EPMC Total | ${evidence.epmcTotal ?? '—'} | |
| EPMC Recent (3y) | ${evidence.epmcRecent ?? '—'} | |
| EPMC Velocity | ${evidence.epmcVelocity ?? '—'} | |
| CT Trials | ${evidence.ctTrials ?? '—'} | ${evidence.ctTrials > 0 ? '🟢' : '🔴'} |
| CT Max Phase | ${evidence.maxPhase ?? 'N/A'} | |
| CT Active Trial | ${evidence.ctActive ? '✅ Yes' : '—'} | |
| TAU Tissue | ${evidence.tauTissue?.toFixed(4) ?? '—'} | ${signalEmoji(evidence.tauTissue)} |
| TAU Single Cell | ${evidence.tauSingleCell?.toFixed(4) ?? '—'} | ${signalEmoji(evidence.tauSingleCell)} |
| Bimodality | ${evidence.bimodalityScore?.toFixed(4) ?? '—'} (${evidence.bimodalityTissue ?? '—'}) | ${signalEmoji(evidence.bimodalityScore)} |`;

  const pathwayLinks = (evidence.pathways ?? []).length > 0
    ? (evidence.pathways as string[]).map((p: string) => `- [[${p}]]`).join('\n')
    : '- None loaded';

  const enrichedLinks = (evidence.enrichedPathways ?? []).length > 0
    ? (evidence.enrichedPathways as any[])
        .map((p: any) => `- [[${p.term}]] — ${p.source} (adj.p = \`${p.adjP}\`)`)
        .join('\n')
    : '- None';

  const relatedLinks = (relatedGenes ?? []).length > 0
    ? (relatedGenes as string[]).map((g: string) => `[[${g}]]`).join(' · ')
    : '—';

  return `${frontmatter}

# ${gene.symbol} — [[${diseaseFolderName}/_Index|${diseaseName}]]

> [!info] Evidence Snapshot
> **GET Score:** ${evidence.getScore?.toFixed(4) ?? '—'} &nbsp;|&nbsp; **Genetic:** ${evidence.geneticScore?.toFixed(4) ?? '—'} &nbsp;|&nbsp; **Expression:** ${evidence.expressionScore?.toFixed(4) ?? '—'} &nbsp;|&nbsp; **Target:** ${evidence.targetScore?.toFixed(4) ?? '—'}
> **Lit Velocity:** ${evidence.litVelocity ?? '—'} &nbsp;|&nbsp; **CT Trials:** ${evidence.ctTrials ?? 0} &nbsp;|&nbsp; **Max Phase:** ${evidence.maxPhase ?? 'N/A'}

## Scores

${scoreTable}

## Pathways (Open Targets)

${pathwayLinks}

## Enriched Pathways (Enrichr)

${enrichedLinks}

## Related Genes (shared pathways)

${relatedLinks}

---

## AI Summary

${aiSummary || '_Not yet generated — open the gene in Disease2Target and generate AI summary first._'}

---

## Human Notes

> [!note] Interpretation
> _Write your interpretation here_

## Evidence Gaps

- [ ]
- [ ]

## Next Steps

- [ ]
- [ ]

## Case Study Notes

_Write case study narrative here_

---
*Saved from [Disease2Target](http://localhost:3000) on ${now}*
`;
}

function updateIndexFile(filePath: string, gene: { symbol: string; name: string }, getScore: number) {
  let content = '';
  const entry = `| [[${gene.symbol}]] | ${gene.name} | ${getScore.toFixed(4)} |`;

  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
    const lineRegex = new RegExp(`^\\| \\[\\[${gene.symbol}\\]\\].*$`, 'm');
    if (lineRegex.test(content)) {
      content = content.replace(lineRegex, entry);
      fs.writeFileSync(filePath, content, 'utf-8');
      return;
    }
    const tableEnd = content.lastIndexOf('\n| ');
    if (tableEnd !== -1) {
      const insertAt = content.indexOf('\n', tableEnd + 1);
      content = content.slice(0, insertAt) + '\n' + entry + content.slice(insertAt);
    } else {
      content += '\n' + entry;
    }
  } else {
    const folder = path.dirname(filePath);
    const diseaseName = path.basename(folder).replace(/-/g, ' ');
    content = `# ${diseaseName} — Target Wiki

> [!tip] Usage
> Click any gene link to open its evidence page. Sort by GET Score to prioritize targets.

## Saved Targets

| Gene | Name | GET Score |
|------|------|-----------|
${entry}
`;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
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

  // ── Wiki Endpoints ──────────────────────────────────────────────────────────

  app.post("/api/wiki/save", (req, res) => {
    try {
      const payload = req.body;
      const { diseaseName, gene, evidence } = payload;
      const diseaseFolderName = sanitizeFolder(diseaseName);
      const diseaseFolder = safeVaultPath(diseaseFolderName);
      if (!fs.existsSync(diseaseFolder)) fs.mkdirSync(diseaseFolder, { recursive: true });
      const filePath = safeVaultPath(diseaseFolderName, `${sanitizeGene(gene.symbol)}.md`);
      fs.writeFileSync(filePath, buildWikiMarkdown(payload), 'utf-8');
      const indexPath = safeVaultPath(diseaseFolderName, '_Index.md');
      updateIndexFile(indexPath, gene, evidence.getScore ?? 0);
      res.json({ success: true, path: filePath });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Fix #10 (path traversal): sanitize both disease and gene params
  app.get("/api/wiki/exists/:disease/:gene", (req, res) => {
    try {
      const folder = sanitizeFolder(decodeURIComponent(req.params.disease));
      const gene = sanitizeGene(req.params.gene);
      const filePath = safeVaultPath(folder, `${gene}.md`);
      res.json({ exists: fs.existsSync(filePath) });
    } catch { res.json({ exists: false }); }
  });

  app.get("/api/wiki/list/:disease", (req, res) => {
    try {
      const folder = sanitizeFolder(decodeURIComponent(req.params.disease));
      const diseaseFolder = safeVaultPath(folder);
      if (!fs.existsSync(diseaseFolder)) return res.json({ genes: [] });
      const files = fs.readdirSync(diseaseFolder)
        .filter(f => f.endsWith('.md') && !f.startsWith('_'))
        .map(f => f.replace('.md', ''));
      res.json({ genes: files });
    } catch { res.json({ genes: [] }); }
  });

  app.post("/api/wiki/save-batch", (req, res) => {
    const { pages } = req.body as { pages: any[] };
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'pages array required' });
    }
    const saved: string[] = [];
    const errors: string[] = [];
    for (const payload of pages) {
      try {
        const { diseaseName, gene, evidence } = payload;
        const diseaseFolderName = sanitizeFolder(diseaseName);
        const diseaseFolder = safeVaultPath(diseaseFolderName);
        if (!fs.existsSync(diseaseFolder)) fs.mkdirSync(diseaseFolder, { recursive: true });
        const filePath = safeVaultPath(diseaseFolderName, `${sanitizeGene(gene.symbol)}.md`);
        fs.writeFileSync(filePath, buildWikiMarkdown(payload), 'utf-8');
        const indexPath = safeVaultPath(diseaseFolderName, '_Index.md');
        updateIndexFile(indexPath, gene, evidence.getScore ?? 0);
        saved.push(gene.symbol);
      } catch (err: any) {
        errors.push(`${payload?.gene?.symbol}: ${err.message}`);
      }
    }
    res.json({ saved, errors });
  });

  // ── Notion Export ───────────────────────────────────────────────────────────

  app.post("/api/export/notion", async (req, res) => {
    const { targets, disease } = req.body;
    const notionToken = process.env.NOTION_TOKEN;
    // Fix #8: no hardcoded fallback UUID — require env var
    let databaseId = process.env.NOTION_DATABASE_ID || '';
    if (databaseId.includes("notion.so/")) {
      const parts = databaseId.split("/");
      const lastPart = parts[parts.length - 1].split("?")[0];
      databaseId = lastPart;
    }
    if (!notionToken || !databaseId) {
      return res.status(400).json({
        error: "Notion configuration missing. Set NOTION_TOKEN and NOTION_DATABASE_ID in environment variables."
      });
    }
    const notion = new Client({ auth: notionToken });
    try {
      const results = [];
      const errors = [];
      const prioritizedTargets = targets
        .filter((t: any) => !t.usefulness || !Object.values(t.usefulness).includes('not-useful'))
        .sort((a: any, b: any) => {
          const aUseful = Object.values(a.usefulness || {}).filter(s => s === 'useful').length;
          const bUseful = Object.values(b.usefulness || {}).filter(s => s === 'useful').length;
          return bUseful - aUseful;
        });
      for (const target of prioritizedTargets.slice(0, 20)) {
        try {
          const usefulSources = Object.entries(target.usefulness || {})
            .filter(([_, status]) => status === 'useful')
            .map(([source]) => source.charAt(0).toUpperCase() + source.slice(1))
            .join(", ");
          const response = await notion.pages.create({
            parent: { database_id: databaseId },
            properties: {
              Name: { title: [{ text: { content: target.symbol } }] },
              Disease: { rich_text: [{ text: { content: disease?.name || "Unknown" } }] },
              GeneticScore: { number: target.geneticScore || 0 },
              OverallScore: { number: target.overallScore || 0 },
              TargetScore: { number: target.targetScore || 0 },
              Expression: { number: target.combinedExpression || 0 },
              SupportingEvidence: { rich_text: [{ text: { content: usefulSources || "None" } }] }
            },
          });
          results.push(response.id);
        } catch (err: any) {
          errors.push(`${target.symbol}: ${err.message}`);
        }
      }
      if (results.length === 0 && errors.length > 0) {
        return res.status(500).json({
          error: "All export attempts failed. Check database sharing, property names, and token.",
          details: errors.slice(0, 3)
        });
      }
      res.json({ success: true, count: results.length, partialErrors: errors.length > 0 ? errors.slice(0, 3) : undefined });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

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
    try {
      const upstream = await fetch(target, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'DiseaseToTarget/2.0' }
      });
      const text = await upstream.text();
      res.status(upstream.status).set('Content-Type', 'application/json').send(text);
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post("/api/ot-graphql", async (req, res) => {
    const { query, variables } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });
    try {
      const upstream = await fetch('https://api.platform.opentargets.org/api/v4/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── PubTator Proxy ───────────────────────────────────────────────────────────

  const fetchPubTator = async (url: string, retries = 3, backoff = 1000): Promise<any> => {
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
      return await response.json();
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
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

// On Vercel, the serverless entry (api/index.ts) imports `app` directly; the
// dev/standalone bootstrap below is skipped there (guards above no-op listen).
startServer();
