// Disease-specific WINNER run, end to end, and (optionally) its load into Oracle.
//
//   node --env-file=../.env scripts/run_disease.mjs --snapshot 103 --top 6000            # compute only
//   node --env-file=../.env scripts/run_disease.mjs --snapshot 103 --top 6000 --load     # + write to Oracle (VPN)
//
// Pipeline (docs: Disease2Target_WINNER_Decisions.md §1-3):
//   snapshot genes with stored rank <= --top     -> candidate set (the Open Targets universe)
//   resolve symbols to STRING v12.0              -> mapping.tsv (EXACT / ALIAS / ... / ABSENT_FROM_STRING)
//   induced weighted subgraph                     -> GeneList.txt + Interaction.txt
//   `winner` CLI (aimed-lab/WINNER, winner-net)   -> winnerResult.txt        <- the lab's own code scores
//   raw/max, midrank percentile, degree, RWR      -> scores.tsv
//   cross-check: in-process sparse port vs the package (must agree to ~1e-9)
//   --load: network_graph + network_run + network_score (one row per snapshot gene, with STATUS)
//           + gene_identifier_mapping + the snapshot's EVIDENCE 'network' rows (what the board reads)
//
// --top defaults to provenance.candidate_cutoff on the snapshot, else every snapshot gene.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadStringIndex, loadOverrides, resolveSymbols, induceGraph, writeWinnerInputs, writeMapping, summariseMapping, STRING_VERSION, SPECIES } from './lib/stringGraph.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.join(DIR, '..');
const DATA = process.env.STRING_DIR || path.join(ROOT, 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const SNAPSHOT = Number(opt('--snapshot', 0));
if (!SNAPSHOT) { console.error('--snapshot <id> is required'); process.exit(1); }
const MIN_SCORE = Number(process.env.STRING_MIN_SCORE || 400);
const SIGMA = 0.85, ITER = 100;
const RWR_RESTART = 0.3, RWR_SEEDS = Number(opt('--seeds', process.env.WINNER_SEEDS || 12));
const LOAD = has('--load');
const ACTOR = opt('--actor', 'cli');

const t0 = Date.now();
const lap = (m) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// ── 0. the lab's package must be present ─────────────────────────────────────
const ver = spawnSync('winner', ['--version'], { encoding: 'utf8', shell: true });
if (ver.status !== 0) { console.error('`winner` CLI not found. pip install "git+https://github.com/aimed-lab/WINNER.git@v0.1.1-py#subdirectory=python"'); process.exit(1); }
const WINNER_VERSION = (ver.stdout || ver.stderr || '').trim();   // e.g. "winner 0.1.1"
lap(`scorer: ${WINNER_VERSION} (aimed-lab/WINNER, python)`);

// ── 1. snapshot: header + every gene with stored rank + candidate source ─────
const base = (process.env.ORDS_BASE_URL || '').replace(/\/+$/, '');
if (!base) { console.error('ORDS_BASE_URL not set'); process.exit(1); }
const get = async (p, q = {}) => {
  const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${base}/d2t/${p}${qs ? '?' + qs : ''}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`ORDS ${p} -> ${r.status}`);
  return r.json();
};
const snap = await get(`snapshots/${SNAPSHOT}`);
if (!snap?.id) { console.error(`snapshot ${SNAPSHOT} not found`); process.exit(1); }
let prov = {}; try { prov = typeof snap.provenance === 'string' ? JSON.parse(snap.provenance) : (snap.provenance || {}); } catch { /* ignore */ }
const rows = [];
for (let off = 0; ; off += 5000) {
  const j = await get(`snapshots/${SNAPSHOT}/scores`, { limit: 5000, offset: off });
  const it = j.items || []; rows.push(...it); if (it.length < 5000) break;
}
rows.sort((a, b) => a.rank - b.rank);
const TOP = Number(opt('--top', prov.candidate_cutoff || 0));
const candidateRule = TOP ? `stored rank_position <= ${TOP}` : 'all snapshot genes';
const candidates = TOP ? rows.filter(r => r.rank <= TOP) : rows;
const allSymbols = rows.map(r => String(r.gene_symbol).toUpperCase());
const candSymbols = candidates.map(r => String(r.gene_symbol).toUpperCase());
const candSet = new Set(candSymbols);
lap(`snapshot ${SNAPSHOT} "${snap.disease_name}": ${rows.length} genes · candidate set: ${candSymbols.length} (${candidateRule})`);

