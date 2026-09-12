// ARCHIVED Literature tab — the load-more handler and the prefetch effect that lived in App()
// Cut verbatim from index.tsx on 2026-09-12 (see archive/README.md). Not compiled; archive/ is excluded in tsconfig.json.

  const handleLoadMoreLiterature = async () => {
    if (!researchState.pubtatorGenePool || !researchState.activeDisease) return;
    
    setLoading(true);
    setLoadingMessage("Fetching next batch of publication analytics...");
    
    try {
      const PAGE_SIZE = 20;
      // Initial batch consumes first 100 genes from pool (velocity-ranked) — start load-more after that
      const INITIAL_BATCH = 100;
      const start = INITIAL_BATCH + (researchState.pubtatorPage - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const nextGenes = researchState.pubtatorGenePool.slice(start, end);

      if (nextGenes.length === 0) {
        alert("End of extracted gene pool reached.");
        return;
      }

      const newResults = await api.getPubTatorVelocityBatch(nextGenes, researchState.activeDisease.name);

      setResearchState(prev => {
        const existing = new Set((prev.pubtatorResults || []).map(r => r.gene.toUpperCase()));
        const dedupedNew = newResults.filter(r => !existing.has(r.gene.toUpperCase()));
        const combined = [...(prev.pubtatorResults || []), ...dedupedNew];
        // Re-sort by weighted score (recentPapers × velocity) — same as initial sort
        const ws = (r: { recentPapers: number; velocity: number }) => r.recentPapers * (r.velocity / 100);
        combined.sort((a, b) => ws(b) - ws(a));
        return { ...prev, pubtatorResults: combined, pubtatorPage: prev.pubtatorPage + 1 };
      });
      
      // Update network scores with new potential seeds
      performRWR(researchState.targets, newResults.map(r => r.gene));
      
    } catch (err) {
      logDev("Literature pagination error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'pubtator' && researchState.activeDisease && !researchState.pubtatorResults && !researchState.isFetchingPubTator) {
      const fetchPubTator = async () => {
        setResearchState(prev => ({ ...prev, isFetchingPubTator: true }));
        try {
          const data = await api.getPubTatorLiterature(researchState.activeDisease!.name);
          setResearchState(prev => ({ ...prev, pubtatorResults: data.results, pubtatorGenePool: data.pool, isFetchingPubTator: false }));
        } catch (e) {
          logDev("PubTator fetch failed:", e);
          setResearchState(prev => ({ ...prev, isFetchingPubTator: false }));
        }
      };
      fetchPubTator();
    }
  }, [viewMode, researchState.activeDisease, researchState.pubtatorResults, researchState.isFetchingPubTator]);
