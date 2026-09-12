# Plan — the provenance wiki, and the agent that eventually feeds it

Written 12 Sep 2026. Discovery on Target is **28 Sep – 1 Oct 2026, Boston** — sixteen days out.
So this is two plans in one: a **demo cut** that can be on a screen by then, and the **full
roadmap** it grows into without being thrown away.

Companion documents: `docs/Oracle_Schema.md` (the store), the v2 wiki plan (routes, immutability,
two layers of provenance), `docs/HANDOFF_2026-09-10_Copilot_Reach_Scoring_ReadOnly.md` (state of
the co-pilot and the ASAX upstream).

---

## 0. The one rule everything below obeys

**Oracle is the truth. The wiki is a view of it. An agent may append to it, never edit it, and
never touch a rank.**

Every design choice here follows from that sentence. If a proposal breaks it, the proposal is
wrong, however convenient.

Four invariants that make it operational:

| invariant | what it means in practice |
|---|---|
| **Snapshot is identity** | `/wiki/:disease/:snapshot/...` — a URL never changes what it resolves to. New harvest = new pages at a new path. |
| **Stored rows only** | Pages render what was harvested and scored. Never a live re-fetch at view time. Link out to the live source, marked as such. |
| **Two layers of provenance** | A *fact badge* says where a number came from (source · URL · retrieved). A *lineage record* says what was done to it (script · commit · params). Both, on every fact. |
| **Agents annotate or append; scoring never sees them** | Agent output is labelled, cites its tool trace, carries `generated_by: agent` and `audit_status: not_audited`, and lives outside tier 1 until a human promotes it. |

---

## 1. What exists today (so the prerequisites are real, not guessed)

| have | where | state |
|---|---|---|
| Provenance columns on every evidence row | `EVIDENCE.source, source_url, retrieved_at, generated_by, audit_status, value_json` | in place since the schema was designed |
| Snapshot-level provenance JSON | `TARGET_RANKING_SNAPSHOTS.provenance` | holds sources, app version, retrieved date |
| Append-only audit trail | `AUDIT_LOG`, runtime role is INSERT-only | in place |
| Read-only HTTPS access, no VPN | ORDS (`ordsService.ts`) | snapshot, scores, evidence, `kgGraph`, `kgStats` |
| Knowledge graph with 7 node types | `gene, disease, drug, trial, paper, pathway, tissue` + edges | in the store; rendered by `KnowledgeGraphView.tsx` |
| 12 evidence axes incl. proteomics | `d2t.ts` enrich; GBM #123 has all 12 | in place |
| Free, uncapped, tool-capable model | ASAX `dsv4-nk`, 4 × 32K slots, Tailscale Funnel | measured 11/14 tool routing; escalates to web on its own |
| Per-model capability profiles | `MODEL_PROFILES` in `server.ts` | steps, tools, context budget per model |
| Tool-routing benchmarks | `scripts/oaiToolBenchmark.ts`, `scripts/copilotToolCases.ts` | shared cases; measures routing, not groundedness |
| Supabase auth | `requireAuthenticated` in `server.ts` | gates `/api/ai/*` today |
| An older static vault | `wiki-vault/` (May) | scores without sources — the shape, not the content |

| missing | why it matters |
|---|---|
| **Lineage record** (script · commit · params per axis per snapshot) | the difference between "documented" and "traceable" |
| **Agent benchmark** — groundedness + retrieval recall | the gate before any agent writes unprompted; named in the handoff as the precondition for touching scientific code |
| **An internal host** for anything that writes to Oracle | Vercel cannot reach Oracle; ORDS is read-only by construction |
| `ASAX_*` env on Vercel | production 401s on ASAX until set |
| ASAX under a persistent job | the 4-hour test job ends; the wiki demo cannot depend on a model that vanishes |

---

## 2. The demo cut — what can be on a screen by 28 September

One disease, four page types, real provenance, the co-pilot citing it. Nothing that needs a
schema change, a new host, or an agent.

**Scope: glioblastoma, snapshot #123.** It is the only disease with all twelve axes, and the
proteomics story ("one in five RNA-up genes is DOWN at protein") is the best thing to click
through on stage.

