// Build the preloaded tumor-vs-normal expression reference table (pancreatic).
//   node scripts/build_expression_paad.mjs
//
// One-time offline build. Uses the UCSC Xena "Toil" compendium, where TCGA and
// GTEx are reprocessed through the SAME pipeline (so tumor and normal are unit-
// comparable — the reason a naive cBioPortal-RSEM vs GTEx-TPM fold-change is
// invalid). Produces data/expression_paad.json, served by the app at /api/expression.
//
// Downloads (the script fetches these automatically into ./xena_raw/; each is a
// one-time pull — the matrix is large, ~2.5 GB uncompressed):
//   - expression matrix : TcgaTargetGtex_rsem_gene_tpm.gz   (rows = Ensembl gene id, values = log2(tpm+0.001))
//   - phenotype         : TcgaTargetGTEX_phenotype.txt.gz   (sample → study / primary site / sample type)
//   - probemap          : gencode.v23.annotation.gene.probemap (Ensembl id → gene symbol)
//
// Cohorts selected:
//   tumor  = TCGA  · primary site Pancreas · sample type "Primary Tumor"
//   normal = GTEX  · primary site Pancreas
//
// NOTE: dataset IDs/URLs occasionally change between Xena releases — verify against
// https://xenabrowser.net/datapages/ if a download 404s.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { pipeline } from 'stream/promises';

const HUB = 'https://toil-xena-hub.s3.us-east-1.amazonaws.com/download';
const RAW = path.join(process.cwd(), 'xena_raw');
const OUT = path.join(process.cwd(), 'data', 'expression_paad.json');

const FILES = {
  matrix: { url: `${HUB}/TcgaTargetGtex_rsem_gene_tpm.gz`, gz: 'TcgaTargetGtex_rsem_gene_tpm.gz' },
  pheno:  { url: `${HUB}/TcgaTargetGTEX_phenotype.txt.gz`, gz: 'TcgaTargetGTEX_phenotype.txt.gz' },
  probe:  { url: `${HUB}/probeMap/gencode.v23.annotation.gene.probemap`, gz: 'gencode.v23.annotation.gene.probemap' },
};

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
  fs.mkdirSync(RAW, { recursive: true });
  for (const f of Object.values(FILES)) await download(f.url, path.join(RAW, f.gz));

  // 1) phenotype → tumor / normal sample sets
  const tumor = new Set(), normal = new Set();
  {
    const rl = lineStream(path.join(RAW, FILES.pheno.gz));
    let header = null, siteCol = -1, typeCol = -1, studyCol = -1;
    for await (const line of rl) {
      const cols = line.split('\t');
      if (!header) {
        header = cols;
        siteCol = header.findIndex(h => /_primary_site/i.test(h));
        typeCol = header.findIndex(h => /_sample_type/i.test(h));
        studyCol = header.findIndex(h => /_study/i.test(h));
        continue;
      }
      const id = cols[0], site = cols[siteCol] || '', type = cols[typeCol] || '', study = cols[studyCol] || '';
      if (!/pancrea/i.test(site)) continue;
      if (/TCGA/i.test(study) && /primary tumor/i.test(type)) tumor.add(id);
      else if (/GTEX/i.test(study)) normal.add(id);
    }
  }
  console.log(`tumor samples: ${tumor.size} · normal samples: ${normal.size}`);

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
  const out = { meta: { source: 'UCSC Xena Toil (TCGA-PAAD vs GTEx pancreas)', units: 'log2(TPM+0.001)', n_tumor: tumor.size, n_normal: normal.size, built: new Date().toISOString().slice(0, 10) }, genes: {} };
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
    // keep the stronger record if a symbol maps to multiple Ensembl ids
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
