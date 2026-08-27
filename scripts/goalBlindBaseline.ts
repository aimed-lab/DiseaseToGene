// scripts/goalBlindBaseline.ts ───────────────────────────────────────────────
// Head-to-head baseline: can a GOAL-BLIND tractability resource recover the
// developed modality on the same 400-assignment gold set the rules are scored on?
//
// The manuscript asserts that existing resources report an assessment as a function
// of (target, modality) and that none takes the therapeutic goal as an input. That
// assertion was previously unmeasured. This script measures it against Open Targets
// tractability — the most widely used such resource, and one this project already
// consumes — on exactly the assignments used to score the rules.
//
// Two variants are computed, because the fair comparison is the ablated one:
//
//   FULL          every tractability bucket, including "Approved Drug",
//                 "Advanced Clinical" and "Phase 1 Clinical".  Comparable to L0.
//   CLINICAL-FREE the same buckets with those three clinical-precedence labels
//                 removed.  Comparable to L2, which is where the manuscript's
//                 defensible claim lives.
//
// Every raw API response is written to deliverables/ot_tractability_snapshot.json
// so the run is reproducible byte-for-byte without re-querying Open Targets.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const OT = 'https://api.platform.opentargets.org/api/v4/graphql';
const UA = 'Disease2Target/1.0 (academic research; contact via repository)';
const SNAPSHOT = 'deliverables/ot_tractability_snapshot.json';

// The three labels that encode clinical precedence. Open Targets applies these
// identically across every modality family, so removing them is the same operation
// the L2 ablation performs inside the rule engine.
const CLINICAL_LABELS = new Set(['Approved Drug', 'Advanced Clinical', 'Phase 1 Clinical']);

// Gold-set modality code -> Open Targets tractability modality family.
//   SM  small molecule      AB  antibody
//   PR  PROTAC / degrader   OC  "other clinical" — the only family that can carry
//                               an oligonucleotide, and it holds ONLY clinical buckets.
// Mapping RNA and Splice to OC is the generous reading; the strict reading is that
// Open Targets has no oligonucleotide family at all. Both are reported.
const MODALITY_TO_OT: Record<string, string | null> = {
  SM: 'SM', Antibody: 'AB', RNA: 'OC', Splice: 'OC',
};

interface Pair { gene: string; modality: string; goal: string; drug: string }
interface Bucket { modality: string; label: string; value: boolean }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function gql(query: string, attempt = 0): Promise<any> {
  try {
    const r = await fetch(OT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
    return j.data;
  } catch (e) {
    if (attempt >= 4) throw e;
    await sleep(1000 * 2 ** attempt);
    return gql(query, attempt + 1);
  }
}

const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// Wilson score interval, matching the convention used everywhere else in this project.
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.959963985, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h) * 100, Math.min(1, c + h) * 100];
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (k: number, n: number) => { const [l, h] = wilson(k, n); return `${l.toFixed(1)}–${h.toFixed(1)}`; };

