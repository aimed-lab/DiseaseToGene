# Disease2Target Case Studies and Benchmark Plan

This document turns the current Disease2Target app into a study plan that can support demos, validation, and publication-style claims.

## App Capability Summary

Disease2Target is a disease-to-target prioritization workspace. It starts from a disease search, retrieves associated targets, calculates multi-factor target scores, adds external evidence, and lets a scientist filter, compare, export, and interrogate results.

Current implemented capabilities:

- Disease normalization and disease lookup through Open Targets, with Gemini/NVIDIA fallback for imprecise names.
- Target ranking from Open Targets target-disease associations.
- GET score: genetics, expression, and tractability-derived targetability.
- Clinical drill-down from ClinicalTrials.gov, including trial count, max phase, interventional studies, phase breakdown, active trial status, top interventions, and sponsor breakdown.
- PubMed and Europe PMC literature counts, recent-paper counts, velocity, latest papers, and top article metadata.
- PubTator3 literature mining to extract disease-associated gene mentions and rank genes by publication velocity.
- Pathway enrichment through Enrichr across KEGG, Reactome, and WikiPathways.
- Protein interaction network scoring through STRING plus Random Walk with Restart and WINNER.
- Protein Atlas tissue and single-cell TAU specificity enrichment.
- Bimodality tissue scores across 36 tissue categories.
- TCGA/AIMED cancer cohort and expression views for supported cancer types: BRCA, BLCA, CESC, CHOL, and KIRC.
- PDF paper extraction with structured gene, disease, chemical, variant, model, funding, and finding extraction.
- Co-pilot chat with tool execution against the current research state.
- Export to CSV, DOCX, and Notion.

## Case Study 1: Alzheimer's Disease Target Triage

### Purpose

Show that the app can reproduce established neurodegeneration targets while surfacing literature-driven and tissue-relevant candidates for review.

### Primary Question

Can Disease2Target prioritize Alzheimer's disease targets using genetics, brain expression/specificity, literature velocity, clinical translation evidence, and network proximity?

### Workflow

1. Search disease: `Alzheimer's disease`.
2. Load the initial Open Targets target set.
3. Allow drill-down for the top targets to populate trials, literature counts, recent papers, and clinical flags.
4. Enable PubTator literature mining and add high-velocity literature genes to the target list.
5. Run RWR and WINNER over the Open Targets plus literature-expanded gene set.
6. Inspect TAU and bimodality columns for brain neurons and brain non-neurons.
7. Upload 3-5 representative Alzheimer's papers with PDF extraction, then add extracted genes tagged as `PAPER`.
8. Export the filtered result as DOCX and CSV.

### Candidate Gold Standard

Use a literature-curated target list for Alzheimer's disease. Include known or strongly studied genes such as `APOE`, `APP`, `PSEN1`, `PSEN2`, `TREM2`, `BACE1`, `MAPT`, `CLU`, `BIN1`, `ABCA7`, `PICALM`, and `SORL1`.

### App Features Demonstrated

- Disease search and target prioritization.
- GET score and adjustable weights.
- PubTator3 gene discovery and publication velocity.
- PubMed/Europe PMC evidence drill-down.
- Brain tissue bimodality and Protein Atlas specificity.
- STRING network expansion with RWR and WINNER.
- PDF paper extraction into addable target candidates.
- Co-pilot querying and report export.

### Evaluation Metrics

- Recall@10 and Recall@25 against the curated Alzheimer's target set.
- Mean reciprocal rank for `APOE`, `APP`, `PSEN1`, `PSEN2`, `TREM2`, and `BACE1`.
- Evidence coverage: fraction of top 25 targets with genetics, expression, tractability, literature, and trial signals populated.
- Novelty split: number of top 25 targets that are not in the initial Open Targets top 25 but enter through PubTator/PDF/network expansion.
- Interpretability score: percentage of top 10 targets with at least one pathway, paper, and clinical/literature explanation.

### Claim This Case Study Can Support

Disease2Target can integrate established genetic evidence with dynamic literature mining and network propagation to produce a ranked, explainable target shortlist for Alzheimer's disease. A stronger claim such as "outperforms Open Targets alone" should only be made if Disease2Target improves Recall@K or nDCG against the gold standard.

## Case Study 2: Breast Cancer / BRCA Translational Prioritization

### Purpose

Show the app's oncology capacity: target ranking, trial landscape, druggability, pathway enrichment, and cancer cohort expression.

### Primary Question

