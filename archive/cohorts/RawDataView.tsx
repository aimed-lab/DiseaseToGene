// ARCHIVED Cohorts tab — RawDataView component
// Cut verbatim from index.tsx on 2026-09-12 (see archive/README.md). Not compiled; archive/ is excluded in tsconfig.json.

const RawDataView = ({ targets, theme, cancerType }: { targets: Target[], theme: Theme, cancerType: string }) => {
  const [clinicalData, setClinicalData] = useState<ClinicalSample[]>([]);
  const [selectedSample, setSelectedSample] = useState<ClinicalSample | null>(null);
  const [expressionData, setExpressionData] = useState<ExpressionRow[]>([]);
  const [loadingClinical, setLoadingClinical] = useState(false);
  const [loadingExpression, setLoadingExpression] = useState(false);
  const [showOnlyGetGenes, setShowOnlyGetGenes] = useState(true);
  const [offset, setOffset] = useState(0);
  const getTargetSymbols = useMemo(() => new Set(targets.map(t => t.symbol)), [targets]);
  
  useEffect(() => { 
    const fetchClinical = async () => { 
      setLoadingClinical(true); 
      const data = await api.getTcgaClinical(cancerType, offset); 
      // Normalize clinical data keys
      const normalized = data.map(item => ({
        sampleid: item.SAMPLEID ?? item.sampleid ?? item.SampleID ?? item.sample_id ?? item.sample ?? item.PATIENT_ID ?? item.patient_id,
        vital_status: item.VITAL_STATUS ?? item.vital_status ?? item.VitalStatus ?? 'Unknown'
      }));
      setClinicalData(normalized); 
      setLoadingClinical(false); 
    }; 
    fetchClinical(); 
  }, [offset, cancerType]);

  const handleSelectSample = async (sample: ClinicalSample) => { 
    setSelectedSample(sample); 
    setLoadingExpression(true); 
    
    // Use the new expression API format
    // Since we need expression for a specific sample, we fetch the target genes
    // and filter for this sample. If "Show All" is selected, we are limited by the API
    // so we'll primarily support the target list genes.
    const genesToFetch = showOnlyGetGenes ? Array.from(getTargetSymbols) : ['TP53', 'BRCA1', 'EGFR', 'MYC', 'PTEN']; // Fallback small list if not filtered
    
    const page = await api.getTcgaExpressionPage(cancerType, genesToFetch, 0);
    const sampleRows = page.items.filter(item => {
      const sid = (item.SAMPLEID ?? item.sampleid ?? item.SampleID ?? item.sample_id ?? item.sample ?? item.PATIENT_ID ?? item.patient_id)?.toString().trim().toUpperCase();
      return sid === sample.sampleid.toString().trim().toUpperCase();
    }).map(item => ({
      gene_symbol: (item.GENE_SYMBOL ?? item.gene_symbol ?? item.GeneSymbol ?? item.symbol ?? item.Symbol ?? item.gene),
      value: (item.EXPRESSION_VALUE ?? item.value ?? item.expression_value ?? item.ExpressionValue ?? item.tpm ?? item.TPM ?? item.exp)
    }));
    
    setExpressionData(sampleRows); 
    setLoadingExpression(false); 
  };
  const filteredExpression = useMemo(() => { if (!showOnlyGetGenes) return expressionData; return expressionData.filter(row => getTargetSymbols.has(row.gene_symbol)); }, [expressionData, getTargetSymbols, showOnlyGetGenes]);
  return (
    <div className="h-full flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-neutral-100 dark:divide-neutral-800">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between"><div className="flex items-center gap-2"><Stethoscope className="w-4 h-4 text-neutral-500" /><span className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-400">Cohort Explorer</span></div><div className="flex items-center gap-2"><button onClick={() => setOffset(Math.max(0, offset - 10))} disabled={offset === 0} className="p-1 rounded hover:bg-neutral-100 transition-colors"><ChevronLeft className="w-4 h-4" /></button><span className="text-[10px] font-mono text-neutral-600 dark:text-neutral-500">P. {offset/10 + 1}</span><button onClick={() => setOffset(offset + 10)} className="p-1 rounded hover:bg-neutral-100 transition-colors"><ChevronRight className="w-4 h-4" /></button></div></div>
        <div className="flex-1 overflow-auto">{loadingClinical ? (<div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>) : (<table className="w-full text-left"><thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800 z-10"><tr><th className="p-4 text-[10px] font-bold text-neutral-600 dark:text-neutral-500 uppercase pl-6">Sample ID</th><th className="p-4 text-[10px] font-bold text-neutral-600 dark:text-neutral-500 uppercase">Type</th><th className="p-4 pr-6 text-right text-[10px] font-bold text-neutral-600 dark:text-neutral-500 uppercase">Status</th></tr></thead><tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">{clinicalData.map(sample => (<tr key={sample.sampleid} onClick={() => handleSelectSample(sample)} className={`cursor-pointer transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${selectedSample?.sampleid === sample.sampleid ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}><td className="p-4 pl-6 font-mono text-[11px] text-blue-600 dark:text-blue-400">{sample.sampleid}</td><td className="p-4 text-[11px] text-neutral-700 dark:text-neutral-400">{sample.vital_status === 'Alive' ? 'Alive' : 'Deceased'}</td><td className={`p-4 pr-6 text-right text-[11px] font-medium ${sample.vital_status === 'Alive' ? 'text-[#EB4236]' : 'text-[#4285F5]'}`}>{sample.vital_status}</td></tr>))}</tbody></table>)}</div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between"><div className="flex items-center gap-2"><Activity className="w-4 h-4 text-neutral-500" /><span className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-400">Sample Expression</span></div><button onClick={() => setShowOnlyGetGenes(!showOnlyGetGenes)} className={`text-[10px] font-bold px-3 py-1 rounded border transition-colors ${showOnlyGetGenes ? 'bg-blue-500 text-white' : 'text-neutral-500'}`}>{showOnlyGetGenes ? 'FILTERED' : 'ALL'}</button></div>
        <div className="flex-1 overflow-auto">{!selectedSample ? (<div className="h-full flex flex-col items-center justify-center p-12 text-center text-neutral-400"><DatabaseZap className="w-8 h-8 mb-4 opacity-10" /><p className="text-sm font-medium">Select a patient sample</p></div>) : loadingExpression ? (<div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>) : (<table className="w-full text-left"><thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800 z-10"><tr><th className="p-4 text-[10px] font-bold text-neutral-600 dark:text-neutral-500 uppercase pl-6">Gene</th><th className="p-4 text-[10px] font-bold text-neutral-600 dark:text-neutral-500 uppercase text-center">In List</th><th className="p-4 pr-6 text-right text-[10px] font-bold text-neutral-600 dark:text-neutral-500 uppercase">TPM Value</th></tr></thead><tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">{filteredExpression.map(row => { const isGetGene = getTargetSymbols.has(row.gene_symbol); return (<tr key={row.gene_symbol} className={isGetGene ? 'bg-blue-50/20 dark:bg-blue-900/5' : ''}><td className={`p-4 pl-6 font-semibold text-[11px] ${isGetGene ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-600 dark:text-neutral-300'}`}>{row.gene_symbol}</td><td className="p-4 text-center">{isGetGene && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />}</td><td className="p-4 pr-6 text-right font-mono text-[11px] text-neutral-600 dark:text-neutral-500">{parseFloat(row.value).toFixed(4)}</td></tr>); })}</tbody></table>)}</div>
      </div>
    </div>
  );
};
