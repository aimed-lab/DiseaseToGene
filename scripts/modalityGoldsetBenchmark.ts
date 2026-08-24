// scripts/modalityGoldsetBenchmark.ts ────────────────────────────────────────
// Recall of the true clinical modality over the DERIVED gold set — the honest
// version of the headline number.
//
//   npx tsx --env-file=.env scripts/buildModalityGoldset.ts     (once, to build it)
//   npx tsx --env-file=.env scripts/modalityGoldsetBenchmark.ts [--limit N] [--offset K]
//
// This is a SEPARATE script from scripts/modalityBenchmark.ts on purpose. That one
// carries the published figures (gate controls, leakage ablation, LR baseline,
// calibration) over the 20-target curated set and must stay reproducible exactly as
// it is. This one answers the different, harder question: does the tool still recover
// the true modality on targets nobody chose?
//
// WHY THE BASE RATE MATTERS MORE HERE. The curated set is 64% non-small-molecule;
// the derived set is 85% SM, because that is what approved drugs actually are. So
// "always answer small molecule" scores ~36% on the curated set and ~85% here. A
// headline recall that does not beat 85% on this set is not evidence of anything,
// and the per-modality breakdown — especially NON-SM — is the real result.
//
// SAMPLING. Evidence gathering is a live multi-API call per gene (Ensembl alone runs
// 25-36s cold), so a full 354-gene sweep is hours. --limit takes a deterministic
// prefix of the gene list, which is sorted by symbol — NOT a random or hand-chosen
// subset, so a partial run is still something a reader can reproduce exactly.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gatherModalityEvidence, assessModalities, isGoal, type MechanisticGoal } from '../modalityFitService.js';
import { TIER_RANK, type Tier } from '../modalityConstants.js';

// Same substrings the curated benchmark matches on, so the two report like-for-like.
const MOD_SUB: Record<string, string> = {
  SM: 'Conventional small molecule',
  Antibody: 'Antibody',
  RNA: 'RNA knockdown',
  Splice: 'Splice-switching',
  PROTAC: 'PROTAC',
};

interface Pair {
  gene: string; modality: string; goal: string;
  drugs: string[]; drug: string; action_type: string; molecule_type: string;
}

const arg = (name: string): number | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : null;
};

