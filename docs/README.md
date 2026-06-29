# docs/ — project documentation map

Start here to navigate the docs.

## 👉 Picking up the project?
Read **[`sessions/`](sessions/)** — per-context-window handoffs, newest first. The latest one is the
current source of truth for "what we're doing and where we are."

## Layout
| Path | What's in it |
|---|---|
| **`sessions/`** | **Session handoffs (read the newest first).** Add one per context window. |
| `Disease2Target_Funnel_Design.md` | The **design document** — cost-ordered tier funnel (silos + sift, iterative). Professor's gate doc. |
| `Oracle_Schema.md` | **Plain-English Oracle schema** — the 4 tables, columns, relationships, the `value_json` contract, conventions/gotchas. |
| `HANDOFF.md` | Original 2026-06-22 baseline handoff. |
| `PROJECT_BRIEF.md`, `PLAN_Target_Prioritization.md`, `Content_Centric_Plan.md`, `Update_Session.md` | Earlier plans / briefs (historical context). |
| `Meeting_Update_2026-06.md` | Meeting update notes. |
| `case_studies_and_benchmark.md`, `case_study_workflows.md` | Case-study / benchmark notes. |
| `decks/` | Roadmap / plan **slide decks** (.pptx). |
| `oracle/` | Oracle **admin & diagnostic scripts** (`.cjs`): create tables, verify, migrate, etc. |
| `sql/` | Oracle **DDL / schema** SQL. |
| `deck_build/` | Deck-generation tooling. |
| `ui-reference/` | UI reference material. |

## Related folders (outside docs/)
- **`documentation/`** — formal spec documents (.docx) + the evidence-axes demo deck (.pptx).
- **`scripts/`** — runnable generators/utilities (`build_expression_paad.mjs`, `build_depmap_pancreatic.mjs`, deck builder, oracle tests).
- **`data/`** — preloaded reference tables (`expression_paad.json`, `depmap_pancreatic.json`); raw downloads and `jobs.json` are gitignored.
