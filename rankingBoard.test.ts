// rankingBoard.test.ts ───────────────────────────────────────────────────────
// Checks for the clinical-attrition scoring. No test framework — run with:
//   npx tsx rankingBoard.test.ts
// Exits non-zero on any failure.
//
// These exist because the clinical criterion used to be purely monotonic: a target whose
// Phase 3 was halted for toxicity scored exactly the same as one still running, and ten
// failed Phase 3s scored maximum. That is a wrong answer from a prioritisation tool, so
// the behaviour is pinned here rather than left to be re-broken.
import { clinicalDiscount } from './rankingBoard.ts';
import { clinicalAttrition } from './boardRows.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + detail}`);
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── attrition classification ──
const t = (o: any) => ({ id: 'NCT1', phase: 3, status: 'COMPLETED', why_stopped: null, stop_reasons: [], ...o });

const none = clinicalAttrition({ trials: [t({}), t({})] });
check('a running/completed programme has no attrition', none.n_stopped_trials === 0 && none.n_stopped_against === 0);

const success = clinicalAttrition({ trials: [t({ status: 'TERMINATED', why_stopped: 'Endpoint met early', stop_reasons: ['Endpoint_Met'] })] });
check('a trial stopped because it WORKED is not attrition', success.n_stopped_trials === 0, JSON.stringify(success));

const tox = clinicalAttrition({ trials: [t({ status: 'TERMINATED', why_stopped: 'unacceptable toxicity', stop_reasons: ['Safety_Sideeffects'] }), t({})] });
check('a toxicity stop counts against the target', tox.n_stopped_trials === 1 && tox.n_stopped_against === 1);
check('and the stopped fraction is recorded', near(tox.stopped_fraction as number, 0.5));

const biz = clinicalAttrition({ trials: [t({ status: 'WITHDRAWN', why_stopped: 'sponsor decision', stop_reasons: ['Business_Administrative'] })] });
check('a business stop is attrition but NOT against the target', biz.n_stopped_trials === 1 && biz.n_stopped_against === 0);

const noneHarvested = clinicalAttrition(null);
check('an unharvested snapshot yields nulls, not zeros', noneHarvested.n_stopped_trials === null);

// ── the discount ──
check('no data means no opinion (old snapshots unaffected)', clinicalDiscount({}) === 1);
check('nothing stopped means no discount', clinicalDiscount({ n_stopped_against: 0, stopped_fraction: 0 }) === 1);
check('one safety failure discounts 20%', near(clinicalDiscount({ n_stopped_against: 1, stopped_fraction: 0 }), 0.8));
check('three safety failures discount 60%', near(clinicalDiscount({ n_stopped_against: 3, stopped_fraction: 0 }), 0.4));
check('more than three does not keep falling (floor holds)', clinicalDiscount({ n_stopped_against: 9, stopped_fraction: 0 }) >= 0.25);
check('broad attrition alone discounts more gently', near(clinicalDiscount({ n_stopped_against: 0, stopped_fraction: 1 }), 0.7));
check('the discount never goes below 0.25', clinicalDiscount({ n_stopped_against: 9, stopped_fraction: 1 }) >= 0.25);

// ── the behaviour that motivated all of this ──
const runningPhase3 = clinicalDiscount({ n_stopped_against: 0, stopped_fraction: 0 });
const haltedPhase3 = clinicalDiscount({ n_stopped_against: 2, stopped_fraction: 1 });
check('a halted-for-toxicity programme now scores BELOW a running one',
  haltedPhase3 < runningPhase3, `halted=${haltedPhase3} running=${runningPhase3}`);
console.log(`      running x${runningPhase3.toFixed(2)} vs halted-for-toxicity x${haltedPhase3.toFixed(2)}`);


// ── drug selectivity ────────────────────────────────────────────────────────
// Tractability read 1.0 whenever ANY linked drug had reached approval, so a promiscuous
// compound could certify a target it was never developed for. PDE10A scored 100 on
// dipyridamole and pentoxifylline, which inhibit several phosphodiesterases each.
import { tractabilityDiscount } from './rankingBoard.ts';
import { drugBreadth } from './boardRows.ts';

const ev = (gene: string, drugs: any[]) => ({ gene_symbol: gene, evidence_type: 'druggability', value_json: JSON.stringify({ drugs }) });
const D = (name: string, approved = true) => ({ name, approved, modality: 'SM', family: null, stage: 'Approved' });

// dipyridamole spans five targets here; sotorasib spans one.
const snapshot = [
  ev('PDE10A', [D('Dipyridamole'), D('Pentoxifylline')]),
  ev('PDE3A', [D('Dipyridamole'), D('Pentoxifylline')]),
  ev('PDE5A', [D('Dipyridamole')]),
  ev('PDE4B', [D('Pentoxifylline')]),
  ev('ADORA2A', [D('Dipyridamole')]),
  ev('SLC29A1', [D('Dipyridamole')]),
  ev('KRAS', [D('Sotorasib')]),
];
const breadth = drugBreadth(snapshot as any);
check('a promiscuous drug is seen across many targets', breadth.get('DIPYRIDAMOLE') === 5, `got ${breadth.get('DIPYRIDAMOLE')}`);
check('a selective drug is seen on one', breadth.get('SOTORASIB') === 1);

check('a target whose only approved drugs are promiscuous is discounted',
  near(tractabilityDiscount({ n_drugs_promiscuous: 2, n_drugs_selective: 0, has_selective_approved: false }), 0.55));
check('a target with a selective approved drug is NOT discounted',
  tractabilityDiscount({ n_drugs_promiscuous: 2, n_drugs_selective: 1, has_selective_approved: true }) === 1);
check('selective but unapproved drugs are discounted only mildly',
  near(tractabilityDiscount({ n_drugs_promiscuous: 1, n_drugs_selective: 2, has_selective_approved: false }), 0.8));
check('no promiscuous drugs means no discount',
  tractabilityDiscount({ n_drugs_promiscuous: 0, n_drugs_selective: 3, has_selective_approved: true }) === 1);
check('a legacy snapshot without selectivity data is untouched', tractabilityDiscount({}) === 1);

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
