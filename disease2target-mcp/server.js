#!/usr/bin/env node
// server.js ────────────────────────────────────────────────────────────────────
// Disease2Target MCP server.
//
// Exposes the Disease2Target platform's read capabilities as MCP tools that any
// MCP client (Claude Desktop, Cursor, Codex, or a teammate's own app) can call.
// All data comes LIVE from the public ORDS bridge — no VPN, no credentials.
//
// Transport: stdio. Logs go to stderr ONLY (stdout is the MCP protocol channel).
// ------------------------------------------------------------------------------

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as ords from './ords.js';

// ── tiny 10-minute cache (a snapshot's data is static between nightly refreshes) ──
const TTL = 10 * 60 * 1000;
const _cache = new Map();
async function memo(key, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.val;
  const val = await fn();
  _cache.set(key, { at: Date.now(), val });
  return val;
}
const snapshots = () => memo('snapshots', () => ords.listSnapshots());
const scores = (id) => memo(`scores:${id}`, () => ords.listRankingScores(id));
const evidence = (id) => memo(`evidence:${id}`, () => ords.snapshotEvidence(id));

// ── helpers ──
const fmt = (n, d = 3) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(d));
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const jparse = (v) => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };

async function resolveSnapshot({ disease, snapshot_id } = {}) {
  const snaps = await snapshots();
  if (!snaps.length) throw new Error('No snapshots available from the ORDS bridge.');
  if (snapshot_id != null && snapshot_id !== '') {
    const s = snaps.find((x) => Number(x.id) === Number(snapshot_id));
    if (!s) throw new Error(`No snapshot #${snapshot_id}. Call list_diseases to see what's loaded.`);
    return s;
  }
  const sorted = [...snaps].sort((a, b) => Number(b.id) - Number(a.id));
  if (!disease) return sorted[0]; // most recent overall
  const q = String(disease).toLowerCase().trim();
  const match = sorted.find(
    (x) => String(x.disease_name || '').toLowerCase().includes(q) || String(x.disease_id || '').toLowerCase().includes(q),
  );
  if (!match) {
    const avail = [...new Map(sorted.map((s) => [s.disease_id, s.disease_name])).values()].slice(0, 25).join(', ');
    throw new Error(`No loaded disease matches "${disease}". Available: ${avail}`);
  }
  return match;
}

// ════════════════════════════ TOOLS ════════════════════════════

async function toolListDiseases() {
  const snaps = await snapshots();
  const byDisease = new Map();
  for (const s of snaps) {
    const prev = byDisease.get(s.disease_id);
    if (!prev || Number(s.id) > Number(prev.id)) byDisease.set(s.disease_id, s);
  }
  const rows = [...byDisease.values()].sort((a, b) => Number(b.id) - Number(a.id));
  let o = `# Loaded diseases (${rows.length})\n\nPass a disease name or \`snapshot_id\` to the other tools.\n\n`;
  o += `| Disease | MONDO | snapshot_id | version | genes | updated |\n|---|---|---|---|---|---|\n`;
  for (const s of rows) o += `| ${s.disease_name} | ${s.disease_id} | ${s.id} | v${s.version} | ${s.gene_count} | ${String(s.created_at || '').slice(0, 10)} |\n`;
  return text(o);
}

async function toolRankTargets(args) {
  const snap = await resolveSnapshot(args);
  const topN = Math.max(1, Math.min(500, Number(args.top_n) || 25));
  const sc = await scores(snap.id);
  const ranked = [...sc].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, topN);
  let o = `# Ranked targets — ${snap.disease_name} (snapshot #${snap.id} v${snap.version}, ${snap.gene_count} genes)\n\n`;
  o += `Ranked by the Open Targets **overall association score** — a multi-evidence aggregate (somatic mutation, known drug, literature, pathways, …). Rank is a **prediction**. The component columns are OT datatype scores and are intentionally sparse: "Genetic" is the *germline* genetic_association signal and is correctly ~0/blank for pure somatic drivers like KRAS — that is honest, not missing data, and the components do not linearly sum to the overall score.\n\n`;
  o += `| Rank | Gene | OT assoc. | Genetic (germline) | Expression | Target (known-drug) | Literature |\n|---|---|---|---|---|---|---|\n`;
  for (const r of ranked) o += `| ${r.rank ?? '—'} | ${r.gene_symbol} | ${fmt(r.get_score ?? r.overall_score)} | ${fmt(r.genetic_score)} | ${fmt(r.expression_score)} | ${fmt(r.target_score)} | ${fmt(r.literature_score)} |\n`;
  o += `\n_Source: Disease2Target / Open Targets, via the public ORDS bridge._`;
  return text(o);
}

