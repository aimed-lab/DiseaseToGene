// scripts/buildModalityGoldset.ts ────────────────────────────────────────────
// Derive the modality gold set SYSTEMATICALLY from ChEMBL, instead of curating it
// by hand.
//
// Why this exists: the benchmark's recall set was 20 hand-picked textbook targets
// (EGFR, KRAS, BCL2 …). Scoring 100% on those says nothing a reviewer will accept,
// because the targets were chosen by the same people who wrote the rules. The
// objection is not "20 is too few" — it is "you picked them". The only answer is a
// set nobody picked: every approved drug ChEMBL has curated a mechanism for, mapped
// to (gene, modality, goal) by fixed rules, with the mapping written down.
//
//   npx tsx scripts/buildModalityGoldset.ts
//   → data/modality_goldset.json
//
// Source: ChEMBL `mechanism` records at max_phase 4 (approved). ChEMBL curates these
// from labels and primary literature, so the target/action assignment is not ours.
//
// THREE THINGS THIS DELIBERATELY DROPS, so the set stays defensible:
//   1. Molecule types our taxonomy cannot express (protein/enzyme/cell/gene therapy,
//      vaccines, oligosaccharides). Mapping insulin or a vaccine antigen onto one of
//      our 12 modalities would be a guess, and a wrong row is worse than a missing one.
//   2. Action types that are not a mechanistic goal (BINDING AGENT, MODULATOR,
//      SUBSTRATE, CHELATING AGENT, NONE …). "Modulator" does not say which direction.
//   3. Targets that are not a single human protein or a single human transcript
//      (complexes, families, other organisms). A protein family has no one
//      localization or pocket, so the rules cannot be asked about it honestly.
//      NUCLEIC-ACID targets ARE kept: ChEMBL files antisense and siRNA drugs against
//      "Transthyretin mRNA" rather than TTR, and dropping those would remove almost
//      every RNA-modality row — the rows this benchmark most needs.
// Every drop is counted and reported, so the coverage claim can be audited.

import * as fs from 'node:fs';
import * as path from 'node:path';

