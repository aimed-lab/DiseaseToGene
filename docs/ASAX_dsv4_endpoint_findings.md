# ASAX `dsv4-nk` — endpoint findings

Measured from the **app side**, against the public funnel URL — no tailnet, no GPU access.

Reproducer, runnable from either side:

```
npx tsx --env-file=.env benchmark/asax_prompt_size.ts             # sweep, <2 min when healthy
npx tsx --env-file=.env benchmark/asax_prompt_size.ts 20000 30000 # headroom check
```

---

## Status: RESOLVED, 11 Sep 2026

The 4096-token ceiling is gone. Verified after the redeploy:

```
approx tok |  1000  2000  4000  5000  6000  9000  14000  | all OK
headroom   | 20000 OK (15.0s)      30000 OK (21.6s)      | all OK
```

Server now reports **4 slots × 32,768 ctx** (previously 8 × 16,384), `n_ctx_train`
1,048,576, `Q3_K - Medium`. Both halves changed at once — the parallelism came down and
the per-slot context went up — so this does not isolate which change fixed it, and the
earlier eliminations (§3) mean it was not per-slot context alone.

Re-verified after the redeploy, not assumed:

| check | result |
|---|---|
| `GET /v1/models` | 200 in 0.31s, OpenAI-shaped, `dsv4-nk` served |
| auth | enforced — 401 without a bearer |
| tool calling | `finish_reason: tool_calls`, valid args + `tool_call_id` |
| tool-result round trip | cited the `NCT` id supplied in the result, invented nothing |
| streaming | 80 SSE events, `[DONE]` present |
| headroom | 30,000 tokens, no failure |

Latency improved too: first *content* delta at 2,249ms, down from 5,745ms.

**This is now usable for the co-pilot.** It is wired in as a dropdown option and as the
free fallback in the paper-extraction chain. It is deliberately **not** the default —
OpenAI stays the default because it answers in ~3s against ASAX's ~7s.

## 1. Model-specific behaviour the app has to handle

- **It is a reasoning model.** Chain-of-thought goes to a non-standard `reasoning_content`
  field and is charged against `max_tokens` **before** any answer is written. At
  `max_tokens: 64` it returns HTTP 200 with `content: ""` and no error field, so a budget
  that is merely too small is indistinguishable from a model with nothing to say.
  `truncatedBeforeAnswer` in `server.ts` tells them apart and retries at 4× the budget.
- **Reasoning streams before the answer does.** Content deltas start ~2.2s in. A UI
  rendering only `delta.content` shows a blank pane until then.

## 2. Operational notes

- **Cold start ~44s** from first `503 {"message":"Loading model"}` to serving.
- **Watchdog recovery 35-65s** when the process dies.
- Three failure modes, reported separately by the app and by `/api/_diag`:
  `502` = nothing listening behind the funnel; `503 Loading model` = weights loading;
  transport error = the relay accepts TCP but no node terminates TLS, i.e. the job is gone.
- **The API key rotates.** It lives on the box at `~/.dsv4_api_key`; `llama-server` cannot
  reload it without a restart. After any rotation, `.env` and the Vercel env both need
  updating or every call returns 401 while the endpoint itself looks perfectly healthy.
- **Funnel hostnames are public.** `asax-nk.tailb0b283.ts.net` and `asax-nk-1…` are both in
  certificate transparency logs, so the endpoint is discoverable and the API key is the only
  thing in front of it.

## 3. History — the 4096 ceiling, and what was eliminated

Kept so the same ground is not re-covered if it regresses.

Bisected with the server's own `usage.prompt_tokens`, so this was exact, not estimated:

```
3972 prompt_tokens -> OK
4061 prompt_tokens -> OK
      ~4100        -> HTTP 502, process dies, watchdog restarts
```

4,061 survived and anything past it died — exactly 4096, unmoved by four configurations:

| hypothesis | result |
|---|---|
| concurrency / MoE routing pressure | ruled out — every request in the sweep is sequential |
| `--n-cpu-moe 1` | identical boundary |
| flash-attn off + fp16 KV | identical boundary |
| context window | `/slots` reported `n_ctx: 16384` on all 8 slots, yet it died at 4,061 |
| per-batch limit | a cached-prefix continuation died at the same *total* |

The live explanation at the time was the `argsort_f32_i32_cuda_cub` fault in the watchdog
log — a bug in that build rather than anything a runtime flag reached.

**Why it mattered:** the ceiling sat below where our traffic *starts*. `EVIDENCE_RULES`
alone is ~1,971 tokens, the system prompt reaches ~4,000 before the user types anything, and
`server.ts:929` caps **one** tool result at 20,000 chars (~5,000 tokens) with up to four
loop steps. Real multi-step questions run **15,000-25,000 tokens** — which is why the
headroom check, not the default sweep, is the one that decides whether this can serve the
co-pilot.
