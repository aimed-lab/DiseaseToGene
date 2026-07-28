// Build a tumor-vs-normal expression reference table for ANY cancer cohort.
//   node scripts/build_expression.mjs <cohortKey>
//   e.g. node scripts/build_expression.mjs pdac
//        node scripts/build_expression.mjs gbm
//
// The cohort (which primary site / TCGA disease, and the output file) is read from
// data/disease_registry.json. This generalizes the old build_expression_paad.mjs:
// the SAME UCSC Xena "Toil" compendium (TCGA + GTEx reprocessed through one pipeline,
// so tumor and normal are unit-comparable) contains every cancer, so we just change
// the primary-site filter per cohort. The ~2.5 GB matrix downloads ONCE into
// ./xena_raw/ and is reused for every cohort you build.
//
// For a site that hosts more than one TCGA project (e.g. Brain = GBM + LGG), set
// "xena_tcga_disease" in the registry entry to further filter the TCGA tumor set to
// the matching disease; otherwise all TCGA primary tumors at the site are used.
//
// NOTE: Xena dataset IDs/URLs occasionally change between releases — verify against
// https://xenabrowser.net/datapages/ if a download 404s.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { pipeline } from 'stream/promises';

const HUB = 'https://toil-xena-hub.s3.us-east-1.amazonaws.com/download';
const RAW = path.join(process.cwd(), 'xena_raw');

const FILES = {
  matrix: { url: `${HUB}/TcgaTargetGtex_rsem_gene_tpm.gz`, gz: 'TcgaTargetGtex_rsem_gene_tpm.gz' },
  pheno:  { url: `${HUB}/TcgaTargetGTEX_phenotype.txt.gz`, gz: 'TcgaTargetGTEX_phenotype.txt.gz' },
  probe:  { url: `${HUB}/probeMap/gencode.v23.annotation.gene.probemap`, gz: 'gencode.v23.annotation.gene.probemap' },
};

// ── cohort config from the shared registry ──
function loadCohort(key) {
  const reg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'disease_registry.json'), 'utf-8'));
  const c = (reg.cohorts || []).find(x => String(x.key).toLowerCase() === String(key).toLowerCase());
  if (!c) throw new Error(`No cohort "${key}" in data/disease_registry.json (have: ${(reg.cohorts || []).map(x => x.key).join(', ')})`);
  if (!c.expression) throw new Error(`Cohort "${key}" has no "expression" config in the registry.`);
  return c;
}

