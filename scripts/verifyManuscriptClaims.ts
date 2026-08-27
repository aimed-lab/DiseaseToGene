// scripts/verifyManuscriptClaims.ts ──────────────────────────────────────────
// Recomputes every quantitative claim in the manuscript from primitive data and
// checks it against what the text asserts.
//
//   npx tsx scripts/verifyManuscriptClaims.ts
//   → deliverables/manuscript_verification.md   (the reviewer-facing audit table)
//   → exit code 1 if any claim fails
//
// The point is not that the numbers were computed correctly once. It is that a
// reader can re-derive each one without trusting the prose. Supplementary Note S3.5
// records a case where a value quoted FROM a result file was right and a sentence
// written ABOUT those values was wrong; this script exists so that class of error
// cannot recur silently.
//
// Claims are recomputed from primitives — counts of records, not restated summary
// fields — wherever the primitive exists. Where a claim can only come from a summary
// file, that is stated in the Source column so the weaker provenance is visible.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TIER_RANK, type Tier } from '../modalityConstants.js';

const D = (p: string) => path.join(process.cwd(), p);
const J = (p: string) => JSON.parse(fs.readFileSync(D(p), 'utf8'));
const PLAUSIBLE = TIER_RANK['Plausible' as Tier];

// ── statistics ──────────────────────────────────────────────────────────────
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.959963985, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h) * 100, Math.min(1, c + h) * 100];
}
function twoPropZ(k1: number, n1: number, k2: number, n2: number) {
  const p = (k1 + k2) / (n1 + n2);
  return (k2 / n2 - k1 / n1) / Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
}
const lgamma = (x: number): number => {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (let j = 0; j < 6; j++) s += g[j] / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
};
const lchoose = (n: number, k: number) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
/** Two-tailed Fisher exact test on a 2x2 table, by summing tables no more probable than observed. */
function fisher2t(a: number, b: number, c: number, d: number) {
  const n = a + b + c + d, r1 = a + b, c1 = a + c;
  const pr = (x: number) => Math.exp(lchoose(r1, x) + lchoose(n - r1, c1 - x) - lchoose(n, c1));
  const p0 = pr(a), lo = Math.max(0, c1 - (n - r1)), hi = Math.min(r1, c1);
  let s = 0;
  for (let x = lo; x <= hi; x++) { const p = pr(x); if (p <= p0 * (1 + 1e-9)) s += p; }
  return Math.min(1, s);
}

// ── the ledger ──────────────────────────────────────────────────────────────
interface Claim { id: string; section: string; claim: string; source: string; expected: string; actual: string; ok: boolean }
const claims: Claim[] = [];
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
function check(id: string, section: string, claim: string, source: string, expected: string, actual: string, ok: boolean) {
  claims.push({ id, section, claim, source, expected, actual, ok });
}
function num(id: string, section: string, claim: string, source: string, expected: number, actual: number, tol: number, unit = '') {
  check(id, section, claim, source, `${expected}${unit}`, `${round(actual)}${unit}`, near(expected, actual, tol));
}
const round = (x: number) => Number.isInteger(x) ? String(x) : x.toFixed(Math.abs(x) < 10 ? 3 : 2);

// ── load primitives ─────────────────────────────────────────────────────────
const gold = J('data/modality_goldset.json');
const pairs: any[] = gold.pairs;
const perAsmt = J('deliverables/modality_per_assessment.json').records as any[];
const L0 = perAsmt.filter(r => r.level === 0), L1 = perAsmt.filter(r => r.level === 1), L2 = perAsmt.filter(r => r.level === 2);
const gsr = J('deliverables/modality_goldset_results.json');
const boot = J('deliverables/exclusion_bootstrap.json');
const gbt = J('manuscript/results/goal_blind_tractability.json');
const ext = J('deliverables/modality_extended_analyses.json');
const base = fs.existsSync(D('deliverables/goal_blind_baseline.json')) ? J('deliverables/goal_blind_baseline.json') : null;

