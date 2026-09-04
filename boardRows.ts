// boardRows.ts ─────────────────────────────────────────────────────────────────
// ONE place that turns a snapshot's stored rows (ranking_scores + evidence) into the
// row shape the Ranking Board scores from. Used by:
//   • server.ts            /api/dashboard/genes (what the UI ranks)
//   • benchmark/boardAdapter.ts   (so the benchmark grades the same rows)
//   • disease2target-mcp   (bundled by `npm run build:mcp`, so agents rank the same rows)
// Change a field here and all three move together; there is no second copy to drift.

const parse = (v: unknown): any => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };

export interface BoardScoreRow { gene_symbol: string; rank?: number | null; [k: string]: unknown; }
export interface BoardEvidenceRow { gene_symbol: string; evidence_type: string; value_json?: unknown; source?: string | null; [k: string]: unknown; }

export function deriveBoardRows(scores: BoardScoreRow[], evidence: BoardEvidenceRow[]): any[] {
  const evByGene: Record<string, Record<string, any>> = {};
  const srcByGene: Record<string, Record<string, string>> = {};
  for (const e of evidence as any[]) {
    const j = parse(e.value_json);
    (evByGene[String(e.gene_symbol).toUpperCase()] ??= {})[e.evidence_type] = j || {};
    if (e.source) (srcByGene[String(e.gene_symbol).toUpperCase()] ??= {})[e.evidence_type] = String(e.source);
  }
  // dedupe by symbol (keep best rank) so the grid never shows a gene twice
  const seen = new Set<string>();
  return (scores as any[])
    .filter(r => { const g = String(r.gene_symbol).toUpperCase(); if (seen.has(g)) return false; seen.add(g); return true; })
    .map(r => {
      const g = String(r.gene_symbol).toUpperCase();
      const ev = evByGene[g] || {};
      const drug = ev.druggability, clin = ev.clinical, lit = ev.literature_epmc;
      const ann = ev.annotation, tis = ev.tissue, pat = ev.patents, net = ev.network;
      const mut = ev.mutation, expr = ev.expression_tvn, prot = ev.proteomics, dep = ev.dependency, saf = ev.safety;
      const drugLegacy = !!drug && drug.proven_modalities === undefined;
      const clinLegacy = !!clin && clin.n_drugs_in_disease_trials === undefined;
      const axesPresent = ['mutation', 'expression_tvn', 'dependency', 'safety', 'tissue', 'annotation', 'druggability', 'clinical', 'literature_epmc']
        .filter(a => ev[a]).length;
      return {
        gene_symbol: r.gene_symbol, rank: r.rank, score: r.overall_score ?? r.get_score,
        candidate_source: r.candidate_source ?? null,   // OPEN_TARGETS | AGORA | MANUAL … (null on snapshots read before the column existed)
        n_drugs: drugLegacy ? null : (drug?.total_compounds ?? null),
        tractable_modalities: drug?.tractable_modalities ?? null,
        n_disease_trials: clinLegacy ? null : (clin?.n_disease_trials ?? null),
        trials_by_phase: clinLegacy ? null : (clin?.trials_by_phase ?? null),
        max_disease_phase: clinLegacy ? null : (clin?.max_disease_trial_phase ?? null),
        n_publications: lit?.paper_count ?? null,
        lit_recent_count: lit?.recent_count ?? null,    // papers in the harvest's 3-year window
        lit_low_conf: lit?.low_confidence ?? false,     // < 5 papers: velocity is quantised noise
        velocity: lit?.velocity ?? null,
        // ── axes added for the dashboard ──
        target_class: ann?.target_class ?? null,
        is_common_essential: ann?.is_common_essential ?? null,
        surface_or_secreted: ann?.surface_or_secreted ?? null,
        tissue_tau: tis?.tau ?? null,
        n_patents: pat?.gene_patents ?? null,
        n_stopped_trials: clin?.n_stopped_trials ?? null,
        winner_score: net?.winner_score ?? null,
        // Disease-specific WINNER as a within-run percentile — the Network criterion's feature
        // (Decisions doc §10). Context/status/run id let the UI say WHICH graph it came from.
        winner_pct: net?.winner_pct ?? null,
        winner_context: net?.context ?? null,
        winner_run_id: net?.run_id ?? null,
        network_status: net?.status ?? null,
        network_degree: net?.degree ?? null,
        rwr_score: net?.rwr_score ?? null,
        is_seed: net?.is_seed ?? null,
        // ── raw per-criterion signals for the Ranking Board (weighted-sum-of-8) ──
        genetic_score: r.genetic_score ?? null,
        mutation_freq: mut?.frequency ?? null,
        expr_log2fc: expr?.log2fc ?? null,
        expr_low_conf: expr?.low_confidence ?? false,   // normal-floor artifact (inflated |log2FC|)
        prot_log2fc: prot?.log2fc ?? null,
        // The stored axis already carries the cohort's log2fc_scale (AD brain uses 0.5, the
        // cancers 3). The board reads THIS rather than re-dividing the raw log2FC, so the
        // scaling rule lives in one place and the board cannot drift from the evidence.
        prot_axis: prot?.axis ?? null,
        prot_source: srcByGene[g]?.proteomics ?? null,
        chronos: dep?.mean ?? null,
        frac_dependent: dep?.frac_dependent ?? null,
        loeuf: saf?.loeuf ?? null,
        druggability_score: drug?.score ?? null,
        proven_modalities: drug?.proven_modalities ?? null,
        tractability: drug?.tractability ?? null,
        n_safety_liabilities: ann?.n_safety_liabilities ?? null,
        completeness: axesPresent / 9,
        legacy: drugLegacy || clinLegacy,
      };
    });
}
