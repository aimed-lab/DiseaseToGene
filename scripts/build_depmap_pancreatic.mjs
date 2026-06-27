// Build the preloaded DepMap pancreatic-dependency reference table.
//   node scripts/build_depmap_pancreatic.mjs
//
// One-time offline build (DepMap has no usable per-gene live API). Produces
// data/depmap_pancreatic.json — a gene-keyed table the app serves at /api/depmap.
//
// Inputs (download once from https://depmap.org/portal/data_page/?tab=currentRelease
// and place under ./depmap_raw/):
//   - CRISPRGeneEffect.csv   rows = ModelID, columns = "SYMBOL (ENTREZ)", values = Chronos gene-effect
//   - Model.csv              ModelID → OncotreeLineage (used to select pancreatic lines)
//
// Chronos gene-effect: 0 = no effect, −1 = median common-essential (strong
// dependency), positive = knockout helps growth.

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const RAW = path.join(process.cwd(), 'depmap_raw');
const MODEL_CSV = path.join(RAW, 'Model.csv');
const EFFECT_CSV = path.join(RAW, 'CRISPRGeneEffect.csv');
const OUT = path.join(process.cwd(), 'data', 'depmap_pancreatic.json');
const RELEASE = process.env.DEPMAP_RELEASE || 'DepMap Public (Chronos)';

function splitCsv(line) {
  // DepMap files are plain comma-delimited; gene headers contain spaces, not commas.
  return line.split(',');
}

async function main() {
  if (!fs.existsSync(MODEL_CSV) || !fs.existsSync(EFFECT_CSV)) {
    console.error(`Missing inputs. Place CRISPRGeneEffect.csv and Model.csv under ${RAW}/`);
    process.exit(1);
  }

  // 1) pancreatic ModelIDs from Model.csv
  const modelText = fs.readFileSync(MODEL_CSV, 'utf-8').split(/\r?\n/);
  const mh = splitCsv(modelText[0]);
  const idCol = mh.indexOf('ModelID');
  const linCol = mh.findIndex(h => /OncotreeLineage|lineage/i.test(h));
  const pancreatic = new Set();
  for (let i = 1; i < modelText.length; i++) {
    if (!modelText[i]) continue;
    const row = splitCsv(modelText[i]);
    if (/pancrea/i.test(row[linCol] || '')) pancreatic.add(row[idCol]);
  }
  console.log(`Pancreatic cell lines: ${pancreatic.size}`);

  // 2) stream the (large, wide) effect matrix; accumulate values per gene for pancreatic rows
  const rl = readline.createInterface({ input: fs.createReadStream(EFFECT_CSV), crlfDelay: Infinity });
  let header = null;
  let genes = [];          // cleaned gene symbols, aligned to columns 1..N
  const acc = [];          // acc[col] = number[] of Chronos values for pancreatic lines
  let modelCount = 0;

  for await (const line of rl) {
    if (!line) continue;
    if (!header) {
      header = splitCsv(line);
      genes = header.slice(1).map(h => h.replace(/\s*\(\d+\)\s*$/, '').trim()); // "KRAS (3845)" → "KRAS"
      for (let i = 0; i < genes.length; i++) acc.push(null);
      continue;
    }
    const cells = splitCsv(line);
    const modelId = cells[0];
    if (!pancreatic.has(modelId)) continue;
    modelCount++;
    for (let c = 1; c < cells.length; c++) {
      const v = parseFloat(cells[c]);
      if (!Number.isFinite(v)) continue;
      (acc[c - 1] ||= []).push(v);
    }
  }
  console.log(`Pancreatic rows matched in matrix: ${modelCount}`);

  // 3) summarize per gene
  const out = { meta: { source: `${RELEASE} · Pancreas lineage`, release: RELEASE, lineage: 'Pancreas', n_lines: modelCount, metric: 'Chronos gene-effect (mean across pancreatic lines)', built: new Date().toISOString().slice(0, 10) }, genes: {} };
  for (let i = 0; i < genes.length; i++) {
    const vals = acc[i];
    if (!vals || !vals.length) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const min = Math.min(...vals);
    const fracDependent = vals.filter(v => v < -0.5).length / vals.length;
    out.genes[genes[i]] = { mean: +mean.toFixed(4), min: +min.toFixed(4), n_lines: vals.length, frac_dependent: +fracDependent.toFixed(3) };
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${Object.keys(out.genes).length} genes → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
