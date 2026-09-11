// ── Shared co-pilot tool-routing cases ───────────────────────────────────────
// One definition of the tools and the routing questions, used by BOTH benchmarks:
//
//   scripts/hermesToolBenchmark.ts  — PLEASER, tools described in the prompt
//   scripts/oaiToolBenchmark.ts     — OpenAI / ASAX, native tool_calls
//
// They used to live inside the Hermes script with a comment asking whoever edited
// index.tsx to keep them in sync by hand. Two benchmarks copying the same array is
// how a certification quietly stops describing the thing it certifies, so there is
// now one copy and both import it.
//
// Tool routing is a per-MODEL property, measured rather than assumed. That is not a
// theory: glm-air routed 11/11 on these cases while best-reasoning managed 1/4 on an
// earlier probe — it knew its own PLEASER toolset and replied that these tools "don't
// exist here". Only models that have been measured get tools turned on.
//
// Types are the UPPERCASE Gemini-style names because that is what the server's tool
// definitions use; server.ts::toOpenAiTools lowercases them for OpenAI-compatible
// upstreams. Benchmarks convert with that same exported function, so what is measured
// is what the server sends.
export const T = { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' };

/** Browser ACTION tools — these mutate what is on screen and are executed by the client. */
export const CLIENT_TOOLS = [
  { name: 'focus_gene', description: 'Open the detail view for one gene. Only works for genes already in the Target List.', parameters: { type: T.OBJECT, properties: { symbol: { type: T.STRING } }, required: ['symbol'] } },
  { name: 'update_view', description: 'Switch the main view. board = Target Ranking Board; dashboard = data-quality explorer; funnel = prioritisation funnel; graph = knowledge graph; rankings = ranking dashboard; list = target list.', parameters: { type: T.OBJECT, properties: { mode: { type: T.STRING, enum: ['board', 'dashboard', 'list', 'funnel', 'rankings', 'graph', 'enrichment'] } }, required: ['mode'] } },
  { name: 'dashboard_sort', description: 'Sort the dashboard grid by a column.', parameters: { type: T.OBJECT, properties: { column: { type: T.STRING, enum: ['rank', 'score', 'n_drugs', 'velocity', 'tissue_tau'] }, direction: { type: T.STRING, enum: ['asc', 'desc'] } }, required: ['column'] } },
  { name: 'dashboard_filter', description: 'Apply the dashboard evidence chips. novel_tractable = druggable but no drug or trial; tissue_restricted = GTEx tau >= 0.6; antibody_reachable = surface or secreted. Pass chips to set the whole set, toggle to flip one, reset to clear.', parameters: { type: T.OBJECT, properties: { chips: { type: T.ARRAY, items: { type: T.STRING, enum: ['novel_tractable', 'in_trials', 'no_precedent', 'has_drugs', 'tissue_restricted'] } }, reset: { type: T.BOOLEAN } } } },
  { name: 'set_weights', description: 'Change the GET scoring weights (0-1 each) and rescore the Target List.', parameters: { type: T.OBJECT, properties: { genetic: { type: T.NUMBER }, expression: { type: T.NUMBER }, target: { type: T.NUMBER }, velocity: { type: T.NUMBER } } } },
  { name: 'compare_targets', description: 'Compare named genes side by side across their evidence.', parameters: { type: T.OBJECT, properties: { symbols: { type: T.ARRAY, items: { type: T.STRING } } }, required: ['symbols'] } },
];

/** DATA tools — these read the store and are executed server-side, in the tool loop. */
export const DATA_TOOLS = [
  { name: 'get_gene_evidence', description: 'All stored evidence for ONE gene: mutation, expression, dependency, clinical, literature.', parameters: { type: T.OBJECT, properties: { gene: { type: T.STRING } }, required: ['gene'] } },
  { name: 'get_clinical_trials', description: 'Per-trial clinical records for a gene: NCT id, phase, status, sponsor.', parameters: { type: T.OBJECT, properties: { gene: { type: T.STRING } }, required: ['gene'] } },
  { name: 'find_novel_tractable', description: 'Druggable targets with NO developed drug and NO disease trial yet.', parameters: { type: T.OBJECT, properties: { limit: { type: T.NUMBER } } } },
];

/** RETRIEVAL tools — the reach layer. Server-side for every upstream, so an answering
 *  model never has to know how they work; search_web is backed by OPENAI_SEARCH_MODEL
 *  (a small model with its own rate limit) whichever model is answering. */
export const RETRIEVAL_TOOLS = [
  { name: 'search_literature', description: 'Search Europe PMC for publications by any free text. Use for papers, not for genes we already hold evidence on.', parameters: { type: T.OBJECT, properties: { query: { type: T.STRING }, limit: { type: T.NUMBER } }, required: ['query'] } },
  { name: 'search_trials', description: 'Search ClinicalTrials.gov for trials by drug, condition or free text.', parameters: { type: T.OBJECT, properties: { intervention: { type: T.STRING }, condition: { type: T.STRING }, limit: { type: T.NUMBER } } } },
  { name: 'search_web', description: 'Search the open web. LAST resort and the weakest evidence: use only for what Europe PMC and ClinicalTrials.gov do not index — conference abstracts, regulatory decisions, company pipelines, anything too recent to be indexed.', parameters: { type: T.OBJECT, properties: { query: { type: T.STRING } }, required: ['query'] } },
];

export const ALL_TOOLS = [...CLIENT_TOOLS, ...DATA_TOOLS, ...RETRIEVAL_TOOLS];
export const KNOWN = new Set(ALL_TOOLS.map(t => t.name));

export const SYS = `You are the DiseaseToTarget co-pilot.
GLOSSARY: tau = GTEx tissue-specificity, 0-1, >=0.6 is tissue-restricted. WINNER score is a network PREDICTION, not evidence. GET score = 50% genetic + 25% expression + 25% target.`;

/** [question, expected tool]. 'NO_TOOL' means answering in prose is the correct move —
 *  a model that calls something here is over-eager, which is as wrong as not calling.
 *
 *  The last three are the tier discipline EVIDENCE_RULES asks for, and they are the
 *  cases that matter most for the reach layer: a drug-pair question belongs on the
 *  trial registry, a conference abstract belongs on the web because Europe PMC does
 *  not index it, and a gene we hold evidence on must not go to the web at all. */
export const CASES: [string, string][] = [
  ['open the enrichment view',                        'update_view'],
  ['show me KRAS',                                    'focus_gene'],
  ['sort by tissue tau descending',                   'dashboard_sort'],
  // Worded to name the chip: "filter to novel tractable targets" is genuinely
  // ambiguous and find_novel_tractable is a defensible reading, so it tests nothing.
  ['apply the novel tractable chip on the dashboard', 'dashboard_filter'],
  ['put 70% weight on genetics',                      'set_weights'],
  ['compare TP53, EGFR and BRAF',                     'compare_targets'],
  ['what evidence do we have for PHGDH?',             'get_gene_evidence'],
  ['what trials exist for SRC?',                      'get_clinical_trials'],
  ['which targets are druggable but undrugged?',      'find_novel_tractable'],
  ['what does tau mean?',                             'NO_TOOL'],
  ['should I trust the WINNER score?',                'NO_TOOL'],
  ['find published papers on defactinib in pancreatic cancer',            'search_literature'],
  ['are there registered trials combining daraxonrasib and defactinib?',  'search_trials'],
  ['was there an AACR 2025 conference abstract on daraxonrasib?',         'search_web'],
];
