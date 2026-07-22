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
  fetchCohortMutations, fetchDruggability, fetchClinical, fetchLiterature, fetchPubmedLiterature, resolveCbioStudy, resolveDiseaseScope,
} from '../evidenceProviders.ts';

const OT = 'https://api.platform.opentargets.org/api/v4/graphql';
const DRY = process.argv.includes('--dry');
const AXES = ['expression', 'dependency', 'safety', 'mutation', 'druggability', 'clinical', 'literature'] as const;

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const toNum = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// #4 expression guardrails. The reference is log2(TPM+0.001); genes NOT expressed in normal
// tissue sit at the pseudocount floor (normal_median = log2(0.001) = -9.966), so any tumour
// signal yields a huge, denominator-driven log2FC (e.g. LINC01224: normal -9.966 → log2FC 6.9).
// Flag those low-confidence and cap the stored magnitude (the axis already saturates at |4|).
const LOW_EXPR_FLOOR = -9.9;   // normal_median at/below this ≈ zero normal expression (artifact-prone)
const EXPR_LOG2FC_CAP = 10;    // clamp stored |log2FC| (axis is |log2FC|/4 clamped to 1 regardless)

// Literature denominator guard. velocity = recent/total; below this many papers the ratio is
// quantised noise (2 papers -> only 0, 0.5 or 1 are possible), so the axis is nulled instead.
export const MIN_LIT_PAPERS = 5;

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
  const PAGE = 50; const targets: any[] = []; const seen = new Set<string>(); let count = 0;   // #2: dedupe symbols
  for (let page = 0; targets.length < geneCount; page++) {
    const data = await otFetch(
      `query($id:String!,$size:Int!,$page:Int!){ disease(efoId:$id){ associatedTargets(page:{index:$page,size:$size}){ count rows{ score target{ approvedSymbol approvedName } datatypeScores{ id score } } } } }`,
      { id: dis.id, size: PAGE, page });
    const at = data?.disease?.associatedTargets; if (!at) break;
    count = at.count || count;
    const rows = at.rows || []; if (!rows.length) break;
    for (const r of rows) {
      if (targets.length >= geneCount) break;
      const sym = r.target?.approvedSymbol;
      if (!sym) continue;
      // #2: OT returns one row per Ensembl target; several Ensembl IDs can share an approvedSymbol
      // (e.g. P2RY8, pseudoautosomal). Rows are score-desc, so keep the FIRST (highest-scored) per symbol.
      if (seen.has(sym.toUpperCase())) continue;
      seen.add(sym.toUpperCase());
      const t: any = { symbol: sym, name: r.target?.approvedName, overallScore: r.score, getScore: r.score };
      for (const ds of (r.datatypeScores || [])) { const k = DT_MAP[ds.id]; if (k) t[k] = ds.score; }
      targets.push(t);
    }
    if (page % 10 === 0) log(`Fetched ${targets.length}/${Math.min(geneCount, count || geneCount)} genes…`);
  }
  if (!targets.length) throw new Error('No associated targets returned');
  log(`Fetched ${targets.length} genes from Open Targets.`);
  if (DRY) { log(`--dry: would save snapshot for ${dis.name} with ${targets.length} genes (top: ${targets.slice(0, 8).map(t => t.symbol).join(', ')})`); return; }
  const svc = await oracle();
  log(`Saving ${targets.length} genes to Oracle (row-by-row — this takes ~1–3 min, please wait, do NOT run the next command yet)…`);
  const res = await svc.saveSnapshot({ disease_id: dis.id, disease_name: dis.name, label: 'CLI harvest', gene_count: targets.length, targets, provenance: { source: 'Open Targets associatedTargets', via: 'scripts/d2t.ts' }, created_by: 'cli' });
  log(`✔✔✔ SAVED snapshot #${res.id} (v${res.version}) — ${targets.length} genes.`);
  log(`     Next: npx tsx --env-file=.env scripts/d2t.ts enrich ${res.id} mutation   (use the number ${res.id})`);
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
async function buildAxis(axis: string, genes: string[], diseaseName: string, diseaseId: string): Promise<any[]> {
  const pancreatic = /pancrea|pdac|paad|ductal adenocarcinoma/i.test(diseaseName || '');
  const rows: any[] = [];

  if (axis === 'expression') {
    if (!pancreatic) { log('expression: disease not pancreatic — no reference; skipping'); return rows; }
    const ex = loadRef('expression_paad.json');
    for (const g of genes) { const d = ex?.genes?.[g]; if (!d) continue; const log2fc = toNum(d.log2fc); const a = log2fc != null ? clamp01(Math.abs(log2fc) / 4) : null; const up = (log2fc ?? 0) >= 0;
      // #5: direction reflects the SIGN of log2FC (over- vs under-expression), not a constant 'pro'.
      // #4: flag genes whose |log2FC| is driven by a near-zero normal-tissue denominator (the shared
      //     floor) as low-confidence, and cap the magnitude so a denominator artifact can't dominate.
      const normalFloored = LOW_EXPR_FLOOR != null && toNum(d.normal_median) != null && toNum(d.normal_median)! <= LOW_EXPR_FLOOR;
      const cappedLog2fc = log2fc != null ? Math.max(-EXPR_LOG2FC_CAP, Math.min(EXPR_LOG2FC_CAP, log2fc)) : null;
      const axisCapped = cappedLog2fc != null ? clamp01(Math.abs(cappedLog2fc) / 4) : null;
      rows.push({ gene_symbol: g, evidence_type: 'expression_tvn', source: ex.meta?.source || 'UCSC Xena Toil (TCGA-PAAD vs GTEx)', value_text: `${up ? 'up' : 'down'} log2FC ${log2fc}${normalFloored ? ' (low-confidence: normal floor)' : ''}`, value_json: { axis: axisCapped, direction: up ? 'pro' : 'con', display: `${up ? 'up' : 'down'} log2FC ${log2fc} (p ${d.p})${normalFloored ? ' · low-confidence' : ''}`, log2fc, log2fc_capped: cappedLog2fc, low_confidence: normalFloored, p: d.p, tumor_median: d.tumor_median, normal_median: d.normal_median } }); }
  } else if (axis === 'dependency') {
    if (!pancreatic) { log('dependency: disease not pancreatic — no reference; skipping'); return rows; }
    const dp = loadRef('depmap_pancreatic.json');
    for (const g of genes) { const d = dp?.genes?.[g]; if (!d) continue; const mean = toNum(d.mean); const a = mean != null ? clamp01(-mean) : null;
      rows.push({ gene_symbol: g, evidence_type: 'dependency', source: dp.meta?.source || 'DepMap CRISPR (Chronos, Pancreas)', value_text: `Chronos ${mean}`, value_json: { axis: a, direction: 'pro', display: `Chronos ${mean}${d.frac_dependent != null ? ` · ${Math.round(d.frac_dependent * 100)}% lines` : ''}`, mean, min: d.min, frac_dependent: d.frac_dependent, n_lines: d.n_lines } }); }
  } else if (axis === 'safety') {
    let n = 0;
    await pooled(genes, 6, async g => { const c = await gnomadConstraint(g); if (!c || (c.pli == null && c.loeuf == null)) return;
      // #7: gnomAD LOEUF (oe_lof_upper) is bounded ~[0,2]; anything above is an artifact (e.g. SSX1=4.93).
      // Drop the absurd value rather than store it (the axis would clamp it to 0 anyway).
      const loeuf = c.loeuf != null && c.loeuf <= 3 ? c.loeuf : null;
      const concern = loeuf != null ? clamp01(1 - loeuf / 1.5) : (c.pli != null ? clamp01(c.pli) : 0);
      rows.push({ gene_symbol: g, evidence_type: 'safety', source: 'gnomAD v4', value_text: `pLI ${c.pli} · LOEUF ${loeuf}`, value_json: { axis: concern, direction: 'con', display: `pLI ${c.pli != null ? c.pli.toFixed(2) : '—'} · LOEUF ${loeuf != null ? loeuf.toFixed(2) : '—'}`, pli: c.pli, loeuf } });
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
    await pooled(genes, 5, async g => { const d = await fetchDruggability(g).catch(() => null); if (!d) return;  // null = not-fetched → skip (3-state)
      rows.push({ gene_symbol: g, evidence_type: 'druggability', source: 'Open Targets (drugAndClinicalCandidates + tractability)', value_text: `${d.label}${d.total_compounds ? ` · ${d.total_compounds} drugs` : ''}${d.tractable_modalities ? ` · ${d.tractable_modalities} tractable` : ''}`, value_json: { axis: clamp01(d.score), direction: 'pro', label: d.label, display: `${d.label}${d.total_compounds ? ` · ${d.total_compounds} developed drug${d.total_compounds === 1 ? '' : 's'}` : ''}${d.tractable_modalities ? ` · ${d.tractable_modalities} tractable modalit${d.tractable_modalities === 1 ? 'y' : 'ies'}` : ''}`, score: d.score, total_compounds: d.total_compounds, target_max_phase: d.target_max_phase, proven_modalities: d.proven_modalities, tractable_modalities: d.tractable_modalities, ensembl_id: d.target_chembl_id, best_ic50_nm: d.best_ic50_nm } });
      if (++n % 250 === 0) log(`  druggability ${n}/${genes.length}…`); });
  } else if (axis === 'clinical') {
    // #3: disease-scoped, gene-attributed via the OT target→drug→trial graph (not CT.gov text search).
    const scope = await resolveDiseaseScope(diseaseId, diseaseName);
    log(`  clinical: disease scope = ${scope.ids.size} ontology ids (hints: ${scope.nameHints.join(', ') || 'none'})`);
    let n = 0;
    await pooled(genes, 5, async g => { const c = await fetchClinical(g, scope).catch(() => null); if (!c || c.n_drugs_in_disease_trials === 0) return;   // 0 = no clinical precedent (neutral, not stored)
      const phaseTxt = c.max_disease_trial_phase ? ` · max Phase ${c.max_disease_trial_phase}` : '';
      rows.push({ gene_symbol: g, evidence_type: 'clinical', source: 'Open Targets (target drug trials, disease-scoped)', value_text: `${c.n_drugs_in_disease_trials} drug${c.n_drugs_in_disease_trials === 1 ? '' : 's'} in trials${phaseTxt}`, value_json: { axis: c.axis, direction: 'pro', display: `${c.n_drugs_in_disease_trials} drug${c.n_drugs_in_disease_trials === 1 ? '' : 's'} in ${diseaseName} trials${phaseTxt}`, trial_count: c.trial_count, max_phase: c.max_phase, n_drugs_in_disease_trials: c.n_drugs_in_disease_trials, max_disease_trial_phase: c.max_disease_trial_phase, drug_names: c.drug_names } });
      if (++n % 500 === 0) log(`  clinical ${n}/${genes.length}…`); });
  } else if (axis === 'literature') {
    let n = 0;
    await pooled(genes, 5, async g => {
      const [pm, ep] = await Promise.all([fetchPubmedLiterature(g, diseaseName).catch(() => null), fetchLiterature(g, diseaseName).catch(() => null)]);
      // PubMed = ANNOTATION ONLY (axis null, role 'annotation'). It is more precise per paper
      // ([Gene Name] tagging) but is rate-limited and returns ~20x fewer papers, so its velocity
      // sits on a tiny denominator (2 papers -> velocity can only be 0/0.5/1 = quantised noise).
      // Scoring off it made genes incomparable: for the SAME gene PubMed and EPMC velocity
      // differed by ~0.28 on a 0-1 axis. One corpus scores; the other annotates.
      if (pm && pm.paper_count > 0) rows.push({ gene_symbol: g, evidence_type: 'literature', source: 'PubMed', value_text: `${pm.paper_count} papers${pm.recent_count ? ` · ${pm.recent_count} recent` : ''} (annotation)`, value_json: { axis: null, role: 'annotation', direction: 'pro', display: `${pm.paper_count} papers · ${Math.round(pm.velocity * 100)}% in last 3y (annotation, not scored)`, paper_count: pm.paper_count, recent_count: pm.recent_count, velocity: pm.velocity } });
      // Europe PMC = THE SINGLE SCORING SOURCE for the literature axis (one consistent corpus).
      // Denominator guard: below MIN_LIT_PAPERS the velocity ratio is unstable, so score null
      // and flag low_confidence rather than emit noise (same rule as the expression floor).
      if (ep && ep.paper_count > 0) {
        const thin = ep.paper_count < MIN_LIT_PAPERS;
        rows.push({ gene_symbol: g, evidence_type: 'literature_epmc', source: 'Europe PMC', value_text: `${ep.paper_count} papers${ep.recent_count ? ` · ${ep.recent_count} recent` : ''}${thin ? ' (low-confidence: few papers)' : ''}`, value_json: { axis: thin ? null : clamp01(ep.velocity), role: 'scoring', low_confidence: thin, direction: 'pro', display: `${ep.paper_count} papers · ${Math.round(ep.velocity * 100)}% in last 3y${thin ? ' · low-confidence' : ''}`, paper_count: ep.paper_count, recent_count: ep.recent_count, velocity: ep.velocity } });
      }
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
    const rows = await buildAxis(axis, genes, diseaseName, diseaseId);
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

// ════════════════════════════ LIST ════════════════════════════
async function list() {
  const svc = await oracle();
  const snaps = await svc.listSnapshots();
  log(`Snapshots (newest first) — use the # as the snapshot id:`);
  for (const s of (snaps as any[]).slice(0, 15))
    console.log(`  #${String(s.id).padEnd(5)} v${s.version}  ${String(s.disease_name).padEnd(34)} ${String(s.gene_count).padStart(5)} genes  ${s.created_at}`);
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
    const snapId = (v: string | undefined): number => {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`snapshot id must be a number — you passed "${v}". Run \`harvest\` first (without --dry); it prints "Saved snapshot #NN". Use that number here.`);
      return n;
    };
    if (cmd === 'harvest') { if (!a) throw new Error('usage: harvest "<disease>" [geneCount]'); await harvest(a, Number(b) || 7500); }
    else if (cmd === 'enrich') { if (!a || !b) throw new Error('usage: enrich <snapshotId> <axis|all>'); await enrich(snapId(a), b); }
    else if (cmd === 'status') { if (!a) throw new Error('usage: status <snapshotId>'); await status(snapId(a)); }
    else if (cmd === 'list') { await list(); }
    else { console.log('Commands:\n  list                             show all snapshots + their ids\n  harvest "<disease>" [geneCount]  create a snapshot\n  enrich <snapshotId> <axis|all>   (axes: ' + AXES.join(', ') + ')\n  status <snapshotId>              per-axis coverage\n  add --dry to any command to skip the Oracle write'); }
  } catch (e: any) { console.error('ERROR:', e?.message || e); process.exit(1); }
  process.exit(0);
})();
