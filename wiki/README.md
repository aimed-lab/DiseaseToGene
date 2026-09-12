# wiki/ — the Markdown layer of the provenance wiki

This folder is the **narrative layer** of the wiki at `/wiki` in the Disease2Target app. It is
bundled into the client at build time (`wiki-app/content.ts`, `import.meta.glob`) and shown
next to the **data layer**, which comes from Oracle. The two are versioned differently and
every page says which is which:

| layer | lives in | versioned by | shown as |
|---|---|---|---|
| data | Oracle (snapshots, scores, evidence, knowledge graph) | snapshot id | blue `DATA` tag |
| narrative | this folder | app commit | purple `NARRATIVE` tag |

## The rule

**Oracle is the truth. The wiki is a view of it.** Markdown here is for what Markdown is good
at — explanation, methodology, interpretation, curated context — and never becomes a second
copy of the scientific data. If a number matters, it belongs in an evidence row, not here.

## Layout

```
wiki/
├── docs/        authored pages: how to read the wiki, provenance model, methodology
├── diseases/    one narrative per disease, matched by `mondo:` in the front-matter
└── lineage/     one RECONSTRUCTED lineage record per old snapshot (see below)
```

Only `wiki/` is bundled. `docs/` at the repo root is internal (handoffs, plans) and is never
shipped to the browser. `wiki-vault/` is a superseded May prototype and is not bundled either.

## Front-matter

```yaml
---
title: How to read the wiki      # docs/: page title; order: sort key; summary: one line
mondo: MONDO_0006047             # diseases/: which disease this narrates
snapshot: 102                    # lineage/: which snapshot this reconstructs
---
```

## About `lineage/`

A **lineage record** says what was done to a source to get a number: script, commit,
parameters, source version, when. Snapshots harvested after enrich started writing
`provenance.runs[]` carry it in Oracle. Older snapshots do not, so a person reconstructs it
from git history into `lineage/<snapshot>.md`, with a `confidence` on every run. The app
reads Oracle first and falls back to the file; a run from the file is shown **amber,
"reconstructed"**, one from the store **green, "recorded"**. The file is the backfill path,
not the permanent home: when the VPN is up, one script loads it into Oracle and the fallback
stops being needed.
