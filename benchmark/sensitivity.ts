// benchmark/sensitivity.ts ────────────────────────────────────────────────────
// Does the ranking actually depend on what we say it depends on?
//
//   npx tsx --env-file=.env benchmark/sensitivity.ts <snapshotId> [--modality small_molecule]
//
// Reads through ORDS, so it runs off the VPN. Three analyses, each answering a question a
// reviewer will ask and none of which we could previously answer with a number:
//
//   1. CRITERION CORRELATION — are the criteria measuring different things? Two criteria
//      correlated at 0.9 are one criterion with two weights, and the composite is then
//      double counting whatever they share. Spearman, because these are bounded scores
//      with skewed distributions, not normal variables.
//
//   2. LEAVE ONE OUT — how much does the leaderboard move if a criterion is deleted? A
//      criterion whose removal changes nothing is decoration. One whose removal reorders
//      everything is really the ranking, whatever the weights claim.
//
//   3. WEIGHT SENSITIVITY — the weights were set by eye, so the honest question is whether
//      that matters. Perturb each weight and measure how far the top of the board travels.
//      If a 25% wobble reorders the top 50, the weights need calibration before the
//      ranking can be quoted. If it barely moves, the weights are not where the risk is.
//
// Stability is reported as Jaccard overlap of the top-K set and as Spearman rank
// correlation over the genes present in both orderings.
import { deriveBoardRows } from '../boardRows.ts';
import { CRITERIA, criterionScores, MODALITY_PROFILES, type CriterionKey } from '../rankingBoard.ts';

const argv = process.argv.slice(2);
const snapshotId = Number(argv.find(a => /^\d+$/.test(a)));
const mi = argv.indexOf('--modality');
const modality = mi >= 0 && argv[mi + 1] && !argv[mi + 1].startsWith('--') ? argv[mi + 1] : 'small_molecule';
const TOP_K = 50;

if (!snapshotId) {
  console.error('usage: npx tsx --env-file=.env benchmark/sensitivity.ts <snapshotId> [--modality small_molecule]');
  process.exit(2);
}

// ── stats ───────────────────────────────────────────────────────────────────
function rank(xs: number[]): number[] {
  // Average ranks for ties, which matters here: criteria are heavily tied at 0 and 1.
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}
const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
};

// ── scoring, mirroring buildBoard's composite exactly ───────────────────────
const CORE = new Set<CriterionKey>(['genetics', 'expression', 'dependency', 'tractability', 'safety']);
function score(rows: any[], weights: Record<string, number>) {
  return rows.map(r => {
    const c = r.__criteria as Record<CriterionKey, number | null>;
    let num = 0, den = 0;
    for (const def of CRITERIA) {
      const w = weights[def.key] ?? 0;
      if (w <= 0) continue;
      const v = c[def.key];
      if (v != null) { num += v * w; den += w; }
      else if (CORE.has(def.key)) { den += w; }
    }
    return { symbol: r.gene_symbol as string, overall: den > 0 ? num / den : 0 };
  }).sort((x, y) => y.overall - x.overall);
}
const order = (s: { symbol: string }[]) => s.map(x => x.symbol);
function compare(base: { symbol: string; overall: number }[], other: { symbol: string; overall: number }[]) {
  const oa = order(base), ob = order(other);
  const posB = new Map(ob.map((g, i) => [g, i]));
  const common = oa.filter(g => posB.has(g));
  const rho = spearman(common.map((_, i) => i), common.map(g => posB.get(g)!));
  return { topK: jaccard(oa.slice(0, TOP_K), ob.slice(0, TOP_K)), rho };
}

// ── load ────────────────────────────────────────────────────────────────────
const ords = await import('../ordsService.js');
if (!ords.ordsEnabled?.()) {
  console.error('ORDS is not configured. Set USE_ORDS=1 and ORDS_BASE_URL in .env.');
  process.exit(2);
}
process.stderr.write(`loading snapshot #${snapshotId} through ORDS…\n`);
const [meta, scores, evidence] = await Promise.all([
  ords.getSnapshot(snapshotId), ords.listRankingScores(snapshotId), ords.snapshotEvidence(snapshotId),
]);
if (!meta) { console.error(`snapshot #${snapshotId} not found`); process.exit(2); }

const rows = deriveBoardRows(scores as any[], evidence as any[]);
for (const r of rows) r.__criteria = criterionScores(r, { modality } as any);

// The weights the BOARD actually scores with come from the modality profile, not from the
// snapshot row. An earlier version of this script read snapshot.weights, which is unset on
// these snapshots, so it silently fell back to equal weights and then reported that equal
// weights change nothing — trivially true, and meaningless.
const profile = (MODALITY_PROFILES as any)[modality];
if (!profile) {
  console.error(`unknown modality "${modality}". Known: ${Object.keys(MODALITY_PROFILES).join(', ')}`);
  process.exit(2);
}
const weights: Record<string, number> = { ...profile.weights };

