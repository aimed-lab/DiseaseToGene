#!/usr/bin/env node
// server.js ────────────────────────────────────────────────────────────────────
// Disease2Target MCP server (v1.1).
//
// Exposes the Disease2Target platform's read capabilities as MCP tools that any
// MCP client (Claude Desktop, Cursor, Codex, PLEASER's agents, or your own app)
// can call. All data comes LIVE from the public ORDS bridge — no VPN, no credentials.
//
// The Ranking Board's scoring engine is NOT re-implemented here: board.bundle.js is
// built from the app's own rankingBoard.ts / boardRows.ts / agoraNominated.ts
// (`npm run build:mcp` at the repo root), so `rank_board` returns exactly what a user
// sees on the board for the same snapshot and modality.
//
// Transport: stdio. Logs go to stderr ONLY (stdout is the MCP protocol channel).
// ------------------------------------------------------------------------------

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as ords from './ords.js';
import {
  buildBoard, CRITERIA, CORE_CRITERIA, MODALITY_PROFILES, readyModalities,
  deriveBoardRows, proteinFrame, isAgora, agoraNominations, AGORA_COUNT,
} from './board.bundle.js';

const VERSION = '1.1.0';

// ── tiny 10-minute cache (a snapshot's data is static between refreshes) ──
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
const snapshotFull = (id) => memo(`snapshot:${id}`, () => ords.getSnapshot(id));
const scores = (id) => memo(`scores:${id}`, () => ords.listRankingScores(id));
const evidence = (id) => memo(`evidence:${id}`, () => ords.snapshotEvidence(id));

// The board for a snapshot + modality: the app's own engine over the app's own row shape.
// Heavy the first time (a full evidence pull, ~55k rows), then cached.
const boardFor = (id, modality) => memo(`board:${id}:${modality}`, async () => {
  const [sc, ev] = await Promise.all([scores(id), evidence(id)]);
  const rows = deriveBoardRows(sc, ev);
  const board = buildBoard(rows, modality);
  const bySymbol = new Map(board.scored.map(s => [String(s.symbol).toUpperCase(), s]));
  return { rows, board, bySymbol, total: board.scored.length };
});

// ── helpers ──
const fmt = (n, d = 3) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(d));
const pct100 = (v) => (v == null ? '—' : String(Math.round(v * 100)));
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const jparse = (v) => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };
const isAD = (snap) => /alzheimer/i.test(String(snap?.disease_name || ''));
const provenanceOf = (snap) => jparse(snap?.provenance) || {};

// Who put the gene in the snapshot. The ORDS scores endpoint carries candidate_source once
// docs/sql/ords_scores_candidate_source.sql has been applied; before that it is derived from
// the snapshot's candidate cutoff (rows past it were appended, e.g. Agora).
function candidateSourceOf(row, prov) {
  if (row?.candidate_source) return String(row.candidate_source);
  const cut = Number(prov?.candidate_cutoff) || 0;
  if (cut && row?.rank != null && Number(row.rank) > cut) return String(prov.added_source || 'ADDED');
  return 'OPEN_TARGETS';
}

function modalityOf(args) {
  const m = String(args.modality || 'small_molecule').toLowerCase().replace(/[-\s]/g, '_');
  if (!MODALITY_PROFILES[m]) throw new Error(`Unknown modality "${args.modality}". One of: ${Object.keys(MODALITY_PROFILES).join(', ')}.`);
  return m;
}

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

