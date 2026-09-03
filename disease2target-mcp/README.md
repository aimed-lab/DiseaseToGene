# Disease2Target MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the Disease2Target
target-discovery platform as tools any AI client can call — **Claude Desktop, Cursor,
Codex, PLEASER's agents, or your own MCP-capable app.**

It reads **live** from the public Disease2Target ORDS bridge, so:

- **No VPN, no database credentials, no API keys.**
- **Nothing to host** — it runs wherever the client runs (stdio transport).
- Data is always current with the platform's latest snapshots.

This folder is **self-contained**: its own read layer (`ords.js`) and a bundled copy of
the app's scoring engine (`board.bundle.js`). It does not import from the rest of the
Disease2Target repo at runtime. Zip it and hand it over.

**v1.1.0 (2 Sep 2026).** Adds the Ranking Board composite (`rank_board`), disease-network
centrality with context and status, proteomics by source, Agora nomination, candidate
source, snapshot provenance, network context and neighbour tools. Wording no longer
assumes cancer: Alzheimer disease is loaded alongside the cancers.

---

## Requirements

- **Node.js 18 or newer** (uses the built-in `fetch`). Check with `node --version`.

## Install & verify

```bash
cd disease2target-mcp
npm install
npm run test:quick   # bridge reachable? (2 s)
npm test             # every tool once against live data (~1 min; first board build pulls ~55k rows)
```

## Register with a client

Claude Desktop (`claude_desktop_config.json`), Cursor, and most MCP hosts take the same shape:

```json
{
  "mcpServers": {
    "disease2target": {
      "command": "node",
      "args": ["/absolute/path/to/disease2target-mcp/server.js"]
    }
  }
}
```

The server speaks **stdio**. A host that needs to reach it over the network (a server-side
agent platform) wraps it in an HTTP/SSE transport on its side; nothing here needs to change
for that, and the folder has no secrets to protect.

---

## Tools

| Tool | What it does |
|------|--------------|
| `list_diseases` | Loaded diseases with snapshot id, gene count, candidate rule, Open Targets release. **Call first.** |
| `rank_board` | **The composite ranking** — the Ranking Board's eight-criterion weighted sum, leader = 100, using the app's own engine. `modality` (default small_molecule), `top_n`, `dataset="agora"` for the AMP-AD view of Alzheimer's. |
| `rank_targets` | The Open Targets association order the snapshot was built from (candidate selection), with the sparse OT components and each gene's candidate source. Not the composite. |
| `get_target_dossier` | One gene: board standing with per-criterion scores, OT association, identity, fact axes (mutation, RNA and protein change by source, dependency, safety, tissue, literature), disease-network centrality with context, druggability, trials, Agora nomination, candidate source. |
| `get_evidence` | Raw evidence rows for a gene, optionally one axis. |
| `get_clinical_trials` | Per-trial records: NCT, phase, status, drug, sponsor, reason stopped. |
| `find_novel_tractable` | Druggable targets with no drug anywhere and no trial in this disease, ordered by board rank. |
| `get_network_context` | Every network run's view of a gene with STATUS and context, plus how the symbol mapped to STRING. Explains *why* a gene has or lacks a network score. |
| `get_network_neighbors` | Live STRING partners annotated with board rank, score, candidate source, Agora status. |
| `get_snapshot_provenance` | Open Targets release, query, score definition, cutoff, counts, genes by candidate source, additions, network runs. **Read before citing a number.** |

Every tool takes an optional `disease` (name or MONDO id) or `snapshot_id`; if omitted, the
most recently loaded snapshot is used.

### Two rankings, on purpose

`rank_targets` is the order Open Targets put the candidates in. `rank_board` is what the
platform ranks them by: eight criteria (genetics, expression, dependency, tractability, safety,
clinical, literature, network), each 0–1, weighted per modality, core criteria penalised when
missing, context criteria neutral when missing, leader rescaled to 100. An agent that reports
"the top targets" should use `rank_board`; `rank_targets` is the provenance of the candidate set.

### Network scores are context-bound

The Network criterion is WINNER (Nguyen et al., *Front Big Data* 2022; scored with the authors'
package `winner-net`) run on the STRING v12.0 interactions among the snapshot's Open Targets
candidate genes, reported as a **percentile within that run**. A percentile from another graph —
another disease, a wider candidate cut, the whole interactome — measures something different and
is never mixed in. `get_network_context` shows every run a gene appears in, with a STATUS:

- `PRESENT` — scored on that graph
- `NOT_IN_CANDIDATE_SET` — in the snapshot but outside the graph's candidate rule (e.g. Agora-added genes past the Open Targets cutoff)
- `ABSENT_FROM_GRAPH` — a candidate with no STRING v12.0 protein (non-coding genes, and a known set of proteins missing from that release such as VEGFA, GPX1, VDR)

WINNER tracks connectivity closely; read a high value as "well connected within the disease
network", not as independent disease evidence.

---

## What it can and cannot answer

Tested against real Alzheimer's and PDAC briefs. The gaps are gaps in the underlying data, not
in the tools, so no amount of prompting closes them.

### Answers well

| Question | Tool |
|---|---|
| Which targets does the platform rank highest, and why? | `rank_board`, then `get_target_dossier` |
| Which Agora-nominated targets rank highest on our evidence? | `rank_board` with `dataset="agora"` |
| Which genes are linked to specific drugs / trials? | `get_target_dossier`, `get_clinical_trials` |
| Which druggable targets has nobody pursued? | `find_novel_tractable` |
| Is this gene central in the disease network, and is that just degree? | `get_network_context`, `get_network_neighbors` |
| Where did this snapshot's genes come from, which release, which cutoff? | `get_snapshot_provenance` |

### Answers partially

- **Drug resistance** — which drugs exist and which trials stopped, with the stated (usually
  commercial) reason. No resistance mutations or signatures.
- **Mechanistic grouping** — no cross-gene aggregation beyond STRING neighbours.

### Cannot answer

- **Prognosis / survival / stage.** Nothing in the platform carries survival, stage or grade.
  Dependency and expression magnitude are not proxies for it.
- **Cancer-only axes for non-cancer diseases.** Somatic mutation (cBioPortal) and DepMap
  dependency are structurally empty for Alzheimer's; the board drops them from the weight budget
  rather than scoring them zero.

---

## Keeping the bundle current

`board.bundle.js` is generated from the main app (`rankingBoard.ts`, `boardRows.ts`,
`agoraNominated.ts`) so the MCP ranks with the same code users see. When any of those change,
rebuild at the repo root and commit the new bundle with the change:

```bash
npm run build:mcp
```

`board.entry.ts` is the only file that references the main repo, and only at build time.

## ORDS endpoints used

`snapshots`, `snapshots/:id`, `snapshots/:id/scores`, `snapshots/:id/evidence`,
`evidence/gene/:gene`, `network/runs`, `network/gene/:gene`, `network/mapping/:gene`, plus one
live call to the public STRING API for `get_network_neighbors`. The `candidate_source` column on
the scores endpoint needs `docs/sql/ords_scores_candidate_source.sql` applied on the platform
side; until then the source is derived from the snapshot's candidate cutoff.

## Citation

Disease2Target (AIMed Lab, UAB). Network criterion: Nguyen T, Yue Z, Slominski R, Welner R,
Zhang J, Chen JY. WINNER: A network biology tool for biomolecular characterization and
prioritization. *Front Big Data* 2022;5:1016606. doi:10.3389/fdata.2022.1016606.
