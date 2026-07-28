// test.js — connectivity smoke test (no MCP client needed).
//   node test.js
// Verifies the ORDS bridge is reachable and the read layer returns data.

import * as ords from './ords.js';

console.log(`ORDS base: ${ords.baseUrl()}\n`);

const snaps = await ords.listSnapshots();
console.log(`snapshots: ${snaps.length}`);
const latest = [...snaps].sort((a, b) => Number(b.id) - Number(a.id))[0];
if (!latest) { console.error('No snapshots returned — check ORDS_BASE_URL / network.'); process.exit(1); }
console.log(`latest:    #${latest.id} v${latest.version} — ${latest.disease_name} (${latest.gene_count} genes)\n`);

const sc = await ords.listRankingScores(latest.id);
console.log(`scores for #${latest.id}: ${sc.length}`);
const top = [...sc].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, 5);
console.log('top 5:     ' + top.map((r) => `${r.gene_symbol}(${(r.get_score ?? r.overall_score ?? 0).toFixed(2)})`).join(', ') + '\n');

const ev = await ords.evidenceForGene(top[0].gene_symbol);
const forSnap = ev.filter((r) => Number(r.snapshot_id) === Number(latest.id));
console.log(`evidence for ${top[0].gene_symbol} in #${latest.id}: ${forSnap.length} rows (${[...new Set(forSnap.map((r) => r.evidence_type))].join(', ')})`);

console.log('\nOK — the MCP server has live data to serve.');
