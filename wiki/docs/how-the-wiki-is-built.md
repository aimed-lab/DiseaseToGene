---
title: How the wiki is built
order: 4
summary: the two layers, the address grammar, the five server routes, the caches, the badges, the lineage fallback — and where each lives in the code
---

# How the wiki is built

This page is the engineering account of the wiki you are reading: what runs where, what is
stored where, how a page finds its data, and why the design is the way it is. It is written
for someone who wants to check the wiki's claims against its code, extend it, or build the
next thing on top of it. Every file named here is in the application repository.

## In one paragraph

The wiki is a **read-only view of one snapshot at a time**. A snapshot is what the harvest
wrote to the Oracle store on one day for one disease: the candidate genes, their scores, every
evidence row behind those scores, and a knowledge graph linking genes to drugs, trials,
pathways and papers. The wiki never re-fetches anything from a live source and never writes
anything back. Two things are shown side by side on every page: the **data layer**, read from
the store and identified by snapshot id, and the **narrative layer**, Markdown files in the
repository identified by the application commit they were bundled at. The two are tagged so a
reader always knows which one a sentence came from.

## The shape

```
 browser                          server                         store
 ─────────────────────────        ───────────────────────        ────────────────
 wiki-app/  (React)          ──►  /api/wiki/*  (Express)    ──►  Oracle, via ORDS
   pages, badges, graph            login required                 SNAPSHOTS · SCORES ·
   memoised fetches                per-snapshot caches            EVIDENCE · KG_NODES ·
                                   one graph loader               KG_EDGES
 wiki/**/*.md  (bundled at build — no server involved)
```

| layer | what | where it lives | versioned by | tag on the page |
|---|---|---|---|---|
| data | snapshot header, scores, evidence rows, knowledge graph, recorded lineage | Oracle store, read through the server | snapshot id | blue **DATA** |
| narrative | authored pages, one narrative per disease, reconstructed lineage records | `wiki/` in the repository, bundled into the client | app commit | purple **NARRATIVE** |

The narrative commit is injected at build time (`__GIT_COMMIT__` → `NARRATIVE_COMMIT` in
`wiki-app/content.ts`), so a page can say "narrative as of commit *x*" next to "data from
snapshot *#n*".

## Addresses

The URL is the identity of a page, and it never changes what it resolves to: a new harvest is
new pages at a new path, never an edit of an old one.

```
/wiki                                         index — every snapshot, grouped by disease
/wiki/docs/<slug>                             an authored page (this one is docs/how-the-wiki-is-built)
/wiki/<disease-slug>/<snapshot>               a snapshot's overview
/wiki/<disease-slug>/<snapshot>/<section>     genes · runs · sources · drugs · trials · pathways · papers · graph-genes
/wiki/<disease-slug>/<snapshot>/<kind>/<id>   one entity: gene · run · source · drug · trial · pathway · paper · tissue · variant
```

Entity ids **mirror the knowledge graph's node keys**: the node `gene:KRAS` is the page
`/gene/KRAS`, `drug:<slug>` is `/drug/<slug>`, `trial:NCT…` is `/trial/NCT…`. That one
decision is what makes the wiki navigable without any lookup table — a graph edge *is* a
link, in both directions. The parser and the URL builders are in `nav.ts` (`parseWikiPath`,
`wikiUrl`); nothing else in the app spells a wiki path by hand.

The disease slug is cosmetic (lower-cased, non-alphanumerics collapsed to `-`); the snapshot
number is what the server actually reads.

## The server: five routes, two caches, one loader

All wiki routes sit behind `requireUser` — a signed-in session is required, researcher or
admin; nothing on them is public. They live in `server.ts` next to the other store reads.

| route | returns | built from |
|---|---|---|
| `GET /api/wiki/snapshots` | every snapshot: id, disease, version, created, gene count | `listSnapshots()` |
| `GET /api/wiki/:id/summary` | snapshot header (weights, provenance) + one line per `(evidence_type, source)` with row and scored counts | the snapshot row + the cached full evidence pull |
| `GET /api/wiki/:id/gene/:symbol` | the gene's score row and **every** evidence row with all provenance columns | the per-gene ORDS feed, filtered to this snapshot, + the score list |
| `GET /api/wiki/:id/evidence?type=…&source=…` | every row of one axis or one source (the run and source pages) | sliced from the cached full pull |
| `GET /api/wiki/:id/graph` | `{ snapshot_id, stats, nodes, edges }` | the one graph loader |

Three facts about the store shaped this:

- **The full evidence pull is expensive** — around fifty thousand rows over ORDS, tens of
  seconds cold. It is fetched **once per snapshot** into an in-memory cache and then sliced:
  the summary, run and source pages all read the same pull.
- **The two ORDS evidence feeds differ.** The per-snapshot feed projects five columns; the
  per-gene feed projects all twelve, including `retrieved_at`, `generated_by`, `audit_status`
  and `source_url`. So the gene page — where the fact badge needs those columns — reads the
  per-gene feed, and the bulk pages read the cheaper one.
- **A snapshot is immutable**, so every response carries `Cache-Control: private, immutable`
  and the browser may keep it for a year. Nothing fetched under a snapshot id can go stale.

