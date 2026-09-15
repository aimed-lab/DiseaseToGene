// assessment.ts ─────────────────────────────────────────────────────────────
// Target Assessment: the pure part. Takes the board's rows for a snapshot, the symbols
// the user picked, and the modality-fit summaries, and produces one comparable record per
// target — board rank, the same 8 criterion scores and breakdowns the Ranking Board shows,
// the verdict, and the modality tiers — plus the cross-target comparison (who leads on
// what) and the evidence block the AI trade-off narrative is written from.
//
// Everything here comes from the snapshot store (via rankingBoard.ts) or the modality-fit
// service. Nothing is fetched live and nothing is invented: a symbol the snapshot does not
// hold is reported as such, not scored. The old assessment ran on the legacy GET list plus
// live ClinicalTrials/PubMed calls, so its numbers disagreed with the board's; this one is
// the board's own math, so "rank #12, strong on Dependency" reads the same on both screens.
import {
  CRITERIA, CORE_CRITERIA, buildBoard, criterionBreakdown, computeVerdict,
  type CriterionKey, type ModalityKey, type ScoredGene, type TargetVerdict, type CriterionBreakdown, type LitWindow,
} from './rankingBoard';
import { MODALITY_CATEGORIES, TIER_RANK, type Tier, type MechanisticGoal } from './modalityConstants';

export type { Tier, MechanisticGoal };
export const ASSESS_MAX = 4;   // side-by-side columns; more than this and the matrix stops being readable

/** What /api/modality-fit/batch returns per gene (mirrors ModalitySummary on the server). */
export interface ModalityFitRow {
  gene: string;
  resolved: boolean;
  best: { modality: string; category: string; tier: Tier } | null;
  byCategory: Record<string, Tier>;
  counts: Record<Tier, number>;
  blocked: string[];
  error?: string;
}

export interface AssessedTarget {
  symbol: string;
  found: boolean;                 // present in the snapshot — false means "no evidence here", not "bad"
  scored: ScoredGene | null;
  verdict: TargetVerdict | null;
  breakdown: Partial<Record<CriterionKey, CriterionBreakdown>>;
  /** 0–1 standing against the field leader per criterion (what the board's bars show). */
  rel: Partial<Record<CriterionKey, number | null>>;
  modality: ModalityFitRow | null; // null until the batch returns, or if it failed
}

export interface Assessment {
  snapshotId: number;
  disease: string;
  modality: ModalityKey;
  litWindow: LitWindow;
  total: number;                          // targets on the board
  activeCriteria: CriterionKey[];
  weights: Record<CriterionKey, number>;  // normalised over the active criteria
  targets: AssessedTarget[];
  /** Per criterion, the symbol with the highest score among the assessed targets (null on a tie or no data). */
  leaders: Partial<Record<CriterionKey, string | null>>;
  /** Per modality category, the symbol(s) reaching the best tier. */
  modalityLeaders: Record<string, string[]>;
}

export const TIER_ORDER: Tier[] = ['Precedented', 'Plausible', 'Speculative', 'Blocked'];
export const CATEGORY_ORDER = [...MODALITY_CATEGORIES].sort((a, b) => a.localeCompare(b));

