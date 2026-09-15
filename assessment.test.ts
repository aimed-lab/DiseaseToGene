// assessment.test.ts ────────────────────────────────────────────────────────
// Checks for the Target Assessment's pure layer. No test framework — run with:
//   npx tsx assessment.test.ts
// Exits non-zero on any failure.
//
// Pinned here: the assessment must agree with the Ranking Board (same rows → same rank
// and criterion scores), must never score a symbol the snapshot does not hold, and must
// compute "who leads on what" honestly (ties are not leads, Blocked is not a lead).
import { assessTargets, withModality, criterionLeaders, modalityLeaders, narrativeContext, headline, type ModalityFitRow } from './assessment.ts';
import { buildBoard } from './rankingBoard.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + detail}`);
}

// Three synthetic board rows. Fields are the /api/dashboard/genes row shape.
const row = (gene_symbol: string, o: any) => ({
  gene_symbol, genetic_score: 0.2, mutation_freq: 0.1, expr_log2fc: 1, prot_log2fc: 0.3, chronos: -0.5, frac_dependent: 0.3,
  druggability_score: 0.5, tractable_modalities: 1, n_drugs: 1, n_drugs_selective: 1, n_drugs_promiscuous: 0, has_selective_approved: false,
  loeuf: 1, is_common_essential: false, n_safety_liabilities: 0, n_disease_trials: 1, max_disease_phase: 1, trials_by_phase: { phase1: 1, phase2: 0, phase3: 0, phase4: 0 },
  n_stopped_trials: 0, n_stopped_against: 0, stopped_fraction: 0, n_publications: 100, lit_recent_count: 20, velocity: 0.2, winner_pct: 0.5, winner_score: 0.5, tractability: [],
  ...o,
});
const rows = [
  row('AAA', { genetic_score: 0.9, mutation_freq: 0.6, chronos: -2 }),                  // the leader
  row('BBB', { druggability_score: 1, n_drugs: 5, n_drugs_selective: 5, has_selective_approved: true }),
  row('CCC', { n_publications: 10000, lit_recent_count: 4000, chronos: null, frac_dependent: null }),
];

const a = assessTargets(rows, ['bbb', 'AAA', 'ZZZ', 'AAA'], { snapshotId: 1, disease: 'testitis' });
check('symbols are upper-cased and de-duplicated, order kept', a.targets.map(t => t.symbol).join(',') === 'BBB,AAA,ZZZ');
check('a symbol not in the snapshot is reported, not scored', a.targets[2].found === false && a.targets[2].scored === null && a.targets[2].verdict === null);
check('the not-found headline says so', headline(a.targets[2], a.total).includes('not in this snapshot'));

const board = buildBoard(rows, 'small_molecule');
const bAAA = board.scored.find(s => s.symbol === 'AAA')!;
const tAAA = a.targets.find(t => t.symbol === 'AAA')!;
check('assessment rank equals the board rank', tAAA.scored!.boardRank === bAAA.boardRank && tAAA.verdict!.rank === bAAA.boardRank);
check('assessment criterion scores equal the board criterion scores',
  a.activeCriteria.every(k => tAAA.scored!.criteria[k] === bAAA.criteria[k]), JSON.stringify(tAAA.scored!.criteria));
check('rel is 1 for the field leader on genetics', tAAA.rel.genetics === 1, String(tAAA.rel.genetics));
check('a breakdown exists for every active criterion', a.activeCriteria.every(k => (tAAA.breakdown[k]?.metrics.length ?? 0) > 0));
check('total is the whole board, not the picked set', a.total === 3);

check('genetics leader among the picked targets is AAA', a.leaders.genetics === 'AAA');
check('tractability leader is BBB', a.leaders.tractability === 'BBB', String(a.leaders.tractability));
const tie = criterionLeaders([a.targets[0], a.targets[0]], ['safety']);
check('a tie is not a lead', tie.safety === null);

// modality
const fit: ModalityFitRow[] = [
  { gene: 'AAA', resolved: true, best: { modality: 'Kinase inhibitor', category: 'Small molecule', tier: 'Precedented' }, byCategory: { 'Small molecule': 'Precedented', 'Biologic': 'Blocked', 'RNA/genetic': 'Plausible' }, counts: { Precedented: 1, Plausible: 1, Speculative: 0, Blocked: 1 }, blocked: ['Antibody'] },
  { gene: 'BBB', resolved: true, best: { modality: 'siRNA', category: 'RNA/genetic', tier: 'Plausible' }, byCategory: { 'Small molecule': 'Speculative', 'Biologic': 'Blocked', 'RNA/genetic': 'Plausible' }, counts: { Precedented: 0, Plausible: 1, Speculative: 1, Blocked: 1 }, blocked: ['Antibody'] },
];
const m = withModality(a, fit);
check('modality rows attach by symbol', m.targets[0].modality?.gene === 'BBB' && m.targets[1].modality?.gene === 'AAA');
check('not-found target gets no modality row', m.targets[2].modality === null);
check('small-molecule leader is AAA (Precedented beats Speculative)', (m.modalityLeaders['Small molecule'] || []).join() === 'AAA', JSON.stringify(m.modalityLeaders));
check('a category every target shares is nobody\'s lead', (m.modalityLeaders['RNA/genetic'] || []).length === 0, JSON.stringify(m.modalityLeaders));
check('Blocked is never a lead', (m.modalityLeaders['Biologic'] || []).length === 0);
check('modalityLeaders on an empty set is safe', Object.values(modalityLeaders([])).every(v => v.length === 0));

// narrative context: numbers only, no invented facts
const ctx = narrativeContext(m, 'inhibit');
check('context names the snapshot and disease', ctx.includes('snapshot #1') && ctx.includes('testitis'));
check('context carries the not-found instruction', ctx.includes('ZZZ') && ctx.includes('Do not score it'));
check('context lists modality tiers per category', ctx.includes('Small molecule: Precedented'));
check('context names the criterion leaders', ctx.includes('Genetics → AAA'));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