**One graph loader.** `loadWikiGraph(svc, id)` is the *only* function that builds a
snapshot's graph object, and it is shared with the co-pilot's `query_graph` tool. There used
to be two writers with two shapes; the second one omitted `stats`, and the first page to read
the cache after it had run crashed on `stats.nodes`. The rule since is: one loader, one shape,
one cache — do not add a second.

## The client

`wiki-app/` is a separate full-page UI mounted by the app whenever the path starts with
`/wiki` (`index.tsx` hands the parsed route to `WikiApp`). It shares the app's session,
theme and `authenticatedFetch`, and nothing else.

| file | job |
|---|---|
| `WikiApp.tsx` | the shell (tree · page · "linked from" aside), every page type, the per-page error boundary, `cleanTitle` |
| `content.ts` | the Markdown layer: bundles `wiki/**/*.md`, parses front-matter, resolves lineage (store first, file second) |
| `wikiApi.ts` | the five reads, memoised per URL; `graphIndex` — the link structure built once per snapshot |
| `sources.ts` | what each evidence source is, and the template for its **live** link |
| `ProvenanceBadge.tsx` | the fact badge and the lineage badge, on one line, on every row |
| `ScopedGraph.tsx` | the d3 neighbourhood of one entity |
| `WLink.tsx` | an in-app link that routes without a reload |

**Pages.** Index; doc; disease overview (header, axes present, lineage summary, graph
counts); the eight list sections; and one page per entity kind. The gene page is the centre
of gravity: score row, then every evidence row grouped by axis in a fixed order, each with
its badge, then the gene's graph neighbourhood.

**Links.** Every "links to" and "linked from" list comes from `graphIndex(snapshot)` — the
graph's edges indexed both ways, built once and shared by every page of that snapshot. No
page type hand-builds its own links, which is why a new node type gets navigation for free.

**Failure is per page.** `PageBoundary` wraps the page area keyed by the route, so a page
that throws shows its error in place while the tree, crumbs and aside stay usable; moving
to another route clears it.

**Titles are cleaned at render.** Paper titles in the store carry escaped HTML and charset
casualties from ingestion (an en dash stored as `¿`, `β` as `ß`, tags in upper case).
`cleanTitle` repairs the display; the real fix belongs at harvest, and is listed under
limits below.

## The badge: two layers of provenance on every fact

Every evidence row renders with `ProvenanceBadge`, which answers two different questions:

| badge | question | shows |
|---|---|---|
| **fact** | *where did this number come from?* | source · a live link to the source, labelled *live* · `retrieved_at` · `generated_by` (job / agent / human) · `audit_status` |
| **lineage** | *what was done to it?* | the run id · script · commit — and whether that record was **recorded** by the harvest (green) or **reconstructed** by a person afterwards (amber) |

A row with no run says **no lineage** in red rather than showing nothing. The distinction is
never hidden: the reader can always tell a machine-written record from a human reconstruction.

**Why the live link is labelled.** `source_url` is empty on every stored row today. The badge
therefore builds a link from the gene symbol and the row's own `value_json` using a template
in `sources.ts` (matched by the longest prefix of the stored `source` label), and labels it
*live source, not stored* — it shows what the source says now, not what the harvest read.
The stored row is the evidence; the link is a courtesy.

## Lineage: recorded, or reconstructed

A **lineage run** is one script invocation that produced one axis of one snapshot: script,
commit, parameters, source version, when. It is resolved in one place, `resolveLineage` in
`content.ts`, **store first**:

1. If the snapshot's own `provenance.runs[]` exists in the store, that is the record —
   **recorded**, green.
2. Otherwise, if `wiki/lineage/<snapshot>.md` exists in the repository, that file is the
   record — **reconstructed**, amber, with a `confidence` (high / medium / low) on every run
   and a note saying how each entry was recovered.
3. Otherwise there is no lineage, and every row of that snapshot says so.

Snapshots harvested before the harvest wrote `runs[]` have only the second path. The record
for pancreatic adenocarcinoma #102 was reconstructed from the git history of the harvest
scripts, the `retrieved_at` timestamps on each axis's rows, and the metadata files the
harvest left beside its data; it names what it inferred (the Open Targets release, the
candidate rule) and what was lost (the network node-set size). The file is a backfill path,
not a permanent home: once the harvest records runs itself, and a loader script moves the
reconstructed records into the store, the fallback is no longer needed.

## The Markdown layer

Everything under `wiki/` is bundled at build time by `import.meta.glob` — raw text, eager,
no server and no runtime file access. Three kinds of file:

| path | kind | matched by |
|---|---|---|
| `wiki/docs/<slug>.md` | authored page (this one) | listed under DOCS in the tree, sorted by front-matter `order` |
| `wiki/diseases/<slug>.md` | a disease's narrative | `mondo:` in the front-matter, else the disease name's slug |
| `wiki/lineage/<n>.md` | a reconstructed lineage record | `snapshot:` in the front-matter; `runs:` holds the record |

