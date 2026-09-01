# AGORA — AMP-AD nominated targets, joined to our evidence

The 967 Alzheimer's targets nominated by AMP-AD teams, each carrying whatever evidence
this project already holds for it.

**This is a dataset, not a benchmark.** The published gold set (known drug targets) is
untouched and this changes no score. It exists so the nominated genes can be looked at
through our own evidence.

## Running it

```bash
node --env-file=../.env scripts/build_agora_dataset.mjs      # ~30s, writes out/agora_ad_evidence.tsv
AGORA_REFRESH=1 node --env-file=../.env scripts/build_agora_dataset.mjs   # re-pull from Agora
AGORA_SNAPSHOT=104 node --env-file=../.env scripts/build_agora_dataset.mjs
```

The Agora response is cached to `data/` on first run. That is deliberate: nominations
accrue over time, so a frozen copy makes the joined table reproducible instead of
"whatever the API returned that day".

## Source

`https://agora.adknowledgeportal.org/api/v1/genes/nominated` — public, no auth. Each
gene carries who nominated it, from what data, in what year, and whether it was
prioritised for experimental validation.

## What the table holds

One row per nominated gene, 33 columns:

- **From Agora** — nomination count, first year, nominating teams, the evidence type each
  nomination was based on, validation details, Pharos class
- **From us** — our rank and score, plus the raw values behind each evidence axis
  (mutation frequency, expression log2FC, Chronos, LOEUF, druggability, trial phase,
  publications, tissue τ, target class, and so on)
- **Network** — the snapshot-frame WINNER and RWR, plus the global WINNER score from
  `WINNER/out/`, which covers genes that are not in the snapshot at all

## Coverage — read this before using the table

| | |
|---|---|
| Nominated genes | 967 |
| In snapshot #103 | **967 (100%)** |
| With a global WINNER score | 958 (99%) |
| Mean evidence axes present | 6.0 of 9 |

It started at 627 (65%). The other 340 were nominated by AMP-AD teams but sat outside
the harvest's top-6,000 by Open Targets association — 263 ranked deeper than the cut,
and 77 have no Open Targets AD association at all, so no harvest depth would ever have
reached them.

Rather than re-harvest 13,000 genes to catch them, they were appended to snapshot #103
directly and enriched on their own:

```bash
npx tsx --env-file=.env scripts/d2t.ts addgenes 103 AGORA/data/agora_missing_genes.txt
npx tsx --env-file=.env scripts/d2t.ts enrich 103 all --genes AGORA/data/agora_missing_genes.txt
```

`--genes` was added for this: it restricts an axis to those symbols and uses
`saveAxisEvidence`'s `genesOnly` mode, so only their rows are replaced and the existing
6,000 genes are never re-fetched. 340 genes took **9 minutes**; re-running the whole
snapshot would have taken hours. Snapshot #103 now holds **6,340 genes** — the original
6,000 untouched at their ranks, the new ones appended at 6001+.

**The network axis is deliberately not rebuilt for them.** WINNER scores a gene against
the others in the node set, so `--genes` refuses to run it over a subset rather than
silently rebuilding the whole axis from 340 genes. And rebuilding it properly would not
help: the node set is the top 2,000 by rank, and the new genes sit at 6001+. Their
network score comes from `winner_global` instead — the full-interactome run, which is
exactly the case it was built for.

### Coverage across the 967, after enrichment

| axis | genes with data |
|---|---|
| annotation | 967 (100%) |
| druggability | 967 (100%) |
| literature_epmc | 966 (100%) |
| tissue | 950 (98%) |
| safety | 947 (98%) |
| expression_tvn | 931 (96%) |
| clinical | 49 (5%) |
| **mutation** | **0** |
| **dependency** | **0** |
| **proteomics** | **0** |

### Three axes are missing for Alzheimer's, snapshot-wide

Not a gap in the Agora subset — a gap in the snapshot:

| axis | rows across 6,000 genes |
|---|---|
| druggability | 12,000 |
| literature_epmc | 11,842 |
| annotation | 5,985 |
| tissue | 5,807 |
| safety | 5,668 |
| expression_tvn | 5,568 |
| patents | 3,561 |
| network | 1,914 |
| clinical | 294 |
| **mutation** | **0** |
| **dependency** | **0** |
| **proteomics** | **0** |

Mutation comes from cBioPortal cancer cohorts and dependency from DepMap cancer cell
lines, so neither has anything to say about Alzheimer's. `buildBoard` already handles
this correctly — it drops criteria with no coverage and renormalises the weights — but
the consequence is worth stating plainly:

- **Dependency is dropped entirely.** The AD board scores on seven criteria, not eight.
- **Genetics runs at half strength** — it blends genetic association (0.6) with mutation
  frequency (0.4), and the mutation half is absent.
- **Expression runs at half strength** — mRNA only, no protein.
- **Clinical covers 5% of genes**, so it is near-empty rather than informative.

The AD ranking rests on less evidence than the eight-criteria framing suggests. That is
context for anything read off this table.

## Agreement with our ranking is weak, and that is the finding

ROC-AUC of our stored ranking against Agora membership:

| test | AUC | positives |
|---|---|---|
| All nominated genes | **0.547** | 627 |
| Nominated 2+ times | 0.569 | 136 |
| First nominated after 2022 | 0.536 | 178 |

0.5 is chance. For comparison the paper reports 0.82 against the drug-target gold set.

This does not contradict the 2.6× enrichment in the top 100 (27% nominated versus a
10.4% baseline). 100 genes is 1.7% of 6,000, so a real signal at the very top barely
moves a global measure. Both hold: mild enrichment at the head of the list, near-chance
discrimination overall.

**We looked for a subgroup where agreement is better, and there isn't one.** Median rank
of nominated genes, split by the evidence the nomination was based on:

| nomination based on | n | median rank of 6,000 |
|---|---|---|
| Metabolomics | 95 | 1,734 |
| RNA | 389 | 2,428 |
| Genetics | 308 | 2,451 |
| Clinical | 48 | 2,692 |
| Protein | 276 | 2,765 |
| Phenomics | 15 | 3,350 |

Everything sits mid-list. Splitting by nomination depth does not rescue it either — genes
nominated five times have a median rank of 1,836, genes nominated once 2,524.

The top of the list invites a different conclusion — APOE ranks 4th, CLU 44th, BIN1 63rd,
INPP5D 113th, all GWAS-driven — while MSN, PLEC and HTRA1 are nominated four or five
times and rank 1,836, 3,091 and 4,466. That reads like "we agree on the genetics ones and
miss the proteomics ones", but the table above does not support it: Genetics and Protein
nominations have almost the same median rank. It was a pattern in twelve genes, not in
six hundred.

## Why this is a dataset and not a gold set

Low agreement is bad news for gold-set use and good news for feature use. A feature that
duplicates what you already score adds nothing; one that is orthogonal adds information.
Agora is orthogonal.

Using it as both — scoring genes on nomination *and* validating the ranking against
nomination — would be circular, the same trap avoided by holding tractability out of the
benchmark.

**Before making it a scored criterion**, measure its correlation with the Literature
axis. Two axes already track community attention (publication velocity, and network
centrality which is 0.995 correlated with STRING degree). A third would push novel
targets down three times over, against the project's own stated principle that novel
targets are not punished for lacking papers.

`data/` is gitignored; `out/agora_ad_evidence.tsv` is tracked.
