// board.entry.ts — the ONLY link between the MCP folder and the main app's code.
//
// `npm run build:mcp` (repo root) bundles this file into board.bundle.js, which is committed
// so the folder stays self-contained. Everything the MCP needs from the app is re-exported
// here, and nothing else: the Ranking Board scoring engine, the shared row derivation, and
// the Agora nomination list. Rebuild whenever rankingBoard.ts / boardRows.ts /
// agoraNominated.ts change, and commit the new bundle with them.

export {
  buildBoard, criterionScores, criterionBreakdown, computeVerdict,
  CRITERIA, CORE_CRITERIA, MODALITY_PROFILES, readyModalities, normaliseWeights,
  protMagOf, proteinFrame,
} from '../rankingBoard.ts';
export type { CriterionKey, ModalityKey, ScoredGene } from '../rankingBoard.ts';
export { deriveBoardRows } from '../boardRows.ts';
export { AGORA_NOMINATED, AGORA_COUNT, isAgora, agoraNominations } from '../agoraNominated.ts';
