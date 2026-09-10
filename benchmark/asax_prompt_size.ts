// benchmark/asax_prompt_size.ts ──────────────────────────────────────────────
// Find the prompt size at which the ASAX llama-server dies, and prove whether a
// build change moved it.
//
//   npx tsx --env-file=.env benchmark/asax_prompt_size.ts
//   npx tsx --env-file=.env benchmark/asax_prompt_size.ts 4000 5000 6000 7000
//
// WHY THIS EXISTS. dsv4-nk is a Mixture-of-Experts model; llama.cpp picks top-K
// experts per token with a CUB segmented sort, and on this build that kernel walks
// off its buffer on large prompts:
//
//   CUDA error: an illegal memory access was encountered
//   in function argsort_f32_i32_cuda_cub at argsort.cu:150
//
// The process dies, the watchdog restarts it, and the app sees a 502 mid-question.
//
// MEASURED 2026-09-10, before any fix — sequential, ONE request at a time:
//   1,000 / 2,000 / 4,000 / 5,000 tok  → OK
//   6,000 / 9,000 / 14,000 tok         → 502, watchdog recovered in 35-65s
//
// The sequential part is the finding. Nothing here is concurrent, so the crash is
// a function of prompt SIZE, not of concurrent MoE routing pressure — which is why
// lowering n_parallel does not address it.
//
// It matters because the co-pilot cannot stay under that boundary: EVIDENCE_RULES
// alone is ~1,970 tokens, the system prompt reaches ~4,000 before the user types
// anything, and server.ts caps ONE tool result at 20,000 chars (~5,000 tokens) with
// up to four loop steps. Real questions start over the line and climb.
//
// Token counts are chars/4 — rough on purpose. The boundary is what matters, and it
// only has to be reproducible, not exact.
const env = (k: string) => process.env[k] || '';
const BASE = env('ASAX_BASE_URL').replace(/\/+$/, '');
const MODEL = env('ASAX_MODEL') || 'dsv4-nk';
const KEY = env('ASAX_API_KEY');
if (!BASE || !KEY) {
  console.error('ASAX_BASE_URL and ASAX_API_KEY must be set (run with --env-file=.env)');
  process.exit(2);
}
const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` };

const SIZES = process.argv.slice(2).map(Number).filter(n => n > 0);
const sizes = SIZES.length ? SIZES : [1000, 2000, 4000, 5000, 6000, 9000, 14000];

// Domain prose rather than "lorem ipsum": MoE routing is content-dependent, so filler
// that looks like our actual traffic is the honest test.
const UNIT = 'The snapshot records per-trial stop reasons, which distinguish safety and efficacy '
  + 'failures from business and logistics stops, and a trial halted because its endpoint was met '
  + 'is not attrition at all. ';
const filler = (chars: number) => UNIT.repeat(Math.ceil(chars / UNIT.length)).slice(0, chars);

const health = async (): Promise<number | string> => {
  try {
    const r = await fetch(`${BASE}/models`, { headers: hdrs, signal: AbortSignal.timeout(15_000) });
    return r.status;
  } catch (e: any) { return `down(${e?.cause?.code || e?.message})`; }
};

/** Wait out a watchdog restart so the next size starts from a live server rather than
 *  inheriting the previous crash and reporting a false positive. */
const awaitRecovery = async (): Promise<string> => {
  for (let i = 0; i < 24; i++) {
    if (await health() === 200) return `recovered after ~${(i + 1) * 5}s`;
    await new Promise(r => setTimeout(r, 5_000));
  }
  return 'STILL DOWN after 120s';
};

console.log(`${BASE}  model=${MODEL}`);
console.log('approx tok | result                                      | ms');
let lastOk = 0, firstFail = 0;

for (const tokens of sizes) {
  const t0 = Date.now();
  let line: string, failed = false;
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST', headers: hdrs, signal: AbortSignal.timeout(240_000),
      body: JSON.stringify({
        model: MODEL, temperature: 0, max_tokens: 200,
        messages: [
          { role: 'system', content: 'You summarise evidence. Answer in one sentence.' },
          { role: 'user', content: `${filler(tokens * 4)}\n\nIn one sentence: what do stop reasons distinguish?` },
        ],
      }),
    });
    const j: any = await r.json().catch(() => null);
    if (r.ok) { line = `OK  ${String(j?.choices?.[0]?.message?.content || '').trim().slice(0, 40)}`; lastOk = tokens; }
    else { line = `HTTP ${r.status} ${String(j?.error?.message || '').slice(0, 40)}`; failed = true; }
  } catch (e: any) {
    line = `CRASH/DROP ${e?.cause?.code || e?.name || e?.message}`; failed = true;
  }
  console.log(`${String(tokens).padStart(10)} | ${line.padEnd(44)} | ${Date.now() - t0}`);
  if (failed) {
    if (!firstFail) firstFail = tokens;
    console.log(`${''.padStart(10)} | ${await awaitRecovery()}`);
  }
}

console.log(firstFail
  ? `\nboundary: survives ~${lastOk} tok, dies at ~${firstFail} tok.` +
    `\nOur co-pilot prompt starts near 4,000 tok and a single tool result adds ~5,000, so this build cannot serve it.`
  : `\nno failure up to ~${lastOk} tok — the boundary moved past everything tested.`);
process.exit(firstFail ? 1 : 0);
