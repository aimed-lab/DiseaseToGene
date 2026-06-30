# Session Handoffs

This folder holds **one handoff note per context window / work session**. When a context window
fills up, drop a new file here so the next window can get up to speed fast.

## Convention
- **One file per session, named `YYYY-MM-DD.md`** (add `-2`, `-3` if multiple in a day).
- Start each handoff with a **30-second orientation**, then: what changed, current state
  (works vs pending), key decisions, next steps, gotchas.
- The **newest file is the source of truth**; older ones are history.
- Keep stored-string note in mind: the Oracle DB charset isn't full UTF-8 — keep evidence
  `value_text`/`value_json` strings ASCII/Latin-1 safe.

## Index (newest first)
| Date | File | Summary |
|---|---|---|
| 2026-06-29 | [2026-06-29-2.md](2026-06-29-2.md) | Job now ingests ALL 8 axes as raw Oracle rows (added mutation/druggability/clinical/literature providers + gnomAD constraint table + full-universe cap). Funnel raw-filter cascade + drawer parity (clinical/literature panels). |
| 2026-06-29 | [2026-06-29.md](2026-06-29.md) | 3 evidence axes (gnomAD/expression/DepMap), registry+contract, funnel reskin, background Jobs + add-genes, gene drawer. SRC case study live. |
| 2026-06-22 | [../HANDOFF.md](../HANDOFF.md) | Original baseline: Oracle content store, Rankings, DB-backed funnel, mutation/paper evidence. |

> To start a new session note, copy the structure of the latest file, update the index above,
> and commit.