// Antibody accessibility, RE-DERIVED from the stored subcellular locations rather than read
// from the snapshot's cached boolean (the cached flag is frozen at harvest time and was wrong
// for KRAS on #102). Mirrors isSurfaceOrSecreted() in targetProfileService.ts — keep in step.
const SURFACE_RE = /(cell|plasma) membrane|cell surface|cell projection|\bsecreted\b|extracellular (space|region|matrix)|gpi-anchor/i;
const INTERNAL_RE = /mitochondri|endoplasmic|golgi|nucle|lysosom|peroxisom|endosom|vacuol|exosome/i;
const TRANSMEMBRANE_RE = /single-pass|multi-pass|transmembrane/i;
const CYTO_ANCHOR_RE = /cytoplasmic side|lipid-anchor|myristoyl|palmitoyl|prenyl|farnesyl|geranylgeranyl/i;
function surfaceFromLocations(locs, fallback) {
  if (!Array.isArray(locs) || locs.length === 0) return fallback ?? null;
  const hasSurface = locs.some(l => SURFACE_RE.test(l) && !INTERNAL_RE.test(l));
  if (!hasSurface) return false;
  if (locs.some(l => TRANSMEMBRANE_RE.test(l) || /gpi/i.test(l))) return true;
  return !locs.some(l => CYTO_ANCHOR_RE.test(l));
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
  let o = `# Loaded diseases (${rows.length})\n\nPass a disease name or \`snapshot_id\` to the other tools. Cancers and non-cancers are both loaded; for a non-cancer disease the cancer-only axes (somatic mutation, DepMap dependency) are structurally empty and the board drops them from the weight budget.\n\n`;
  o += `| Disease | MONDO | snapshot_id | version | genes | candidate rule | Open Targets release | updated |\n|---|---|---|---|---|---|---|---|\n`;
  for (const s of rows) {
    const full = await snapshotFull(s.id);
    const p = provenanceOf(full);
    const rule = p.candidate_cutoff ? `top ${Number(p.candidate_cutoff).toLocaleString()} by OT association${p.added_source ? ` + ${p.added_source}-added` : ''}` : '(not recorded)';
    o += `| ${s.disease_name} | ${s.disease_id} | ${s.id} | v${s.version} | ${s.gene_count} | ${rule} | ${p.ot_release || '?'}${p.ot_release_inferred ? ' (inferred)' : ''} | ${String(s.created_at || '').slice(0, 10)} |\n`;
  }
  o += `\n_Use \`get_snapshot_provenance\` for the full record (query, score definition, counts, additions, network runs)._`;
  return text(o);
}

async function toolRankTargets(args) {
  const snap = await resolveSnapshot(args);
  const topN = Math.max(1, Math.min(500, Number(args.top_n) || 25));
  const [sc, full] = await Promise.all([scores(snap.id), snapshotFull(snap.id)]);
  const prov = provenanceOf(full);
  const ranked = [...sc].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, topN);
  const ad = isAD(snap);
  let o = `# Open Targets association ranking — ${snap.disease_name} (snapshot #${snap.id} v${snap.version}, ${snap.gene_count} genes)\n\n`;
  o += `This is the **candidate-selection order**: genes sorted by the Open Targets overall association score at harvest time. It is NOT the platform's composite ranking — for that call \`rank_board\`, which applies the eight-criterion weighted model the Ranking Board shows users. Component columns are OT datatype scores and are intentionally sparse ("Genetic" is germline genetic association and is correctly ~0 for somatic drivers like KRAS).\n\n`;
  o += `| OT rank | Gene | Source | OT assoc. | Genetic (germline) | Expression | Target (known-drug) | Literature |${ad ? ' Agora |' : ''}\n|---|---|---|---|---|---|---|---|${ad ? '---|' : ''}\n`;
  for (const r of ranked) o += `| ${r.rank ?? '—'} | ${r.gene_symbol} | ${candidateSourceOf(r, prov)} | ${fmt(r.get_score ?? r.overall_score)} | ${fmt(r.genetic_score)} | ${fmt(r.expression_score)} | ${fmt(r.target_score)} | ${fmt(r.literature_score)} |${ad ? ` ${isAgora(r.gene_symbol) ? '✓' : ''} |` : ''}\n`;
  o += `\n_Source: Open Targets ${prov.ot_release || '(release not recorded)'} via the public ORDS bridge. "Source" = who put the gene in the snapshot (OPEN_TARGETS candidate, or appended with its own label such as AGORA)._`;
  return text(o);
}