const UA = { 'User-Agent': 'Disease2Target/1.0 (academic research; contact via app)' };
const BASE = 'https://www.ebi.ac.uk/chembl/api/data';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJSON(url: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status}`);
    } catch (e) { if (i === tries - 1) throw e; }
    await sleep(600 * (i + 1));
  }
  throw new Error('unreachable');
}

// ── The mapping, stated once ────────────────────────────────────────────────
// action_type → mechanistic goal. Anything not listed is dropped, not guessed.
const GOAL_OF_ACTION: Record<string, string> = {
  // loss of function: the drug engages the target and turns it down
  'INHIBITOR': 'inhibit', 'ANTAGONIST': 'inhibit', 'BLOCKER': 'inhibit',
  'NEGATIVE ALLOSTERIC MODULATOR': 'inhibit', 'NEGATIVE MODULATOR': 'inhibit',
  'ALLOSTERIC ANTAGONIST': 'inhibit', 'INVERSE AGONIST': 'inhibit',
  'DISRUPTING AGENT': 'inhibit', 'SEQUESTERING AGENT': 'inhibit',
  // gain of function
  'AGONIST': 'restore_function', 'PARTIAL AGONIST': 'restore_function',
  'POSITIVE ALLOSTERIC MODULATOR': 'restore_function', 'POSITIVE MODULATOR': 'restore_function',
  'ACTIVATOR': 'restore_function', 'OPENER': 'restore_function', 'STABILISER': 'restore_function',
  // lowering the amount of target, rather than engaging the protein
  'ANTISENSE INHIBITOR': 'reduce_level', 'RNAI INHIBITOR': 'reduce_level',
  // induced degradation
  'DEGRADER': 'degrade',
};

// molecule_type → the modality substring the benchmark matches on. Only the
// unambiguous three; see the header for what is dropped and why.
const MODALITY_OF_TYPE: Record<string, string> = {
  'Small molecule': 'SM',
  'Antibody': 'Antibody',
  'Oligonucleotide': 'RNA',
};

// ENSG -> approved symbol, for ChEMBL's transcript targets. Open Targets is already
// this project's identity source, and there are only a handful of these.
const ensCache = new Map<string, string>();
async function symbolOfEnsembl(ensg: string): Promise<string> {
  if (ensCache.has(ensg)) return ensCache.get(ensg)!;
  try {
    const r = await fetch('https://api.platform.opentargets.org/api/v4/graphql', {
      method: 'POST',
      // OT 403s a request with no User-Agent (Node sends none) - see modalityService.ts.
      headers: { 'content-type': 'application/json', ...UA },
      body: JSON.stringify({ query: 'query($id:String!){ target(ensemblId:$id){ approvedSymbol } }', variables: { id: ensg } }),
    });
    const j: any = await r.json();
    const sym = j?.data?.target?.approvedSymbol || '';
    ensCache.set(ensg, sym);
    return sym;
  } catch { return ''; }
}

interface Row {
  gene: string; uniprot: string; modality: string; goal: string;
  drug: string; drug_chembl: string; target_chembl: string;
  action_type: string; molecule_type: string; mechanism: string;
}

async function pageAll(endpoint: string, key: string, params: string): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const d = await getJSON(`${BASE}/${endpoint}.json?${params}&limit=1000&offset=${offset}`);
    const batch = d[key] || [];
    out.push(...batch);
    if (batch.length < 1000) break;
    await sleep(150);
  }
  return out;
}

/** Fetch by id in chunks — the `__in` filter keeps this to a few dozen calls. */
async function byIds(endpoint: string, key: string, field: string, ids: string[], chunk = 40): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const d = await getJSON(`${BASE}/${endpoint}.json?${field}__in=${slice.join(',')}&limit=1000`);
    for (const rec of d[key] || []) map.set(rec[field], rec);
    process.stdout.write(`\r  ${endpoint}: ${map.size}/${ids.length}   `);
    await sleep(120);
  }
  process.stdout.write('\n');
  return map;
}

const run = async () => {
  console.log('Deriving the modality gold set from ChEMBL approved-drug mechanisms.\n');

  console.log('1/4  mechanisms (max_phase=4)…');
  const mechs = await pageAll('mechanism', 'mechanisms', 'max_phase=4');
  console.log(`     ${mechs.length} approved-drug mechanism records`);

  const molIds = [...new Set(mechs.map(m => m.molecule_chembl_id).filter(Boolean))] as string[];
  const tgtIds = [...new Set(mechs.map(m => m.target_chembl_id).filter(Boolean))] as string[];
  console.log(`     ${molIds.length} distinct drugs · ${tgtIds.length} distinct targets\n`);

  console.log('2/4  molecule types…');
  const mols = await byIds('molecule', 'molecules', 'molecule_chembl_id', molIds);

  console.log('3/4  targets → gene symbols…');
  const tgts = await byIds('target', 'targets', 'target_chembl_id', tgtIds);

  console.log('4/4  joining and mapping…');
  const drop = { action: 0, moleculeType: 0, targetKind: 0, noGene: 0, oligoUnmappable: 0 };
  const rows: Row[] = [];

  for (const m of mechs) {
    const goal = GOAL_OF_ACTION[String(m.action_type || '').toUpperCase()];
    if (!goal) { drop.action++; continue; }

    const mol = mols.get(m.molecule_chembl_id);
    let modality = MODALITY_OF_TYPE[String(mol?.molecule_type || '')];
    if (!modality) { drop.moleculeType++; continue; }

    // Oligonucleotides are not one modality. A splice-switching ASO does NOT knock the
    // transcript down, so grading it as knockdown asks the engine the wrong question —
    // the same error the restore_function goal was added to fix.
    //
    // ChEMBL does not say "splice". It says "SMN2 pre-mRNA positive modulator" and
    // "Dystrophin pre-mRNA positive modulator" (nusinersen, eteplirsen). An oligo acting
    // on PRE-mRNA to positively modulate it is splice modulation by construction: you
    // cannot raise functional protein by degrading the transcript.
    const moa = String(m.mechanism_of_action || '');
    if (modality === 'RNA') {
      if (/splic|exon.?skip|pre-?mrna/i.test(moa)) modality = 'Splice';
      else if (goal === 'restore_function' || goal === 'degrade') {
        // An oligonucleotide that ACTIVATES a protein (ChEMBL files defibrotide as a
        // "Plasminogen activator") is none of our RNA modalities. Dropping it is the
        // same rule as everywhere else here: a row we cannot map honestly is worse
        // than a missing one.
        drop.oligoUnmappable++; continue;
      }
    }

    const t = tgts.get(m.target_chembl_id);
    const kindOk = (t?.target_type === 'SINGLE PROTEIN' || t?.target_type === 'NUCLEIC-ACID');
    if (!kindOk || t?.organism !== 'Homo sapiens') { drop.targetKind++; continue; }

    const comp = (t.target_components || [])[0];
    // Protein targets carry a GENE_SYMBOL synonym. Transcript targets carry an Ensembl
    // gene id instead (CHEMBL4296221 "Transthyretin mRNA" -> ENSG00000118271), so those
    // are resolved through Open Targets.
    let gene = (comp?.target_component_synonyms || [])
      .find((s: any) => s.syn_type === 'GENE_SYMBOL')?.component_synonym;
    if (!gene && /^ENSG\d+$/.test(String(comp?.accession || ''))) {
      gene = await symbolOfEnsembl(String(comp.accession));
    }
    if (!gene) { drop.noGene++; continue; }

    rows.push({
      gene: String(gene).toUpperCase(), uniprot: comp?.accession || '',
      modality, goal, drug: mol?.pref_name || m.molecule_chembl_id,
      drug_chembl: m.molecule_chembl_id, target_chembl: m.target_chembl_id,
      action_type: m.action_type, molecule_type: mol.molecule_type, mechanism: moa,
    });
  }

  // One row per (gene, modality, goal) — many drugs share a target and mechanism.
  const byKey = new Map<string, Row & { drugs: string[] }>();
  for (const r of rows) {
    const k = `${r.gene}|${r.modality}|${r.goal}`;
    const hit = byKey.get(k);
    if (hit) { if (!hit.drugs.includes(r.drug)) hit.drugs.push(r.drug); }
    else byKey.set(k, { ...r, drugs: [r.drug] });
  }
  const pairs = [...byKey.values()].sort((a, b) => a.gene.localeCompare(b.gene) || a.modality.localeCompare(b.modality));

  const genes = new Set(pairs.map(p => p.gene));
  const byModality = pairs.reduce<Record<string, number>>((a, p) => (a[p.modality] = (a[p.modality] || 0) + 1, a), {});
  const byGoal = pairs.reduce<Record<string, number>>((a, p) => (a[p.goal] = (a[p.goal] || 0) + 1, a), {});

  const out = {
    generated_from: 'ChEMBL mechanism records, max_phase=4 (approved)',
    generator: 'scripts/buildModalityGoldset.ts',
    mechanisms_scanned: mechs.length,
    dropped: drop,
    n_pairs: pairs.length,
    n_genes: genes.size,
    by_modality: byModality,
    by_goal: byGoal,
    goal_of_action: GOAL_OF_ACTION,
    modality_of_type: MODALITY_OF_TYPE,
    pairs,
  };

  const dest = path.join(process.cwd(), 'data', 'modality_goldset.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));

  console.log(`\n── derived gold set ──`);
  console.log(`  ${pairs.length} (gene, modality, goal) pairs over ${genes.size} genes`);
  console.log(`  by modality: ${JSON.stringify(byModality)}`);
  console.log(`  by goal    : ${JSON.stringify(byGoal)}`);
  console.log(`  dropped    : ${JSON.stringify(drop)}`);
  console.log(`\n  → ${dest}`);
};

run().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
