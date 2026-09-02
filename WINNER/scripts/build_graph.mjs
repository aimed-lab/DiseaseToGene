// Build a WINNER input graph and record its provenance.
//
//   node build_graph.mjs --all                         --out runs/string_global
//   node build_graph.mjs --snapshot 103 --top 6000     --out runs/ad_ot_top6000   (needs ORDS_BASE_URL)
//   node build_graph.mjs --symbols genes.txt           --out runs/custom
//
// Writes into --out: GeneList.txt, Interaction.txt (upstream WINNER inputs), mapping.tsv
// (every input symbol with its resolution status) and graph.json (STRING version, threshold,
// node/edge counts, source-file checksums, candidate-set definition, timestamp).
// Then score with the lab's package:  winner --gene-list ... --interactions ... -o winnerResult.txt

import fs from 'node:fs';
import path from 'node:path';
import { loadStringIndex, loadOverrides, resolveSymbols, induceGraph, writeWinnerInputs, writeMapping, summariseMapping, STRING_VERSION } from './lib/stringGraph.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DATA = process.env.STRING_DIR || path.join(DIR, '..', 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);
const MIN_SCORE = Number(process.env.STRING_MIN_SCORE || 400);
const out = path.resolve(opt('--out', ''));
if (!out) { console.error('--out <dir> is required'); process.exit(1); }

const t0 = Date.now();
const lap = (m) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

let symbols = null, candidate = null;
if (has('--all')) {
  candidate = { type: 'STRING_GLOBAL', rule: 'every STRING protein with >=1 edge at threshold' };
} else if (has('--snapshot')) {
  const id = Number(opt('--snapshot')), top = Number(opt('--top', 0));
  const base = (process.env.ORDS_BASE_URL || '').replace(/\/+$/, '');
  if (!base) { console.error('ORDS_BASE_URL not set (run with node --env-file=../.env)'); process.exit(1); }
  const rows = [];
  for (let off = 0; ; off += 5000) {
    const r = await fetch(`${base}/d2t/snapshots/${id}/scores?limit=5000&offset=${off}`, { headers: { Accept: 'application/json' } });
    const it = (await r.json()).items || []; rows.push(...it); if (it.length < 5000) break;
  }
  rows.sort((a, b) => a.rank - b.rank);
  const chosen = top ? rows.filter(r => r.rank <= top) : rows;
  symbols = chosen.map(r => String(r.gene_symbol).toUpperCase());
  candidate = { type: 'SNAPSHOT', snapshot_id: id, rule: top ? `stored rank_position <= ${top}` : 'all snapshot genes', n_snapshot_genes: rows.length, n_selected: symbols.length };
  lap(`snapshot ${id}: ${rows.length} genes, ${symbols.length} selected`);
} else if (has('--symbols')) {
  symbols = fs.readFileSync(opt('--symbols'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  candidate = { type: 'LIST', file: opt('--symbols'), n_selected: symbols.length };
} else { console.error('one of --all | --snapshot <id> [--top N] | --symbols <file>'); process.exit(1); }

const index = await loadStringIndex(DATA);
lap(`STRING v${STRING_VERSION}: ${index.ensp2name.size.toLocaleString()} proteins, ${index.name2ensps.size.toLocaleString()} names, ${index.alias.size.toLocaleString()} curated aliases`);

let resolved = [];
if (symbols) {
  resolved = resolveSymbols(symbols, index, loadOverrides(path.join(DIR, '..', 'symbol_overrides.tsv')));
  const s = summariseMapping(resolved);
  lap(`mapping: ${Object.entries(s).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
}
const graph = await induceGraph(DATA, index, resolved, { minScore: MIN_SCORE, all: has('--all') });
const isolated = Array.from(graph.degree).filter(d => d === 0).length;
lap(`graph: ${graph.nodes.length.toLocaleString()} nodes | ${graph.edges.length.toLocaleString()} edges | ${isolated} isolated | mean degree ${(2 * graph.edges.length / graph.nodes.length).toFixed(1)}`);

fs.mkdirSync(out, { recursive: true });
writeWinnerInputs(out, graph);
if (symbols) writeMapping(path.join(out, 'mapping.tsv'), resolved);
fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify({
  built_at: new Date().toISOString(),
  string: { version: STRING_VERSION, species: '9606', min_combined_score: MIN_SCORE, files: index.checksums },
  graph_construction: 'induced subgraph on resolved nodes; isoforms (ENSPs sharing a preferred name) collapsed keeping the strongest edge; self-edges dropped',
  candidate_set: candidate,
  mapping: symbols ? summariseMapping(resolved) : null,
  nodes: graph.nodes.length, edges: graph.edges.length, isolated_nodes: isolated,
  links_rows_read: graph.rowsRead,
}, null, 2));
lap(`wrote ${path.relative(process.cwd(), out)}/{GeneList.txt, Interaction.txt${symbols ? ', mapping.tsv' : ''}, graph.json}`);