Front-matter is YAML: `title`, `order`, `summary` for docs; `mondo` for a disease;
`snapshot`, `reconstructed_on`, `reconstructed_by`, `reconstructed_from`, `runs` for
lineage. Markdown renders with GFM (tables, task lists); raw HTML is deliberately disabled.

The rule the folder obeys, from `wiki/README.md`: **Oracle is the truth; the wiki is a view of
it.** Markdown is for what Markdown is good at — explanation, methodology, interpretation —
and never becomes a second copy of the scientific data. If a number matters, it belongs in an
evidence row, not in a page like this one. Only `wiki/` is bundled; the repository's internal
`docs/` folder is never shipped to the browser.

## Ways in

- **From the Ranking Board:** the *Provenance* button on a target's report card opens that
  gene's page for the snapshot the board is showing.
- **From the gene drawer** (the detail panel opened from a target row), when it knows the
  snapshot it was opened for.
- **From the co-pilot:** every stored-data tool returns a `wiki_url` with its result, and the
  co-pilot is instructed to cite it, once, as a link, wherever it cites stored evidence. The
  link is the app's own provenance page, not an external source.
- **From the Target Assessment:** each assessed gene links to its page.
- **By address:** any of the paths above, typed or shared. Because the snapshot number is in
  the path, a shared link opens exactly what its author saw.

## What the wiki deliberately does not do

- It does not fetch anything live at view time. Live links are labelled and lead out.
- It does not edit. There is no write route; a page is a projection of stored rows.
- It does not let an agent write. Rows carry `generated_by` and `audit_status` so that
  agent-appended rows can one day render in a visibly separate section — but no agent writes
  anything today, and nothing an agent writes will ever enter scoring.
- It does not keep a second copy of the graph, the evidence, or the scores anywhere.

## How it came to be

| date | change |
|---|---|
| 12 Sep 2026 | The wiki ships: read-only, login-only, one snapshot at a time; five routes; the badge with its two layers; the Markdown layer; the reconstructed lineage for pancreatic #102; the *Provenance* button on the board. |
| 12 Sep 2026 | Walk-through fixes from the first end-to-end read: trial titles, NCT case, axis-sorted rows, narrow screens. |
| 12 Sep 2026 | The scoped graph: one entity's neighbourhood drawn on its page. |
| 15 Sep 2026 | Seven review fixes: the overview crash that forced the one-loader rule; GFM tables; a literal tag in a doc page; upper-cased and mis-encoded paper titles; the role flash on cold load; the clipped trial properties column; the overview gene badge now opens the graph's gene list. Opened to researchers, not only admins. |
| 16 Sep 2026 | This page. |
| 18 Sep 2026 | The graph's gene set explained and widened. The graph is projected from the top 300 genes by Open Targets rank; STRING edges were kept only *between* those 300, so a gene's page showed the top-300 genes it touches, not its partners (SRC: ATM and BRCA1, but not PTK2). Now each core gene also brings its top 25 STRING partners (by STRING confidence, ties by the partner's disease-network percentile) as smaller *peripheral* gene nodes, the way paralogs were already added — every one of them in the snapshot, with its own page. The legend under a scoped graph became a set of toggles (hide drugs, *genes only*). Clinical rows gained a second, unscored drug→target source (DGIdb) for drugs Open Targets has not curated yet; those trials carry their own badge. |

The design was planned before it was built; the plan's first section is the one rule above,
and every later choice — immutable URLs, stored rows only, two badges, agents append never
edit — follows from it.

## Known limits, and what fixes them

| limit | where it shows | the fix |
|---|---|---|
| `source_url` is empty on every stored row | the badge's link is a template, labelled *live* | the harvest records the URL it read |
| Only one snapshot has a lineage record (#102), and it is reconstructed | other snapshots say *no lineage* | the harvest writes `provenance.runs[]` itself; a loader moves existing files into the store |
| Paper titles carry charset damage from ingestion | repaired at render by `cleanTitle` | fix the character set at harvest |
| The snapshot's own provenance is `{source, via}` only for #102 | release and cutoff inferred, marked as such | recorded by the harvest for every new snapshot |
| A cold snapshot takes tens of seconds to open | first visit only; cached after | a warm-up on deploy, or the store precomputing the per-axis slices |
| A gene's graph neighbourhood is STRING's top partners in the snapshot, not the neighbourhood a paper drew | a partner far down STRING's list for a hub gene (FN1 for SRC, ~113th) is absent | raise `KG_PARTNER_N`, or a per-page "expand from STRING" that the snapshot rule currently forbids |

## Where to look

```
nav.ts                       parseWikiPath · wikiUrl — the address grammar
server.ts                    /api/wiki/* · loadWikiGraph · the two caches
wiki-app/WikiApp.tsx         shell, pages, PageBoundary, cleanTitle
wiki-app/content.ts          Markdown bundling, front-matter, resolveLineage
wiki-app/wikiApi.ts          the reads, graphIndex
wiki-app/sources.ts          source descriptions and live-link templates
wiki-app/ProvenanceBadge.tsx the two badges
wiki-app/ScopedGraph.tsx     the neighbourhood drawing
wiki/README.md               the rules for this folder
wiki/lineage/102.md          the reconstructed record, with its method
```
