/* scripts/d2t.ts ──────────────────────────────────────────────────────────────
 * CLI for the Disease2Target pipeline — harvest a snapshot and enrich its axes
 * WITHOUT the web server or a browser. Writes straight to Oracle. Idempotent per
 * axis. Run one axis at a time so a failure only costs that axis.
 *
 * Requires: UAB VPN + Oracle creds in .env (ORACLE_USER/PASSWORD/CONNECT_STRING,
 * USE_ORACLE_STORE not needed for the CLI). Run with tsx so it loads .env:
 *
 *   # 1) create a fresh snapshot from Open Targets
 *   npx tsx --env-file=.env scripts/d2t.ts harvest "pancreatic adenocarcinoma" 7500
 *
 *   # 2) enrich axes ONE AT A TIME (fast ones first). <id> = the snapshot from step 1
 *   npx tsx --env-file=.env scripts/d2t.ts enrich <id> expression
 *   npx tsx --env-file=.env scripts/d2t.ts enrich <id> dependency
 *   npx tsx --env-file=.env scripts/d2t.ts enrich <id> safety
 *   npx tsx --env-file=.env scripts/d2t.ts enrich <id> mutation
 *   npx tsx --env-file=.env scripts/d2t.ts enrich <id> druggability
 *   npx tsx --env-file=.env scripts/d2t.ts enrich <id> clinical
 *   npx tsx --env-file=.env scripts/d2t.ts enrich <id> literature
 *   # …or all at once:  enrich <id> all
 *
 *   # check per-axis coverage
 *   npx tsx --env-file=.env scripts/d2t.ts status <id>
 *
 *   # test the fetching only, no Oracle write:  add --dry
 *   npx tsx --env-file=.env scripts/d2t.ts enrich <id> mutation --dry
 *
 * Run unattended (survives closing the terminal) — Windows PowerShell:
 *   Start-Process -WindowStyle Hidden npx "tsx --env-file=.env scripts/d2t.ts enrich <id> druggability"
 * or just leave the terminal open with sleep disabled (powercfg /change standby-timeout-ac 0).
 * ---------------------------------------------------------------------------- */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  fetchCohortMutations, fetchDruggability, fetchClinical, fetchLiterature, fetchPubmedLiterature, resolveCbioStudy,
} from '../evidenceProviders.ts';

const OT = 'https://api.platform.opentargets.org/api/v4/graphql';
const DRY = process.argv.includes('--dry');
const AXES = ['expression', 'dependency', 'safety', 'mutation', 'druggability', 'clinical', 'literature'] as const;

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const toNum = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Oracle write layer — imported lazily so `--dry` and `status` don't need a connection at parse time.
async function oracle() { return import('../oracleService.ts'); }

// ── reference tables (local) ──
const refCache = new Map<string, any>();
const loadRef = (file: string) => {
  if (refCache.has(file)) return refCache.get(file);
  let p: any = null; try { p = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', file), 'utf-8')); } catch { p = null; }
  refCache.set(file, p); return p;
};

async function otFetch(query: string, variables: any): Promise<any> {
  const r = await fetch(OT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error('OT: ' + String(j.errors?.[0]?.message || 'error').slice(0, 160));
  return j.data;
}

// gnomAD constraint — local table first, API fallback (same as the server).
async function gnomadConstraint(symbol: string): Promise<{ pli: number | null; loeuf: number | null } | null> {
  const tbl = loadRef('gnomad_constraint.json');
  const hit = tbl?.genes?.[symbol];
  if (hit) return { pli: toNum(hit.pli), loeuf: toNum(hit.loeuf) };
  try {
    const r = await fetch('https://gnomad.broadinstitute.org/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query($s:String!){ gene(gene_symbol:$s, reference_genome:GRCh38){ gnomad_constraint{ pLI oe_lof_upper } } }', variables: { s: symbol } }),
    });
    const c = (await r.json())?.data?.gene?.gnomad_constraint;
    return c ? { pli: toNum(c.pLI), loeuf: toNum(c.oe_lof_upper) } : null;
  } catch { return null; }
}

// run fn over items with bounded concurrency
async function pooled<T, R>(items: T[], conc: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  const workers = Array.from({ length: conc }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  });
  await Promise.all(workers); return out;
}

// ════════════════════════════ HARVEST ════════════════════════════
const DT_MAP: Record<string, string> = { genetic_association: 'geneticScore', rna_expression: 'expressionScore', literature: 'literatureScore', known_drug: 'targetScore' };

