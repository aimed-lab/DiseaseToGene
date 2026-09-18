---
title: SRC in pancreatic adenocarcinoma
gene: SRC
mondo: MONDO_0006047
disease_name: pancreatic adenocarcinoma
snapshot: 143
generated_by: human
author: Nikhil Kurmachalam
audit_status: not_audited
sources:
  - /wiki/pancreatic-adenocarcinoma/143/gene/SRC
  - /wiki/pancreatic-adenocarcinoma/143/runs
  - /wiki/pancreatic-adenocarcinoma/143/trial/NCT00735917
  - /wiki/pancreatic-adenocarcinoma/143/trial/NCT00544908
  - /wiki/pancreatic-adenocarcinoma/143/trial/NCT02436668
  - /wiki/pancreatic-adenocarcinoma/143/gene/PTK2
  - /wiki/pancreatic-adenocarcinoma/143/gene/KRAS
  - docs/HANDOFF_SRC_Case_Study.md (the replication study; not stored rows)
---

## Why this gene is on the board

SRC is a non-receptor tyrosine kinase that sits downstream of most of the receptors that matter in
this tumour — EGFR, PDGFR, integrins — and it is ranked **252 of 6,000** on the small-molecule board
(score 75; leader 100) in this harvest. Open Targets put it 296th by association (0.305), so the
board moves it up slightly, and the reason is visible in the criteria: two axes are at the ceiling
and four are near the floor.

| criterion (weight) | score 0–100 | reading |
|---|---|---|
| Tractability (20 %) | **100** | clinically validated — 11 developed drugs |
| Network (10 %) | **100** | 99.8th percentile disease-network centrality, rank 10 of 5,531 |
| Literature (5 %) | 69 | 2,713 papers, a third in the last three years |
| Clinical (10 %) | 53 | 5 drugs in pancreatic trials, none past Phase 2 |
| Expression (12 %) | 27 | up 1.46 log2 in tumour vs normal |
| Dependency (15 %) | 22 | Chronos −0.22; 15 % of pancreatic lines |
| Safety (13 %) | 11 | pLI 1.00, LOEUF 0.33 — constrained |
| Genetics (15 %) | 1 | 1 % of the cohort mutated |

So SRC is a **druggable, over-expressed, non-mutational** target. What holds it back is exactly what
a standalone target needs: a genetic anchor, a dependency signal, and a safety margin. All rows and
scores: [SRC in snapshot 143](/wiki/pancreatic-adenocarcinoma/143/gene/SRC).

## Evidence by axis

- **Expression (mRNA, tumour vs normal)** — up, log2FC 1.461 (p ≈ 0), TCGA-PAAD tumours against GTEx
  pancreas via UCSC Xena Toil. This is the replicated over-expression from the original paper.
- **Proteomics (protein, tumour vs normal)** — up, log2FC 0.542 (p ≈ 0), CPTAC PDAC proteome; the
  axis value is divided by three for tumour-vs-normal designs. mRNA and protein agree in direction.
- **Dependency (CRISPR)** — mean Chronos −0.217 across pancreatic lines; 15 % of lines below the
  dependency threshold. Weak as a pan-line dependency (see the case study below for why).
- **Safety (constraint)** — gnomAD v4 pLI 1.00, LOEUF 0.33: loss-of-function intolerant. Scored as a
  concern, not a merit.
- **Tissue specificity** — GTEx tau 0.29, highest in uterus: ubiquitous, the second safety flag.
- **Somatic mutation** — 1 % of the TCGA PanCancer PDAC cohort (D351N). SRC is not a mutational
  driver here; KRAS is, in 65 %.
- **Druggability** — "Clinically Validated": bosutinib, dasatinib, tirbanibulin, vandetanib,
  saracatinib and six investigational compounds; three tractable modalities.
- **Clinical** — see the next section.
- **Literature** — 2,713 Europe PMC co-mentions with the disease, 33 % in the last three years.
- **Network (WINNER + RWR)** — 99.8th percentile centrality within the pancreatic candidate graph,
  964 STRING partners in the graph. WINNER tracks connectivity, so "central" here means "well
  connected" at least as much as "disease-specific".

Every row carries its source, retrieval date and run on the
[gene page](/wiki/pancreatic-adenocarcinoma/143/gene/SRC); the runs are on the
[lineage page](/wiki/pancreatic-adenocarcinoma/143/runs).

## Druggability and trials

Five SRC-family inhibitors have been tried in pancreatic cancer, all Phase 2, all a decade old:

