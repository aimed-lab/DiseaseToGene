# ASAX `dsv4-nk` — what the app side measured, 10 Sep 2026

Written for the session that owns the GPU box. Everything below was measured from the
**app side**, against the public funnel URL — no tailnet, no GPU access.

Reproducer, runnable from either side:

```
npx tsx --env-file=.env benchmark/asax_prompt_size.ts            # default sweep, ~4 min
npx tsx --env-file=.env benchmark/asax_prompt_size.ts 20000 30000 # headroom check
```

---

## 1. The endpoint works. The integration works.

Verified end to end: `/v1/models` is OpenAI-shaped, auth is enforced (401 without a
bearer), chat completions return correct answers, **tool calling works** — valid
`tool_calls` with usable `tool_call_id`, and it grounded an answer in an `NCT` id handed
back in a tool result rather than inventing one. Streaming is well-formed SSE.

That is the whole co-pilot contract, so this model is a genuine upstream candidate. It is
wired into the app now: a dropdown option, never the default, plus the free-fallback slot
in the paper-extraction chain.

Two model-specific behaviours the app had to handle:

- **It is a reasoning model.** Chain-of-thought goes to a non-standard `reasoning_content`
  field and is charged against `max_tokens` **before** any answer is written. At
  `max_tokens: 64` it returns HTTP 200 with `content: ""` and no error. A budget that is
  merely too small is indistinguishable from a model with nothing to say.
- **First content delta arrives ~5.7s in** (219 reasoning deltas start at 405ms). A UI
  rendering only `delta.content` shows a blank pane for six seconds.

## 2. The blocker: a hard 4096-token prompt ceiling

Bisected using the server's own `usage.prompt_tokens`, so this is exact, not estimated:

```
prompt_tokens = 3972  → OK
prompt_tokens = 4061  → OK
      ~4100          → HTTP 502, process dies, watchdog restarts (35-65s recovery)
```

**4,061 survives, anything past it dies.** Exactly 4096.

### What has been eliminated by measurement

| hypothesis | result |
|---|---|
| concurrency / MoE routing pressure | ruled out — every request in the sweep is sequential, one at a time |
| `--n-cpu-moe 1` | identical boundary |
| flash-attn + q8_0 KV | identical boundary with FA off and fp16 KV |
| context window | ruled out — `/slots` reports `n_ctx: 16384` on all 8 slots |
| per-batch limit | a cached-prefix continuation died at the same *total* (see caveat) |

*Caveat on the last row:* with 8 slots the continuation may have been routed to a
different slot and missed the prompt cache, so it is suggestive rather than conclusive.

Four config changes, four identical boundaries at a power of two. **This looks like a real
bug in this build — the original `argsort_f32_i32_cuda_cub` diagnosis — not something a
runtime flag reaches.**

Note that `--parallel` does still divide `--ctx-size` across slots in llama.cpp, so it is
worth keeping in mind generally; it just is not what is happening here, because per-slot
context is confirmed at 16,384.

## 3. Why this blocks the co-pilot specifically

The ceiling is below where our traffic *starts*:

```
EVIDENCE_RULES                     7,884 chars  ~1,971 tok
reference term index (compact)     1,424 chars  ~  356 tok
+ systemInstruction, screen block, ~18 tool schemas
                                             ≈ ~4,000 tok before the user types anything
```

Then `server.ts:929` caps **one** tool result at 20,000 chars (~5,000 tokens), and the tool
loop runs up to four steps. A realistic multi-step question lands in the **15,000-25,000
token** range.

So this is not an intermittent annoyance that a watchdog papers over — it is deterministic
failure on essentially every substantive question. **Clearing 14K in the benchmark is not
sufficient**; run the headroom check too.

## 4. Suggested order

1. **30 seconds:** clamp batch sizes explicitly — `-b 1024 -ub 256`. Rated a long shot,
   because the boundary tracks *total* prompt length rather than batch length, which is the
   opposite of what this would fix. Cheap enough to try before a 90-minute build.
2. **Rebuild from master.** Validate with the reproducer rather than by eye — it gives a
   verdict in four minutes.
3. **Capture the next crash stack.** If it is no longer `argsort.cu:150`, the config changes
   moved the fault and that changes what to look for in master.

## 5. Operational notes

- **Cold start measured at 44s** from first `503 {"message":"Loading model"}` to serving.
- **Watchdog recovery measured at 35-65s**, not "within seconds". Each crash costs a user
  about a minute.
- The three failure modes are distinguishable and the app now reports them separately:
  `502` = nothing listening behind the funnel; `503 Loading model` = weights loading;
  transport error = relay accepts TCP but no node terminates TLS, i.e. the job is gone.
- **Funnel hostnames are public.** `asax-nk.tailb0b283.ts.net` and `asax-nk-1...` are both
  in certificate transparency logs, so the endpoint is discoverable and the API key is the
  only thing in front of it.
- **Do not submit the 14-day production job** until the headroom check passes.
