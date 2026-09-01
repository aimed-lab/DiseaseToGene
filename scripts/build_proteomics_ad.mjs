// Build the Alzheimer's PROTEIN reference table from AMP-AD brain proteomics (LFQ), the
// non-cancer counterpart of build_proteomics.mjs. No Python, no pip.
//
//   node scripts/build_proteomics_ad.mjs
//
// Input : data/Final_Agora_DE.csv — Synapse syn18689335, the exact file Agora serves as
//         proteomics_LFQ (verified: APOE DLPFC log2FC +0.181 matches the Agora API).
//         AD vs control, differential expression already computed upstream, with 95% CIs
//         and FDR-corrected p-values, across four brain regions.
// Output: data/proteomics_ad.json in the SAME shape the proteomics axis already reads:
//         { meta, genes: { GENE: { log2fc, p, ... } } }
//
// Why LFQ and not TMT. The TMT file Agora lists (syn32188234) is a logistic-model output —
// its "Coefficient" is log-odds, ranging -20..+24, and Agora's ETL merely RENAMES that
// column to log2_fc. It does not match what Agora displays for TMT, and cannot be read as
// fold change. LFQ needs no such step.
//
// Two choices are made per gene, both recorded so a reader can see them:
//   isoform — several UniProt isoforms share one symbol and disagree (CLTB DLPFC: P09497-2
//             at p=0.014 vs P09497 at p≈1). Keep the isoform with the smallest corrected p,
//             which is Agora's own convention (min fdr per gene).
//   tissue  — DLPFC when it has a value: the most-sampled region, and the one TMT/SRM also
//             use, so it is the field's default frame. Otherwise the region with the
//             smallest corrected p. All four regions are kept under `tissues` regardless.

import fs from 'fs';
import path from 'path';

const IN = path.join(process.cwd(), 'data', 'Final_Agora_DE.csv');
const OUT = path.join(process.cwd(), 'data', 'proteomics_ad.json');
const PRIMARY_TISSUE = 'DLPFC';

if (!fs.existsSync(IN)) {
  console.error(`Missing ${path.relative(process.cwd(), IN)}.\nDownload it (free Synapse account): https://www.synapse.org/Synapse:syn18689335`);
  process.exit(1);
}

// Quote-aware CSV split — the file has none today, but a symbol with a comma would
// otherwise silently shift every column after it.
const splitCsv = (line) => {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
};
const num = (v) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : n; };

const lines = fs.readFileSync(IN, 'utf8').split(/\r?\n/).filter(Boolean);
const H = splitCsv(lines[0]).map(h => h.replace(/^﻿/, '').trim());
const col = (name) => { const i = H.indexOf(name); if (i < 0) throw new Error(`column ${name} not found; header = ${H.join(',')}`); return i; };
const iGene = col('GeneName'), iProt = col('UniProtID'), iTis = col('Tissue');
const iFc = col('Log2_FC'), iUp = col('CI_Upr'), iLw = col('CI_Lwr'), iP = col('PVal'), iCp = col('Cor_PVal');

// gene -> tissue -> best isoform row
const byGene = new Map();
let rows = 0, usable = 0;
for (const line of lines.slice(1)) {
  const c = splitCsv(line); rows++;
  const log2fc = num(c[iFc]), corP = num(c[iCp]);
  if (log2fc == null || corP == null) continue;            // NA rows carry nothing
  usable++;
  const gene = String(c[iGene] || '').trim().toUpperCase(); if (!gene) continue;
  const tissue = c[iTis];
  const rec = { log2fc, p: corP, p_raw: num(c[iP]), ci_lwr: num(c[iLw]), ci_upr: num(c[iUp]), uniprot: c[iProt] };
  const t = byGene.get(gene) ?? new Map(); byGene.set(gene, t);
  const prev = t.get(tissue);
  if (!prev || corP < prev.p) t.set(tissue, rec);            // isoform policy: min corrected p
}

const genes = {};
let primary = 0, fallback = 0;
for (const [gene, tissues] of byGene) {
  let pick = tissues.get(PRIMARY_TISSUE);
  if (pick) primary++;
  else { pick = [...tissues.values()].sort((a, b) => a.p - b.p)[0]; fallback++; }
  const tissue = pick === tissues.get(PRIMARY_TISSUE) ? PRIMARY_TISSUE : [...tissues.entries()].find(([, r]) => r === pick)[0];
  const all = {}; for (const [t, r] of tissues) all[t] = { log2fc: r.log2fc, p: r.p };
  genes[gene] = { ...pick, tissue, n_tissues: tissues.size, tissues: all };
}

const fcs = Object.values(genes).map(g => Math.abs(g.log2fc)).sort((a, b) => a - b);
const q = (p) => fcs[Math.min(fcs.length - 1, Math.floor(p * fcs.length))];

const meta = {
  source: 'AMP-AD brain proteome, LFQ (AD vs control, 4 regions) — Agora / Synapse syn18689335',
  cohort: 'ad',
  platform: 'LFQ',
  synapse: 'syn18689335',
  file: 'Final_Agora_DE.csv',
  units: 'log2 fold change, AD vs control, per brain region',
  p_is: 'Cor_PVal — FDR-corrected. Raw p kept as p_raw.',
  tissue_policy: `${PRIMARY_TISSUE} when measured, otherwise the region with the smallest corrected p; every region kept under tissues{}`,
  isoform_policy: 'per gene and region, the UniProt isoform with the smallest corrected p (Agora convention)',
  scale_note: 'AD brain effect sizes are ~20x smaller than tumour-vs-normal. |log2FC| q95 across genes is ' +
              `${q(0.95).toFixed(2)}, q99 ${q(0.99).toFixed(2)}; the axis divisor for this cohort is set in ` +
              'disease_registry.json (log2fc_scale), not the cancer default of 3.',
  // Tells the UI this is case-vs-control, not tumour-vs-normal. CPTAC files carry no design
  // field, so their absence keeps the tumour wording; only an explicit marker changes it.
  design: 'case_control',
  built: new Date().toISOString().slice(0, 10),
  n_genes: Object.keys(genes).length,
  n_rows_in_file: rows,
  n_rows_usable: usable,
  n_primary_tissue: primary,
  n_fallback_tissue: fallback,
};

fs.writeFileSync(OUT, JSON.stringify({ meta, genes }, null, 1));
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`  ${meta.n_genes} genes from ${usable} usable rows (of ${rows})`);
console.log(`  ${primary} on ${PRIMARY_TISSUE}, ${fallback} fell back to another region`);
console.log(`  |log2FC| median ${q(0.5).toFixed(3)} · q95 ${q(0.95).toFixed(3)} · q99 ${q(0.99).toFixed(3)}`);