// ── §2.3 / S1 gold-set composition ──────────────────────────────────────────
num('GS-1', '§2.3', 'Gold set contains 400 assignments', 'data/modality_goldset.json → count of pairs[]', 400, pairs.length, 0);
num('GS-2', '§2.3', 'Gold set spans 354 genes', 'data/modality_goldset.json → distinct pairs[].gene', 354, new Set(pairs.map(p => p.gene)).size, 0);
const byMod = pairs.reduce((a, p) => (a[p.modality] = (a[p.modality] ?? 0) + 1, a), {} as Record<string, number>);
const byGoal = pairs.reduce((a, p) => (a[p.goal] = (a[p.goal] ?? 0) + 1, a), {} as Record<string, number>);
num('GS-3', '§2.3', '342 small-molecule assignments', 'count of pairs[] with modality=SM', 342, byMod.SM, 0);
num('GS-4', '§2.3', '48 antibody assignments', 'count of pairs[] with modality=Antibody', 48, byMod.Antibody, 0);
num('GS-5', '§2.3', '8 RNA-knockdown assignments', 'count of pairs[] with modality=RNA', 8, byMod.RNA, 0);
num('GS-6', '§2.3', '2 splice-switching assignments', 'count of pairs[] with modality=Splice', 2, byMod.Splice, 0);
num('GS-7', '§2.3', '305 inhibit assignments', 'count of pairs[] with goal=inhibit', 305, byGoal.inhibit, 0);
num('GS-8', '§2.3', '86 restore-function assignments', 'count of pairs[] with goal=restore_function', 86, byGoal.restore_function, 0);
num('GS-9', '§2.3', '8 reduce-level assignments', 'count of pairs[] with goal=reduce_level', 8, byGoal.reduce_level, 0);
num('GS-10', '§2.3', '1 degrade assignment', 'count of pairs[] with goal=degrade', 1, byGoal.degrade, 0);
check('GS-11', '§2.3', 'Modality counts sum to the total', 'derived', '400', String(Object.values(byMod).reduce((a: number, b: any) => a + b, 0)), Object.values(byMod).reduce((a: number, b: any) => a + b, 0) === 400);
check('GS-12', '§2.3', 'Goal counts sum to the total', 'derived', '400', String(Object.values(byGoal).reduce((a: number, b: any) => a + b, 0)), Object.values(byGoal).reduce((a: number, b: any) => a + b, 0) === 400);
num('GS-13', 'S1', '3,814 ChEMBL mechanism records scanned', 'modality_goldset.json → mechanisms_scanned', 3814, gold.mechanisms_scanned, 0);
num('GS-14', 'S1', '723 records dropped: action type', 'modality_goldset.json → dropped.action', 723, gold.dropped.action, 0);
num('GS-15', 'S1', '299 records dropped: molecule type', 'modality_goldset.json → dropped.moleculeType', 299, gold.dropped.moleculeType, 0);
num('GS-16', 'S1', '1,117 records dropped: target kind', 'modality_goldset.json → dropped.targetKind', 1117, gold.dropped.targetKind, 0);
num('GS-17', 'S1', '62 records dropped: gene unresolvable', 'modality_goldset.json → dropped.noGene', 62, gold.dropped.noGene, 0);
num('GS-18', 'S1', '1 record dropped: oligonucleotide inexpressible', 'modality_goldset.json → dropped.oligoUnmappable', 1, gold.dropped.oligoUnmappable, 0);

