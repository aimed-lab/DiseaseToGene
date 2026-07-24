// Build the tissue-specificity (tau) reference table.
//   node scripts/build_tissue_specificity.mjs
//
// WHY A LOCAL TABLE, NOT AN API CALL. Open Targets exposes per-tissue baseline expression,
// but it returns ~1,450 rows PER GENE (SRC) — roughly 11 million rows across a 7,500-gene
// harvest. So tau is computed ONCE here from the GTEx bulk file, exactly the pattern this
// repo already uses for expression, DepMap and gnomAD. The harvest then reads it instantly
// with zero API calls.
//
// WHAT TAU IS. Yanai's tissue-specificity index over n tissues:
//     tau = SUM(1 - x_i / x_max) / (n - 1)
// computed on log2(TPM+1). tau = 0 means expressed evenly everywhere (a housekeeping gene,
// and a safety concern — drugging it hits every tissue). tau -> 1 means restricted to one
// or a few tissues, which is what you want in a target.
//
// Source: GTEx v8 median gene TPM by tissue (~54 tissues, ~56k genes), gzip, ~5 MB.
// Node's zlib handles gzip natively, so there is no new dependency.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import readline from 'readline';

// NOTE: GTEx moved buckets — the old gtex_analysis_v8 path now 404s. This is the live
// location. v8 (not v10) is used deliberately, to stay consistent with the GTEx-derived
// expression reference this project already ships (TCGA-PAAD vs GTEx pancreas, Toil/v8).
const URL = 'https://storage.googleapis.com/adult-gtex/bulk-gex/v8/rna-seq/GTEx_Analysis_2017-06-05_v8_RNASeQCv1.1.9_gene_median_tpm.gct.gz';
const RAW = path.join(process.cwd(), 'gtex_raw');
const GZ = path.join(RAW, 'gtex_v8_gene_median_tpm.gct.gz');
const OUT = path.join(process.cwd(), 'data', 'tissue_specificity.json');

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) { console.log(`cached  ${path.basename(dest)}`); return; }
  console.log(`fetch   ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  await pipeline(res.body, fs.createWriteStream(dest));
  console.log(`saved   ${path.basename(dest)} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

// tau over log2(TPM+1); returns null when a gene is not expressed anywhere (tau undefined).
function tau(values) {
  const x = values.map(v => Math.log2((v > 0 ? v : 0) + 1));
  const max = Math.max(...x);
  if (!(max > 0)) return null;
  const n = x.length;
  if (n < 2) return null;
  return x.reduce((a, v) => a + (1 - v / max), 0) / (n - 1);
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  await download(URL, GZ);

  const rl = readline.createInterface({
    input: fs.createReadStream(GZ).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  let lineNo = 0, tissues = [], nameCol = -1, descCol = -1;
  const genes = {};
  let parsed = 0, skipped = 0;

  for await (const line of rl) {
    lineNo++;
    // .gct format: line1 "#1.2", line2 "<nRows>\t<nCols>", line3 = header
    if (lineNo <= 2) continue;
    const cells = line.split('\t');
    if (lineNo === 3) {
      nameCol = cells.indexOf('Name');
      descCol = cells.indexOf('Description');
      if (descCol < 0) throw new Error('Unexpected GCT header — no Description column');
      tissues = cells.slice(descCol + 1);
      console.log(`tissues: ${tissues.length}`);
      continue;
    }
    if (!line.trim()) continue;
    const symbol = cells[descCol];
    if (!symbol || symbol === 'NA') { skipped++; continue; }
    const vals = cells.slice(descCol + 1).map(Number);
    if (vals.length !== tissues.length || vals.some(v => !Number.isFinite(v))) { skipped++; continue; }
    const t = tau(vals);
    if (t == null) { skipped++; continue; }
    let maxI = 0;
    for (let i = 1; i < vals.length; i++) if (vals[i] > vals[maxI]) maxI = i;
    // A symbol can appear on several Ensembl rows; keep the most-expressed copy.
    const prev = genes[symbol];
    if (prev && prev.max_tpm >= vals[maxI]) continue;
    genes[symbol] = {
      tau: Number(t.toFixed(4)),
      max_tissue: tissues[maxI],
      max_tpm: Number(vals[maxI].toFixed(3)),
      n_tissues: tissues.length,
    };
    parsed++;
  }

  const out = {
    meta: {
      source: 'GTEx v8 median gene TPM by tissue',
      metric: 'Yanai tau on log2(TPM+1); 0 = ubiquitous, 1 = tissue-restricted',
      n_tissues: tissues.length,
      n_genes: Object.keys(genes).length,
      built: new Date().toISOString().slice(0, 10),
    },
    genes,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`parsed ${parsed} genes (skipped ${skipped}) -> ${OUT}`);
  for (const g of ['KRAS', 'SRC', 'PHGDH', 'ALB', 'INS', 'GAPDH', 'ACTB'])
    if (genes[g]) console.log(`  ${g.padEnd(7)} tau=${genes[g].tau}  max=${genes[g].max_tissue} (${genes[g].max_tpm} TPM)`);
}

main().catch(e => { console.error(e); process.exit(1); });
