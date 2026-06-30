// Build the preloaded gnomAD constraint (safety) reference table.
//   node scripts/build_gnomad_constraint.mjs
//
// One-time offline build. gnomAD constraint is the "reasons-not-to-pursue" safety
// signal (pLI / LOEUF). The app already reads it LIVE per gene via the gnomAD v4
// GraphQL API (gnomadService.ts / ConstraintPanel) — but a per-gene call is the
// only slow step in a full-universe harvest. This script downloads the gnomAD
// v4.0 constraint metrics table ONCE and flattens it to a gene-keyed JSON the app
// serves at /api/gnomad, so the harvest job can look up every gene instantly.
//
// Source (downloaded automatically into ./gnomad_raw/):
//   gnomad.v4.1.constraint_metrics.tsv  (~86 MB) — one row per transcript.
//   We keep the MANE Select transcript per gene (what the gnomAD browser shows),
//   falling back to the most-constrained row if a gene has no MANE row.
//
// IMPORTANT: use the v4.1 release — it recomputed constraint vs v4.0 (e.g. KRAS
// LOEUF 0.264 → 0.226), and the live gnomAD GraphQL API the ConstraintPanel uses
// serves v4.1. Building from v4.1 keeps the stored table == the live drill-down.
// Note the v4.1 path uses bare "4.1" (no "v" prefix), unlike v4.0's "v4.0".
//
// Columns used (resolved by header name): gene, mane_select, lof.pLI,
//   lof.oe_ci.upper (= LOEUF), lof.oe, lof.z_score, mis.z_score — these map 1:1
//   to the v4 GraphQL fields (pLI / oe_lof_upper / oe_lof / lof_z / mis_z).

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { pipeline } from 'stream/promises';

const URL = 'https://storage.googleapis.com/gcp-public-data--gnomad/release/4.1/constraint/gnomad.v4.1.constraint_metrics.tsv';
const RAW = path.join(process.cwd(), 'gnomad_raw');
const TSV = path.join(RAW, 'gnomad.v4.1.constraint_metrics.tsv');
const OUT = path.join(process.cwd(), 'data', 'gnomad_constraint.json');

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) { console.log(`cached  ${path.basename(dest)}`); return; }
  console.log(`fetch   ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  await pipeline(res.body, fs.createWriteStream(dest));
  console.log(`saved   ${path.basename(dest)} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  await download(URL, TSV);

  const rl = readline.createInterface({ input: fs.createReadStream(TSV), crlfDelay: Infinity });
  let col = null;
  const best = new Map();   // gene -> { row fields, mane:boolean, loeuf:number|null }
  let rows = 0;

  for await (const line of rl) {
    if (!line) continue;
    const cells = line.split('\t');
    if (!col) {
      const h = cells;
      const idx = (name) => h.indexOf(name);
      col = {
        gene: idx('gene'), mane: idx('mane_select'),
        pli: idx('lof.pLI'), loeuf: idx('lof.oe_ci.upper'), oe: idx('lof.oe'),
        lofz: idx('lof.z_score'), misz: idx('mis.z_score'),
      };
      if (col.gene < 0 || col.pli < 0 || col.loeuf < 0) throw new Error('Unexpected header — missing gene/pLI/LOEUF columns');
      continue;
    }
    rows++;
    const gene = cells[col.gene];
    if (!gene || gene === 'NA') continue;
    const mane = String(cells[col.mane]).toLowerCase() === 'true';
    const pli = num(cells[col.pli]);
    const loeuf = num(cells[col.loeuf]);
    if (pli == null && loeuf == null) continue;            // no constraint record
    const rec = {
      mane, loeuf,
      data: {
        pli, loeuf,
        oe_lof: num(cells[col.oe]),
        lof_z: num(cells[col.lofz]),
        mis_z: num(cells[col.misz]),
      },
    };
    const prev = best.get(gene);
    // Prefer the MANE Select transcript; otherwise keep the most-constrained
    // (lowest LOEUF) row so the gene's strongest safety signal wins.
    if (!prev) { best.set(gene, rec); continue; }
    if (rec.mane && !prev.mane) { best.set(gene, rec); continue; }
    if (rec.mane === prev.mane) {
      const a = rec.loeuf ?? Infinity, b = prev.loeuf ?? Infinity;
      if (a < b) best.set(gene, rec);
    }
  }

  const out = {
    meta: { source: 'gnomAD v4.1 constraint (MANE Select)', metric: 'pLI / LOEUF (lof.oe_ci.upper)', n_genes: best.size, built: new Date().toISOString().slice(0, 10) },
    genes: {},
  };
  for (const [gene, rec] of best) out.genes[gene] = rec.data;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Parsed ${rows} transcript rows → wrote ${best.size} genes → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
