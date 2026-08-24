// scripts/goalBlindTractability.ts ───────────────────────────────────────────
// What does a goal-blind tractability annotation say about targets whose approved
// drug RAISES their function?
//
//   npx tsx --env-file=.env scripts/goalBlindTractability.ts
//   → deliverables/goal_blind_tractability.json
//
// Open Targets reports tractability per modality at the level of the TARGET:
// whether a small-molecule handle, an antibody epitope or a degrader handle exists.
// It does not ask what the program intends to do to the protein, because that is
// not a property of the protein.
//
// That is not an error on its own terms — a PROTAC-tractability bucket is a
// statement about chemistry, and it is correct as such. The question this script
// asks is narrower and empirical: for targets where the approved drug exists to
// INCREASE functional protein, how often does the goal-blind annotation carry a
// removal-oriented handle, with nothing in the annotation to indicate that removal
// is the wrong direction?
//
// The comparison is against our own goal-conditioned verdict for the same target,
// which blocks degradation under a restore-function goal by rule.
//
// Claim discipline: this measures how often the annotation is SILENT about goal
// incompatibility, not how often it is wrong. Those are different, and the second
// is not measurable from this design.
//
// RESULT, and why this script reports a NULL. 84 of 85 gain-of-function targets
// (98.8%) carry a degrader handle. That looks damning until the base rate is
// checked: inhibit-only targets carry one at 93.3% (56/60), a difference of 5.5
// points with Fisher exact p = 0.16. Open Targets marks a degrader handle on
// almost every protein, so the figure is a property of the annotation being
// near-universal, NOT evidence that goal-blindness creates specific exposure on
// gain-of-function targets. The hypothesis this script was written to test does
// not survive its own control.
//
// Kept because the null is worth preserving and re-runnable. Anyone repeating this
// analysis should compute the base rate FIRST — a near-universal annotation makes
// any subgroup figure look alarming.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gatherModalityEvidence, assessModalities } from '../modalityFitService.js';
import type { Tier } from '../modalityConstants.js';

const REMOVAL_MODALITIES = ['PROTAC', 'RNA knockdown'];

