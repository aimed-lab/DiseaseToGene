# Funnel — Design Brief (for a redesign)

> Hand this to a designer / Claude to redesign the Funnel view. It is self-contained:
> it explains what the Funnel is, what it does, the data it works with, the rules that
> must survive a redesign, and what's wrong with the current look. The **visuals are
> free to change**; the **logic/architecture in §6 must stay intact**.

---

## 1. One-line purpose

The Funnel turns a large, unranked list of disease-associated genes into a **small, justified
shortlist of drug targets** — by passing every gene through a sequence of evidence "gates,"
each backed by a real data source, then ranking the survivors.

It is the visual argument for: *"we started with the whole disease gene universe, and here is
exactly why we narrowed to these N targets."*

## 2. Where it sits

- **Read-only and database-backed.** It loads ONE stored **snapshot** (a harvest run for a
  disease) from Oracle and makes **no live API calls** itself.
- A separate **Job** feature *writes* the evidence into Oracle; the Funnel only *reads* it.
- Clicking any gene opens a **drill-down drawer** showing that gene's full evidence — and the
  numbers in the drawer must equal the numbers the Funnel filters on (one source of truth).

## 3. What it does (mechanics)

1. **Load a snapshot** → genes + their per-axis evidence.
2. **Cascade filter, top → bottom.** Start from the full universe (T0). Each tier is an evidence
   **gate**. Enabling a gate filters the survivors of the tier *above* it, so the population
   strictly shrinks downward. Gates filter on the **raw value in real units** (e.g. log2FC,
   LOEUF, trial count) — never a normalized score.
3. **Rank the survivors** with a **composite score**: a direction-aware, weighted-harmonic blend
   of the rank-normalized axes. Harmonic mean = a target must be good on *many* axes (one strong
   axis can't rescue a weak gene). Direction matters: for Safety, *high* constraint *lowers* rank
   (a "con"); all others, high is good.
4. **Show the shortlist on demand** → click a gene → full drill-down drawer.

## 4. The tiers (driven by `evidenceRegistry.ts` — the single source of truth)

| Tier | Axis | Source | Question it answers | Raw filter | Direction |
|---|---|---|---|---|---|
| T1 | Genetic association | Open Targets | Genetically linked to the disease? | score ≥ | pro |
| T2 | Somatic mutation | cBioPortal | Recurrently mutated in the tumor? | frequency ≥ | pro |
| T3 | Dysregulation | TCGA / GTEx | Abnormally expressed in tumor? | log2FC ≥ | pro |
| T4 | Dependency | DepMap CRISPR | Does the tumor need it to survive? | Chronos ≤ | pro |
| T5 | Druggability | ChEMBL | Can we drug it? | category (Clinically Validated / In Clinical Development / Preclinical / None) | pro |
| T6 | Safety / constraint | gnomAD | Safe to drug, or essential to healthy cells? | LOEUF ≥ | **con** |
| T7 | Clinical landscape | ClinicalTrials.gov | Trial activity / room? | trial_count ≥ | pro |
| T8 | Literature signal | PubMed | Interest established / rising? | velocity ≥ | pro |
| — | Tissue specificity | Protein Atlas | (modifier — ranking only, not a gate) | — | pro |

Each axis declares (in the registry): tier #, label, question, source, color, **type** (`hard` =
narrows / `soft` = ranks), **direction** (`pro`/`con`), composite **weight**, and a **filter**
(kind = `range` or `category`, the raw `field`, `unit`, min/max/step/default, operator `≥`/`≤`, or
the category list). The UI must render whatever the registry contains — do **not** hard-code 8.

## 5. Data contract (what each gene carries)

Per gene, per axis, the Funnel reads a `value_json` with:
- `axis` — normalized 0–1 (used only for ranking/composite),
- `direction` — `pro` / `con`,
- `display` — a short human string,
- plus the **raw fields in real units** (e.g. `log2fc`, `loeuf`, `frequency`, `trial_count`,
  `velocity`, `label`) — **filters use these**.

Genetic score and tissue come from a separate scores table; the rest come from evidence rows.

## 6. INVARIANTS — must survive the redesign

1. **Registry-driven** — tiers, filters, colors, order all come from `evidenceRegistry.ts`.
   Adding an axis later = one registry line + nothing else. The UI iterates the registry.
2. **Raw-value filters** — gates filter on real units, never the normalized `axis`.
3. **Cascade semantics** — each enabled tier narrows the survivors of the tier above, in tier order.
4. **Direction-aware composite** — weighted-harmonic of rank-normalized axes; `con` axes invert.
5. **DB-backed & read-only** — loads a stored snapshot; no live API calls in the Funnel.
6. **Drawer parity** — the value a gate shows must equal the gene's drawer value.
7. **Graceful "pending" axes** — axes with no data yet render as disabled/greyed, never break.
8. **Snapshot picker, export, and the per-gene drawer** entry point are kept.

## 7. Current UI (what we're moving away from)

- A vertical stack of tier cards, T0 at top, where each card's **width shrinks** proportional to
  its surviving count (a literal "funnel").
- Tier name + colored `T#` badge + the axis question on the left; surviving **count + %** on the right.
- **Filters are hidden**: you must click a card to expand its slider / category checkboxes and an
  "enable gate" toggle.
- `▼` connectors between cards; a purple **Composite** card at the bottom.
- Top info bar: snapshot picker, Universe → Shortlist → Active gates → Pending axes stats,
  "View genes" + "Export CSV."
- On-demand shortlist below: rank, gene, a row of tiny per-axis score **chips**, completeness %,
  composite score → click → drawer.

## 8. What's wrong with it (redesign goals)

The redesign should be **simple but effective**. Specific complaints to fix:

1. **The shrinking-card visual doesn't work** — the width-shrinking cards don't read clearly as a
   funnel and look awkward. Replace the metaphor with something cleaner.
2. **Filters are buried** — having to click each tier to reveal its control is clunky; you can't
   see or adjust all the gates at once. Make the controls **visible and scannable**.
3. **The shortlist/results are unclear** — the tiny per-axis chips + composite number don't
   communicate *why* a gene ranks where it does. Make the result legible: show, per gene, which
   gates it passed and the raw evidence that drove its rank.
4. **Overall layout/aesthetic** — wants a cleaner, more modern, less cluttered look with clearer
   hierarchy and spacing.

### Design direction (suggestions, not requirements)
- Favor a **clear at-a-glance control panel** of gates (all filters visible, each with its raw
  unit and live count) over click-to-expand.
- Keep a **strong sense of narrowing** (universe → shortlist) without the awkward width animation —
  e.g. a horizontal stepper, a counts strip, or a Sankey-style flow.
- Make the **results table the star**: per gene, the composite score *and* a readable breakdown of
  the raw evidence per axis (pass/fail + value), so the ranking is self-explanatory.
- Respect light/dark theme and the existing axis colors (from the registry).

## 9. Key files (for whoever implements it)
- `FunnelView.tsx` — the component to redesign.
- `evidenceRegistry.ts` — the axis/tier/filter definitions it must read from (don't fork this).
- `GeneDetailDrawer.tsx` — the drawer opened per gene (parity target).
- Data comes via `supabase.ts` helpers: `fetchSnapshots`, `fetchSnapshotScores`, `fetchSnapshotEvidence`.
