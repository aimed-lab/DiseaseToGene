// benchmark/boardAdapter.ts ───────────────────────────────────────────────────
// Turn a stored snapshot (ranking_scores + evidence) into the ROW SHAPE the Ranking
// Board scores from — i.e. exactly what the `/api/dashboard/genes` endpoint returns.
// The derivation itself lives in boardRows.ts and is shared with server.ts and the
// MCP server, so the benchmark grades the SAME rows the Board ranks by construction.
// (Parallel to adapter.ts, which does this for the funnel.)
import type { ScoreRow, EvidenceRow } from './adapter.ts';
import { deriveBoardRows } from '../boardRows.ts';

export function buildBoardRows(scores: ScoreRow[], evidence: EvidenceRow[]): any[] {
  return deriveBoardRows(scores as any[], evidence as any[]);
}
