// benchmark/benchmark.ts ─────────────────────────────────────────────────────
// Target-recovery benchmark for the funnel. It exercises THE REAL engine
// (funnelEngine.runFunnel) — never a re-implementation — so what it measures is
// exactly what the app ranks. Given a gene universe (with real-unit features) and a
// gold-standard set of known drug targets, it answers: do the funnel's top ranks
// concentrate the known targets? and: which axes / weights drive that?
//
// Four operations:
//   evaluate()        — score the universe, label by gold set, return the metric bundle
//   ablation()        — drop each axis (weight→0), report the ROC-AUC it was worth
//   coordinateFit()   — hill-climb the weights to maximize an objective (in-sample)
//   crossValidatedFit — k-fold over the positives → an HONEST generalization estimate
//   negativeControl() — shuffle the labels; AUC must collapse to ~0.5 (sanity)
//
// LEAKAGE NOTE (important, honest): if the gold standard is "has a clinical drug for
// this disease" and the funnel's `tractability` axis is ChEMBL max-phase, that axis
// partly *encodes the label*. So the harness supports a `holdout` axis set (default
// {tractability}) that is forced to weight 0 for the headline/fit numbers, and reports
// the with-tractability number separately as an upper (leaky) bound. See README.

import {
  FunnelGene, EligibilityConfig, DEFAULT_ELIGIBILITY, runFunnel, WEIGHTS, ScoreWeights, NORM,
} from '../funnelEngine.ts';
import {
  metricBundle, MetricBundle, rocAuc, enrichmentFactor, seededShuffle, mulberry32, bootstrapAucCI,
} from './metrics.ts';

export type AxisKey = keyof typeof NORM; // 'genetic'|'mutation'|'dysreg'|'dependency'|'tractability'|'tissue'
export const AXES = Object.keys(NORM) as AxisKey[];

export interface Universe {
  genes: FunnelGene[];       // one row per gene, features in real units
  goldSet: Set<string>;      // known-drug-target symbols (positives), UPPER-CASE
}

// Build a full-universe score vector aligned to `genes` order. Eligible genes get their
// funnel score; INELIGIBLE genes get -Infinity (they sink to the bottom — a known target
// the funnel rejected at Stage 1 is a genuine miss and must be penalized as such).
export function scoreVector(
  genes: FunnelGene[],
  cfg: EligibilityConfig,
  weights: ScoreWeights,
): { scores: number[]; eligibleCount: number } {
  const res = runFunnel(genes, cfg, weights);
  const bySym = new Map<string, number>();
  for (const s of res.ranked) bySym.set(s.gene.gene_symbol.toUpperCase(), s.score ?? -Infinity);
  const scores = genes.map(g => bySym.get(g.gene_symbol.toUpperCase()) ?? -Infinity);
  return { scores, eligibleCount: res.eligibleCount };
}

export function labelVector(genes: FunnelGene[], goldSet: Set<string>): (0 | 1)[] {
  return genes.map(g => (goldSet.has(g.gene_symbol.toUpperCase()) ? 1 : 0));
}

export interface EvalResult {
  bundle: MetricBundle;
  eligibleCount: number;
  goldInUniverse: number;      // positives that are actually present in the universe
  goldEligible: number;        // positives that survived Stage-1 eligibility
  aucCI: { auc: number; lo: number; hi: number; iters: number };
}

export function evaluate(
  u: Universe,
  cfg: EligibilityConfig = DEFAULT_ELIGIBILITY,
  weights: ScoreWeights = WEIGHTS,
  opts: { bootstrap?: boolean; seed?: number } = {},
): EvalResult {
  const { scores, eligibleCount } = scoreVector(u.genes, cfg, weights);
  const labels = labelVector(u.genes, u.goldSet);
  const bundle = metricBundle(scores, labels);
  const goldInUniverse = labels.reduce<number>((a, l) => a + l, 0);
  let goldEligible = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === 1 && scores[i] > -Infinity) goldEligible++;
  const aucCI = opts.bootstrap === false
    ? { auc: bundle.rocAuc, lo: NaN, hi: NaN, iters: 0 }
    : bootstrapAucCI(scores, labels, { iters: 1000, seed: opts.seed ?? 7 });
  return { bundle, eligibleCount, goldInUniverse, goldEligible, aucCI };
}

