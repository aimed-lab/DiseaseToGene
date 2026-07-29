// Build a tumour-vs-normal PROTEIN reference table from CPTAC (via LinkedOmics) —
// the protein-level mirror of build_expression.mjs. No Python, no pip.
//
//   node scripts/build_proteomics.mjs <cohortKey>       # e.g. pdac, gbm, luad, coad
//
// Reads the cohort's `proteomics` block from data/disease_registry.json (linkedomics_cohort +
// ref_file), downloads LinkedOmics' gene-level MD-abundance tumour + normal matrices, and writes
// data/<ref_file> in the SAME shape as data/expression_*.json:
//   { "meta": {...}, "genes": { "GENE": { tumor_median, normal_median, log2fc, p, n_tumor, n_normal } } }
// LinkedOmics abundance is already log2, so log2FC = tumour_median - normal_median.

import fs from 'fs';
import path from 'path';

const LO = 'https://linkedomics.org/data_download';

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Mann-Whitney U p-value (normal approximation) — same as build_expression.mjs.
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

// Parse a LinkedOmics .cct matrix -> Map<gene, number[]> (row = gene, cols = samples).
async function fetchCct(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const text = await r.text();
  const lines = text.split(/\r?\n/);
  const out = new Map();
  for (let i = 1; i < lines.length; i++) {          // line 0 = sample header
    if (!lines[i]) continue;
    const c = lines[i].split('\t');
    const gene = c[0]; if (!gene) continue;
    const v = [];
    for (let j = 1; j < c.length; j++) { const x = parseFloat(c[j]); if (Number.isFinite(x)) v.push(x); }
    out.set(gene, v);
  }
  return out;
}

async function main() {
  const key = process.argv[2];
  if (!key) { console.error('usage: node scripts/build_proteomics.mjs <cohortKey>   (e.g. pdac, gbm, luad, coad)'); process.exit(1); }
  const reg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'disease_registry.json'), 'utf-8'));
  const cohort = (reg.cohorts || []).find(c => String(c.key).toLowerCase() === key.toLowerCase());
  if (!cohort) { console.error(`no cohort "${key}" in registry (have: ${(reg.cohorts || []).map(c => c.key).join(', ')})`); process.exit(1); }
  const cfg = cohort.proteomics;
  if (!cfg || !cfg.linkedomics_cohort) { console.error(`cohort "${key}" has no proteomics.linkedomics_cohort`); process.exit(1); }
  const base = `${LO}/${cfg.linkedomics_cohort}`;
  const OUT = path.join(process.cwd(), 'data', cfg.ref_file);

  console.log(`Cohort ${cohort.key} — LinkedOmics ${cfg.linkedomics_cohort} → data/${cfg.ref_file}`);
  console.log('downloading tumour + normal proteome matrices…');
  const [tumor, normal] = await Promise.all([
    fetchCct(`${base}/proteomics_gene_level_MD_abundance_tumor.cct`),
    fetchCct(`${base}/proteomics_gene_level_MD_abundance_normal.cct`),
  ]);
  const nT = Math.max(...[...tumor.values()].map(v => v.length), 0);
  const nN = Math.max(...[...normal.values()].map(v => v.length), 0);
  console.log(`tumour genes ${tumor.size} (~${nT} samples) · normal genes ${normal.size} (~${nN} samples)`);
  if (nN < 5) { console.error('fewer than 5 normal samples — this cohort lacks matched normals.'); process.exit(1); }

  const out = { meta: { source: cfg.source_label, cohort: cohort.key, units: 'log2 protein abundance (CPTAC/LinkedOmics MD)', built: new Date().toISOString().slice(0, 10) }, genes: {} };
  for (const [g, tv] of tumor) {
    const nv = normal.get(g);
    if (!nv || tv.length < 5 || nv.length < 5) continue;
    const tMed = median(tv), nMed = median(nv);
    const log2fc = tMed - nMed;
    const p = mannWhitneyP(tv, nv);
    out.genes[g] = { tumor_median: +tMed.toFixed(3), normal_median: +nMed.toFixed(3), log2fc: +log2fc.toFixed(3), p: +p.toExponential(2), n_tumor: tv.length, n_normal: nv.length };
  }
  out.meta.n_tumor = nT; out.meta.n_normal = nN;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${Object.keys(out.genes).length} genes → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
