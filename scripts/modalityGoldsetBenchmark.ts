// scripts/modalityGoldsetBenchmark.ts ────────────────────────────────────────
// The derived-gold-set evaluation: recall, permissiveness, and leakage ablation
// over targets nobody chose.
//
//   npx tsx --env-file=.env scripts/buildModalityGoldset.ts        (once)
//   npx tsx --env-file=.env scripts/modalityGoldsetBenchmark.ts [--limit N] [--offset K]
//
// SEPARATE from scripts/modalityBenchmark.ts on purpose. That script carries the
// published figures (gate controls, LR baseline, calibration) over the 20-target
// curated set and must stay reproducible exactly as it is. This one answers the
// harder question: does the tool hold up on targets nobody selected?
//
// THREE MEASUREMENTS, because recall alone cannot carry the claim:
//
//   1. RECALL — is the clinically realised modality ranked >= Plausible?
//      Necessary, but weak on its own: a tool that admitted everything would
//      score 100%.
//
//   2. PERMISSIVENESS — how many of the 12 modalities does the engine admit per
//      target? This is what makes recall interpretable. Reported because it is
//      the first thing a reviewer will ask and the honest answer is not flattering.
//
//   3. LEAKAGE ABLATION — the gold standard IS clinical precedent, and some
//      evidence the rules read derives from that same reality. Recall and tier
//      separation are re-measured with it removed, in two steps, so each leak's
//      contribution is visible rather than assumed. Ported from modalityBenchmark.ts
//      so the two report the same quantity.
//
// Evidence is gathered ONCE per gene and reused across all three, so the ablation
// costs almost nothing on top of the recall run.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gatherModalityEvidence, assessModalities, isGoal, type MechanisticGoal } from '../modalityFitService.js';
import { TIER_RANK, type Tier } from '../modalityConstants.js';

// Same substrings the curated benchmark matches on, so the two report like-for-like.
const MOD_SUB: Record<string, string> = {
  SM: 'Conventional small molecule', Antibody: 'Antibody',
  RNA: 'RNA knockdown', Splice: 'Splice-switching', PROTAC: 'PROTAC',
};

const PLAUSIBLE = TIER_RANK['Plausible' as Tier];
const TIER_ORDER = ['Precedented', 'Plausible', 'Speculative', 'Blocked'];

// ── Leakage ablation, identical in construction to modalityBenchmark.ts ──────
// L1 removes developed drugs (the only thing that can award "Precedented").
// L2 also removes the clinical-precedence labels inside OT tractability, because
// smBucket/prBucket fire on ANY true bucket and OT's buckets include "Approved
// Drug". Ablating developed drugs alone would leave that channel open.
const CLINICAL_LABELS = /approved drug|advanced clinical|phase 1 clinical/i;
const ablate = (ev: any, level: 0 | 1 | 2) => {
  if (level === 0) return ev;
  const out = { ...ev, provenModalities: [] as any[] };
  if (level === 2) {
    out.tractabilityBuckets = (ev.tractabilityBuckets ?? [])
      .filter((b: any) => b.code !== 'OC')
      .map((b: any) => ({ ...b, labels: (b.labels ?? []).filter((l: string) => !CLINICAL_LABELS.test(l)) }))
      .filter((b: any) => b.labels.length > 0);
  }
  return out;
};

const arg = (n: string): number | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : null;
};
const pct = (n: number, d: number) => d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a';
const frac = (n: number, d: number) => `${pct(n, d)} (${n}/${d})`;

