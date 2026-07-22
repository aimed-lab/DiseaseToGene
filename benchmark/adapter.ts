// benchmark/adapter.ts ────────────────────────────────────────────────────────
// Turn a STORED snapshot (ranking_scores + evidence rows — exactly the shapes the
// Oracle/ORDS read functions `listRankingScores` and `snapshotEvidence` return) into
// the benchmark's `Universe`. This reproduces FunnelView.tsx's snapshot→FunnelGene
// mapping FIELD-FOR-FIELD, so the benchmark grades the SAME FunnelGene the app ranks —
// no re-derivation, no drift. If FunnelView's read contract changes, change it here too.

import type { FunnelGene } from '../funnelEngine.ts';
import type { Universe } from './benchmark.ts';

// Row shapes are intentionally loose (`any` extras) — they mirror the DB read functions
// which return `any[]`. Only the fields the funnel actually reads are typed.
export interface ScoreRow {
  gene_symbol: string;
  genetic_score?: unknown;
  get_score?: unknown;
  tau_tissue?: unknown;
  [k: string]: unknown;
}
export interface EvidenceRow {
  gene_symbol: string;
  evidence_type: string;
  value_json?: unknown;
  [k: string]: unknown;
}

// Same coercers FunnelView uses, so parsing behaviour is identical (incl. the null/NaN guard).
const num = (v: unknown): number | null => (v == null || isNaN(Number(v)) ? null : Number(v));
const MIN_LIT_PAPERS = 5;   // keep in sync with scripts/d2t.ts + FunnelView.tsx
const safeParse = (s: unknown): any => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };

// Reproduces FunnelView's `feats` mapping (the useEffect that builds GeneFeature → FunnelGene).
export function buildFunnelGenes(scores: ScoreRow[], evidence: EvidenceRow[]): FunnelGene[] {
  // index evidence by gene → evidence_type → parsed value_json (FunnelView's `ev` map)
  const ev: Record<string, Record<string, any>> = {};
  for (const e of evidence) {
    const g = e.gene_symbol; if (!g) continue;
    (ev[g] ||= {})[e.evidence_type] = safeParse(e.value_json) || {};
  }
  return scores.map(r => {
    const g = r.gene_symbol;
    const mut = ev[g]?.mutation, drug = ev[g]?.druggability, clin = ev[g]?.clinical;
    // Literature: Europe PMC is the SINGLE scoring source (PubMed is annotation only) and
    // velocity is dropped below MIN_LIT_PAPERS — same precedence + guard as the funnel.
    const lit = ev[g]?.literature_epmc;
    const litPapers = lit ? num(lit.paper_count) : null;
    const litUsable = !!lit && (litPapers == null || litPapers >= MIN_LIT_PAPERS);
    const dys = ev[g]?.expression_tvn, dep = ev[g]?.dependency, saf = ev[g]?.safety;
    const genetic = num(r.genetic_score);
    return {
      gene_symbol: g,
      otOverall: num(r.get_score),           // eligibility nexus only (not scored)
      geneticAssoc: genetic,                  // G1 genetic SCORE axis
      frequency: mut ? num(mut.frequency) : null,
      log2fc: dys ? num(dys.log2fc) : null,
      chronos: dep ? num(dep.mean) : null,
      loeuf: saf ? num(saf.loeuf) : null,
      drugLabel: drug ? (drug.label ?? null) : null,
      trialCount: clin ? num(clin.trial_count) : null,
      velocity: litUsable ? num(lit!.velocity) : null,
      tissueTau: num(r.tau_tissue),
    };
  });
}

export function buildUniverse(scores: ScoreRow[], evidence: EvidenceRow[], gold: Iterable<string>): Universe {
  const goldSet = new Set<string>();
  for (const s of gold) { const u = (s || '').trim().toUpperCase(); if (u) goldSet.add(u); }
  return { genes: buildFunnelGenes(scores, evidence), goldSet };
}

// Per-axis presence count over the built universe — printed by the runner so a low grade
// caused by a missing/sparse axis (rather than a bad ranking) is visible at a glance.
export function axisCoverage(genes: FunnelGene[]): Record<string, { present: number; pct: number }> {
  const fields: (keyof FunnelGene)[] = ['geneticAssoc', 'frequency', 'log2fc', 'chronos', 'loeuf', 'drugLabel', 'tissueTau'];
  const out: Record<string, { present: number; pct: number }> = {};
  const n = genes.length || 1;
  for (const f of fields) {
    const present = genes.reduce((a, g) => a + (g[f] != null ? 1 : 0), 0);
    out[f as string] = { present, pct: present / n };
  }
  return out;
}