async function resolveDisease(query: string): Promise<{ id: string; name: string }> {
  const d = await otFetch(`query($q:String!){ search(queryString:$q, entityNames:["disease"]){ hits{ id name } } }`, { q: query });
  const hit = d?.search?.hits?.[0];
  if (!hit) throw new Error(`No disease matched "${query}"`);
  return { id: hit.id, name: hit.name };
}

async function harvest(query: string, geneCount: number) {
  log(`Resolving disease "${query}"…`);
  const dis = await resolveDisease(query);
  log(`Disease: ${dis.name} (${dis.id}) · target ${geneCount} genes`);
  const PAGE = 50; const targets: any[] = []; let count = 0;
  for (let page = 0; targets.length < geneCount; page++) {
    const data = await otFetch(
      `query($id:String!,$size:Int!,$page:Int!){ disease(efoId:$id){ associatedTargets(page:{index:$page,size:$size}){ count rows{ score target{ approvedSymbol approvedName } datatypeScores{ id score } } } } }`,
      { id: dis.id, size: PAGE, page });
    const at = data?.disease?.associatedTargets; if (!at) break;
    count = at.count || count;
    const rows = at.rows || []; if (!rows.length) break;
    for (const r of rows) {
      if (targets.length >= geneCount) break;
      const t: any = { symbol: r.target?.approvedSymbol, name: r.target?.approvedName, overallScore: r.score, getScore: r.score };
      for (const ds of (r.datatypeScores || [])) { const k = DT_MAP[ds.id]; if (k) t[k] = ds.score; }
      if (t.symbol) targets.push(t);
    }
    if (page % 10 === 0) log(`Fetched ${targets.length}/${Math.min(geneCount, count || geneCount)} genes…`);
  }
  if (!targets.length) throw new Error('No associated targets returned');
  log(`Fetched ${targets.length} genes from Open Targets.`);
  if (DRY) { log(`--dry: would save snapshot for ${dis.name} with ${targets.length} genes (top: ${targets.slice(0, 8).map(t => t.symbol).join(', ')})`); return; }
  const svc = await oracle();
  const res = await svc.saveSnapshot({ disease_id: dis.id, disease_name: dis.name, label: 'CLI harvest', gene_count: targets.length, targets, provenance: { source: 'Open Targets associatedTargets', via: 'scripts/d2t.ts' }, created_by: 'cli' });
  log(`✔ Saved snapshot #${res.id} (v${res.version}) — ${targets.length} genes. Now enrich it: scripts/d2t.ts enrich ${res.id} all`);
}

// ════════════════════════════ ENRICH ════════════════════════════
async function loadGenes(snapshotId: number): Promise<{ genes: string[]; diseaseId: string; diseaseName: string }> {
  const svc = await oracle();
  const snap = await svc.getSnapshot(snapshotId);
  if (!snap) throw new Error(`Snapshot #${snapshotId} not found`);
  const scores = await svc.listRankingScores(snapshotId);
  const genes = [...new Set((scores as any[]).map(r => String(r.gene_symbol)).filter(Boolean))];
  return { genes, diseaseId: snap.disease_id, diseaseName: snap.disease_name };
}