// ── 2. resolve + induce the graph ────────────────────────────────────────────
const index = await loadStringIndex(DATA);
const overrides = loadOverrides(path.join(ROOT, 'symbol_overrides.tsv'));
const resolvedAll = resolveSymbols(allSymbols, index, overrides);          // for the mapping table
const resolved = resolvedAll.filter(r => candSet.has(r.symbol));           // graph nodes come only from candidates
const mapSummary = summariseMapping(resolved);
lap(`mapping (candidates): ${Object.entries(mapSummary).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
const graph = await induceGraph(DATA, index, resolved, { minScore: MIN_SCORE });
const N = graph.nodes.length;
const isolated = Array.from(graph.degree).filter(d => d === 0).length;
lap(`graph: ${N.toLocaleString()} nodes | ${graph.edges.length.toLocaleString()} edges | ${isolated} isolated`);

const runName = opt('--out', `runs/s${SNAPSHOT}_top${TOP || 'all'}`);
const out = path.resolve(ROOT, runName);
fs.mkdirSync(out, { recursive: true });
writeWinnerInputs(out, graph);
writeMapping(path.join(out, 'mapping.tsv'), resolvedAll);

// ── 3. score with the lab's package ──────────────────────────────────────────
const res = spawnSync('winner', ['--gene-list', path.join(out, 'GeneList.txt'), '--interactions', path.join(out, 'Interaction.txt'), '-o', path.join(out, 'winnerResult.txt')], { encoding: 'utf8', shell: true });
if (res.status !== 0) { console.error(res.stderr || res.stdout); process.exit(1); }
const raw = new Float64Array(N);
const nodeIdx = new Map(graph.nodes.map((n, i) => [n, i]));
for (const line of fs.readFileSync(path.join(out, 'winnerResult.txt'), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const [g, , s] = line.split('\t'); const i = nodeIdx.get(g); if (i !== undefined) raw[i] = +s;
}
lap(`WINNER: scored ${N} nodes with ${WINNER_VERSION}`);

// ── 4. cross-check with the in-process sparse port (same maths, our code) ───
const off = new Int32Array(N + 1); for (let i = 0; i < N; i++) off[i + 1] = off[i] + graph.degree[i];
const nbr = new Int32Array(off[N]), wgt = new Float64Array(off[N]), cur = off.slice(0, N);
for (const [i, j, w] of graph.edges) { nbr[cur[i]] = j; wgt[cur[i]++] = w; nbr[cur[j]] = i; wgt[cur[j]++] = w; }
const wdeg = new Float64Array(N), init = new Float64Array(N);
for (let i = 0; i < N; i++) { let s = 0; for (let k = off[i]; k < off[i + 1]; k++) s += wgt[k]; wdeg[i] = s; const d = graph.degree[i]; init[i] = (d > 0 && s > 0) ? s * s / d : 0; }
let p = Float64Array.from(init);
for (let t = 0; t < ITER - 1; t++) {            // RunWinner.m: 99 updates after the initial column
  const pn = new Float64Array(N);
  for (let i = 0; i < N; i++) { let a = 0; for (let k = off[i]; k < off[i + 1]; k++) { const j = nbr[k]; if (wdeg[j] > 0) a += (wgt[k] / wdeg[j]) * p[j]; } pn[i] = (1 - SIGMA) * init[i] + SIGMA * a; }
  p = pn;
}
let maxDiff = 0; for (let i = 0; i < N; i++) maxDiff = Math.max(maxDiff, Math.abs(p[i] - raw[i]));
lap(`cross-check sparse port vs package: max |diff| = ${maxDiff.toExponential(2)} ${maxDiff < 1e-6 ? '(PASS)' : '(FAIL — investigate before loading)'}`);
if (maxDiff >= 1e-6 && LOAD) process.exit(1);

// ── 5. normalise, midrank percentile, rank ───────────────────────────────────
let maxRaw = 0; for (let i = 0; i < N; i++) if (raw[i] > maxRaw) maxRaw = raw[i];
const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => raw[b] - raw[a]);
const rank = new Int32Array(N); order.forEach((i, r) => { rank[i] = r + 1; });
const pct = new Float64Array(N);
{ // midrank: ties share the mean rank; percentile = 100 * (below + 0.5*ties) / N
  const asc = Array.from({ length: N }, (_, i) => i).sort((a, b) => raw[a] - raw[b]);
  let k = 0;
  while (k < N) { let e = k; while (e + 1 < N && raw[asc[e + 1]] === raw[asc[k]]) e++;
    const v = 100 * (k + 0.5 * (e - k + 1)) / N; for (let q = k; q <= e; q++) pct[asc[q]] = v; k = e + 1; }
}

// ── 6. RWR on the same graph, seeded with the top-K candidates by stored rank ─
// Separate exploratory analysis (§5.4): stored beside WINNER, not part of the criterion.
const seeds = candSymbols.filter(s => nodeIdx.has(s)).slice(0, RWR_SEEDS);
const seedIdx = seeds.map(s => nodeIdx.get(s));
let rwr = new Float64Array(N); const p0 = new Float64Array(N);
for (const i of seedIdx) p0[i] = 1 / seedIdx.length; rwr.set(p0);
for (let t = 0; t < 100; t++) {
  const nx = new Float64Array(N); let diff = 0;
  for (let i = 0; i < N; i++) { let a = 0; for (let k = off[i]; k < off[i + 1]; k++) { const j = nbr[k]; if (wdeg[j] > 0) a += (wgt[k] / wdeg[j]) * rwr[j]; } nx[i] = (1 - RWR_RESTART) * a + RWR_RESTART * p0[i]; diff += Math.abs(nx[i] - rwr[i]); }
  rwr = nx; if (diff < 1e-6) break;
}
let maxR = 0; for (let i = 0; i < N; i++) if (rwr[i] > maxR) maxR = rwr[i];
const seedSet = new Set(seeds);

// ── 7. per-gene status over the WHOLE snapshot ───────────────────────────────
const mapOf = new Map(resolvedAll.map(r => [r.symbol, r]));
const scoreRows = allSymbols.map(sym => {
  const m = mapOf.get(sym); const i = nodeIdx.get(sym);
  if (!candSet.has(sym)) return { gene_symbol: sym, string_name: m?.string_name ?? null, status: 'NOT_IN_CANDIDATE_SET' };
  if (i === undefined) return { gene_symbol: sym, string_name: null, status: 'ABSENT_FROM_GRAPH' };
  return { gene_symbol: sym, string_name: m.string_name, status: 'PRESENT', raw_score: raw[i], norm_score: raw[i] / maxRaw, percentile: pct[i],
    rank_position: rank[i], degree: graph.degree[i], weighted_degree: wdeg[i], rwr: rwr[i] / maxR, is_seed: seedSet.has(sym) };
});
const counts = {}; for (const r of scoreRows) counts[r.status] = (counts[r.status] || 0) + 1;
fs.writeFileSync(path.join(out, 'scores.tsv'), 'gene\tstring_name\tstatus\twinner_raw\twinner_norm\tpercentile\trank\tdegree\tweighted_degree\trwr\tis_seed\n' +
  scoreRows.map(r => [r.gene_symbol, r.string_name ?? '', r.status, r.raw_score?.toExponential(6) ?? '', r.norm_score?.toFixed(6) ?? '', r.percentile?.toFixed(2) ?? '', r.rank_position ?? '', r.degree ?? '', r.weighted_degree?.toFixed(3) ?? '', r.rwr?.toFixed(6) ?? '', r.is_seed == null ? '' : (r.is_seed ? 1 : 0)].join('\t')).join('\n') + '\n');
const contextLabel = `${snap.disease_name} / Open Targets top ${TOP ? TOP.toLocaleString() : rows.length.toLocaleString()} (snapshot ${SNAPSHOT})`;
const graphKey = `S${SNAPSHOT}_${TOP ? 'TOP' + TOP : 'ALL'}_STRING${STRING_VERSION}_${MIN_SCORE}`;
const meta = {
  built_at: new Date().toISOString(), snapshot_id: SNAPSHOT, disease_id: snap.disease_id, disease_name: snap.disease_name,
  candidate_rule: candidateRule, context_label: contextLabel, graph_key: graphKey,
  string: { version: STRING_VERSION, species: SPECIES, min_combined_score: MIN_SCORE, files: index.checksums },
  graph_construction: 'induced subgraph on resolved candidate symbols; isoforms (ENSPs sharing a preferred name) collapsed keeping the strongest edge; self-edges dropped',
  nodes: N, edges: graph.edges.length, isolated_nodes: isolated, mapping: mapSummary, status_counts: counts,
  winner: { implementation: 'winner-net (aimed-lab/WINNER python)', version: WINNER_VERSION, sigma: SIGMA, iterations: ITER, initialisation: 'wdeg^2/deg (RunWinner.m)', normalisation: 'raw/max; midrank percentile within run', crosscheck_max_diff: maxDiff },
  rwr: { restart: RWR_RESTART, seeds, seed_rule: `top ${RWR_SEEDS} candidates by stored rank` },
};
fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(meta, null, 2));
lap(`status: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' | ')} -> ${path.relative(process.cwd(), out)}/scores.tsv`);
console.log('\n  top 10:', order.slice(0, 10).map(i => `${graph.nodes[i]} ${pct[i].toFixed(1)}`).join(', '));
for (const g of ['APOE', 'APP', 'MAPT', 'TYK2', 'ALOX5', 'PTGES']) { const i = nodeIdx.get(g); if (i !== undefined) console.log(`  ${g.padEnd(6)} norm ${(raw[i] / maxRaw).toFixed(4)}  pct ${pct[i].toFixed(1)}  deg ${graph.degree[i]}  rwr ${(rwr[i] / maxR).toFixed(4)}`); }

if (!LOAD) { console.log('\n  (--load not given: nothing written to Oracle)\n'); process.exit(0); }

// ── 8. load into Oracle ──────────────────────────────────────────────────────
const { default: oracledb } = await import('oracledb');
oracledb.autoCommit = false;
const SCHEMA = process.env.ORACLE_SCHEMA || process.env.ORACLE_USER;
const T = (n) => `${SCHEMA}.${n}`;
const conn = await oracledb.getConnection({ user: process.env.ORACLE_USER, password: process.env.ORACLE_PASSWORD, connectString: process.env.ORACLE_CONNECT_STRING });
try {
  // graph (idempotent on graph_key: a rebuild replaces the previous graph and its runs)
  await conn.execute(`DELETE FROM ${T('network_graph')} WHERE graph_key = :k`, { k: graphKey });
  const gi = await conn.execute(
    `INSERT INTO ${T('network_graph')} (graph_key, graph_type, source, source_version, species, min_score, construction, snapshot_id, candidate_rule, node_count, edge_count, isolated_count, n_input_symbols, mapping_json, files_json)
     VALUES (:k, 'DISEASE_CANDIDATES', 'STRING', :v, :sp, :ms, :c, :s, :cr, :n, :e, :iso, :ni, :mj, :fj) RETURNING id INTO :id`,
    { k: graphKey, v: STRING_VERSION, sp: SPECIES, ms: MIN_SCORE, c: meta.graph_construction, s: SNAPSHOT, cr: candidateRule, n: N, e: graph.edges.length, iso: isolated, ni: candSymbols.length,
      mj: { val: JSON.stringify(mapSummary), type: oracledb.CLOB }, fj: { val: JSON.stringify(index.checksums), type: oracledb.CLOB }, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
  const graphId = gi.outBinds.id[0];
  // runs: this WINNER run becomes the snapshot's primary; earlier primaries step down
  await conn.execute(`UPDATE ${T('network_run')} SET is_primary = 0 WHERE snapshot_id = :s AND algorithm = 'WINNER'`, { s: SNAPSHOT });
  const ri = await conn.execute(
    `INSERT INTO ${T('network_run')} (graph_id, algorithm, implementation, implementation_version, sigma, iterations, initialisation, normalisation, disease_id, snapshot_id, candidate_rule, context_label, is_primary, params_json, created_by)
     VALUES (:g, 'WINNER', 'winner-net (aimed-lab/WINNER python)', :iv, :sig, :it, :ini, :nrm, :d, :s, :cr, :cl, 1, :pj, :actor) RETURNING id INTO :id`,
    { g: graphId, iv: WINNER_VERSION.slice(0, 40), sig: SIGMA, it: ITER, ini: meta.winner.initialisation, nrm: meta.winner.normalisation, d: snap.disease_id, s: SNAPSHOT, cr: candidateRule, cl: contextLabel.slice(0, 200),
      pj: { val: JSON.stringify({ crosscheck_max_diff: maxDiff, string_files: index.checksums }), type: oracledb.CLOB }, actor: ACTOR, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
  const runId = ri.outBinds.id[0];
  const rr = await conn.execute(
    `INSERT INTO ${T('network_run')} (graph_id, algorithm, implementation, implementation_version, sigma, iterations, initialisation, normalisation, disease_id, snapshot_id, candidate_rule, context_label, is_primary, params_json, created_by)
     VALUES (:g, 'RWR', 'd2t sparse RWR (rwr.ts maths)', NULL, :r, 100, 'uniform over seed set', 'raw/max within run', :d, :s, :cr, :cl, 0, :pj, :actor) RETURNING id INTO :id`,
    { g: graphId, r: RWR_RESTART, d: snap.disease_id, s: SNAPSHOT, cr: candidateRule, cl: `${contextLabel} · RWR seeds: top ${RWR_SEEDS}`.slice(0, 200),
      pj: { val: JSON.stringify({ seeds, restart: RWR_RESTART }), type: oracledb.CLOB }, actor: ACTOR, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
  const rwrRunId = rr.outBinds.id[0];

  // scores: one row per snapshot gene per run
  const SC = `INSERT INTO ${T('network_score')} (run_id, gene_symbol, string_name, raw_score, norm_score, percentile, rank_position, degree, weighted_degree, status)
              VALUES (:run_id, :gene_symbol, :string_name, :raw_score, :norm_score, :percentile, :rank_position, :degree, :weighted_degree, :status)`;
  const SC_DEFS = { run_id: { type: oracledb.NUMBER }, gene_symbol: { type: oracledb.STRING, maxSize: 64 }, string_name: { type: oracledb.STRING, maxSize: 64 }, raw_score: { type: oracledb.NUMBER }, norm_score: { type: oracledb.NUMBER }, percentile: { type: oracledb.NUMBER }, rank_position: { type: oracledb.NUMBER }, degree: { type: oracledb.NUMBER }, weighted_degree: { type: oracledb.NUMBER }, status: { type: oracledb.STRING, maxSize: 30 } };
  const nz = (v) => (v == null || !isFinite(v)) ? null : v;
  const wBinds = scoreRows.map(r => ({ run_id: runId, gene_symbol: r.gene_symbol, string_name: r.string_name ?? null, raw_score: nz(r.raw_score), norm_score: nz(r.norm_score), percentile: nz(r.percentile), rank_position: nz(r.rank_position), degree: nz(r.degree), weighted_degree: nz(r.weighted_degree), status: r.status }));
  const rBinds = scoreRows.map(r => ({ run_id: rwrRunId, gene_symbol: r.gene_symbol, string_name: r.string_name ?? null, raw_score: nz(r.rwr), norm_score: nz(r.rwr), percentile: null, rank_position: null, degree: nz(r.degree), weighted_degree: nz(r.weighted_degree), status: r.status }));
  for (const b of [wBinds, rBinds]) for (let i = 0; i < b.length; i += 1000) await conn.executeMany(SC, b.slice(i, i + 1000), { bindDefs: SC_DEFS });

  // identifier mapping (merge: one row per symbol per STRING version)
  const MG = `MERGE INTO ${T('gene_identifier_mapping')} m USING (SELECT :g AS gene_symbol FROM dual) s
              ON (m.gene_symbol = s.gene_symbol AND m.source = 'OPEN_TARGETS' AND m.target_source = 'STRING' AND m.target_version = :v)
              WHEN MATCHED THEN UPDATE SET resolved_identifier = :r, mapping_status = :st, mapping_method = :me, note = :nt, updated_at = SYSTIMESTAMP
              WHEN NOT MATCHED THEN INSERT (gene_symbol, source, target_source, target_version, resolved_identifier, mapping_status, mapping_method, note) VALUES (:g, 'OPEN_TARGETS', 'STRING', :v, :r, :st, :me, :nt)`;
  const MG_DEFS = { g: { type: oracledb.STRING, maxSize: 64 }, v: { type: oracledb.STRING, maxSize: 20 }, r: { type: oracledb.STRING, maxSize: 64 }, st: { type: oracledb.STRING, maxSize: 30 }, me: { type: oracledb.STRING, maxSize: 80 }, nt: { type: oracledb.STRING, maxSize: 400 } };
  const mBinds = resolvedAll.map(r => ({ g: r.symbol, v: STRING_VERSION, r: r.string_name ?? null, st: r.status, me: r.method || null, nt: r.note ? String(r.note).slice(0, 400) : null }));
  for (let i = 0; i < mBinds.length; i += 1000) await conn.executeMany(MG, mBinds.slice(i, i + 1000), { bindDefs: MG_DEFS });

  // the board's projection: EVIDENCE 'network' rows for PRESENT genes (replaces the whole axis)
  await conn.execute(`DELETE FROM ${T('evidence')} WHERE snapshot_id = :s AND evidence_type = 'network'`, { s: SNAPSHOT });
  const EV = `INSERT INTO ${T('evidence')} (snapshot_id, disease_id, gene_symbol, evidence_type, source, source_url, value_text, value_json, retrieved_at, generated_by, audit_status)
              VALUES (:snapshot_id, :disease_id, :gene_symbol, 'network', :source, NULL, :value_text, :value_json, SYSTIMESTAMP, :generated_by, 'not_audited')`;
  const EV_DEFS = { snapshot_id: { type: oracledb.NUMBER }, disease_id: { type: oracledb.STRING, maxSize: 100 }, gene_symbol: { type: oracledb.STRING, maxSize: 64 }, source: { type: oracledb.STRING, maxSize: 100 }, value_text: { type: oracledb.STRING, maxSize: 4000 }, value_json: { type: oracledb.CLOB }, generated_by: { type: oracledb.STRING, maxSize: 200 } };
  const source = `STRING v${STRING_VERSION} PPI (score>=${MIN_SCORE}) · WINNER (winner-net) + RWR`;
  const evBinds = scoreRows.filter(r => r.status === 'PRESENT').map(r => ({
    snapshot_id: SNAPSHOT, disease_id: snap.disease_id, gene_symbol: r.gene_symbol, source: source.slice(0, 100),
    value_text: `WINNER ${r.percentile.toFixed(1)}th pct (${r.norm_score.toFixed(3)}) · RWR ${r.rwr.toFixed(3)}${r.is_seed ? ' · seed' : ''} · ${contextLabel}`.slice(0, 4000),
    value_json: JSON.stringify({
      axis: r.percentile / 100, direction: 'pro',
      display: `disease-network centrality ${r.percentile.toFixed(1)}th percentile (WINNER, ${contextLabel})`,
      winner_score: +r.norm_score.toFixed(4), winner_raw: +r.raw_score.toFixed(6), winner_pct: +r.percentile.toFixed(2), winner_rank: r.rank_position,
      degree: r.degree, rwr_score: +r.rwr.toFixed(4), is_seed: r.is_seed,
      ranking_pval: null, expansion_pval: null,
      run_id: runId, rwr_run_id: rwrRunId, graph_key: graphKey, context: contextLabel, status: 'PRESENT',
      n_network_genes: N, n_edges: graph.edges.length, implementation: WINNER_VERSION,
    }),
    generated_by: 'WINNER/scripts/run_disease.mjs',
  }));
  for (let i = 0; i < evBinds.length; i += 1000) await conn.executeMany(EV, evBinds.slice(i, i + 1000), { bindDefs: EV_DEFS });

  await conn.execute(`INSERT INTO ${T('audit_log')} (event_time, actor, action, entity, entity_id, disease_id, details) VALUES (SYSTIMESTAMP, :a, 'network_run_loaded', 'network_run', :e, :d, :j)`,
    { a: ACTOR, e: String(runId), d: snap.disease_id, j: { val: JSON.stringify({ graph_key: graphKey, run_id: runId, rwr_run_id: rwrRunId, status_counts: counts, evidence_rows: evBinds.length }), type: oracledb.CLOB } });
  await conn.commit();
  lap(`loaded: graph #${graphId} · WINNER run #${runId} (primary) · RWR run #${rwrRunId} · ${scoreRows.length} score rows x2 · ${mBinds.length} mappings · ${evBinds.length} evidence rows`);
  console.log('\n  Restart the dev server (dashCache / progLoads hold the old network rows).\n');
} catch (e) {
  try { await conn.rollback(); } catch { /* ignore */ }
  console.error('LOAD FAILED (rolled back):', e.message);
  process.exitCode = 1;
} finally { await conn.close(); }