async function toolRankBoard(args) {
  const snap = await resolveSnapshot(args);
  const modality = modalityOf(args);
  const topN = Math.max(1, Math.min(500, Number(args.top_n) || 25));
  const dataset = String(args.dataset || 'all').toLowerCase();
  const [{ board, total }, full] = await Promise.all([boardFor(snap.id, modality), snapshotFull(snap.id)]);
  const prov = provenanceOf(full);
  const ad = isAD(snap);
  let list = board.scored;
  if (dataset === 'agora') {
    if (!ad) throw new Error('dataset="agora" only applies to Alzheimer disease snapshots.');
    list = list.filter(s => isAgora(s.symbol));
  } else if (dataset !== 'all') throw new Error('dataset must be "all" or "agora".');
  const top = list.slice(0, topN);
  const active = board.activeCriteria;
  const validated = readyModalities().includes(modality);

  let o = `# Ranking Board — ${snap.disease_name} · ${MODALITY_PROFILES[modality].label || modality} (snapshot #${snap.id}, ${total.toLocaleString()} genes${dataset === 'agora' ? `, Agora-nominated view: ${list.length}` : ''})\n\n`;
  o += `The platform's composite ranking: a transparent weighted sum over eight criteria, rescaled so the field leader = 100. Same engine and same rows as the app's Ranking Board (bundled, not re-implemented).${validated ? '' : ` **This modality's weight vector is not yet validated** — only ${readyModalities().join(', ')} is; treat the order as exploratory.`}\n\n`;
  o += `**Active weights** (criteria with data in this snapshot; the rest are dropped and the budget renormalised): ${active.map(k => `${CRITERIA.find(c => c.key === k).label} ${Math.round(board.weights[k] * 100)}%`).join(' · ')}.\n`;
  const dropped = CRITERIA.filter(c => !active.includes(c.key)).map(c => c.label);
  if (dropped.length) o += `Dropped for this disease (no data for any gene): ${dropped.join(', ')}.\n`;
  o += `Core criteria (${[...CORE_CRITERIA].join(', ')}) count a missing value against the target; context criteria (clinical, literature, network) are neutral when missing, so novel targets are not punished for lack of attention.\n\n`;

  o += `| Board rank | Gene | Score | OT rank | Source |${ad ? ' Agora |' : ''} ${active.map(k => CRITERIA.find(c => c.key === k).label).join(' | ')} | Coverage |\n`;
  o += `|---|---|---|---|---|${ad ? '---|' : ''}${active.map(() => '---|').join('')}---|\n`;
  for (const s of top) {
    const src = candidateSourceOf(s.raw, prov);
    o += `| ${s.boardRank} | ${s.symbol}${s.gated ? ' ⛔' : ''} | ${s.display.toFixed(1)} | ${s.sourceRank ?? '—'} | ${src} |${ad ? ` ${isAgora(s.symbol) ? '✓' : ''} |` : ''} ${active.map(k => pct100(s.criteria[k])).join(' | ')} | ${s.coverage}/${active.length} |\n`;
  }
  o += `\n_Criterion columns are 0–100 (criterion score × 100). ⛔ = gated ineligible for this modality (sunk and sorted last). Network = disease-specific WINNER percentile within this snapshot's candidate graph — never comparable across snapshots. Board rank is a **prediction** built from labelled facts and predictions; see \`get_target_dossier\` for the per-gene breakdown._`;
  return text(o);
}

