// scripts/build_proteomics_gbm.mjs ────────────────────────────────────────────
// Glioblastoma tumour-vs-normal protein log2FC, from the Proteomic Data Commons.
//
//   node scripts/build_proteomics_gbm.mjs
//   → data/proteomics_gbm.json
//
// WHY NOT LinkedOmics, which every other cohort uses. LinkedOmics serves the CPTAC GBM
// proteome as tumours only: 99 samples, no normals. A tumour-versus-normal axis cannot be
// built from that, which is why this axis was left empty when glioblastoma was harvested.
// The underlying CPTAC study DOES include normals; only the LinkedOmics view drops them.
// PDC exposes them, so the axis is buildable after all:
//
//   PDC000204 — CPTAC GBM Discovery Study, Proteome, TMT11
//     100  Primary Tumor
//      10  Solid Tissue Normal
//
// WHAT THE NUMBERS ARE. TMT quantitation is a ratio to a pooled internal reference, so a
// cell of the matrix is log2(sample / reference). The difference of two such log-ratios is
// a genuine log2 fold change, which is why tumour mean minus normal mean is the right
// statistic here. This is NOT the trap the Alzheimer's axis hit, where the file Agora
// links turned out to be log-odds rather than fold change: PDC labels this data type
// log2_ratio explicitly. Verified against the data before this script was written.
//
// TEN NORMALS IS FEW. Every gene therefore carries n and a Welch p-value, and low_confidence
// is set wherever the normal arm is thin or the variance makes the direction unreliable. An
// effect size with no sample size behind it is exactly the criticism this axis would attract.
import fs from 'node:fs';
import path from 'node:path';

const PDC = 'https://pdc.cancer.gov/graphql';
const STUDY = process.env.PDC_STUDY || 'PDC000204';
const OUT = path.join(process.cwd(), 'data', 'proteomics_gbm.json');
const MIN_PER_ARM = 3;          // fewer than this in either arm and the mean is not a mean

async function gql(query) {
  const r = await fetch(PDC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('PDC: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

// Welch's t-test: the arms are 100 and 10, so pooled variance would be wrong.
function welch(a, b) {
  const n = a.length, m = b.length;
  if (n < 2 || m < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / m;
  const va = a.reduce((s, v) => s + (v - ma) ** 2, 0) / (n - 1);
  const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (m - 1);
  const se2 = va / n + vb / m;
  if (!(se2 > 0)) return null;
  const t = (ma - mb) / Math.sqrt(se2);
  const df = se2 ** 2 / ((va / n) ** 2 / (n - 1) + (vb / m) ** 2 / (m - 1));
  return { t, df, p: 2 * studentTailP(Math.abs(t), df) };
}
// Upper-tail Student's t via the regularised incomplete beta. Enough precision for a flag.
function studentTailP(t, df) {
  const x = df / (df + t * t);
  return 0.5 * betaInc(x, df / 2, 0.5);
}
function betaInc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2);
    let num;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d; f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }
  const r = front * (f - 1);
  return x < (a + 1) / (a + b + 2) ? r : 1 - betaInc(1 - x, b, a);
}
function lgamma(z) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Benjamini-Hochberg, so "significant" survives 10,000 tests.
function bh(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const out = new Array(ps.length).fill(null);
  let prev = 1;
  for (let k = idx.length - 1; k >= 0; k--) {
    const [p, i] = idx[k];
    prev = Math.min(prev, (p * idx.length) / (k + 1));
    out[i] = Math.min(1, prev);
  }
  return out;
}

const main = async () => {
  process.stderr.write(`PDC ${STUDY}: sample types…\n`);
  const bio = (await gql(`{ biospecimenPerStudy(pdc_study_id:"${STUDY}" acceptDUA:true) { aliquot_submitter_id sample_type } }`)).biospecimenPerStudy;
  const type = new Map(bio.map(b => [String(b.aliquot_submitter_id), b.sample_type]));
  const counts = {};
  for (const b of bio) counts[b.sample_type] = (counts[b.sample_type] || 0) + 1;
  process.stderr.write(`  ${bio.length} aliquots: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}\n`);

  process.stderr.write('  quant matrix (log2_ratio)…\n');
  const m = (await gql(`{ quantDataMatrix(pdc_study_id:"${STUDY}" data_type:"log2_ratio" acceptDUA:true) }`)).quantDataMatrix;
  const hdr = m[0];
  const T = [], N = [];
  for (let c = 1; c < hdr.length; c++) {
    // Header cells are "<uuid>:<aliquot_submitter_id>"; the submitter id is the join key.
    const t = type.get(String(hdr[c]).split(':')[1]);
    if (t === 'Primary Tumor') T.push(c);
    else if (t === 'Solid Tissue Normal') N.push(c);
  }
  process.stderr.write(`  matrix ${(m.length - 1).toLocaleString()} genes x ${hdr.length - 1} aliquots -> ${T.length} tumour, ${N.length} normal\n`);
  if (T.length < MIN_PER_ARM || N.length < MIN_PER_ARM) throw new Error('not enough samples in one arm');

  const vals = (row, ix) => ix.map(c => Number(row[c])).filter(Number.isFinite);
  const rows = [];
  for (let i = 1; i < m.length; i++) {
    const gene = String(m[i][0] || '').trim();
    if (!gene) continue;
    const t = vals(m[i], T), n = vals(m[i], N);
    if (t.length < MIN_PER_ARM || n.length < MIN_PER_ARM) continue;
    const mt = t.reduce((s, v) => s + v, 0) / t.length;
    const mn = n.reduce((s, v) => s + v, 0) / n.length;
    const w = welch(t, n);
    rows.push({ gene, log2fc: mt - mn, p_raw: w ? w.p : null, n_tumour: t.length, n_normal: n.length });
  }
  const q = bh(rows.map(r => r.p_raw));
  const genes = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    genes[r.gene] = {
      log2fc: r.log2fc,
      p: q[i],
      p_raw: r.p_raw,
      n_tumour: r.n_tumour,
      n_normal: r.n_normal,
      // Ten normals is thin. Flag anything the statistics cannot stand behind, so the board
      // can discount it rather than treat a noisy mean as a measured effect.
      low_confidence: r.n_normal < 5 || !(q[i] != null && q[i] < 0.05),
    };
  }
  const sig = Object.values(genes).filter(g => !g.low_confidence).length;
  const out = {
    meta: {
      source: `CPTAC GBM Discovery Study proteome (TMT11) via PDC ${STUDY} — tumour vs solid tissue normal`,
      cohort: 'gbm', platform: 'TMT11', pdc_study_id: STUDY,
      quantitation: 'log2 ratio to pooled internal reference; log2FC = mean(tumour) - mean(normal)',
      n_tumour: T.length, n_normal: N.length,
      statistic: "Welch's t-test, Benjamini-Hochberg across genes",
      built_at: new Date().toISOString(),
    },
    genes,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT}`);
  console.log(`  ${Object.keys(genes).length.toLocaleString()} genes, ${sig.toLocaleString()} with FDR < 0.05 and a usable normal arm`);
};

main().catch(e => { console.error(String(e?.message || e)); process.exit(1); });
