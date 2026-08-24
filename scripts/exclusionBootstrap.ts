// scripts/exclusionBootstrap.ts ──────────────────────────────────────────────
// A gene-level bootstrap of the exclusion contrast, replacing the independence
// assumption the naive interval makes.
//
//   npx tsx scripts/exclusionBootstrap.ts
//   → deliverables/exclusion_bootstrap.json
//
// The headline contrast — the developed modality falls below Plausible far less
// often than the alternatives — was reported with a Wilson interval and a
// two-proportion z that treat all 4,668 modality assessments as independent trials.
// They are not. Each (gene, goal) assessment contributes about twelve correlated
// evaluations, and genes contribute multiple assessments. Clustering inflates the
// effective sample size, so the naive interval is too narrow.
//
// This resamples GENES with replacement, keeping each sampled gene's assessments
// intact, and recomputes the contrast on each resample. The resulting interval
// carries the clustering rather than assuming it away. It reads the per-assessment
// dump from modalityGoldsetBenchmark.ts, so it adds no new evaluation.
//
// Deterministic by construction: the resampling uses a fixed-seed generator, so the
// reported interval is reproducible rather than varying per run.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TIER_RANK, type Tier } from '../modalityConstants.js';

const PLAUSIBLE = TIER_RANK['Plausible' as Tier];
const LEVEL = 2;              // the honest, clinical-evidence-removed level
const ITERATIONS = 10_000;

/** mulberry32 — small, fast, seeded. Date.now()/Math.random() would break reproducibility. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rec {
  gene: string; goal: string; level: number;
  modalities: { modality: string; tier: Tier; developed: boolean }[];
}

const run = () => {
  const file = path.join(process.cwd(), 'deliverables', 'modality_per_assessment.json');
  if (!fs.existsSync(file)) {
    console.error('Missing per-assessment dump. Run: npx tsx --env-file=.env scripts/modalityGoldsetBenchmark.ts');
    process.exit(1);
  }
  const recs: Rec[] = JSON.parse(fs.readFileSync(file, 'utf8')).records.filter((r: Rec) => r.level === LEVEL);

  // Group by gene — the resampling unit.
  const byGene = new Map<string, Rec[]>();
  for (const r of recs) {
    if (!byGene.has(r.gene)) byGene.set(r.gene, []);
    byGene.get(r.gene)!.push(r);
  }
  const genes = [...byGene.keys()].sort();

  /** Excluded (below Plausible) counts for developed and alternative modalities. */
  const tally = (gs: string[]) => {
    let dExcl = 0, dTot = 0, oExcl = 0, oTot = 0;
    for (const g of gs) for (const r of byGene.get(g)!) for (const m of r.modalities) {
      const excluded = TIER_RANK[m.tier] < PLAUSIBLE;
      if (m.developed) { dTot++; if (excluded) dExcl++; }
      else { oTot++; if (excluded) oExcl++; }
    }
    return { dExcl, dTot, oExcl, oTot };
  };

  const point = tally(genes);
  const pointRR = (point.oExcl / point.oTot) / (point.dExcl / point.dTot);

  console.log(`Gene-level bootstrap of the exclusion contrast at L${LEVEL}`);
  console.log(`  ${genes.length} genes · ${recs.length} assessments · ${ITERATIONS} resamples\n`);
  console.log(`  developed excluded    ${point.dExcl}/${point.dTot} = ${(100 * point.dExcl / point.dTot).toFixed(2)}%`);
  console.log(`  alternatives excluded ${point.oExcl}/${point.oTot} = ${(100 * point.oExcl / point.oTot).toFixed(2)}%`);
  console.log(`  point risk ratio      ${pointRR.toFixed(1)}\n`);

  const rand = rng(20260824);
  const rrs: number[] = [];
  const diffs: number[] = [];
  let undefinedRR = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const sample: string[] = [];
    for (let k = 0; k < genes.length; k++) sample.push(genes[Math.floor(rand() * genes.length)]);
    const t = tally(sample);
    if (!t.dTot || !t.oTot) continue;
    diffs.push(t.oExcl / t.oTot - t.dExcl / t.dTot);
    // A resample containing no excluded developed modality gives an infinite ratio.
    // Counted and excluded from the ratio interval rather than silently dropped —
    // it is itself informative about how few such events there are.
    if (t.dExcl === 0) { undefinedRR++; continue; }
    rrs.push((t.oExcl / t.oTot) / (t.dExcl / t.dTot));
  }

  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
  };

  console.log('── Risk-ratio interval (percentile bootstrap) ──');
  console.log(`  95% CI  [${q(rrs, 0.025).toFixed(1)}, ${q(rrs, 0.975).toFixed(1)}]   from ${rrs.length} finite resamples`);
  console.log(`  ${undefinedRR} of ${ITERATIONS} resamples contained no excluded developed modality (ratio undefined).`);
  console.log('\n── Risk-difference interval (defined in every resample) ──');
  console.log(`  point   ${(100 * (point.oExcl / point.oTot - point.dExcl / point.dTot)).toFixed(1)} percentage points`);
  console.log(`  95% CI  [${(100 * q(diffs, 0.025)).toFixed(1)}, ${(100 * q(diffs, 0.975)).toFixed(1)}]`);
  console.log(`  excludes zero: ${q(diffs, 0.025) > 0 ? 'yes' : 'NO'}`);

  const out = {
    note: `Gene-level percentile bootstrap at L${LEVEL}. Genes resampled with replacement, assessments kept intact.`,
    seed: 20260824, iterations: ITERATIONS, genes: genes.length, assessments: recs.length,
    point: { ...point, riskRatio: pointRR, riskDifference: point.oExcl / point.oTot - point.dExcl / point.dTot },
    riskRatioCI: [q(rrs, 0.025), q(rrs, 0.975)],
    riskRatioFiniteResamples: rrs.length,
    resamplesWithNoDevelopedExclusion: undefinedRR,
    riskDifferenceCI: [q(diffs, 0.025), q(diffs, 0.975)],
  };
  const dest = path.join(process.cwd(), 'deliverables', 'exclusion_bootstrap.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${dest}`);
};

run();