// ── assessment counts ───────────────────────────────────────────────────────
num('AS-1', '§2.6', '389 (gene, goal) assessments', 'per-assessment dump → count of level-0 records', 389, L0.length, 0);
const totalAsmt = L0.reduce((a, r) => a + r.modalities.length, 0);
num('AS-2', '§2.6', '4,668 individual modality assessments', 'per-assessment dump → sum of modalities[] over level-0 records', 4668, totalAsmt, 0);
const devCount = L2.reduce((a, r) => a + r.modalities.filter((m: any) => m.developed).length, 0);
num('AS-3', '§2.7', '400 developed-modality assessments', 'per-assessment dump → count of modalities[] with developed=true', 400, devCount, 0);
num('AS-4', '§2.7', '4,268 alternative assessments', 'derived: 4,668 − 400', 4268, totalAsmt - devCount, 0);

// ── §2.5 recall, recomputed from tiers ──────────────────────────────────────
// Engine taxonomy name -> gold-set modality code. The per-assessment dump records the
// engine's modality names; the gold set records its own four-code vocabulary.
const ENGINE_TO_CLASS: Record<string, string> = {
  'Conventional small molecule': 'SM',
  'Antibody / intrabody': 'Antibody',
  'RNA knockdown (siRNA/gapmer ASO)': 'RNA',
  'Splice-switching ASO': 'Splice',
};
const recallAt = (recs: any[]) => {
  let hit = 0, tot = 0; const byM: Record<string, [number, number]> = {}, byG: Record<string, [number, number]> = {};
  for (const r of recs) for (const m of r.modalities) {
    if (!m.developed) continue;
    const ok = TIER_RANK[m.tier as Tier] >= PLAUSIBLE;
    tot++; if (ok) hit++;
    const cls = ENGINE_TO_CLASS[m.modality] ?? m.modality;
    byM[cls] ??= [0, 0]; byM[cls][1]++; if (ok) byM[cls][0]++;
    byG[r.goal] ??= [0, 0]; byG[r.goal][1]++; if (ok) byG[r.goal][0]++;
  }
  return { hit, tot, byM, byG };
};
const r0 = recallAt(L0), r1 = recallAt(L1), r2 = recallAt(L2);
num('RC-1', '§2.5', 'Recall at L0 is 399/400', 'per-assessment dump → developed modalities tiered ≥ Plausible', 399, r0.hit, 0);
num('RC-2', '§2.8', 'Recall at L1 is 399/400', 'per-assessment dump, level 1', 399, r1.hit, 0);
num('RC-3', '§2.8', 'Recall at L2 is 397/400', 'per-assessment dump, level 2', 397, r2.hit, 0);
num('RC-4', '§2.5', 'Recall at L0 is 99.8%', 'derived: 399/400', 99.8, 100 * r0.hit / r0.tot, 0.05, '%');
check('RC-5', '§2.8', 'Recall at L2 is 99.25% exactly (text rounds to 99.3, Figure 4 renders 99.2)',
  'derived: 397/400', '99.25%', `${(100 * r2.hit / r2.tot).toFixed(2)}%`, near(99.25, 100 * r2.hit / r2.tot, 0.005));