// ── ablation: what is each axis worth? Zero one axis' weight, re-rank, measure the drop.
export interface AblationRow { axis: AxisKey; auc: number; deltaAuc: number; ap: number; ef5: number; }
export function ablation(
  u: Universe,
  cfg: EligibilityConfig = DEFAULT_ELIGIBILITY,
  base: ScoreWeights = WEIGHTS,
): { baseline: { auc: number; ap: number; ef5: number }; rows: AblationRow[] } {
  const baseScores = scoreVector(u.genes, cfg, base).scores;
  const labels = labelVector(u.genes, u.goldSet);
  const baseAuc = rocAuc(baseScores, labels);
  const baseAp = metricBundle(baseScores, labels).averagePrecision;
  const baseEf = enrichmentFactor(baseScores, labels, 0.05);
  const rows: AblationRow[] = [];
  for (const axis of AXES) {
    if (base[axis] === 0) continue; // already off — nothing to ablate
    const w = { ...base, [axis]: 0 };
    const s = scoreVector(u.genes, cfg, w).scores;
    const auc = rocAuc(s, labels);
    rows.push({
      axis, auc, deltaAuc: auc - baseAuc,
      ap: metricBundle(s, labels).averagePrecision,
      ef5: enrichmentFactor(s, labels, 0.05),
    });
  }
  rows.sort((a, b) => a.deltaAuc - b.deltaAuc); // most negative delta = most important axis
  return { baseline: { auc: baseAuc, ap: baseAp, ef5: baseEf }, rows };
}

// ── objective functions the fitter can maximize ──
export type Objective = 'rocAuc' | 'ap' | 'ef5' | 'ef1';
function objectiveValue(scores: number[], labels: (0 | 1)[], obj: Objective): number {
  switch (obj) {
    case 'rocAuc': return rocAuc(scores, labels);
    case 'ap': return metricBundle(scores, labels).averagePrecision;
    case 'ef5': return enrichmentFactor(scores, labels, 0.05);
    case 'ef1': return enrichmentFactor(scores, labels, 0.01);
  }
}

export interface FitOptions {
  objective?: Objective;              // default rocAuc
  grid?: number[];                    // weight values to try per axis
  passes?: number;                    // coordinate-ascent passes
  holdout?: AxisKey[];                // axes forced to weight 0 (default ['tractability'] — leakage guard)
  cfg?: EligibilityConfig;
  start?: ScoreWeights;               // starting weights (default WEIGHTS)
}

// Coordinate-ascent hill-climb over the weight grid. IN-SAMPLE (optimistic) — it fits and
// scores on the same labels; use crossValidatedFit() for the honest number. Holdout axes
// are pinned to 0 for the whole search (leakage guard).
export function coordinateFit(
  genes: FunnelGene[],
  labels: (0 | 1)[],
  opts: FitOptions = {},
): { weights: ScoreWeights; objective: Objective; value: number; trace: number[] } {
  const objective = opts.objective ?? 'rocAuc';
  const grid = opts.grid ?? [0, 0.5, 1, 1.5, 2];
  const passes = opts.passes ?? 3;
  const cfg = opts.cfg ?? DEFAULT_ELIGIBILITY;
  const holdout = new Set(opts.holdout ?? ['tractability']);
  const w: ScoreWeights = { ...(opts.start ?? WEIGHTS) };
  for (const h of holdout) w[h] = 0;

  const evalW = (weights: ScoreWeights) => objectiveValue(scoreVector(genes, cfg, weights).scores, labels, objective);
  let best = evalW(w);
  const trace: number[] = [best];
  for (let p = 0; p < passes; p++) {
    let improved = false;
    for (const axis of AXES) {
      if (holdout.has(axis)) continue;
      let bestVal = w[axis], bestObj = best;
      for (const v of grid) {
        if (v === w[axis]) continue;
        const cand = { ...w, [axis]: v };
        const val = evalW(cand);
        if (val > bestObj + 1e-9) { bestObj = val; bestVal = v; }
      }
      if (bestObj > best + 1e-9) { w[axis] = bestVal; best = bestObj; improved = true; trace.push(best); }
    }
    if (!improved) break;
  }
  return { weights: w, objective, value: best, trace };
}