| drug | trial | phase · status | note |
|---|---|---|---|
| dasatinib | [NCT00474812](/wiki/pancreatic-adenocarcinoma/143/trial/NCT00474812) · [NCT01234935](/wiki/pancreatic-adenocarcinoma/143/trial/NCT01234935) · [NCT01395017](/wiki/pancreatic-adenocarcinoma/143/trial/NCT01395017) · [NCT01652976](/wiki/pancreatic-adenocarcinoma/143/trial/NCT01652976) | 2 · completed | 2007–2012; NCT01395017 ran at 74 sites |
| dasatinib | [NCT00544908](/wiki/pancreatic-adenocarcinoma/143/trial/NCT00544908) | 2 · **terminated — toxicity** | the one stop-for-safety in the set |
| saracatinib | [NCT00735917](/wiki/pancreatic-adenocarcinoma/143/trial/NCT00735917) | 2 · completed | NCI, 9 sites, 2008 |
| vandetanib | [NCT00566995](/wiki/pancreatic-adenocarcinoma/143/trial/NCT00566995) · [NCT01601808](/wiki/pancreatic-adenocarcinoma/143/trial/NCT01601808) | 2 · completed | multi-kinase; SRC is one of its targets |

That is why the clinical score is 53 and not higher: precedent, but no Phase 3 and no approval in
this disease. The board treats "tried and stalled at Phase 2" as exactly that.

Listed but **not scored** — drugs DGIdb (Guide to Pharmacology / TTD) maps to SRC that Open
Targets does not yet: ibrutinib ([NCT02436668](/wiki/pancreatic-adenocarcinoma/143/trial/NCT02436668),
Phase 3, completed), masitinib (two Phase 3s), acalabrutinib (two Phase 2s). These are BTK / KIT
drugs with SRC-family activity, tested in pancreatic cancer for other reasons; they are on the page
so the reader sees them, and off the score so polypharmacology does not inflate it.

## Interacting partners worth a look

The store's STRING neighbourhood of SRC, with each partner's own board standing in this harvest:

| partner | board rank · score | why it matters |
|---|---|---|
| [KRAS](/wiki/pancreatic-adenocarcinoma/143/gene/KRAS) | 2 · 100 | the driver; SRC signals below it |
| [ERBB2](/wiki/pancreatic-adenocarcinoma/143/gene/ERBB2) | 72 · 84 | best-ranked SRC partner |
| [ITGB3](/wiki/pancreatic-adenocarcinoma/143/gene/ITGB3) | 121 · 81 | integrin — the adhesion arm of SRC signalling |
| [MET](/wiki/pancreatic-adenocarcinoma/143/gene/MET) | 175 · 78 | |
| [IGF1R](/wiki/pancreatic-adenocarcinoma/143/gene/IGF1R) | 178 · 78 | |
| [PTK2 (FAK)](/wiki/pancreatic-adenocarcinoma/143/gene/PTK2) | 293 · 74 | SRC's direct substrate; the focal-adhesion axis |
| [EGFR](/wiki/pancreatic-adenocarcinoma/143/gene/EGFR) | 313 · 74 | |
| [PDGFRB](/wiki/pancreatic-adenocarcinoma/143/gene/PDGFRB) | 368 · 72 | |
| [PTK2B](/wiki/pancreatic-adenocarcinoma/143/gene/PTK2B) | 987 · 62 | FAK's paralog |

Two things to notice. First, the board does not rank FAK above SRC — 293 against 252 — so the move
from SRC to FAK is a *lateral* move on this evidence, not an upgrade; what FAK offers is a different
liability profile, not a better score. Second, the partners that outrank SRC are the receptors
upstream of it, which is the biology: SRC is the hub, not the entry point.

## What the data does not show

- **No survival separation.** The store holds no survival axis; the case study (below) found none.
- **No selective dependency.** 15 % of lines is weak, and the store cannot say *which* lines —
  that stratification is outside the snapshot.
- **No Phase 3 for an SRC-selective drug.** The Phase 3s on the page belong to BTK/KIT drugs listed
  via DGIdb.
- **Safety is a real concern, not a scoring artefact.** Constrained gene, ubiquitous expression,
  one trial stopped for toxicity.

## From the SRC case study — not stored rows

*This section is narrative from `docs/HANDOFF_SRC_Case_Study.md` (the replication of Zhang & Chen
from public data). Nothing in it is an evidence row; it is here because it changes how the rows
above should be read.*

- Over-expression replicated: log2FC +1.46 (tumour 5.72 vs normal 4.26, n = 178/167), the same
  number the expression row holds.
- Survival, SRC-high vs low: HR 1.37, p = 0.135 — direction only, not significant.
- SRC × KRAS: in KRAS-mutant lines SRC dependency is stronger (p = 0.047, pan-cancer; same direction
  in pancreatic lines but under-powered), and SRC-high status co-occurs with KRAS mutation (66 % vs
  21 %).

**Reading:** SRC fails as a standalone target — no genetic anchor, weak dependency, real safety
flags, Phase 2 precedent that went nowhere. It is a plausible **KRAS co-target**: the dependency
appears where KRAS is mutant, which is nine of ten of these tumours. That is a hypothesis for the
bench, not a conclusion the board can reach; the board is right to leave SRC at 252.
