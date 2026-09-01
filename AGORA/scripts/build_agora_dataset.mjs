// Agora AD nominated targets, joined to the evidence this project already holds.
//
// Deliberately SEPARATE from the benchmark. The published gold set (known drug
// targets) is untouched — this is a dataset for looking at the AMP-AD nominated
// genes through our own evidence, not a validation of anything.
//
//   node --env-file=../.env scripts/build_agora_dataset.mjs
//
// Writes out/agora_ad_evidence.tsv and prints a coverage summary.

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.join(DIR, '..', 'out');
const CACHE = path.join(DIR, '..', 'data');
const SNAP = Number(process.env.AGORA_SNAPSHOT || 103);
const base = (process.env.ORDS_BASE_URL || '').replace(/\/+$/, '');
const AGORA = 'https://agora.adknowledgeportal.org/api/v1/genes/nominated';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
const t0 = Date.now();
const lap = m => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const ords = async (p, q = {}) => {
  const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${base}/d2t/${p}?${qs}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`ORDS ${p} -> ${r.status}`);
  return r.json();
};
const pageAll = async (p, limit = 10000) => {
  const all = [];
  for (let off = 0; ; off += limit) {
    const j = await ords(p, { limit, offset: off });
    const it = j.items || [];
    all.push(...it);
    if (it.length < limit) break;
  }
  return all;
};

console.log(`\nAgora nominated targets x snapshot #${SNAP} evidence\n`);

// ── 1. Agora (cached — it is a slow-moving list, and a frozen copy makes the
//        joined table reproducible rather than "whatever the API said that day") ──
const agFile = path.join(CACHE, 'agora_nominated.json');
let agora;
if (fs.existsSync(agFile) && !process.env.AGORA_REFRESH) {
  agora = JSON.parse(fs.readFileSync(agFile, 'utf8')).items;
  lap(`Agora: ${agora.length} nominated genes (cached copy)`);
} else {
  const r = await fetch(AGORA, { headers: { Accept: 'application/json' } });
  const j = await r.json();
  fs.writeFileSync(agFile, JSON.stringify(j));
  agora = j.items;
  lap(`Agora: ${agora.length} nominated genes (fetched, cached to data/)`);
}

// ── 2. Our ranking + evidence for this disease ──
const scores = await pageAll(`snapshots/${SNAP}/scores`, 5000);
lap(`scores: ${scores.length} genes`);
const evidence = await pageAll(`snapshots/${SNAP}/evidence`);
lap(`evidence: ${evidence.length} rows`);

const byGene = {};
for (const e of evidence) {
  let v = e.value_json;
  try { v = typeof v === 'string' ? JSON.parse(v) : v; } catch { v = null; }
  (byGene[String(e.gene_symbol).toUpperCase()] ??= {})[e.evidence_type] = v || {};
}
const scoreOf = new Map(scores.map(s => [String(s.gene_symbol).toUpperCase(), s]));

// ── 3. Full-interactome WINNER, so nominated genes OUTSIDE this snapshot still
//        get a network score. Optional — skipped with a note if not generated yet. ──
const wFile = path.join(DIR, '..', '..', 'WINNER', 'out', 'winner_full_scores.tsv');
const winner = new Map();
if (fs.existsSync(wFile)) {
  const lines = fs.readFileSync(wFile, 'utf8').split('\n').slice(1);
  for (const l of lines) { const c = l.split('\t'); if (c[0]) winner.set(c[0], { norm: c[1], rank: c[3], deg: c[4] }); }
  lap(`WINNER reference: ${winner.size} genes`);
} else {
  console.log('  WINNER reference not found — run WINNER/scripts/winner_full.mjs first for network columns');
}

// ── 4. Join ──
const num = v => (v == null || !isFinite(v) ? '' : v);
// Upstream field shapes vary by harvest vintage (array, object, string, null),
// so flatten defensively rather than assume — one bad row should not stop the join.
const list = v => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('; ');
  if (typeof v === 'object') return Object.entries(v).filter(([, x]) => x).map(([k]) => k).join('; ');
  return String(v);
};
const COLS = [
  'gene_symbol', 'ensembl_gene_id',
  // Agora
  'total_nominations', 'first_nomination_year', 'nominating_teams', 'input_data', 'validation_details', 'pharos_class',
  // ours — identity
  'in_snapshot', 'our_rank', 'overall_score', 'genetic_score',
  // ours — evidence axes (same fields the dashboard derives)
  'mutation_freq', 'expr_log2fc', 'prot_log2fc', 'chronos', 'frac_dependent', 'loeuf',
  'druggability_score', 'tractability_modalities', 'max_disease_phase', 'n_disease_trials',
  'n_publications', 'velocity', 'tissue_tau', 'target_class', 'is_common_essential', 'surface_or_secreted',
  // network — snapshot-frame then global
  'winner_snapshot', 'rwr_snapshot', 'winner_global', 'winner_global_rank', 'string_degree',
  'axes_with_data',
];

