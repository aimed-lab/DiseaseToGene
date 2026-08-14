// modalityBenchmark.ts ────────────────────────────────────────────────────────
// #6 — validation harness for the deterministic Modality-Fit tiers, against the
// control set from the methodology review. Because the tiers are rule-based (no
// LLM), this is fully reproducible and needs no API key beyond the public sources.
//
// Run:  npx tsx --env-file=.env scripts/modalityBenchmark.ts
// Writes: deliverables/modality_benchmark_results.md
//
// It checks two things the reviewer emphasised:
//   • POSITIVE controls — the clinically-precedented modality is ≥ Plausible.
//   • NEGATIVE / gate controls — a modality that MUST fail returns Blocked (or,
//     for accessibility, not Plausible).

import * as fs from 'fs';
import * as path from 'path';
import { gatherModalityEvidence, assessModalities, TIER_RANK, type Tier, type MechanisticGoal } from '../modalityFitService.js';

interface Control {
  gene: string;
  goal: MechanisticGoal;
  note: string;
  plausible?: string[];   // these modalities should be Plausible or Precedented
  blocked?: string[];     // these modalities should be Blocked
  notPlausible?: string[];// these should NOT be Plausible/Precedented (Speculative/Blocked ok)
}

// Ground truth from Open Targets / ChEMBL clinical precedent + hard biology (the review's list).
const CONTROLS: Control[] = [
  { gene: 'EGFR',  goal: 'inhibit',         note: 'SM + surface mAb both clinical',        plausible: ['Conventional small molecule', 'Antibody'] },
  { gene: 'PCSK9', goal: 'inhibit',         note: 'secreted: mAb + siRNA; PROTAC must fail', plausible: ['Antibody', 'RNA knockdown'], blocked: ['PROTAC'] },
  { gene: 'BCL2',  goal: 'inhibit',         note: 'PPI-groove SM (venetoclax)',            plausible: ['Conventional small molecule', 'Interaction-disrupting'] },
  { gene: 'MS4A1', goal: 'inhibit',         note: 'CD20 — surface mAb',                    plausible: ['Antibody'] },
  { gene: 'ERBB2', goal: 'inhibit',         note: 'HER2 — surface mAb + SM',               plausible: ['Antibody', 'Conventional small molecule'] },
  { gene: 'AR',    goal: 'degrade',         note: 'AR degrader clinical (ARV-110)',        plausible: ['PROTAC'] },
  { gene: 'KRAS',  goal: 'inhibit',         note: 'intracellular — naked antibody must not pass', notPlausible: ['Antibody'] },
  { gene: 'PHGDH', goal: 'spare_catalytic', note: 'spare-catalytic blocks removal',        blocked: ['RNA knockdown', 'PROTAC', 'Expression / genetic'] },
  { gene: 'JUN',   goal: 'inhibit',         note: 'single-exon — splice-switching ruled out', blocked: ['Splice-switching'] },
];

const tierOf = (rows: { modality: string; tier: Tier }[], sub: string): Tier | null =>
  rows.find(r => r.modality.includes(sub))?.tier ?? null;

(async () => {
  console.log(`Running modality benchmark on ${CONTROLS.length} controls…\n`);
  const lines: string[] = [];
  let checks = 0, passed = 0;
  const detail: string[] = [];

  for (const c of CONTROLS) {
    const ev = await gatherModalityEvidence(c.gene);
    const rows = assessModalities(ev, c.goal);
    const results: string[] = [];
    const check = (label: string, ok: boolean, got: string) => {
      checks++; if (ok) passed++;
      results.push(`${ok ? '✓' : '✗'} ${label} (${got})`);
    };
    for (const m of c.plausible ?? []) { const t = tierOf(rows, m); check(`${m} ≥ Plausible`, t != null && TIER_RANK[t] >= TIER_RANK['Plausible'], t ?? 'missing'); }
    for (const m of c.blocked ?? []) { const t = tierOf(rows, m); check(`${m} = Blocked`, t === 'Blocked', t ?? 'missing'); }
    for (const m of c.notPlausible ?? []) { const t = tierOf(rows, m); check(`${m} not Plausible`, t != null && TIER_RANK[t] < TIER_RANK['Plausible'], t ?? 'missing'); }

    const allOk = results.every(r => r.startsWith('✓'));
    console.log(`${allOk ? 'PASS' : 'FAIL'}  ${c.gene.padEnd(6)} [${c.goal}] — ${c.note}`);
    for (const r of results) console.log(`        ${r}`);
    lines.push(`| ${c.gene} | ${c.goal} | ${c.note} | ${results.map(r => r.replace(/\s*\(.*\)$/, '')).join('<br>')} | ${allOk ? '✅' : '❌'} |`);
    detail.push(`### ${c.gene} (${c.goal}) — access=${ev.surfaceAccess}, ${ev.pocket.totalPockets} pockets, ChEMBL=${ev.chemblActivities}, STRING=${ev.ppiPartners}, exons=${ev.exonCount}\n` +
      rows.map(r => `- **${r.tier}** ${r.modality}${r.gate ? ` — ⚠ ${r.gate}` : ''}`).join('\n'));
  }

  const pct = ((passed / checks) * 100).toFixed(0);
  console.log(`\n==== ${passed}/${checks} checks passed (${pct}%) ====`);

  const md = [
    `# Modality Fit — benchmark results`,
    ``,
    `Deterministic tiers vs the methodology-review control set. **${passed}/${checks} checks passed (${pct}%).**`,
    `Because tiers are rule-based, this run is reproducible (no LLM, no run-to-run variance).`,
    ``,
    `| Target | Goal | Precedent / rule | Checks | Pass |`,
    `|---|---|---|---|---|`,
    ...lines,
    ``,
    `## Per-target detail`,
    ``,
    ...detail,
    ``,
    `## Still to add (full benchmark, per review)`,
    `- recall@k / MRR over a larger clinically-precedented ground-truth set (Open Targets + ChEMBL max-phase).`,
    `- baselines to beat: base-rate "always small molecule" and a logistic regression on the deterministic features.`,
    `- calibration (does Precedented/Plausible track real clinical success) + popularity-bias probe.`,
  ].join('\n');

  const out = path.join('deliverables', 'modality_benchmark_results.md');
  fs.mkdirSync('deliverables', { recursive: true });
  fs.writeFileSync(out, md);
  console.log(`\nWrote ${out}`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
