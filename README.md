# Disease2Target — AI-Powered Drug Target Prioritization

An AI-powered platform that takes a disease name and produces a ranked, evidence-weighted list of drug targets by aggregating data from Open Targets, PubMed, ClinicalTrials.gov, Protein Atlas, STRING-DB, Enrichr, and more — no manual curation required.

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```
   npm install
   ```

2. Set the `GEMINI_API_KEY` in `.env` to your Gemini API key:
   ```
   GEMINI_API_KEY=your_key_here
   ```

3. Run the app:
   ```
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000)

`npm run dev` starts the Express API and Vite middleware together.

## Optional Environment Variables

| Variable | Description |
|---|---|
| `NOTION_TOKEN` | Notion integration token — enables Export → Notion |
| `NOTION_DATABASE_ID` | Target Notion database ID |
| `GEMINI_MODEL` | Gemini model override; defaults to `gemini-2.5-flash` |
| `NCBI_API_KEY` | Raises the PubMed E-Utilities request allowance |
| `AI_RATE_LIMIT_MAX_REQUESTS` | Maximum AI requests per client per minute; defaults to 20 |

## What It Does

- **Target table** — ranks genes by GET Score (Genetic × 0.50 + Expression × 0.25 + Tractability × 0.25) with configurable visible columns, sortable headers, and dual-handle range filters
- **Pathway enrichment** — parallel KEGG, Reactome, and WikiPathways queries via Enrichr with FDR, gene overlap, and source filtering
- **Literature tab** — PubTator3 gene-mention mining with publication velocity scoring
- **Drill-down panel** — per-target ClinicalTrials data, PubMed stats, Europe PMC velocity, and AI-generated summary
- **Network scoring** — optional RWR (Random Walk with Restart) and WINNER scores via STRING-DB protein interaction network
- **TAU scores** — Protein Atlas tissue and single-cell specificity loaded in background after initial results
- **Export** — filtered table to CSV, DOCX, or Notion database
- **Co-Pilot** — context-aware Gemini AI assistant with full research state

## Data Sources

Open Targets · Protein Atlas · PubTator3 / PubMed · Europe PMC · ClinicalTrials.gov · STRING-DB · Enrichr (KEGG / Reactome / WikiPathways) · Google Gemini