const AXES = ['mutation', 'expression_tvn', 'dependency', 'safety', 'tissue', 'annotation', 'druggability', 'clinical', 'literature_epmc'];
const rows = [];
for (const g of agora) {
  const sym = String(g.hgnc_symbol || '').toUpperCase();
  if (!sym) continue;
  const noms = g.target_nominations || [];
  const years = noms.map(n => n.initial_nomination).filter(Boolean);
  const ev = byGene[sym] || {};
  const sc = scoreOf.get(sym);
  const w = winner.get(sym);
  const drug = ev.druggability, clin = ev.clinical, lit = ev.literature_epmc, ann = ev.annotation;
  const tis = ev.tissue, net = ev.network, mut = ev.mutation, expr = ev.expression_tvn;
  const prot = ev.proteomics, dep = ev.dependency, saf = ev.safety;
  rows.push({
    gene_symbol: sym,
    ensembl_gene_id: g.ensembl_gene_id || '',
    total_nominations: g.total_nominations ?? '',
    first_nomination_year: years.length ? Math.min(...years) : '',
    nominating_teams: [...new Set(noms.map(n => n.team).filter(Boolean))].join('; '),
    input_data: [...new Set(noms.flatMap(n => String(n.input_data || '').split(',').map(s => s.trim())).filter(Boolean))].join('; '),
    validation_details: [...new Set(noms.map(n => n.validation_study_details).filter(Boolean))].join(' | '),
    pharos_class: list(g.druggability?.pharos_class),
    in_snapshot: sc ? 'yes' : 'no',
    our_rank: sc?.rank ?? '',
    overall_score: num(sc?.overall_score ?? sc?.get_score),
    genetic_score: num(sc?.genetic_score),
    mutation_freq: num(mut?.frequency),
    expr_log2fc: num(expr?.log2fc),
    prot_log2fc: num(prot?.log2fc),
    chronos: num(dep?.mean),
    frac_dependent: num(dep?.frac_dependent),
    loeuf: num(saf?.loeuf),
    druggability_score: num(drug?.score),
    tractability_modalities: list(drug?.tractable_modalities),
    max_disease_phase: num(clin?.max_disease_trial_phase),
    n_disease_trials: num(clin?.n_disease_trials),
    n_publications: num(lit?.paper_count),
    velocity: num(lit?.velocity),
    tissue_tau: num(tis?.tau),
    target_class: ann?.target_class ?? '',
    is_common_essential: ann?.is_common_essential ?? '',
    surface_or_secreted: ann?.surface_or_secreted ?? '',
    winner_snapshot: num(net?.winner_score),
    rwr_snapshot: num(net?.rwr_score),
    winner_global: w?.norm ?? '',
    winner_global_rank: w?.rank ?? '',
    string_degree: w?.deg ?? '',
    axes_with_data: AXES.filter(a => ev[a]).length,
  });
}
rows.sort((a, b) => (b.total_nominations - a.total_nominations) || String(a.gene_symbol).localeCompare(b.gene_symbol));

const tsv = COLS.join('\t') + '\n' + rows.map(r => COLS.map(c => String(r[c] ?? '')).join('\t')).join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'agora_ad_evidence.tsv'), tsv);

// ── 5. Coverage summary — what we can and cannot say about these genes ──
const inSnap = rows.filter(r => r.in_snapshot === 'yes');
const withNet = rows.filter(r => r.winner_global !== '');
console.log(`\n=== Coverage ===`);
console.log(`  Agora nominated genes            ${rows.length}`);
console.log(`  ...in snapshot #${SNAP}                ${inSnap.length}  (${(100 * inSnap.length / rows.length).toFixed(0)}%)`);
console.log(`  ...with a global WINNER score    ${withNet.length}  (${(100 * withNet.length / rows.length).toFixed(0)}%)`);
const avgAxes = inSnap.reduce((s, r) => s + r.axes_with_data, 0) / (inSnap.length || 1);
console.log(`  mean evidence axes present       ${avgAxes.toFixed(1)} of ${AXES.length} (for genes in the snapshot)`);

console.log(`\n=== Evidence depth for nominated genes in the snapshot ===`);
for (const a of AXES) {
  const n = inSnap.filter(r => (byGene[r.gene_symbol] || {})[a]).length;
  console.log(`  ${a.padEnd(18)} ${String(n).padStart(4)} / ${inSnap.length}  ${(100 * n / inSnap.length).toFixed(0)}%`);
}

console.log(`\n=== Most-nominated, with our ranking ===`);
console.log('  gene       noms  our rank   teams');
rows.slice(0, 12).forEach(r => console.log(
  `  ${r.gene_symbol.padEnd(10)} ${String(r.total_nominations).padStart(4)}  ${String(r.our_rank || '—').padStart(8)}   ${r.nominating_teams.slice(0, 46)}`));

console.log(`\n  ${rows.length} rows -> out/agora_ad_evidence.tsv\n`);
