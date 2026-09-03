// test.js — smoke test (no MCP client needed).
//   node test.js            connectivity + every tool once, against the live bridge
//   node test.js --quick    connectivity only
// Loads server.js with the stdio transport disabled and calls the tool handlers directly.

process.env.D2T_MCP_NO_LISTEN = '1';
import * as ords from './ords.js';
const { __tools: tools } = await import('./server.js');

const quick = process.argv.includes('--quick');
const t0 = Date.now();
const lap = (m) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const head = (r, n = 6) => String(r.content?.[0]?.text || '').split('\n').filter(Boolean).slice(0, n).join('\n    ');
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

console.log(`ORDS base: ${ords.baseUrl()}\n`);

const snaps = await ords.listSnapshots();
if (!snaps.length) fail('No snapshots returned — check ORDS_BASE_URL / network.');
const latest = [...snaps].sort((a, b) => Number(b.id) - Number(a.id))[0];
lap(`snapshots: ${snaps.length} · latest #${latest.id} v${latest.version} — ${latest.disease_name} (${latest.gene_count} genes)`);
if (quick) { console.log('\nOK — bridge reachable.'); process.exit(0); }

const args = { snapshot_id: latest.id };
const call = async (name, a) => { const r = await tools[name](a); if (r.isError) fail(`${name}: ${r.content[0].text}`); return r; };

let r = await call('list_diseases', {});
lap(`list_diseases\n    ${head(r, 4)}`);

r = await call('rank_targets', { ...args, top_n: 5 });
lap(`rank_targets\n    ${head(r, 5)}`);

r = await call('rank_board', { ...args, top_n: 5 });
if (!/Board rank/.test(r.content[0].text)) fail('rank_board did not render the board');
lap(`rank_board (first call pulls the full evidence set)\n    ${head(r, 8)}`);

const sc = await ords.listRankingScores(latest.id);
const topGene = [...sc].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))[0].gene_symbol;
r = await call('get_target_dossier', { ...args, gene: topGene });
if (!/Board rank/.test(r.content[0].text)) fail('dossier has no board standing');
lap(`get_target_dossier ${topGene}\n    ${head(r, 6)}`);

r = await call('get_network_context', { gene: topGene, snapshot_id: latest.id });
lap(`get_network_context ${topGene}\n    ${head(r, 5)}`);

r = await call('get_network_neighbors', { ...args, gene: topGene, limit: 5 });
lap(`get_network_neighbors ${topGene}\n    ${head(r, 5)}`);

r = await call('find_novel_tractable', { ...args, limit: 5 });
lap(`find_novel_tractable\n    ${head(r, 6)}`);

r = await call('get_clinical_trials', { ...args, gene: topGene });
lap(`get_clinical_trials ${topGene}\n    ${head(r, 3)}`);

r = await call('get_snapshot_provenance', args);
lap(`get_snapshot_provenance\n    ${head(r, 6)}`);

console.log('\nOK — every tool answered against live data.');
process.exit(0);
