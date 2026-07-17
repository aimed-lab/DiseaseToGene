// benchmark/metrics.ts ──────────────────────────────────────────────────────
// PURE ranking-quality metrics for the target-recovery benchmark. No I/O, no deps,
// no Math.random (shuffles use a seeded PRNG so every run is reproducible).
//
// The benchmark asks: when the funnel ranks a disease's whole gene universe, how
// high do the KNOWN drug targets (the gold-standard positives) land? These metrics
// quantify that from a score vector + a 0/1 label vector, all rank-based and
// tie-safe (many genes share identical/absent-axis scores, so ties are the norm).
//
// Conventions: higher score = better (more target-like). `labels[i] === 1` marks a
// gold-standard positive. Every function takes parallel arrays `scores` and `labels`.

export interface LabeledScore { score: number; label: 0 | 1; }

// ── seeded PRNG (mulberry32) — deterministic shuffles for negative controls / bootstrap ──
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates using a supplied rng (0..1). Returns a NEW array; input untouched.
export function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Average (fractional) ranks, 1-based, ascending by score. Ties share the mean rank.
// Used by the Mann–Whitney form of ROC-AUC so tied scores don't bias the estimate.
function averageRanks(scores: readonly number[]): number[] {
  const idx = scores.map((s, i) => [s, i] as [number, number]).sort((x, y) => x[0] - y[0]);
  const ranks = new Array<number>(scores.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank for the tie block [i..j]
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}

// ROC-AUC via the Mann–Whitney U statistic (tie-corrected through average ranks).
// AUC = P(random positive scored above random negative), ties counted as 0.5.
// Returns NaN if there are no positives or no negatives (undefined in that case).
export function rocAuc(scores: readonly number[], labels: readonly (0 | 1)[]): number {
  const P = labels.reduce<number>((a, l) => a + l, 0);
  const N = labels.length - P;
  if (P === 0 || N === 0) return NaN;
  const ranks = averageRanks(scores);
  let sumPos = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === 1) sumPos += ranks[i];
  return (sumPos - (P * (P + 1)) / 2) / (P * N);
}

// Average Precision (area under precision–recall, the interpolation-free "step" form
// that sklearn uses). Tie-safe: genes with equal scores are treated as one block, and
// the block contributes its end-of-block precision to every positive it contains — so
// the metric never depends on the arbitrary order within a tie.
export function averagePrecision(scores: readonly number[], labels: readonly (0 | 1)[]): number {
  const P = labels.reduce<number>((a, l) => a + l, 0);
  if (P === 0) return NaN;
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]); // desc
  let ap = 0, tp = 0, seen = 0, i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && scores[order[j + 1]] === scores[order[i]]) j++;
    let blockPos = 0;
    for (let k = i; k <= j; k++) blockPos += labels[order[k]];
    seen = j + 1;            // items ranked at/above this block
    tp += blockPos;          // cumulative true positives through end of block
    if (blockPos > 0) {
      const precision = tp / seen; // precision evaluated at the block boundary
      ap += (blockPos / P) * precision;
    }
    i = j + 1;
  }
  return ap;
}

// Enrichment Factor at the top k fraction: (hit-rate in the top slice) / (base rate).
// EF = (Htop / n) / (P / T). EF=1 is random; EF=1/baseRate is the perfect ceiling.
// Boundary ties are counted fractionally so EF doesn't jump on an arbitrary cut point.
export function enrichmentFactor(scores: readonly number[], labels: readonly (0 | 1)[], frac: number): number {
  const T = labels.length;
  const P = labels.reduce<number>((a, l) => a + l, 0);
  if (P === 0 || T === 0) return NaN;
  const n = Math.max(1, Math.round(frac * T));
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  // walk to the cut, splitting the tie block that straddles position n fractionally
  let hits = 0, taken = 0, i = 0;
  while (i < order.length && taken < n) {
    let j = i;
    while (j + 1 < order.length && scores[order[j + 1]] === scores[order[i]]) j++;
    const blockSize = j - i + 1;
    let blockPos = 0;
    for (let k = i; k <= j; k++) blockPos += labels[order[k]];
    const need = n - taken;
    if (blockSize <= need) { hits += blockPos; taken += blockSize; }
    else { hits += blockPos * (need / blockSize); taken = n; } // fractional straddle
    i = j + 1;
  }
  return (hits / n) / (P / T);
}