/** Wilson 95% interval — a proportion of 58/58 is not the same evidence as 400/400. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h) * 100, Math.min(1, c + h) * 100];
}
const ci = (k: number, n: number) => { const [lo, hi] = wilson(k, n); return `[${lo.toFixed(1)}, ${hi.toFixed(1)}]`; };

interface Level {
  hits: { modality: string; goal: string; hit: boolean; tier: Tier | null; gene: string; drug: string }[];
  admittedShare: number[];
  realisedTiers: string[];
  otherTiers: string[];
}
const emptyLevel = (): Level => ({ hits: [], admittedShare: [], realisedTiers: [], otherTiers: [] });

const run = async () => {
  const file = path.join(process.cwd(), 'data', 'modality_goldset.json');
  if (!fs.existsSync(file)) {
    console.error('No derived gold set. Run: npx tsx scripts/buildModalityGoldset.ts');
    process.exit(1);
  }
  const gold = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pairs: any[] = gold.pairs;

  const byGene = new Map<string, any[]>();
  for (const p of pairs) {
    if (!byGene.has(p.gene)) byGene.set(p.gene, []);
    byGene.get(p.gene)!.push(p);
  }
  const allGenes = [...byGene.keys()].sort();
  const offset = arg('--offset') ?? 0;
  const genes = allGenes.slice(offset, offset + (arg('--limit') ?? allGenes.length));

  console.log(`Derived gold set: ${pairs.length} assignments over ${allGenes.length} genes`);
  console.log(`Source: ${gold.generated_from}`);
  console.log(`Evaluating ${genes.length} genes (offset ${offset})\n`);

  const L: Record<0 | 1 | 2, Level> = { 0: emptyLevel(), 1: emptyLevel(), 2: emptyLevel() };
  let failed = 0;

  for (let i = 0; i < genes.length; i++) {
    const gene = genes[i];
    process.stdout.write(`\r  ${i + 1}/${genes.length}  ${gene.padEnd(12)}`);
    let ev: any;
    try { ev = await gatherModalityEvidence(gene); } catch { failed++; continue; }

    const rowsForGene = byGene.get(gene)!;
    for (const goal of [...new Set(rowsForGene.map((p: any) => p.goal))]) {
      if (!isGoal(goal)) continue;
      const realisedSubs = new Set(rowsForGene.filter((p: any) => p.goal === goal)
        .map((p: any) => MOD_SUB[p.modality]).filter(Boolean));

      for (const level of [0, 1, 2] as const) {
        let rows: { modality: string; tier: Tier }[];
        try { rows = assessModalities(ablate(ev, level), goal as MechanisticGoal) as any; }
        catch { failed++; continue; }

        const lv = L[level];
        lv.admittedShare.push(rows.filter(r => TIER_RANK[r.tier] >= PLAUSIBLE).length / rows.length);
        for (const r of rows) {
          const isRealised = [...realisedSubs].some(sub => r.modality.includes(sub));
          (isRealised ? lv.realisedTiers : lv.otherTiers).push(r.tier);
        }
        for (const p of rowsForGene.filter((x: any) => x.goal === goal)) {
          const sub = MOD_SUB[p.modality];
          const tier = (sub ? rows.find(r => r.modality.includes(sub))?.tier : null) ?? null;
          lv.hits.push({
            gene, modality: p.modality, goal, tier,
            hit: tier != null && TIER_RANK[tier] >= PLAUSIBLE,
            drug: p.drugs?.[0] || p.drug,
          });
        }
      }
    }
  }
  process.stdout.write('\n\n');

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const recallOf = (h: Level['hits']) => frac(h.filter(x => x.hit).length, h.length);
  const share = (arr: string[], t: string) => pct(arr.filter(x => x === t).length, arr.length);

  const l0 = L[0], l2 = L[2];
  const nonSM = (h: Level['hits']) => h.filter(x => x.modality !== 'SM');
  const smShare = l0.hits.filter(h => h.modality === 'SM').length;

  console.log('── 1. RECALL (true modality ranked >= Plausible) ──');
  const rk = l0.hits.filter(h => h.hit).length, rn = l0.hits.length;
  const nk = nonSM(l0.hits).filter(h => h.hit).length, nn = nonSM(l0.hits).length;
  console.log(`  overall        ${recallOf(l0.hits)}   95% CI ${ci(rk, rn)}`);
  console.log(`  small molecule ${recallOf(l0.hits.filter(h => h.modality === 'SM'))}`);
  console.log(`  NON-SM         ${recallOf(nonSM(l0.hits))}   95% CI ${ci(nk, nn)}`);
  console.log('\n  by modality (CI widens sharply on the small classes):');
  for (const m of [...new Set(l0.hits.map(h => h.modality))].sort()) {
    const s = l0.hits.filter(h => h.modality === m);
    console.log(`     ${m.padEnd(10)} ${recallOf(s).padEnd(18)} 95% CI ${ci(s.filter(x => x.hit).length, s.length)}`);
  }
  console.log('  by goal:');
  for (const g of [...new Set(l0.hits.map(h => h.goal))].sort())
    console.log(`     ${g.padEnd(18)} ${recallOf(l0.hits.filter(h => h.goal === g))}`);
  console.log(`\n  BASE RATE (always answer small molecule): ${pct(smShare, rn)} overall · 0.0% non-SM`);

  console.log('\n── 2. PERMISSIVENESS (how much does it admit?) ──');
  for (const level of [0, 2] as const)
    console.log(`  L${level}: ${pct(mean(L[level].admittedShare), 1)} of modalities admitted `
      + `(~${(mean(L[level].admittedShare) * 12).toFixed(1)} of 12 per target)`);
  console.log('  Recall alone is weak while this is high — the separation below is the real test.');

  console.log('\n── 3. TIER SEPARATION: realised vs other modalities ──');
  console.log(`  ${''.padEnd(12)} ${'L0 realised'.padStart(12)} ${'L0 other'.padStart(10)} ${'L2 realised'.padStart(12)} ${'L2 other'.padStart(10)}`);
  for (const t of TIER_ORDER)
    console.log(`  ${t.padEnd(12)} ${share(l0.realisedTiers, t).padStart(12)} ${share(l0.otherTiers, t).padStart(10)}`
      + ` ${share(l2.realisedTiers, t).padStart(12)} ${share(l2.otherTiers, t).padStart(10)}`);
  console.log(`\n  n realised = ${l0.realisedTiers.length} · n other = ${l0.otherTiers.length}`);
  console.log('  L0 is CIRCULAR: "Precedented" is awarded partly BECAUSE a drug exists.');
  console.log('  L2 is the honest column — clinical evidence removed entirely.');

  console.log('\n── 4. LEAKAGE ABLATION (recall with clinical evidence removed) ──');
  for (const level of [0, 1, 2] as const) {
    const h = L[level].hits;
    console.log(`  L${level} ${['full evidence          ', 'no developed drugs     ', 'also no clinical labels'][level]}`
      + `  overall ${recallOf(h).padEnd(16)} NON-SM ${recallOf(nonSM(h))}`);
  }

  // Name the misses at EVERY level, not just L0. An aggregate dropping from 399 to
  // 397 says nothing about WHICH assignments were lost, and stating that from
  // inference rather than measurement is exactly the error this exists to prevent.
  const misses = l0.hits.filter(h => !h.hit);
  for (const level of [0, 1, 2] as const) {
    const ms = L[level].hits.filter(h => !h.hit);
    console.log(`\n── MISSES at L${level} (${ms.length}) ──`);
    for (const m of ms.slice(0, 40))
      console.log(`  ${m.gene.padEnd(10)} ${m.modality.padEnd(9)} goal=${m.goal.padEnd(17)} tier=${String(m.tier).padEnd(12)} ${m.drug}`);
    if (ms.length > 40) console.log(`  … and ${ms.length - 40} more`);
  }
  if (failed) console.log(`\n  ${failed} evaluations could not be gathered.`);

  // ── Citable report ──
  const partial = genes.length < allGenes.length;
  const md = [
    '# Modality benchmark — derived gold set',
    '',
    `Source: **${gold.generated_from}** via \`scripts/buildModalityGoldset.ts\`.`,
    `Scope: **${rn} (gene, modality, goal) assignments over ${genes.length} genes**`
      + (partial ? ` — a deterministic alphabetical prefix of ${allGenes.length}.` : ' — the full derived set.'),
    '',
    'The targets were **not selected by us**: they are every approved drug ChEMBL has curated a',
    'mechanism for, mapped to a modality and a mechanistic goal by fixed rules. Rows the mapping',
    'cannot express are dropped and counted, never guessed.',
    '',
    '## 1. Recall',
    '',
    '| Metric | Result | 95% CI |',
    '|---|---|---|',
    `| Overall | **${recallOf(l0.hits)}** | ${ci(rk, rn)} |`,
    `| Small molecule | ${recallOf(l0.hits.filter(h => h.modality === 'SM'))} | ${ci(l0.hits.filter(h => h.modality === 'SM' && h.hit).length, l0.hits.filter(h => h.modality === 'SM').length)} |`,
    `| **Non-small-molecule** | **${recallOf(nonSM(l0.hits))}** | ${ci(nk, nn)} |`,
    `| Base rate (always small molecule) | ${pct(smShare, rn)} overall · 0.0% non-SM | — |`,
    '',
    '| Modality | Recall | 95% CI |',
    '|---|---|---|',
    ...[...new Set(l0.hits.map(h => h.modality))].sort().map(m => {
      const s = l0.hits.filter(h => h.modality === m);
      return `| ${m} | ${recallOf(s)} | ${ci(s.filter(x => x.hit).length, s.length)} |`;
    }),
    '',
    '## 2. Permissiveness — why recall alone is not the result',
    '',
    `At L0 the engine admits **${pct(mean(l0.admittedShare), 1)}** of the 12 modalities per target`,
    `(~${(mean(l0.admittedShare) * 12).toFixed(1)} of 12). A tool that admitted everything would score 100% recall, so the`,
    'recall figure above is necessary but not sufficient. The discriminating evidence is the tier',
    'separation below.',
    '',
    '## 3. Tier separation',
    '',
    '| Tier | L0 realised | L0 other | L2 realised | L2 other |',
    '|---|---|---|---|---|',
    ...TIER_ORDER.map(t => `| ${t} | ${share(l0.realisedTiers, t)} | ${share(l0.otherTiers, t)} | ${share(l2.realisedTiers, t)} | ${share(l2.otherTiers, t)} |`),
    '',
    `n realised = ${l0.realisedTiers.length}, n other = ${l0.otherTiers.length}.`,
    '',
    '**L0 is circular** — the `Precedented` tier is awarded partly because a drug exists, so realised',
    'modalities concentrate there by construction. **L2 is the honest column**: developed drugs and the',
    'clinical-precedence labels inside Open Targets tractability are both removed.',
    '',
    '## 4. Leakage ablation',
    '',
    '| Evidence available to the rules | Overall | Non-SM |',
    '|---|---|---|',
    ...([0, 1, 2] as const).map(level => {
      const h = L[level].hits;
      return `| L${level} — ${['full (as shipped)', 'developed drugs removed', '**also clinical tractability labels removed**'][level]} | ${recallOf(h)} | ${recallOf(nonSM(h))} |`;
    }),
    '',
    'What survives L2 is structure, pockets, localization, sequence, STRING partners, exon count and',
    'measured ChEMBL bioactivity. ChEMBL is not fully independent either — targets that reached the',
    'clinic attract more assays — so that caveat is stated rather than hidden.',
    '',
    `## Misses at L0 (${misses.length})`,
    '',
    ...(misses.length
      ? ['| Gene | Modality | Goal | Tier | Drug |', '|---|---|---|---|---|',
         ...misses.map(m => `| ${m.gene} | ${m.modality} | ${m.goal} | ${m.tier} | ${m.drug} |`)]
      : ['_None._']),
  ].join('\n');

  const dest = path.join(process.cwd(), 'deliverables', 'modality_goldset_results.md');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, md + '\n');
  fs.writeFileSync(path.join(process.cwd(), 'deliverables', 'modality_goldset_results.json'), JSON.stringify({
    genes: genes.length, assignments: rn,
    recall: { overall: rk / rn, sm: l0.hits.filter(h => h.modality === 'SM' && h.hit).length / l0.hits.filter(h => h.modality === 'SM').length, nonSM: nk / nn },
    baseRate: smShare / rn,
    permissiveness: { L0: mean(l0.admittedShare), L2: mean(l2.admittedShare) },
    ablation: Object.fromEntries(([0, 1, 2] as const).map(l => [`L${l}`, L[l].hits.filter(h => h.hit).length / L[l].hits.length])),
    tierSeparation: Object.fromEntries(TIER_ORDER.map(t => [t, {
      L0realised: l0.realisedTiers.filter(x => x === t).length / l0.realisedTiers.length,
      L0other: l0.otherTiers.filter(x => x === t).length / l0.otherTiers.length,
      L2realised: l2.realisedTiers.filter(x => x === t).length / l2.realisedTiers.length,
      L2other: l2.otherTiers.filter(x => x === t).length / l2.otherTiers.length,
    }])),
    misses: misses.map(m => ({ gene: m.gene, modality: m.modality, goal: m.goal, tier: m.tier, drug: m.drug })),
    missesByLevel: Object.fromEntries(([0, 1, 2] as const).map(l => [`L${l}`,
      L[l].hits.filter(h => !h.hit).map(m => ({ gene: m.gene, modality: m.modality, goal: m.goal, tier: m.tier, drug: m.drug }))])),
    nonSMByLevel: Object.fromEntries(([0, 1, 2] as const).map(l => {
      const n = L[l].hits.filter(h => h.modality !== 'SM');
      return [`L${l}`, { hit: n.filter(h => h.hit).length, total: n.length }];
    })),
  }, null, 2));
  console.log(`\nWrote ${dest}`);
};

run().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
