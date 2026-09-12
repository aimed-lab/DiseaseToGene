# archive/ — code removed from the app, kept as files

Three dashboard views were removed on 12 Sep 2026 because nothing used them and they were
crowding the navigation. The code is kept here **verbatim** so it can be read and copied back
without digging through git history. Nothing in this folder is compiled or bundled
(`tsconfig.json` excludes it; Vite only bundles what is imported).

Removed in commit: see `git log --oneline -- archive/README.md` (the commit that added this
file is the one that removed the views).

| folder | what it was | why removed | what still lives in the app |
|---|---|---|---|
| `funnel/` | **Funnel** tab — `FunnelView.tsx`, the original eligibility-gate → weighted-score ranker with a UI for tuning gates and weights | Superseded by the Ranking Board (Aug 2026). No other caller. | **`funnelEngine.ts`** (the pure ranking maths) — still imported by `benchmark/benchmark.ts`, `run.ts`, `adapter.ts`, `report.ts` so the benchmark's funnel mode keeps compiling. `/api/paper/extract-genes` (the view's only server call) also stays. |
| `literature-pubtator/` | **Research ▾ → Literature** tab — `PubTatorView`, a PubTator3 gene-mention table for the active disease with load-more paging, plus the prefetch effect and load-more handler from `App()` | The co-pilot's literature tool is Europe PMC; the tab had no other consumer. | **`api.getPubTatorLiterature()` and the `/api/pubtator/*` server routes** — disease loading still calls them and feeds the returned literature genes into the RWR network (`performRWR(genes, litGenes)`). The `pubtator*` fields on `ResearchState` stay for the same reason. `server-routes.ts` here is a *reference copy*, not a removal. |
| `cohorts/` | **Research ▾ → Cohorts** tab — `RawDataView`, a sample-level TCGA clinical + expression browser against the AIMED APEX `gtkb` endpoints, with `'BRCA'` and a five-gene list hard-coded as fallbacks | Early prototype, no other caller. | Nothing. `api.getTcgaClinical` / `getTcgaExpressionPage` were removed with it (`api-tcga.ts` here). |

The **Research ▾** dropdown itself was removed because, with Literature and Cohorts gone, it
held only **Papers** — which stays, promoted to a plain top-level tab (admin-only, as before).

## Re-wiring any of them

1. Copy the file(s) back next to `index.tsx` (or paste the component back into it).
2. Add the view id back to `ViewMode` in `types.ts` (`'funnel'`, `'pubtator'`, `'raw'`).
3. Add the tab entry to `primaryAll` (or a dropdown) in `TabNavigation` in `index.tsx`, and add the
   id to `RESEARCHER_VIEWS` if researchers should see it.
4. Add the `{viewMode === '<id>' && (...)}` render block in the content area of `App()`.
5. For Cohorts, restore the two helpers in `api.ts`. For Literature, restore the prefetch
   effect and `handleLoadMoreLiterature` from `index-hooks.tsx` into `App()`.

Worth knowing if you revive **PubTator**: it is entity-tagged search (gene *mentions*, not
keyword hits), which is a genuinely different capability from the Europe PMC tool — a
plausible future co-pilot tool rather than a tab.