Can Disease2Target prioritize breast cancer targets by combining known biology, clinical trial maturity, druggability, pathway context, network centrality, and BRCA cohort expression evidence?

### Workflow

1. Search disease: `breast cancer` or `breast carcinoma`.
2. Confirm the app detects the BRCA cancer type and enables cohort/expression views.
3. Load targets, enrich drill-down data, and sort by final score.
4. Compare ranks by Open Targets overall score, GET score, final score, RWR score, and WINNER score.
5. Inspect clinical trials for high-priority targets, including max phase, active trials, sponsor mix, and top interventions.
6. Review KEGG/Reactome/WikiPathways enrichment for cell cycle, PI3K/AKT, estrogen signaling, DNA repair, immune checkpoint, and growth factor pathways.
7. Use raw/cohort expression views to verify expression patterns for shortlisted genes.
8. Export a report for top 20 targets.

### Candidate Gold Standard

Use approved or clinically established breast cancer targets and biomarkers, including `ERBB2`, `ESR1`, `PGR`, `BRCA1`, `BRCA2`, `PIK3CA`, `CDK4`, `CDK6`, `EGFR`, `AKT1`, `MTOR`, `VEGFA`, `PDCD1`, `CD274`, and `PARP1`.

### App Features Demonstrated

- Cancer-type detection and BRCA cohort mode.
- Open Targets evidence plus app-specific GET/final scores.
- ClinicalTrials.gov maturity signals.
- Druggability and known-drug information.
- Pathway enrichment across three pathway libraries.
- TCGA/AIMED cancer expression.
- Network scoring with STRING/RWR/WINNER.
- Export-ready translational target table.

### Evaluation Metrics

- Recall@10 and Recall@25 for approved or clinically validated breast cancer targets.
- nDCG@25 using target labels weighted by highest clinical phase or approval status.
- Delta in rank for clinically validated targets after adding clinical and network components.
- Pathway face validity: top enriched pathways matching canonical breast cancer biology.
- Time-to-report: minutes from disease search to exported DOCX/CSV shortlist.

### Claim This Case Study Can Support

Disease2Target can generate a translational breast cancer target shortlist that combines biological association, druggability, clinical maturity, and tumor expression context in one workflow. If the benchmark shows improved nDCG@25 over Open Targets ranking alone, the claim can be strengthened to "clinical-evidence-aware ranking improves recovery of established breast cancer targets."

## Case Study 3: Crohn's Disease / IBD Emerging Target Discovery

### Purpose

Show discovery value in a non-oncology immune-mediated disease where literature velocity, clinical activity, and pathway context matter.

### Primary Question

Can Disease2Target identify both established and emerging Crohn's disease targets by integrating genetics, immune/inflammatory pathways, publication velocity, clinical trials, and network propagation?

### Workflow

1. Search disease: `Crohn's disease`.
2. Load top disease-associated targets.
3. Run PubTator mining to find high-velocity genes mentioned in Crohn's disease literature.
4. Add selected literature genes to the target list and rerun RWR/WINNER.
5. Drill down into clinical evidence for cytokine, integrin, JAK/STAT, autophagy, and barrier-function targets.
6. Compare ranking behavior before and after adding literature velocity and network scores.
7. Inspect enriched pathways for cytokine signaling, Th17 biology, JAK/STAT, TNF/NF-kB, IL-23, autophagy, and epithelial barrier programs.
8. Export a ranked discovery report and mark targets as useful/not useful/pinned.

### Candidate Gold Standard

Use targets supported by approved or advanced IBD therapies plus genetics/literature curation. Examples include `TNF`, `IL12B`, `IL23A`, `IL23R`, `JAK1`, `JAK2`, `JAK3`, `TYK2`, `ITGA4`, `ITGB7`, `CCR9`, `NOD2`, `ATG16L1`, `IRGM`, and `STAT3`.

### App Features Demonstrated

- Non-oncology disease support.
- Literature-driven candidate expansion.
- Clinical trial and sponsor maturity.
- Immune pathway enrichment.
- Network propagation beyond initial disease-associated targets.
- Co-pilot target comparison and multi-criteria filtering.

### Evaluation Metrics

- Recall@10 and Recall@25 for approved/clinical IBD targets.
- Rank improvement for `IL23R`, `JAK1`, `TYK2`, `ITGB7`, `NOD2`, and `ATG16L1` after PubTator/RWR/WINNER expansion.
- Number of targets with complete evidence packets: genetics, literature, pathway, and clinical data.
- Discovery audit: top 10 high-literature-velocity targets not present in the initial Open Targets top 25.

