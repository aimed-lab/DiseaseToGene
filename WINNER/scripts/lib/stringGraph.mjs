// Shared STRING v12.0 graph builder.
//
// One place that (1) resolves Open Targets symbols to STRING proteins with an explicit
// mapping status, (2) induces the weighted subgraph over any node list, collapsing
// isoforms the same way the full-interactome run does, and (3) writes the two input
// files the upstream WINNER package reads (GeneList.txt + Interaction.txt), so the
// lab's own code does the scoring.
//
// Symbol resolution is deliberately conservative. STRING's alias file mixes curated
// HGNC symbols with KEGG disease synonyms: "VDR" resolves to CYP27B1 through
// KEGG_NAME_SYNONYM (vitamin-D-dependent rickets), which is wrong. Only HGNC- and
// UniProt-curated sources are used, in priority order, and an alias that points to
// more than one protein at its best tier is reported AMBIGUOUS rather than guessed.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import crypto from 'node:crypto';

export const STRING_VERSION = '12.0';
export const SPECIES = '9606';
export const FILES = {
  info: `9606.protein.info.v${STRING_VERSION}.txt.gz`,
  links: `9606.protein.links.v${STRING_VERSION}.txt.gz`,
  aliases: `9606.protein.aliases.v${STRING_VERSION}.txt.gz`,
};

// Alias sources accepted, best first. Anything not listed is ignored.
export const ALIAS_TIERS = [
  'Ensembl_HGNC_symbol',          // current HGNC symbol (usually == preferred_name)
  'Ensembl_HGNC_prev_symbol',     // HGNC previous symbols: the rename case (PHB1 <- PHB)
  'Ensembl_HGNC_alias_symbol',    // HGNC alias symbols (BMAL1 <- ARNTL)
  'UniProt_GN_Name',              // UniProt primary gene name (ACP3 <- ACPP)
  'KEGG_NAME',                    // KEGG primary name, tracks current HGNC (CYRIB, POLR1G)
  'Ensembl_external_synonym_HGNC',
];

const stream = (file) => readline.createInterface({
  input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity,
});

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 1. Load protein names + curated aliases
export async function loadStringIndex(dataDir) {
  const t0 = Date.now();
  const ensp2name = new Map();            // ENSP -> preferred_name (upper-cased)
  const name2ensps = new Map();           // preferred_name -> [ENSP...] (isoform groups)
  for await (const line of stream(path.join(dataDir, FILES.info))) {
    if (line.startsWith('#') || !line.trim()) continue;
    const [id, name] = line.split('\t');
    if (!id || !name) continue;
    const u = name.toUpperCase();
    ensp2name.set(id, u);
    let g = name2ensps.get(u); if (!g) name2ensps.set(u, g = []); g.push(id);
  }
  // alias(upper) -> Map(tierIndex -> Set(preferred_name))
  const alias = new Map();
  const tierIdx = new Map(ALIAS_TIERS.map((s, i) => [s, i]));
  for await (const line of stream(path.join(dataDir, FILES.aliases))) {
    if (line.startsWith('#')) continue;
    const [id, a, src] = line.split('\t');
    const t = tierIdx.get(src); if (t === undefined) continue;
    const pref = ensp2name.get(id); if (!pref) continue;
    const u = a.toUpperCase();
    let m = alias.get(u); if (!m) alias.set(u, m = new Map());
    let s = m.get(t); if (!s) m.set(t, s = new Set());
    s.add(pref);
  }
  const checksums = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, sha256(path.join(dataDir, f))]));
  return { ensp2name, name2ensps, alias, checksums, loadMs: Date.now() - t0 };
}

export function loadOverrides(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [sym, name, reason] = line.split('\t');
    if (sym && name) out.set(sym.toUpperCase(), { name: name.toUpperCase(), reason: reason || '' });
  }
  return out;
}

