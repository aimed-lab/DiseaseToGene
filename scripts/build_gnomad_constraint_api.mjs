// Build the gnomAD constraint (safety) reference table FROM THE LIVE gnomAD GraphQL API.
//   node scripts/build_gnomad_constraint_api.mjs            # all genes in the current table
//   node scripts/build_gnomad_constraint_api.mjs KRAS TP53  # just these (validation run)
//
// WHY THIS EXISTS (bug #6). The sibling builder (build_gnomad_constraint.mjs) parses gnomAD's
// published v4.1 bulk TSV. Verified this session: the bulk TSV and gnomAD's own GraphQL API
// DISAGREE for the same gene AND the same MANE transcript —
//     KRAS / ENST00000311936:  TSV lof.oe_ci.upper = 0.264 · pLI 0.99914 · oe_lof 0.05557
//                              API oe_lof_upper    = 0.2264 · pLI 0.99981 · oe_lof 0.04773
// so "pin v4.1" does NOT reconcile them (both files ARE v4.1). They are different
// computations. That mismatch is the audit's consistent +0.02–0.10 LOEUF offset.
//
// The gene drill-down (ConstraintPanel / gnomadService) reads the LIVE API, so the API is the
// project's source of truth: building the table from it makes stored == what the user sees.
//
// Batches genes as GraphQL aliases (BATCH per request) and is resumable — reruns keep
// already-fetched genes from the existing output file.

import fs from 'fs';
import path from 'path';

const API = 'https://gnomad.broadinstitute.org/api';
const OUT = path.join(process.cwd(), 'data', 'gnomad_constraint.json');
const BATCH = 25;        // aliases per request (keep modest — the API is shared/public)
const GAP_MS = 350;      // polite delay between requests
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// GraphQL aliases must be valid names: g_<sanitised symbol>.
const alias = (g, i) => `g${i}_${g.replace(/[^A-Za-z0-9_]/g, '_')}`;

async function fetchBatch(genes) {
  const parts = genes.map((g, i) =>
    `${alias(g, i)}: gene(gene_symbol: ${JSON.stringify(g)}, reference_genome: GRCh38) {
       gnomad_constraint { pLI oe_lof oe_lof_upper lof_z mis_z }
     }`);
  const query = `query {\n${parts.join('\n')}\n}`;
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query }) });
  if (!r.ok) throw new Error(`gnomAD API ${r.status}`);
  const j = await r.json();
  // Per-gene errors (unknown symbol) are reported but must not kill the batch.
  const out = {};
  genes.forEach((g, i) => {
    const c = j?.data?.[alias(g, i)]?.gnomad_constraint;
    if (!c) return;
    if (c.pLI == null && c.oe_lof_upper == null) return;
    out[g] = { pli: c.pLI ?? null, loeuf: c.oe_lof_upper ?? null, oe_lof: c.oe_lof ?? null, lof_z: c.lof_z ?? null, mis_z: c.mis_z ?? null };
  });
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let existing = { genes: {} };
  try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* fresh build */ }

  const genes = argv.length ? argv : Object.keys(existing.genes || {});
  if (!genes.length) { console.error('No gene list. Run build_gnomad_constraint.mjs first, or pass symbols.'); process.exit(1); }
  const validation = argv.length > 0;
  console.log(`${validation ? 'VALIDATION' : 'FULL'} build — ${genes.length} genes from the live gnomAD API`);

  const result = {};
  let done = 0, missing = 0;
  for (let i = 0; i < genes.length; i += BATCH) {
    const chunk = genes.slice(i, i + BATCH);
    let got = {};
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { got = await fetchBatch(chunk); break; }
      catch (e) {
        if (attempt === 3) { console.error(`  batch @${i} failed: ${e.message}`); break; }
        await sleep(1500 * attempt);
      }
    }
    Object.assign(result, got);
    done += chunk.length;
    missing += chunk.length - Object.keys(got).length;
    if (done % (BATCH * 20) === 0 || done >= genes.length) {
      process.stdout.write(`\r  ${done}/${genes.length} genes · ${Object.keys(result).length} with constraint`);
    }
    await sleep(GAP_MS);
  }
  process.stdout.write('\n');

  if (validation) {
    for (const g of genes) console.log(`  ${g.padEnd(9)} ${result[g] ? `loeuf=${result[g].loeuf}  pli=${result[g].pli}` : '(no constraint)'}`);
    console.log('\nValidation run — output NOT written. Re-run with no arguments for the full build.');
    return;
  }

  const out = {
    meta: {
      source: 'gnomAD v4 GraphQL API (gnomad_constraint) — matches the live gene drill-down',
      metric: 'pLI / LOEUF (oe_lof_upper)',
      note: 'Built from the API, NOT the bulk v4.1 TSV: the two disagree for the same MANE transcript (see header of this script).',
      n_genes: Object.keys(result).length,
      built: new Date().toISOString().slice(0, 10),
    },
    genes: result,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${out.meta.n_genes} genes → ${OUT} (${missing} symbols had no constraint record)`);
}

main().catch(e => { console.error(e); process.exit(1); });
