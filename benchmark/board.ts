// benchmark/board.ts ───────────────────────────────────────────────────────────
// Grade the REAL Ranking Board engine (`rankingBoard.buildBoard`) with the same
// target-recovery methodology as the funnel benchmark: hide the known drug targets,
// see if the Board's ranking digs them back up (ROC-AUC / AP / enrichment), per
// modality, with the leakage axis (tractability) held out. Uses the SAME metrics
// and gold set as the funnel path — so the two engines become directly comparable.
import { buildBoard, MODALITY_PROFILES, type ModalityKey, type CriterionKey } from '../rankingBoard.ts';
import { metricBundle, enrichmentFactor } from './metrics.ts';

export const MODALITIES: ModalityKey[] = ['small_molecule', 'antibody', 'protac', 'mrna', 'gene_therapy'];

// Board score for every gene, aligned to `rows` order. Holdout criteria are pinned to
// weight 0 (default: tractability — it encodes drug maturity ≈ the "known drug" label).
export function boardScoreVector(rows: any[], modality: ModalityKey, holdout: CriterionKey[]): number[] {
  const w = { ...MODALITY_PROFILES[modality].weights };
  for (const h of holdout) if (h in w) w[h] = 0;
  const { scored } = buildBoard(rows, modality, w);
  const bySym = new Map<string, number>(scored.map(s => [s.symbol.toUpperCase(), s.overall]));
  // A gene the Board couldn't score sinks to −Infinity (a genuine miss).
  return rows.map(r => { const v = bySym.get(String(r.gene_symbol).toUpperCase()); return v == null ? -Infinity : v; });
}

export interface BoardEvalRow { modality: ModalityKey; auc: number; ap: number; ef5: number; ef1: number; }
export interface BoardEval { rows: BoardEvalRow[]; goldInUniverse: number; holdout: CriterionKey[]; leaky?: BoardEvalRow[]; }

export function evaluateBoard(
  rows: any[], goldSet: Set<string>,
  opts: { modalities?: ModalityKey[]; holdout?: CriterionKey[]; leaky?: boolean } = {},
): BoardEval {
  const modalities = opts.modalities ?? MODALITIES;
  const holdout = opts.holdout ?? (['tractability'] as CriterionKey[]);
  const labels = rows.map(r => (goldSet.has(String(r.gene_symbol).toUpperCase()) ? 1 : 0)) as (0 | 1)[];
  const goldInUniverse = labels.reduce<number>((a, l) => a + l, 0);
  const grade = (hold: CriterionKey[]): BoardEvalRow[] => modalities.map(m => {
    const s = boardScoreVector(rows, m, hold);
    const b = metricBundle(s, labels);
    return { modality: m, auc: b.rocAuc, ap: b.averagePrecision, ef5: enrichmentFactor(s, labels, 0.05), ef1: enrichmentFactor(s, labels, 0.01) };
  });
  return {
    rows: grade(holdout),
    goldInUniverse, holdout,
    leaky: opts.leaky ? grade([]) : undefined,   // with-tractability upper (leaky) bound
  };
}
