import express from "express";
import { createServer as createViteServer } from "vite";
import { Client } from "@notionhq/client";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Wiki vault path — folder next to server.ts ─────────────────────────────
const VAULT_PATH = process.env.WIKI_VAULT_PATH
  || path.join(__dirname, "wiki-vault");

const sanitizeFolder = (name: string) =>
  name.replace(/['"]/g, '').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').trim();

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

  // ── YAML frontmatter — shows as Properties panel in Obsidian ──────────────
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

  // ── Score table with signal emoji ─────────────────────────────────────────
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

  // ── OT pathways as Obsidian wikilinks ─────────────────────────────────────
  const pathwayLinks = (evidence.pathways ?? []).length > 0
    ? (evidence.pathways as string[]).map((p: string) => `- [[${p}]]`).join('\n')
    : '- None loaded';

  // ── Enriched pathways with p-value ────────────────────────────────────────
  const enrichedLinks = (evidence.enrichedPathways ?? []).length > 0
    ? (evidence.enrichedPathways as any[])
        .map((p: any) => `- [[${p.term}]] — ${p.source} (adj.p = \`${p.adjP}\`)`)
        .join('\n')
    : '- None';

  // ── Related genes as wikilinks ────────────────────────────────────────────
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
    // Already listed — update score
    const lineRegex = new RegExp(`^\\| \\[\\[${gene.symbol}\\]\\].*$`, 'm');
    if (lineRegex.test(content)) {
      content = content.replace(lineRegex, entry);
      fs.writeFileSync(filePath, content, 'utf-8');
      return;
    }
    // Append to table
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // ── Wiki Endpoints ─────────────────────────────────────────────────────────

  // POST /api/wiki/save — write gene page + update disease index
  app.post("/api/wiki/save", (req, res) => {
    try {
      const payload = req.body;
      const { diseaseName, gene, evidence } = payload;
      const diseaseFolderName = sanitizeFolder(diseaseName);
      const diseaseFolder = path.join(VAULT_PATH, diseaseFolderName);

      if (!fs.existsSync(diseaseFolder)) {
        fs.mkdirSync(diseaseFolder, { recursive: true });
      }

      // Write gene page
      const filePath = path.join(diseaseFolder, `${gene.symbol}.md`);
      const md = buildWikiMarkdown(payload);
      fs.writeFileSync(filePath, md, 'utf-8');

      // Update disease _Index.md
      const indexPath = path.join(diseaseFolder, '_Index.md');
      updateIndexFile(indexPath, gene, evidence.getScore ?? 0);

      console.log(`[Wiki] Saved: ${diseaseFolderName}/${gene.symbol}.md`);
      res.json({ success: true, path: filePath });
    } catch (err: any) {
      console.error('[Wiki] Save error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/wiki/exists/:disease/:gene — check if page already saved
  app.get("/api/wiki/exists/:disease/:gene", (req, res) => {
    const folder = sanitizeFolder(decodeURIComponent(req.params.disease));
    const filePath = path.join(VAULT_PATH, folder, `${req.params.gene}.md`);
    res.json({ exists: fs.existsSync(filePath) });
  });

  // GET /api/wiki/list/:disease — list saved genes for a disease
  app.get("/api/wiki/list/:disease", (req, res) => {
    const folder = sanitizeFolder(decodeURIComponent(req.params.disease));
    const diseaseFolder = path.join(VAULT_PATH, folder);
    if (!fs.existsSync(diseaseFolder)) return res.json({ genes: [] });
    const files = fs.readdirSync(diseaseFolder)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => f.replace('.md', ''));
    res.json({ genes: files });
  });

  // POST /api/wiki/save-batch — save all genes for a disease in one call
  app.post("/api/wiki/save-batch", (req, res) => {
    const { pages } = req.body as { pages: any[] };
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'pages array required' });
    }
    const saved: string[] = [];
    const errors: string[] = [];

    console.log(`[Wiki] Batch saving ${pages.length} pages to: ${VAULT_PATH}`);

    for (const payload of pages) {
      try {
        const { diseaseName, gene, evidence } = payload;
        const diseaseFolderName = sanitizeFolder(diseaseName);
        const diseaseFolder = path.join(VAULT_PATH, diseaseFolderName);

        if (!fs.existsSync(diseaseFolder)) {
          fs.mkdirSync(diseaseFolder, { recursive: true });
        }

        const filePath = path.join(diseaseFolder, `${gene.symbol}.md`);
        fs.writeFileSync(filePath, buildWikiMarkdown(payload), 'utf-8');

        const indexPath = path.join(diseaseFolder, '_Index.md');
        updateIndexFile(indexPath, gene, evidence.getScore ?? 0);

        saved.push(gene.symbol);
      } catch (err: any) {
        errors.push(`${payload?.gene?.symbol}: ${err.message}`);
        console.error(`[Wiki] Failed ${payload?.gene?.symbol}:`, err.message);
      }
    }

    console.log(`[Wiki] Batch done — saved: ${saved.length}, errors: ${errors.length}`);
    res.json({ saved, errors });
  });

  // Notion Export Endpoint
  app.post("/api/export/notion", async (req, res) => {
    const { targets, disease } = req.body;
    const notionToken = process.env.NOTION_TOKEN;
    let databaseId = process.env.NOTION_DATABASE_ID || "fdc47e2c2e0b4c5fb79d62c4b76ec8f1";

    // Robust ID extraction: if it's a URL, extract the 32-char UUID
    if (databaseId.includes("notion.so/")) {
      const parts = databaseId.split("/");
      const lastPart = parts[parts.length - 1].split("?")[0];
      databaseId = lastPart;
    }

    if (!notionToken || !databaseId) {
      return res.status(400).json({ 
        error: "Notion configuration missing. Please set NOTION_TOKEN and NOTION_DATABASE_ID in environment variables." 
      });
    }

    console.log(`Using Notion Database ID: ${databaseId}`);
    const notion = new Client({ auth: notionToken });

    try {
      console.log(`Exporting ${targets.length} targets to Notion for disease: ${disease?.name}`);
      
      const results = [];
      const errors = [];
      
      // Export in batches to be safe
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
              Name: {
                title: [{ text: { content: target.symbol } }],
              },
              Disease: {
                rich_text: [{ text: { content: disease?.name || "Unknown" } }],
              },
              GeneticScore: {
                number: target.geneticScore || 0,
              },
              OverallScore: {
                number: target.overallScore || 0,
              },
              TargetScore: {
                number: target.targetScore || 0,
              },
              Expression: {
                number: target.combinedExpression || 0,
              },
              SupportingEvidence: {
                rich_text: [{ text: { content: usefulSources || "None" } }],
              }
            },
          });
          results.push(response.id);
        } catch (err: any) {
          console.error(`Failed to export target ${target.symbol}:`, err.message);
          errors.push(`${target.symbol}: ${err.message}`);
        }
      }

      if (results.length === 0 && errors.length > 0) {
        return res.status(500).json({ 
          error: "All export attempts failed. Common issues: 1. Database not shared with integration. 2. Property names/types mismatch. 3. Invalid token.",
          details: errors.slice(0, 3)
        });
      }

      res.json({ success: true, count: results.length, partialErrors: errors.length > 0 ? errors.slice(0, 3) : undefined });
    } catch (error: any) {
      console.error("Notion Export Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // NVIDIA AI Proxy — avoids browser CORS restrictions
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
      if (!text || !text.trim()) {
        return res.status(502).json({ error: "Empty response from NVIDIA API" });
      }
      try {
        const data = JSON.parse(text);
        res.json(data);
      } catch {
        console.error("NVIDIA non-JSON response:", text.slice(0, 500));
        res.status(502).json({ error: "Invalid JSON from NVIDIA API", raw: text.slice(0, 300) });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generic external API proxy — used for ClinicalTrials, EuropePMC, PubMed
  // Only allows the specific domains used by the app
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

  // PubTator Shared Fetch Helper
  const fetchPubTator = async (url: string, retries = 3, backoff = 1000): Promise<any> => {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Connection': 'close'
        }
      });
      
      if (response.status === 429 && retries > 0) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
        console.warn(`PubTator 429 Rate Limit hit. Waiting ${waitTime}ms before retry...`);
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

  // PubTator Proxy Endpoint
  app.get("/api/pubtator/search", async (req, res) => {
    const queryParams = new URLSearchParams(req.query as any);
    const url = `https://www.ncbi.nlm.nih.gov/research/pubtator3-api/search/?${queryParams.toString()}`;
    
    try {
      const data = await fetchPubTator(url);
      res.json(data);
    } catch (error: any) {
      console.error("PubTator Search Proxy Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/pubtator/export", async (req, res) => {
    const queryParams = new URLSearchParams(req.query as any);
    const url = `https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson?${queryParams.toString()}`;
    
    try {
      const data = await fetchPubTator(url);
      res.json(data);
    } catch (error: any) {
      console.error("PubTator Export Proxy Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ── Paperclip Deep Literature ─────────────────────────────────────────────
  const PAPERCLIP_API_KEY = 'gxl_NQ88ZL_0CIcCO0LGNepamJeHqhwy_v-i1rt7MoSjzDs7Oo2BW8X-0xdA-zrvx44n';

  async function callPaperclip(command: string): Promise<string> {
    try {
      const resp = await fetch('https://paperclip.gxl.ai/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': PAPERCLIP_API_KEY },
        body: JSON.stringify({
          jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
          params: { name: 'paperclip', arguments: { command } }
        })
      });
      const text = await resp.text();
      let data: any;
      try { data = JSON.parse(text); } catch { return ''; }
      return data?.result?.content?.[0]?.text || '';
    } catch {
      return '';
    }
  }

  function parsePaperclipText(text: string): { title: string; source: string; year: string; url: string; summary: string }[] {
    const results: { title: string; source: string; year: string; url: string; summary: string }[] = [];
    // Split on numbered list entries "  1. Title"
    const chunks = text.split(/\n\s{2}\d+\.\s+/).slice(1);
    for (const chunk of chunks) {
      const lines = chunk.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const title = lines[0] || '';
      let source = '', year = '', url = '', summary = '';
      for (const line of lines) {
        if (line.includes(' · ')) {
          const parts = line.split(' · ');
          source = parts[1]?.trim() || '';
          year = (parts[2]?.trim() || '').slice(0, 4);
        } else if (line.startsWith('http')) {
          url = line.trim();
        } else if (line.startsWith('"') || line.startsWith('“')) {
          summary = line.replace(/^[“""]|[”""]$/g, '').trim();
        }
      }
      if (title) results.push({ title, source, year, url, summary });
    }
    return results;
  }

  // Parse "Found X papers" / "Found X documents" from Paperclip text
  function parsePaperclipCount(text: string): number {
    const m = text.match(/Found\s+([\d,]+)\s+(papers|documents)/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  }

  // Metrics: total + last-12m counts for papers, preprints, FDA, trials
  app.post('/api/paperclip/metrics', async (req, res) => {
    const { gene, disease } = req.body as { gene: string; disease: string };
    if (!gene || !disease) return res.status(400).json({ error: 'gene and disease required' });
    const q = `"${gene}" "${disease}"`;
    try {
      const [allP, recP, allPre, recPre, allFda, recFda, allTri, recTri] = await Promise.all([
        callPaperclip(`search --all -n 1 ${q}`),
        callPaperclip(`search --since 1y -n 1 ${q}`),
        callPaperclip(`search --all -s biorxiv -n 1 ${q}`),
        callPaperclip(`search --since 1y -s biorxiv -n 1 ${q}`),
        callPaperclip(`search --all -s fda -n 1 ${disease}`),
        callPaperclip(`search --since 1y -s fda -n 1 ${disease}`),
        callPaperclip(`search --all -s trials -n 1 ${q}`),
        callPaperclip(`search --since 1y -s trials -n 1 ${q}`),
      ]);
      res.json({
        papers:    { total: parsePaperclipCount(allP),   recent: parsePaperclipCount(recP)   },
        preprints: { total: parsePaperclipCount(allPre), recent: parsePaperclipCount(recPre) },
        fda:       { total: parsePaperclipCount(allFda), recent: parsePaperclipCount(recFda) },
        trials:    { total: parsePaperclipCount(allTri), recent: parsePaperclipCount(recTri) },
      });
    } catch (err: any) {
      console.error('[Paperclip metrics]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Ask: free-form query → top results with summaries (for chat interface)
  app.post('/api/paperclip/ask', async (req, res) => {
    const { query, source } = req.body as { query: string; source?: string };
    if (!query) return res.status(400).json({ error: 'query required' });
    const srcFlag = source ? `-s ${source}` : '';
    try {
      const text = await callPaperclip(`search ${srcFlag} "${query}" -n 5 --sort date`);
      const results = parsePaperclipText(text);
      // Extract count
      const total = parsePaperclipCount(text);
      res.json({ results, total, raw: text });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/paperclip/search', async (req, res) => {
    const { gene, disease } = req.body as { gene: string; disease: string };
    if (!gene || !disease) return res.status(400).json({ error: 'gene and disease required' });
    try {
      const query = `${gene} ${disease}`;
      console.log(`[Paperclip] Searching: "${query}"`);
      const [papersText, trialsText] = await Promise.all([
        callPaperclip(`search "${query}" -n 5`),
        callPaperclip(`search -s trials "${query}" -n 3`)
      ]);
      const papers = parsePaperclipText(papersText);
      const trials = parsePaperclipText(trialsText);
      console.log(`[Paperclip] Found ${papers.length} papers, ${trials.length} trials`);
      res.json({ papers, trials });
    } catch (err: any) {
      console.error('[Paperclip] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