async function toolGetDossier(args) {
  const gene = String(args.gene || '').toUpperCase().trim();
  if (!gene) throw new Error('gene is required');
  const snap = await resolveSnapshot(args);
  const modality = modalityOf(args);
  const [ev, full, { bySymbol, board, total }] = await Promise.all([
    ords.evidenceForGene(gene).then(rows => rows.filter(r => Number(r.snapshot_id) === Number(snap.id))),
    snapshotFull(snap.id), boardFor(snap.id, modality),
  ]);
  const prov = provenanceOf(full);
  const byType = {}, srcOf = {};
  for (const r of ev) { byType[r.evidence_type] = r.value_json; if (r.source) srcOf[r.evidence_type] = r.source; }
  const sc = await scores(snap.id);
  const srow = sc.find((r) => String(r.gene_symbol).toUpperCase() === gene);
  if (!ev.length && !srow) throw new Error(`${gene} is not in snapshot #${snap.id} (${snap.disease_name}). Check the symbol or try another disease.`);
  const b = bySymbol.get(gene);

  const ann = byType.annotation, dr = byType.druggability, cl = byType.clinical;
  const ex = byType.expression_tvn, dp = byType.dependency, sf = byType.safety, pr = byType.proteomics;
  const ts = byType.tissue, mu = byType.mutation, lit = byType.literature_epmc, pat = byType.patents, net = byType.network;

  let o = `# ${gene} — target dossier\n**Disease:** ${snap.disease_name} · **Snapshot:** #${snap.id} v${snap.version}`;
  if (srow) o += ` · **Candidate source:** ${candidateSourceOf(srow, prov)}`;
  if (isAD(snap)) o += ` · **Agora:** ${isAgora(gene) ? `nominated by ${agoraNominations(gene)} AMP-AD team(s) (of ${AGORA_COUNT} nominated targets)` : 'not nominated'}`;
  o += `\n`;

  o += `\n## Priority (prediction)\n`;
  if (b) {
    o += `- **Board rank (${MODALITY_PROFILES[modality].label || modality}):** ${b.boardRank} of ${total.toLocaleString()} · score ${b.display.toFixed(1)} (leader = 100)${b.gated ? ` · ⛔ gated: ${b.gateNote || 'ineligible for this modality'}` : ''}\n`;
    o += `- **Criteria (0–100, weight):** ${board.activeCriteria.map(k => `${CRITERIA.find(c => c.key === k).label} ${pct100(b.criteria[k])} (${Math.round(board.weights[k] * 100)}%)`).join(' · ')}\n`;
  }
  if (srow) o += `- **Open Targets association:** rank ${srow.rank ?? '—'} of ${snap.gene_count}, score ${fmt(srow.get_score ?? srow.overall_score)} _(the candidate-selection order, not the composite)_\n`;
  else o += `- (not present in the ranking scores)\n`;

  if (ann) {
    o += `\n## Identity (annotation)\n`;
    if (ann.approved_name) o += `- **Name:** ${ann.approved_name}\n`;
    if (ann.target_class) o += `- **Class:** ${ann.target_class}\n`;
    if (ann.uniprot_id) o += `- **UniProt:** ${ann.uniprot_id}\n`;
    const surface = surfaceFromLocations(ann.subcellular_locations, ann.surface_or_secreted);
    if (surface != null) o += `- **Surface/secreted:** ${surface ? 'yes (antibody-reachable)' : 'no — intracellular'}\n`;
    if (ann.is_common_essential != null) o += `- **Common-essential:** ${ann.is_common_essential ? 'yes — pan-essential, a safety flag' : 'no'}\n`;
    if (ann.n_safety_liabilities) o += `- **Safety liabilities:** ${ann.n_safety_liabilities}\n`;
    if (ann.function_description) o += `- **Function:** ${String(ann.function_description).slice(0, 500)}\n`;
  }

  o += `\n## Evidence (facts)\n`;
  const factLines = [];
  if (mu) factLines.push(`- **Mutation (cBioPortal):** ${mu.display || mu.value_text || ''}`);
  if (ex) factLines.push(`- **Expression, disease vs normal:** ${ex.display || ''}${ex.low_confidence ? ' _(low-confidence)_' : ''}`);
  if (pr) {
    const frame = proteinFrame({ prot_source: srcOf.proteomics });
    factLines.push(`- **${frame.label}:** ${pr.display || `log2FC ${fmt(pr.log2fc, 3)}`}${pr.axis != null ? ` · axis ${fmt(pr.axis, 3)} (${frame.scaleNote})` : ''} _(${srcOf.proteomics || 'proteomics'})_`);
  }
  if (dp) factLines.push(`- **Dependency (DepMap):** ${dp.display || ''}`);
  if (sf) factLines.push(`- **Safety (gnomAD constraint):** ${sf.display || ''}`);
  if (ts) factLines.push(`- **Tissue specificity (GTEx tau):** ${ts.display || ''}`);
  if (lit) factLines.push(`- **Literature (Europe PMC):** ${lit.display || ''}`);
  o += factLines.length ? factLines.join('\n') + '\n' : '- (no fact axes populated for this gene in this snapshot)\n';

  o += `\n## Network biology (prediction)\n`;
  if (net && net.winner_pct != null) {
    o += `- **Disease-network centrality (WINNER):** ${Number(net.winner_pct).toFixed(1)}th percentile${net.winner_rank ? ` · rank ${net.winner_rank} of ${net.n_network_genes}` : ''} · raw/max ${fmt(net.winner_score)}${net.degree != null ? ` · ${net.degree} STRING partners in the graph` : ''}\n`;
    o += `- **Context:** ${net.context || 'disease candidate graph'} — scored by ${net.implementation || 'WINNER'}; the percentile is within this run only and is never comparable with another disease or the global interactome. WINNER tracks connectivity closely, so a high value can mean "well connected" rather than "disease-specific".\n`;
    o += `- **RWR seed proximity:** ${fmt(net.rwr_score)}${net.is_seed ? ' · seed gene' : ''} _(exploratory, not in the criterion)_\n`;
  } else if (net) {
    o += `- **WINNER (legacy max-normalised):** ${net.winner_score ?? '—'} · **RWR:** ${net.rwr_score ?? '—'}${net.is_seed ? ' · seed gene' : ''} _(snapshot predates the percentile run)_\n`;
  } else {
    o += `- No stored network score. Call \`get_network_context\` to see why (outside the candidate graph, or no STRING protein at this version).\n`;
  }

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
      o += `  - **${nct}** — Phase ${t.phase ?? '—'} · ${t.status ?? ''}${t.year ? ` · ${t.year}` : ''}${t.drug ? ` · ${t.drug}` : ''}${t.sponsor ? ` · ${t.sponsor}` : ''}${t.n_locations ? ` · ${t.n_locations} sites` : ''}${t.why_stopped ? ` · ⚠ stopped: ${String(t.why_stopped).slice(0, 100)}` : ''}\n`;
    }
  } else {
    o += `\n## Clinical trials\n- No clinical precedent in ${snap.disease_name} — a **neutral novelty signal**, not a negative.\n`;
  }

  if (pat) o += `\n## Patents (annotation — context only, never scored)\n- ${pat.display || ''}\n`;

  o += `\n---\n_Facts are measured/curated from named public sources. Predictions (board rank, OT association, tractability, network centrality) are model-derived. Live via the public ORDS bridge._`;
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
  o += `\n\n| NCT | Phase | Status | Year | Drug | Sponsor | Sites | Why stopped |\n|---|---|---|---|---|---|---|---|\n`;
  const trials = Array.isArray(cl.trials) ? cl.trials : [];
  for (const t of trials.slice(0, 40)) {
    const sites = t.n_locations ? `${t.n_locations}${Array.isArray(t.countries) && t.countries.length ? ` (${t.countries.slice(0, 3).join(', ')})` : ''}` : '';
    o += `| [${String(t.id || '').toUpperCase()}](${t.url || ''}) | ${t.phase ?? '—'} | ${t.status ?? ''} | ${t.year ?? '—'} | ${t.drug ?? ''} | ${t.sponsor ?? '—'} | ${sites || '—'} | ${t.why_stopped ? String(t.why_stopped).slice(0, 80) : ''} |\n`;
  }
  return text(o);
}