// Build the EVIDENCE rows for one axis — SAME shapes the server's enrichAxes writes,
// so the funnel reads CLI-written evidence identically.
async function buildAxis(axis: string, genes: string[], diseaseName: string): Promise<any[]> {
  const pancreatic = /pancrea|pdac|paad|ductal adenocarcinoma/i.test(diseaseName || '');
  const rows: any[] = [];

  if (axis === 'expression') {
    if (!pancreatic) { log('expression: disease not pancreatic — no reference; skipping'); return rows; }
    const ex = loadRef('expression_paad.json');
    for (const g of genes) { const d = ex?.genes?.[g]; if (!d) continue; const log2fc = toNum(d.log2fc); const a = log2fc != null ? clamp01(Math.abs(log2fc) / 4) : null; const up = (log2fc ?? 0) >= 0;
      rows.push({ gene_symbol: g, evidence_type: 'expression_tvn', source: ex.meta?.source || 'UCSC Xena Toil (TCGA-PAAD vs GTEx)', value_text: `${up ? 'up' : 'down'} log2FC ${log2fc}`, value_json: { axis: a, direction: 'pro', display: `${up ? 'up' : 'down'} log2FC ${log2fc} (p ${d.p})`, log2fc, p: d.p, tumor_median: d.tumor_median, normal_median: d.normal_median } }); }
  } else if (axis === 'dependency') {
    if (!pancreatic) { log('dependency: disease not pancreatic — no reference; skipping'); return rows; }
    const dp = loadRef('depmap_pancreatic.json');
    for (const g of genes) { const d = dp?.genes?.[g]; if (!d) continue; const mean = toNum(d.mean); const a = mean != null ? clamp01(-mean) : null;
      rows.push({ gene_symbol: g, evidence_type: 'dependency', source: dp.meta?.source || 'DepMap CRISPR (Chronos, Pancreas)', value_text: `Chronos ${mean}`, value_json: { axis: a, direction: 'pro', display: `Chronos ${mean}${d.frac_dependent != null ? ` · ${Math.round(d.frac_dependent * 100)}% lines` : ''}`, mean, min: d.min, frac_dependent: d.frac_dependent, n_lines: d.n_lines } }); }
  } else if (axis === 'safety') {
    let n = 0;
    await pooled(genes, 6, async g => { const c = await gnomadConstraint(g); if (!c || (c.pli == null && c.loeuf == null)) return; const concern = c.loeuf != null ? clamp01(1 - c.loeuf / 1.5) : (c.pli != null ? clamp01(c.pli) : 0);
      rows.push({ gene_symbol: g, evidence_type: 'safety', source: 'gnomAD v4', value_text: `pLI ${c.pli} · LOEUF ${c.loeuf}`, value_json: { axis: concern, direction: 'con', display: `pLI ${c.pli != null ? c.pli.toFixed(2) : '—'} · LOEUF ${c.loeuf != null ? c.loeuf.toFixed(2) : '—'}`, pli: c.pli, loeuf: c.loeuf } });
      if (++n % 500 === 0) log(`  safety ${n}/${genes.length}…`); });
  } else if (axis === 'mutation') {
    if (!resolveCbioStudy(diseaseName)) { log('mutation: no cBioPortal cohort for this disease; skipping'); return rows; }
    const cohort = await fetchCohortMutations(diseaseName);
    if (!cohort?.size) { log('mutation: no cohort data'); return rows; }
    for (const g of genes) { const d = cohort.get(g); if (!d) continue; const freq = toNum(d.frequency); const pct = freq != null ? Math.round(freq * 100) : null;
      rows.push({ gene_symbol: g, evidence_type: 'mutation', source: `cBioPortal · ${d.study_name}`, value_text: `${pct ?? '?'}% mutated${d.dominant_variant ? ` · ${d.dominant_variant}` : ''}`, value_json: { axis: freq != null ? clamp01(freq) : null, direction: 'pro', display: `${pct ?? '?'}% of cohort${d.dominant_variant ? ` · ${d.dominant_variant}` : ''}`, frequency: freq, mutated_samples: d.mutated_samples, total_samples: d.total_samples, dominant_variant: d.dominant_variant, top_variants: d.top_variants, study_id: d.study_id } }); }
    log(`  mutation: ${rows.length} genes (cohort ${cohort.size})`);
  } else if (axis === 'druggability') {
    let n = 0;
    await pooled(genes, 5, async g => { const d = await fetchDruggability(g).catch(() => null); if (!d) return;
      rows.push({ gene_symbol: g, evidence_type: 'druggability', source: 'ChEMBL', value_text: `${d.label}${d.best_ic50_nm != null ? ` · IC50 ${d.best_ic50_nm} nM` : ''}`, value_json: { axis: clamp01(d.score), direction: 'pro', label: d.label, display: `${d.label}${d.best_ic50_nm != null ? ` · IC50 ${d.best_ic50_nm.toFixed(1)} nM` : ''}`, score: d.score, best_ic50_nm: d.best_ic50_nm, total_compounds: d.total_compounds, target_max_phase: d.target_max_phase, target_drug_count: d.target_drug_count } });
      if (++n % 250 === 0) log(`  druggability ${n}/${genes.length}…`); });
  } else if (axis === 'clinical') {
    let n = 0;
    await pooled(genes, 5, async g => { const c = await fetchClinical(g, diseaseName).catch(() => null); if (!c || c.trial_count === 0) return;
      rows.push({ gene_symbol: g, evidence_type: 'clinical', source: 'ClinicalTrials.gov', value_text: `${c.trial_count} trials${c.max_phase ? ` · Phase ${c.max_phase}` : ''}`, value_json: { axis: clamp01(c.trial_count / 30), direction: 'pro', display: `${c.trial_count} trials${c.max_phase ? ` · max Phase ${c.max_phase}` : ''}`, trial_count: c.trial_count, max_phase: c.max_phase } });
      if (++n % 500 === 0) log(`  clinical ${n}/${genes.length}…`); });
  } else if (axis === 'literature') {
    let n = 0;
    await pooled(genes, 5, async g => {
      const [pm, ep] = await Promise.all([fetchPubmedLiterature(g, diseaseName).catch(() => null), fetchLiterature(g, diseaseName).catch(() => null)]);
      if (pm && pm.paper_count > 0) rows.push({ gene_symbol: g, evidence_type: 'literature', source: 'PubMed', value_text: `${pm.paper_count} papers${pm.recent_count ? ` · ${pm.recent_count} recent` : ''}`, value_json: { axis: clamp01(pm.velocity), direction: 'pro', display: `${pm.paper_count} papers · ${Math.round(pm.velocity * 100)}% in last 3y`, paper_count: pm.paper_count, recent_count: pm.recent_count, velocity: pm.velocity } });
      if (ep && ep.paper_count > 0) rows.push({ gene_symbol: g, evidence_type: 'literature_epmc', source: 'Europe PMC', value_text: `${ep.paper_count} papers${ep.recent_count ? ` · ${ep.recent_count} recent` : ''}`, value_json: { axis: clamp01(ep.velocity), direction: 'pro', display: `${ep.paper_count} papers · ${Math.round(ep.velocity * 100)}% in last 3y`, paper_count: ep.paper_count, recent_count: ep.recent_count, velocity: ep.velocity } });
      if (++n % 500 === 0) log(`  literature ${n}/${genes.length}…`);
    });
  } else throw new Error(`Unknown axis "${axis}" (valid: ${AXES.join(', ')}, all)`);
  return rows;
}