const run = async () => {
  const gold = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'modality_goldset.json'), 'utf8'));
  const rf = gold.pairs.filter((p: any) => p.goal === 'restore_function');
  const genes = [...new Set(rf.map((p: any) => p.gene))].sort() as string[];

  // The base-rate control, computed HERE rather than in a side analysis. A first
  // version of this comparison lived in a throwaway script, which left the control
  // figure in the manuscript with no committed source — the same failure as any
  // other unverifiable number. Targets whose approved drugs act only by inhibition,
  // first sixty alphabetically: a deterministic selection fixed before the
  // comparison and not adjusted after.
  const rfSet = new Set(genes);
  const controlGenes = [...new Set(gold.pairs.filter((p: any) => p.goal === 'inhibit').map((p: any) => p.gene))]
    .filter((g: any) => !rfSet.has(g)).sort().slice(0, 60) as string[];

  console.log(`Gain-of-function targets (approved drug raises function): ${genes.length}`);
  console.log(`Inhibition-only control targets:                          ${controlGenes.length}\n`);

  const rows: any[] = [];
  let failed = 0;

  for (let i = 0; i < genes.length; i++) {
    const gene = genes[i];
    process.stdout.write(`\r  ${i + 1}/${genes.length}  ${gene.padEnd(12)}`);
    let ev: any;
    try { ev = await gatherModalityEvidence(gene); } catch { failed++; continue; }

    // What the goal-blind annotation offers. OT bucket codes: SM small molecule,
    // AB antibody, PR PROTAC/degrader, OC clinical precedence.
    const buckets: any[] = ev.tractabilityBuckets ?? [];
    const codes = new Set(buckets.map(b => String(b.code)));
    const hasDegraderHandle = codes.has('PR');
    const hasSmallMoleculeHandle = codes.has('SM');

    // What the goal-conditioned rules say for removal, given the real intent.
    const restore: { modality: string; tier: Tier; gate: string | null }[] =
      assessModalities(ev, 'restore_function') as any;
    const removalTiers = REMOVAL_MODALITIES.map(sub => {
      const hit = restore.find(r => r.modality.includes(sub));
      return { modality: sub, tier: hit?.tier ?? null, gate: hit?.gate ?? null };
    });
    const blockedByGoal = removalTiers.filter(r => r.tier === 'Blocked').length;

    rows.push({
      gene,
      drug: rf.find((p: any) => p.gene === gene)?.drugs?.[0] ?? null,
      otDegraderHandle: hasDegraderHandle,
      otSmallMoleculeHandle: hasSmallMoleculeHandle,
      otBucketCodes: [...codes].sort(),
      removalUnderRestoreGoal: removalTiers,
      removalModalitiesBlockedByGoal: blockedByGoal,
    });
  }
  process.stdout.write('\n\n');

  const n = rows.length;
  const withDegrader = rows.filter(r => r.otDegraderHandle);
  const pct = (k: number) => `${((k / n) * 100).toFixed(1)}%`;

  console.log('── Goal-blind annotation on gain-of-function targets ──');
  console.log(`  targets assessed                                    ${n}`);
  console.log(`  carrying an Open Targets degrader-tractability handle ${withDegrader.length} (${pct(withDegrader.length)})`);
  console.log(`  carrying a small-molecule handle                      ${rows.filter(r => r.otSmallMoleculeHandle).length}`);

  const blockedAll = rows.filter(r => r.removalModalitiesBlockedByGoal === REMOVAL_MODALITIES.length);
  console.log(`\n── Goal-conditioned verdict on the same targets ──`);
  console.log(`  both removal modalities Blocked under restore_function ${blockedAll.length} (${pct(blockedAll.length)})`);

  const conflict = withDegrader.filter(r => r.removalModalitiesBlockedByGoal > 0);
  console.log(`\n── The gap ──`);
  console.log(`  targets where the goal-blind annotation offers a degrader handle`);
  console.log(`  AND the goal-conditioned rules block removal: ${conflict.length} (${pct(conflict.length)})`);
  console.log(`\n  These are targets a reader consulting tractability alone could take`);
  console.log(`  as degrader-amenable, on proteins whose approved drug exists to`);
  console.log(`  RAISE function. The annotation is not incorrect about chemistry;`);
  console.log(`  it is silent about whether removal is the intended direction.`);

  if (conflict.length) {
    console.log('\n  examples:');
    for (const r of conflict.slice(0, 12))
      console.log(`     ${r.gene.padEnd(10)} OT=[${r.otBucketCodes.join(',')}]  drug=${r.drug}`);
  }
  // ── The control. Without it the gain-of-function proportion means nothing. ──
  console.log('\n── Base rate: inhibition-only targets ──');
  let ctlPr = 0, ctlN = 0;
  for (let i = 0; i < controlGenes.length; i++) {
    process.stdout.write(`\r  ${i + 1}/${controlGenes.length}  ${controlGenes[i].padEnd(12)}`);
    try {
      const ev: any = await gatherModalityEvidence(controlGenes[i]);
      const codes = new Set((ev.tractabilityBuckets ?? []).map((b: any) => String(b.code)));
      ctlN++; if (codes.has('PR')) ctlPr++;
    } catch { /* skip */ }
  }
  process.stdout.write('\n');
  const ctlRate = ctlN ? ctlPr / ctlN : 0;
  const gofRate = withDegrader.length / n;
  console.log(`  inhibition-only with a degrader handle: ${ctlPr}/${ctlN} = ${(100 * ctlRate).toFixed(1)}%`);
  console.log(`  gain-of-function                      : ${withDegrader.length}/${n} = ${(100 * gofRate).toFixed(1)}%`);
  console.log(`  difference                            : ${(100 * (gofRate - ctlRate)).toFixed(1)} percentage points`);
  console.log(`\n  The handle is near-universal in BOTH groups, so a subgroup proportion of`);
  console.log(`  ${(100 * gofRate).toFixed(1)}% is not evidence about gain-of-function targets. See the header`);
  console.log(`  for the reported Fisher exact p and why this analysis returns a null.`);

  if (failed) console.log(`\n  ${failed} targets could not be gathered.`);

  const dest = path.join(process.cwd(), 'deliverables', 'goal_blind_tractability.json');
  fs.writeFileSync(dest, JSON.stringify({
    note: 'Goal-blind tractability annotation vs goal-conditioned verdict, on targets whose approved drug raises function.',
    nTargets: n,
    withDegraderHandle: withDegrader.length,
    control: { genes: controlGenes, n: ctlN, withDegraderHandle: ctlPr, rate: ctlRate },
    gainOfFunctionRate: gofRate,
    differencePercentagePoints: 100 * (gofRate - ctlRate),
    bothRemovalModalitiesBlockedByGoal: blockedAll.length,
    conflict: conflict.length,
    rows,
  }, null, 2));
  console.log(`\nWrote ${dest}`);
};

run().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
