// Tumor-vs-normal expression (dysregulation) data layer.
// Reads a PRELOADED reference table served by the app's /api/expression endpoint.
// This file is ADDITIVE — it does not touch any existing scoring or service.
//
// Why preloaded (not live): a valid tumor-vs-normal fold-change requires tumor
// (TCGA-PAAD) and normal (GTEx pancreas) expression processed through the SAME
// pipeline/units. The UCSC Xena "Toil" compendium does exactly that. We build a
// gene-keyed table once (scripts/build_expression_paad.mjs) and serve it — which
// is also more reproducible/traceable than a live call. Until the table is built,
// the endpoint returns { notLoaded: true } and the panel says so.
//
// Purpose: the dysregulation gate. "Associated with disease" ≠ "actually
// dysregulated in the tumor." A gene strongly UP in tumor vs healthy pancreas is
// a candidate driver — this is the axis that recovers genes (e.g. SRC) whose raw
// Open Targets genetic score is low.

export interface ExpressionProfile {
  geneSymbol: string;
  tumorMedian: number | null;     // log2(TPM+1), TCGA-PAAD tumors
  normalMedian: number | null;    // log2(TPM+1), GTEx pancreas (+ TCGA normals)
  log2fc: number | null;          // tumorMedian − normalMedian
  pValue: number | null;          // Mann-Whitney U, tumor vs normal
  direction: 'up' | 'down' | 'unchanged' | 'unknown';
  nTumor: number | null;
  nNormal: number | null;
  // 0..1 dysregulation magnitude for the drill-down bar (|log2fc| capped at 4).
  dysregulation: number;
  source: string;                 // e.g. "UCSC Xena Toil (TCGA-PAAD vs GTEx pancreas)"
  notLoaded: boolean;             // true if the reference table has not been built yet
  error: string | null;
}

function magnitude(log2fc: number | null): number {
  if (log2fc == null) return 0;
  return Math.max(0, Math.min(1, Math.abs(log2fc) / 4));
}

function dir(log2fc: number | null, p: number | null): ExpressionProfile['direction'] {
  if (log2fc == null) return 'unknown';
  const sig = p == null || p < 0.05;
  if (!sig || Math.abs(log2fc) < 0.585) return 'unchanged'; // <1.5x
  return log2fc > 0 ? 'up' : 'down';
}

export async function getExpression(geneSymbol: string): Promise<ExpressionProfile> {
  const base: ExpressionProfile = {
    geneSymbol,
    tumorMedian: null, normalMedian: null, log2fc: null, pValue: null,
    direction: 'unknown', nTumor: null, nNormal: null,
    dysregulation: 0,
    source: 'UCSC Xena Toil (TCGA-PAAD vs GTEx pancreas)',
    notLoaded: false, error: null,
  };

  try {
    const res = await fetch(`/api/expression?gene=${encodeURIComponent(geneSymbol)}`);
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      if (body?.notLoaded) return { ...base, notLoaded: true, error: 'Expression reference table not built yet' };
    }
    if (!res.ok) return { ...base, error: `Expression endpoint ${res.status}` };
    const body = await res.json();
    if (body?.meta?.source) base.source = body.meta.source;
    base.nTumor = body?.meta?.n_tumor ?? null;
    base.nNormal = body?.meta?.n_normal ?? null;
    const d = body?.data;
    if (!d) return { ...base, error: `No expression record for ${geneSymbol}` };

    const log2fc = num(d.log2fc);
    const p = num(d.p);
    return {
      ...base,
      tumorMedian: num(d.tumor_median),
      normalMedian: num(d.normal_median),
      log2fc,
      pValue: p,
      direction: dir(log2fc, p),
      nTumor: d.n_tumor ?? base.nTumor,
      nNormal: d.n_normal ?? base.nNormal,
      dysregulation: magnitude(log2fc),
    };
  } catch (err: any) {
    return { ...base, error: err?.message || 'Unknown error' };
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// Batch reads (the endpoint is local/cached, so this is fast).
export async function getExpressionBatch(
  geneSymbols: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, ExpressionProfile>> {
  const results = new Map<string, ExpressionProfile>();
  for (let i = 0; i < geneSymbols.length; i++) {
    results.set(geneSymbols[i], await getExpression(geneSymbols[i]));
    onProgress?.(i + 1, geneSymbols.length);
  }
  return results;
}
