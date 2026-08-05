/* benchmark/run.ts ──────────────────────────────────────────────────────────────
 * End-to-end runner for the funnel target-recovery benchmark. Loads a stored snapshot,
 * builds the gold "answer key" (known drug targets, from Open Targets), grades the REAL
 * funnel engine, and prints a report: the grade, which axes matter, an honest k-fold
 * number, and a shuffle sanity-check.
 *
 * TWO WAYS TO GET THE SNAPSHOT DATA:
 *   A) Oracle (needs UAB VPN + .env creds) — pass the snapshot id:
 *        npx tsx --env-file=.env benchmark/run.ts 84
 *   B) Offline (NO VPN) — first export the snapshot on VPN, then run anywhere:
 *        npx tsx --env-file=.env benchmark/run.ts export 84 snapshot84.json   # on VPN
 *        npx tsx benchmark/run.ts --file snapshot84.json                      # anywhere
 *
 * OPTIONS:
 *   --efo EFO_0002618        force the disease id for the gold set (else uses the snapshot's)
 *   --disease "pancreatic…"  resolve the gold-set disease by name instead
 *   --gold known.txt         use a curated gold list (one symbol/line) instead of Open Targets
 *   --permissive             score every gene (nexus off, like the app's default view)
 *   --no-cv                  skip the (slow) k-fold cross-validated re-fit
 *   --no-bootstrap           skip the AUC confidence interval
 *   --out report.json        also write the machine-readable results
 *
 * The gold standard is "has a known drug for this disease". Because that overlaps the
 * funnel's ChEMBL tractability axis, the headline number HOLDS TRACTABILITY OUT; the
 * with-tractability value is printed only as a leaky upper bound. See benchmark/README.
 * -------------------------------------------------------------------------------- */

import * as fs from 'node:fs';
import { WEIGHTS, DEFAULT_ELIGIBILITY, type ScoreWeights, type EligibilityConfig } from '../funnelEngine.ts';
import { evaluate, ablation, crossValidatedFit, negativeControl, AXES, type AxisKey } from './benchmark.ts';
import { buildUniverse, axisCoverage, type ScoreRow, type EvidenceRow } from './adapter.ts';
import { buildBoardRows } from './boardAdapter.ts';
import { evaluateBoard } from './board.ts';
import { fetchKnownDrugTargets, resolveDiseaseId, loadGoldFromFile } from './goldset.ts';
import { formatReport } from './report.ts';

// ── tiny arg parser ──
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const positionals = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--permissive', '--no-cv', '--no-bootstrap'].includes(argv[i - 1])));

const oracle = () => import('../oracleService.ts');

interface SnapshotData {
  meta: { id?: number | string; disease_id?: string; disease_name?: string; gene_count?: number };
  scores: ScoreRow[];
  evidence: EvidenceRow[];
}

async function loadFromOracle(id: number): Promise<SnapshotData> {
  const o = await oracle();
  if (!o.oracleEnabled?.()) {
    // oracleEnabled reads env; if creds are absent we fail loudly (rather than a confusing pool error)
    console.error('Oracle is not configured (need ORACLE_USER/PASSWORD/CONNECT_STRING in .env, on UAB VPN).');
    console.error('Off-VPN? Export on VPN then run with --file:  benchmark/run.ts export ' + id + ' snap.json');
    process.exit(2);
  }
  const [meta, scores, evidence] = await Promise.all([
    o.getSnapshot(id), o.listRankingScores(id), o.snapshotEvidence(id),
  ]);
  if (!meta) { console.error(`Snapshot #${id} not found in Oracle.`); process.exit(2); }
  await o.closeOraclePool?.();
  return { meta: { id, ...meta }, scores: scores as ScoreRow[], evidence: evidence as EvidenceRow[] };
}

function loadFromFile(path: string): SnapshotData {
  const j = JSON.parse(fs.readFileSync(path, 'utf-8'));
  if (!Array.isArray(j.scores) || !Array.isArray(j.evidence)) {
    throw new Error(`${path} is not a snapshot export (expected { meta, scores[], evidence[] })`);
  }
  return { meta: j.meta ?? {}, scores: j.scores, evidence: j.evidence };
}

// ── subcommand: export ── dump a snapshot to JSON so it can be graded off-VPN.
async function cmdExport(id: number, outPath: string) {
  const data = await loadFromOracle(id);
  fs.writeFileSync(outPath, JSON.stringify(data));
  console.log(`Exported snapshot #${id} → ${outPath}  (${data.scores.length} scores, ${data.evidence.length} evidence rows)`);
}