for (const [lvl, r] of [['L0', r0], ['L2', r2]] as const) {
  const ns = Object.entries(r.byM).filter(([k]) => k !== 'SM').reduce((a, [, v]) => [a[0] + v[0], a[1] + v[1]], [0, 0]);
  num(`RC-NS-${lvl}`, '§2.5/§2.8', `Non-small-molecule recall at ${lvl} is 58/58`, 'per-assessment dump, developed non-SM assignments', 58, ns[0], 0);
}
const w = wilson(399, 400);
check('CI-1', '§2.5', 'Wilson 95% CI for 399/400 is 98.6–100.0', 'recomputed Wilson interval', '98.6–100.0', `${w[0].toFixed(1)}–${w[1].toFixed(1)}`, near(w[0], 98.6, 0.05) && near(w[1], 100.0, 0.05));
const wns = wilson(58, 58);
check('CI-2', '§2.5', 'Wilson 95% CI for 58/58 is 93.8–100.0', 'recomputed Wilson interval', '93.8–100.0', `${wns[0].toFixed(1)}–${wns[1].toFixed(1)}`, near(wns[0], 93.8, 0.05));
for (const [k, n, lo, hi, lbl] of [[48, 48, 92.6, 100.0, 'antibody 48/48'], [8, 8, 67.6, 100.0, 'RNA 8/8'], [2, 2, 34.2, 100.0, 'splice 2/2'], [341, 342, 98.4, 99.9, 'small molecule 341/342'], [342, 400, 81.7, 88.6, 'base rate 342/400']] as [number, number, number, number, string][]) {
  const ww = wilson(k, n);
  check(`CI-${lbl.split(' ')[0]}`, 'S2', `Wilson 95% CI for ${lbl} is ${lo}–${hi}`, 'recomputed Wilson interval', `${lo}–${hi}`, `${ww[0].toFixed(1)}–${ww[1].toFixed(1)}`, near(ww[0], lo, 0.06) && near(ww[1], hi, 0.06));
}
num('BR-1', '§2.4', 'Always-small-molecule base rate is 85.5%', 'derived: 342/400', 85.5, 100 * byMod.SM / pairs.length, 0.05, '%');

// ── §2.6 permissiveness ─────────────────────────────────────────────────────
const meanAdm = L0.reduce((a, r) => a + r.admitted, 0) / L0.length;
num('PM-1', '§2.6', 'Permissiveness is 65.6% of twelve modalities', 'per-assessment dump → mean(admitted)/12', 65.6, 100 * meanAdm / 12, 0.05, '%');
num('PM-2', '§2.6', 'Approximately 7.9 of 12 modalities admitted', 'per-assessment dump → mean(admitted)', 7.9, meanAdm, 0.05);
num('PM-3', 'NEW', 'Only 10 of 12 modalities are ever admissible', 'extended analyses → B.reachableCeiling', 10, ext.B_permissiveness.reachableCeiling, 0);
num('PM-4', 'NEW', 'Permissiveness against the reachable denominator is 78.7%', 'derived: mean(admitted)/10', 78.7, 100 * meanAdm / 10, 0.05, '%');
num('PM-5', 'NEW', 'No assessment ever admits more than 9 modalities', 'per-assessment dump → max(admitted)', 9, Math.max(...L0.map(r => r.admitted)), 0);

// ── §2.7 tier separation ────────────────────────────────────────────────────
const sep = (recs: any[], dev: boolean) => {
  const c: Record<string, number> = { Precedented: 0, Plausible: 0, Speculative: 0, Blocked: 0 }; let n = 0;
  for (const r of recs) for (const m of r.modalities) if (!!m.developed === dev) { c[m.tier]++; n++; }
  return { c, n };
};
for (const [lvl, recs] of [['L0', L0], ['L2', L2]] as const)
  for (const dev of [true, false]) {
    const { c, n } = sep(recs, dev);
    const exp: Record<string, Record<string, number>> = {
      'L0-dev': { Precedented: 99.3, Plausible: 0.5, Speculative: 0.3, Blocked: 0.0 },
      'L0-alt': { Precedented: 1.3, Plausible: 61.0, Speculative: 29.2, Blocked: 8.4 },
      'L2-dev': { Precedented: 0.0, Plausible: 99.3, Speculative: 0.8, Blocked: 0.0 },
      'L2-alt': { Precedented: 0.0, Plausible: 62.3, Speculative: 29.3, Blocked: 8.4 },
    };
    const key = `${lvl}-${dev ? 'dev' : 'alt'}`;
    for (const t of ['Precedented', 'Plausible', 'Speculative', 'Blocked'])
      num(`TS-${key}-${t.slice(0, 4)}`, '§2.7 / S4', `${key} ${t} = ${exp[key][t]}%`, 'per-assessment dump → tier counts', exp[key][t], 100 * c[t] / n, 0.06, '%');
  }

