export interface StringEdge {
  preferredName_A: string;
  preferredName_B: string;
  score: number;
}

/**
 * Random Walk with Restart algorithm for gene network scores.
 * @param nodes List of all gene symbols in the network
 * @param edges List of interactions from STRING API
 * @param seeds Top genes to start the walk from
 * @param restartProb Probability of jumping back to seeds (0-1)
 * @param maxIterations Max iterations for power iteration
 * @param convergenceThreshold L1 norm threshold for stopping
 */
export const runRWR = (
  nodes: string[],
  edges: StringEdge[],
  seeds: string[],
  restartProb = 0.3,
  maxIterations = 100,
  convergenceThreshold = 1e-6
): Record<string, number> => {
  const n = nodes.length;
  if (n === 0) return {};
  
  const nodeToIndex = new Map(nodes.map((node, i) => [node, i]));
  
  // Build adjacency matrix (weighted)
  // M[i][j] is probability of moving from j to i
  const adj = Array.from({ length: n }, () => new Float32Array(n));
  const sums = new Float32Array(n);
  
  edges.forEach(edge => {
    const u = nodeToIndex.get(edge.preferredName_A);
    const v = nodeToIndex.get(edge.preferredName_B);
    if (u !== undefined && v !== undefined) {
      // STRING API scores for network are 0-1 usually in the JSON response, 
      // but let's be safe and normalize if they are 0-1000.
      const weight = edge.score > 1 ? edge.score / 1000 : edge.score;
      adj[u][v] = weight;
      adj[v][u] = weight;
      sums[u] += weight;
      sums[v] += weight;
    }
  });
  
  // Normalize adjacency matrix to transition matrix
  for (let j = 0; j < n; j++) {
    if (sums[j] > 0) {
      for (let i = 0; i < n; i++) {
        adj[i][j] /= sums[j];
      }
    }
  }
  
  // Seed vector p0
  let p = new Float32Array(n);
  const seedIndices = seeds.map(s => nodeToIndex.get(s)).filter(idx => idx !== undefined) as number[];
  if (seedIndices.length === 0) return {};
  
  seedIndices.forEach(idx => {
    p[idx] = 1 / seedIndices.length;
  });
  const p0 = new Float32Array(p);
  
  // Power iteration: pt+1 = (1-r)M pt + r p0
  for (let iter = 0; iter < maxIterations; iter++) {
    const nextP = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += adj[i][j] * p[j];
      }
      nextP[i] = (1 - restartProb) * sum + restartProb * p0[i];
    }
    
    // Check convergence
    let diff = 0;
    for (let i = 0; i < n; i++) {
      diff += Math.abs(nextP[i] - p[i]);
    }
    p = nextP;
    if (diff < convergenceThreshold) break;
  }
  
  const results: Record<string, number> = {};
  nodes.forEach((node, i) => {
    results[node] = p[i];
  });
  
  return results;
};
