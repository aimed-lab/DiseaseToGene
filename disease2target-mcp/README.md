# Disease2Target MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the Disease2Target
platform's cancer target-discovery data as tools any AI client can call —
**Claude Desktop, Cursor, Codex, or your own MCP-capable app.**

It reads **live** from the public Disease2Target ORDS bridge, so:

- **No VPN, no database credentials, no API keys.**
- **Nothing to host** — it runs locally on the machine of whoever uses it.
- Data is always current with the platform's latest nightly snapshots.

This folder is **self-contained**: it has its own copy of the read layer and does
not depend on the rest of the Disease2Target repo. You can zip it and hand it over.

---

## Requirements

- **Node.js 18 or newer** (uses the built-in `fetch`). Check with `node --version`.

## Install & verify (30 seconds)

```bash
cd disease2target-mcp
npm install
npm test          # confirms the ORDS bridge is reachable and returns data
```

`npm test` should print the latest snapshot, a top-5 ranked list, and an evidence
count. If that works, the MCP server has live data to serve.

---

## Tools exposed

| Tool | What it does |
|------|--------------|
| `list_diseases` | List loaded cancers + their snapshot ids, versions, gene counts. **Call first.** |
| `rank_targets` | Ranked target portfolio for a disease (GET score + component scores). |
| `get_target_dossier` | Full per-gene dossier: identity, fact axes, druggability, trials — facts vs predictions labelled. |
| `get_evidence` | Raw evidence rows for a gene, optionally filtered to one axis. |
| `get_clinical_trials` | Per-trial records (NCT, phase, status, drug, reason-for-termination). |
| `find_novel_tractable` | The discovery query: druggable targets with no drug and no disease trial yet. |

Every tool takes an optional `disease` (name or MONDO id) or `snapshot_id`; if
omitted, the most recently loaded snapshot is used.

---

## What it can and cannot answer

Tested against a real PDAC case-study brief. Read this before planning an analysis around it —
the gaps are gaps in the underlying data, not in the tools, so no amount of prompting closes them.

### Answers well

| Question | Tool | What you get |
|---|---|---|
| Which genes are most important in this cancer? | `rank_targets` | 6,189 genes ranked for PDAC — KRAS, TP53, SMAD4, CDKN2A at the top |
| Which genes are linked to specific drugs? | `get_target_dossier` | e.g. KRAS → ADAGRASIB, SOTORASIB, SALIRASIB |
| Which targets are being pursued clinically? | `get_clinical_trials` | NCT id, phase, status, and the stated reason a trial stopped |
| Which druggable targets has nobody pursued? | `find_novel_tractable` | 1,653 for PDAC — no drug anywhere, no trial here, ≥1 tractable modality |
| What is known about one target? | `get_target_dossier` | mutation % + hotspot, tumour-vs-normal RNA and protein, DepMap dependency, gnomAD constraint, GTEx tissue specificity, STRING centrality, patents, literature |

### Answers partially

- **Drug *resistance*** — you get which drugs exist and which trials stopped, but the stated
  reasons are commercial ("Funder Decision", "Business objectives have changed"), not
  biological. There are no resistance mutations or resistance signatures in the store.
- **Groups of genes sharing a mechanism** — there is no cross-gene aggregation tool, so
  grouping means pulling dossiers one at a time. The STRING network axis (WINNER / RWR) is
  the only mechanistic handle.

### Cannot answer

- **Aggressive disease / poor survival.** There is no survival, stage or grade data anywhere
  in the platform. Dependency and expression magnitude are sometimes offered as proxies —
  they are not prognosis. A model asked this question will produce a confident answer built
  on the wrong variable.
- **Subtypes.** No Moffitt basal/classical, no Bailey subtypes, no molecular subtype labels.
- **Pathway ↔ phenotype associations.** No pathway axis is stored (the annotation axis
  returns the protein class, not pathways), and there is no phenotype data to associate
  anything with.
- **Therapeutic modality.** The platform's Modality Fit engine (12 modalities, 5 mechanistic
  goals) is computed live from public APIs and is **not** part of the ORDS bridge, so it is
  not exposed here. Use the web app for "how would you drug this?".

### One data caveat worth knowing

`surface_or_secreted` is frozen into each snapshot at harvest time, so older snapshots carry
whatever the classifier said that day — #102 (2026-07-24) stores `true` for KRAS, a
lipid-anchored cytoplasmic-side protein. This server therefore **re-derives** antibody
accessibility from the stored `subcellular_locations` on every read, so the answer is correct
regardless of snapshot age. If you query the raw ORDS rows yourself, do the same.

---

## Connect it to a client

The server speaks MCP over **stdio** — a client launches it with `node server.js`.
Use the **absolute path** to `server.js` in the config.

### Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "disease2target": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/disease2target-mcp/server.js"]
    }
  }
}
```

Restart Claude Desktop. You should see the Disease2Target tools available, then ask:

> *List the diseases in Disease2Target, then show me the top 10 pancreatic cancer targets.*
> *Give me the dossier for KRAS.*
> *Which pancreatic targets are druggable but nobody has pursued?*

### Cursor

Add to `.cursor/mcp.json` (project) or the global Cursor MCP settings:

```json
{
  "mcpServers": {
    "disease2target": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/disease2target-mcp/server.js"]
    }
  }
}
```

### Codex / other MCP clients

Any client that supports stdio MCP servers uses the same shape: command `node`,
argument = absolute path to `server.js`. Point it there and the six tools appear.

---

## Notes

- **Read-only.** There are no write/delete tools — this cannot modify platform data.
- **Coverage** = whatever cancers are loaded into the platform (see `list_diseases`).
  As more diseases are added upstream, they appear here automatically.
- **Facts vs predictions** are labelled in every response: measured/curated values
  (trials, expression, mutations, literature) vs model-derived ones (GET score,
  rank, tractability).
- `find_novel_tractable` is the heaviest tool (it scans a snapshot's full evidence
  set); results are cached for 10 minutes per snapshot.
- Configuration is optional — see `.env.example`. The default points at the public
  bridge and needs nothing.