async function toolFindNovelTractable(args) {
  const snap = await resolveSnapshot(args);
  const modality = modalityOf(args);
  const limit = Math.max(1, Math.min(500, Number(args.limit) || 50));
  const { rows, bySymbol, total } = await boardFor(snap.id, modality);
  const hits = [];
  for (const r of rows) {
    const nDrugs = r.n_drugs ?? 0, tract = r.tractable_modalities ?? 0, nTrials = r.n_disease_trials ?? 0;
    if (nDrugs === 0 && nTrials === 0 && tract > 0) {
      const b = bySymbol.get(String(r.gene_symbol).toUpperCase());
      hits.push({ gene: r.gene_symbol, boardRank: b?.boardRank ?? null, score: b?.display ?? null, otRank: r.rank ?? null, tractable: tract, label: r.tractability?.label || r.target_class || '' });
    }
  }
  hits.sort((a, b) => (a.boardRank ?? 1e9) - (b.boardRank ?? 1e9));
  const top = hits.slice(0, limit);
  let o = `# Novel & tractable targets — ${snap.disease_name} (snapshot #${snap.id}, ${MODALITY_PROFILES[modality].label || modality} board)\n\n`;
  o += `**Definition:** no developed drug (any indication) AND no ${snap.disease_name} trial, but ≥1 tractable modality — a druggable handle no one has pursued. Ordered by **board rank** (the composite), so the top of this list is "highest-priority AND unpursued".\n\n`;
  o += `Found **${hits.length}** of ${total.toLocaleString()}; showing top ${top.length}.\n\n`;
  o += `| Board rank | Score | Gene | OT rank | Tractable modalities | Class |\n|---|---|---|---|---|---|\n`;
  for (const h of top) o += `| ${h.boardRank ?? '—'} | ${h.score != null ? h.score.toFixed(1) : '—'} | ${h.gene} | ${h.otRank ?? '—'} | ${h.tractable} | ${h.label} |\n`;
  o += `\n_Completeness is bounded by Open Targets tractability; treat as a hypothesis list, not a verdict._`;
  return text(o);
}

