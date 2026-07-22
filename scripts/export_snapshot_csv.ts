/* scripts/export_snapshot_csv.ts ────────────────────────────────────────────────
 * Download a snapshot's EVIDENCE + RANKING_SCORES to CSV for offline verification.
 * Pulls over the PUBLIC ORDS REST bridge (works off-VPN — no Oracle connection needed).
 *
 *   npx tsx scripts/export_snapshot_csv.ts 84
 *   npx tsx scripts/export_snapshot_csv.ts 84 --out exports
 *   ORDS_BASE_URL=https://.../apex/d2towner npx tsx scripts/export_snapshot_csv.ts 84
 *
 * Writes into ./exports (or --out DIR):
 *   snapshot_<id>_evidence.csv   raw EVIDENCE rows (value_json intact) — the whole table
 *   snapshot_<id>_wide.csv       one row per gene, the values the funnel reads (joined w/ scores)
 * -------------------------------------------------------------------------------- */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildFunnelGenes, type ScoreRow, type EvidenceRow } from '../benchmark/adapter.ts';

const BASE = (process.env.ORDS_BASE_URL || 'https://aimed.uab.edu/apex/d2towner').replace(/\/+$/, '');
const MODULE = 'd2t';
const PAGE = 500;

async function ordsGetAll(pathSeg: string): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  for (;;) {
    const url = `${BASE}/${MODULE}/${pathSeg}?limit=${PAGE}&offset=${offset}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`ORDS GET ${pathSeg} → ${r.status}`);
    const j: any = await r.json();
    const items: any[] = Array.isArray(j.items) ? j.items : [];
    all.push(...items);
    process.stdout.write(`\r  ${pathSeg}: ${all.length} rows…`);
    if (!j.hasMore || items.length === 0) break;
    offset += items.length;
  }
  process.stdout.write('\n');
  return all;
}

// RFC-4180-ish CSV cell: quote when it contains comma, quote, or newline; double internal quotes.
const cell = (v: any): string => {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (headers: string[], rows: any[][]): string =>
  [headers.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\n') + '\n';

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isFinite(id)) { console.error('usage: export_snapshot_csv.ts <snapshotId> [--out DIR]'); process.exit(1); }
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx >= 0 ? process.argv[outIdx + 1] : 'exports';
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Downloading snapshot #${id} from ${BASE}/${MODULE} …`);
  const [scores, evidence] = await Promise.all([
    ordsGetAll(`snapshots/${id}/scores`) as Promise<ScoreRow[]>,
    ordsGetAll(`snapshots/${id}/evidence`) as Promise<EvidenceRow[]>,
  ]);
  if (!evidence.length && !scores.length) { console.error(`No data for snapshot #${id}. Check the id.`); process.exit(2); }

  // 1) RAW evidence — the whole EVIDENCE table, value_json kept as-is.
  const rawHeaders = ['gene_symbol', 'evidence_type', 'source', 'value_text', 'value_json'];
  const rawRows = evidence.map(e => rawHeaders.map(h => (e as any)[h]));
  const rawPath = path.join(outDir, `snapshot_${id}_evidence.csv`);
  fs.writeFileSync(rawPath, toCsv(rawHeaders, rawRows));

  // 2) WIDE per-gene — exactly the fields the funnel reads (via the same adapter the benchmark uses).
  const genes = buildFunnelGenes(scores, evidence);
  const rankOf = new Map<string, any>();
  for (const s of scores) rankOf.set(String((s as any).gene_symbol).toUpperCase(), (s as any).rank);
  const wideHeaders = ['gene_symbol', 'rank', 'otOverall', 'geneticAssoc', 'frequency', 'log2fc', 'chronos', 'loeuf', 'drugLabel', 'trialCount', 'velocity', 'tissueTau'];
  const wideRows = genes.map(g => [
    g.gene_symbol, rankOf.get(g.gene_symbol.toUpperCase()) ?? '', g.otOverall, g.geneticAssoc,
    g.frequency, g.log2fc, g.chronos, g.loeuf, g.drugLabel, g.trialCount, g.velocity, g.tissueTau,
  ]);
  const widePath = path.join(outDir, `snapshot_${id}_wide.csv`);
  fs.writeFileSync(widePath, toCsv(wideHeaders, wideRows));

  console.log(`\n✔ ${evidence.length.toLocaleString()} evidence rows → ${rawPath}`);
  console.log(`✔ ${genes.length.toLocaleString()} genes → ${widePath}`);
}

main().catch(e => { console.error('\nexport failed:', e?.message || e); process.exit(1); });