// ── subcommand: run (default) ──
async function cmdRun(source: SnapshotData) {
  const { meta, scores, evidence } = source;
  console.log(`Loaded snapshot #${meta.id ?? '?'} — ${scores.length} score rows, ${evidence.length} evidence rows.`);

  // 1) GOLD SET — curated file, or live from Open Targets by disease id/name.
  let goldSymbols: Set<string>;
  let goldName: string;
  let knownDrugRows: number | undefined;
  const goldFile = opt('--gold');
  if (goldFile) {
    goldSymbols = loadGoldFromFile(goldFile);
    goldName = `file: ${goldFile}`;
    console.log(`Gold set: ${goldSymbols.size} symbols from ${goldFile}`);
  } else {
    const diseaseArg = opt('--efo') || opt('--disease') || meta.disease_id || meta.disease_name;
    if (!diseaseArg) { console.error('No disease to build the gold set — pass --efo, --disease, or --gold.'); process.exit(2); }
    console.log(`Resolving disease "${diseaseArg}" on Open Targets…`);
    const { id, name } = await resolveDiseaseId(String(diseaseArg));
    console.log(`  → ${id}  ${name}. Fetching known drug targets…`);
    const kd = await fetchKnownDrugTargets(id);
    goldSymbols = kd.symbols; goldName = name; knownDrugRows = kd.knownDrugRows;
    console.log(`Gold set: ${goldSymbols.size} known drug targets (${kd.knownDrugRows} known-drug rows).`);
  }
  if (goldSymbols.size === 0) { console.error('Gold set is empty — cannot grade. Check the disease id or provide --gold.'); process.exit(2); }

  // ── BOARD MODE (--board): grade rankingBoard.buildBoard per modality, same gold set + metrics.
  if (flag('--board')) {
    const rows = buildBoardRows(scores, evidence);
    const goldInRows = rows.reduce((a, r) => a + (goldSymbols.has(String(r.gene_symbol).toUpperCase()) ? 1 : 0), 0);
    const res = evaluateBoard(rows, goldSymbols, { leaky: true });
    console.log(`\n═══ TARGET RANKING BOARD — target-recovery grade ═══`);
    console.log(`Disease: ${goldName} · gold set ${goldSymbols.size} (${goldInRows} present in ${rows.length} genes)`);
    console.log(`Headline holds out: ${res.holdout.join(', ')} (leakage guard — tractability ≈ the "known drug" label)\n`);
    console.log(`  modality          ROC-AUC   AvgPrec   EF@5%   EF@1%`);
    for (const r of res.rows) console.log(`  ${r.modality.padEnd(16)}  ${r.auc.toFixed(3)}     ${r.ap.toFixed(3)}     ${r.ef5.toFixed(2)}    ${r.ef1.toFixed(2)}`);
    if (res.leaky) { console.log(`\n  (leaky upper bound, tractability IN — do NOT quote as the grade)`); for (const r of res.leaky) console.log(`  ${r.modality.padEnd(16)}  ${r.auc.toFixed(3)}     ${r.ap.toFixed(3)}     ${r.ef5.toFixed(2)}    ${r.ef1.toFixed(2)}`); }
    console.log(`\n  0.5 = random · higher = the Board concentrates known targets near the top.`);
    const outPath = opt('--out');
    if (outPath) { fs.writeFileSync(outPath, JSON.stringify({ meta, goldName, goldSize: goldSymbols.size, goldInRows, board: res }, null, 2)); console.log(`\nWrote → ${outPath}`); }
    return;
  }

  // 2) UNIVERSE — real engine input, reproducing the app's read contract.
  const u = buildUniverse(scores, evidence, goldSymbols);
  const coverage = axisCoverage(u.genes);

  // 3) CONFIG — designed eligibility by default; --permissive matches the app's default view.
  const cfg: EligibilityConfig = flag('--permissive')
    ? { nexus: false, otMin: 0, mutMin: 0, depMax: 1, tractability: false }
    : DEFAULT_ELIGIBILITY;

  // 4) HEADLINE (leakage-safe): hold `tractability` out (weight 0). Add more via --holdout a,b.
  const holdout = (opt('--holdout')?.split(',').map(s => s.trim()).filter(Boolean) as AxisKey[]) ?? (['tractability'] as AxisKey[]);
  const headlineWeights: ScoreWeights = { ...WEIGHTS };
  for (const h of holdout) if (h in headlineWeights) headlineWeights[h] = 0;

  const bootstrap = !flag('--no-bootstrap');
  const headline = evaluate(u, cfg, headlineWeights, { bootstrap });
  const leaky = holdout.includes('tractability') ? evaluate(u, cfg, WEIGHTS, { bootstrap: false }) : undefined;
  const abl = ablation(u, cfg, headlineWeights);
  const cv = flag('--no-cv') ? undefined : crossValidatedFit(u, { cfg, holdout });
  const neg = negativeControl(u, cfg);

  const report = formatReport({
    meta, goldName, goldSize: goldSymbols.size, knownDrugRows, coverage,
    headline, leaky, ablation: abl, cv, negControl: neg,
    weightsUsed: headlineWeights, holdout,
  });
  console.log('\n' + report);

  const outPath = opt('--out');
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify({ meta, goldName, goldSize: goldSymbols.size, headline, leaky, ablation: abl, cv, negControl: neg, coverage, holdout }, null, 2));
    console.log(`\nWrote machine-readable results → ${outPath}`);
  }
}

async function main() {
  const cmd = positionals[0];

  if (cmd === 'export') {
    const id = Number(positionals[1]);
    const out = positionals[2];
    if (!Number.isFinite(id) || !out) { console.error('usage: run.ts export <snapshotId> <out.json>'); process.exit(1); }
    await cmdExport(id, out);
    return;
  }

  // run mode: --file (offline) or a snapshot id (Oracle)
  const file = opt('--file');
  let source: SnapshotData;
  if (file) {
    source = loadFromFile(file);
  } else {
    const id = Number(cmd);
    if (!Number.isFinite(id)) {
      console.error('usage: run.ts <snapshotId> [options]   OR   run.ts --file <export.json> [options]');
      console.error('       run.ts export <snapshotId> <out.json>   (dump for offline grading)');
      process.exit(1);
    }
    source = await loadFromOracle(id);
  }
  await cmdRun(source);
}

main().catch(e => { console.error('benchmark failed:', e?.message || e); process.exit(1); });