async function enrich(snapshotId: number, axisArg: string) {
  const { genes, diseaseId, diseaseName } = await loadGenes(snapshotId);
  log(`Snapshot #${snapshotId} · ${diseaseName} · ${genes.length} genes`);
  const list = axisArg === 'all' ? [...AXES] : [axisArg];
  for (const axis of list) {
    log(`── axis: ${axis} ──`);
    const rows = await buildAxis(axis, genes, diseaseName);
    log(`${axis}: built ${rows.length} rows`);
    if (!rows.length) { log(`${axis}: nothing to store`); continue; }
    if (DRY) { log(`--dry: would save ${rows.length} ${axis} rows (sample: ${JSON.stringify(rows[0]?.value_json).slice(0, 140)}…)`); continue; }
    const svc = await oracle();
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { const res = await svc.saveAxisEvidence(snapshotId, diseaseId, rows, 'cli', false); log(`✔ ${axis}: saved ${res.count} rows to Oracle`); break; }
      catch (e: any) { const msg = String(e?.message || e).slice(0, 140); if (attempt < 3) { log(`save ${axis} failed (${attempt}/3): ${msg} — retrying in ${8 * attempt}s`); await sleep(8000 * attempt); } else { log(`✖ ${axis}: NOT saved after 3 tries: ${msg} — re-run this axis`); } }
    }
  }
  log('Done.');
}

// ════════════════════════════ STATUS ════════════════════════════
async function status(snapshotId: number) {
  const svc = await oracle();
  const snap = await svc.getSnapshot(snapshotId);
  if (!snap) throw new Error(`Snapshot #${snapshotId} not found`);
  const scores = await svc.listRankingScores(snapshotId);
  const ev = await svc.snapshotEvidence(snapshotId);
  const byType: Record<string, Set<string>> = {};
  for (const r of ev as any[]) (byType[r.evidence_type] ??= new Set()).add(r.gene_symbol);
  log(`Snapshot #${snapshotId} · ${snap.disease_name} · ${scores.length} genes in RANKING_SCORES`);
  log(`EVIDENCE rows: ${(ev as any[]).length}`);
  for (const a of ['expression_tvn', 'dependency', 'safety', 'mutation', 'druggability', 'clinical', 'literature', 'literature_epmc'])
    log(`  ${a.padEnd(16)} ${byType[a]?.size ?? 0} genes`);
}

// ════════════════════════════ main ════════════════════════════
(async () => {
  const [cmd, a, b] = process.argv.slice(2).filter(x => x !== '--dry');
  try {
    if (cmd === 'harvest') { if (!a) throw new Error('usage: harvest "<disease>" [geneCount]'); await harvest(a, Number(b) || 7500); }
    else if (cmd === 'enrich') { if (!a || !b) throw new Error('usage: enrich <snapshotId> <axis|all>'); await enrich(Number(a), b); }
    else if (cmd === 'status') { if (!a) throw new Error('usage: status <snapshotId>'); await status(Number(a)); }
    else { console.log('Commands:\n  harvest "<disease>" [geneCount]\n  enrich <snapshotId> <axis|all>   (axes: ' + AXES.join(', ') + ')\n  status <snapshotId>\n  add --dry to any command to skip the Oracle write'); }
  } catch (e: any) { console.error('ERROR:', e?.message || e); process.exit(1); }
  process.exit(0);
})();