const run = async () => {
  const file = path.join(process.cwd(), 'data', 'modality_goldset.json');
  if (!fs.existsSync(file)) {
    console.error('No derived gold set. Run: npx tsx scripts/buildModalityGoldset.ts');
    process.exit(1);
  }
  const gold = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pairs: Pair[] = gold.pairs;

  // Group by gene: one evidence gather serves every pair on that gene.
  const byGene = new Map<string, Pair[]>();
  for (const p of pairs) {
    if (!byGene.has(p.gene)) byGene.set(p.gene, []);
    byGene.get(p.gene)!.push(p);
  }
  const allGenes = [...byGene.keys()].sort();
  const offset = arg('--offset') ?? 0;
  const limit = arg('--limit') ?? allGenes.length;
  const genes = allGenes.slice(offset, offset + limit);

  console.log(`Derived gold set: ${pairs.length} pairs over ${allGenes.length} genes`);
  console.log(`Source: ${gold.generated_from}`);
  console.log(`Evaluating ${genes.length} genes (offset ${offset})\n`);

  type Res = { gene: string; modality: string; goal: string; tier: Tier | null; hit: boolean; drug: string };
  const results: Res[] = [];
  let failed = 0;

  for (let i = 0; i < genes.length; i++) {
    const gene = genes[i];
    process.stdout.write(`\r  ${i + 1}/${genes.length}  ${gene.padEnd(12)}`);
    let ev: any;
    try { ev = await gatherModalityEvidence(gene); }
    catch { failed++; continue; }

    // One assessment per distinct goal on this gene — the goal changes the verdict.
    const goals = [...new Set(byGene.get(gene)!.map(p => p.goal))];
    for (const goal of goals) {
      if (!isGoal(goal)) continue;
      let rows: { modality: string; tier: Tier }[];
      try { rows = assessModalities(ev, goal as MechanisticGoal) as any; }
      catch { failed++; continue; }

      for (const p of byGene.get(gene)!.filter(x => x.goal === goal)) {
        const sub = MOD_SUB[p.modality];
        const tier = (sub ? rows.find(r => r.modality.includes(sub))?.tier : null) ?? null;
        // "Recovered" = ranked at least Plausible. Same threshold as the curated
        // benchmark, so the two numbers are comparable.
        const hit = tier != null && TIER_RANK[tier] >= TIER_RANK['Plausible' as Tier];
        results.push({ gene, modality: p.modality, goal, tier, hit, drug: p.drugs?.[0] || p.drug });
      }
    }
  }
  process.stdout.write('\n\n');

  const pct = (n: number, d: number) => d ? `${Math.round((n / d) * 100)}%` : 'n/a';
  const recallOf = (rs: Res[]) => `${pct(rs.filter(r => r.hit).length, rs.length)} (${rs.filter(r => r.hit).length}/${rs.length})`;

  const nonSM = results.filter(r => r.modality !== 'SM');
  console.log('── RECALL (true modality ranked >= Plausible) ──');
  console.log(`  overall        ${recallOf(results)}`);
  console.log(`  small molecule ${recallOf(results.filter(r => r.modality === 'SM'))}`);
  console.log(`  NON-SM         ${recallOf(nonSM)}`);

  console.log('\n  by modality:');
  for (const m of [...new Set(results.map(r => r.modality))].sort())
    console.log(`     ${m.padEnd(10)} ${recallOf(results.filter(r => r.modality === m))}`);
  console.log('  by goal:');
  for (const g of [...new Set(results.map(r => r.goal))].sort())
    console.log(`     ${g.padEnd(18)} ${recallOf(results.filter(r => r.goal === g))}`);

  // The baseline a reviewer will compute: answer "small molecule" every time.
  const smShare = results.filter(r => r.modality === 'SM').length;
  console.log(`\n── BASE RATE (always answer small molecule) ──`);
  console.log(`  overall ${pct(smShare, results.length)} · NON-SM 0%`);
  console.log(`  The tool must beat this to have shown anything.`);

  const misses = results.filter(r => !r.hit);
  if (misses.length) {
    console.log(`\n── MISSES (${misses.length}) ──`);
    for (const m of misses.slice(0, 40))
      console.log(`  ${m.gene.padEnd(10)} ${m.modality.padEnd(9)} goal=${m.goal.padEnd(17)} tier=${String(m.tier).padEnd(12)} ${m.drug}`);
    if (misses.length > 40) console.log(`  … and ${misses.length - 40} more`);
  }
  if (failed) console.log(`\n  ${failed} gene/goal evaluations could not be gathered (network or unresolved symbol).`);

  // A citable report, same convention as scripts/modalityBenchmark.ts.
  const partial = genes.length < allGenes.length;
  const md = [
    '# Modality benchmark — derived gold set',
    '',
    `Source: **${gold.generated_from}** via \`scripts/buildModalityGoldset.ts\`.`,
    `Scope: **${results.length} (gene, modality, goal) assignments over ${genes.length} genes**` +
      (partial ? ` — a deterministic alphabetical prefix of ${allGenes.length}, not a sample anyone chose.` : ' — the full derived set.'),
    '',
    'The targets here were **not selected by us**. They are every approved drug ChEMBL has curated',
    'a mechanism for, mapped to a modality and a mechanistic goal by the fixed rules printed in the',
    'generator. Rows the mapping cannot express are dropped and counted, never guessed.',
    '',
    '| Metric | Result |',
    '|---|---|',
    `| Recall, overall | **${recallOf(results)}** |`,
    `| Recall, small molecule | ${recallOf(results.filter(r => r.modality === 'SM'))} |`,
    `| Recall, NON-small-molecule | **${recallOf(nonSM)}** |`,
    `| Base rate (always small molecule) | ${pct(smShare, results.length)} overall · 0% non-SM |`,
    '',
    '## Why the base rate is the number to compare against',
    '',
    `Approved drugs are overwhelmingly small molecules — ${pct(smShare, results.length)} of this set. A curated set`,
    'enriched for antibodies and oligonucleotides flatters any tool, because the trivial "always answer',
    'small molecule" baseline scores far lower there. On this set that baseline scores',
    `${pct(smShare, results.length)}, so the informative figure is non-SM recall — the cases the baseline cannot address at all.`,
    '',
    '## By modality',
    '',
    '| Modality | Recall |',
    '|---|---|',
    ...[...new Set(results.map(r => r.modality))].sort().map(m => `| ${m} | ${recallOf(results.filter(r => r.modality === m))} |`),
    '',
    '## By mechanistic goal',
    '',
    '| Goal | Recall |',
    '|---|---|',
    ...[...new Set(results.map(r => r.goal))].sort().map(g => `| ${g} | ${recallOf(results.filter(r => r.goal === g))} |`),
    '',
    `## Misses (${misses.length})`,
    '',
    ...(misses.length
      ? ['| Gene | Modality | Goal | Tier assigned | Drug |', '|---|---|---|---|---|',
         ...misses.map(m => `| ${m.gene} | ${m.modality} | ${m.goal} | ${m.tier} | ${m.drug} |`)]
      : ['_None._']),
  ].join('\n');

  const dest = path.join(process.cwd(), 'deliverables', 'modality_goldset_results.md');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, md + '\n');
  console.log(`\nWrote ${dest}`);
};

run().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
