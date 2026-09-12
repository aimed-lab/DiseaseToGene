---
title: How to read the wiki
order: 1
summary: what a page is, what the two tags mean, and how to get from a number to its commit in four clicks
---

# How to read the wiki

This is a **read-only view** of one Disease2Target snapshot at a time. Nothing here is
fetched live; every number on a page was stored when the snapshot was harvested and scored.
The address bar tells you which snapshot you are looking at:

```
/wiki/pancreatic-adenocarcinoma/102/gene/KRAS
       └── disease (readable)   └── snapshot id (what actually resolves)
```

A snapshot is **immutable**. A new harvest is a new snapshot at a new address, and an old
address keeps showing what it showed the day it was written.

## The two tags

Every block on a page carries one of two tags.

- **DATA** — comes from the store (Oracle): the snapshot, its scores, its evidence rows, its
  knowledge graph. Versioned by snapshot id.
- **NARRATIVE** — comes from Markdown files in the repository, written by a person: this
  page, a disease overview, the explanation under a reconstructed lineage record. Versioned by
  the app commit shown in the footer.

If a sentence and a number disagree, the number wins: the narrative is context, the store is
the record.

## The two badges on every fact

Under each evidence row on a gene page there is a line of small chips. They answer two
different questions.

**Where did it come from?** — the *fact badge*
- the source (click it for every row that source contributed)
- **live** — a link to the source's *current* record. It is not the record the harvest
  read; it is a courtesy. The stored row above it is the evidence.
- when the row was written (`retrieved_at`)
- who wrote it (`job` — the harvest; `agent`; `human`) and its audit status

**What was done to it?** — the *lineage badge*
- the run id and the commit of the script that produced the row. Click it for the script,
  the parameters, and every other row the same run produced.
- <span style="color:#34d399">green · recorded</span> — the harvest wrote this record itself.
- <span style="color:#fbbf24">amber · reconstructed</span> — a person wrote it afterwards from
  git history. Its confidence is stated; read the run's note before quoting it.

## Four clicks from a number to its commit

1. **Board → gene.** Any gene on the ranking board opens `/gene/<symbol>`: every stored row,
   with its two badges.
2. **Gene → run.** Click the lineage badge on the row you care about: script, commit,
   parameters, source version, and the full list of rows that run produced.
3. **Run → source.** The run names its source; the source page lists everything that source
   contributed to this snapshot and links to the live record.
4. **Anything → graph.** Drugs, trials, pathways and papers are pages too, linked from the
   snapshot's knowledge graph in both directions — the right-hand panel shows what links here.

## What the wiki will not do

It will not let you edit anything. It will not re-fetch anything. It will not show a number
it cannot attribute. Where a record is missing — an old snapshot with no lineage, a row with no
run — it says so instead of filling the gap.
