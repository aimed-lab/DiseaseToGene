// Sparse WINNER over the full human interactome.
//
// Mathematically identical to winner.ts — same initial score (wSum²/deg), same
// row-normalised transition, same sigma 0.85, same 100 iterations. The only change
// is that it never materialises the N×N matrix: at 19,600 proteins that would be
// 384 million entries, which is why the in-app version is capped at a node set.
//
// Usage:
//   node winner_full.mjs                    → full interactome
//   node winner_full.mjs --nodes genes.txt  → restrict to a node set (validation)

import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const STRING_DIR = process.env.STRING_DIR || path.join(DIR, '..', 'data');
const MIN_SCORE = Number(process.env.STRING_MIN_SCORE || 400);
const SIGMA = 0.85, MAX_ITER = 100;

const TARGETS = ['ALOX15', 'AKR1C3', 'TYK2', 'PTGES', 'ALOX5'];

const t0 = Date.now();
const lap = (m) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const stream = (file) => readline.createInterface({
  input: fs.createReadStream(file).pipe(zlib.createGunzip()),
  crlfDelay: Infinity,
});

// ── 1. ENSP → gene symbol ────────────────────────────────────────────────────
console.log('\nWINNER over the full STRING v12.0 human interactome\n');
const ensp2sym = new Map();
for await (const line of stream(path.join(STRING_DIR, '9606.protein.info.v12.0.txt.gz'))) {
  if (line.startsWith('#') || !line.trim()) continue;
  const [id, name] = line.split('\t');
  if (id && name) ensp2sym.set(id, name.toUpperCase());
}
lap(`protein.info: ${ensp2sym.size.toLocaleString()} proteins mapped to symbols`);

// ── 2. Edges, collapsed to gene symbols ──────────────────────────────────────
// Several ENSPs can share a symbol; keep the strongest edge for a symbol pair so a
// gene is not double-counted by its own isoforms.
const idx = new Map();          // symbol -> index
const sym = [];                 // index -> symbol
const nodeOf = (s) => { let i = idx.get(s); if (i === undefined) { i = sym.length; idx.set(s, i); sym.push(s); } return i; };
const edgeW = new Map();        // "a|b" (a<b) -> score 0..1

let read = 0, kept = 0;
for await (const line of stream(path.join(STRING_DIR, '9606.protein.links.v12.0.txt.gz'))) {
  if (!line || line.startsWith('protein1')) continue;
  read++;
  const sp = line.split(' ');
  const s = +sp[2];
  if (!(s >= MIN_SCORE)) continue;
  const a = ensp2sym.get(sp[0]), b = ensp2sym.get(sp[1]);
  if (!a || !b || a === b) continue;
  const i = nodeOf(a), j = nodeOf(b);
  const key = i < j ? `${i}|${j}` : `${j}|${i}`;
  const w = s / 1000;
  const prev = edgeW.get(key);
  if (prev === undefined || w > prev) edgeW.set(key, w);
  kept++;
}
const N = sym.length;
lap(`protein.links: ${read.toLocaleString()} rows read · ${edgeW.size.toLocaleString()} unique symbol-pair edges at score>=${MIN_SCORE} · ${N.toLocaleString()} genes`);

// ── 3. CSR adjacency (both directions — the matrix is symmetric) ─────────────
const deg = new Int32Array(N);
for (const key of edgeW.keys()) { const p = key.indexOf('|'); deg[+key.slice(0, p)]++; deg[+key.slice(p + 1)]++; }
const off = new Int32Array(N + 1);
for (let i = 0; i < N; i++) off[i + 1] = off[i] + deg[i];
const nbr = new Int32Array(off[N]);
const wgt = new Float64Array(off[N]);
const cur = off.slice(0, N);
for (const [key, w] of edgeW) {
  const p = key.indexOf('|'); const i = +key.slice(0, p), j = +key.slice(p + 1);
  nbr[cur[i]] = j; wgt[cur[i]++] = w;
  nbr[cur[j]] = i; wgt[cur[j]++] = w;
}
lap(`graph: ${N.toLocaleString()} nodes · ${(off[N] / 2).toLocaleString()} edges · mean degree ${(off[N] / N).toFixed(1)}`);

