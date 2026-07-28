// Build a DepMap CRISPR dependency reference table for ANY cancer lineage.
//   node scripts/build_depmap.mjs <cohortKey>
//   e.g. node scripts/build_depmap.mjs pdac
//        node scripts/build_depmap.mjs gbm
//
// The DepMap OncotreeLineage and output file are read from data/disease_registry.json.
// This generalizes the old build_depmap_pancreatic.mjs: the SAME bulk matrix covers
// every lineage, so we just change the lineage filter per cohort. Download the inputs
// ONCE from https://depmap.org/portal/data_page/?tab=currentRelease into ./depmap_raw/
// (reused for every cohort you build):
//   - CRISPRGeneEffect.csv   rows = ModelID, columns = "SYMBOL (ENTREZ)", Chronos gene-effect
//   - Model.csv              ModelID → OncotreeLineage
//
// Chronos gene-effect: 0 = no effect, −1 = median common-essential (strong dependency),
// positive = knockout helps growth.

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const RAW = path.join(process.cwd(), 'depmap_raw');
const MODEL_CSV = path.join(RAW, 'Model.csv');
const EFFECT_CSV = path.join(RAW, 'CRISPRGeneEffect.csv');
const RELEASE = process.env.DEPMAP_RELEASE || 'DepMap Public (Chronos)';

function splitCsv(line) {
  // DepMap files are plain comma-delimited; gene headers contain spaces, not commas.
  return line.split(',');
}

function loadCohort(key) {
  const reg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'disease_registry.json'), 'utf-8'));
  const c = (reg.cohorts || []).find(x => String(x.key).toLowerCase() === String(key).toLowerCase());
  if (!c) throw new Error(`No cohort "${key}" in data/disease_registry.json (have: ${(reg.cohorts || []).map(x => x.key).join(', ')})`);
  if (!c.dependency || !c.dependency.depmap_lineage) throw new Error(`Cohort "${key}" has no "dependency.depmap_lineage" in the registry.`);
  return c;
}

async function main() {
  const key = process.argv[2];
  if (!key) { console.error('usage: node scripts/build_depmap.mjs <cohortKey>   (e.g. pdac, gbm)'); process.exit(1); }
  const cohort = loadCohort(key);
  const cfg = cohort.dependency;
  const OUT = path.join(process.cwd(), 'data', cfg.ref_file);
  const lineageNeedle = String(cfg.depmap_lineage).toLowerCase();

  if (!fs.existsSync(MODEL_CSV) || !fs.existsSync(EFFECT_CSV)) {
    console.error(`Missing inputs. Place CRISPRGeneEffect.csv and Model.csv under ${RAW}/`);
    process.exit(1);
  }
  console.log(`Cohort ${cohort.key} — DepMap lineage "${cfg.depmap_lineage}" → data/${cfg.ref_file}`);

  // 1) matching ModelIDs from Model.csv (by OncotreeLineage)
  const modelText = fs.readFileSync(MODEL_CSV, 'utf-8').split(/\r?\n/);
  const mh = splitCsv(modelText[0]);
  const idCol = mh.indexOf('ModelID');
  const linCol = mh.findIndex(h => /OncotreeLineage|lineage/i.test(h));
  const models = new Set();
  for (let i = 1; i < modelText.length; i++) {
    if (!modelText[i]) continue;
    const row = splitCsv(modelText[i]);
    if (String(row[linCol] || '').toLowerCase().includes(lineageNeedle)) models.add(row[idCol]);
  }
  console.log(`${cfg.depmap_lineage} cell lines: ${models.size}`);
  if (!models.size) throw new Error(`No cell lines matched lineage "${cfg.depmap_lineage}" — check the exact OncotreeLineage string in Model.csv.`);

  // 2) stream the (large, wide) effect matrix; accumulate values per gene for matching rows
  const rl = readline.createInterface({ input: fs.createReadStream(EFFECT_CSV), crlfDelay: Infinity });
  let header = null;
  let genes = [];
  const acc = [];
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
    if (!models.has(modelId)) continue;
    modelCount++;
    for (let c = 1; c < cells.length; c++) {
      const v = parseFloat(cells[c]);
      if (!Number.isFinite(v)) continue;
      (acc[c - 1] ||= []).push(v);
    }
  }
  console.log(`${cfg.depmap_lineage} rows matched in matrix: ${modelCount}`);

  // 3) summarize per gene
  const out = { meta: { source: cfg.source_label, cohort: cohort.key, release: RELEASE, lineage: cfg.depmap_lineage, n_lines: modelCount, metric: 'Chronos gene-effect (mean across lineage lines)', built: new Date().toISOString().slice(0, 10) }, genes: {} };
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
