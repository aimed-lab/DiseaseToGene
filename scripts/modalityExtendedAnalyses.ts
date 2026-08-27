// scripts/modalityExtendedAnalyses.ts ────────────────────────────────────────
// Analyses added in pre-submission review, all computed from the committed
// per-assessment dump so they add no new evaluation and cannot drift from it.
//
//   npx tsx scripts/modalityExtendedAnalyses.ts
//   → deliverables/modality_extended_analyses.{json,md}
//
// Five questions, in order:
//
//   A  Which modalities carry an evidence-independent verdict?
//      Three do. Two can never be admitted and one can never be refused. That is a
//      property of the rule set, not of any target, and it has to be disclosed
//      because it changes how the permissiveness and exclusion figures read.
//
//   B  What is permissiveness against the denominator that is actually reachable?
//      Two of twelve modalities are never admissible, so the ceiling is ten. The
//      reported 7.9/12 understates how permissive the rules are.
//
//   C  Which modalities supply the exclusion contrast?
//      The headline 37.8% is a mixture. Reporting it undecomposed invites the
//      objection that it is carried by modalities excluded by rule rather than by
//      evidence — which is partly true and needs to be visible.
//
//   D  Does the contrast survive a like-for-like comparison?
//      Only four modality classes ever appear as the developed modality. Restricting
//      the alternatives to those four removes the composition confound entirely.
//
//   E  What would correcting the molecular-glue rule do to the contrast?
//      Computed exactly rather than estimated: glue and PROTAC traverse the same
//      branch and differ only by an unconditional cap, so an uncapped glue tier is
//      identically the PROTAC tier of the same assessment. The identity is asserted
//      against the data before it is used.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TIER_RANK, type Tier } from '../modalityConstants.js';

const PLAUSIBLE = TIER_RANK['Plausible' as Tier];
const ITERATIONS = 10_000;
const SEED = 20260824;          // the seed used by exclusionBootstrap.ts
const GLUE = 'Molecular glue';
const PROTAC = 'PROTAC / degrader';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
};
const pc = (x: number) => (100 * x).toFixed(2);

interface M { modality: string; tier: Tier; developed?: boolean }
interface Rec { gene: string; goal: string; level: number; admitted: number; total: number; modalities: M[] }

const file = path.join(process.cwd(), 'deliverables', 'modality_per_assessment.json');
if (!fs.existsSync(file)) {
  console.error('Missing per-assessment dump. Run: npx tsx --env-file=.env scripts/modalityGoldsetBenchmark.ts');
  process.exit(1);
}
const all: Rec[] = JSON.parse(fs.readFileSync(file, 'utf8')).records;
const L0 = all.filter(r => r.level === 0);
const L2 = all.filter(r => r.level === 2);
const MODALITIES = [...new Set(L2.flatMap(r => r.modalities.map(m => m.modality)))];
const out: any = { note: 'Pre-submission analyses derived from the committed per-assessment dump. No new evaluation.', generatedAt: new Date().toISOString(), source: 'deliverables/modality_per_assessment.json' };
const md: string[] = ['# Extended analyses — pre-submission review', '',
  `Derived from \`deliverables/modality_per_assessment.json\` (${all.length} records; ${L2.length} assessments per ablation level).`,
  'Every figure below is recomputed from that file. No new evidence was gathered.', ''];

