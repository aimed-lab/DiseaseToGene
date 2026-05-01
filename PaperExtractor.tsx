import React, { useState } from 'react';
import { 
  FileText, 
  X, 
  Plus,
  ExternalLink,
  FlaskConical,
  Activity,
  BookOpen,
  Database,
  TrendingUp,
  ShieldCheck,
  Beaker,
  Dna,
  Stethoscope,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { PaperAnalysis, GeneResult } from './types';

interface PaperExtractorProps {
  theme: 'light' | 'dark';
  onAddGene: (gene: GeneResult) => void;
  results: PaperAnalysis[];
}

const PaperExtractor: React.FC<PaperExtractorProps> = ({ theme, onAddGene, results }) => {
  const [activeTab, setActiveTab] = useState<'entities' | 'stats' | 'context' | 'summary'>('entities');
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);

  if (results.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-20 text-center animate-in zoom-in duration-500">
        <FileText className="w-16 h-16 text-blue-500 mb-8 opacity-20" />
        <h3 className="text-xl font-bold mb-2 text-neutral-800 dark:text-neutral-200 tracking-tight">No Papers Analyzed</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-500 max-w-sm leading-relaxed">
          Upload research papers via the terminal to extract structured biological intelligence.
        </p>
      </div>
    );
  }

  const currentResult = results[selectedResultIndex];

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-500">
      <div className={`p-6 border-b flex items-center justify-between ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-100'}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight text-neutral-800 dark:text-neutral-200">Paper Intelligence Extractor</h3>
            <p className="text-[10px] font-bold uppercase text-neutral-400 tracking-widest">AI-powered structured data extraction from PDF literature</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            {results.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar-x">
                {results.map((r, i) => (
                  <button 
                    key={i}
                    onClick={() => setSelectedResultIndex(i)}
                    className={`px-4 py-2 rounded-xl text-[11px] font-bold uppercase whitespace-nowrap transition-all ${
                      selectedResultIndex === i ? 'bg-purple-600 text-white shadow-md' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 hover:bg-neutral-200'
                    }`}
                  >
                    {r.title || `Paper ${i+1}`}
                  </button>
                ))}
              </div>
            )}

            <div className={`rounded-3xl border overflow-hidden ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-xl'}`}>
              <div className="p-6 border-b border-neutral-100 dark:border-neutral-800">
                <h2 className="text-xl font-black text-neutral-800 dark:text-neutral-100 leading-tight mb-2">{currentResult.title}</h2>
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                    <BookOpen className="w-3.5 h-3.5" /> {currentResult.study_type}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                    <Activity className="w-3.5 h-3.5" /> n={currentResult.sample_size}
                  </div>
                </div>
              </div>

              <div className="flex border-b border-neutral-100 dark:border-neutral-800">
                {(['entities', 'stats', 'context', 'summary'] as const).map(tab => (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${
                      activeTab === tab ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30 dark:bg-blue-900/10' : 'text-neutral-400 hover:text-neutral-600'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="p-8">
                {activeTab === 'entities' && (
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest flex items-center gap-2">
                        <Dna className="w-4 h-4" /> Genes Identified
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {currentResult.genes.map((g, i) => (
                          <div key={i} className={`p-4 rounded-2xl border flex items-center justify-between group ${theme === 'dark' ? 'bg-neutral-900/50 border-neutral-800' : 'bg-neutral-50 border-neutral-100'}`}>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 font-bold text-xs">
                                {g.mentions}
                              </div>
                              <div>
                                <div className="text-sm font-black text-neutral-800 dark:text-neutral-200">{g.symbol}</div>
                                <div className="text-[10px] text-neutral-500 uppercase tracking-tighter">{g.role}</div>
                              </div>
                            </div>
                            <button 
                              onClick={() => onAddGene(g)}
                              className="p-2 rounded-lg bg-blue-600 text-white opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                              title="Add to Pipeline"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest flex items-center gap-2">
                          <FlaskConical className="w-4 h-4" /> Chemicals & Compounds
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {currentResult.chemicals.map((c, i) => (
                            <div key={i} className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold ${theme === 'dark' ? 'bg-neutral-800 border-neutral-700 text-neutral-300' : 'bg-white border-neutral-200 text-neutral-700'}`}>
                              {c.name} <span className="text-neutral-400 font-normal ml-1">({c.role})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4" /> Variants & Mutations
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {currentResult.variants.map((v, i) => (
                            <div key={i} className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono font-bold ${theme === 'dark' ? 'bg-amber-900/20 border-amber-900/30 text-amber-500' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                              {v}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'stats' && (
                  <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className={`p-6 rounded-3xl border ${theme === 'dark' ? 'bg-neutral-900/50 border-neutral-800' : 'bg-neutral-50 border-neutral-100'}`}>
                        <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1">p-Value</div>
                        <div className="text-2xl font-black text-blue-600">{currentResult.p_value}</div>
                      </div>
                      <div className={`p-6 rounded-3xl border ${theme === 'dark' ? 'bg-neutral-900/50 border-neutral-800' : 'bg-neutral-50 border-neutral-100'}`}>
                        <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1">Fold Change</div>
                        <div className="text-2xl font-black text-emerald-600">{currentResult.fold_change}</div>
                      </div>
                      <div className={`p-6 rounded-3xl border ${theme === 'dark' ? 'bg-neutral-900/50 border-neutral-800' : 'bg-neutral-50 border-neutral-100'}`}>
                        <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1">Odds Ratio</div>
                        <div className="text-2xl font-black text-purple-600">{currentResult.odds_ratio}</div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" /> Drug-Gene Relationships
                      </h4>
                      <div className="overflow-hidden rounded-2xl border border-neutral-100 dark:border-neutral-800">
                        <table className="w-full text-left text-sm">
                          <thead className={theme === 'dark' ? 'bg-neutral-900' : 'bg-neutral-50'}>
                            <tr>
                              <th className="p-4 font-bold text-[10px] uppercase tracking-wider text-neutral-500">Drug</th>
                              <th className="p-4 font-bold text-[10px] uppercase tracking-wider text-neutral-500">Target Gene</th>
                              <th className="p-4 font-bold text-[10px] uppercase tracking-wider text-neutral-500">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                            {currentResult.drug_gene_relationships.map((rel, i) => (
                              <tr key={i} className={theme === 'dark' ? 'bg-neutral-900/20' : 'bg-white'}>
                                <td className="p-4 font-bold text-neutral-800 dark:text-neutral-200">{rel.drug}</td>
                                <td className="p-4 font-mono text-blue-600 font-bold">{rel.gene}</td>
                                <td className="p-4">
                                  <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-600 text-[10px] font-bold uppercase">
                                    {rel.action}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'context' && (
                  <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest flex items-center gap-2">
                          <Beaker className="w-4 h-4" /> Experimental Models
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {currentResult.experimental_models.map((m, i) => (
                            <div key={i} className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold ${theme === 'dark' ? 'bg-neutral-800 border-neutral-700 text-neutral-300' : 'bg-white border-neutral-200 text-neutral-700'}`}>
                              {m}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest flex items-center gap-2">
                          <Stethoscope className="w-4 h-4" /> Cell Types & Regions
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {currentResult.cell_types.map((c, i) => (
                            <div key={i} className="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 text-[11px] font-bold border border-blue-500/20">
                              {c}
                            </div>
                          ))}
                          {currentResult.brain_regions.map((r, i) => (
                            <div key={i} className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-600 text-[11px] font-bold border border-purple-500/20">
                              {r}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest flex items-center gap-2">
                        <Database className="w-4 h-4" /> Study Metadata
                      </h4>
                      <div className={`p-6 rounded-3xl border space-y-4 ${theme === 'dark' ? 'bg-neutral-900/50 border-neutral-800' : 'bg-neutral-50 border-neutral-100'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-neutral-500 uppercase">Species</span>
                          <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{currentResult.species.join(', ')}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-neutral-500 uppercase">Funding Sources</span>
                          <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{currentResult.funding.join(', ')}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-neutral-500 uppercase">Industry Involvement</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${currentResult.industry_funded ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                            {currentResult.industry_funded ? 'Industry Funded' : 'Academic / Non-Profit'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'summary' && (
                  <div className="space-y-8">
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <h4 className="text-[11px] font-bold uppercase text-blue-600 tracking-widest">Key Finding</h4>
                        <p className="text-lg font-bold text-neutral-800 dark:text-neutral-100 leading-tight">
                          {currentResult.key_finding}
                        </p>
                      </div>
                      
                      <div className="space-y-3">
                        <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest">Conclusion</h4>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                          {currentResult.conclusion}
                        </p>
                      </div>

                      <div className="pt-8 border-t border-neutral-100 dark:border-neutral-800">
                        <p className="text-[11px] font-bold text-neutral-400 italic">
                          This {currentResult.study_type} (n={currentResult.sample_size}) identified {currentResult.genes[0]?.symbol} in {currentResult.diseases[0]} ({currentResult.p_value}).
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaperExtractor;