// ── k-fold cross-validated fit: the HONEST generalization estimate.
// Positives are partitioned into k folds. Each fold: fit weights on (all negatives +
// the OTHER folds' positives), then evaluate the fitted weights' objective on a universe
// of (all negatives + THIS fold's positives) — train positives are removed from the test
// universe so there is no leakage between train and test. Returns per-fold + mean test obj.
export interface CVResult {
  objective: Objective; k: number;
  foldTest: number[]; meanTest: number; sdTest: number;
  foldWeights: ScoreWeights[];
  meanWeights: ScoreWeights;   // averaged fitted weights (a robust point estimate)
}
export function crossValidatedFit(u: Universe, opts: FitOptions & { k?: number; seed?: number } = {}): CVResult {
  const objective = opts.objective ?? 'rocAuc';
  const k = opts.k ?? 5;
  const cfg = opts.cfg ?? DEFAULT_ELIGIBILITY;
  const rng = mulberry32(opts.seed ?? 42);

  const posIdx: number[] = [];
  const negIdx: number[] = [];
  const labels0 = labelVector(u.genes, u.goldSet);
  labels0.forEach((l, i) => (l === 1 ? posIdx : negIdx).push(i));
  const shuffledPos = seededShuffle(posIdx, rng);
  const folds: number[][] = Array.from({ length: k }, () => []);
  shuffledPos.forEach((idx, i) => folds[i % k].push(idx));

  const foldTest: number[] = [];
  const foldWeights: ScoreWeights[] = [];
  for (let f = 0; f < k; f++) {
    const testPos = new Set(folds[f]);
    const trainSet = new Set(shuffledPos.filter(i => !testPos.has(i)));
    // TRAIN: universe = all genes, labels = 1 for train positives only.
    const trainLabels: (0 | 1)[] = u.genes.map((_, i) => (trainSet.has(i) ? 1 : 0));
    const fit = coordinateFit(u.genes, trainLabels, { ...opts, objective, cfg });
    foldWeights.push(fit.weights);
    // TEST: universe = all negatives + this fold's positives (drop train positives entirely
    // so a weight fitted to a train positive can't be rewarded for ranking it again).
    const keep = u.genes.filter((_, i) => !trainSet.has(i));
    const keepLabels: (0 | 1)[] = keep.map(g => (u.goldSet.has(g.gene_symbol.toUpperCase()) ? 1 : 0));
    const testScores = scoreVector(keep, cfg, fit.weights).scores;
    foldTest.push(objectiveValue(testScores, keepLabels, objective));
  }
  const meanTest = foldTest.reduce((a, b) => a + b, 0) / k;
  const sdTest = Math.sqrt(foldTest.reduce((a, b) => a + (b - meanTest) ** 2, 0) / k);
  const meanWeights = { ...WEIGHTS };
  for (const axis of AXES) meanWeights[axis] = foldWeights.reduce((a, w) => a + w[axis], 0) / k;
  return { objective, k, foldTest, meanTest, sdTest, foldWeights, meanWeights };
}

// ── negative control: shuffle the labels; a valid ranking metric must collapse to ~0.5.
export function negativeControl(u: Universe, cfg: EligibilityConfig = DEFAULT_ELIGIBILITY, seeds = 20): { meanAuc: number; sd: number; aucs: number[] } {
  const { scores } = scoreVector(u.genes, cfg, WEIGHTS);
  const labels = labelVector(u.genes, u.goldSet);
  const aucs: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const shuffled = seededShuffle(labels, mulberry32(1000 + s)) as (0 | 1)[];
    aucs.push(rocAuc(scores, shuffled));
  }
  const meanAuc = aucs.reduce((a, b) => a + b, 0) / aucs.length;
  const sd = Math.sqrt(aucs.reduce((a, b) => a + (b - meanAuc) ** 2, 0) / aucs.length);
  return { meanAuc, sd, aucs };
}
