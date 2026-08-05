# Funnel target-recovery benchmark

Grades the funnel: **hide the known drug targets in the gene pile, see if the funnel digs
them back up.** It runs the *real* engine (`funnelEngine.runFunnel`), so what it measures is
exactly what the app ranks — never a re-implementation.

## What it tells you

- **A grade** — ROC-AUC (0.5 = random, 1.0 = perfect), plus average precision, BEDROC,
  enrichment factors, and how many known targets land in the top 10/20/50/100.
- **Which evidence matters** — ablation drops each axis and re-ranks, so you see which axes
  earn their weight and which are dead weight.
- **An honest number** — k-fold cross-validated re-fit (fits weights on some positives, tests
  on held-out ones) so the tuned weights aren't overfit.
- **A sanity check** — shuffle the labels; the grade must collapse to ~0.5.

## The honesty caveat (important)

The gold standard is *"targets of drugs developed for this disease"* (from Open Targets). That
overlaps the funnel's **tractability** axis (ChEMBL max-phase), which partly *encodes the
answer*. So the **headline number holds tractability out** (weight 0); the with-tractability
value is printed only as a **leaky upper bound** — never quote it as the result.

## How to run

**On the UAB VPN** (reads snapshot straight from Oracle):
```
npx tsx --env-file=.env benchmark/run.ts 84
```

**Grade the Target Ranking Board** instead of the funnel (`--board`) — same gold set +
metrics, per modality, tractability held out. This is the number to quote for the Board:
```
npx tsx --env-file=.env benchmark/run.ts 102 --board --disease "pancreatic cancer"
```
(Board reads its rows via `boardAdapter.ts` → `rankingBoard.buildBoard`, so it grades the
engine the Board actually runs. #102 small-molecule headline: ROC-AUC ≈ 0.82, tractability held out.)

**Off VPN** (export once on VPN, then grade anywhere — no Oracle needed):
```
npx tsx --env-file=.env benchmark/run.ts export 84 snapshot84.json   # on VPN
npx tsx benchmark/run.ts --file snapshot84.json                      # anywhere
```

### Options
| flag | effect |
|------|--------|
| `--efo EFO_XXXX` | force the disease id for the gold set (else uses the snapshot's `disease_id`) |
| `--disease "name"` | resolve the gold-set disease by name instead |
| `--gold file.txt` | use a curated gold list (one symbol per line) instead of Open Targets |
| `--permissive` | score every gene (nexus off — matches the app's default view) |
| `--holdout a,b` | axes to force to weight 0 for the headline (default `tractability`) |
| `--no-cv` | skip the slow k-fold re-fit |
| `--no-bootstrap` | skip the AUC confidence interval |
| `--out report.json` | also write machine-readable results |

> **Gold-set note.** Narrow disease nodes (e.g. `MONDO_0006047`, pancreatic adenocarcinoma)
> still return hundreds of trial drugs via `drugAndClinicalCandidates`. If the gold set comes
> back small, pass a broader `--efo` (e.g. pancreatic cancer) to widen the answer key, or
> supply your own with `--gold`.

## Files
- `metrics.ts` — pure scoring math (ROC-AUC, AP, EF, BEDROC, bootstrap CI). Tested: `metrics.test.ts`.
- `benchmark.ts` — evaluate / ablation / coordinateFit / crossValidatedFit / negativeControl over the real engine.
- `adapter.ts` — snapshot rows → `FunnelGene[]` (reproduces `FunnelView.tsx`'s read contract field-for-field).
- `goldset.ts` — the gold "answer key" from Open Targets (or a file).
- `report.ts` — formats the console report.
- `run.ts` — the CLI runner (Oracle or `--file`).
