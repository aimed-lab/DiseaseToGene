# Disease2Target — Progress Update (June 2026)

## Plan (what we set out to do — done vs. to-do)

**Done this cycle**
- Add mutation-level evidence for cancer genes (cBioPortal).
- Make papers usable as content: upload → extract → store.
- Build a content store in Supabase (papers, evidence cards, per-gene content).
- Surface stored evidence back in the app (highlight + cards).
- Prepare a demo + roadmap deck for the team.

**To-do (next — I will pick these up)**
- Show every gene's evidence separated by source (Gene × Source matrix).
- Add ingestion + audit agents (tag evidence G/E/T, add confidence, "verify" step).
- Benchmark the ranking against known targets (KRAS, SRC, etc.).
- Push the structured content to Oracle.
- Move to Alzheimer's after pancreatic cancer.
- Integrate the SDD wiki as long-form persistent memory (pending repo access/format).
- Set up a versioned working directory (Box-style version history).

## Learning
- For cancer, "this gene is associated" is not enough — drugs target *specific mutations*. We now resolve KRAS down to G12D with real patient frequencies.
- No single public database gives the mutation → drug link; curated, sourced content from papers fills that gap.
- The automated ranking (Open Targets) misses known targets like SRC — which is exactly why a stored, curated content layer adds value (and motivates a benchmarking step).
- Storing content once and reusing it beats re-fetching on every click — and is what makes daily updates and traceability possible.
- Trust has to be explicit: every value carries a source + date; AI is used only to read/extract, while code computes the scores (reproducible).

## Executed / Completed (screenshots to be added)
1. **Fixed reported issues** — PDF paper upload was failing (file-size limit + missing auth); it now works, with clearer error messages. _[add specific GitHub issue numbers here]_
2. **Mutation axis (cBioPortal)** — cancer genes now show mutation frequency + top variants. Example: KRAS → mutated in 66% of pancreatic tumors, dominant variant G12D (41%), sourced to TCGA.
3. **Paper ingestion** — upload a PDF; genes, drugs, mutations and outcomes are extracted, each kept with the exact source sentence.
4. **Content store (Supabase)** — created the tables (papers, evidence_cards, gene_content) and the app writes to them.
5. **Harvest** — one button stores the full evidence profile per gene (scores, clinical trials, literature, ChEMBL, mutations).
6. **Reuse in the app** — genes with stored evidence show an "EVIDENCE" badge; clicking a gene shows its sourced cards (with the source quote + audit status).
7. **Team materials** — prepared a demo + roadmap deck.

## Assessment (what we checked)
- Verified paper upload saves to Supabase — 1 paper + 6 evidence cards stored (SRC paper).
- Verified gene data loads and saves to the per-gene content store via the Harvest button.
- Confirmed mutation data is live and sourced (cBioPortal), and evidence cards display the source quote + audit status.
- Confirmed the app builds cleanly (type-check + production build pass).

## Shared
- Code pushed to GitHub (aimed-lab / DiseaseToGene).