console.log(`\nSnapshot #${snapshotId} — ${(meta as any).disease_name} · ${rows.length.toLocaleString()} genes · modality ${modality}`);

// ── 1. coverage and correlation ─────────────────────────────────────────────
console.log('\n1. CRITERION COVERAGE AND CORRELATION');
console.log('   coverage = share of genes with a value for that criterion\n');
const keys = CRITERIA.map(d => d.key);
const cols: Record<string, (number | null)[]> = {};
for (const k of keys) cols[k] = rows.map(r => r.__criteria[k]);
console.log('   ' + 'criterion'.padEnd(14) + 'weight  coverage');
for (const k of keys) {
  const present = cols[k].filter(v => v != null).length;
  console.log('   ' + k.padEnd(14) + `${(weights[k] * 100).toFixed(0).padStart(4)}%  ${(present / rows.length * 100).toFixed(1).padStart(6)}%`);
}
console.log('\n   Spearman correlation, over genes where BOTH criteria are present:\n');
const hdr = '   ' + ''.padEnd(14) + keys.map(k => k.slice(0, 6).padStart(7)).join('');
console.log(hdr);
const pairs: { a: string; b: string; rho: number; n: number }[] = [];
for (const a of keys) {
  let line = '   ' + a.padEnd(14);
  for (const b of keys) {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const va = cols[a][i], vb = cols[b][i];
      if (va != null && vb != null) { xs.push(va); ys.push(vb); }
    }
    const rho = xs.length >= 3 ? spearman(xs, ys) : NaN;
    if (a < b && Number.isFinite(rho)) pairs.push({ a, b, rho, n: xs.length });
    line += (Number.isFinite(rho) ? rho.toFixed(2) : '  -').padStart(7);
  }
  console.log(line);
}
const strong = pairs.filter(p => Math.abs(p.rho) >= 0.6).sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho));
console.log(strong.length
  ? '\n   Correlated pairs (|rho| >= 0.6) — candidates for double counting:\n' +
    strong.map(p => `     ${p.a} / ${p.b}: rho ${p.rho.toFixed(2)} over ${p.n.toLocaleString()} genes`).join('\n')
  : '\n   No pair reaches |rho| 0.6 — no obvious double counting.');

// ── 2. leave one out ────────────────────────────────────────────────────────
console.log('\n2. LEAVE ONE CRITERION OUT');
console.log(`   how much the board moves when a criterion is removed (top ${TOP_K} overlap, and rank correlation)\n`);
const base = score(rows, weights);
console.log('   ' + 'removed'.padEnd(14) + `top${TOP_K} overlap   rank rho`);
const loo: { key: string; topK: number; rho: number }[] = [];
for (const k of keys) {
  if ((weights[k] ?? 0) <= 0) continue;
  const w = { ...weights, [k]: 0 };
  const cmp = compare(base, score(rows, w));
  loo.push({ key: k, ...cmp });
  console.log('   ' + k.padEnd(14) + `${(cmp.topK * 100).toFixed(1).padStart(9)}%   ${cmp.rho.toFixed(3).padStart(7)}`);
}
const leastMissed = [...loo].sort((a, b) => b.topK - a.topK)[0];
const mostMissed = [...loo].sort((a, b) => a.topK - b.topK)[0];
if (leastMissed && mostMissed) {
  console.log(`\n   Least load-bearing: ${leastMissed.key} (removing it keeps ${(leastMissed.topK * 100).toFixed(0)}% of the top ${TOP_K}).`);
  console.log(`   Most load-bearing:  ${mostMissed.key} (removing it keeps ${(mostMissed.topK * 100).toFixed(0)}%).`);
}

// ── 3. weight sensitivity ───────────────────────────────────────────────────
console.log('\n3. WEIGHT SENSITIVITY');
console.log('   each weight perturbed up and down; the worst of the two is reported\n');
console.log('   ' + 'criterion'.padEnd(14) + '  ±10%      ±25%      ±50%');
for (const k of keys) {
  if ((weights[k] ?? 0) <= 0) continue;
  let line = '   ' + k.padEnd(14);
  for (const delta of [0.10, 0.25, 0.50]) {
    let worst = 1;
    for (const sign of [1, -1]) {
      const w = { ...weights, [k]: Math.max(0, weights[k] * (1 + sign * delta)) };
      worst = Math.min(worst, compare(base, score(rows, w)).topK);
    }
    line += `${(worst * 100).toFixed(1).padStart(7)}%  `;
  }
  console.log(line);
}
// The blunt version of the same question: what if every weight were equal?
const equal: Record<string, number> = {};
for (const d of CRITERIA) equal[d.key] = weights[d.key] > 0 ? 1 / keys.filter(k => weights[k] > 0).length : 0;
const eq = compare(base, score(rows, equal));
console.log(`\n   Equal weights instead of the tuned ones: ${(eq.topK * 100).toFixed(1)}% of the top ${TOP_K} survives, rank rho ${eq.rho.toFixed(3)}.`);
console.log('   Read that as the ceiling on how much the hand-set weights are doing.\n');
