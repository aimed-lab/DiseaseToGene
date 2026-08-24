// scripts/modalitySpecificity.ts ─────────────────────────────────────────────
// How PERMISSIVE is the engine? Recall alone cannot answer that.
//
//   npx tsx --env-file=.env scripts/modalitySpecificity.ts [--limit N]
//
// The benchmark measures whether the clinically-realised modality is ranked at
// least Plausible. A tool that answered "Plausible" to all 12 modalities would
// score 100% recall and be useless. This script measures the other side: across
// the derived gold-set genes, how many of the 12 modalities does the engine
// actually admit per target, and how are tiers distributed?
//
// There is no ground truth for the negative case — a modality with no approved
// drug for a target is not proof that the modality is impossible, only that
// nobody has done it. So this reports DISCRIMINATION, not precision: the share
// of modalities admitted, and whether the tier a modality receives separates
// clinically-realised assignments from the rest.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gatherModalityEvidence, assessModalities, isGoal, type MechanisticGoal } from '../modalityFitService.js';
import { TIER_RANK, type Tier } from '../modalityConstants.js';

const arg = (n: string): number | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : null;
};

const run = async () => {
  const gold = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'modality_goldset.json'), 'utf8'));
  const byGene = new Map<string, any[]>();
  for (const p of gold.pairs) {
    if (!byGene.has(p.gene)) byGene.set(p.gene, []);
    byGene.get(p.gene)!.push(p);
  }
  const genes = [...byGene.keys()].sort().slice(0, arg('--limit') ?? Infinity);
  console.log(`Measuring permissiveness over ${genes.length} genes\n`);

  const tierCount: Record<string, number> = {};
  const admittedPerTarget: number[] = [];
  let assessments = 0, totalModalities = 0, failed = 0;
  // Tier of the clinically-realised modality vs everything else, per goal.
  const realisedTiers: string[] = [];
  const otherTiers: string[] = [];

  for (let i = 0; i < genes.length; i++) {
    const gene = genes[i];
    process.stdout.write(`\r  ${i + 1}/${genes.length}  ${gene.padEnd(12)}`);
    let ev: any;
    try { ev = await gatherModalityEvidence(gene); } catch { failed++; continue; }

    for (const goal of [...new Set(byGene.get(gene)!.map((p: any) => p.goal))]) {
      if (!isGoal(goal)) continue;
      let rows: { modality: string; tier: Tier }[];
      try { rows = assessModalities(ev, goal as MechanisticGoal) as any; } catch { failed++; continue; }

      assessments++;
      totalModalities += rows.length;
      const admitted = rows.filter(r => TIER_RANK[r.tier] >= TIER_RANK['Plausible' as Tier]).length;
      admittedPerTarget.push(admitted / rows.length);
      for (const r of rows) tierCount[r.tier] = (tierCount[r.tier] || 0) + 1;

      // Which modality substrings are clinically realised for this gene+goal.
      const MOD_SUB: Record<string, string> = {
        SM: 'Conventional small molecule', Antibody: 'Antibody',
        RNA: 'RNA knockdown', Splice: 'Splice-switching', PROTAC: 'PROTAC',
      };
      const realised = new Set(byGene.get(gene)!.filter((p: any) => p.goal === goal)
        .map((p: any) => MOD_SUB[p.modality]).filter(Boolean));
      for (const r of rows) {
        const isRealised = [...realised].some(sub => r.modality.includes(sub));
        (isRealised ? realisedTiers : otherTiers).push(r.tier);
      }
    }
  }
  process.stdout.write('\n\n');

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const pct = (n: number, d: number) => d ? `${Math.round((n / d) * 100)}%` : 'n/a';
  const share = (arr: string[], t: string) => pct(arr.filter(x => x === t).length, arr.length);

  console.log('── PERMISSIVENESS ──');
  console.log(`  assessments (gene x goal): ${assessments}`);
  console.log(`  modalities scored:         ${totalModalities}`);
  console.log(`  mean share admitted (>= Plausible) per target: ${(mean(admittedPerTarget) * 100).toFixed(1)}%`);
  console.log(`  i.e. about ${(mean(admittedPerTarget) * 12).toFixed(1)} of 12 modalities per target.`);

  console.log('\n── TIER DISTRIBUTION (all modality assessments) ──');
  const order = ['Precedented', 'Plausible', 'Speculative', 'Blocked'];
  for (const t of order)
    console.log(`  ${t.padEnd(12)} ${String(tierCount[t] || 0).padStart(6)}  ${pct(tierCount[t] || 0, totalModalities)}`);

  console.log('\n── DISCRIMINATION: tier of clinically-realised vs other modalities ──');
  console.log(`  ${'tier'.padEnd(12)} ${'realised'.padStart(10)} ${'other'.padStart(10)}`);
  for (const t of order)
    console.log(`  ${t.padEnd(12)} ${share(realisedTiers, t).padStart(10)} ${share(otherTiers, t).padStart(10)}`);
  console.log(`\n  n realised = ${realisedTiers.length} · n other = ${otherTiers.length}`);
  if (failed) console.log(`\n  ${failed} evaluations could not be gathered.`);

  fs.writeFileSync(
    path.join(process.cwd(), 'deliverables', 'modality_specificity_results.json'),
    JSON.stringify({
      genes: genes.length, assessments, totalModalities,
      meanAdmittedShare: mean(admittedPerTarget),
      tierCount, realisedTiers: realisedTiers.length, otherTiers: otherTiers.length,
      realisedByTier: Object.fromEntries(order.map(t => [t, realisedTiers.filter(x => x === t).length])),
      otherByTier: Object.fromEntries(order.map(t => [t, otherTiers.filter(x => x === t).length])),
    }, null, 2),
  );
  console.log('\nWrote deliverables/modality_specificity_results.json');
};

run().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
