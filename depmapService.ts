// Functional dependency (DepMap CRISPR) data layer.
// Reads a PRELOADED reference table served by the app's /api/depmap endpoint.
// This file is ADDITIVE — it does not touch any existing scoring or service.
//
// Why preloaded (not live): DepMap has no usable per-gene public API (the portal
// returns a bot-verification wall). The CRISPR (Chronos) gene-effect data ships as
// a bulk matrix [~1,100 cell lines × ~18,000 genes]. We slice the pancreatic
// lineage once (scripts/build_depmap_pancreatic.mjs) into a gene-keyed table and
// serve it. Until built, the endpoint returns { notLoaded: true }.
//
// Purpose: the dependency gate — does the tumor actually NEED this gene to
// survive? Separates drivers from passengers. Chronos gene-effect: 0 = no effect,
// −1 = median common-essential (strong dependency), positive = knockout helps
// growth (rare). The single biggest causal-evidence upgrade short of a trial.

export type DependencyClass =
  | 'Strong dependency'   // mean Chronos < −1.0
  | 'Dependency'          // < −0.5
  | 'Weak dependency'     // < −0.1
  | 'Not dependent'       // >= −0.1
  | 'Unknown';

export interface DependencyProfile {
  geneSymbol: string;
  meanChronos: number | null;     // mean gene-effect across pancreatic cell lines
  minChronos: number | null;      // strongest (most negative) line
  nLines: number | null;          // pancreatic lines screened
  fracDependent: number | null;   // fraction of lines with gene-effect < −0.5
  dependencyClass: DependencyClass;
  // 0..1 dependency strength for the drill-down bar (Chronos 0→0, −1→1, clamped).
  dependencyScore: number;
  source: string;                 // e.g. "DepMap Public 24Q2 (Chronos, Pancreas lineage)"
  notLoaded: boolean;
  error: string | null;
}

function classify(mean: number | null): DependencyClass {
  if (mean == null) return 'Unknown';
  if (mean < -1.0) return 'Strong dependency';
  if (mean < -0.5) return 'Dependency';
  if (mean < -0.1) return 'Weak dependency';
  return 'Not dependent';
}

function strength(mean: number | null): number {
  if (mean == null) return 0;
  return Math.max(0, Math.min(1, -mean)); // −1 → 1, 0 → 0
}

export async function getDependency(geneSymbol: string): Promise<DependencyProfile> {
  const base: DependencyProfile = {
    geneSymbol,
    meanChronos: null, minChronos: null, nLines: null, fracDependent: null,
    dependencyClass: 'Unknown', dependencyScore: 0,
    source: 'DepMap CRISPR (Chronos, Pancreas lineage)',
    notLoaded: false, error: null,
  };

  try {
    const res = await fetch(`/api/depmap?gene=${encodeURIComponent(geneSymbol)}`);
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      if (body?.notLoaded) return { ...base, notLoaded: true, error: 'DepMap reference table not built yet' };
    }
    if (!res.ok) return { ...base, error: `DepMap endpoint ${res.status}` };
    const body = await res.json();
    if (body?.meta?.source) base.source = body.meta.source;
    base.nLines = body?.meta?.n_lines ?? null;
    const d = body?.data;
    if (!d) return { ...base, error: `${geneSymbol} not screened / not in DepMap` };

    const mean = num(d.mean);
    return {
      ...base,
      meanChronos: mean,
      minChronos: num(d.min),
      nLines: d.n_lines ?? base.nLines,
      fracDependent: num(d.frac_dependent),
      dependencyClass: classify(mean),
      dependencyScore: strength(mean),
    };
  } catch (err: any) {
    return { ...base, error: err?.message || 'Unknown error' };
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function getDependencyBatch(
  geneSymbols: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, DependencyProfile>> {
  const results = new Map<string, DependencyProfile>();
  for (let i = 0; i < geneSymbols.length; i++) {
    results.set(geneSymbols[i], await getDependency(geneSymbols[i]));
    onProgress?.(i + 1, geneSymbols.length);
  }
  return results;
}
