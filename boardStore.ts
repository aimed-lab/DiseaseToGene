// boardStore.ts ─────────────────────────────────────────────────────────────
// Which snapshot the Ranking Board is currently showing, so the AI co-pilot can
// answer about what the user is actually looking at.
//
// The board owns its own `snapId` and never writes to researchState.activeDisease.
// That is deliberate and worth keeping: activeDisease is read in ~45 places and sits
// in five useEffect dependency arrays that trigger data loads, so having the board
// set it would fire a cascade of reloads to express one fact. The Knowledge Graph hit
// the same wall and solved it by owning its selection; this is the other half — telling
// the co-pilot what that selection is.
//
// Same module-level pattern as modalityStore.ts, for the same reason: the prompt is
// assembled imperatively at send time, so it reads this at exactly the moment it needs
// it, and no props are threaded through a large tree.
//
// Why this exists at all: without it the co-pilot was blind to the board. A user who
// loaded pancreatic adenocarcinoma on the board and asked about KRAS got "not in the
// current target list" — technically true of the browser's loaded page, and read by
// users (and by the model) as "not in the data".

export interface BoardSnapshot {
  id: number;
  disease_name: string;
  gene_count: number | null;
  version: number | null;
  /** Criteria that actually have data in this snapshot. Absent axes are dropped and
   *  the weight budget renormalises over the rest — so the published weights are NOT
   *  what a given snapshot actually scores on. The methodology page needs this to
   *  avoid documenting a weighting the user is not getting. */
  activeCriteria?: string[];
  /** Criteria defined by the engine but with no data here (the complement above). */
  inactiveCriteria?: string[];
  /** The modality column currently selected on the board. */
  modality?: string;
}

let active: BoardSnapshot | null = null;

/** Called by RankingBoardView whenever its snapshot selection resolves or changes. */
export function setActiveBoardSnapshot(snap: BoardSnapshot | null): void {
  active = snap;
}

/** Read by the co-pilot when building its prompt. Null until the board has been opened. */
export function getActiveBoardSnapshot(): BoardSnapshot | null {
  return active;
}

// ── What the user has SELECTED on the board, for the co-pilot's screen context ──
// Published by RankingBoardView whenever the selection or the board changes. The server
// renders it (renderScreenBlock) so the model can say "APOE is rank 4 on your board,
// leading on genetics" from what is actually on screen rather than re-deriving it.
export interface BoardFocus {
  symbol: string;
  boardRank: number; total: number; display: number;
  tier?: string;
  criteria: Record<string, number | null>;
  weights: Record<string, number>;
  strengths?: string[]; drags?: string[];
}
let focus: BoardFocus | null = null;
let topGenes: string[] = [];
let litWindow: string = 'all';
export function setBoardFocus(f: BoardFocus | null): void { focus = f; }
export function setBoardTop(genes: string[], window: string): void { topGenes = genes; litWindow = window; }
export function getBoardFocus(): BoardFocus | null { return focus; }
export function getBoardTop(): string[] { return topGenes; }
export function getBoardLitWindow(): string { return litWindow; }

/** Everything the co-pilot needs to know about the screen, assembled at send time. */
export function screenContext(view: string, disease: { id: string; name: string } | null, listFocus: string | null): Record<string, unknown> {
  return {
    view, disease,
    snapshot: active ? { id: active.id, disease_name: active.disease_name, gene_count: active.gene_count, version: active.version, modality: active.modality, activeCriteria: active.activeCriteria } : null,
    focus: view === 'board' ? focus : null,
    listFocus,
    topGenes: view === 'board' ? topGenes : [],
    litWindow,
  };
}

/** The prompt line describing it. Empty string when the board has not been opened. */
export function boardSnapshotBlock(): string {
  if (!active) return '';
  const count = active.gene_count != null ? `${active.gene_count} genes` : 'gene count unknown';
  return `      RANKING BOARD — the user currently has snapshot #${active.id} open: ${active.disease_name} (${count}).
      This snapshot holds every gene in it, which is far more than the Target List has loaded in the browser.
      So a gene missing from the Target List may still be in THIS snapshot, ranked below the loaded page — use the evidence tools to check before saying anything is absent.`;
}
