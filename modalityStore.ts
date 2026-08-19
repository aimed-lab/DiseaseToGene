// modalityStore.ts ──────────────────────────────────────────────────────────
// The most recent Modality Fit result, so the AI co-pilot can answer questions about
// what the user is currently looking at.
//
// A module-level value rather than React state on purpose: the panel is mounted in three
// different places (Ranking Board report card, the /Modality page, the gene drawer) and
// the co-pilot lives at the top of a large tree. Threading a prop from each mount point up
// to the assistant would touch a lot of unrelated code to express one simple fact —
// "the last analysis the user ran". The prompt is assembled imperatively at send time,
// so it reads this at exactly the moment it needs it.

let lastResult: any = null;

/** Called by ModalityFitPanel whenever an analysis completes. */
export function setLastModalityResult(result: any): void {
  lastResult = result ?? null;
}

/** Read by the co-pilot when building its system prompt. Null when nothing has been run. */
export function getLastModalityResult(): any {
  return lastResult;
}
