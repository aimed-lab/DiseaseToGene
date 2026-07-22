// benchmark/goldset.ts ────────────────────────────────────────────────────────
// The GOLD STANDARD (the "answer key") the funnel is graded against: targets that
// already have a KNOWN DRUG for the disease, pulled live from Open Targets (public API,
// no key, reachable off-VPN). These are the genes a good ranking should surface near the
// top; the benchmark asks "did the funnel dig them back up?".
//
// ⚠ LEAKAGE CAVEAT (handled in benchmark.ts, restated here so it's not forgotten):
// gold = "has a clinical drug" and the funnel's `tractability` axis = ChEMBL max-phase,
// so that axis partly ENCODES the label. The harness holds `tractability` out (weight 0)
// for the headline/fit numbers and reports the with-tractability value only as a leaky
// upper bound. So this gold set is honest ONLY with that hold-out — never quote the leaky
// number as the result.

import * as fs from 'node:fs';

const OT = 'https://api.platform.opentargets.org/api/v4/graphql';

async function otFetch(query: string, variables: Record<string, unknown>): Promise<any> {
  const r = await fetch(OT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`Open Targets HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error('OT: ' + String(j.errors?.[0]?.message || 'error').slice(0, 160));
  return j.data;
}

const looksLikeOntologyId = (s: string) => /^(EFO|MONDO|HP|Orphanet|DOID|NCIT|GO)[_:]/i.test(s.trim());
const normId = (s: string) => s.trim().replace(':', '_'); // OT wants EFO_0002618, not EFO:0002618

// Resolve a disease name (or verify an id) → { id, name } via OT search.
export async function resolveDiseaseId(nameOrId: string): Promise<{ id: string; name: string }> {
  if (looksLikeOntologyId(nameOrId)) {
    const id = normId(nameOrId);
    try {
      const d = await otFetch(`query($id:String!){ disease(efoId:$id){ id name } }`, { id });
      if (d?.disease?.id) return { id: d.disease.id, name: d.disease.name };
    } catch { /* fall through to search */ }
  }
  const d = await otFetch(
    `query($q:String!){ search(queryString:$q, entityNames:["disease"], page:{index:0,size:1}){ hits { id name } } }`,
    { q: nameOrId },
  );
  const hit = d?.search?.hits?.[0];
  if (!hit?.id) throw new Error(`Could not resolve disease "${nameOrId}" on Open Targets`);
  return { id: hit.id, name: hit.name };
}

export interface GoldSet {
  id: string;
  name: string;
  symbols: Set<string>;      // UPPER-CASE target symbols hit by a drug developed for this disease
  knownDrugRows: number;     // drug-indication rows scanned (for provenance)
}

// All targets hit by a drug DEVELOPED (approved or in trials) for the disease. Source:
// OT `disease.drugAndClinicalCandidates` → each drug's `mechanismsOfAction` → its targets.
// One query, no pagination (OT returns the full candidate list). This is more robust than
// the association-datatype route: narrow disease nodes (e.g. MONDO_0006047, pancreatic
// adenocarcinoma) carry NO `known_drug` datatype, yet still have hundreds of trial drugs
// here. Passing a broader disease id via --efo widens the answer key.
export async function fetchKnownDrugTargets(efoId: string): Promise<Omit<GoldSet, 'name'>> {
  const q = `query($id:String!){
    disease(efoId:$id){
      id
      drugAndClinicalCandidates{
        count
        rows {
          maxClinicalStage
          drug { mechanismsOfAction { rows { targets { approvedSymbol } } } }
        }
      }
    }
  }`;
  const d: any = await otFetch(q, { id: efoId });
  const rows: any[] = d?.disease?.drugAndClinicalCandidates?.rows ?? [];
  const symbols = new Set<string>();
  for (const r of rows) {
    for (const m of (r?.drug?.mechanismsOfAction?.rows ?? [])) {
      for (const t of (m?.targets ?? [])) {
        const sym = t?.approvedSymbol;
        if (sym) symbols.add(String(sym).toUpperCase());
      }
    }
  }
  return { id: efoId, symbols, knownDrugRows: rows.length };
}

// A user-supplied gold list (one symbol per line, or first CSV column). Lets Dr. Chen
// override the OT set with a curated answer key. Blank lines and a `gene`/`symbol` header
// are skipped.
export function loadGoldFromFile(path: string): Set<string> {
  const text = fs.readFileSync(path, 'utf-8');
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const cell = (line.split(/[,\t;]/)[0] || '').trim();
    if (!cell || /^(gene|symbol|gene_symbol|name|target)$/i.test(cell)) continue;
    if (/^[A-Za-z0-9.\-]{2,20}$/.test(cell)) out.add(cell.toUpperCase());
  }
  return out;
}
