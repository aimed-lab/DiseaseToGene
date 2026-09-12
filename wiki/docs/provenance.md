---
title: The provenance model
order: 2
summary: the one rule, the four invariants, and what each column of an evidence row means
---

# The provenance model

## The one rule

**Oracle is the truth. The wiki is a view of it. An agent may append to it, never edit it,
and never touch a rank.**

Every design choice in the wiki follows from that sentence.

## Four invariants

| invariant | in practice |
|---|---|
| **Snapshot is identity** | `/wiki/:disease/:snapshot/...` — a URL never changes what it resolves to. A new harvest is new pages at a new path. |
| **Stored rows only** | Pages render what was harvested and scored. Never a live re-fetch at view time. Links out to the live source are marked as such. |
| **Two layers of provenance** | A *fact badge* says where a number came from (source · retrieved · who). A *lineage record* says what was done to it (script · commit · parameters). Both, on every fact. |
| **Agents annotate or append; scoring never sees them** | Nothing an agent writes enters the ranking. Agent rows, when they exist, carry `generated_by: agent` and `audit_status: not_audited` and render in a visibly separate section. (No agent writes anything today.) |

## What an evidence row carries

One row per `(gene, evidence type, source)` in a snapshot.

| column | meaning |
|---|---|
| `evidence_type` | the axis: `expression_tvn`, `proteomics`, `dependency`, `safety`, `tissue`, `mutation`, `druggability`, `clinical`, `literature_epmc`, `network` (scored) · `annotation`, `literature`, `patents` (not scored) |
| `source` | the named source, e.g. `gnomAD v4`, `DepMap Public (Chronos) · Pancreas lineage` |
| `source_url` | a link to the source record — **empty on every row today**; the wiki builds a live link from the gene and source instead, and labels it as live |
| `value_text` | a short human string |
| `value_json` | the contract: `axis` (0–1, what the board ranks on), `direction` (`pro` / `con`), `display`, and the raw fields (log2FC, LOEUF, Chronos mean, …) in real units |
| `retrieved_at` | when the row was written |
| `generated_by` | `job` (the harvest), `agent`, or `human` |
| `audit_status` | `not_audited` → `ai_verified` → `human_verified`; only a person moves a row up |

## What a lineage run carries

One run per axis per snapshot. It answers "how did the source become the number".

| field | meaning |
|---|---|
| `script`, `commit` | the code that ran, at the version that ran |
| `params` | the formula and settings — e.g. `axis = clamp01(|log2FC| / 4)` |
| `source`, `source_version` | which source, which release or reference file, built when |
| `ran_at` | when |
| `confidence` | only on reconstructed records: `high` · `medium` · `low` |

**Recorded** runs were written by the harvest into the snapshot's own provenance.
**Reconstructed** runs were written by a person afterwards, from git history, into
`wiki/lineage/<snapshot>.md`; the file says how each entry was recovered and what is uncertain.

## What is not provenance

- The narrative pages (this one included). They explain; they do not attest.
- The live links. They show what the source says today, not what the harvest read.
- The co-pilot's answers. They cite rows; they are not rows.
