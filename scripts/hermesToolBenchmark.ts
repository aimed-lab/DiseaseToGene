// ── Hermes tool-calling benchmark ─────────────────────────────────────────────
// PLEASER ignores request-level tool declarations, so D2T describes its tools in
// the prompt and parses the reply. That makes tool routing a MODEL property to be
// measured, not a capability to be assumed — this script measures it.
//
//   npx tsx --env-file=.env scripts/hermesToolBenchmark.ts
//
// Two parts: offline parser cases (no network), then live routing against Hermes
// using the SAME renderToolSpec output the server sends, so the benchmark cannot
// drift from the thing it certifies. Requires PLEASER_BASE_URL / PLEASER_TOKEN
// and the UAB network or Tailscale.
//
// Measured 2026-08-21: glm-air 11/11 live, 10/10 parser. best-reasoning routed 1/4
// in an earlier probe — it knows its own PLEASER toolset and replies that these
// tools "don't exist here". Only models in HERMES_TOOL_MODELS get tools at all.
import { renderToolSpec, parseHermesToolCall, HERMES_TOOL_PROTOCOL } from '../server.js';
import * as h from '../hermesService.js';

const T = { OBJECT:'OBJECT', STRING:'STRING', ARRAY:'ARRAY', NUMBER:'NUMBER', BOOLEAN:'BOOLEAN' };
// Mirrors the live client tool array in index.tsx, DESCRIPTIONS INCLUDED. Keep
// these in sync with that array — the spec the model sees is what is measured here.
const CLIENT_TOOLS = [
  { name:'focus_gene', description:'Open the detail view for one gene. Only works for genes already in the Target List.', parameters:{ type:T.OBJECT, properties:{ symbol:{type:T.STRING} }, required:['symbol'] } },
  { name:'update_view', description:'Switch the main view. board = Target Ranking Board; dashboard = data-quality explorer; funnel = prioritisation funnel; graph = knowledge graph; rankings = ranking dashboard; list = target list.', parameters:{ type:T.OBJECT, properties:{ mode:{type:T.STRING, enum:['board','dashboard','list','funnel','rankings','graph','enrichment']} }, required:['mode'] } },
  { name:'dashboard_sort', description:'Sort the dashboard grid by a column.', parameters:{ type:T.OBJECT, properties:{ column:{type:T.STRING, enum:['rank','score','n_drugs','velocity','tissue_tau']}, direction:{type:T.STRING, enum:['asc','desc']} }, required:['column'] } },
  { name:'dashboard_filter', description:'Apply the dashboard evidence chips. novel_tractable = druggable but no drug or trial; tissue_restricted = GTEx tau >= 0.6; antibody_reachable = surface or secreted. Pass chips to set the whole set, toggle to flip one, reset to clear.', parameters:{ type:T.OBJECT, properties:{ chips:{type:T.ARRAY, items:{type:T.STRING, enum:['novel_tractable','in_trials','no_precedent','has_drugs','tissue_restricted']}}, reset:{type:T.BOOLEAN} } } },
  { name:'set_weights', description:'Change the GET scoring weights (0-1 each) and rescore the Target List.', parameters:{ type:T.OBJECT, properties:{ genetic:{type:T.NUMBER}, expression:{type:T.NUMBER}, target:{type:T.NUMBER}, velocity:{type:T.NUMBER} } } },
  { name:'compare_targets', description:'Compare named genes side by side across their evidence.', parameters:{ type:T.OBJECT, properties:{ symbols:{type:T.ARRAY, items:{type:T.STRING}} }, required:['symbols'] } },
];
const DATA_TOOLS = [
  { name:'get_gene_evidence', description:'All stored evidence for ONE gene: mutation, expression, dependency, clinical, literature.', parameters:{ type:T.OBJECT, properties:{ gene:{type:T.STRING} }, required:['gene'] } },
  { name:'get_clinical_trials', description:'Per-trial clinical records for a gene: NCT id, phase, status, sponsor.', parameters:{ type:T.OBJECT, properties:{ gene:{type:T.STRING} }, required:['gene'] } },
  { name:'find_novel_tractable', description:'Druggable targets with NO developed drug and NO disease trial yet.', parameters:{ type:T.OBJECT, properties:{ limit:{type:T.NUMBER} } } },
];

const SYS = `You are the DiseaseToTarget co-pilot.
GLOSSARY: tau = GTEx tissue-specificity, 0-1, >=0.6 is tissue-restricted. WINNER score is a network PREDICTION, not evidence. GET score = 50% genetic + 25% expression + 25% target.`;
const PREAMBLE = SYS + '\n' + HERMES_TOOL_PROTOCOL + renderToolSpec([...CLIENT_TOOLS, ...DATA_TOOLS]);