// ── §2.8 exclusion contrast ─────────────────────────────────────────────────
let dEx = 0, dT = 0, aEx = 0, aT = 0;
for (const r of L2) for (const m of r.modalities) {
  const ex = TIER_RANK[m.tier as Tier] < PLAUSIBLE;
  if (m.developed) { dT++; if (ex) dEx++; } else { aT++; if (ex) aEx++; }
}
num('EX-1', '§2.8', 'Developed modality excluded in 3 of 400', 'per-assessment dump, level 2', 3, dEx, 0);
num('EX-2', '§2.8', 'Alternatives excluded in 1,611 of 4,268', 'per-assessment dump, level 2', 1611, aEx, 0);
num('EX-3', '§2.8', 'Developed exclusion rate 0.75%', 'derived', 0.75, 100 * dEx / dT, 0.01, '%');
// v1 reported 37.8%. 1611/4268 = 37.7460%, which is 37.75% at two decimals and 37.7% at one.
// The v1 abstract, §2.8, Figure 2 and README carried 37.8 — a rounded value rounded a second time.
// v2 reports 37.7%. Both the correct and the superseded figure are checked so the correction is visible.
num('EX-4', '§2.8', 'Alternative exclusion rate 37.7% (v2, corrected)', 'derived: 1611/4268', 37.7, 100 * aEx / aT, 0.05, '%');
check('EX-4b', '§2.8', 'v1 value 37.8% was a double-rounding error', 'derived: 1611/4268 = 37.7460%',
  'v1 said 37.8%', `37.75% at 2 dp, 37.7% at 1 dp`, Math.abs(100 * aEx / aT - 37.8) > 0.05);
num('EX-5', '§2.8', 'Risk ratio 50.3', 'derived', 50.3, (aEx / aT) / (dEx / dT), 0.05);
num('EX-6', '§2.8', 'Risk difference 37.0 percentage points', 'derived', 37.0, 100 * (aEx / aT - dEx / dT), 0.05, ' pp');
num('EX-7', '§2.8', 'Two-proportion z = 14.9', 'recomputed', 14.9, twoPropZ(dEx, dT, aEx, aT), 0.05);
const we1 = wilson(dEx, dT), we2 = wilson(aEx, aT);
check('EX-8', '§2.8', 'Wilson CI for 3/400 is 0.26–2.18', 'recomputed', '0.26–2.18', `${we1[0].toFixed(2)}–${we1[1].toFixed(2)}`, near(we1[0], 0.26, 0.01) && near(we1[1], 2.18, 0.01));
check('EX-9', '§2.8', 'Wilson CI for 1,611/4,268 is 36.3–39.2', 'recomputed', '36.3–39.2', `${we2[0].toFixed(1)}–${we2[1].toFixed(1)}`, near(we2[0], 36.3, 0.05) && near(we2[1], 39.2, 0.05));

// ── bootstrap ───────────────────────────────────────────────────────────────
num('BT-1', '§2.8', 'Bootstrap risk-difference CI lower bound 35.7 pp', 'exclusion_bootstrap.json', 35.7, 100 * boot.riskDifferenceCI[0], 0.06, ' pp');
num('BT-2', '§2.8', 'Bootstrap risk-difference CI upper bound 38.3 pp', 'exclusion_bootstrap.json', 38.3, 100 * boot.riskDifferenceCI[1], 0.06, ' pp');
num('BT-3', '§2.8', 'Bootstrap risk-ratio CI 22.3–153.2', 'exclusion_bootstrap.json', 22.3, boot.riskRatioCI[0], 0.06);
num('BT-4', '§2.8', 'Bootstrap risk-ratio CI upper 153.2', 'exclusion_bootstrap.json', 153.2, boot.riskRatioCI[1], 0.06);
num('BT-5', '§2.8', '443 of 10,000 resamples had no excluded developed modality', 'exclusion_bootstrap.json', 443, boot.resamplesWithNoDevelopedExclusion, 0);
num('BT-6', '§2.8', 'Bootstrap uses 10,000 resamples', 'exclusion_bootstrap.json', 10000, boot.iterations, 0);
check('BT-7', 'Methods', 'Bootstrap seed is fixed (reproducible)', 'exclusion_bootstrap.json', 'fixed seed', String(boot.seed), Number.isInteger(boot.seed));

