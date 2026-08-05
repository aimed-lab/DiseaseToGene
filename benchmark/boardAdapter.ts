// benchmark/boardAdapter.ts ───────────────────────────────────────────────────
// Turn a stored snapshot (ranking_scores + evidence) into the ROW SHAPE the Ranking
// Board scores from — i.e. exactly what the `/api/dashboard/genes` endpoint returns
// (server.ts). Reproduced field-for-field so the benchmark grades the SAME rows the
// Board ranks, no re-derivation. (Parallel to adapter.ts, which does this for the funnel.)
import type { ScoreRow, EvidenceRow } from './adapter.ts';

const safeParse = (s: unknown): any => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };

export function buildBoardRows(scores: ScoreRow[], evidence: EvidenceRow[]): any[] {
  const evBy: Record<string, Record<string, any>> = {};
  for (const e of evidence) { const g = e.gene_symbol; if (!g) continue; (evBy[String(g).toUpperCase()] ||= {})[e.evidence_type] = safeParse(e.value_json) || {}; }
  const seen = new Set<string>();
  return scores
    .filter(r => { const g = String(r.gene_symbol).toUpperCase(); if (seen.has(g)) return false; seen.add(g); return true; })
    .map((r: any) => {
      const g = String(r.gene_symbol).toUpperCase();
      const ev = evBy[g] || {};
      const drug = ev.druggability, clin = ev.clinical, lit = ev.literature_epmc, ann = ev.annotation,
            tis = ev.tissue, net = ev.network, mut = ev.mutation, expr = ev.expression_tvn, prot = ev.proteomics, dep = ev.dependency, saf = ev.safety;
      return {
        gene_symbol: r.gene_symbol, rank: r.rank,
        genetic_score: r.genetic_score ?? null,
        mutation_freq: mut?.frequency ?? null,
        expr_log2fc: expr?.log2fc ?? null,
        expr_low_conf: expr?.low_confidence ?? false,
        prot_log2fc: prot?.log2fc ?? null,
        chronos: dep?.mean ?? null,
        frac_dependent: dep?.frac_dependent ?? null,
        loeuf: saf?.loeuf ?? null,
        druggability_score: drug?.score ?? null,
        tractable_modalities: drug?.tractable_modalities ?? null,
        max_disease_phase: clin?.max_disease_trial_phase ?? null,
        n_disease_trials: clin?.n_disease_trials ?? null,
        velocity: lit?.velocity ?? null,
        winner_score: net?.winner_score ?? null,
        tissue_tau: tis?.tau ?? null,
        surface_or_secreted: ann?.surface_or_secreted ?? null,
        is_common_essential: ann?.is_common_essential ?? null,
        n_safety_liabilities: ann?.n_safety_liabilities ?? null,
      };
    });
}
