<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Disease2Target — AI-Powered Drug Target Prioritization

An AI-powered platform that takes a disease name and produces a ranked, evidence-weighted list of drug targets by aggregating data from Open Targets, PubMed, ClinicalTrials.gov, Protein Atlas, STRING-DB, Enrichr, and more — no manual curation required.

View your app in AI Studio: https://ai.studio/apps/935ce7b7-a457-47fb-bf7c-c78c0b98ec5a

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
   npx tsx server.ts
   ```

   Open [http://localhost:3000](http://localhost:3000)

> **Important:** Use `npx tsx server.ts`, not `npm run dev`. The app needs the Express server running alongside Vite — without it, all external API calls (ClinicalTrials, PubMed, Protein Atlas, PubTator) will return empty results.

## Optional Environment Variables

| Variable | Description |
|---|---|
| `NOTION_TOKEN` | Notion integration token — enables Export → Notion |
| `NOTION_DATABASE_ID` | Target Notion database ID |
| `NVIDIA_API_KEY` | NVIDIA NIM — fallback AI for disease name correction and target summaries |

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