async function buildSnapshot(genes: string[]): Promise<Record<string, Bucket[]>> {
  if (existsSync(SNAPSHOT)) {
    const s = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    if (s.tractability && Object.keys(s.tractability).length >= genes.length) {
      console.log(`Using cached snapshot: ${SNAPSHOT} (fetched ${s.fetchedAt})`);
      return s.tractability;
    }
  }
  console.log(`Resolving ${genes.length} gene symbols to Ensembl IDs…`);
  const ens: Record<string, string> = {};
  for (const c of chunk(genes, 40)) {
    const q = `{mapIds(queryTerms:${JSON.stringify(c)},entityNames:["target"]){mappings{term hits{id name entity}}}}`;
    const d = await gql(q);
    for (const m of d.mapIds.mappings) {
      // Require an exact symbol match: OT search also returns synonym hits, and the
      // queried gene is not always ranked first (the ALB / Albatross failure).
      const hit = (m.hits ?? []).find((h: any) => h.entity === 'target' && h.name?.toUpperCase() === m.term.toUpperCase());
      if (hit) ens[m.term] = hit.id;
    }
    await sleep(120);
  }
  const missing = genes.filter(g => !ens[g]);
  console.log(`  resolved ${Object.keys(ens).length}/${genes.length}${missing.length ? `; unresolved: ${missing.join(', ')}` : ''}`);

  console.log('Fetching tractability…');
  const tract: Record<string, Bucket[]> = {};
  const entries = Object.entries(ens);
  let done = 0;
  for (const c of chunk(entries, 20)) {
    const q = `{${c.map(([g, id], i) => `t${i}: target(ensemblId:"${id}"){approvedSymbol tractability{modality label value}}`).join(' ')}}`;
    const d = await gql(q);
    c.forEach(([g], i) => { tract[g] = d[`t${i}`]?.tractability ?? []; });
    done += c.length;
    if (done % 100 < 20) console.log(`  ${done}/${entries.length}`);
    await sleep(120);
  }
  mkdirSync('deliverables', { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify({
    note: 'Open Targets tractability buckets for every gene in the derived gold set. Frozen so the baseline reproduces without re-querying.',
    source: OT, fetchedAt: new Date().toISOString(),
    genesRequested: genes.length, genesResolved: Object.keys(ens).length,
    unresolved: missing, ensembl: ens, tractability: tract,
  }, null, 2));
  console.log(`Wrote ${SNAPSHOT}`);
  return tract;
}

function admits(buckets: Bucket[], otModality: string | null, clinicalFree: boolean): boolean {
  if (!otModality) return false;
  return buckets.some(b =>
    b.modality === otModality && b.value === true &&
    !(clinicalFree && CLINICAL_LABELS.has(b.label)));
}

(async () => {
  const gold = JSON.parse(readFileSync('data/modality_goldset.json', 'utf8'));
  const pairs: Pair[] = gold.pairs;
  const genes = [...new Set(pairs.map(p => p.gene))].sort();
  const tract = await buildSnapshot(genes);

  const variants = [
    { key: 'full', label: 'Open Targets tractability, all buckets (comparable to L0)', clinicalFree: false, strict: false },
    { key: 'clinicalFree', label: 'Open Targets tractability, clinical-precedence buckets removed (comparable to L2)', clinicalFree: true, strict: false },
    { key: 'clinicalFreeStrict', label: 'As above, and no oligonucleotide family credited at all', clinicalFree: true, strict: true },
  ];

  const out: any = {
    note: 'Goal-blind baseline: Open Targets tractability scored on the same 400 assignments as the rules. A resource that reports (target, modality) without a goal input.',
    generatedAt: new Date().toISOString(),
    snapshot: SNAPSHOT,
    assignments: pairs.length, genes: genes.length,
    variants: {},
  };

  for (const v of variants) {
    const byModality: Record<string, { hit: number; total: number }> = {};
    const byGoal: Record<string, { hit: number; total: number }> = {};
    let hit = 0, nonSMhit = 0, nonSMtot = 0;
    const misses: Pair[] = [];
    for (const p of pairs) {
      let otm = MODALITY_TO_OT[p.modality] ?? null;
      if (v.strict && (p.modality === 'RNA' || p.modality === 'Splice')) otm = null;
      const ok = admits(tract[p.gene] ?? [], otm, v.clinicalFree);
      byModality[p.modality] ??= { hit: 0, total: 0 };
      byModality[p.modality].total++; if (ok) byModality[p.modality].hit++;
      byGoal[p.goal] ??= { hit: 0, total: 0 };
      byGoal[p.goal].total++; if (ok) byGoal[p.goal].hit++;
      if (ok) hit++; else misses.push(p);
      if (p.modality !== 'SM') { nonSMtot++; if (ok) nonSMhit++; }
    }
    out.variants[v.key] = {
      label: v.label,
      overall: { hit, total: pairs.length, recall: hit / pairs.length, ci: wilson(hit, pairs.length) },
      nonSM: { hit: nonSMhit, total: nonSMtot, recall: nonSMhit / nonSMtot, ci: wilson(nonSMhit, nonSMtot) },
      byModality, byGoal,
      missCount: misses.length,
    };
    console.log(`\n${v.label}\n  overall ${hit}/${pairs.length} = ${pct(hit / pairs.length)}   non-SM ${nonSMhit}/${nonSMtot} = ${pct(nonSMhit / nonSMtot)}`);
  }

  mkdirSync('deliverables', { recursive: true });
  writeFileSync('deliverables/goal_blind_baseline.json', JSON.stringify(out, null, 2));

  const R = (k: number, n: number) => `${k}/${n} (${pct(k / n)})`;
  const md: string[] = [
    '# Goal-blind baseline — Open Targets tractability on the derived gold set',
    '',
    `Scored on the same **${pairs.length} assignments over ${genes.length} genes** used to evaluate the rules.`,
    `Tractability snapshot: \`${SNAPSHOT}\`.`,
    '',
    'A goal-blind resource reports an assessment as a function of (target, modality). It is credited with',
    'recovering an assignment when any tractability bucket for the corresponding modality family is true.',
    'Oligonucleotide assignments are mapped to the "Other clinical" (OC) family, which is the generous',
    'reading — OC carries no structural or biological buckets, only clinical-precedence labels.',
    '',
    '| Variant | Overall recall | 95% CI | Non-small-molecule recall | 95% CI |',
    '|---|---|---|---|---|',
  ];
  for (const v of variants) {
    const r = out.variants[v.key];
    md.push(`| ${v.label} | ${R(r.overall.hit, r.overall.total)} | ${ci(r.overall.hit, r.overall.total)} | **${R(r.nonSM.hit, r.nonSM.total)}** | ${ci(r.nonSM.hit, r.nonSM.total)} |`);
  }
  md.push('', '## Recall by modality class', '', '| Modality | ' + variants.map(v => v.key).join(' | ') + ' |', '|---|' + variants.map(() => '---|').join(''));
  for (const m of ['SM', 'Antibody', 'RNA', 'Splice']) {
    md.push(`| ${m} | ` + variants.map(v => { const b = out.variants[v.key].byModality[m]; return b ? R(b.hit, b.total) : '—'; }).join(' | ') + ' |');
  }
  md.push('', '## Reading', '',
    'Open Targets carries no biological evidence for oligonucleotide modalities. Its only oligonucleotide-',
    'capable family (OC) consists entirely of the labels "Approved Drug", "Advanced Clinical" and',
    '"Phase 1 Clinical". Every assignment in this gold set is phase 4 by construction, so the full-bucket',
    'variant recovers RNA and splice assignments purely by reading back the clinical outcome the benchmark',
    'is asking about. Once that leakage is removed, the goal-blind baseline retains no signal for those',
    'modalities at all.',
    '', `Generated by \`scripts/goalBlindBaseline.ts\` at ${out.generatedAt}.`, '');
  writeFileSync('deliverables/goal_blind_baseline.md', md.join('\n'));
  console.log('\nWrote deliverables/goal_blind_baseline.{json,md}');
})();