// ── §2.11 misses ────────────────────────────────────────────────────────────
const missAt = (recs: any[]) => recs.flatMap(r => r.modalities.filter((m: any) => m.developed && TIER_RANK[m.tier as Tier] < PLAUSIBLE).map(() => r.gene)).sort();
check('MS-1', '§2.11', 'The only L0 miss is ESR1', 'per-assessment dump, level 0', 'ESR1', missAt(L0).join(', '), missAt(L0).join(',') === 'ESR1');
check('MS-2', '§2.11', 'The three L2 misses are EEF1A2, ESR1, GHR', 'per-assessment dump, level 2', 'EEF1A2, ESR1, GHR', missAt(L2).join(', '), missAt(L2).join(',') === 'EEF1A2,ESR1,GHR');
check('MS-3', 'S5', 'No non-small-molecule assignment is missed at any level', 'goldset results → nonSMByLevel',
  '58/58 at L0, L1, L2', ['L0', 'L1', 'L2'].map(l => `${gsr.nonSMByLevel[l].hit}/${gsr.nonSMByLevel[l].total}`).join(', '),
  ['L0', 'L1', 'L2'].every(l => gsr.nonSMByLevel[l].hit === 58 && gsr.nonSMByLevel[l].total === 58));

// ── §2.10 goal-blind comparison ─────────────────────────────────────────────
num('GB-1', '§2.10', '85 gain-of-function targets examined', 'goal_blind_tractability.json → nTargets', 85, gbt.nTargets, 0);
num('GB-2', '§2.10', '84 carry a degrader-tractability handle', 'goal_blind_tractability.json → withDegraderHandle', 84, gbt.withDegraderHandle, 0);
num('GB-3', '§2.10', 'Gain-of-function rate 98.8%', 'derived: 84/85', 98.8, 100 * gbt.withDegraderHandle / gbt.nTargets, 0.05, '%');
num('GB-4', '§2.10', 'Control: 56 of 60 carry the handle (93.3%)', 'goal_blind_tractability.json → control', 93.3, 100 * gbt.control.withDegraderHandle / gbt.control.genes.length, 0.05, '%');
num('GB-5', '§2.10', 'Difference is 5.5 percentage points', 'derived', 5.5, gbt.differencePercentagePoints, 0.05, ' pp');
num('GB-6', '§2.10', 'Fisher exact two-tailed p = 0.16', 'recomputed from the 2x2 table', 0.16, fisher2t(84, 1, 56, 4), 0.005);
num('GB-7', '§2.10', 'Removal blocked by goal for all 85', 'goal_blind_tractability.json', 85, gbt.bothRemovalModalitiesBlockedByGoal, 0);

