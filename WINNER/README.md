# WINNER — network scores over the full human interactome

WINNER scores for **every** human gene, rather than the top-N of a snapshot.

The app computes WINNER inside a harvest (`scripts/d2t.ts`, axis `network`) over a
bounded node set — `WINNER_NETWORK_N`, default 800, and 2000 for snapshot #103. That
cap exists because `winner.ts` builds a dense N×N matrix, which stops being viable
well before the full interactome. Anything below the cut gets no network score at all.

That cut is also chosen by the **stored** `rank_position`, not by the rank the Ranking
Board displays — the board recomputes its own ordering client-side from the eight
criteria under the current modality weights. The two disagree substantially. ALOX5 sits
at board rank 147 and stored rank 3,887, so it shows on screen near the top with an
empty Network cell. Coverage therefore looks arbitrary from the user's side, and no
choice of cut fixes it, because board rank depends on weights the harvest cannot know.

Computing WINNER for all 19,488 genes removes the problem rather than moving it.

## Is this the real WINNER?

Yes — verified twice, not assumed.

`winner.ts` is a faithful port of the reference `matlab/NeonatalHeartCaseStudy/RunWinner.m`
in [aimed-lab/WINNER](https://github.com/aimed-lab/WINNER):

| | reference `RunWinner.m` | app `winner.ts` |
|---|---|---|
| initial score | `exp(2*log(nodeWDeg) - log(nodeDeg))` | `wSum² / degree` — the same quantity |
| transition | row-normalised adjacency | row-normalised adjacency |
| iteration | `(1-σ)·initial + σ·Aᵀ·p` | identical |
| σ / iterations | 0.85 / 100, no convergence test | 0.85 / 100, no convergence test |

`winner_full.mjs` is then a sparse rewrite of `winner.ts` — same maths, never
materialising the N×N matrix. `winner_validate.mjs` is the gate for that claim: it
re-runs the sparse code on snapshot #103's exact 2,000-gene node set and compares
against the stored `winner_score`.

**Result: Spearman ρ = 1.0000, max absolute difference 0.0000 across 1,914 genes.**

Re-run that gate whenever this code changes. It is the only thing standing between a
refactor and silently different scores.

Two parts of published WINNER are **not** implemented here, matching the app: node
**expansion**, and the **p-values** (`RunWinner_withPValue.m`, 10,000 random-network
nulls). `scripts/d2t.ts` already reserves `ranking_pval` / `expansion_pval` as null for
that upgrade. `RunWinner.m` itself is the no-expansion variant, so this matches the
reference's own base configuration — but "we ran WINNER" should not be read as
including the significance testing.

## Running it

```bash
# once — 83 MB, ~20s
curl -o data/9606.protein.info.v12.0.txt.gz  https://stringdb-downloads.org/download/protein.info.v12.0/9606.protein.info.v12.0.txt.gz
curl -o data/9606.protein.links.v12.0.txt.gz https://stringdb-downloads.org/download/protein.links.v12.0/9606.protein.links.v12.0.txt.gz
curl -o data/9606.protein.aliases.v12.0.txt.gz https://stringdb-downloads.org/download/protein.aliases.v12.0/9606.protein.aliases.v12.0.txt.gz

node --max-old-space-size=6144 scripts/winner_full.mjs        # ~26s → out/winner_full_scores.tsv
node --env-file=../.env scripts/winner_validate.mjs           # the equivalence gate
node --env-file=../.env scripts/winner_snapshot_frame.mjs     # same maths, snapshot's 6,000-gene pool
```

`data/` is gitignored — 83 MB of STRING does not belong in the repo, and the two curl
lines above rebuild it exactly. `out/winner_full_scores.tsv` **is** committed (692 KB)
so the scores are usable without re-downloading anything.

`STRING_MIN_SCORE` defaults to 400, matching the app.

## The disease run (current path)

`scripts/run_disease.mjs` is the whole network axis for a snapshot, following
`Disease2Target_WINNER_Decisions.md` §1–3, §10, §12–13:

```bash
node --env-file=../.env scripts/run_disease.mjs --snapshot 103 --top 6000          # compute, gate, write runs/s103_top6000/
node --env-file=../.env scripts/run_disease.mjs --snapshot 103 --top 6000 --load   # + write to Oracle (VPN)
npx tsx --env-file=.env scripts/d2t.ts enrich 103 network                          # same thing, from the app CLI
```

1. Candidate set = snapshot genes with stored `rank_position <= --top` (default: the
   snapshot's `provenance.candidate_cutoff`). Rows past the cutoff (the Agora additions)
   are NOT in the graph.
2. Symbols resolved to STRING v12.0 (`lib/stringGraph.mjs`), induced subgraph written as
   the two upstream input files.
3. **Scored by the lab's package** `winner-net 0.1.1` (`aimed-lab/WINNER`, python) via its
   `winner` CLI. Install: `pip install "git+https://github.com/aimed-lab/WINNER.git@v0.1.1-py#subdirectory=python"`.
4. Gate: the in-process sparse port re-scores the same graph; the load refuses if the two
   differ by more than 1e-6 (observed 5.7e-13).
5. raw/max, **midrank percentile within the run** (the board's feature), rank, degree; RWR
   on the same graph seeded with the top-12 candidates (exploratory, not in the criterion).
6. `--load` writes, in one transaction: `NETWORK_GRAPH` (keyed on
   `S103_TOP6000_STRING12.0_400`, re-runs replace), `NETWORK_RUN` (WINNER, flagged primary,
   + RWR), `NETWORK_SCORE` (one row per snapshot gene per run with a STATUS: PRESENT /
   ABSENT_FROM_GRAPH / NOT_IN_CANDIDATE_SET), `GENE_IDENTIFIER_MAPPING`, and the snapshot's
   `EVIDENCE` `network` rows (what the board reads: `winner_pct`, `context`, `run_id`).
   DDL: `docs/sql/network_tables.sql`; ORDS handlers: `docs/sql/network_ords_module.sql`.

Symbol resolution uses only HGNC- and UniProt-curated alias sources (`ALIAS_TIERS`). KEGG
synonyms are excluded on purpose: "VDR" resolves to CYP27B1 through them. Renames the alias
file cannot carry go in `WINNER/symbol_overrides.tsv` with a reason (RIGI -> DDX58 is the first).
`runs/` is gitignored; every run folder carries `graph.json` (STRING version, threshold,
counts, source-file SHA-256s, candidate rule, package version, cross-check result).

Snapshot 103, 2 Sep 2026: 6,000 candidates → 5,861 exact + 19 alias + 1 override + 119 absent
→ 5,881 nodes, 243,791 edges, 38 isolated; 340 Agora-only rows NOT_IN_CANDIDATE_SET.

Gates run on 2 Sep 2026:

| check | result |
|---|---|
| upstream package vs MATLAB `winnerResult.txt` (283 genes) | max diff 5e-15 |
| our JS port vs MATLAB reference | max diff 5e-15 at 99 updates; 5e-9 at the old port's 100 |
| upstream package on snapshot 103's 2,000-gene set vs previously stored `winner_score` | Spearman 1.0000, max diff 0.005 (file vs live-API edges) |
| upstream package vs sparse port on the 5,881-node disease graph | max diff 5.7e-13 |
| snapshot 103 mapping (6,340 symbols) | 6,194 exact, 19 alias, 1 override, 126 absent (ncRNA, IG, OR, and proteins STRING v12.0 dropped: VEGFA, GPX1, VDR, AQP4, MAPK10, MPZ, LDHB, MDH1) |

`scripts/build_graph.mjs` is the graph builder on its own (`--all`, `--snapshot`, `--symbols`),
used for the global graph and ad-hoc node sets.

## Scores are relative to their pool

WINNER is normalised as `raw / max(raw)` across whatever genes are in the network, and
centrality depends on the graph. So the same gene scores differently in different pools,
and **values from different pools must never be compared**:

| gene | full interactome (19,488) | snapshot pool (6,000) |
|---|---|---|
| TYK2 | 0.1293 · 93.9% | 0.1652 · 93.3% |
| AKR1C3 | 0.0598 · 80.5% | 0.0349 · 51.6% |
| ALOX5 | 0.0594 · 80.4% | 0.0604 · 69.5% |
| ALOX15 | 0.0474 · 74.3% | 0.0416 · 57.1% |
| PTGES | 0.0214 · 51.5% | 0.0292 · 45.9% |

AKR1C3 moves from 2nd of the five to 4th purely by changing the pool. Nothing about the
gene changed.

This is the argument for a **global reference table**: WINNER over the full interactome
is disease-independent, so computing it per-snapshot repeats identical work and
re-normalises over a different pool every time. Computed once, every gene has one score
that means the same thing across every disease and every snapshot. Refresh only when
STRING publishes a new release.

RWR is the opposite — seeded on the disease's genes, genuinely per-disease, and belongs
in the per-snapshot evidence where it already is.

## Read the scores with this in mind

Spearman(WINNER, degree) = **0.995** over the full interactome. The SRC pancreatic study
reported 0.965 on a smaller network.

That is not a defect. The initial score *is* `weightedDegree² / degree`, so degree
dominance is designed into the published method. But it means a high WINNER score is
close to a restatement of "this protein has many STRING partners", and STRING degree
partly tracks how well-studied a protein is — which the Literature axis already scores
separately.

The top of the list is the tell: TP53, ACTB, AKT1, RPS27A, GAPDH, UBA52, EGFR, CTNNB1,
TNF, MYC. ACTB and GAPDH are the standard qPCR loading controls; RPS27A and UBA52 are
ubiquitin fusion proteins. Read TYK2's 94th percentile as "289 interaction partners",
not as evidence about Alzheimer's.

## Provenance

- STRING **v12.0** (released July 2023), human (9606), combined score **≥ 400**
- 13,715,404 rows read → 929,472 unique symbol-pair edges → 19,488 genes, mean degree 95.4
- Multiple ENSPs mapping to one symbol are collapsed, keeping the strongest edge, so a
  gene is not inflated by its own isoforms
- Generated 30 Aug 2026

STRING rescores every channel between releases, so pin the version and record the date
with any figure. The live API and the flat file are not byte-identical either: the app
recorded 39,950 edges for snapshot #103's 2,000 genes where v12.0 gives 39,629 — a 0.8%
difference that left scores unchanged to four decimals, but which makes the API run
unreproducible in a way the file is not.