// ── 4. WINNER ────────────────────────────────────────────────────────────────
// initialScore = wSum^2 / degree  (winner.ts step 2)
const rowSum = new Float64Array(N), initial = new Float64Array(N);
for (let i = 0; i < N; i++) {
  let s = 0; for (let k = off[i]; k < off[i + 1]; k++) s += wgt[k];
  rowSum[i] = s;
  const d = off[i + 1] - off[i];
  initial[i] = (d > 0 && s > 0) ? (s * s) / d : 0;
}
// A[j][i] = w(j,i)/rowSum[j];  Atp[i] = sum over neighbours j of A[j][i]*p[j]
let p = Float64Array.from(initial);
for (let t = 0; t < MAX_ITER; t++) {
  const atp = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nbr[k];
      if (rowSum[j] > 0) acc += (wgt[k] / rowSum[j]) * p[j];
    }
    atp[i] = acc;
  }
  const pn = new Float64Array(N);
  for (let i = 0; i < N; i++) pn[i] = (1 - SIGMA) * initial[i] + SIGMA * atp[i];
  p = pn;
}
lap(`WINNER: ${MAX_ITER} iterations complete`);

// ── 5. Normalise and report ──────────────────────────────────────────────────
let maxP = 0; for (let i = 0; i < N; i++) if (p[i] > maxP) maxP = p[i];
const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => p[b] - p[a]);
const rank = new Int32Array(N);
order.forEach((i, r) => { rank[i] = r + 1; });

console.log(`\n=== Your five genes ===\n`);
console.log('  gene       WINNER    rank        percentile   degree');
console.log('  ' + '-'.repeat(56));
for (const g of TARGETS) {
  const i = idx.get(g);
  if (i === undefined) { console.log(`  ${g.padEnd(10)} not present in STRING at this threshold`); continue; }
  const norm = p[i] / maxP;
  const pct = 100 * (1 - (rank[i] - 1) / N);
  console.log(`  ${g.padEnd(10)} ${norm.toFixed(4).padStart(7)}   ${String(rank[i]).padStart(6)}/${N}   ${pct.toFixed(1).padStart(5)}%      ${String(off[i + 1] - off[i]).padStart(5)}`);
}

console.log(`\n=== Top 10 overall (sanity: expect well-connected hubs) ===`);
order.slice(0, 10).forEach((i, r) => console.log(`  ${String(r + 1).padStart(3)}. ${sym[i].padEnd(10)} ${(p[i] / maxP).toFixed(4)}  deg ${off[i + 1] - off[i]}`));

// Correlation between WINNER and raw degree — the SRC study found rho 0.965.
const ranksW = rank;
const degOrder = Array.from({ length: N }, (_, i) => i).sort((a, b) => (off[b + 1] - off[b]) - (off[a + 1] - off[a]));
const rankD = new Int32Array(N); degOrder.forEach((i, r) => { rankD[i] = r + 1; });
let sd = 0; for (let i = 0; i < N; i++) { const d = ranksW[i] - rankD[i]; sd += d * d; }
const rho = 1 - (6 * sd) / (N * (N * N - 1));
console.log(`\n  Spearman(WINNER, degree) = ${rho.toFixed(3)}  — the SRC study reported 0.965 on a smaller network.`);

const out = path.join(DIR, '..', 'out', 'winner_full_scores.tsv');
fs.writeFileSync(out, 'gene\twinner_norm\twinner_raw\trank\tdegree\n' +
  order.map(i => `${sym[i]}\t${(p[i] / maxP).toFixed(6)}\t${p[i].toExponential(6)}\t${rank[i]}\t${off[i + 1] - off[i]}`).join('\n') + '\n');
console.log(`\n  All ${N.toLocaleString()} scores written to ${path.basename(out)}\n`);