### Claim This Case Study Can Support

Disease2Target can combine static association evidence with current literature and network expansion to support emerging target discovery in immune disease. Avoid claiming novelty unless the benchmark uses a temporal holdout, for example evidence available before year X predicts later clinical target emergence after year X.

## Benchmark Design

### Baselines

Use these comparators because they map to real app capabilities and prior literature:

- Open Targets Platform ranking: direct target-disease association score.
- Open Targets target prioritisation factors: platform-provided tractability, safety, genetics, expression, and related factors.
- Pharos/TCRD: druggable-genome target knowledge and novelty/PubMed-style target illumination.
- DisGeNET: disease-gene association database.
- ToppGene/ToppNet: functional annotation and PPI-network candidate gene prioritization.
- DIAMOnD: disease module expansion in the interactome.
- WINNER paper baseline: weighted network prioritization against IPA and DIAMOnD where applicable.
- Ablated Disease2Target variants:
  - Open Targets only.
  - GET only.
  - GET plus clinical drill-down.
  - GET plus literature velocity.
  - GET plus RWR.
  - GET plus WINNER.
  - Full final score.

### Benchmark Tasks

1. Established-target recovery
   - For each disease, rank all candidate genes.
   - Gold standard: approved/advanced clinical targets plus expert-curated disease genes.
   - Metrics: Recall@K, Precision@K, MRR, nDCG@K.

2. Temporal holdout discovery
   - Freeze evidence to a historical cutoff year if feasible.
   - Predict targets that later gained clinical trials, approvals, or strong literature growth.
   - Metrics: AUROC/AUPRC, Recall@K, time-to-detection advantage.

3. Network expansion benchmark
   - Start with seed genes only.
   - Compare Disease2Target RWR/WINNER expansion against DIAMOnD, ToppNet, and WINNER paper expectations.
   - Metrics: held-out seed recovery, disease module enrichment, pathway coherence, and rank of later-known genes.

4. Evidence completeness benchmark
   - Measure how often each system returns the evidence needed for a decision.
   - Metrics: fraction of targets with genetics, expression, tractability, literature, trial, pathway, network, and tissue specificity evidence.

5. Workflow benchmark
   - Compare time and manual steps needed to go from disease name to export-ready target report.
   - Metrics: time-to-shortlist, number of external websites/manual exports required, number of generated report fields.

### Recommended Disease Panel

Use 8-12 diseases across areas so the result does not look cherry-picked:

- Alzheimer's disease.
- Breast cancer.
- Crohn's disease.
- Type 2 diabetes.
- Rheumatoid arthritis.
- Asthma.
- Chronic kidney disease.
- Parkinson's disease.
- Melanoma.
- Idiopathic pulmonary fibrosis.

### Primary Benchmark Table

| Model/System | Inputs | Output | Strength | Gap Disease2Target Can Address |
|---|---|---|---|---|
| Open Targets Platform | Disease/target evidence | Association-ranked targets | Strong public evidence integration | Limited app-specific multi-criteria workflow, local clinical/literature velocity, custom exports |
| Pharos/TCRD | Target-centric druggable genome data | Target pages and target search | Target knowledge, novelty, druggability | Less disease-specific full workflow from disease to ranked target report |
| DisGeNET | Curated and text-mined disease-gene associations | Disease-gene association lists | Broad disease-gene knowledgebase | Less translational prioritization with trials, pathway, network, and expression specificity |
| ToppGene/ToppNet | Training genes and candidate genes | Prioritized candidates | Established gene prioritization and enrichment | Requires seed/candidate setup; less integrated clinical/literature velocity workflow |
| DIAMOnD | Disease seed genes and interactome | Disease module expansion | Strong network module expansion | Network-only compared with full evidence packet |
| WINNER | Gene set and weighted network | Network-prioritized genes | Weighted network prioritization | Disease2Target embeds WINNER alongside disease, clinical, literature, pathway, and export layers |
| Disease2Target Full | Disease name, APIs, literature, network, optional PDFs | Ranked, explainable target shortlist | End-to-end evidence workflow | Needs formal benchmark before superiority claims |

## Claim Ladder

Use conservative claims until benchmark results are available:

- Safe claim now: "Disease2Target integrates target association, genetics, expression, tractability, clinical trials, literature velocity, pathway enrichment, tissue specificity, and network propagation in one interactive disease-to-target workflow."
- Claim after case studies: "Across three disease case studies, Disease2Target recovered established targets and produced interpretable evidence packets for target review."
- Claim after benchmark: "Disease2Target improved Recall@25/nDCG@25 over Open Targets-only ranking on X/Y diseases."
- Claim after temporal holdout: "Disease2Target identified future clinical/literature-emerging targets earlier than baseline rankings under a temporal holdout design."
- Claim after user study: "Disease2Target reduced manual evidence-gathering time by X% versus a conventional multi-site workflow."

Avoid these claims unless proven:

- "Novel targets" without temporal holdout or expert validation.
- "Better than Open Targets" without a fixed test set and metrics.
- "Clinically validated" unless the target has trial/approval evidence.
- "AI-discovered" when the model mainly extracts, ranks, or summarizes public evidence.

## Data Collection Template

For each disease, export a CSV with these columns:

- Disease name.
- Target symbol.
- Rank by Open Targets overall score.
- Rank by GET score.
- Rank by final Disease2Target score.
- Genetic score.
- Expression score.
- Tractability/target score.
- Literature score.
- PubTator total papers.
- PubTator recent papers.
- Literature velocity.
- Clinical trial count.
- Interventional trial count.
- Max phase.
- Active trial present.
- RWR score.
- WINNER score.
- TAU tissue score.
- TAU single-cell score.
- Max bimodality tissue and score.
- Top enriched pathways containing target.
- Gold-standard label.
- Evidence notes.

## Suggested Figures

- Figure 1: Disease2Target workflow diagram from disease input to exported target report.
- Figure 2: Case study target rank comparison across Open Targets, GET, RWR, WINNER, and final score.
- Figure 3: Recall@K curves across baselines and Disease2Target variants.
- Figure 4: Evidence completeness heatmap by system and disease.
- Figure 5: Literature velocity versus clinical maturity scatterplot.
- Figure 6: Network view for one case study showing seed genes, added literature genes, and high-scoring network neighbors.

## Key References and Comparators

- Open Targets Platform documentation on target prioritisation factors: https://platform-docs.opentargets.org/web-interface/target-prioritisation
- Open Targets evidence scoring documentation: https://platform-docs.opentargets.org/evidence
- Open Targets Platform NAR paper: https://academic.oup.com/nar/article/49/D1/D1302/5983621
- Open Targets update paper: https://academic.oup.com/nar/article/47/D1/D1056/5193331
- Pharos about page: https://pharos.nih.gov/about
- Pharos NAR paper: https://academic.oup.com/nar/article/45/D1/D995/2605932
- DisGeNET gene-disease association paper: https://bmcbioinformatics.biomedcentral.com/articles/10.1186/s12859-015-0472-9
- ToppGene Suite paper: https://academic.oup.com/nar/article/37/suppl_2/W305/1149611
- Endeavour gene prioritization paper: https://www.nature.com/articles/nbt1203
- DIAMOnD disease module algorithm: https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1004120
- WINNER network prioritization paper: https://www.frontiersin.org/articles/10.3389/fdata.2022.1016606/full
- PubTator 3.0 paper: https://academic.oup.com/nar/article/52/W1/W540/7640526
- Enrichr 2016 update: https://academic.oup.com/nar/article-lookup/doi/10.1093/nar/gkw377
- Human Protein Atlas tissue resource: https://www.proteinatlas.org/tissue/
- Human genetics and drug approval support, Nelson et al. 2015: https://pubmed.ncbi.nlm.nih.gov/26121088/
- Revised genetic support estimates, King et al. 2019: https://journals.plos.org/plosgenetics/article?id=10.1371/journal.pgen.1008489
- Refining the impact of genetic evidence on clinical success, Nature 2024: https://www.nature.com/articles/s41586-024-07316-0
- Temporal trends in evidence supporting novel drug target discovery, Nature Communications 2025: https://www.nature.com/articles/s41467-025-67180-y

## Immediate Next Steps

1. Run the three case studies and export CSV/DOCX outputs.
2. Freeze a disease panel and gold-standard labels before tuning scoring weights.
3. Add an automated benchmark script that replays disease searches, captures rankings, and calculates Recall@K, MRR, and nDCG.
4. Add an "evidence completeness" score to the exported table.
5. Decide whether the benchmark claim should target "better ranking", "better evidence completeness", or "faster expert workflow"; those are different claims and need different evaluation designs.
