# The 12 evidence axes — what each needs to run

`enrich <id> all` runs the axes in this order (cheap and local first, so a late failure costs
the least). Each is idempotent: re-running an axis replaces that axis's rows for that
snapshot and nothing else.

| # | axis | `evidence_type` | source | how it runs | needs on the VM | time (6k genes) |
|---|---|---|---|---|---|---|
| 1 | expression | `expression_tvn` | UCSC Xena Toil (TCGA tumour vs GTEx normal, log2 TPM) | local table `data/expression_<cohort>.json` | the table (committed for pdac, gbm, ad) | seconds |
| 2 | proteomics | `proteomics` | CPTAC via LinkedOmics / PDC (protein log2FC) | local table `data/proteomics_<cohort>.json` | the table (committed for pdac, gbm, ad) | seconds |
| 3 | dependency | `dependency` | DepMap CRISPR (Chronos), lineage-filtered | local table `data/depmap_<cohort>.json` | the table (committed for pancreatic, gbm) | seconds |
| 4 | safety | `safety` | gnomAD v4.1 constraint (pLI, LOEUF) | local table `data/gnomad_constraint.json` | the table (committed) | seconds |
| 5 | tissue | `tissue` | GTEx v8 median TPM → tau | local table `data/tissue_specificity.json` | the table (committed) | seconds |
| 6 | mutation | `mutation` | cBioPortal, one TCGA PanCancer study per disease | **one** API call for the cohort | HTTPS to `www.cbioportal.org` | 1–2 min |
| 7 | annotation | `annotation` | Open Targets target annotation (name, biotype, location, pathways) | API, per gene | HTTPS to `api.platform.opentargets.org` | 20–40 min |
| 8 | druggability | `druggability` | Open Targets known drugs + tractability | API, per gene | same | 20–40 min |
| 9 | clinical | `clinical` | Open Targets drug trials, scoped to the disease's ontology ids | API, per gene (+ one scope call) | same | 30–60 min |
| 10 | patents | `patents` | Europe PMC, EPO patent index | API, per gene | HTTPS to `www.ebi.ac.uk` | 20–40 min |
| 11 | literature | `literature_epmc` (scored) + `literature` (PubMed, annotation only) | Europe PMC · NCBI E-utilities | API, per gene, both | HTTPS to `www.ebi.ac.uk`, `eutils.ncbi.nlm.nih.gov` | 30–60 min |
| 12 | network | `network` | STRING v12.0 PPI (score ≥ 400) · WINNER + RWR | local STRING files + the `winner` CLI (Python) | `WINNER/data/*.v12.0.txt.gz`, `winner` on PATH | 5–15 min |

After the axes: `kg <id>` projects EVIDENCE into `KG_NODES` / `KG_EDGES` (genes, drugs, trials,
pathways, papers, tissues, variants) — the link structure the wiki and the co-pilot's
`query_graph` read. Local; a minute or two.

## Which axes are disease-specific

Only **expression, proteomics and dependency** need a per-disease reference table, and only
those three need an entry in `data/disease_registry.json` (`cohorts[]`: key, MONDO id,
aliases, the Xena primary site, the DepMap lineage, output files). The registry already holds
cohorts for: pdac, gbm, brca, luad, coad, prad, ov, lihc, skcm, stad — but a reference table is
**built** only for the diseases harvested so far (pdac, gbm; proteomics also ad). Every other
axis works for any disease with no configuration: the harvest resolves the disease name
against Open Targets, and mutation resolves its cBioPortal study by name.

If a table is missing, the axis logs `… not built yet — run node scripts/build_…` and is
**skipped**, not failed; the snapshot simply has no rows for that axis, and the Ranking Board
drops the criterion for that snapshot (the weight budget renormalises).

## Adding a disease

1. Add or check its entry in `data/disease_registry.json` (MONDO id, aliases, Xena site,
   DepMap lineage).
2. Build the reference tables — these download the raw files once (into `xena_raw/`,
   `depmap_raw/`, both git-ignored) and write the committed JSON:

   ```bash
   node scripts/build_expression.mjs <key>     # Xena Toil matrix, ~1.3 GB download, reused for every cohort
   node scripts/build_depmap.mjs <key>         # DepMap CRISPRGeneEffect.csv + Model.csv, ~440 MB, reused
   node scripts/build_proteomics.mjs <key>     # CPTAC via LinkedOmics — availability varies per cancer
   ```

   Non-cancer diseases (Alzheimer's) have their own proteomics build
   (`build_proteomics_ad.mjs`, from a dataset under a data-use agreement — its raw file is
   not in the repo and cannot be downloaded by script).
3. Commit the new `data/*.json` and open a pull request — they are reference tables, part of
   the code, versioned with it. Then harvest.

## Refreshing a source

| table | rebuild with | raw source |
|---|---|---|
| `data/gnomad_constraint.json` | `node scripts/build_gnomad_constraint.mjs` | gnomAD release bucket (v4.1 constraint metrics) |
| `data/tissue_specificity.json` | `node scripts/build_tissue_specificity.mjs` | GTEx v8 median TPM |
| `data/expression_<key>.json` | `node scripts/build_expression.mjs <key>` | Xena Toil hub |
| `data/depmap_<key>.json` | `node scripts/build_depmap.mjs <key>` | DepMap current release (check the URL in the script if a download 404s) |
| `WINNER/data/*` | `bin/01-install.sh` downloads them | STRING v12.0 (`9606.protein.links`, `.info`, `.aliases`) |

A refreshed table changes the numbers for every snapshot harvested after it — that is the
point of a snapshot: the old ones keep the old values. Record the refresh in the pull request.

## Outbound hosts the VM must reach

```
api.platform.opentargets.org     harvest, annotation, druggability, clinical
www.cbioportal.org               mutation
www.ebi.ac.uk                    literature (Europe PMC), patents
eutils.ncbi.nlm.nih.gov          literature (PubMed annotation)
stringdb-downloads.org / string-db.org   STRING files (install time only)
storage.googleapis.com           gnomAD, GTEx raw files (rebuild time only)
toil-xena-hub.s3.us-east-1.amazonaws.com   Xena raw (new cohort only)
depmap.org                       DepMap raw (new cohort only)
github.com                       the repo; the winner package (install time only)
<Oracle host:port from ORACLE_CONNECT_STRING>   every write
```

## Environment variables the axes read

| name | used by | default |
|---|---|---|
| `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_CONNECT_STRING` | every write | required |
| `ORACLE_SCHEMA` | table prefix when the run user is not the schema owner | unset |
| `STRING_MIN_SCORE` | network: STRING combined-score threshold | 400 |
| `STRING_DIR` | network: where the STRING files are | `WINNER/data` |
| `KG_GENE_N`, `KG_NETWORK_N` | kg: how many genes / network rows to project | script defaults |