// ── A. Evidence-independent modalities ──────────────────────────────────────
const constancy = MODALITIES.map(k => {
  const t0 = L0.flatMap(r => r.modalities.filter(m => m.modality === k).map(m => m.tier));
  const t2 = L2.flatMap(r => r.modalities.filter(m => m.modality === k).map(m => m.tier));
  const dist = (ts: Tier[]) => ts.reduce((a, t) => (a[t] = (a[t] ?? 0) + 1, a), {} as Record<string, number>);
  const maxRank = Math.max(...t0.map(t => TIER_RANK[t]));
  const minRank = Math.min(...t0.map(t => TIER_RANK[t]));
  return {
    modality: k, distributionL0: dist(t0), distributionL2: dist(t2),
    invariant: new Set(t0).size === 1,
    neverAdmissible: maxRank < PLAUSIBLE,
    alwaysAdmitted: minRank >= PLAUSIBLE,
  };
});
out.A_evidenceIndependentModalities = constancy;
const neverAdm = constancy.filter(c => c.neverAdmissible);
const alwaysAdm = constancy.filter(c => c.alwaysAdmitted);
md.push('## A. Modalities carrying an evidence-independent verdict', '',
  '| Modality | Tier distribution (L0, n=389) | Invariant | Never admissible | Always admitted |', '|---|---|---|---|---|');
for (const c of constancy) {
  md.push(`| ${c.modality} | ${Object.entries(c.distributionL0).map(([t, n]) => `${t} ${n}`).join(', ')} | ${c.invariant ? '**yes**' : 'no'} | ${c.neverAdmissible ? '**yes**' : 'no'} | ${c.alwaysAdmitted ? '**yes**' : 'no'} |`);
}
md.push('', `Never admissible: **${neverAdm.map(c => c.modality).join(', ') || 'none'}** — capped below Plausible by an unconditional rule, so no evidence can admit them.`,
  `Always admitted: **${alwaysAdm.map(c => c.modality).join(', ') || 'none'}** — no rule path can place them below Plausible.`, '');

// ── B. Permissiveness against the reachable denominator ─────────────────────
const admittedCounts = L0.map(r => r.admitted);
const meanAdmitted = admittedCounts.reduce((a, b) => a + b, 0) / admittedCounts.length;
const reachable = MODALITIES.length - neverAdm.length;
const hist = Array.from({ length: 13 }, (_, i) => admittedCounts.filter(c => c === i).length);
out.B_permissiveness = {
  modalitiesInTaxonomy: MODALITIES.length, neverAdmissible: neverAdm.length, reachableCeiling: reachable,
  meanAdmitted, sharePublished: meanAdmitted / MODALITIES.length, shareOfReachable: meanAdmitted / reachable,
  maxObserved: Math.max(...admittedCounts), histogram: hist,
};
md.push('## B. Permissiveness against the reachable denominator', '',
  `| Quantity | Value |`, `|---|---|`,
  `| Modalities in the taxonomy | ${MODALITIES.length} |`,
  `| Never admissible by rule | ${neverAdm.length} |`,
  `| Reachable ceiling | **${reachable}** |`,
  `| Mean admitted per assessment | ${meanAdmitted.toFixed(2)} |`,
  `| Share of 12 (as previously reported) | ${pc(meanAdmitted / MODALITIES.length)}% |`,
  `| **Share of the ${reachable} reachable** | **${pc(meanAdmitted / reachable)}%** |`,
  `| Maximum ever admitted | ${Math.max(...admittedCounts)} |`, '',
  `The admitted-count distribution is hard-truncated: no assessment admits more than ${Math.max(...admittedCounts)} of ${MODALITIES.length}, which is the signature of the caps in A.`, '');

// ── C / D / E. Exclusion contrasts ──────────────────────────────────────────
const excluded = (t: Tier) => TIER_RANK[t] < PLAUSIBLE;
const developedClasses = new Set(L2.flatMap(r => r.modalities.filter(m => m.developed).map(m => m.modality)));

// C — per-modality decomposition
const per = MODALITIES.map(k => {
  let dEx = 0, dT = 0, aEx = 0, aT = 0;
  for (const r of L2) for (const m of r.modalities) {
    if (m.modality !== k) continue;
    if (m.developed) { dT++; if (excluded(m.tier)) dEx++; } else { aT++; if (excluded(m.tier)) aEx++; }
  }
  return { modality: k, devTotal: dT, devExcluded: dEx, altTotal: aT, altExcluded: aEx, altRate: aT ? aEx / aT : null };
}).sort((a, b) => b.altExcluded - a.altExcluded);
const totalAltEx = per.reduce((a, p) => a + p.altExcluded, 0);
out.C_perModalityExclusion = { totalAlternativeExclusions: totalAltEx, rows: per };
md.push('## C. Which modalities supply the exclusion contrast', '',
  '| Modality | Alternatives excluded | Rate | Share of all exclusions | *n* as developed |', '|---|---|---|---|---|');
