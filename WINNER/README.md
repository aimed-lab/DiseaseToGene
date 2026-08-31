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

node --max-old-space-size=6144 scripts/winner_full.mjs        # ~26s → out/winner_full_scores.tsv
node --env-file=../.env scripts/winner_validate.mjs           # the equivalence gate
node --env-file=../.env scripts/winner_snapshot_frame.mjs     # same maths, snapshot's 6,000-gene pool
```

`data/` is gitignored — 83 MB of STRING does not belong in the repo, and the two curl
lines above rebuild it exactly. `out/winner_full_scores.tsv` **is** committed (692 KB)
so the scores are usable without re-downloading anything.

`STRING_MIN_SCORE` defaults to 400, matching the app.

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