async function toolGetDossier(args) {
  const gene = String(args.gene || '').toUpperCase().trim();
  if (!gene) throw new Error('gene is required');
  const snap = await resolveSnapshot(args);
  const ev = (await ords.evidenceForGene(gene)).filter((r) => Number(r.snapshot_id) === Number(snap.id));
  if (!ev.length) throw new Error(`No evidence for ${gene} in snapshot #${snap.id} (${snap.disease_name}). Check the symbol or try another disease.`);
  const byType = {};
  for (const r of ev) byType[r.evidence_type] = r.value_json;
  const sc = await scores(snap.id);
  const srow = sc.find((r) => String(r.gene_symbol).toUpperCase() === gene);

  const ann = byType.annotation, dr = byType.druggability, cl = byType.clinical;
  const ex = byType.expression_tvn, dp = byType.dependency, sf = byType.safety;
  const ts = byType.tissue, mu = byType.mutation, lit = byType.literature_epmc, pat = byType.patents;

  let o = `# ${gene} — target dossier\n**Disease:** ${snap.disease_name} · **Snapshot:** #${snap.id} v${snap.version}\n`;

  o += `\n## Priority (prediction)\n`;
  if (srow) o += `- **Rank:** ${srow.rank ?? '—'} of ${snap.gene_count}\n- **Open Targets overall association:** ${fmt(srow.get_score ?? srow.overall_score)}  _(OT datatype components — genetic/germline ${fmt(srow.genetic_score)} · expression ${fmt(srow.expression_score)} · target/known-drug ${fmt(srow.target_score)} · literature ${fmt(srow.literature_score)}; sparse by design, they do not sum to the overall score)_\n`;
  else o += `- (not present in the ranking scores)\n`;

  if (ann) {
    o += `\n## Identity (annotation)\n`;
    if (ann.approved_name) o += `- **Name:** ${ann.approved_name}\n`;
    if (ann.target_class) o += `- **Class:** ${ann.target_class}\n`;
    if (ann.uniprot_id) o += `- **UniProt:** ${ann.uniprot_id}\n`;
    if (ann.surface_or_secreted != null) o += `- **Surface/secreted:** ${ann.surface_or_secreted ? 'yes (antibody-reachable)' : 'no'}\n`;
    if (ann.is_common_essential != null) o += `- **Common-essential:** ${ann.is_common_essential ? 'yes — pan-essential, a safety flag' : 'no'}\n`;
    if (ann.n_safety_liabilities) o += `- **Safety liabilities:** ${ann.n_safety_liabilities}\n`;
    if (ann.function_description) o += `- **Function:** ${String(ann.function_description).slice(0, 500)}\n`;
  }

  o += `\n## Evidence (facts)\n`;
  const factLines = [];
  if (mu) factLines.push(`- **Mutation (cBioPortal):** ${mu.display || mu.value_text || ''}`);
  if (ex) factLines.push(`- **Expression tumor vs normal:** ${ex.display || ''}${ex.low_confidence ? ' _(low-confidence)_' : ''}`);
  if (dp) factLines.push(`- **Dependency (DepMap):** ${dp.display || ''}`);
  if (sf) factLines.push(`- **Safety (gnomAD constraint):** ${sf.display || ''}`);
  if (ts) factLines.push(`- **Tissue specificity (GTEx tau):** ${ts.display || ''}`);
  if (lit) factLines.push(`- **Literature (Europe PMC):** ${lit.display || ''}`);
  o += factLines.length ? factLines.join('\n') + '\n' : '- (no fact axes populated for this gene in this snapshot)\n';

  if (dr) {
    o += `\n## Druggability\n`;
    o += `- **${dr.label || 'tractability'}** — ${dr.total_compounds ?? 0} developed drug(s) _(fact)_, ${dr.tractable_modalities ?? 0} tractable modalit(ies) _(prediction)_\n`;
    if (Array.isArray(dr.drugs) && dr.drugs.length) {
      const names = dr.drugs.slice(0, 12).map((d) => (typeof d === 'string' ? d : d.name || d.drug || d.prefName || '')).filter(Boolean);
      if (names.length) o += `- **Drugs:** ${names.join(', ')}\n`;
    }
  }

  if (cl) {
    o += `\n## Clinical trials (facts)\n`;
    o += `- ${cl.n_drugs_in_disease_trials ?? 0} drug(s) in ${snap.disease_name} trials · max Phase ${cl.max_disease_trial_phase ?? '—'} · ${cl.n_disease_trials ?? 0} disease trials total\n`;
    const trials = Array.isArray(cl.trials) ? cl.trials.slice(0, 8) : [];
    for (const t of trials) {
      const nct = String(t.id || '').toUpperCase();
      o += `  - **${nct}** — Phase ${t.phase ?? '—'} · ${t.status ?? ''}${t.drug ? ` · ${t.drug}` : ''}${t.why_stopped ? ` · ⚠ stopped: ${String(t.why_stopped).slice(0, 120)}` : ''}\n`;
    }
  } else {
    o += `\n## Clinical trials\n- No clinical precedent in ${snap.disease_name} — a **neutral novelty signal**, not a negative.\n`;
  }

  if (pat) o += `\n## Patents (annotation — context only, never scored)\n- ${pat.display || ''}\n`;

  o += `\n---\n_Facts are measured/curated from named public sources. Predictions (GET score, rank, tractability) are model-derived. Live via the public ORDS bridge._`;
  return text(o);
}

