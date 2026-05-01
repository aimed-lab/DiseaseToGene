export interface WinnerStringEdge {
  gene_a: string;
  gene_b: string;
  score: number;
}

/**
 * WINNER prioritize algorithm implementation.
 * Paper: Nguyen T et al. 2022, Frontiers in Big Data.
 * 
 * @param genes List of gene symbols in the network
 * @param stringEdges List of interactions from STRING API
 * @returns Object mapping gene symbol to raw WINNER score
 */
export function runWINNER(genes: string[], stringEdges: any[]): Record<string, number> {
  // Step 1 — build PPI matrix
  const PPI: Record<string, Record<string, number>> = {};
  genes.forEach(g => {
    PPI[g] = {};
    genes.forEach(h => {
      PPI[g][h] = 0;
    });
  });

  stringEdges.forEach(edge => {
    // Check both potential property naming conventions from STRING API logic in this app
    const gA = edge.preferredName_A || edge.gene_a;
    const gB = edge.preferredName_B || edge.gene_b;
    const score = edge.score > 1 ? edge.score / 1000 : edge.score;

    if (PPI[gA] && PPI[gB]) {
      PPI[gA][gB] = score;
      PPI[gB][gA] = score; // symmetric
    }
  });

  // Step 2 — initial score
  const initialScore: Record<string, number> = {};
  genes.forEach(g => {
    let wSum = 0;
    let count = 0;
    genes.forEach(h => {
      if (PPI[g][h] > 0) {
        wSum += PPI[g][h];
        count++;
      }
    });
    // exp(2*log(nodeWDeg) - log(nodeDeg)) = nodeWDeg² / nodeDeg
    initialScore[g] = (count > 0 && wSum > 0)
      ? (wSum * wSum) / count
      : 0;
  });

  // Step 3 — row normalize into A
  const A: Record<string, Record<string, number>> = {};
  genes.forEach(g => {
    A[g] = {};
    const rowSum = genes.reduce((s, h) => s + PPI[g][h], 0);
    genes.forEach(h => {
      A[g][h] = rowSum > 0 ? PPI[g][h] / rowSum : 0;
    });
  });

  // Step 4 — iterate 100 times
  const SIGMA = 0.85;
  const MAX_ITER = 100;
  let p = { ...initialScore };

  for (let t = 0; t < MAX_ITER; t++) {
    // compute A_transpose × p
    const Atp: Record<string, number> = {};
    genes.forEach(i => {
      Atp[i] = 0;
    });

    genes.forEach(j => { // source gene j
      genes.forEach(i => { // target gene i
        // (A_transpose * p)[i] = sum(A[j][i] * p[j])
        Atp[i] += A[j][i] * p[j];
      });
    });

    // new p = (1-sigma)*initialScore + sigma*A'*p
    const pNew: Record<string, number> = {};
    genes.forEach(g => {
      pNew[g] = (1 - SIGMA) * initialScore[g] + SIGMA * Atp[g];
    });

    p = pNew;
  }

  return p; // raw WINNER scores
}
