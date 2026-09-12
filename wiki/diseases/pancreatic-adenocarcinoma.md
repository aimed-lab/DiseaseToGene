---
title: Pancreatic adenocarcinoma
mondo: MONDO_0006047
disease_name: pancreatic adenocarcinoma
---

Pancreatic ductal adenocarcinoma is the common form of pancreatic cancer and one of the
least tractable solid tumours: five-year survival remains in the low teens, most patients
present with unresectable disease, and the mutational landscape is dominated by four genes
— **KRAS** (activating mutations in roughly nine of ten tumours), **TP53**, **CDKN2A** and
**SMAD4** — none of which was druggable for most of the field's history. That has changed
at the first of them: mutant-selective KRAS inhibitors, including pan-RAS and G12D-directed
agents, are now in trials, which is why the clinical axis in this snapshot is worth reading
alongside the mutation axis rather than after it.

## What this snapshot holds

Snapshot **#102** is the eighth version of the pancreatic cohort, harvested on 24 July 2026
from Open Targets' association list for `MONDO_0006047`, then enriched axis by axis over the
following two weeks. It is the only pancreatic snapshot with all twelve evidence axes:

- **Expression** from TCGA-PAAD tumours against GTEx pancreas normals (Xena Toil).
- **Proteomics** from the CPTAC PDAC cohort (140 tumours, 75 normal-adjacent), which lets the
  mRNA and protein axes be read against each other — a gene up at the transcript and down at
  the protein is a different target from one up at both.
- **Dependency** from 48 pancreatic cell lines in DepMap.
- **Mutation** from the TCGA PanCancer Atlas cohort (179 samples) in cBioPortal.
- **Safety**, **tissue**, **druggability**, **clinical**, **literature** and **network**
  as for every cohort.

The knowledge graph for the snapshot links 1,226 genes to 556 drugs, 448 trials, 830
pathways and 696 papers.

## How to read it

The lineage of this snapshot is **reconstructed**, not recorded: the harvest ran before the
pipeline wrote its own run records, so the runs page was assembled afterwards from git
history. Most entries are high-confidence; the candidate cutoff and the Open Targets release
are inferred, and the network run's node-set size is lost. Every run says which it is.

Two things to keep in mind when reading a gene page here:

- The expression and proteomics axes score **magnitude**, not direction. A strongly
  *down*-regulated protein scores as high as a strongly *up*-regulated one. The direction is
  on the row; look at it.
- The clinical axis is scoped to trials **for this disease**. A target with a Phase 3 drug in
  another cancer and nothing in pancreatic cancer scores as untested here — which is the
  point.