async function download(url, dest) {
  if (fs.existsSync(dest)) { console.log(`cached  ${path.basename(dest)}`); return; }
  console.log(`fetch   ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  await pipeline(res.body, fs.createWriteStream(dest));
}

function lineStream(file) {
  const raw = fs.createReadStream(file);
  const input = file.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
  return readline.createInterface({ input, crlfDelay: Infinity });
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Mann-Whitney U p-value (normal approximation) — fine for n in the hundreds.
function mannWhitneyP(a, b) {
  const all = a.map(v => ({ v, g: 0 })).concat(b.map(v => ({ v, g: 1 }))).sort((x, y) => x.v - y.v);
  let i = 0; const ranks = new Array(all.length);
  while (i < all.length) {
    let j = i; while (j < all.length - 1 && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let R1 = 0; for (let k = 0; k < all.length; k++) if (all[k].g === 0) R1 += ranks[k];
  const n1 = a.length, n2 = b.length;
  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const mU = (n1 * n2) / 2, sU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  if (sU === 0) return 1;
  const z = (U1 - mU) / sU;
  return 2 * (1 - normCdf(Math.abs(z)));
}
function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

async function main() {
  const key = process.argv[2];
  if (!key) { console.error('usage: node scripts/build_expression.mjs <cohortKey>   (e.g. pdac, gbm)'); process.exit(1); }
  const cohort = loadCohort(key);
  const cfg = cohort.expression;
  const OUT = path.join(process.cwd(), 'data', cfg.ref_file);
  const siteRe = new RegExp(cfg.xena_primary_site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const diseaseRe = cfg.xena_tcga_disease ? new RegExp(cfg.xena_tcga_disease.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  console.log(`Cohort ${cohort.key} — site /${siteRe.source}/${diseaseRe ? ` · TCGA disease /${diseaseRe.source}/` : ''} → data/${cfg.ref_file}`);

  fs.mkdirSync(RAW, { recursive: true });
  for (const f of Object.values(FILES)) await download(f.url, path.join(RAW, f.gz));

  // 1) phenotype → tumor / normal sample sets
  const tumor = new Set(), normal = new Set();
  {
    const rl = lineStream(path.join(RAW, FILES.pheno.gz));
    let header = null, siteCol = -1, typeCol = -1, studyCol = -1, diseaseCol = -1;
    for await (const line of rl) {
      const cols = line.split('\t');
      if (!header) {
        header = cols;
        siteCol = header.findIndex(h => /_primary_site/i.test(h));
        typeCol = header.findIndex(h => /_sample_type/i.test(h));
        studyCol = header.findIndex(h => /_study/i.test(h));
        // detailed disease/category column, used only when xena_tcga_disease is set
        diseaseCol = header.findIndex(h => /detailed_category|primary.?disease|_primary_disease/i.test(h));
        if (diseaseRe && diseaseCol < 0) console.warn('  ! xena_tcga_disease is set but no disease/category column was found — falling back to site-only tumor selection.');
        continue;
      }
      const id = cols[0], site = cols[siteCol] || '', type = cols[typeCol] || '', study = cols[studyCol] || '';
      const disease = diseaseCol >= 0 ? (cols[diseaseCol] || '') : '';
      if (!siteRe.test(site)) continue;
      if (/TCGA/i.test(study) && /primary tumor/i.test(type)) {
        if (diseaseRe && diseaseCol >= 0 && !diseaseRe.test(disease)) continue; // wrong TCGA project at this site
        tumor.add(id);
      } else if (/GTEX/i.test(study)) {
        normal.add(id);
      }
    }
  }
  console.log(`tumor samples: ${tumor.size} · normal samples: ${normal.size}`);
  if (!tumor.size || !normal.size) throw new Error('No tumor or no normal samples matched — check xena_primary_site / xena_tcga_disease in the registry.');

  // 2) Ensembl id → symbol
  const sym = new Map();
  {
    const rl = lineStream(path.join(RAW, FILES.probe.gz));
    let first = true;
    for await (const line of rl) {
      if (first) { first = false; if (/^#|^id\b/i.test(line)) continue; }
      const c = line.split('\t');
      if (c[0] && c[1]) sym.set(c[0].split('.')[0], c[1]); // strip Ensembl version
    }
  }

  // 3) stream matrix; per gene compute tumor/normal medians + log2FC + p
  const out = { meta: { source: cfg.source_label, cohort: cohort.key, units: 'log2(TPM+0.001)', n_tumor: tumor.size, n_normal: normal.size, built: new Date().toISOString().slice(0, 10) }, genes: {} };
  const rl = lineStream(path.join(RAW, FILES.matrix.gz));
  let header = null, tIdx = [], nIdx = [];
  let rows = 0;
  console.log('crunching matrix (this takes a few minutes — progress below)…');
  for await (const line of rl) {
    const cells = line.split('\t');
    if (!header) {
      header = cells;
      for (let i = 1; i < header.length; i++) {
        if (tumor.has(header[i])) tIdx.push(i);
        else if (normal.has(header[i])) nIdx.push(i);
      }
      console.log(`matched columns — tumor ${tIdx.length}, normal ${nIdx.length}`);
      continue;
    }
    if (++rows % 5000 === 0) console.log(`  …processed ${rows} genes (kept ${Object.keys(out.genes).length})`);
    const ens = cells[0].split('.')[0];
    const symbol = sym.get(ens);
    if (!symbol) continue;
    const tv = [], nv = [];
    for (const i of tIdx) { const v = parseFloat(cells[i]); if (Number.isFinite(v)) tv.push(v); }
    for (const i of nIdx) { const v = parseFloat(cells[i]); if (Number.isFinite(v)) nv.push(v); }
    if (tv.length < 5 || nv.length < 5) continue;
    const tMed = median(tv), nMed = median(nv);
    const log2fc = tMed - nMed; // values already log2 → difference is log2 fold-change
    const p = mannWhitneyP(tv, nv);
    const prev = out.genes[symbol];
    if (!prev || Math.abs(log2fc) > Math.abs(prev.log2fc)) {
      out.genes[symbol] = { tumor_median: +tMed.toFixed(3), normal_median: +nMed.toFixed(3), log2fc: +log2fc.toFixed(3), p: +p.toExponential(2), n_tumor: tv.length, n_normal: nv.length };
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${Object.keys(out.genes).length} genes → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