async function toolGetNetworkContext(args) {
  const gene = String(args.gene || '').toUpperCase().trim();
  if (!gene) throw new Error('gene is required');
  const [runs, maps] = await Promise.all([ords.networkForGene(gene), ords.mappingForGene(gene)]);
  const snapFilter = args.snapshot_id != null && args.snapshot_id !== '' ? Number(args.snapshot_id) : null;
  const rows = snapFilter ? runs.filter(r => Number(r.snapshot_id) === snapFilter) : runs;
  let o = `# ${gene} — network context\n\n`;
  if (maps.length) {
    const m = maps[0];
    o += `**STRING mapping (v${m.target_version}):** ${m.mapping_status}${m.resolved_identifier ? ` → ${m.resolved_identifier}` : ''}${m.mapping_method ? ` via ${m.mapping_method}` : ''}${m.note ? ` — ${m.note}` : ''}\n`;
    if (m.mapping_status === 'ABSENT_FROM_STRING') o += `_STRING v${m.target_version} has no protein for this symbol (non-coding genes, immunoglobulin/olfactory genes, and a known set of proteins missing from that release such as VEGFA, GPX1, VDR, AQP4). It can never receive a network score at this STRING version; this is a data-source gap, not zero centrality._\n`;
    o += `\n`;
  }
  if (!rows.length) {
    o += maps.length ? `No network run contains ${gene}.` : `No mapping or run rows for ${gene} — it is not in any loaded snapshot.`;
    return text(o);
  }
  o += `Each row is one run on one graph. **A WINNER score is a property of gene + graph + parameters** — never compare values across rows. The board uses the run marked primary.\n\n`;
  o += `| Run | Algorithm | Context | Status | Percentile | Rank | Raw/max | Degree | p-value | Primary |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) {
    o += `| ${r.run_id} | ${r.algorithm} | ${r.context_label} | ${r.status} | ${r.percentile != null ? Number(r.percentile).toFixed(1) : '—'} | ${r.rank_position ?? '—'}${r.node_count ? `/${r.node_count}` : ''} | ${fmt(r.norm_score)} | ${r.degree ?? '—'} | ${r.p_value != null ? fmt(r.p_value, 4) : '—'} | ${Number(r.is_primary) === 1 ? '✓' : ''} |\n`;
  }
  o += `\n_Status meanings — PRESENT: scored on that graph. NOT_IN_CANDIDATE_SET: in the snapshot but outside the graph's candidate rule (e.g. Agora-added genes past the Open Targets cutoff). ABSENT_FROM_GRAPH: a candidate with no STRING protein. p-value is the degree-preserving random-network null from the WINNER reference implementation; empty until computed._`;
  return text(o);
}

async function toolGetNetworkNeighbors(args) {
  const gene = String(args.gene || '').toUpperCase().trim();
  if (!gene) throw new Error('gene is required');
  const snap = await resolveSnapshot(args);
  const modality = modalityOf(args);
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 40));
  const [nbs, { bySymbol, total }, full] = await Promise.all([ords.stringNeighbors(gene, { limit }), boardFor(snap.id, modality), snapshotFull(snap.id)]);
  const prov = provenanceOf(full);
  const sc = await scores(snap.id);
  const scoreRow = new Map(sc.map(r => [String(r.gene_symbol).toUpperCase(), r]));
  const ad = isAD(snap);
  let o = `# ${gene} — STRING interaction partners, in the context of ${snap.disease_name}\n\n`;
  if (!nbs.length) return text(o + `No STRING partners at combined score ≥ 400 (or the symbol is unknown to STRING).`);
  const inSnap = nbs.filter(n => scoreRow.has(n.symbol)).length;
  o += `${nbs.length} partners from the live STRING API (score ≥ 0.4); ${inSnap} are in this snapshot. Use this to find better-ranked neighbours or to ask whether a high network score is just "many partners".\n\n`;
  o += `| Partner | STRING score | In snapshot | Board rank | Board score | Source |${ad ? ' Agora |' : ''}\n|---|---|---|---|---|---|${ad ? '---|' : ''}\n`;
  for (const n of nbs) {
    const b = bySymbol.get(n.symbol); const r = scoreRow.get(n.symbol);
    o += `| ${n.symbol} | ${n.score.toFixed(3)} | ${r ? '✓' : ''} | ${b ? `${b.boardRank}/${total}` : '—'} | ${b ? b.display.toFixed(1) : '—'} | ${r ? candidateSourceOf(r, prov) : '—'} |${ad ? ` ${isAgora(n.symbol) ? '✓' : ''} |` : ''}\n`;
  }
  o += `\n_Live STRING call; everything else is from the stored snapshot. A partner outside the snapshot has no board rank because it was not an Open Targets candidate for this disease._`;
  return text(o);
}

