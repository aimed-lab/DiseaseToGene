# Graph Report - N:/diseasetotarget_version2  (2026-05-10)

## Corpus Check
- Corpus is ~29,948 words - fits in a single context window. You may not need a graph.

## Summary
- 139 nodes · 197 edges · 17 communities (10 shown, 7 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.88)
- Token cost: 0 input · 60,236 output

## Community Hubs (Navigation)
- [[_COMMUNITY_UI Components & Filtering|UI Components & Filtering]]
- [[_COMMUNITY_API Client & Scoring Engine|API Client & Scoring Engine]]
- [[_COMMUNITY_Data Types & Proxy Layer|Data Types & Proxy Layer]]
- [[_COMMUNITY_Literature & Server Infrastructure|Literature & Server Infrastructure]]
- [[_COMMUNITY_External API Integrations|External API Integrations]]
- [[_COMMUNITY_Network Propagation Algorithms|Network Propagation Algorithms]]
- [[_COMMUNITY_Paper Extractor|Paper Extractor]]
- [[_COMMUNITY_Express Server Setup|Express Server Setup]]
- [[_COMMUNITY_RWR Algorithm|RWR Algorithm]]
- [[_COMMUNITY_WINNER Algorithm|WINNER Algorithm]]
- [[_COMMUNITY_TCGA Expression Data|TCGA Expression Data]]
- [[_COMMUNITY_Force Layout & Statistics|Force Layout & Statistics]]
- [[_COMMUNITY_Vite Build Config|Vite Build Config]]
- [[_COMMUNITY_Clinical Sample Interface|Clinical Sample Interface]]
- [[_COMMUNITY_Expression Row Interface|Expression Row Interface]]

## God Nodes (most connected - your core abstractions)
1. `App - Main React Component` - 12 edges
2. `ResearchContext Interface` - 9 edges
3. `api.getPubTatorLiterature` - 7 edges
4. `Target Interface` - 6 edges
5. `api.searchDiseases` - 6 edges
6. `api.getDrillDownData` - 6 edges
7. `GET /api/proxy (Generic External API Proxy)` - 6 edges
8. `proxyFetch` - 5 edges
9. `runWINNER - WINNER Prioritization Algorithm` - 5 edges
10. `Express Server` - 5 edges

## Surprising Connections (you probably didn't know these)
- `App - Main React Component` --calls--> `api.getStringInteractions`  [INFERRED]
  index.tsx → api.ts
- `fetchWithRetry` --semantically_similar_to--> `fetchPubTator (Server Helper)`  [INFERRED] [semantically similar]
  api.ts → server.ts
- `runRWR - Random Walk with Restart` --semantically_similar_to--> `runWINNER - WINNER Prioritization Algorithm`  [INFERRED] [semantically similar]
  rwr.ts → winner.ts
- `Netlify Function: pubtator-search` --semantically_similar_to--> `GET /api/pubtator/search`  [INFERRED] [semantically similar]
  netlify/functions/pubtator-search.ts → server.ts
- `Netlify Function: pubtator-export` --semantically_similar_to--> `GET /api/pubtator/export`  [INFERRED] [semantically similar]
  netlify/functions/pubtator-export.ts → server.ts

## Hyperedges (group relationships)
- **Gene Network Scoring Pipeline (STRING + RWR + WINNER)** — api_getStringInteractions, rwr_runRWR, winner_runWINNER [INFERRED 0.85]
- **PubTator Literature Pipeline (Client â†’ Server Proxy â†’ PubTator3 API)** — api_getPubTatorLiterature, server_pubtatorSearch, ext_pubtator3 [EXTRACTED 0.95]
- **Disease-to-Target Discovery Flow (Search â†’ Genes â†’ Scoring â†’ Enrichment)** — api_searchDiseases, api_getGenes, api_GETScore, api_getEnrichment [INFERRED 0.85]

## Communities (17 total, 7 thin omitted)

### Community 0 - "UI Components & Filtering"
Cohesion: 0.07
Nodes (9): CANCER_TYPE_MAP, COHORT_FILTER_GROUPS, CohortFilterKey, LEFT_NAV_ITEMS, RANKING_SLIDERS, rootElement, SCORE_SLIDERS, TABLE_COLUMNS (+1 more)

### Community 1 - "API Client & Scoring Engine"
Cohesion: 0.11
Nodes (26): GET Score (Genetic-Expression-Target Composite), api.getAiSummary, api.getEnrichment, api.getGenes, api.getTargetDrugs, api.searchDiseases, Semantic Disease Name Correction Fallback, Enrichr API (MaayanLab) (+18 more)

### Community 2 - "Data Types & Proxy Layer"
Cohesion: 0.11
Nodes (23): api, fetchWithRetry(), proxyFetch(), ChemicalResult, ClinicalSample, DiseaseInfo, DrillDownData, DrugGeneRelationship (+15 more)

### Community 3 - "Literature & Server Infrastructure"
Cohesion: 0.26
Nodes (13): fetchWithRetry, api.getPubTatorLiterature, api.getPubTatorVelocityBatch, Notion Client API, PubTator3 API (NCBI), Netlify Function: pubtator-export, Netlify Function: pubtator-search, Express Server (+5 more)

### Community 4 - "External API Integrations"
Cohesion: 0.31
Nodes (10): api.enrichTau, api.getDrillDownData, api.getPubMedStats, proxyFetch, ClinicalTrials.gov API v2, Europe PMC REST API, Protein Atlas API (TAU scores), NCBI PubMed E-Utilities API (+2 more)

### Community 5 - "Network Propagation Algorithms"
Cohesion: 0.33
Nodes (7): api.getStringInteractions, STRING-DB Protein Interaction API, StringEdge Interface, runRWR - Random Walk with Restart, WinnerStringEdge Interface, WINNER Algorithm (Nguyen T et al. 2022, Frontiers in Big Data), runWINNER - WINNER Prioritization Algorithm

### Community 6 - "Paper Extractor"
Cohesion: 0.4
Nodes (3): PaperExtractorProps, GeneResult, PaperAnalysis

### Community 10 - "TCGA Expression Data"
Cohesion: 0.67
Nodes (3): api.getTcgaClinical, api.getTcgaExpressionPage, AIMED UAB TCGA API

## Knowledge Gaps
- **37 isolated node(s):** `CANCER_TYPE_MAP`, `COHORT_FILTER_GROUPS`, `CohortFilterKey`, `SCORE_SLIDERS`, `RANKING_SLIDERS` (+32 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App - Main React Component` connect `API Client & Scoring Engine` to `Literature & Server Infrastructure`, `External API Integrations`, `Network Propagation Algorithms`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `api.getPubTatorLiterature` connect `Literature & Server Infrastructure` to `API Client & Scoring Engine`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `ResearchContext Interface` connect `API Client & Scoring Engine` to `Literature & Server Infrastructure`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `App - Main React Component` (e.g. with `api.getGenes` and `api.getEnrichment`) actually correct?**
  _`App - Main React Component` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CANCER_TYPE_MAP`, `COHORT_FILTER_GROUPS`, `CohortFilterKey` to the rest of the system?**
  _37 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Components & Filtering` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `API Client & Scoring Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._