async function toolGetEvidence(args) {
  const gene = String(args.gene || '').toUpperCase().trim();
  if (!gene) throw new Error('gene is required');
  const snap = await resolveSnapshot(args);
  let ev = (await ords.evidenceForGene(gene)).filter((r) => Number(r.snapshot_id) === Number(snap.id));
  if (args.axis) { const a = String(args.axis).toLowerCase(); ev = ev.filter((r) => String(r.evidence_type).toLowerCase().includes(a)); }
  if (!ev.length) return text(`No evidence for ${gene}${args.axis ? ` (axis "${args.axis}")` : ''} in snapshot #${snap.id} (${snap.disease_name}).`);
  let o = `# Evidence — ${gene} · ${snap.disease_name} (snapshot #${snap.id})\n\n`;
  for (const r of ev) {
    o += `## ${r.evidence_type}\n- **Source:** ${r.source || '—'}\n- **Summary:** ${r.value_text || ''}\n`;
    const disp = r.value_json && r.value_json.display;
    if (disp) o += `- **Detail:** ${disp}\n`;
    o += `\n`;
  }
  return text(o);
}

async function toolGetClinicalTrials(args) {
  const gene = String(args.gene || '').toUpperCase().trim();
  if (!gene) throw new Error('gene is required');
  const snap = await resolveSnapshot(args);
  const row = (await ords.evidenceForGene(gene)).find((r) => Number(r.snapshot_id) === Number(snap.id) && r.evidence_type === 'clinical');
  const cl = row && row.value_json;
  if (!cl) return text(`# ${gene} — clinical trials\nNo drug hitting ${gene} is in a ${snap.disease_name} trial. This is a **neutral novelty signal** (no clinical precedent yet), not a negative.`);
  let o = `# ${gene} — clinical trials in ${snap.disease_name}\n\n`;
  o += `**${cl.n_drugs_in_disease_trials ?? 0} drug(s) in disease trials · max Phase ${cl.max_disease_trial_phase ?? '—'}** · ${cl.n_disease_trials ?? 0} disease trials total`;
  if (cl.trials_by_phase) o += ` (P1 ${cl.trials_by_phase.phase1 || 0} · P2 ${cl.trials_by_phase.phase2 || 0} · P3 ${cl.trials_by_phase.phase3 || 0} · P4 ${cl.trials_by_phase.phase4 || 0})`;
  o += `\n\n| NCT | Phase | Status | Drug | Why stopped |\n|---|---|---|---|---|\n`;
  const trials = Array.isArray(cl.trials) ? cl.trials : [];
  for (const t of trials.slice(0, 40)) {
    o += `| [${String(t.id || '').toUpperCase()}](${t.url || ''}) | ${t.phase ?? '—'} | ${t.status ?? ''} | ${t.drug ?? ''} | ${t.why_stopped ? String(t.why_stopped).slice(0, 100) : ''} |\n`;
  }
  return text(o);
}

async function toolFindNovelTractable(args) {
  const snap = await resolveSnapshot(args);
  const limit = Math.max(1, Math.min(500, Number(args.limit) || 50));
  const [ev, sc] = await Promise.all([evidence(snap.id), scores(snap.id)]);
  const drug = new Map(), clin = new Map();
  for (const r of ev) {
    const g = String(r.gene_symbol).toUpperCase();
    const vj = jparse(r.value_json);
    if (r.evidence_type === 'druggability' && vj) drug.set(g, vj);
    else if (r.evidence_type === 'clinical' && vj) clin.set(g, vj);
  }
  const rankOf = new Map(sc.map((r) => [String(r.gene_symbol).toUpperCase(), r.rank]));
  const hits = [];
  for (const [g, d] of drug) {
    const nDrugs = d.total_compounds ?? 0;
    const tract = d.tractable_modalities ?? 0;
    const c = clin.get(g);
    const nTrials = c ? (c.n_disease_trials ?? c.n_drugs_in_disease_trials ?? 0) : 0;
    if (nDrugs === 0 && nTrials === 0 && tract > 0) hits.push({ gene: g, rank: rankOf.get(g) ?? null, tractable: tract, label: d.label || '' });
  }
  hits.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const top = hits.slice(0, limit);
  let o = `# Novel & tractable targets — ${snap.disease_name} (snapshot #${snap.id})\n\n`;
  o += `**Definition:** no developed drug (any indication) AND no ${snap.disease_name} trial, but ≥1 tractable modality — a druggable handle no one has pursued. All three inputs are Open Targets facts/tractability.\n\n`;
  o += `Found **${hits.length}**; showing top ${top.length} by rank.\n\n`;
  o += `| Rank | Gene | Tractable modalities | Tractability |\n|---|---|---|---|\n`;
  for (const h of top) o += `| ${h.rank ?? '—'} | ${h.gene} | ${h.tractable} | ${h.label} |\n`;
  o += `\n_Heaviest tool — scans the snapshot's full evidence set (cached 10 min). Completeness is bounded by Open Targets; treat as a hypothesis list, not a verdict._`;
  return text(o);
}