async function toolGetSnapshotProvenance(args) {
  const snap = await resolveSnapshot(args);
  const [full, sc, runs] = await Promise.all([snapshotFull(snap.id), scores(snap.id), ords.networkRuns(snap.id).catch(() => [])]);
  const prov = provenanceOf(full);
  const bySource = {};
  for (const r of sc) { const s = candidateSourceOf(r, prov); bySource[s] = (bySource[s] || 0) + 1; }
  let o = `# Snapshot #${snap.id} — ${snap.disease_name} (${snap.disease_id}) v${snap.version}\n\n`;
  o += `- **Created:** ${snap.created_at} by ${snap.created_by || '—'} · **genes:** ${snap.gene_count}\n`;
  o += `- **Genes by candidate source:** ${Object.entries(bySource).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}\n`;
  o += `\n## Candidate universe (Open Targets)\n`;
  const keys = ['ot_release', 'ot_release_inferred', 'ot_release_note', 'ot_api_version', 'candidate_rule', 'candidate_cutoff', 'n_associations_total', 'n_associations_total_note', 'n_selected', 'score_definition', 'query', 'retrieved_at', 'added_source', 'backfilled_at', 'backfilled_by', 'source', 'via'];
  for (const k of keys) if (prov[k] != null && prov[k] !== '') o += `- **${k}:** ${typeof prov[k] === 'object' ? JSON.stringify(prov[k]) : prov[k]}\n`;
  if (Array.isArray(prov.additions) && prov.additions.length) o += `- **additions:** ${prov.additions.map(a => `${a.count} × ${a.source} (${String(a.at).slice(0, 10)})`).join('; ')}\n`;
  const other = Object.keys(prov).filter(k => !keys.includes(k) && k !== 'additions');
  if (other.length) o += `- other keys: ${other.map(k => `${k}=${JSON.stringify(prov[k]).slice(0, 120)}`).join('; ')}\n`;
  if (runs.length) {
    o += `\n## Network runs on this snapshot\n| Run | Algorithm | Implementation | Graph | Nodes | Edges | Candidate rule | Primary | Created |\n|---|---|---|---|---|---|---|---|---|\n`;
    for (const r of runs) o += `| ${r.id} | ${r.algorithm} | ${r.implementation}${r.implementation_version ? ` ${r.implementation_version}` : ''} | ${r.graph_key} (STRING ${r.source_version}, ≥${r.min_score}) | ${r.node_count} | ${r.edge_count} | ${r.candidate_rule} | ${Number(r.is_primary) === 1 ? '✓' : ''} | ${String(r.created_at).slice(0, 10)} |\n`;
  }
  o += `\n_Fields marked inferred or "queried now" were not observable at harvest time and were backfilled; treat them as best-effort, not as the harvest's own record._`;
  return text(o);
}

// ════════════════════════════ TOOL REGISTRY ════════════════════════════

const diseaseArg = {
  disease: { type: 'string', description: 'Disease name or MONDO id (e.g. "Alzheimer", "pancreatic adenocarcinoma", "MONDO_0006047"). Optional — defaults to the most recently loaded snapshot.' },
  snapshot_id: { type: 'number', description: 'Exact snapshot id (from list_diseases). Overrides `disease` when given.' },
};
const modalityArg = { modality: { type: 'string', description: `Therapeutic modality whose weight vector to apply: ${Object.keys(MODALITY_PROFILES).join(' | ')}. Default small_molecule (the only validated one).` } };

