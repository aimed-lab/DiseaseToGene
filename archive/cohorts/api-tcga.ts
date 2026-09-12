// ARCHIVED Cohorts tab — the two api.ts helpers it used (external APEX gtkb endpoints; no server route)
// Cut verbatim from api.ts on 2026-09-12 (see archive/README.md). Not compiled; archive/ is excluded in tsconfig.json.

  async getTcgaClinical(cancerType: string, offset: number = 0): Promise<any[]> {
    try {
      const res = await fetch(`https://aimed.uab.edu/apex/gtkb/clinical_data/pancan/${cancerType.toLowerCase()}?offset=${offset}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      return data.items || data.rows || (Array.isArray(data) ? data : []);
    } catch (e) { 
      logDev("getTcgaClinical failed:", e);
      return []; 
    }
  },

  async getTcgaExpressionPage(cancerType: string, genes: string[], offset: number): Promise<{ items: any[], hasMore: boolean }> {
    try {
      const genesParam = genes.join(',');
      const res = await fetch(`https://aimed.uab.edu/apex/gtkb/gene_exp/data?condition=${cancerType.toLowerCase()}&genes=${genesParam}&row_limit=10000`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      return {
        items: data.result || data.items || data.rows || (Array.isArray(data) ? data : []),
        hasMore: data.hasMore || false
      };
    } catch (e) {
      logDev("getTcgaExpressionPage failed:", e);
      return { items: [], hasMore: false };
    }
  },

  // ── Full Gene Assessment ─────────────────────────────────────────────────
  // Uses ranked-list data for scores/bimodality + fresh ClinicalTrials + PubMed.
  // No Open Targets calls — those were unreliable for direct gene profile lookup.
