// benchmark/report.ts ─────────────────────────────────────────────────────────
// Render the benchmark outputs as a plain-text console report (and a machine-readable
// object for --out). No scoring here — only formatting of what benchmark.ts computed.

import type { EvalResult, AblationRow, CVResult, AxisKey } from './benchmark.ts';
import type { ScoreWeights } from '../funnelEngine.ts';

const pct = (x: number) => (isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a');
const f3 = (x: number) => (isFinite(x) ? x.toFixed(3) : 'n/a');
const f2 = (x: number) => (isFinite(x) ? x.toFixed(2) : 'n/a');
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

// A one-word verdict from ROC-AUC so a non-specialist can read the grade at a glance.
function grade(auc: number): string {
  if (!isFinite(auc)) return 'n/a';
  if (auc >= 0.80) return 'STRONG';
  if (auc >= 0.70) return 'good';
  if (auc >= 0.60) return 'modest';
  if (auc >= 0.55) return 'weak';
  return 'no better than chance';
}

export interface ReportInput {
  meta: { id?: number | string; disease_id?: string; disease_name?: string; gene_count?: number };
  goldName: string;
  goldSize: number;            // gold symbols returned by OT
  knownDrugRows?: number;
  coverage: Record<string, { present: number; pct: number }>;
  headline: EvalResult;        // tractability HELD OUT (honest)
  leaky?: EvalResult;          // tractability included (upper bound) — optional
  ablation: { baseline: { auc: number; ap: number; ef5: number }; rows: AblationRow[] };
  cv?: CVResult;
  negControl?: { meanAuc: number; sd: number };
  weightsUsed: ScoreWeights;
  holdout: AxisKey[];
}

export function formatReport(r: ReportInput): string {
  const L: string[] = [];
  const H = (s: string) => L.push('', `── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);
  const b = r.headline.bundle;

  L.push('═'.repeat(66));
  L.push('  FUNNEL TARGET-RECOVERY BENCHMARK');
  L.push('═'.repeat(66));
  L.push(`  Snapshot   : #${r.meta.id ?? '?'}  ${r.meta.disease_name ?? ''}`);
  L.push(`  Universe   : ${b.n.toLocaleString()} genes`);
  L.push(`  Gold set   : ${r.goldSize} known drug targets (${r.goldName})` +
    (r.knownDrugRows ? ` · from ${r.knownDrugRows} OT known-drug rows` : ''));
  L.push(`  Gold found : ${r.headline.goldInUniverse} present in universe · ${r.headline.goldEligible} scored`);

  H('HEADLINE GRADE  (leakage-safe: ' + (r.holdout.length ? r.holdout.join(', ') + ' held out' : 'no hold-out') + ')');
  L.push(`  ROC-AUC          ${f3(b.rocAuc)}   → ${grade(b.rocAuc)}`);
  if (isFinite(r.headline.aucCI.lo)) L.push(`    95% CI         [${f3(r.headline.aucCI.lo)}, ${f3(r.headline.aucCI.hi)}]  (${r.headline.aucCI.iters} boot)`);
  L.push(`  Avg precision    ${f3(b.averagePrecision)}   (base rate ${pct(b.baseRate)})`);
  L.push(`  BEDROC (α=20)    ${f3(b.bedroc)}`);
  L.push(`  Enrichment       top 1%: ${f2(b.ef['1%'])}×   top 5%: ${f2(b.ef['5%'])}×   top 10%: ${f2(b.ef['10%'])}×`);
  L.push(`  Known found in   top10: ${b.hits.top10.hits}   top20: ${b.hits.top20.hits}   top50: ${b.hits.top50.hits}   top100: ${b.hits.top100.hits}`);

  H('WHICH EVIDENCE MATTERS  (ablation: drop one axis, re-rank)');
  L.push(`  baseline ROC-AUC ${f3(r.ablation.baseline.auc)}`);
  L.push(`  ${pad('axis', 14)}${pad('ΔAUC', 10)}${pad('AUC', 9)}${pad('AP', 9)}EF@5%`);
  for (const row of r.ablation.rows) {
    const sign = row.deltaAuc <= 0 ? '' : '+';
    L.push(`  ${pad(row.axis, 14)}${pad(sign + f3(row.deltaAuc), 10)}${pad(f3(row.auc), 9)}${pad(f3(row.ap), 9)}${f2(row.ef5)}×`);
  }
  L.push(`  (most-negative ΔAUC = most important axis; ~0 = the axis earns nothing)`);

  if (r.cv) {
    H('HONEST GENERALIZATION  (k-fold cross-validated re-fit)');
    L.push(`  ${r.cv.k}-fold mean test ${r.cv.objective}: ${f3(r.cv.meanTest)} ± ${f3(r.cv.sdTest)}`);
    L.push(`  fitted mean weights:`);
    const mw = r.cv.meanWeights as Record<string, number>;
    L.push('    ' + Object.keys(mw).map(k => `${k} ${f2(mw[k])}`).join('   '));
  }

  if (r.negControl) {
    H('SANITY CHECK  (shuffle labels → must collapse to ~0.5)');
    const ok = Math.abs(r.negControl.meanAuc - 0.5) < 0.05;
    L.push(`  shuffled ROC-AUC ${f3(r.negControl.meanAuc)} ± ${f3(r.negControl.sd)}   ${ok ? '✓ PASS' : '✗ SUSPECT'}`);
  }

  if (r.leaky) {
    H('LEAKY UPPER BOUND  (tractability INCLUDED — do NOT quote as the result)');
    L.push(`  ROC-AUC ${f3(r.leaky.bundle.rocAuc)}  (vs headline ${f3(b.rocAuc)}) — the gap is roughly how much "already has a drug" inflates the score`);
  }

  H('COVERAGE  (present axes over the universe)');
  for (const [k, v] of Object.entries(r.coverage)) {
    L.push(`  ${pad(k, 14)}${pad(v.present.toLocaleString(), 10)}${pct(v.pct)}`);
  }

  L.push('', '═'.repeat(66));
  return L.join('\n');
}