const TOOLS = [
  {
    name: 'list_diseases',
    description: 'List the diseases currently loaded in Disease2Target (cancers and non-cancers), with snapshot id, version, gene count, candidate rule, Open Targets release, and last-updated date. Call this first to see what is available.',
    inputSchema: { type: 'object', properties: {} },
    handler: toolListDiseases,
  },
  {
    name: 'rank_board',
    description: 'The platform\'s composite ranking — the Ranking Board: eight evidence criteria (genetics, expression, dependency, tractability, safety, clinical, literature, network) in a transparent weighted sum, leader = 100, using the app\'s own scoring engine. Use for "what are the top targets for X?". Optional dataset="agora" restricts an Alzheimer snapshot to the 967 AMP-AD nominated targets (a view, not a re-score).',
    inputSchema: { type: 'object', properties: { ...diseaseArg, ...modalityArg, top_n: { type: 'number', description: 'How many top-ranked targets to return (default 25, max 500).' }, dataset: { type: 'string', description: '"all" (default) or "agora" (Alzheimer only).' } } },
    handler: toolRankBoard,
  },
  {
    name: 'rank_targets',
    description: 'The Open Targets association order the snapshot was built from (candidate selection), with the sparse OT datatype components and each gene\'s candidate source. This is NOT the composite ranking — use rank_board for that.',
    inputSchema: { type: 'object', properties: { ...diseaseArg, top_n: { type: 'number', description: 'How many top-ranked targets to return (default 25, max 500).' } } },
    handler: toolRankTargets,
  },
  {
    name: 'get_target_dossier',
    description: 'Full evidence dossier for one gene in a disease: board standing (rank, score, per-criterion), Open Targets association, identity, the fact axes (mutation, RNA and protein expression by source, dependency, safety, tissue, literature), disease-network centrality with its context, druggability with drug list, clinical trials, Agora nomination and candidate source. Facts and predictions are labelled separately.',
    inputSchema: { type: 'object', properties: { gene: { type: 'string', description: 'Gene symbol, e.g. APOE.' }, ...diseaseArg, ...modalityArg }, required: ['gene'] },
    handler: toolGetDossier,
  },
  {
    name: 'get_evidence',
    description: 'Raw evidence rows for one gene, optionally filtered to a single axis (expression, proteomics, dependency, safety, tissue, mutation, annotation, druggability, clinical, patents, literature, network). Lower-level than get_target_dossier.',
    inputSchema: { type: 'object', properties: { gene: { type: 'string', description: 'Gene symbol, e.g. KRAS.' }, axis: { type: 'string', description: 'Optional axis/evidence_type filter, e.g. "clinical" or "network".' }, ...diseaseArg }, required: ['gene'] },
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
    description: 'The discovery query: targets with NO developed drug (any indication) AND NO trial in this disease, but at least one tractable modality — druggable handles nobody has pursued. Ordered by board rank, so the top is "high priority and unpursued".',
    inputSchema: { type: 'object', properties: { ...diseaseArg, ...modalityArg, limit: { type: 'number', description: 'Max targets to return (default 50, max 500).' } } },
    handler: toolFindNovelTractable,
  },
  {
    name: 'get_network_context',
    description: 'Every network run\'s view of one gene (disease candidate graph, expanded graphs, global interactome when loaded) with its context label, STATUS (PRESENT / NOT_IN_CANDIDATE_SET / ABSENT_FROM_GRAPH), percentile, degree, p-value, and how the symbol mapped to STRING. Explains WHY a gene has or lacks a network score.',
    inputSchema: { type: 'object', properties: { gene: { type: 'string', description: 'Gene symbol, e.g. VEGFA.' }, snapshot_id: { type: 'number', description: 'Optional: restrict to runs on one snapshot.' } }, required: ['gene'] },
    handler: toolGetNetworkContext,
  },
  {
    name: 'get_network_neighbors',
    description: 'Live STRING interaction partners of a gene, annotated with each partner\'s board rank, score, candidate source and Agora status in the chosen disease. Use to find better-ranked neighbours or to judge whether a high network score is just "many partners".',
    inputSchema: { type: 'object', properties: { gene: { type: 'string', description: 'Gene symbol.' }, ...diseaseArg, ...modalityArg, limit: { type: 'number', description: 'Max partners (default 40, max 200).' } }, required: ['gene'] },
    handler: toolGetNetworkNeighbors,
  },
  {
    name: 'get_snapshot_provenance',
    description: 'How a snapshot was built: Open Targets release, query and score definition, candidate cutoff, association counts, genes by candidate source (OPEN_TARGETS vs appended e.g. AGORA), additions, and the network runs computed on it. Use before citing any number.',
    inputSchema: { type: 'object', properties: { ...diseaseArg } },
    handler: toolGetSnapshotProvenance,
  },
];

const HANDLERS = Object.fromEntries(TOOLS.map((t) => [t.name, t.handler]));

// ════════════════════════════ SERVER ════════════════════════════

const server = new Server(
  { name: 'disease2target', version: VERSION },
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

// Exported for test.js (direct calls without an MCP client).
export const __tools = HANDLERS;

if (!process.env.D2T_MCP_NO_LISTEN) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[disease2target-mcp] v${VERSION} ready · ORDS ${ords.baseUrl()} · ${TOOLS.length} tools`);
}
