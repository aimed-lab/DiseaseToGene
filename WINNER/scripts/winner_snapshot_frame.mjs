// Gate: does the sparse rewrite reproduce the numbers already in snapshot 103?
// Induce the same top-2000 node set from the local STRING file, run sparse WINNER,
// and compare against the stored winner_score. If these disagree, the full-interactome
// run above is not trustworthy either.

import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const STRING_DIR = process.env.STRING_DIR || path.join(DIR, '..', 'data');
const base = (process.env.ORDS_BASE_URL || '').replace(/\/+$/, '');
const MIN_SCORE = 400, SIGMA = 0.85, MAX_ITER = 100;

const get = async (p, q = {}) => {
  const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${base}/d2t/${p}?${qs}`, { headers: { Accept: 'application/json' } });
  return r.ok ? r.json() : { items: [] };
};

// ── stored: node set (top 2000 by rank) and the winner_scores we must match ──
const ranked = [];
for (let off = 0; off < 12000; off += 5000) {
  const j = await get('snapshots/103/scores', { limit: 5000, offset: off });
  const it = j.items || []; ranked.push(...it);
  if (it.length < 5000) break;
}
ranked.sort((a, b) => a.rank - b.rank);
const nodeSet = ranked.slice(0, 6000).map(r => String(r.gene_symbol).toUpperCase());

const stored = new Map();
for (let off = 0; off < 60000; off += 10000) {
  const j = await get('snapshots/103/evidence', { limit: 10000, offset: off });
  const it = j.items || [];
  for (const r of it) {
    if (r.evidence_type !== 'network') continue;
    let v = r.value_json; try { v = typeof v === 'string' ? JSON.parse(v) : v; } catch { continue; }
    if (v?.winner_score != null) stored.set(String(r.gene_symbol).toUpperCase(), v.winner_score);
  }
  if (it.length < 10000) break;
}
console.log(`\nnode set: ${nodeSet.length} · stored winner_scores: ${stored.size}`);

// ── induce the subgraph from the local STRING file ──
const want = new Set(nodeSet);
const ensp2sym = new Map();
const rl = (f) => readline.createInterface({ input: fs.createReadStream(f).pipe(zlib.createGunzip()), crlfDelay: Infinity });
for await (const line of rl(path.join(STRING_DIR, '9606.protein.info.v12.0.txt.gz'))) {
  if (line.startsWith('#') || !line.trim()) continue;
  const [id, name] = line.split('\t');
  if (id && name && want.has(name.toUpperCase())) ensp2sym.set(id, name.toUpperCase());
}
const idx = new Map(nodeSet.map((s, i) => [s, i]));
const N = nodeSet.length;
const edgeW = new Map();
for await (const line of rl(path.join(STRING_DIR, '9606.protein.links.v12.0.txt.gz'))) {
  if (!line || line.startsWith('protein1')) continue;
  const sp = line.split(' ');
  const s = +sp[2]; if (!(s >= MIN_SCORE)) continue;
  const a = ensp2sym.get(sp[0]), b = ensp2sym.get(sp[1]);
  if (!a || !b || a === b) continue;
  const i = idx.get(a), j = idx.get(b);
  if (i === undefined || j === undefined) continue;
  const key = i < j ? `${i}|${j}` : `${j}|${i}`;
  const w = s / 1000, prev = edgeW.get(key);
  if (prev === undefined || w > prev) edgeW.set(key, w);
}
console.log(`induced subgraph: ${edgeW.size.toLocaleString()} edges (app recorded 39,950 from the live API)`);

// ── same sparse WINNER ──
const deg = new Int32Array(N);
for (const k of edgeW.keys()) { const p = k.indexOf('|'); deg[+k.slice(0, p)]++; deg[+k.slice(p + 1)]++; }
const off2 = new Int32Array(N + 1);
for (let i = 0; i < N; i++) off2[i + 1] = off2[i] + deg[i];
const nbr = new Int32Array(off2[N]), wgt = new Float64Array(off2[N]), cur = off2.slice(0, N);
for (const [k, w] of edgeW) { const p = k.indexOf('|'); const i = +k.slice(0, p), j = +k.slice(p + 1);
  nbr[cur[i]] = j; wgt[cur[i]++] = w; nbr[cur[j]] = i; wgt[cur[j]++] = w; }
const rowSum = new Float64Array(N), initial = new Float64Array(N);
for (let i = 0; i < N; i++) { let s = 0; for (let k = off2[i]; k < off2[i + 1]; k++) s += wgt[k];
  rowSum[i] = s; const d = off2[i + 1] - off2[i]; initial[i] = (d > 0 && s > 0) ? (s * s) / d : 0; }
let p = Float64Array.from(initial);
for (let t = 0; t < MAX_ITER; t++) {
  const atp = new Float64Array(N);
  for (let i = 0; i < N; i++) { let a = 0;
    for (let k = off2[i]; k < off2[i + 1]; k++) { const j = nbr[k]; if (rowSum[j] > 0) a += (wgt[k] / rowSum[j]) * p[j]; }
    atp[i] = a; }
  const pn = new Float64Array(N);
  for (let i = 0; i < N; i++) pn[i] = (1 - SIGMA) * initial[i] + SIGMA * atp[i];
  p = pn;
}
let maxP = 0; for (let i = 0; i < N; i++) if (p[i] > maxP) maxP = p[i];

const order = Array.from({length:N},(_,i)=>i).sort((a,b)=>p[b]-p[a]);
const rank = new Int32Array(N); order.forEach((i,r)=>{rank[i]=r+1;});
console.log(`
=== The five genes, scored against the snapshot's own 6,000 genes ===
`);
console.log('  gene       WINNER    rank         percentile  degree');
console.log('  '+'-'.repeat(54));
for (const g of ['ALOX15','AKR1C3','TYK2','PTGES','ALOX5']) {
  const i = idx.get(g);
  if (i === undefined) { console.log(`  ${g.padEnd(10)} absent`); continue; }
  const pct = 100*(1-(rank[i]-1)/N);
  console.log(`  ${g.padEnd(10)} ${(p[i]/maxP).toFixed(4).padStart(7)}   ${String(rank[i]).padStart(5)}/${N}    ${pct.toFixed(1).padStart(5)}%     ${String(off2[i+1]-off2[i]).padStart(5)}`);
}
console.log(`
  (network now spans ${N} genes and ${edgeW.size.toLocaleString()} edges, vs 2,000 / 39,950 before)
`);