| day | build | done when |
|---|---|---|
| 1 | **Prerequisites.** `ASAX_*` on Vercel. ASAX resubmitted under a long job, `--parallel 2`. | `/api/_diag` shows `asax.liveTest.ok` on production |
| 1–2 | **Lineage for #123, by hand.** One `runs[]` array in `snapshot.provenance`: twelve entries (axis, script, commit, params, source version, fetched_at). Values come from the commit history — they are all known. | `GET /api/snapshots/123` returns `provenance.runs` |
| 2 | **`<ProvenanceBadge>`.** source · URL · retrieved · run id. One component, before any page. | renders on a test row |
| 3–4 | **Routes + auth.** `/wiki/:disease/:snapshot` and `/wiki/:disease/:snapshot/gene/:symbol`, behind `requireAuthenticated`. Landing page: axes, sources, runs. Gene page: every evidence row, a badge on each, stored rows only. | EGFR and GABRA1 pages render every axis with a badge |
| 5–6 | **Run and source pages.** `/run/:id` (script, commit, params, and every row it produced). `/source/:id` (everything PDC000204 contributed). | click a proteomics badge → run → back to every gene it touched |
| 7–8 | **Drug and trial pages from the graph.** `kgGraph(123)` loaded once and cached forever (snapshot is immutable). Drug page = one-hop neighbourhood: every target it hits here. Trial page: every gene it is evidence for. Gene page links to both. | osimertinib → EGFR → NCT… → back |
| 9 | **Scoped graph.** `KnowledgeGraphView` filtered to the entity's neighbourhood, embedded on every entity page. Already exists; this is a filter and a mount. | the graph on the EGFR page shows its drugs, trials, pathways |
| 10 | **The co-pilot cites it.** `get_gene_evidence` returns the wiki URL; EVIDENCE_RULES' source labels become links. | ask about PHGDH → answer contains `/wiki/glioblastoma/123/gene/PHGDH` |
| 11–12 | **Cache-forever headers, QA, the demo script.** Rehearse the click path: board → gene → proteomics badge → run → source → drug → other targets → trial. | a colleague can do the click path unassisted |

**Not in the demo cut, on purpose:** pathway pages (KG has them; two days after DOT), authored
docs pages, the other three diseases (the routes work for them the day the lineage is backfilled),
anything agent-shaped.

**Public or gated?** Decide on day 1. Recommendation: an env flag that makes **one snapshot**
public read-only, so a link on a slide works for whoever scans it; everything else stays behind
login. Costs an hour if decided now, a day if decided after the middleware is placed.

---

## 3. The full roadmap — phases, dependencies, exit criteria

```
Phase 0  Prerequisites ───────────────┐
Phase 1  Provenance wiki (read-only) ─┴─► Phase 2  Agent benchmark ─┬─► Phase 4  Evidence-gathering agent
                                                                    │
                                       Phase 3  Annotating agent ◄──┘  (can start before 2; needs no gate)
                                                                          Phase 5  Harvest automation
```

### Phase 0 — Prerequisites (1 week, partly overlapping the demo cut)

| item | detail |
|---|---|
| Vercel env | `ASAX_BASE_URL`, `ASAX_MODEL`, `ASAX_API_KEY` |
| ASAX persistent job | the 14-day production job, `--parallel 2` (65K per slot). Validate with `benchmark/asax_prompt_size.ts 20000 30000` before submitting |
| Lineage record — design, no DDL | `snapshot.provenance.runs[]` + `run_id` inside `value_json`. Both columns exist; the schema's own rule is "new source = new rows, no schema change". Graduate to a `RUNS` table only if runs ever need querying across snapshots |
| Lineage — going forward | `d2t.ts` enrich writes one run entry per axis on every new snapshot, automatically |
| Lineage — backfill | #123, #103, #102 by hand. **Not** the seven older pancreatic snapshots |
| Internal host | Request a research-computing VM. Requirements: outbound only (ORDS, Europe PMC, CT.gov, ASAX funnel, Oracle over VPN); **no inbound**; cron. This is where every phase-3+ process runs |
| Key hygiene | rotate the ASAX key (three plaintext copies exist); the VM gets its own |

