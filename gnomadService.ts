// gnomAD constraint (safety) data layer.
// Live per-gene constraint metrics (pLI / LOEUF) from the gnomAD GraphQL API,
// routed through the app's /api/gnomad-graphql server endpoint (same pattern as
// the existing /api/ot-graphql route) to avoid browser CORS and reuse the cache.
// This file is ADDITIVE — it does not touch any existing scoring or service.
//
// Purpose: the "reasons-not-to-pursue" safety signal. A loss-of-function
// intolerant gene (high pLI / low LOEUF) is one healthy humans need two working
// copies of — so knocking it down risks on-target toxicity. This is a caution
// flag the funnel weighs, NOT an automatic disqualifier (KRAS/SRC/EGFR are all
// constrained yet remain prime targets).

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConstraintClass =
  | 'LoF-intolerant'      // pLI >= 0.9 or LOEUF < 0.6  → strong selection against knockout
  | 'Intermediate'        // in between
  | 'LoF-tolerant'        // LOEUF >= 1.0               → knockout is tolerated in the population
  | 'Unknown';            // gene not found / no constraint record

export interface GnomadConstraint {
  geneSymbol: string;
  geneId: string | null;          // Ensembl gene id from gnomAD
  pli: number | null;             // probability of LoF intolerance (0..1)
  loeuf: number | null;           // oe_lof_upper — recommended continuous metric (low = constrained)
  oeLof: number | null;           // observed/expected LoF point estimate
  lofZ: number | null;            // LoF constraint z-score
  misZ: number | null;            // missense constraint z-score
  constraintClass: ConstraintClass;
  // 0..1 "safety concern" score for the drill-down bar: 1 = most constrained
  // (highest toxicity risk for a knockdown strategy), 0 = fully tolerant.
  safetyConcern: number;
  retrieved: string;              // ISO date — provenance
  source: string;                 // 'gnomAD v4.1' (preloaded table) or 'gnomAD v4' (live)
  error: string | null;
}

// ─── GraphQL plumbing (routes through the server, like ot-graphql) ────────────

const GQL = `query GeneConstraint($symbol: String!) {
  gene(gene_symbol: $symbol, reference_genome: GRCh38) {
    gene_id
    symbol
    gnomad_constraint {
      pLI
      oe_lof
      oe_lof_upper
      lof_z
      mis_z
    }
  }
}`;

async function gnomadGraphql(symbol: string): Promise<any> {
  const res = await fetch('/api/gnomad-graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: GQL, variables: { symbol } }),
  });
  if (!res.ok) throw new Error(`gnomAD proxy ${res.status}`);
  return res.json();
}

// ─── Classification / scoring ─────────────────────────────────────────────────

function classify(pli: number | null, loeuf: number | null): ConstraintClass {
  if (pli == null && loeuf == null) return 'Unknown';
  if ((pli != null && pli >= 0.9) || (loeuf != null && loeuf < 0.6)) return 'LoF-intolerant';
  if (loeuf != null && loeuf >= 1.0) return 'LoF-tolerant';
  return 'Intermediate';
}

// Map constraint to a 0..1 "safety concern". LOEUF is the primary driver
// (lower = more constrained = more concern); fall back to pLI if LOEUF missing.
function safetyConcern(pli: number | null, loeuf: number | null): number {
  if (loeuf != null) {
    // LOEUF ~0 → concern 1 ; LOEUF ~1.5+ → concern ~0
    return Math.max(0, Math.min(1, 1 - loeuf / 1.5));
  }
  if (pli != null) return Math.max(0, Math.min(1, pli));
  return 0;
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function getGnomadConstraint(geneSymbol: string): Promise<GnomadConstraint> {
  const base: GnomadConstraint = {
    geneSymbol,
    geneId: null,
    pli: null, loeuf: null, oeLof: null, lofZ: null, misZ: null,
    constraintClass: 'Unknown',
    safetyConcern: 0,
    retrieved: new Date().toISOString().slice(0, 10),
    source: 'gnomAD v4',
    error: null,
  };

  // Prefer the preloaded gnomAD v4.1 constraint table (served at /api/gnomad) so
  // this drill-down shows the SAME pLI / LOEUF the harvest stored in Oracle and the
  // funnel filters on — one source of truth. The live v4 GraphQL API returns values
  // that differ slightly from gnomAD's own published file (e.g. KRAS LOEUF 0.226 vs
  // 0.264), which is why we standardize on the published table. Fall back to the
  // live API only for genes the table is missing.
  try {
    const tRes = await fetch(`/api/gnomad?gene=${encodeURIComponent(geneSymbol)}`);
    if (tRes.ok) {
      const tj = await tRes.json();
      const d = tj?.data;
      if (d && (d.pli != null || d.loeuf != null)) {
        const pli = num(d.pli);
        const loeuf = num(d.loeuf);
        return {
          ...base,
          pli, loeuf,
          oeLof: num(d.oe_lof),
          lofZ: num(d.lof_z),
          misZ: num(d.mis_z),
          constraintClass: classify(pli, loeuf),
          safetyConcern: safetyConcern(pli, loeuf),
          source: 'gnomAD v4.1',
        };
      }
    }
  } catch { /* table unavailable — fall through to the live API */ }

  try {
    const data = await gnomadGraphql(geneSymbol);
    const gene = data?.data?.gene;
    if (!gene) return { ...base, error: 'Gene not found in gnomAD' };
    const c = gene.gnomad_constraint;
    if (!c) return { ...base, geneId: gene.gene_id ?? null, error: 'No constraint record (gene may be non-coding or lacks coverage)' };

    const pli = num(c.pLI);
    const loeuf = num(c.oe_lof_upper);
    return {
      ...base,
      geneId: gene.gene_id ?? null,
      pli,
      loeuf,
      oeLof: num(c.oe_lof),
      lofZ: num(c.lof_z),
      misZ: num(c.mis_z),
      constraintClass: classify(pli, loeuf),
      safetyConcern: safetyConcern(pli, loeuf),
    };
  } catch (err: any) {
    return { ...base, error: err?.message || 'Unknown error' };
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : v == null ? NaN : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// ─── Batch function for gene list (rate limited) ──────────────────────────────

export async function getGnomadBatch(
  geneSymbols: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, GnomadConstraint>> {
  const results = new Map<string, GnomadConstraint>();
  const DELAY_MS = 200; // be polite to the gnomAD API
  for (let i = 0; i < geneSymbols.length; i++) {
    results.set(geneSymbols[i], await getGnomadConstraint(geneSymbols[i]));
    onProgress?.(i + 1, geneSymbols.length);
    if (i < geneSymbols.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }
  return results;
}