for (const p of per) md.push(`| ${p.modality} | ${p.altExcluded}/${p.altTotal} | ${p.altRate === null ? '—' : pc(p.altRate) + '%'} | ${pc(p.altExcluded / totalAltEx)}% | ${p.devTotal} |`);
const ruleCapped = per.filter(p => neverAdm.some(c => c.modality === p.modality));
md.push('', `Modalities capped below Plausible by rule supply ${ruleCapped.reduce((a, p) => a + p.altExcluded, 0)} of ${totalAltEx} exclusions (${pc(ruleCapped.reduce((a, p) => a + p.altExcluded, 0) / totalAltEx)}%).`,
  `Modality classes that never appear as a developed modality supply ${per.filter(p => !developedClasses.has(p.modality)).reduce((a, p) => a + p.altExcluded, 0)} (${pc(per.filter(p => !developedClasses.has(p.modality)).reduce((a, p) => a + p.altExcluded, 0) / totalAltEx)}%).`, '');

// Shared machinery for the bootstrapped contrasts.
const byGene = new Map<string, Rec[]>();
for (const r of L2) { if (!byGene.has(r.gene)) byGene.set(r.gene, []); byGene.get(r.gene)!.push(r); }
const genes = [...byGene.keys()].sort();

type Tally = { dEx: number; dT: number; aEx: number; aT: number };
function contrast(gs: string[], keepAlt: (m: M) => boolean, tierOf: (m: M, r: Rec) => Tier): Tally {
  let dEx = 0, dT = 0, aEx = 0, aT = 0;
  for (const g of gs) for (const r of byGene.get(g)!) for (const m of r.modalities) {
    const t = tierOf(m, r);
    if (m.developed) { dT++; if (excluded(t)) dEx++; }
    else if (keepAlt(m)) { aT++; if (excluded(t)) aEx++; }
  }
  return { dEx, dT, aEx, aT };
}
function bootstrap(keepAlt: (m: M) => boolean, tierOf: (m: M, r: Rec) => Tier) {
  const point = contrast(genes, keepAlt, tierOf);
  const rand = rng(SEED);
  const diffs: number[] = [], rrs: number[] = [];
  let undef = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const s: string[] = [];
    for (let k = 0; k < genes.length; k++) s.push(genes[Math.floor(rand() * genes.length)]);
    const t = contrast(s, keepAlt, tierOf);
    if (!t.dT || !t.aT) continue;
    diffs.push(t.aEx / t.aT - t.dEx / t.dT);
    if (t.dEx === 0) { undef++; continue; }
    rrs.push((t.aEx / t.aT) / (t.dEx / t.dT));
  }
  return {
    point, devRate: point.dEx / point.dT, altRate: point.aEx / point.aT,
    riskDifference: point.aEx / point.aT - point.dEx / point.dT,
    riskDifferenceCI: [q(diffs, 0.025), q(diffs, 0.975)],
    riskRatio: (point.aEx / point.aT) / (point.dEx / point.dT),
    riskRatioCI: [q(rrs, 0.025), q(rrs, 0.975)],
    resamplesWithNoDevelopedExclusion: undef, seed: SEED, iterations: ITERATIONS,
  };
}
const identity = (m: M) => m.tier;

const published = bootstrap(() => true, identity);
const likeForLike = bootstrap(m => developedClasses.has(m.modality), identity);

