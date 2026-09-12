// ARCHIVED Literature tab — PubTatorView component
// Cut verbatim from index.tsx on 2026-09-12 (see archive/README.md). Not compiled; archive/ is excluded in tsconfig.json.

const PubTatorView = ({ results, isLoading, theme, onAddGene, onShowScoreInfo, onShowTooltip, activeTooltip, onLoadMore, visibleColumns }: {
  results?: (PubTatorResult & { otGeneticScore?: number; otExpressionScore?: number; otTargetScore?: number; otGetScore?: number })[],
  isLoading?: boolean,
  theme: Theme,
  onAddGene: (gene: { symbol: string, name: string }) => void,
  onShowScoreInfo?: (type: any) => void,
  onShowTooltip?: (id: string | null) => void,
  activeTooltip?: string | null,
  onLoadMore?: () => void,
  visibleColumns?: string[],
}) => {
  const col = (key: string) => visibleColumns?.includes(key) ?? false;
  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-20 text-center">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-6" />
        <h3 className="text-lg font-bold mb-2 text-neutral-800 dark:text-neutral-200">Analyzing Literature Landscape</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-500 max-w-md leading-relaxed">
          Fetching therapeutic targets from PubTator (2024-2026) and calculating publication velocity...
        </p>
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-20 text-center">
        <BookOpen className="w-16 h-16 text-blue-500 mb-8 opacity-20" />
        <h3 className="text-lg font-bold mb-2 text-neutral-800 dark:text-neutral-200">No Literature Evidence Found</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-500 max-w-md leading-relaxed">
          Try a different disease or therapeutic area to discover emerging targets.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[1080px] text-left border-collapse">
        <thead className={`sticky top-0 z-10 text-[10px] font-black uppercase tracking-widest border-b backdrop-blur ${theme === 'dark' ? 'bg-[#101827]/95 border-slate-800 text-slate-400' : 'bg-slate-100/95 border-slate-200 text-slate-600 shadow-sm'}`}>
          <tr>
            <th className="p-4 pl-8">Gene</th>
            <th className="p-4 text-center">Total Papers</th>
            <th className="p-4 text-center">Last 3 Years</th>
            <th className="p-4 text-center">Velocity</th>
            {col('geneticScore') && <th className="p-4 text-center whitespace-nowrap text-blue-500 text-[9px] font-black uppercase tracking-wider">Genetic (OT)</th>}
            {col('combinedExpression') && <th className="p-4 text-center whitespace-nowrap text-emerald-500 text-[9px] font-black uppercase tracking-wider">Expression (OT)</th>}
            {col('targetScore') && <th className="p-4 text-center whitespace-nowrap text-amber-500 text-[9px] font-black uppercase tracking-wider">Target (OT)</th>}
            {col('getScore') && <th className="p-4 text-center whitespace-nowrap text-violet-500 text-[9px] font-black uppercase tracking-wider">GET Score (OT)</th>}
            <th className="p-4">Top Paper</th>
            <th className="p-4">Journal</th>
            <th className="p-4 text-center">Year</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {results.map((r, idx) => (
            <tr key={idx} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/20 transition-colors">
              <td className="p-4 pl-8 font-bold text-blue-600 dark:text-blue-500 text-[13px]">{r.gene}</td>
              <td className="p-4 text-center font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{r.totalPapers.toLocaleString()}</td>
              <td className="p-4 text-center font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">{r.recentPapers.toLocaleString()}</td>
              <td className="p-4 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <span className={`text-[11px] font-bold ${r.velocity > 20 ? 'text-emerald-600' : 'text-neutral-500'}`}>
                    {r.velocity.toFixed(1)}%
                  </span>
                  {r.velocity > 20 && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                </div>
              </td>
              {col('geneticScore') && <td className="p-4 text-center font-mono text-[11px]">{r.otGeneticScore !== undefined ? <ScoreBar value={r.otGeneticScore} color="bg-blue-500" theme={theme} /> : <span className="text-neutral-400">—</span>}</td>}
              {col('combinedExpression') && <td className="p-4 text-center font-mono text-[11px]">{r.otExpressionScore !== undefined ? <ScoreBar value={r.otExpressionScore} color="bg-emerald-500" theme={theme} /> : <span className="text-neutral-400">—</span>}</td>}
              {col('targetScore') && <td className="p-4 text-center font-mono text-[11px]">{r.otTargetScore !== undefined ? <ScoreBar value={r.otTargetScore} color="bg-amber-500" theme={theme} /> : <span className="text-neutral-400">—</span>}</td>}
              {col('getScore') && <td className="p-4 text-center font-mono text-[11px]">{r.otGetScore !== undefined ? <ScoreBar value={r.otGetScore} color="bg-violet-500" theme={theme} /> : <span className="text-neutral-400">—</span>}</td>}
              <td className="p-4 max-w-xs">
                <a 
                  href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className={`text-[11px] font-semibold line-clamp-2 leading-relaxed ${theme === 'dark' ? 'text-slate-200 hover:text-blue-400' : 'text-slate-950 hover:text-blue-700'}`}
                >
                  {r.topPaper}
                </a>
              </td>
              <td className={`p-4 text-[10px] font-bold uppercase tracking-tight ${theme === 'dark' ? 'text-slate-400' : 'text-slate-800'}`}>{r.journal}</td>
              <td className={`p-4 font-mono text-[11px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-800'}`}>{r.year}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.length > 0 && (
        <div className="p-8 flex justify-center border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/30 dark:bg-black/20">
          <button 
            onClick={onLoadMore}
            className="group px-10 py-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200 text-[12px] font-bold uppercase tracking-widest hover:bg-neutral-50 dark:hover:bg-neutral-800 active:scale-95 transition-all flex items-center gap-3 shadow-sm hover:shadow-md"
          >
            <Plus className="w-5 h-5 text-blue-600 group-hover:rotate-90 transition-transform" /> 
            Load More Literature Analytics
          </button>
        </div>
      )}
    </div>
  );
};