### Phase 1 — The provenance wiki, read-only (3–4 weeks; the demo cut is its first half)

Everything in §2, plus:

| item | detail |
|---|---|
| Pathway pages | stable header (pathway id, source release — itself provenance), snapshot-scoped body (which members were ranked, with rank) |
| The other three diseases | routes already work; needs lineage backfill (#103, #102) |
| Authored docs | `/wiki/docs/:slug` from repo markdown — methodology, tiers, how to read a report card. **Visibly marked "narrative"**; data pages carry a snapshot/lineage header. A reader must always know which they are on |
| Cache-forever as policy | server, CDN, browser — keyed by snapshot id. State it in the code, not just rely on it |
| Bidirectional links from KG edges | every page: edges both ways, from `kgGraph`, never hand-built per page type |

**Exit criterion:** for any number on the board, a reviewer can reach the study, the arms, the
statistic, the script and the commit in at most four clicks, without leaving the app.

### Phase 2 — The agent benchmark (1–2 weeks; the gate)

The handoff names it and names why: *no agent benchmark → changes to scientific code alter
results silently.* Autonomous writing is the same bar, higher.

| metric | definition | why paired |
|---|---|---|
| **Groundedness** | every number, identifier and date in an answer traces to a tool result **in the same run** | alone, rewards saying nothing |
| **Retrieval recall** | of the evidence a question needs, how much did the tool chain actually fetch | alone, rewards fetching everything |

Built on `scripts/copilotToolCases.ts` and `scripts/oaiToolBenchmark.ts`, which already do tool
routing. Add a case set with **known answers** (drug-pair questions whose registry and literature
state is fixed at a date), run nightly on ASAX from the internal host, log the scores. Free.

**Exit criterion:** a number for dsv4-nk on both metrics, tracked over time, and a threshold
agreed for Phase 4.

### Phase 3 — The annotating agent (1–2 weeks; no gate needed, can run before Phase 2)

Agents that **narrate**, never assert new facts. Runs on ASAX, on the internal host, on cron.

| job | input (closed world) | output |
|---|---|---|
| **Snapshot diff narrator** | deterministic diff #N vs #N−1: ranks moved, axes filled, weights changed, runs added | one note on the new snapshot's landing page: *what changed and which run caused it* |
| **Gene summary** | that gene's stored evidence rows, that snapshot | lazy, on first view, cached by `(gene, snapshot)`, invalidated never (snapshot is immutable) |

Both: labelled **AI**, cite snapshot ids and run ids, temperature 0, grounded on rows the model is
handed — no open-ended prompting. Stored in a small Supabase table
`wiki_annotations (entity, snapshot_id, kind, model, generated_at, text, trace)` — **not** in
`EVIDENCE`, because they are not evidence.

**Exit criterion:** every snapshot from now on lands with a change note, and it is right.

### Phase 4 — The evidence-gathering agent (2–3 weeks; **gated on Phase 2**)

The thing "updates itself" usually means: unprompted, periodic, finds new trials and papers for
the top targets and adds them. The co-pilot can already do each step on request. Doing it
unprompted is a different thing, and the whole design is about what it is allowed to write.

| rule | mechanism |
|---|---|
| Append only | new `EVIDENCE` rows; existing rows never modified |
| Marked | `generated_by: agent`, `audit_status: not_audited`, `run_id` of the agent run, tool trace in `value_json` |
| Outside scoring | tier 1 — what the board ranks on — is what the harvest produced. Agent rows render in the wiki in a **visibly separate "AI-gathered, unverified"** section |
| Promotion is human | a person flips `audit_status` to `human_verified`; whether verified rows ever enter scoring is a harvest-time decision, not the agent's |
| Every row cites its call | same groundedness rule as the co-pilot's answers, enforced by the Phase 2 benchmark |
| Audit | every run writes to `AUDIT_LOG` |

Schedule: weekly, top-N targets per disease, `search_trials` + `search_literature` (+ `search_web`
where the coverage rule escalates), on the internal host.

**Exit criterion:** a month of runs in which a human spot-check finds no ungrounded row.

### Phase 5 — Harvest automation (later)

The true "loads it by itself": scheduled re-harvest against new Open Targets / DepMap / gnomAD
releases, producing a **new snapshot**, with the lineage record written by construction and the
Phase 3 narrator explaining what moved. Needs Phase 0's internal host and lineage-going-forward;
needs nothing agent-shaped — it is `scripts/d2t.ts` on cron. Deliberately last: a new snapshot
changes what every user sees, and the sensitivity benchmark (`benchmark/sensitivity.ts`) should run
against each one before it is promoted to default.

---

## 4. What is necessary — the checklist

**Infrastructure**
- [ ] `ASAX_*` on Vercel
- [ ] ASAX under a persistent job, `--parallel 2`, headroom verified at 30K
- [ ] Internal VM (research computing): outbound-only, VPN to Oracle, cron, its own ASAX key
- [ ] Key rotation for anything that has passed through chat

**Data**
- [ ] Lineage design: `provenance.runs[]` + `value_json.run_id` (no DDL)
- [ ] Enrich writes runs automatically on every new snapshot
- [ ] Backfill #123 (demo), then #103, #102
- [ ] `wiki_annotations` table in Supabase (Phase 3)

**Code**
- [ ] `<ProvenanceBadge>`
- [ ] Snapshot-scoped `/wiki` routes behind existing auth; optional public flag for one snapshot
- [ ] Entity pages from KG edges, stored rows only, cache-forever
- [ ] Scoped `KnowledgeGraphView` embed
- [ ] Co-pilot cites wiki URLs; `get_gene_evidence` returns them
- [ ] Agent benchmark: groundedness + recall, nightly on ASAX
- [ ] Diff narrator; lazy gene summaries
- [ ] Evidence-gathering agent with the four append rules

**Governance (write these down where the code lives)**
- [ ] The one rule (§0) in `docs/` and at the top of the wiki module
- [ ] "Narrative" vs "data" marking on every page
- [ ] The Phase 4 gate: no unprompted writes until Phase 2 has a number

---

## 5. Risks, honestly

| risk | mitigation |
|---|---|
| ASAX availability — cold starts, job ends, watchdog restarts | persistent job; the app already degrades to a clear message; the demo has OpenAI as fallback (5–8 questions/day) |
| Sixteen days is tight for the demo cut | it is one disease and four page types on data that already exists; the cut list in §2 is what to drop first, in order: scoped graph → trial pages → source pages |
| A "wiki" that quietly becomes editable | Phase 1 has no write path at all. Phase 4's only write is an INSERT with `not_audited` |
| Agent rows leaking into scoring | structural: scoring reads the harvest's rows; agent rows are a different `audit_status` and never promoted by code |
| The AI summary saying something the rows do not | closed-world inputs (a diff, a row set), temperature 0, the Phase 2 benchmark, and the label |
| Schema changes blocking the timeline | none required; every record proposed fits an existing JSON column |

---

## 6. Open decisions (need an owner, not more analysis)

1. **Public read-only for one snapshot at DOT** — yes or no. Decide day 1.
2. **Threshold for the Phase 4 gate** — what groundedness score is "good enough" to write unprompted. Decide when Phase 2 has its first number, not before.
3. **Whether human-verified agent rows can ever enter scoring** — a study-design question, same family as the benchmark-leakage decision in the handoff. Park it until Phase 4 has produced rows worth the question.

---

## 7. Effort summary

| phase | calendar | who |
|---|---|---|
| Demo cut (§2) | 12 working days → **28 Sep** | one person, full time |
| Phase 0 remainder | in parallel, mostly waiting on the VM | — |
| Phase 1 remainder | 2 weeks after DOT | one person |
| Phase 2 benchmark | 1–2 weeks | one person; can overlap Phase 1 |
| Phase 3 annotator | 1–2 weeks | after Phase 0 host |
| Phase 4 gatherer | 2–3 weeks | after Phase 2 gate |
| Phase 5 harvest cron | 1 week | whenever; last |

Roughly **three months** from today to an agent that appends evidence unprompted, safely — with a
demonstrable provenance wiki in sixteen days, and every step useful on its own if the one after it
never happens.