// E — glue counterfactual. Assert the identity before relying on it.
let identityHolds = true, checked = 0;
for (const r of all) {
  const g = r.modalities.find(m => m.modality === GLUE), p = r.modalities.find(m => m.modality === PROTAC);
  if (!g || !p) continue;
  checked++;
  if (TIER_RANK[g.tier] !== Math.min(TIER_RANK[p.tier], TIER_RANK['Speculative' as Tier])) identityHolds = false;
}
const glueTier = (m: M, r: Rec): Tier =>
  m.modality === GLUE ? (r.modalities.find(x => x.modality === PROTAC)!.tier) : m.tier;
const glueFixed = identityHolds ? bootstrap(() => true, glueTier) : null;
const glueFixedLFL = identityHolds ? bootstrap(m => developedClasses.has(m.modality), glueTier) : null;

out.D_likeForLike = { developedClasses: [...developedClasses], published, likeForLike };
out.E_glueCounterfactual = {
  identityAsserted: 'tier(Molecular glue) === min(tier(PROTAC / degrader), Speculative) in every record',
  identityHolds, recordsChecked: checked,
  allAlternatives: glueFixed, likeForLike: glueFixedLFL,
};

const row = (name: string, b: any) => `| ${name} | ${pc(b.devRate)}% (${b.point.dEx}/${b.point.dT}) | ${pc(b.altRate)}% (${b.point.aEx}/${b.point.aT}) | **${pc(b.riskDifference)} pp** | ${pc(b.riskDifferenceCI[0])}–${pc(b.riskDifferenceCI[1])} | ${b.riskRatio.toFixed(1)} |`;
md.push('## D. The exclusion contrast, decomposed and like-for-like', '',
  'Gene-level percentile bootstrap, 10,000 resamples, seed 20260824 — the same procedure and seed as `exclusionBootstrap.ts`.', '',
  '| Comparison | Developed excluded | Alternatives excluded | Risk difference | 95% CI (pp) | Risk ratio |', '|---|---|---|---|---|---|',
  row('All eleven alternatives (as published)', published),
  row(`Like-for-like — alternatives restricted to the ${developedClasses.size} classes that ever appear as developed`, likeForLike), '',
  `Developed classes: ${[...developedClasses].join(', ')}.`,
  'The like-for-like comparison removes the composition confound: it contrasts the developed modality',
  'against alternatives drawn from the same modality classes, so no part of the difference can come from',
  'modality classes that never appear as a developed modality.', '');

md.push('## E. Counterfactual — correcting the molecular-glue rule', '',
  `Identity check: \`tier(${GLUE}) === min(tier(${PROTAC}), Speculative)\` — **${identityHolds ? 'holds' : 'FAILS'}** across all ${checked} records.`,
  '', 'Molecular glue and PROTAC traverse the same rule branch on the same evidence and are subject to the',
  'same goal gates; they differ only by an unconditional cap applied to glue. Removing that cap therefore',
  'makes the glue tier identically the PROTAC tier of the same assessment, so the counterfactual is exact',
  'rather than estimated.', '');
if (glueFixed && glueFixedLFL) {
  md.push('| Comparison | Developed excluded | Alternatives excluded | Risk difference | 95% CI (pp) | Risk ratio |', '|---|---|---|---|---|---|',
    row('All alternatives, glue cap removed', glueFixed),
    row('Like-for-like, glue cap removed', glueFixedLFL), '',
    `Removing the cap moves the all-alternatives risk difference from ${pc(published.riskDifference)} pp to ${pc(glueFixed.riskDifference)} pp.`,
    `The like-for-like contrast is unchanged at ${pc(glueFixedLFL.riskDifference)} pp, because molecular glue is not one of the classes it compares against — which is the reason to report the like-for-like figure as primary.`, '');
}

md.push('---', '', `Generated by \`scripts/modalityExtendedAnalyses.ts\` at ${out.generatedAt}.`, '');
fs.mkdirSync('deliverables', { recursive: true });
fs.writeFileSync('deliverables/modality_extended_analyses.json', JSON.stringify(out, null, 2));
fs.writeFileSync('deliverables/modality_extended_analyses.md', md.join('\n'));
console.log(md.join('\n'));
console.log('\nWrote deliverables/modality_extended_analyses.{json,md}');
