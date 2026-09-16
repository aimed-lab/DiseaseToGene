// scripts/auditSnapshot.ts — is the data in a snapshot legitimate?
//
//   npx tsx --env-file=.env scripts/auditSnapshot.ts <snapshotId> [--sample N] [--seed S] [--raw]
//
// Two parts, independent of the harvester's own code:
//   A. Internal consistency over EVERY row — ranks contiguous, stored score ordered, no
//      duplicate (gene, type, source), value_json parses, every scored axis in [0, 1], every
//      evidence row belongs to a scored gene, known tumour-vs-normal biology where a cohort
//      has a reference list.
//   B. A seeded random sample of genes re-derived from the SOURCES with this script's own
//      queries: Open Targets association + drug candidates (GraphQL), cBioPortal mutated
//      samples (REST), gnomAD constraint (GraphQL), Europe PMC counts (same query the axis
//      uses), and — with --raw — DepMap Chronos and GTEx tau recomputed from the raw files on
//      disk rather than the built tables.
//
// PASS / WARN / FAIL per check; exits 1 on any FAIL. Drift in live counts (literature grows)
// is a WARN, never a FAIL. Written for the RC cloud runbook: run it after every harvest.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { getSnapshot, listRankingScores, snapshotEvidence, closeOraclePool } from '../oracleService.ts';
import { resolveCbioStudy, cleanDiseaseName } from '../evidenceProviders.ts';

const argv = process.argv.slice(2);
const SNAP = Number(argv[0]);
if (!Number.isInteger(SNAP) || SNAP <= 0) { console.error('usage: auditSnapshot.ts <snapshotId> [--sample N] [--seed S] [--raw]'); process.exit(2); }
const flag = (n: string, d: string | null = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] ?? d : d; };
const SAMPLE = Number(flag('--sample', '15'));
const RAW = argv.includes('--raw');
let seed = Number(flag('--seed', String(20260916)));
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ROOT = process.cwd();

// Known tumour-vs-normal biology per cohort: genes whose direction any correct expression
// axis must reproduce. Add a cohort when its reference table exists.
const KNOWN_EXPRESSION: Record<string, Array<[string, 'up' | 'down']>> = {
  MONDO_0006047: [['KRT19', 'up'], ['S100P', 'up'], ['LAMC2', 'up'], ['PNLIP', 'down'], ['CPA1', 'down'], ['PRSS1', 'down']],   // pancreatic adenocarcinoma
  MONDO_0018177: [['EGFR', 'up'], ['TOP2A', 'up'], ['MKI67', 'up'], ['GABRA1', 'down'], ['SNAP25', 'down']],                     // glioblastoma vs normal brain
};