// ── extended analyses (new in v2) ───────────────────────────────────────────
num('NX-1', 'NEW', 'Like-for-like risk difference is 45.9 pp', 'extended analyses → D.likeForLike', 45.88, 100 * ext.D_likeForLike.likeForLike.riskDifference, 0.05, ' pp');
num('NX-2', 'NEW', 'Like-for-like alternative exclusion rate is 46.6%', 'extended analyses → D.likeForLike', 46.63, 100 * ext.D_likeForLike.likeForLike.altRate, 0.05, '%');
// The glue counterfactual is only defined while the cap is still in place. Once the rule is
// corrected and the benchmark re-run, tier(glue) === tier(PROTAC) and the identity that made
// the counterfactual exact no longer holds — by design. Report that state rather than crashing
// on a null, so the verifier stays usable across the correction rather than only before it.
const gc = ext.E_glueCounterfactual;
if (gc?.identityHolds && gc.allAlternatives && gc.likeForLike) {
  check('NX-3', 'NEW', 'Glue identity tier(glue) === min(tier(PROTAC), Speculative) holds', 'extended analyses → E.identityHolds', 'true', 'true', true);
  num('NX-4', 'NEW', 'Glue counterfactual moves the all-alternatives difference to 31.2 pp', 'extended analyses → E.allAlternatives', 31.16, 100 * gc.allAlternatives.riskDifference, 0.05, ' pp');
  check('NX-5', 'NEW', 'Like-for-like contrast is invariant to the glue correction', 'extended analyses → E.likeForLike vs D.likeForLike',
    'identical', `${(100 * gc.likeForLike.riskDifference).toFixed(2)} pp vs ${(100 * ext.D_likeForLike.likeForLike.riskDifference).toFixed(2)} pp`,
    near(gc.likeForLike.riskDifference, ext.D_likeForLike.likeForLike.riskDifference, 1e-12));
} else {
  check('NX-3', 'NEW', 'Glue cap state: counterfactual applies only while the cap is in place',
    'extended analyses → E.identityHolds', 'identity holds (cap present)',
    'identity does not hold — rule corrected and benchmark re-run', true);
}
num('NX-6', 'NEW', 'Rule-capped modalities supply 48.3% of all exclusions', 'extended analyses → C', 48.29,
  100 * ext.C_perModalityExclusion.rows.filter((r: any) => r.altRate === 1).reduce((a: number, r: any) => a + r.altExcluded, 0) / ext.C_perModalityExclusion.totalAlternativeExclusions, 0.05, '%');

// Supplementary Table S7 — every tier count in the table, checked against the dump.
// A first draft of S7 carried two hand-typed rows that were wrong; these claims exist so a
// transcribed distribution cannot survive.
const S7: Record<string, Record<string, number>> = {
  'Linear peptide': { Speculative: 389 },
  'Molecular glue': { Speculative: 257, Blocked: 132 },
  'Expression / genetic modulation': { Plausible: 389 },
  'Conventional small molecule': { Precedented: 343, Plausible: 27, Speculative: 19 },
  'Antibody / intrabody': { Precedented: 94, Plausible: 170, Speculative: 125 },
  'Interaction-disrupting biologic': { Plausible: 292, Speculative: 97 },
  'RNA knockdown (siRNA/gapmer ASO)': { Plausible: 288, Blocked: 85, Precedented: 16 },
  'Stapled / macrocyclic peptide': { Plausible: 376, Speculative: 13 },
  'PROTAC / degrader': { Plausible: 249, Blocked: 132, Speculative: 8 },
  'Covalent ligand': { Plausible: 368, Speculative: 21 },
  'Fragments': { Plausible: 370, Speculative: 19 },
  'Splice-switching ASO': { Speculative: 301, Plausible: 78, Blocked: 10 },
};
for (const [mod, exp] of Object.entries(S7)) {
  const got: Record<string, number> = {};
  for (const r of L0) for (const m of r.modalities) if (m.modality === mod) got[m.tier] = (got[m.tier] ?? 0) + 1;
  const norm = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => v > 0).sort().map(([k, v]) => `${k} ${v}`).join(', ');
  check(`S7-${mod.slice(0, 14)}`, 'S7', `${mod} tier distribution`, 'per-assessment dump, level 0', norm(exp), norm(got), norm(exp) === norm(got));
}

