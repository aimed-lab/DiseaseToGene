// benchmark/metrics.test.ts ──────────────────────────────────────────────────
// Runnable correctness checks for the pure metrics. No test framework — run with:
//   npx tsx benchmark/metrics.test.ts
// Exits non-zero on any failure. Values are hand-computed (see comments) so a
// regression in the metric math is caught before it silently corrupts a benchmark.

import {
  rocAuc, averagePrecision, enrichmentFactor, hitsAtN, bedroc, metricBundle,
  mulberry32, seededShuffle,
} from './metrics.ts';

let failures = 0;
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
function check(name: string, got: number, want: number, eps = 1e-9) {
  const ok = approx(got, want, eps);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got.toFixed(6)} want=${want.toFixed(6)}`);
}
function checkTrue(name: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

// ── ROC-AUC ──
check('AUC perfect separation', rocAuc([3, 2, 1, 0], [1, 1, 0, 0]), 1.0);
check('AUC perfect inversion', rocAuc([3, 2, 1, 0], [0, 0, 1, 1]), 0.0);
check('AUC all-tied = 0.5', rocAuc([1, 1, 1, 1], [1, 1, 0, 0]), 0.5);
// pos={0.9,0.7} neg={0.8,0.6}: 0.9>0.8,0.9>0.6,0.7<0.8,0.7>0.6 → 3/4
check('AUC mixed = 0.75', rocAuc([0.9, 0.8, 0.7, 0.6], [1, 0, 1, 0]), 0.75);
// one tie across a pos/neg pair counts as 0.5: pos=1.0,neg=1.0 tied + pos>neg elsewhere
check('AUC single tie counts 0.5', rocAuc([1.0, 1.0], [1, 0]), 0.5);

// ── Average precision ──
// distinct scores, labels [1,0,1,0]: (1/2)·1 + (1/2)·(2/3) = 0.8333…
check('AP distinct = 0.8333', averagePrecision([0.9, 0.8, 0.7, 0.6], [1, 0, 1, 0]), 5 / 6, 1e-9);
check('AP perfect = 1.0', averagePrecision([4, 3, 2, 1], [1, 1, 0, 0]), 1.0);
// two positives TIED above two negatives tied → perfect given ties → 1.0 (tie-safety)
check('AP tie-block perfect = 1.0', averagePrecision([1, 0, 1, 0], [1, 0, 1, 0]), 1.0);

// ── Enrichment factor ──
{
  const scores = Array.from({ length: 100 }, (_, i) => (i < 10 ? 1 : 0));
  const labels = Array.from({ length: 100 }, (_, i) => (i < 10 ? 1 : 0)) as (0 | 1)[];
  check('EF@10% perfect = 10 (=1/baseRate)', enrichmentFactor(scores, labels, 0.10), 10, 1e-9);
  check('EF@10% ceiling equals 1/baseRate', enrichmentFactor(scores, labels, 0.10), 1 / 0.1, 1e-9);
}
{
  // random-ish: positives spread uniformly by score should give EF ≈ 1 at any cut
  const n = 100; const scores: number[] = []; const labels: (0 | 1)[] = [];
  for (let i = 0; i < n; i++) { scores.push(n - i); labels.push((i % 10 === 0 ? 1 : 0) as 0 | 1); }
  const ef = enrichmentFactor(scores, labels, 0.5);
  checkTrue('EF@50% uniform positives ≈ 1', Math.abs(ef - 1) < 0.25);
}

// ── hits@N / recall ──
{
  const scores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const labels = [1, 0, 1, 0, 0, 0, 0, 0, 0, 0] as (0 | 1)[];
  const h = hitsAtN(scores, labels, 3);
  check('hits@3 = 2', h.hits, 2);
  check('recall@3 = 1.0 (both positives in top3)', h.recall, 1.0);
}

// ── BEDROC bounds + ordering (early > random-ish > late) ──
{
  const T = 200, P = 20;
  const labelsEarly = Array.from({ length: T }, (_, i) => (i < P ? 1 : 0)) as (0 | 1)[];
  const labelsLate = Array.from({ length: T }, (_, i) => (i >= T - P ? 1 : 0)) as (0 | 1)[];
  const scores = Array.from({ length: T }, (_, i) => T - i); // strictly descending
  const be = bedroc(scores, labelsEarly, 20);
  const bl = bedroc(scores, labelsLate, 20);
  checkTrue('BEDROC in [0,1]', be >= 0 && be <= 1 && bl >= 0 && bl <= 1);
  checkTrue('BEDROC early ≈ 1', be > 0.99);
  checkTrue('BEDROC late ≈ 0', bl < 0.01);
  checkTrue('BEDROC early > late', be > bl);
}

// ── seeded shuffle is deterministic + a permutation ──
{
  const base = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const a = seededShuffle(base, mulberry32(123));
  const b = seededShuffle(base, mulberry32(123));
  checkTrue('shuffle deterministic for same seed', JSON.stringify(a) === JSON.stringify(b));
  checkTrue('shuffle is a permutation', JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify(base));
  const c = seededShuffle(base, mulberry32(999));
  checkTrue('different seed → different order (usually)', JSON.stringify(a) !== JSON.stringify(c));
}

// ── negative control: shuffled labels give mean AUC ≈ 0.5 ──
{
  const n = 400;
  const scores = Array.from({ length: n }, (_, i) => n - i);
  const labels = Array.from({ length: n }, (_, i) => (i < 40 ? 1 : 0)) as (0 | 1)[]; // strong real signal
  checkTrue('real signal AUC high', rocAuc(scores, labels) > 0.95);
  const aucs: number[] = [];
  for (let s = 0; s < 200; s++) aucs.push(rocAuc(scores, seededShuffle(labels, mulberry32(s)) as (0 | 1)[]));
  const mean = aucs.reduce((a, b) => a + b, 0) / aucs.length;
  checkTrue(`shuffled-label mean AUC ≈ 0.5 (got ${mean.toFixed(3)})`, Math.abs(mean - 0.5) < 0.03);
}

// ── metricBundle wiring smoke test ──
{
  const scores = [5, 4, 3, 2, 1];
  const labels = [1, 1, 0, 0, 0] as (0 | 1)[];
  const mb = metricBundle(scores, labels);
  check('bundle baseRate', mb.baseRate, 2 / 5);
  check('bundle AUC perfect', mb.rocAuc, 1.0);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