const J = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 1) : Math.abs(a - b) / b);
let pass = 0, warn = 0, fail = 0;
const out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };
const ok = (s: string) => { pass++; say('PASS  ' + s); };
const wn = (s: string) => { warn++; say('WARN  ' + s); };
const bad = (s: string) => { fail++; say('FAIL  ' + s); };
const gj = async (url: string, init?: any) => {
  const r = await fetch(url, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Disease2Target-audit/1.0 (academic research)', ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`${url.replace(/\?.*$/, '')} → ${r.status}`);
  return r.json();
};
const otq = (query: string, variables: any) => gj('https://api.platform.opentargets.org/api/v4/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) }).then(d => d.data);
const pad = (g: string) => g.padEnd(10);

(async () => {
  const snap = await getSnapshot(SNAP);
  if (!snap) { console.error(`snapshot #${SNAP} not found`); process.exit(2); }
  const MONDO = String(snap.disease_id || '');
  const DISEASE = String(snap.disease_name || '');
  const study = resolveCbioStudy(DISEASE);
  say(`audit of snapshot #${SNAP} · ${DISEASE} (${MONDO}) · ${new Date().toISOString()}`);

  const scores = await listRankingScores(SNAP);
  const ev = await snapshotEvidence(SNAP);
  const bySym = new Map<string, any[]>();
  for (const r of ev) { r.vj = J(r.value_json); (bySym.get(r.gene_symbol) ?? bySym.set(r.gene_symbol, []).get(r.gene_symbol)!).push(r); }
  const row = (g: string, t: string) => bySym.get(g)?.find(r => r.evidence_type === t);

  say(`\n== A. internal consistency — ${scores.length} score rows, ${ev.length} evidence rows`);
  const ranks = scores.map((s: any) => Number(s.rank));
  const contiguous = new Set(ranks).size === scores.length && Math.min(...ranks) === 1 && Math.max(...ranks) === scores.length;
  (contiguous ? ok : bad)(`ranks 1..${scores.length} unique and contiguous`);
  let inv = 0; for (let i = 1; i < scores.length; i++) if (Number(scores[i].overall_score) > Number(scores[i - 1].overall_score) + 1e-9) inv++;
  (inv === 0 ? ok : bad)(`stored Open Targets score is non-increasing with rank (${inv} inversions)`);
  const scoreSet = new Set(scores.map((s: any) => s.gene_symbol));
  const orphans = ev.filter((r: any) => !scoreSet.has(r.gene_symbol));
  (orphans.length === 0 ? ok : bad)(`every evidence row belongs to a scored gene (${orphans.length} orphans${orphans.length ? ': ' + [...new Set(orphans.map((r: any) => `${r.gene_symbol}/${r.evidence_type}`))].slice(0, 10).join(', ') : ''})`);
  const keys = new Set<string>(); let dup = 0;
  for (const r of ev) { const k = `${r.gene_symbol}|${r.evidence_type}|${r.source}`; if (keys.has(k)) dup++; keys.add(k); }
  (dup === 0 ? ok : bad)(`no duplicate (gene, type, source) rows (${dup})`);
  const unparsable = ev.filter((r: any) => r.value_json && r.vj == null).length;
  (unparsable === 0 ? ok : bad)(`value_json parses on every row (${unparsable} unparsable)`);
  const SCORED = ['expression_tvn', 'proteomics', 'dependency', 'safety', 'tissue', 'mutation', 'druggability', 'clinical', 'literature_epmc', 'network'];
  for (const t of SCORED) {
    const rows = ev.filter((r: any) => r.evidence_type === t);
    if (!rows.length) { wn(`${t.padEnd(16)} no rows in this snapshot`); continue; }
    const outside = rows.filter((r: any) => r.vj && r.vj.axis != null && !(r.vj.axis >= 0 && r.vj.axis <= 1)).length;
    const nul = rows.filter((r: any) => !r.vj || r.vj.axis == null).length;
    (outside === 0 ? ok : bad)(`${t.padEnd(16)} ${String(rows.length).padStart(5)} rows · axis in [0,1] (${outside} outside) · ${nul} unscored`);
  }
  const known = KNOWN_EXPRESSION[MONDO];
  if (known) {
    say(`\n== A2. known biology on the expression axis`);
    for (const [g, want] of known) {
      const v = row(g, 'expression_tvn')?.vj; const lf = v?.log2fc ?? null;
      const dir = lf == null ? null : lf > 0 ? 'up' : 'down';
      (dir == null ? wn : dir === want ? ok : bad)(`${pad(g)} expected ${want}, stored log2FC ${lf == null ? '(no row)' : Number(lf).toFixed(2)}`);
    }
  }

  // ── B. sample ──
  const pool = scores.map((s: any) => s.gene_symbol);
  const sample = new Set<string>(scores.slice(0, 3).map((s: any) => s.gene_symbol));   // the top three always
  while (sample.size < Math.min(SAMPLE, pool.length)) sample.add(pool[Math.floor(rnd() * pool.length)]);
  const genes = [...sample];
  say(`\n== B. sample of ${genes.length} (seed ${flag('--seed', '20260916')}): ${genes.join(', ')}`);

  say(`\n-- B1. Open Targets association score (stored overall_score vs live)`);
  const ensembl = new Map<string, string>();
  for (const g of genes) {
    try {
      const d = await otq(`query($id:String!,$f:String!){ disease(efoId:$id){ associatedTargets(BFilter:$f, page:{index:0,size:10}){ rows{ score target{ approvedSymbol id } } } } }`, { id: MONDO, f: g });
      const r = d?.disease?.associatedTargets?.rows?.find((x: any) => x.target.approvedSymbol === g);
      const stored = Number(scores.find((s: any) => s.gene_symbol === g)?.overall_score);
      if (!r) { wn(`${pad(g)} not returned by the live filter (stored ${stored.toFixed(4)})`); continue; }
      ensembl.set(g, r.target.id);
      (near(r.score, stored, 0.02) ? ok : wn)(`${pad(g)} live ${r.score.toFixed(4)} · stored ${stored.toFixed(4)}`);
    } catch (e: any) { wn(`${pad(g)} Open Targets: ${e.message}`); }
  }

  say(`\n-- B2. Open Targets drug candidates (stored druggability row vs live)`);
  for (const g of genes) {
    const ens = ensembl.get(g); const dr = row(g, 'druggability');
    if (!ens || !dr) { wn(`${pad(g)} skipped (${!ens ? 'no ensembl id' : 'no druggability row'})`); continue; }
    try {
      const d = await otq(`query($e:String!){ target(ensemblId:$e){ drugAndClinicalCandidates{ rows{ drug{ id } } } } }`, { e: ens });
      const live = new Set((d?.target?.drugAndClinicalCandidates?.rows || []).map((x: any) => x.drug?.id)).size;
      const stored = dr.vj?.total_compounds ?? null;
      (stored == null ? wn : near(live, stored, Math.max(1, 0.15 * live)) ? ok : wn)(`${pad(g)} live ${live} drugs · stored ${stored} · "${String(dr.value_text).slice(0, 40)}"`);
    } catch (e: any) { wn(`${pad(g)} Open Targets: ${e.message}`); }
  }

  if (study) {
    say(`\n-- B3. cBioPortal mutated samples (${study.id})`);
    let total = 0;
    try { total = (await gj(`https://www.cbioportal.org/api/sample-lists/${study.id}_sequenced`)).sampleIds.length; ok(`sequenced samples live ${total}`); } catch (e: any) { wn(`sample list: ${e.message}`); }
    for (const g of genes) {
      const mr = row(g, 'mutation');
      try {
        const gene = await gj(`https://www.cbioportal.org/api/genes/${encodeURIComponent(g)}`);
        const muts = await gj(`https://www.cbioportal.org/api/molecular-profiles/${study.id}_mutations/mutations?sampleListId=${study.id}_sequenced&entrezGeneId=${gene.entrezGeneId}&projection=SUMMARY&pageSize=10000`);
        const live = new Set(muts.map((m: any) => m.sampleId)).size;
        if (!mr) { (live === 0 ? ok : bad)(`${pad(g)} no stored row · live ${live} mutated${live ? ' ← should have a row' : ' (correct)'}`); continue; }
        (mr.vj?.mutated_samples === live && mr.vj?.total_samples === total ? ok : wn)(`${pad(g)} live ${live}/${total} · stored ${mr.vj?.mutated_samples}/${mr.vj?.total_samples}`);
      } catch (e: any) { wn(`${pad(g)} cBioPortal: ${e.message}`); }
    }
  } else say(`\n-- B3. cBioPortal: no study mapped for "${DISEASE}" — skipped`);

  say(`\n-- B4. gnomAD v4 constraint (stored safety row vs live)`);
  for (const g of genes) {
    const sr = row(g, 'safety');
    try {
      const d = await gj('https://gnomad.broadinstitute.org/api', { method: 'POST', body: JSON.stringify({ query: `{ gene(gene_symbol:${JSON.stringify(g)}, reference_genome: GRCh38){ gnomad_constraint{ pli oe_lof_upper } } }` }) });
      const c = d?.data?.gene?.gnomad_constraint;
      if (!sr) { (c ? wn : ok)(`${pad(g)} no stored row · live ${c ? `pLI ${Number(c.pli).toFixed(3)} LOEUF ${Number(c.oe_lof_upper).toFixed(3)} ← table gap` : 'no constraint (correct)'}`); }
      else if (!c) wn(`${pad(g)} stored pLI ${sr.vj?.pli} LOEUF ${sr.vj?.loeuf} · live has no record`);
      else (near(c.oe_lof_upper, sr.vj?.loeuf, 0.01) && near(c.pli, sr.vj?.pli, 0.01) ? ok : wn)(`${pad(g)} live pLI ${Number(c.pli).toFixed(3)} LOEUF ${Number(c.oe_lof_upper).toFixed(3)} · stored ${Number(sr.vj?.pli).toFixed(3)} / ${Number(sr.vj?.loeuf).toFixed(3)}`);
    } catch (e: any) { wn(`${pad(g)} gnomAD: ${e.message}`); }
    await new Promise(r => setTimeout(r, 300));
  }

  say(`\n-- B5. Europe PMC paper count (same query as the axis; drift is expected to be small)`);
  const clean = cleanDiseaseName(DISEASE);
  for (const g of genes) {
    const lr = row(g, 'literature_epmc');
    try {
      const d = await gj(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`${g} AND "${clean}"`)}&format=json&resultType=idlist&pageSize=1`);
      const live = Number(d.hitCount); const stored = lr?.vj?.paper_count ?? null;
      if (!lr) { (live === 0 ? ok : wn)(`${pad(g)} no stored row · live ${live}`); continue; }
      (pct(live, stored) <= 0.05 || Math.abs(live - stored) <= 3 ? ok : wn)(`${pad(g)} live ${live} · stored ${stored} (${(100 * pct(live, stored)).toFixed(1)}% drift)`);
    } catch (e: any) { wn(`${pad(g)} Europe PMC: ${e.message}`); }
  }

  if (RAW) {
    say(`\n-- B6. DepMap Chronos recomputed from depmap_raw/`);
    try {
      const dep = row(genes.find(g => row(g, 'dependency')) || '', 'dependency');
      const lineage = String(dep?.source || '').match(/·\s*([A-Za-z/ ]+?)(?:\s+lineage)?$/)?.[1]?.trim().toLowerCase() || '';
      const models = new Set<string>(); let mh: string[] | null = null;
      for await (const line of readline.createInterface({ input: fs.createReadStream(path.join(ROOT, 'depmap_raw/Model.csv')), crlfDelay: Infinity })) {
        const c = line.split(','); if (!mh) { mh = c; continue; }
        const li = mh.findIndex(h => /OncotreeLineage/i.test(h));
        if (lineage && String(c[li] || '').toLowerCase().includes(lineage)) models.add(c[0]);
      }
      ok(`lineage "${lineage}": ${models.size} models in Model.csv`);
      const want = new Set(genes); const col = new Map<string, number>(); const vals = new Map<string, number[]>(); let head = true;
      for await (const line of readline.createInterface({ input: fs.createReadStream(path.join(ROOT, 'depmap_raw/CRISPRGeneEffect.csv')), crlfDelay: Infinity })) {
        if (head) { head = false; line.split(',').forEach((h, i) => { const s = h.split(' ')[0]; if (want.has(s)) col.set(s, i); }); continue; }
        if (!models.has(line.slice(0, line.indexOf(',')))) continue;
        const c = line.split(',');
        for (const [g, i] of col) { const v = parseFloat(c[i]); if (Number.isFinite(v)) (vals.get(g) ?? vals.set(g, []).get(g)!).push(v); }
      }
      for (const g of genes) {
        const r = row(g, 'dependency'); const v = vals.get(g);
        if (!v?.length) { (r ? wn : ok)(`${pad(g)} not in the raw matrix${r ? ' but has a stored row' : ' and no stored row (correct)'}`); continue; }
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        if (!r) { wn(`${pad(g)} raw mean ${mean.toFixed(4)} but no stored row`); continue; }
        (near(mean, r.vj?.mean, 0.002) && v.length === r.vj?.n_lines ? ok : wn)(`${pad(g)} raw ${mean.toFixed(4)} (n=${v.length}) · stored ${r.vj?.mean} (n=${r.vj?.n_lines})`);
      }
    } catch (e: any) { wn(`DepMap raw check skipped: ${e.message}`); }

    say(`\n-- B7. GTEx tau recomputed from gtex_raw/`);
    try {
      const want = new Set(genes); const found = new Map<string, number[]>(); let n = 0;
      for await (const line of readline.createInterface({ input: fs.createReadStream(path.join(ROOT, 'gtex_raw/gtex_v8_gene_median_tpm.gct.gz')).pipe(zlib.createGunzip()), crlfDelay: Infinity })) {
        n++; if (n <= 3) continue; const t = line.split('\t'); if (want.has(t[1])) found.set(t[1], t.slice(2).map(Number));
      }
      const tau = (values: number[]) => { const x = values.map(v => Math.log2((v > 0 ? v : 0) + 1)); const max = Math.max(...x); if (!(max > 0)) return null; return x.reduce((a, v) => a + (1 - v / max), 0) / (x.length - 1); };
      for (const g of genes) {
        const r = row(g, 'tissue'); const v = found.get(g); const t = v ? tau(v) : null;
        if (t == null) { (r ? wn : ok)(`${pad(g)} not in GTEx / unexpressed${r ? ' but has a stored row' : ' and no stored row (correct)'}`); continue; }
        if (!r) { wn(`${pad(g)} raw tau ${t.toFixed(4)} but no stored row`); continue; }
        (near(t, r.vj?.tau, 0.002) ? ok : wn)(`${pad(g)} raw tau ${t.toFixed(4)} · stored ${r.vj?.tau}`);
      }
    } catch (e: any) { wn(`GTEx raw check skipped: ${e.message}`); }
  } else say(`\n(B6/B7 raw-file recomputation: add --raw; needs depmap_raw/ and gtex_raw/ on disk)`);

  say(`\n== ${pass} PASS · ${warn} WARN · ${fail} FAIL`);
  try { fs.mkdirSync(path.join(ROOT, 'runs'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'runs', `${SNAP}.audit.txt`), out.join('\n') + '\n'); say(`written runs/${SNAP}.audit.txt`); } catch { /* read-only checkout */ }
  await closeOraclePool();
  process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERROR', e?.message || e); await closeOraclePool().catch(() => {}); process.exit(2); });