/** Score the picked symbols against the whole board. `rows` are /api/dashboard/genes rows. */
export function assessTargets(
  rows: any[],
  symbols: string[],
  opts: { snapshotId: number; disease: string; modality?: ModalityKey; litWindow?: LitWindow },
): Assessment {
  const modality = opts.modality ?? 'small_molecule';
  const litWindow = opts.litWindow ?? 'all';
  const board = buildBoard(rows, modality, undefined, { litWindow });
  const bySym = new Map(board.scored.map(s => [s.symbol.toUpperCase(), s]));
  const wanted = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, ASSESS_MAX);

  const targets: AssessedTarget[] = wanted.map(symbol => {
    const scored = bySym.get(symbol) ?? null;
    if (!scored) return { symbol, found: false, scored: null, verdict: null, breakdown: {}, rel: {}, modality: null };
    const breakdown: Partial<Record<CriterionKey, CriterionBreakdown>> = {};
    const rel: Partial<Record<CriterionKey, number | null>> = {};
    for (const k of board.activeCriteria) {
      breakdown[k] = criterionBreakdown(k, scored.raw, { litWindow });
      const v = scored.criteria[k];
      rel[k] = v == null || !isFinite(v) ? null : Math.max(0, Math.min(1, v / (board.criterionMax[k] || 1)));
    }
    const verdict = computeVerdict(scored, board.scored.length, board.activeCriteria, board.weights, board.criterionMax);
    return { symbol, found: true, scored, verdict, breakdown, rel, modality: null };
  });

  return {
    snapshotId: opts.snapshotId, disease: opts.disease, modality, litWindow,
    total: board.scored.length, activeCriteria: board.activeCriteria, weights: board.weights,
    targets,
    leaders: criterionLeaders(targets, board.activeCriteria),
    modalityLeaders: {},
  };
}

/** Attach modality-fit rows and recompute the per-category leaders. */
export function withModality(a: Assessment, fit: ModalityFitRow[]): Assessment {
  const byGene = new Map(fit.map(r => [String(r.gene).toUpperCase(), r]));
  const targets = a.targets.map(t => ({ ...t, modality: byGene.get(t.symbol) ?? t.modality }));
  return { ...a, targets, modalityLeaders: modalityLeaders(targets) };
}

export function criterionLeaders(targets: AssessedTarget[], keys: CriterionKey[]): Partial<Record<CriterionKey, string | null>> {
  const out: Partial<Record<CriterionKey, string | null>> = {};
  for (const k of keys) {
    let best: string | null = null, bestV = -Infinity, tie = false;
    for (const t of targets) {
      const v = t.scored?.criteria[k];
      if (v == null || !isFinite(v)) continue;
      if (v > bestV + 1e-9) { best = t.symbol; bestV = v; tie = false; }
      else if (Math.abs(v - bestV) <= 1e-9) tie = true;
    }
    out[k] = tie ? null : best;
  }
  return out;
}

export function modalityLeaders(targets: AssessedTarget[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const cat of CATEGORY_ORDER) {
    let bestRank = -1, who: string[] = [];
    for (const t of targets) {
      const tier = t.modality?.resolved ? t.modality.byCategory[cat] : undefined;
      if (!tier) continue;
      const r = TIER_RANK[tier];
      if (r > bestRank) { bestRank = r; who = [t.symbol]; }
      else if (r === bestRank) who.push(t.symbol);
    }
    // A "lead" that every target shares, or that is merely Blocked, is not a lead.
    out[cat] = bestRank >= TIER_RANK.Speculative && who.length < Math.max(2, targets.filter(t => t.modality?.resolved).length) ? who : [];
  }
  return out;
}

export const criterionLabel = (k: CriterionKey) => CRITERIA.find(c => c.key === k)?.label ?? k;
export const isCore = (k: CriterionKey) => CORE_CRITERIA.has(k);

/** A short, honest one-liner per target for chips and the report. */
export function headline(t: AssessedTarget, total: number): string {
  if (!t.found || !t.verdict || !t.scored) return 'not in this snapshot — no stored evidence for this disease';
  const v = t.verdict;
  const parts = [`rank #${v.rank.toLocaleString()} of ${total.toLocaleString()} (${v.tier.toLowerCase()})`];
  if (v.strengths.length) parts.push(`strong on ${v.strengths.join(', ')}`);
  if (v.drags.length) parts.push(`held back by ${v.drags.join(', ')}`);
  if (v.gaps.length) parts.push(`no data for ${v.gaps.join(', ')}`);
  return parts.join(' · ');
}

/** The evidence block the AI trade-off narrative is written from. Numbers only — the
 *  prompt tells the model to cite these and nothing else. */
