// scripts/figure1Data.ts ─────────────────────────────────────────────────────
// Data for Figure 1 — the claim of the paper in one panel.
//
//   npx tsx --env-file=.env scripts/figure1Data.ts
//   → deliverables/figure1_goal_conditioning.json
//
// Figure 1 shows that the SAME target and the SAME evidence give a different
// modality verdict when the mechanistic goal changes. SMN2 and DMD are the cases:
// nusinersen raises full-length SMN and eteplirsen restores a dystrophin reading
// frame, so both are gain-of-function. Under an inhibit premise the modality each
// drug belongs to is not merely disfavoured but incoherent — one cannot raise
// functional protein by degrading its transcript.
//
// The benchmark evaluates each assignment only under the goal its drug pursues, so
// the inhibit-premise tiers that make the contrast are not in any result file. This
// script produces them. Nothing here is a new measurement of performance; it is the
// same engine asked the same question twice with one variable changed.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gatherModalityEvidence, assessModalities, type MechanisticGoal } from '../modalityFitService.js';
import type { Tier } from '../modalityConstants.js';

// The modalities the contrast turns on: the one each drug actually is, and the
// removal modalities that a gain-of-function goal must rule out.
const SHOW = ['Splice-switching', 'RNA knockdown', 'PROTAC', 'Expression / genetic'];
const CASES: { gene: string; drug: string; trueModality: string }[] = [
  { gene: 'SMN2', drug: 'nusinersen', trueModality: 'Splice-switching' },
  { gene: 'DMD', drug: 'eteplirsen', trueModality: 'Splice-switching' },
];
const GOALS: MechanisticGoal[] = ['inhibit', 'restore_function'];

const run = async () => {
  const out: any[] = [];
  for (const c of CASES) {
    process.stdout.write(`gathering ${c.gene}… `);
    const ev = await gatherModalityEvidence(c.gene);
    const row: any = { gene: c.gene, drug: c.drug, trueModality: c.trueModality, byGoal: {} };
    for (const goal of GOALS) {
      const rows: { modality: string; tier: Tier; gate: string | null }[] = assessModalities(ev, goal) as any;
      row.byGoal[goal] = SHOW.map(sub => {
        const hit = rows.find(r => r.modality.includes(sub));
        return { modality: sub, tier: hit?.tier ?? null, gate: hit?.gate ?? null };
      });
    }
    out.push(row);
    console.log('done');
  }

  const dest = path.join(process.cwd(), 'deliverables', 'figure1_goal_conditioning.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify({
    note: 'Figure 1 source. Same target, same evidence, goal varied. Tiers from assessModalities().',
    cases: out,
  }, null, 2));

  console.log('');
  for (const r of out) {
    console.log(`── ${r.gene} (${r.drug}, truly ${r.trueModality}) ──`);
    for (const sub of SHOW) {
      const i = r.byGoal['inhibit'].find((x: any) => x.modality === sub);
      const f = r.byGoal['restore_function'].find((x: any) => x.modality === sub);
      console.log(`   ${sub.padEnd(22)} inhibit=${String(i?.tier).padEnd(12)} restore_function=${String(f?.tier)}`);
    }
    console.log('');
  }
  console.log(`Wrote ${dest}`);
};

run().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
