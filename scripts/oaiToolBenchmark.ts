// ── Native tool-routing benchmark for OpenAI-compatible upstreams ────────────
// Measures whether a model can be trusted with D2T's tools, the same way
// hermesToolBenchmark.ts does for PLEASER — except these upstreams take NATIVE
// tool declarations, so what is measured is `tool_calls`, not parsed prose.
//
//   npx tsx --env-file=.env scripts/oaiToolBenchmark.ts asax
//   npx tsx --env-file=.env scripts/oaiToolBenchmark.ts openai
//   npx tsx --env-file=.env scripts/oaiToolBenchmark.ts both
//
// It calls the server's own oaiChat with the server's own upstream configs, so the
// benchmark cannot certify a code path the co-pilot does not use. That is not
// fussiness: the first version of this script re-implemented the request and scored
// gpt-5.6-luna 0/14, because the gpt-5.6 family rejects function tools on this
// endpoint unless reasoning_effort is 'none' — a retry oaiChat has had all along.
// A benchmark that reimplements the call measures the reimplementation.
//
// WHY IT EXISTS. `tools: true` on a picker entry promises the model will actually
// use them. glm-air earned that with 11 cases; best-reasoning was kept OUT of
// HERMES_TOOL_MODELS on the strength of 1/4. dsv4-nk was carrying the same promise
// on one hand probe. This is what MODEL_PROFILE's `tools` flag should be set from.
//
// Two failures that look alike and are not:
//   MISSED     — should have called a tool, answered in prose
//   OVER-EAGER — should have answered in prose, called a tool
// A model that calls something every time has perfect recall and is useless.

// VERCEL=1 BEFORE the import, and a dynamic import so it takes effect: server.ts
// calls app.listen() at module scope otherwise, and the benchmark would boot a second
// web server (and fight the dev server for port 3000) as a side effect of measuring.
process.env.VERCEL = '1';
const { toOpenAiTools, oaiChat, OPENAI_CFG, asaxCfg } = await import('../server.js');
const { ALL_TOOLS, CASES, SYS } = await import('./copilotToolCases.js');

const TOOLS = toOpenAiTools(ALL_TOOLS);

const configured = (c: any) => !!(c?.url && c?.key?.());
const UPSTREAMS: Record<string, () => any> = {
  openai: () => OPENAI_CFG,
  // Generous budget on purpose: dsv4-nk spends tokens reasoning BEFORE it writes, and a
  // turn truncated mid-thought would score as a miss when it is really a short budget.
  asax: () => ({ ...asaxCfg(), maxTokens: Math.max(Number(process.env.ASAX_MAX_TOKENS) || 2048, 4096) }),
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const isTransient = (m: string) => /rate.?limit|429|timeout|ECONN|502|503|unreachable|loading the model/i.test(m);

/** Ask once, retrying TRANSPORT failures only — never a routing answer.
 *
 *  This retry is the difference between a benchmark and a coin toss. The first run fired
 *  14 tool-laden requests back to back, tripped the org token-per-minute ceiling on case
 *  eight, and scored gpt-5.6-luna 9/14 with the verdict "DO NOT give this model tools" —
 *  about the model that had just answered a real question using six of them. An exhausted
 *  quota is not a model that cannot route. */
async function routeOne(cfg: any, question: string): Promise<{ name: string; err?: string }> {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const msg = await oaiChat(cfg, [{ role: 'system', content: SYS }, { role: 'user', content: question }], ALL_TOOLS);
      const calls = msg?.tool_calls || [];
      // First call only: these are single-intent questions, and a model that fans out to
      // three tools on "show me KRAS" has still routed the first one correctly.
      return { name: calls.length ? String(calls[0]?.function?.name || 'UNNAMED') : 'NO_TOOL' };
    } catch (e: any) {
      last = String(e?.message || e);
      if (!isTransient(last) || attempt === 3) break;
      await sleep([8_000, 20_000, 40_000][attempt]);
    }
  }
  return { name: 'ERROR', err: last.slice(0, 110) };
}

async function benchmark(cfg: any): Promise<{ pass: number; total: number; scored: number; missed: number; eager: number; errors: number }> {
  console.log(`\n=== ${cfg.label} (${cfg.model}) — native tool_calls, ${CASES.length} cases ===`);
  let pass = 0, missed = 0, eager = 0, errors = 0;
  const fails: string[] = [];
  for (const [q, want] of CASES) {
    const { name, err } = await routeOne(cfg, q);
    await sleep(PACE_MS);   // 14 tool schemas per request; back-to-back trips tokens-per-minute
    const ok = name === want;
    if (ok) pass++;
    else if (name === 'ERROR') { errors++; fails.push(`ERROR      "${q}" :: ${err}`); }
    else if (want === 'NO_TOOL') { eager++; fails.push(`OVER-EAGER "${q}" called ${name}, prose was correct`); }
    else if (name === 'NO_TOOL') { missed++; fails.push(`MISSED     "${q}" want ${want}, answered in prose`); }
    else fails.push(`WRONG      "${q}" want ${want} got ${name}`);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${want.padEnd(18)} <- "${q}"${ok ? '' : `   got ${name}`}`);
  }
  const scored = CASES.length - errors;
  console.log(`\n${cfg.label}: ${pass}/${scored} scored   missed ${missed} · over-eager ${eager} · unreachable ${errors}`);
  if (fails.length) { console.log('failures:'); fails.forEach(f => console.log('  ' + f)); }
  return { pass, total: CASES.length, scored, missed, eager, errors };
}

const which = (process.argv[2] || 'both').toLowerCase();
const targets = which === 'both' ? ['openai', 'asax'] : [which];
const PACE_MS = Number(process.env.BENCH_PACE_MS) || 3_000;
const results: Record<string, { pass: number; total: number; scored: number; errors: number }> = {};

for (const t of targets) {
  const make = UPSTREAMS[t];
  if (!make) { console.error(`unknown upstream "${t}" — use openai, asax or both`); process.exit(2); }
  const cfg = make();
  if (!configured(cfg)) { console.log(`\n=== ${t}: SKIPPED — not configured ===`); continue; }
  results[t] = await benchmark(cfg);
}

console.log('\n── summary ──');
for (const [k, v] of Object.entries(results)) {
  // Score over the cases that actually RAN. An exhausted quota or an unreachable node is
  // MISSING COVERAGE, not a model that routes badly, and conflating the two recommends
  // disabling tools on a model that works — this script did exactly that to gpt-5.6-luna
  // on its first run. Too little coverage earns no verdict rather than a cheap one.
  const pct = v.scored ? Math.round((v.pass / v.scored) * 100) : 0;
  const coverage = Math.round((v.scored / v.total) * 100);
  const verdict = coverage < 70 ? `INCONCLUSIVE — only ${v.scored}/${v.total} cases ran; re-run when the upstream is healthy`
    : pct >= 90 ? 'trustworthy with tools'
    : pct >= 70 ? 'marginal — read the failures before enabling tools'
    : 'DO NOT give this model tools';
  console.log(`${k.padEnd(8)} ${v.pass}/${v.scored} scored (${pct}%)  coverage ${coverage}%  ${verdict}`);
}
process.exit(0);