const CASES: [string, string][] = [
  ['open the enrichment view',                    'update_view'],
  ['show me KRAS',                                'focus_gene'],
  ['sort by tissue tau descending',               'dashboard_sort'],
  // Worded to name the dashboard chip. "filter to novel tractable targets" is
  // genuinely ambiguous — the model answered it with find_novel_tractable, which
  // is a defensible reading, so it is not a useful routing test.
  ['apply the novel tractable chip on the dashboard', 'dashboard_filter'],
  ['put 70% weight on genetics',                  'set_weights'],
  ['compare TP53, EGFR and BRAF',                 'compare_targets'],
  ['what evidence do we have for PHGDH?',         'get_gene_evidence'],
  ['what trials exist for SRC?',                  'get_clinical_trials'],
  ['which targets are druggable but undrugged?',  'find_novel_tractable'],
  ['what does tau mean?',                         'NO_TOOL'],
  ['should I trust the WINNER score?',            'NO_TOOL'],
];
const known = new Set([...CLIENT_TOOLS, ...DATA_TOOLS].map(t => t.name));


// ── Part 1: parser cases, offline ─────────────────────────────────────────────
const PARSER_CASES: [string, string, string | null][] = [
  ['clean call',             '{"tool":"focus_gene","args":{"symbol":"KRAS"}}',                          'focus_gene'],
  ['call with prose around', 'Sure, opening it.\n{"tool":"focus_gene","args":{"symbol":"TP53"}}',       'focus_gene'],
  ['fenced call',            '```json\n{"tool":"update_view","args":{"mode":"funnel"}}\n```',          'update_view'],
  ['plain prose',            'Tau is the GTEx tissue-specificity index, ranging 0 to 1.',               null],
  ['prose with braces',      'The formula is score = {genetic*0.5} + {expr*0.25}, so higher is better.', null],
  ['unknown tool',           '{"tool":"delete_everything","args":{}}',                                  null],
  ['malformed json',         '{"tool":"focus_gene","args":{symbol:KRAS}',                               null],
  ['no args key',            '{"tool":"get_gene_evidence"}',                                            'get_gene_evidence'],
  // Regression: glm-air emitted this verbatim, with a stray trailing brace.
  ['stray trailing brace',   '{"tool":"get_gene_evidence","args":{"gene":"PHGDH"}}}',                    'get_gene_evidence'],
  ['brace inside a string',  '{"tool":"focus_gene","args":{"symbol":"A}B"}}',                            'focus_gene'],
];

const runParser = (known: Set<string>): boolean => {
  console.log('=== parser (offline) ===');
  let pass = 0;
  for (const [label, input, want] of PARSER_CASES) {
    const got = parseHermesToolCall(input, known)?.name ?? null;
    const ok = got === want;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(22)} want ${String(want).padEnd(18)} got ${String(got)}`);
  }
  console.log(`parser: ${pass}/${PARSER_CASES.length}
`);
  return pass === PARSER_CASES.length;
};

const run = async () => {
  const parserOk = runParser(new Set([...CLIENT_TOOLS, ...DATA_TOOLS].map(t => t.name)));

  // PLEASER is campus-only, so being unreachable is an ordinary condition, not a
  // crash. Skip the live half and still report the offline result rather than
  // losing it to an unhandled rejection.
  try {
    await h.listModels();
  } catch (e: any) {
    console.log('=== live routing: SKIPPED ===');
    console.log(`PLEASER unreachable (${e?.message || e}).`);
    console.log('Needs the UAB network or Tailscale. Offline parser result above still stands.');
    process.exit(parserOk ? 0 : 1);
  }

  console.log('=== live routing (glm-air) ===');
  let pass = 0; const fails: string[] = [];
  for (const [q, want] of CASES) {
    const id = await h.createChat('D2T live tool test');
    try {
      const raw = await h.sendMessage(id, `${PREAMBLE}\n\n--- The user's question follows. ---\n\n${q}`, 'glm-air');
      const name = parseHermesToolCall(raw, known)?.name ?? 'NO_TOOL';
      const ok = name === want;
      if (ok) pass++; else fails.push(`"${q}" want ${want} got ${name} :: ${raw.replace(/\s+/g,' ').slice(0,150)}`);
      console.log(`${ok ? 'PASS' : 'FAIL'} ${want.padEnd(20)} <- "${q}"`);
    } finally { await h.deleteChat(id); }
  }
  console.log(`\nglm-air with the REAL rendered spec: ${pass}/${CASES.length}`);
  if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log(' - ' + f)); }
  process.exit(parserOk && pass === CASES.length ? 0 : 1);
};
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
