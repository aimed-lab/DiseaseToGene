---
title: Methodology — the evidence axes
order: 3
summary: what each scored axis measures, its formula, and where its raw numbers come from
---

# Methodology — the evidence axes

Each gene in a snapshot carries up to ten **scored** axes and three **annotation** rows. A
scored axis is a number in 0–1 (`value_json.axis`) with a direction: `pro` means higher is
better for a target, `con` means higher is a concern. The raw fields (log2FC, LOEUF, Chronos
mean, …) are stored next to the axis in real units so filters can use them.

The formulas below are the ones in the lineage records; a snapshot's own **Runs** page is the
authority for what actually ran on it.

## Scored axes

| axis | measures | formula | source |
|---|---|---|---|
| **Expression** (`expression_tvn`) | tumour vs normal mRNA change | `clamp01(|log2FC| / 4)`; magnitude only, direction kept separately | UCSC Xena Toil (TCGA vs GTEx) |
| **Proteomics** | tumour vs normal-adjacent protein change | `clamp01(|log2FC| / 3)` (cohort scale) | CPTAC via LinkedOmics |
| **Dependency** | CRISPR knockout fitness effect in the disease's cell lines | `clamp01(−mean Chronos)` | DepMap Public |
| **Safety** (`con`) | human loss-of-function constraint | `clamp01(1 − LOEUF / 1.5)`, pLI fallback; LOEUF > 3 discarded | gnomAD v4 |
| **Tissue** | how tissue-restricted normal expression is | `clamp01(tau)` — Yanai tau over 54 tissues | GTEx v8 |
| **Mutation** | somatic mutation frequency in the cohort | `clamp01(mutated / total)` | cBioPortal (TCGA PanCancer Atlas) |
| **Druggability** | how far a drug against the target has got | label map: clinically validated 1.0 → tractable-only 0.3 → none 0 | Open Targets |
| **Clinical** | trials against the target in this disease | `clamp01(max_phase / 4 + min(0.10, 0.02·ln(1 + n_drugs)))` | Open Targets known drugs |
| **Literature** (`literature_epmc`) | how recent the literature is | `clamp01(papers in last 3 y / all papers)`; null under 5 papers | Europe PMC |
| **Network** | importance in the disease's PPI network and proximity to the top seeds | WINNER score and RWR score, each normalised to the node set | STRING v12 |

## Annotation rows (not scored)

- `annotation` — approved name, biotype, subcellular class, pathways, paralogs (Open Targets)
- `literature` — PubMed paper counts and recency
- `patents` — EPO patents naming the gene (Europe PMC)

They feed the dossier and the co-pilot; the board never ranks on them.

## Two things worth knowing

- **Expression and proteomics reward change in either direction.** A gene that is *down* at
  the protein level scores as high as one that is *up*, at equal magnitude. The direction is
  stored and shown; it is not penalised. Whether it should be is an open scoring decision.
- **A null axis is handled two ways.** For the **core** biology criteria — genetics,
  expression, dependency, tractability, safety — a missing value is a real evidence gap and
  the board penalises it. For the **context** criteria — clinical, literature, network — a
  missing value is neutral, so a genuinely novel target with no trials and few papers is not
  punished for lacking attention. An axis absent for the *whole* disease (e.g. somatic mutation
  in a non-cancer) is dropped from the weight budget entirely.

The board's weights, gates and the modality logic that sit on top of these axes are described
in the app under **Methodologies**.