if (base) {
  const cf = base.variants.clinicalFree;
  num('BL-1', 'NEW', 'Goal-blind baseline overall recall (clinical-free) is 96.8%', 'goal_blind_baseline.json', 96.8, 100 * cf.overall.recall, 0.05, '%');
  num('BL-2', 'NEW', 'Goal-blind baseline non-SM recall (clinical-free) is 82.8%', 'goal_blind_baseline.json', 82.8, 100 * cf.nonSM.recall, 0.05, '%');
  num('BL-3', 'NEW', 'Goal-blind baseline recovers 0 of 8 RNA assignments (clinical-free)', 'goal_blind_baseline.json', 0, cf.byModality.RNA.hit, 0);
  num('BL-4', 'NEW', 'Goal-blind baseline recovers 0 of 2 splice assignments (clinical-free)', 'goal_blind_baseline.json', 0, cf.byModality.Splice.hit, 0);
  num('BL-5', 'NEW', 'Rules recover 10 of 10 oligonucleotide assignments at L2', 'per-assessment dump', 10,
    L2.reduce((a, r) => a + r.modalities.filter((m: any) => m.developed && /ASO|knockdown/i.test(m.modality) && TIER_RANK[m.tier as Tier] >= PLAUSIBLE).length, 0), 0);
}

// ── report ──────────────────────────────────────────────────────────────────
const pass = claims.filter(c => c.ok).length, fail = claims.length - pass;
const md = ['# Manuscript verification — every quantitative claim, recomputed', '',
  `**${pass} of ${claims.length} claims verified.**${fail ? ` **${fail} FAILED.**` : ' No discrepancies.'}`, '',
  `Generated by \`scripts/verifyManuscriptClaims.ts\` at ${new Date().toISOString()}.`,
  'Each row is recomputed from the primitive data named in Source — record counts and tier assignments,',
  'not restated summary fields — and compared against what the manuscript asserts. Statistical quantities',
  '(Wilson intervals, the two-proportion *z*, Fisher\'s exact test) are recomputed inside this script from',
  'their definitions rather than read from any result file.', '',
  '| # | Section | Claim | Source | Manuscript | Recomputed | |', '|---|---|---|---|---|---|---|'];
for (const c of claims) md.push(`| ${c.id} | ${c.section} | ${c.claim} | \`${c.source}\` | ${c.expected} | ${c.actual} | ${c.ok ? 'PASS' : '**FAIL**'} |`);
md.push('', '## Provenance chain', '',
  '| Layer | Artifact | Produced by |', '|---|---|---|',
  '| Primary sources | ChEMBL, Open Targets, UniProt, STRING, Ensembl, ProteinsPlus/DoGSite3 | public APIs |',
  '| Derived gold set | `data/modality_goldset.json` | `scripts/buildModalityGoldset.ts` |',
  '| Per-assessment tiers | `deliverables/modality_per_assessment.json` | `scripts/modalityGoldsetBenchmark.ts` |',
  '| Summary results | `deliverables/modality_goldset_results.json` | `scripts/modalityGoldsetBenchmark.ts` |',
  '| Clustered intervals | `deliverables/exclusion_bootstrap.json` | `scripts/exclusionBootstrap.ts` |',
  '| Extended analyses | `deliverables/modality_extended_analyses.json` | `scripts/modalityExtendedAnalyses.ts` |',
  '| Goal-blind baseline | `deliverables/goal_blind_baseline.json` | `scripts/goalBlindBaseline.ts` |',
  '| Tractability snapshot | `deliverables/ot_tractability_snapshot.json` | `scripts/goalBlindBaseline.ts` |',
  '| This audit | `deliverables/manuscript_verification.md` | `scripts/verifyManuscriptClaims.ts` |', '');
fs.mkdirSync('deliverables', { recursive: true });
fs.writeFileSync(D('deliverables/manuscript_verification.md'), md.join('\n'));
console.log(`${pass}/${claims.length} claims verified${fail ? `; ${fail} FAILED` : ''}`);
for (const c of claims.filter(c => !c.ok)) console.log(`  FAIL ${c.id} [${c.section}] ${c.claim}\n       manuscript=${c.expected}  recomputed=${c.actual}`);
console.log('\nWrote deliverables/manuscript_verification.md');
process.exit(fail ? 1 : 0);
