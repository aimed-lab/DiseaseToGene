<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Disease2Target

**AI-powered drug target prioritization platform**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-dev-646cff?logo=vite)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)](https://expressjs.com/)

</div>

---

## What it does

Disease2Target takes a disease name and produces a ranked, evidence-weighted list of drug targets by pulling data from multiple public databases in parallel — no manual curation required.

Each target is scored across four axes, combined into a **GET Score** (Genetic × 0.50 + Expression × 0.25 + Target tractability × 0.25), with optional network-propagation reranking via RWR and WINNER algorithms.

---

## Data Sources

| Source | What it provides |
|---|---|
| [Open Targets](https://platform.opentargets.org/) | Gene–disease associations, expression scores, tractability |
| [Protein Atlas](https://www.proteinatlas.org/) | TAU tissue & single-cell specificity scores |
| [PubTator3 / PubMed](https://www.ncbi.nlm.nih.gov/research/pubtator3/) | Literature mining, publication velocity |
| [Europe PMC](https://europepmc.org/) | Paper counts, recent signal velocity |
| [ClinicalTrials.gov](https://clinicaltrials.gov/) | Trial count, phase breakdown, active trials |
| [STRING-DB](https://string-db.org/) | Protein interaction network for RWR/WINNER |
| [Enrichr](https://maayanlab.cloud/Enrichr/) | Pathway enrichment (KEGG, Reactome, WikiPathways) |
| [Google Gemini](https://ai.google.dev/) | Co-Pilot AI, disease name correction, target summaries |

---

## Scoring

### GET Score
```
GET = Genetic × 0.50 + Expression × 0.25 + Target × 0.25 + velocity bonus
```

### Optional network scores
- **RP Score** — Random Walk with Restart on the STRING interaction network; measures proximity to user-defined seed genes
- **WINNER Score** — Weighted Iterative Network-based scoring (Nguyen T et al. 2022, *Frontiers in Big Data*); identifies central nodes in the interactome
- **Final Score** — `GET × 0.50 + RP × 0.25 + WINNER × 0.25`

---

## Features

- **Multi-source evidence table** — configurable columns (Genetic, Expression, Target, Literature, GET, RP, WINNER, TAU Tissue, TAU Cell, Final Score)
- **Column sorting** — click any header to sort ascending/descending
- **Dual-handle range sliders** — filter by exact score range on any metric
- **Pathway enrichment tab** — KEGG, Reactome, and WikiPathways results with FDR, gene overlap, and source filter tabs
- **Literature tab** — PubTator gene-mention analysis with publication velocity
- **Drill-down panel** — per-target clinical trial data, PubMed stats, Europe PMC velocity, AI-generated summary
- **Export** — CSV, DOCX (full filtered table), or Notion database
- **Co-Pilot chat** — context-aware AI assistant with full research state
- **TCGA cohort view** — expression and clinical data from AIMED UAB

---

## Architecture

```
Browser (React 19 + Vite)
  └── api.ts          — all Open Targets / Enrichr / PubTator calls
  └── index.tsx       — main App component (~4500 lines)
  └── rwr.ts          — Random Walk with Restart algorithm
  └── winner.ts       — WINNER network scoring algorithm
  └── PaperExtractor  — paper analysis via AI

Express server (server.ts)
  ├── /api/proxy          — CORS proxy (allowlist: 4 hosts)
  ├── /api/pubtator/*     — PubTator3 proxy with retry + rate-limit handling
  ├── /api/ai/chat        — NVIDIA NIM proxy
  └── /api/export/notion  — Notion database export
```

All external calls from the browser are routed through the Express proxy to avoid CORS restrictions. The allowlisted hosts are: `clinicaltrials.gov`, `www.ebi.ac.uk`, `eutils.ncbi.nlm.nih.gov`, `www.proteinatlas.org`.

---

## Quick Start

### Prerequisites
- Node.js 18+
- A Google Gemini API key

### Setup

```bash
git clone https://github.com/aimed-lab/GetDiseaseTarget.git
cd GetDiseaseTarget
npm install
```

Create a `.env` file:
```env
GEMINI_API_KEY=your_gemini_key_here

# Optional
NOTION_TOKEN=your_notion_integration_token
NOTION_DATABASE_ID=your_database_id
NVIDIA_API_KEY=your_nvidia_key
```

### Run

```bash
npx tsx server.ts
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** The app requires `npx tsx server.ts` (not `npm run dev`) so the Express proxy starts alongside Vite. Running Vite alone will cause all external API calls to return empty results.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini API — Co-Pilot, disease correction, target summaries |
| `NOTION_TOKEN` | No | Notion integration token for export |
| `NOTION_DATABASE_ID` | No | Target Notion database ID |
| `NVIDIA_API_KEY` | No | NVIDIA NIM — fallback AI for disease correction and summaries |

---

## Contributing

Pull requests welcome. Please open an issue first for significant changes.

---

<div align="center">
Built at <a href="https://www.uab.edu/medicine/aimed/">AIMED Lab, UAB</a>
</div>