// Positives found in the top-N (integer count) and recall@N. Straddling ties counted
// fractionally, same as EF, so the numbers are stable across equal-score reorderings.
export function hitsAtN(scores: readonly number[], labels: readonly (0 | 1)[], N: number): { hits: number; recall: number } {
  const P = labels.reduce<number>((a, l) => a + l, 0);
  const n = Math.min(N, labels.length);
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  let hits = 0, taken = 0, i = 0;
  while (i < order.length && taken < n) {
    let j = i;
    while (j + 1 < order.length && scores[order[j + 1]] === scores[order[i]]) j++;
    const blockSize = j - i + 1;
    let blockPos = 0;
    for (let k = i; k <= j; k++) blockPos += labels[order[k]];
    const need = n - taken;
    if (blockSize <= need) { hits += blockPos; taken += blockSize; }
    else { hits += blockPos * (need / blockSize); taken = n; }
    i = j + 1;
  }
  return { hits, recall: P ? hits / P : NaN };
}

// BEDROC (Truchon & Bayly, J Chem Inf Model 2007, eq. 36) — early-recognition metric
// that weights top-of-list hits exponentially. alpha=20 ≈ 80% of the score comes from
// the top ~8% of the ranked list. Bounded [0,1]. Computed as RIE rescaled to [0,1]:
//   RIE = <Σ e^{-α·rank/T}> / expected-under-random,  BEDROC = RIE·c1 + c2.
// Ties broken by stable index order — acceptable because BEDROC is reported alongside
// the tie-safe ROC-AUC/AP, and early-recognition is inherently order-of-top sensitive.
export function bedroc(scores: readonly number[], labels: readonly (0 | 1)[], alpha = 20): number {
  const T = labels.length;
  const P = labels.reduce<number>((a, l) => a + l, 0);
  if (P === 0 || P === T) return NaN;
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]); // desc
  const Ra = P / T;

  let sumExp = 0;
  for (let rank = 1; rank <= T; rank++) {
    if (labels[order[rank - 1]] === 1) sumExp += Math.exp((-alpha * rank) / T);
  }
  // Expected value of the sum for a random ranking = P/T · (1-e^-α)/(e^{α/T}-1).
  const rieDenom = (Ra * (1 - Math.exp(-alpha))) / (Math.exp(alpha / T) - 1);
  const RIE = sumExp / rieDenom;
  const c1 = (Ra * Math.sinh(alpha / 2)) / (Math.cosh(alpha / 2) - Math.cosh(alpha / 2 - alpha * Ra));
  const c2 = 1 / (1 - Math.exp(alpha * (1 - Ra)));
  return Math.max(0, Math.min(1, RIE * c1 + c2));
}

// Bootstrap confidence interval for ROC-AUC (percentile method), seeded for reproducibility.
// Resamples gene indices with replacement `iters` times; returns [lo, hi] at the given level.
export function bootstrapAucCI(
  scores: readonly number[],
  labels: readonly (0 | 1)[],
  opts: { iters?: number; level?: number; seed?: number } = {},
): { auc: number; lo: number; hi: number; iters: number } {
  const iters = opts.iters ?? 1000;
  const level = opts.level ?? 0.95;
  const rng = mulberry32(opts.seed ?? 12345);
  const T = labels.length;
  const point = rocAuc(scores, labels);
  const samples: number[] = [];
  for (let b = 0; b < iters; b++) {
    const s = new Array<number>(T), l = new Array<0 | 1>(T);
    for (let i = 0; i < T; i++) {
      const k = Math.floor(rng() * T);
      s[i] = scores[k]; l[i] = labels[k];
    }
    const a = rocAuc(s, l);
    if (!Number.isNaN(a)) samples.push(a);
  }
  samples.sort((x, y) => x - y);
  const loI = Math.floor(((1 - level) / 2) * samples.length);
  const hiI = Math.min(samples.length - 1, Math.ceil((1 - (1 - level) / 2) * samples.length) - 1);
  return { auc: point, lo: samples[loI] ?? NaN, hi: samples[hiI] ?? NaN, iters: samples.length };
}

// One-call bundle of the headline metrics for a score/label vector.
export interface MetricBundle {
  n: number; positives: number; baseRate: number;
  rocAuc: number; averagePrecision: number; bedroc: number;
  ef: Record<string, number>;       // enrichment factor at 1%,5%,10%
  hits: Record<string, { hits: number; recall: number }>; // top 10/20/50/100
}

export function metricBundle(scores: readonly number[], labels: readonly (0 | 1)[]): MetricBundle {
  const positives = labels.reduce<number>((a, l) => a + l, 0);
  return {
    n: labels.length,
    positives,
    baseRate: labels.length ? positives / labels.length : NaN,
    rocAuc: rocAuc(scores, labels),
    averagePrecision: averagePrecision(scores, labels),
    bedroc: bedroc(scores, labels, 20),
    ef: {
      '1%': enrichmentFactor(scores, labels, 0.01),
      '5%': enrichmentFactor(scores, labels, 0.05),
      '10%': enrichmentFactor(scores, labels, 0.10),
    },
    hits: {
      top10: hitsAtN(scores, labels, 10),
      top20: hitsAtN(scores, labels, 20),
      top50: hitsAtN(scores, labels, 50),
      top100: hitsAtN(scores, labels, 100),
    },
  };
}