// 2. Resolve input symbols to STRING preferred names, with a status each.
// status: EXACT | ALIAS | OVERRIDE | AMBIGUOUS | COLLISION | ABSENT_FROM_STRING
export function resolveSymbols(symbols, index, overrides = new Map()) {
  const rows = [];
  const exactClaimed = new Set();
  const inputs = symbols.map(s => String(s).toUpperCase().trim());
  for (const s of inputs) if (index.name2ensps.has(s)) exactClaimed.add(s);

  for (const s of inputs) {
    if (index.name2ensps.has(s)) { rows.push({ symbol: s, string_name: s, status: 'EXACT', method: 'preferred_name', note: '' }); continue; }
    const ov = overrides.get(s);
    if (ov) {
      if (!index.name2ensps.has(ov.name)) rows.push({ symbol: s, string_name: null, status: 'ABSENT_FROM_STRING', method: 'override', note: `override target ${ov.name} not in STRING` });
      else if (exactClaimed.has(ov.name)) rows.push({ symbol: s, string_name: null, status: 'COLLISION', method: 'override', note: `${ov.name} is itself an input symbol` });
      else rows.push({ symbol: s, string_name: ov.name, status: 'OVERRIDE', method: 'symbol_overrides.tsv', note: ov.reason });
      continue;
    }
    const m = index.alias.get(s);
    if (!m) { rows.push({ symbol: s, string_name: null, status: 'ABSENT_FROM_STRING', method: '', note: '' }); continue; }
    let resolved = null;
    for (let t = 0; t < ALIAS_TIERS.length; t++) {
      const set = m.get(t); if (!set) continue;
      if (set.size > 1) { resolved = { status: 'AMBIGUOUS', method: ALIAS_TIERS[t], note: [...set].join('|') }; break; }
      const name = [...set][0];
      if (exactClaimed.has(name)) { resolved = { status: 'COLLISION', method: ALIAS_TIERS[t], note: `${name} is itself an input symbol` }; break; }
      resolved = { status: 'ALIAS', method: ALIAS_TIERS[t], name, note: '' }; break;
    }
    rows.push({ symbol: s, string_name: resolved?.name ?? null, status: resolved.status, method: resolved.method, note: resolved.note });
  }
  return rows;
}

// 3. Induce the weighted subgraph over the resolved nodes.
// Node = input symbol. Its proteins = every ENSP whose preferred name is the resolved
// name (isoforms collapse; strongest edge kept), identical to the full-interactome run.
// Pass `all: true` to take every STRING protein as a node (the global graph).
export async function induceGraph(dataDir, index, resolved, { minScore = 400, all = false } = {}) {
  const t0 = Date.now();
  const nodes = [];                       // node index -> symbol
  const ensp2node = new Map();
  if (all) {
    for (const [name, ensps] of index.name2ensps) { const i = nodes.length; nodes.push(name); for (const e of ensps) ensp2node.set(e, i); }
  } else {
    for (const r of resolved) {
      if (!r.string_name) continue;
      const i = nodes.length; nodes.push(r.symbol);
      for (const e of index.name2ensps.get(r.string_name)) ensp2node.set(e, i);
    }
  }
  const edgeW = new Map();                // "i|j" (i<j) -> weight 0..1
  let read = 0;
  for await (const line of stream(path.join(dataDir, FILES.links))) {
    if (!line || line.startsWith('protein1')) continue;
    read++;
    const sp = line.split(' ');
    const s = +sp[2]; if (!(s >= minScore)) continue;
    const i = ensp2node.get(sp[0]); if (i === undefined) continue;
    const j = ensp2node.get(sp[1]); if (j === undefined || i === j) continue;
    const key = i < j ? `${i}|${j}` : `${j}|${i}`;
    const w = s / 1000, prev = edgeW.get(key);
    if (prev === undefined || w > prev) edgeW.set(key, w);
  }
  const degree = new Int32Array(nodes.length);
  const edges = [];
  for (const [key, w] of edgeW) {
    const p = key.indexOf('|'); const i = +key.slice(0, p), j = +key.slice(p + 1);
    degree[i]++; degree[j]++; edges.push([i, j, w]);
  }
  return { nodes, edges, degree, rowsRead: read, minScore, buildMs: Date.now() - t0 };
}

// 4. Upstream WINNER input files.
// GeneList.txt: Gene / IsSeeded (all S: simple mode ranks the whole list)
// Interaction.txt: #node1 / node2 / combined_score in [0,1]
export function writeWinnerInputs(dir, graph) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'GeneList.txt'), 'Gene\tIsSeeded\n' + graph.nodes.map(n => `${n}\tS`).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'Interaction.txt'), '#node1\tnode2\tcombined_score\n' +
    graph.edges.map(([i, j, w]) => `${graph.nodes[i]}\t${graph.nodes[j]}\t${w}`).join('\n') + '\n');
}

export function writeMapping(file, resolved) {
  fs.writeFileSync(file, 'symbol\tstring_name\tstatus\tmethod\tnote\n' +
    resolved.map(r => [r.symbol, r.string_name ?? '', r.status, r.method, r.note].join('\t')).join('\n') + '\n');
}

export function summariseMapping(resolved) {
  const c = {}; for (const r of resolved) c[r.status] = (c[r.status] || 0) + 1; return c;
}