// ════════════════════════════ TOOL REGISTRY ════════════════════════════

const diseaseArg = {
  disease: { type: 'string', description: 'Disease name or MONDO id (e.g. "pancreatic adenocarcinoma" or "MONDO_0006047"). Optional — defaults to the most recently loaded snapshot.' },
  snapshot_id: { type: 'number', description: 'Exact snapshot id (from list_diseases). Overrides `disease` when given.' },
};

const TOOLS = [
  {
    name: 'list_diseases',
    description: 'List the diseases (cancers) currently loaded in Disease2Target, with their snapshot id, version, gene count, and last-updated date. Call this first to see what is available.',
    inputSchema: { type: 'object', properties: {} },
    handler: toolListDiseases,
  },
  {
    name: 'rank_targets',
    description: 'Return the ranked target portfolio for a disease — genes ordered by the Open Targets overall association score, with the (sparse) OT datatype component scores. Use for "what are the top targets for X?".',
    inputSchema: { type: 'object', properties: { ...diseaseArg, top_n: { type: 'number', description: 'How many top-ranked targets to return (default 25, max 500).' } } },
    handler: toolRankTargets,
  },
  {
    name: 'get_target_dossier',
    description: 'Full evidence dossier for one gene in a disease: priority (rank/GET), identity/annotation, the fact axes (mutation, expression, dependency, safety, tissue, literature), druggability with drug list, and clinical trials. Facts and predictions are labelled separately.',
    inputSchema: { type: 'object', properties: { gene: { type: 'string', description: 'Gene symbol, e.g. KRAS.' }, ...diseaseArg }, required: ['gene'] },
    handler: toolGetDossier,
  },
  {
    name: 'get_evidence',
    description: 'Raw evidence rows for one gene, optionally filtered to a single axis (expression, dependency, safety, tissue, mutation, annotation, druggability, clinical, patents, literature). Lower-level than get_target_dossier.',
    inputSchema: { type: 'object', properties: { gene: { type: 'string', description: 'Gene symbol, e.g. KRAS.' }, axis: { type: 'string', description: 'Optional axis/evidence_type filter, e.g. "clinical" or "expression".' }, ...diseaseArg }, required: ['gene'] },
    handler: toolGetEvidence,
  },
  {
    name: 'get_clinical_trials',
    description: 'Per-trial clinical records for a gene in a disease: NCT id + link, phase, status, drug, and reason-for-termination where a trial was stopped. Returns a neutral "no precedent" message when there are none.',
    inputSchema: { type: 'object', properties: { gene: { type: 'string', description: 'Gene symbol, e.g. ERBB2.' }, ...diseaseArg }, required: ['gene'] },
    handler: toolGetClinicalTrials,
  },
  {
    name: 'find_novel_tractable',
    description: 'The discovery query: targets with NO developed drug (any indication) AND NO trial in this disease, but at least one tractable modality — druggable handles nobody has pursued. Ranked by GET score.',
    inputSchema: { type: 'object', properties: { ...diseaseArg, limit: { type: 'number', description: 'Max targets to return (default 50, max 500).' } } },
    handler: toolFindNovelTractable,
  },
];

const HANDLERS = Object.fromEntries(TOOLS.map((t) => [t.name, t.handler]));

// ════════════════════════════ SERVER ════════════════════════════

const server = new Server(
  { name: 'disease2target', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = HANDLERS[name];
  if (!handler) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  try {
    return await handler(args || {});
  } catch (e) {
    return { content: [{ type: 'text', text: `Error in ${name}: ${e && e.message ? e.message : String(e)}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[disease2target-mcp] ready · ORDS ${ords.baseUrl()} · ${TOOLS.length} tools`);