export function narrativeContext(a: Assessment, goal: MechanisticGoal): string {
  const lines: string[] = [];
  lines.push(`Disease: ${a.disease} · snapshot #${a.snapshotId} · ${a.total.toLocaleString()} targets on the board · modality weights: ${a.modality.replace('_', ' ')} · literature window: ${a.litWindow}`);
  lines.push(`Active criteria and weights: ${a.activeCriteria.map(k => `${criterionLabel(k)} ${Math.round(a.weights[k] * 100)}%`).join(', ')}`);
  lines.push('');
  for (const t of a.targets) {
    lines.push(`## ${t.symbol}`);
    if (!t.found || !t.scored || !t.verdict) { lines.push('Not in this snapshot: no stored evidence for this disease. Do not score it; say so.'); lines.push(''); continue; }
    lines.push(`Board: ${headline(t, a.total)} · overall ${t.scored.display}/100 (leader = 100) · ${t.scored.coverage}/${a.activeCriteria.length} criteria with data`);
    for (const k of a.activeCriteria) {
      const v = t.scored.criteria[k];
      const b = t.breakdown[k];
      const terms = (b?.metrics ?? []).filter(m => m.role !== 'context' && m.value != null).map(m => `${m.label} = ${m.value}`).join('; ');
      lines.push(`- ${criterionLabel(k)}: ${v == null ? 'no data' : `${(v * 100).toFixed(0)}/100 (${Math.round((t.rel[k] ?? 0) * 100)}% of field leader)`}${terms ? ` — ${terms}` : ''}`);
    }
    const m = t.modality;
    if (m?.resolved) {
      const cats = CATEGORY_ORDER.map(c => `${c}: ${m.byCategory[c] ?? 'n/a'}`).join(', ');
      lines.push(`- Modality fit (goal: ${goal.replace('_', ' ')}): best = ${m.best ? `${m.best.modality} (${m.best.tier})` : 'none'}; by category — ${cats}${m.blocked.length ? `; blocked: ${m.blocked.join(', ')}` : ''}`);
    } else if (m) {
      lines.push(`- Modality fit: ${m.error ? `unavailable (${m.error})` : 'symbol not recognised by the modality sources'}`);
    }
    lines.push('');
  }
  const leads = a.activeCriteria.map(k => a.leaders[k] ? `${criterionLabel(k)} → ${a.leaders[k]}` : null).filter(Boolean);
  if (leads.length) lines.push(`Criterion leaders among these targets: ${leads.join('; ')}`);
  const ml = Object.entries(a.modalityLeaders).filter(([, v]) => v.length).map(([c, v]) => `${c} → ${v.join('/')}`);
  if (ml.length) lines.push(`Modality leaders: ${ml.join('; ')}`);
  return lines.join('\n');
}

export function narrativePrompt(a: Assessment, goal: MechanisticGoal): string {
  const n = a.targets.filter(t => t.found).length;
  return `You are a drug-discovery scientist writing a target assessment for ${a.disease}. Use ONLY the evidence block below — every number you cite must appear in it, with its criterion name. Do not add facts from memory; if something is not in the block, say it is not in the store.

${narrativeContext(a, goal)}

Write a critical assessment (~${n > 1 ? 450 : 300} words, Markdown, no title):
1. **Evidence profile** — for each target, what the board's criteria say: where it leads, where it is weak, and which core criteria (genetics, expression, dependency, tractability, safety) have no data.
2. **Modality** — which modality each target is realistically reachable by for the goal "${goal.replace('_', ' ')}", and what is blocked or only speculative.
3. **Clinical & attention** — clinical precedent (phase, stopped trials) and literature standing, and whether a low score there reflects novelty rather than weakness.
${n > 1 ? '4. **Trade-offs** — where the targets differ materially, naming the criterion and the numbers.\n5. **Recommendation** — which to take forward for the stated goal and modality, with the deciding criteria; say what evidence would change the call.' : '4. **What would change the call** — the missing or weak evidence that most limits confidence.'}`;
}
