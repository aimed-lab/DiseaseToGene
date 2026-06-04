import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
// AI calls routed through /api/ai/* server endpoints — no keys in browser
// Type enum values replaced with string literals so @google/genai is not needed in the browser bundle
const Type = { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' } as const;
import * as d3 from "d3";
import Markdown from 'react-markdown';
import './index.css';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Legend 
} from 'recharts';
import { 
  Activity, 
  ChevronRight,
  DatabaseZap,
  List,
  Loader2,
  Globe2,
  ArrowRight,
  Share2,
  Sun,
  Moon,
  BarChart3,
  FlaskConical,
  LogOut,
  ShieldCheck,
  Send,
  Sparkles,
  MessageSquare,
  Atom,
  Search,
  Info,
  ChevronDown,
  ChevronUp,
  Layers,
  BookOpen,
  Book,
  Calendar,
  ExternalLink,
  FileText,
  Pill,
  Stethoscope,
  Users,
  Building2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  PanelLeft,
  PanelRight,
  Database,
  ChevronLeft,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Volume2,
  Microscope,
  AlertCircle,
  Flag,
  Maximize,
  TableProperties,
  Plus,
  ArrowUpDown,
  HelpCircle,
  X,
  FileDown,
  ThumbsUp,
  ThumbsDown,
  Pin,
  Save,
  Trash2,
  Home,
  Zap,
  Filter,
  Settings,
  SlidersHorizontal
} from 'lucide-react';

import PaperExtractor from './PaperExtractor';
import DruggabilityPanel from './DruggabilityPanel';
import { getChEMBLDruggability } from './chemblService';
import { supabase, fetchGlobalWeights, saveGlobalWeights, fetchUserProfile, updateUserProfile } from './supabase';
import {
  Target,
  DrugInfo,
  DiseaseInfo,
  EnrichmentResult,
  PubMedStats,
  Theme,
  ViewMode,
  ResearchContext,
  Message,
  ClinicalSample,
  ExpressionRow,
  PubTatorResult,
  GETWeights,
  PaperAnalysis,
  GeneResult,
  GeneAssessmentData,
} from './types';

import { api } from './api';

import { runRWR } from './rwr';
import { runWINNER } from './winner';

// --- Configuration ---
const MAX_WebGL_POINTS = 1024;
const isProduction = process.env.NODE_ENV === 'production';
const logDev = (...args: unknown[]) => {
  if (!isProduction) console.error(...args);
};
const warnDev = (...args: unknown[]) => {
  if (!isProduction) console.warn(...args);
};
const saveBlob = async (blob: Blob, filename: string) => {
  const { saveAs } = await import('file-saver');
  saveAs(blob, filename);
};

// --- Auth types ---
type UserRole = 'admin' | 'user';
interface UserSession { role: UserRole; username: string; userId: string }

const CANCER_TYPE_MAP: Record<string, string> = {
  'bladder': 'BLCA',
  'breast': 'BRCA',
  'cervical': 'CESC',
  'cholangiocarcinoma': 'CHOL',
  'kidney': 'KIRC',
  'brca': 'BRCA',
  'blca': 'BLCA',
  'cesc': 'CESC',
  'chol': 'CHOL',
  'kirc': 'KIRC'
};

const detectCancerType = (name: string) => {
  const lowerName = name.toLowerCase();
  for (const [key, code] of Object.entries(CANCER_TYPE_MAP)) {
    if (lowerName.includes(key)) return code;
  }
  return null;
};

// --- Helper Components for Visualization ---

const RadarChart = ({ target, theme }: { target: Target, theme: Theme }) => {
  const size = 260;
  const center = size / 2;
  const radius = size * 0.35;
  
  const axes = [
    { label: 'Genetic', val: target.geneticScore, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'Expression', val: target.combinedExpression || 0, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: 'Target', val: target.targetScore || 0, color: 'text-amber-500', bg: 'bg-amber-500/10' }
  ];

  const points = axes.map((a, i) => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    const x = center + radius * a.val * Math.cos(angle);
    const y = center + radius * a.val * Math.sin(angle);
    return `${x},${y}`;
  }).join(' ');

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="flex flex-col lg:flex-row items-center gap-12 w-full">
      <div className="relative">
        <svg width={size} height={size} className="overflow-visible">
          {/* Grids */}
          {gridLevels.map(level => (
            <circle
              key={level}
              cx={center}
              cy={center}
              r={radius * level}
              fill="none"
              stroke={theme === 'dark' ? '#334155' : '#cbd5e1'}
              strokeDasharray="2,2"
            />
          ))}
          {/* Axes */}
          {axes.map((a, i) => {
            const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
            const x2 = center + radius * Math.cos(angle);
            const y2 = center + radius * Math.sin(angle);
            return (
              <g key={i}>
                <line x1={center} y1={center} x2={x2} y2={y2} stroke={theme === 'dark' ? '#334155' : '#cbd5e1'} />
                <text
                  x={center + (radius + 25) * Math.cos(angle)}
                  y={center + (radius + 20) * Math.sin(angle)}
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="bold"
                  className={theme === 'dark' ? 'fill-neutral-500' : 'fill-neutral-600'}
                >
                  {a.label}
                </text>
              </g>
            );
          })}
          {/* Data Shape */}
          <polygon
            points={points}
            fill="rgba(59, 130, 246, 0.3)"
            stroke="#3b82f6"
            strokeWidth="2"
          />
        </svg>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-3">
        {axes.map((a, i) => (
          <div 
            key={i}
            className={`flex flex-col p-3 rounded-xl border transition-all hover:scale-105 ${theme === 'dark' ? 'bg-[#1c1c1c] border-neutral-800' : 'bg-white border-neutral-100 shadow-sm'}`}
          >
            <span className="text-[9px] font-bold uppercase text-neutral-400 tracking-widest mb-1">{a.label}</span>
            <div className="flex items-center justify-between">
              <span className={`text-lg font-black ${a.color}`}>{a.val.toFixed(3)}</span>
              <div className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${a.bg} ${a.color}`}>SCORE</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ScoreBar = ({ value, color, width = 60, theme }: { value: number, color: string, width?: number, theme: Theme }) => (
  <div className="flex items-center gap-2 justify-center">
    <div className={`h-1.5 rounded-full overflow-hidden ${theme === 'dark' ? 'bg-neutral-800' : 'bg-neutral-100'}`} style={{ width: `${width}px` }}>
      <div 
        className={`h-full ${color}`} 
        style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }} 
      />
    </div>
    <span className={`text-[10px] font-mono font-bold ${theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'}`}>
      {value.toFixed(3)}
    </span>
  </div>
);

const PipelineProgress = ({ phase }: { phase: number }) => {
  const steps = [1, 2, 3, 4];
  return (
    <div className="flex items-center gap-1 w-full max-w-[120px]">
      {steps.map(s => (
        <div 
          key={s} 
          className={`h-1.5 flex-1 rounded-full transition-all ${s <= phase ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'bg-neutral-200 dark:bg-neutral-800'}`}
          title={`Phase ${s}`}
        />
      ))}
    </div>
  );
};

const PublicationSparkline = ({ recent, total, theme }: { recent: number, total: number, theme: Theme }) => {
  // Mock sparkline based on recent vs total
  const width = 140;
  const height = 30;
  const points = [5, 12, 8, 15, 10, 22, 14, recent > 0 ? 25 : 12];
  const step = width / (points.length - 1);
  const path = points.map((p, i) => `${i * step},${height - p}`).join(' L ');

  return (
    <div className="relative">
      <svg width={width} height={height} className="overflow-visible">
        <path
          d={`M 0,${height} L ${path} L ${width},${height} Z`}
          fill="url(#sparkline-grad)"
          opacity="0.2"
        />
        <path
          d={`M 0,${height - points[0]} L ${path}`}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <defs>
          <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

// --- Force Directed Layout Utilities ---

function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    sumA += x; sumB += y;
    sumAA += x * x; sumBB += y * y; sumAB += x * y;
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumAA - sumA * sumA) * (n * sumBB - sumB * sumB));
  if (!isFinite(den) || den === 0) return 0;
  return num / den;
}

function getGetVector(t: Target) {
  return [t.geneticScore ?? 0, t.combinedExpression ?? 0, t.targetScore ?? 0];
}

function computeForcePositions(targets: Target[], width = 800, height = 600) {
  const nodes = targets.map((t, i) => ({ 
    id: t.id, 
    symbol: t.symbol, 
    r: 6 + (t.overallScore * 6),
    x: width / 2 + Math.cos(i) * 50,
    y: height / 2 + Math.sin(i) * 50
  }));
  const vectors = targets.map(getGetVector);
  const links: any[] = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const r = pearson(vectors[i], vectors[j]);
      links.push({ source: targets[i].id, target: targets[j].id, weight: Math.abs(r), sign: r });
    }
  }
  const sim = (d3 as any).forceSimulation(nodes as any)
    .force("link", (d3 as any).forceLink(links).id((d: any) => d.id)
      .strength((l: any) => 0.05 + 0.45 * (l.weight ?? 0))
      .distance((l: any) => 300 * (1 - (l.weight ?? 0)) + 40))
    .force("charge", (d3 as any).forceManyBody().strength(-150))
    .force("collide", (d3 as any).forceCollide((d: any) => d.r + 10))
    .force("center", (d3 as any).forceCenter(width / 2, height / 2));
  for (let i = 0; i < 300; i++) sim.tick();
  sim.stop();
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const padding = 0.05, rangeX = (maxX - minX) || 1, rangeY = (maxY - minY) || 1;
  const posMap = new Map<string, { x: number, y: number, nx: number, ny: number }>();
  nodes.forEach((n: any) => {
    const nx = padding + (1 - 2 * padding) * (n.x - minX) / rangeX;
    const ny = padding + (1 - 2 * padding) * (n.y - minY) / rangeY;
    posMap.set(n.id, { x: nx * width, y: ny * height, nx, ny });
  });
  return { positionsById: posMap, links };
}

const isPointInCircle = (px: number, py: number, cx: number, cy: number, r: number) => {
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) < r;
};

const getSigmaForZoom = (scale: number) => 35 / scale;

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

const DrugLandscape = ({ 
  targetId, 
  symbol, 
  theme, 
  currentStatus, 
  onToggle,
  onSave
}: { 
  targetId: string, 
  symbol: string, 
  theme: Theme, 
  currentStatus?: 'useful' | 'not-useful' | 'pinned', 
  onToggle: (symbol: string, source: string, status: 'useful' | 'not-useful' | 'pinned') => void,
  onSave?: () => void
}) => {
  const [drugs, setDrugs] = useState<DrugInfo[]>([]); const [loading, setLoading] = useState(false);
  useEffect(() => { let active = true; const fetch = async () => { setLoading(true); const res = await api.getTargetDrugs(targetId); if (active) { setDrugs(res); setLoading(false); } }; fetch(); return () => { active = false; }; }, [targetId]);
  if (loading) return <div className="flex items-center gap-3 py-4"><Loader2 className="w-4 h-4 animate-spin text-blue-500" /><span className="text-[11px] font-medium text-neutral-500">Mapping clinical pipeline...</span></div>;
  if (drugs.length === 0) return null;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pill className="w-4 h-4 text-neutral-500" />
          <h4 className="text-[11px] font-bold uppercase text-neutral-600 dark:text-neutral-500">Pipeline Evidence</h4>
        </div>
        <UsefulnessControls 
          symbol={symbol} 
          source="clinical" 
          currentStatus={currentStatus} 
          onToggle={onToggle} 
          onSave={onSave}
          theme={theme} 
        />
      </div>
      <div className="space-y-3">
        {drugs.slice(0, 4).map(d => (
          <div key={d.id} className={`p-4 rounded-lg border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-neutral-50 border-neutral-200 shadow-sm'}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold text-blue-600 dark:text-blue-500 uppercase">{d.name}</span>
              <span className="text-[9px] font-bold text-neutral-500 dark:text-neutral-400 uppercase">PHASE {d.phase}</span>
            </div>
            <PipelineProgress phase={d.phase} />
            <p className={`text-[11px] leading-relaxed italic mt-3 ${theme === 'dark' ? 'text-neutral-400' : 'text-slate-950'}`}>{d.mechanism}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const LiteratureStats = ({ 
  symbol, 
  diseaseName, 
  theme, 
  currentStatus, 
  onToggle,
  onSave
}: { 
  symbol: string, 
  diseaseName: string, 
  theme: Theme, 
  currentStatus?: 'useful' | 'not-useful' | 'pinned', 
  onToggle: (symbol: string, source: string, status: 'useful' | 'not-useful' | 'pinned') => void,
  onSave?: () => void
}) => {
  const [stats, setStats] = useState<PubMedStats | null>(null); const [loading, setLoading] = useState(false);
  useEffect(() => { let active = true; const fetch = async () => { setLoading(true); const res = await api.getPubMedStats(symbol, diseaseName); if (active) { setStats(res); setLoading(false); } }; fetch(); return () => { active = false; }; }, [symbol, diseaseName]);
  if (loading) return <div className="flex items-center gap-3 py-6"><Loader2 className="w-4 h-4 animate-spin text-blue-500" /><span className="text-[11px] font-medium text-neutral-500">Retrieving PubMed analytics...</span></div>;
  if (!stats) return null;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-neutral-500" />
          <h4 className="text-[11px] font-bold uppercase text-neutral-600 dark:text-neutral-500">Clinical Publications</h4>
        </div>
        <UsefulnessControls 
          symbol={symbol} 
          source="literature" 
          currentStatus={currentStatus} 
          onToggle={onToggle} 
          onSave={onSave}
          theme={theme} 
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={`p-4 rounded-lg border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-neutral-50 border-neutral-200 shadow-sm'}`}>
          <div className="text-[9px] font-bold text-neutral-500 dark:text-neutral-400 uppercase mb-1">Literature Count</div>
          <div className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{stats.total.toLocaleString()}</div>
        </div>
        <a href={stats.primarySearchLink} target="_blank" rel="noopener noreferrer" className={`p-4 rounded-lg border block hover:bg-blue-100/50 transition-colors ${theme === 'dark' ? 'bg-blue-900/5 border-blue-500/20' : 'bg-blue-50 border-blue-100 shadow-sm'}`}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[9px] font-bold text-blue-600 dark:text-blue-500 uppercase">Recent (2024-25)</div>
            <ExternalLink className="w-2.5 h-2.5 text-blue-400" />
          </div>
          <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{stats.recent.toLocaleString()}</div>
        </a>
      </div>
      <div className={`p-4 rounded-lg border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-neutral-50 border-neutral-200 shadow-sm'}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-bold uppercase text-neutral-500 dark:text-neutral-400">Velocity (2y)</span>
          <Activity className="w-3 h-3 text-blue-500" />
        </div>
        <PublicationSparkline recent={stats.recent} total={stats.total} theme={theme} />
      </div>
      <div className="space-y-3">
        {stats.topPapers.map(p => (
          <a key={p.id} href={`https://pubmed.ncbi.nlm.nih.gov/${p.id}/`} target="_blank" rel="noopener noreferrer" className={`block p-4 rounded-lg border transition-all hover:bg-neutral-100 dark:hover:bg-neutral-800/50 ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
            <p className={`text-[11px] font-medium leading-relaxed mb-2 line-clamp-2 ${theme === 'dark' ? 'text-neutral-300' : 'text-neutral-800'}`}>{p.title}</p>
            <div className="text-[9px] font-mono text-neutral-500 uppercase tracking-wider">PMID {p.id}</div>
          </a>
        ))}
      </div>
    </div>
  );
};

const UsefulnessControls = ({ 
  symbol, 
  source, 
  currentStatus, 
  onToggle, 
  onSave,
  theme 
}: { 
  symbol: string; 
  source: string; 
  currentStatus?: 'useful' | 'not-useful' | 'pinned'; 
  onToggle: (symbol: string, source: string, status: 'useful' | 'not-useful' | 'pinned') => void;
  onSave?: () => void;
  theme: Theme;
}) => {
  const isPinned = currentStatus === 'pinned';
  
  return (
    <div className="flex items-center gap-1 mt-2">
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(symbol, source, 'pinned'); }}
        className={`p-1.5 rounded-md transition-all group ${
          isPinned 
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' 
            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'
        }`}
        title="Pin to Top"
      >
        <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : 'group-hover:text-blue-500'}`} />
      </button>
      <button
        onClick={(e) => { 
          e.stopPropagation(); 
          if (onSave) {
            onSave();
          } else if (!isPinned) {
            onToggle(symbol, source, 'not-useful'); 
          }
        }}
        disabled={isPinned}
        className={`p-1.5 rounded-md transition-all group relative ${
          currentStatus === 'not-useful' 
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 ring-2 ring-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.5)]' 
            : isPinned ? 'opacity-20 cursor-not-allowed text-neutral-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'
        }`}
        title={isPinned ? "Cannot save pinned information" : "Save to Report"}
      >
        <Save className={`w-3.5 h-3.5 ${currentStatus === 'not-useful' ? 'fill-current' : 'group-hover:text-emerald-500'}`} />
      </button>
    </div>
  );
};

// =============================================================================
// Navigation Components
// =============================================================================

const TabNavigation = ({ 
  viewMode, 
  onViewModeChange, 
  theme 
}: { 
  viewMode: ViewMode; 
  onViewModeChange: (mode: ViewMode) => void; 
  theme: Theme 
}) => (
  <nav className="hidden lg:flex flex-1 items-center justify-start gap-1 min-w-0 px-6">
    {[ 
      {id:'list',i:List,l:'Targets'}, 
      {id:'pubtator',i:BookOpen,l:'Literature'}, 
      {id:'paper',i:FileText,l:'Papers'},
      {id:'enrichment',i:BarChart3,l:'Enrichment'}, 
      {id:'raw',i:Database,l:'Cohorts'} 
    ].map(t => {
      const active = viewMode === t.id;
      return (
        <button 
          key={t.id}
          onClick={() => onViewModeChange(t.id as ViewMode)} 
          className={`h-9 px-3 xl:px-4 rounded-md text-[11px] font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${active ? (theme === 'dark' ? 'bg-slate-800 text-white' : 'bg-slate-950 text-white') : (theme === 'dark' ? 'text-slate-300 hover:text-white hover:bg-slate-800' : 'text-slate-900 hover:text-slate-950 hover:bg-slate-100')}`}
        >
          <t.i className={`w-3.5 h-3.5 ${active ? 'text-white' : (theme === 'dark' ? 'text-slate-400' : 'text-slate-700')}`} />
          {t.l}
        </button>
      );
    })}
  </nav>
);

// =============================================================================
// Cohort Filter Sidebar
// =============================================================================

const COHORT_FILTER_GROUPS = [
  { key: 'age',     label: 'Age Group',       options: ['50–60', '60–70', '70–80', '80+']               },
  { key: 'stage',   label: 'Disease Stage',   options: ['Early Stage', 'MCI', 'Moderate', 'Late Stage'] },
  { key: 'subtype', label: 'Genetic Subtype', options: ['APOE4+', 'APOE4−', 'TREM2 Variant', 'Sporadic']},
  { key: 'gender',  label: 'Gender',          options: ['Male', 'Female', 'Other']                       },
] as const;

type CohortFilterKey = typeof COHORT_FILTER_GROUPS[number]['key'];

const SCORE_SLIDERS = [
  { key: 'geneticScore',    label: 'G Score',      accent: '#3b82f6' },
  { key: 'expressionScore', label: 'E Score',      accent: '#10b981' },
  { key: 'targetScore',     label: 'T Score',      accent: '#f59e0b' },
  { key: 'literatureScore', label: 'L Score',      accent: '#ec4899' },
  { key: 'getScore',        label: 'GET Score',    accent: '#8b5cf6' },
  { key: 'tauTissue',       label: 'TAU Tissue',   accent: '#f97316' },
  { key: 'tauSingleCell',   label: 'TAU Cell',     accent: '#ef4444' },
] as const;

const RANKING_SLIDERS = [
  { key: 'rwr',    label: 'RWR Score',    accent: '#8b5cf6' },
  { key: 'winner', label: 'WINNER Score', accent: '#06b6d4' },
] as const;

// All optional table columns — key must match Target field name
const TABLE_COLUMNS = [
  { key: 'geneticScore',       label: 'Genetic',     accent: '#3b82f6', defaultOn: true  },
  { key: 'combinedExpression', label: 'Expression',  accent: '#10b981', defaultOn: true  },
  { key: 'targetScore',        label: 'Target',      accent: '#f59e0b', defaultOn: true  },
  { key: 'literatureScore',    label: 'Literature',  accent: '#ec4899', defaultOn: false },
  { key: 'getScore',           label: 'GET Score',   accent: '#8b5cf6', defaultOn: true  },
  { key: 'tauTissue',          label: 'TAU Tissue',  accent: '#f97316', defaultOn: false },
  { key: 'tauSingleCell',      label: 'TAU Cell',    accent: '#ef4444', defaultOn: false },
  { key: 'finalScore',         label: 'Final Score', accent: '#2563eb', defaultOn: false },
] as const;
type TableColKey = typeof TABLE_COLUMNS[number]['key'];

// ── Bimodality tissue list (36 tissues from bimodality_final_wide.csv) ────────
const BIMODALITY_TISSUES = [
  'adipose_tissue','adrenal_gland','blood','bone_marrow','brain_neurons',
  'brain_non-neurons','breast','colon','endometrium','epididymis','esophagus',
  'eye','fallopian_tube','heart_muscle','kidney','liver','lung','lymph_node',
  'ovary','pancreas','pituitary_gland','placenta','prostate','rectum','retina',
  'salivary_gland','skeletal_muscle','skin','small_intestine','spleen','stomach',
  'testis','thymus','tongue','urinary_bladder','vasculature',
] as const;
type BioTissue = typeof BIMODALITY_TISSUES[number];
const bioTissueLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const LEFT_NAV_ITEMS = [
  { id: 'workspace', icon: Home,       label: 'Workspace' },
  { id: 'targets',   icon: List,       label: 'Targets'   },
  { id: 'cohort',    icon: Users,      label: 'Cohort'    },
  { id: 'rankings',  icon: BarChart3,  label: 'Rankings'  },
  { id: 'assess',    icon: Microscope, label: 'Assess'    },
] as const;

// ── Dual-handle range slider ─────────────────────────────────────────────────
// Uses pointer events on a track div so both thumbs are always independently
// draggable — stacked <input type=range> elements cannot achieve this reliably.
const DualSlider = ({
  label, values, onChange, accent, isDark,
}: {
  label: string;
  values: [number, number];
  onChange: (v: [number, number]) => void;
  accent: string;
  isDark: boolean;
}) => {
  const [min, max] = values;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'min' | 'max' | null>(null);

  const THUMB_R = 7; // px — half of w-3.5 (14px)
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  // Account for thumb radius so v=0 aligns with rail left, v=1 aligns with rail right
  const valueAt = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left - THUMB_R) / (rect.width - THUMB_R * 2));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = valueAt(e.clientX);
    // Pick whichever thumb is closer; break ties toward min so it can move right
    dragging.current = Math.abs(v - min) <= Math.abs(v - max) ? 'min' : 'max';
    // Immediately snap the chosen thumb to the click position
    if (dragging.current === 'min') {
      onChange([clamp(Math.min(v, max - 0.01)), max]);
    } else {
      onChange([min, clamp(Math.max(v, min + 0.01))]);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const v = valueAt(e.clientX);
    if (dragging.current === 'min') {
      onChange([clamp(Math.min(v, max - 0.01)), max]);
    } else {
      onChange([min, clamp(Math.max(v, min + 0.01))]);
    }
  };

  const onPointerUp = () => { dragging.current = null; };

  // Thumb left edge: v*(W-14) so thumb CENTER sits at v*(W-14)+7 = v*(W-14)+THUMB_R
  const thumbLeft = (v: number) => `calc(${(v * 100).toFixed(2)}% - ${(v * THUMB_R * 2).toFixed(2)}px)`;
  // Fill: from center of min thumb to center of max thumb
  const fillLeft = `calc(${(min * 100).toFixed(2)}% - ${(min * THUMB_R * 2).toFixed(2)}px + ${THUMB_R}px)`;
  const fillWidth = `calc(${((max - min) * 100).toFixed(2)}% - ${((max - min) * THUMB_R * 2).toFixed(2)}px)`;
  // Rail: inset by THUMB_R on each side so endpoints align with thumb centers
  const THUMB = `w-3.5 h-3.5 rounded-full border-2 border-white shadow-md absolute top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{label}</span>
        <span className={`text-[9px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
          {min.toFixed(2)} – {max.toFixed(2)}
        </span>
      </div>
      {/* Draggable track */}
      <div
        ref={trackRef}
        className={`relative h-4 flex items-center select-none cursor-pointer`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* Background rail — inset by THUMB_R so endpoints align with thumb centers */}
        <div
          className={`absolute h-1.5 rounded-full top-1/2 -translate-y-1/2 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}
          style={{ left: THUMB_R, right: THUMB_R }}
        />
        {/* Filled range between thumb centers */}
        <div
          className="absolute h-1.5 rounded-full opacity-80 top-1/2 -translate-y-1/2"
          style={{ background: accent, left: fillLeft, width: fillWidth }}
        />
        {/* Min thumb */}
        <div
          className={THUMB}
          style={{ background: accent, left: thumbLeft(min) }}
        />
        {/* Max thumb */}
        <div
          className={THUMB}
          style={{ background: accent, left: thumbLeft(max) }}
        />
      </div>
    </div>
  );
};

// ── Profile dropdown (top-right avatar menu) ─────────────────────────────────

type AdminUser = {
  id: string; email: string; name: string | null; institution: string | null;
  role: 'admin' | 'user'; created_at: string; last_sign_in: string | null; confirmed: boolean;
};

const ProfileDropdown = ({
  currentUser, theme, onSignOut, globalWeights,
}: {
  currentUser: UserSession;
  theme: Theme;
  onSignOut: () => void;
  globalWeights: { genetic: number; expression: number; target: number };
}) => {
  const isDark  = theme === 'dark';
  const isAdmin = currentUser.role === 'admin';
  const initials = (currentUser.username || '?').slice(0, 2).toUpperCase();

  // mini-menu open / which full-page is open
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [page, setPage]         = React.useState<null | 'settings' | 'docs'>(null);
  const menuRef    = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = React.useState<{ top: number; right: number }>({ top: 0, right: 0 });

  // compute portal position when opening
  const openMenu = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setMenuOpen(true);
  };

  // close mini-menu on outside click or scroll
  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const portal = document.getElementById('profile-menu-portal');
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        portal && !portal.contains(e.target as Node)
      ) setMenuOpen(false);
    };
    const closeOnScroll = () => setMenuOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', closeOnScroll, true); };
  }, [menuOpen]);

  const openPage = (p: 'settings' | 'docs') => { setMenuOpen(false); setPage(p); };
  const closePage = () => setPage(null);

  // ── Profile state (used inside Settings page) ─────────────────────────────
  const [profile, setProfile] = React.useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('dtt_profile') || '{}'); } catch { return {}; }
  });
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [profileSaved,  setProfileSaved]  = React.useState(false);
  const handleProfileChange = (field: string, value: string) => {
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    localStorage.setItem('dtt_profile', JSON.stringify(updated));
  };
  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await updateUserProfile(user.id, { name: profile.name || null, institution: profile.institution || null });
      setProfileSaved(true); setTimeout(() => setProfileSaved(false), 2500);
    } catch { /* non-critical */ } finally { setProfileSaving(false); }
  };

  // ── Admin user management state (used inside Settings page) ───────────────
  const [adminUsers,        setAdminUsers]        = React.useState<AdminUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = React.useState(false);
  const [adminUsersError,   setAdminUsersError]   = React.useState<string | null>(null);
  const [roleUpdating,      setRoleUpdating]      = React.useState<string | null>(null);
  const [deleteConfirm,     setDeleteConfirm]     = React.useState<string | null>(null);
  const [deleting,          setDeleting]          = React.useState<string | null>(null);

  const fetchAdminUsers = React.useCallback(async () => {
    setAdminUsersLoading(true); setAdminUsersError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');
      const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setAdminUsers(await res.json());
    } catch (e: any) { setAdminUsersError(e.message); }
    finally { setAdminUsersLoading(false); }
  }, []);

  const handleRoleToggle = async (userId: string, cur: 'admin' | 'user') => {
    const next = cur === 'admin' ? 'user' : 'admin';
    setRoleUpdating(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ role: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, role: next as 'admin' | 'user' } : u));
    } catch (e: any) { setAdminUsersError(e.message); }
    finally { setRoleUpdating(null); }
  };

  const handleDeleteUser = async (userId: string) => {
    setDeleting(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (!res.ok) throw new Error((await res.json()).error);
      setAdminUsers(prev => prev.filter(u => u.id !== userId));
      setDeleteConfirm(null);
    } catch (e: any) { setAdminUsersError(e.message); }
    finally { setDeleting(null); }
  };

  // ── Docs content ──────────────────────────────────────────────────────────
  const [openDocs, setOpenDocs] = React.useState<string[]>([]);
  const DOC_ITEMS = [
    { key: 'about',   title: 'About DiseaseToTarget',      icon: '🔬',
      content: `DiseaseToTarget (DTT) is an AI-powered therapeutic target discovery platform. It retrieves disease-associated genes from Open Targets, scores them using a multi-factor GET formula, and ranks them by druggability evidence.` },
    { key: 'get',     title: 'How GET Score Works',         icon: '⚖️',
      content: `GET = G × ${globalWeights.genetic} + E × ${globalWeights.expression} + T × ${globalWeights.target}\n\n• **G** — Genetic score (Open Targets association evidence)\n• **E** — Expression score (tissue expression selectivity)\n• **T** — Target score (tractability + clinical trial signal)\n\nA velocity bonus (×0.15) rewards fast-rising literature genes.` },
    { key: 'csv',     title: 'Cohort CSV Format',           icon: '📋',
      content: `Upload a CSV with columns: gene_symbol, then one column per cohort (TPM/FPKM values).\n\nExample:\ngene_symbol,early_stage,late_stage\nAPOE,12.4,8.2\nTREM2,3.2,9.8\n\nUpload via terminal chat: type "upload cohort CSV"` },
    { key: 'scores',  title: 'Score Reference',             icon: '📊',
      content: `G Score (0–1): genetic association strength\nE Score (0–1): expression selectivity\nT Score (0–1): target tractability\nGET (0–1): combined priority\nRWR (0–1): network propagation rank\nWINNER (0–1): network-based prioritization\nLiterature (0–1): publication evidence` },
    { key: 'sources', title: 'Data Sources',                icon: '🗄️',
      content: `• Open Targets — Gene-disease associations, expression, tractability\n• PubTator / PubMed — Literature mining\n• STRING DB — Protein interaction networks\n• ClinicalTrials.gov — Trial signal scoring\n• Enrichr — Pathway enrichment` },
  ];

  // ── Full-page overlay shared header ──────────────────────────────────────
  const PageHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div className={`sticky top-0 z-10 flex items-center gap-3 px-6 py-4 border-b ${isDark ? 'bg-[#0b111c] border-slate-800' : 'bg-white border-slate-200'}`}>
      <button onClick={closePage}
        className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div>
        <p className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{subtitle}</p>
        <p className={`text-[15px] font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{title}</p>
      </div>
    </div>
  );

  const menuPortal = menuOpen ? createPortal(
    <div
      id="profile-menu-portal"
      style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 99999 }}
      className={`w-52 rounded-xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#0d1424] border-slate-700' : 'bg-white border-slate-200'}`}
    >
      {/* Identity row */}
      <div className={`px-3 py-2.5 border-b flex items-center gap-2 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-100 bg-slate-50'}`}>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${isAdmin ? 'bg-rose-500/15 text-rose-500' : 'bg-blue-500/10 text-blue-600'}`}>{initials}</div>
        <div className="min-w-0">
          <p className={`text-[11px] font-bold truncate ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{profile.name || currentUser.username}</p>
          <p className={`text-[9px] truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{currentUser.username}</p>
        </div>
      </div>
      {/* Menu items */}
      {[
        { label: isAdmin ? 'Settings & Users' : 'Settings', icon: Settings, page: 'settings' as const },
        { label: 'Documentation', icon: BookOpen, page: 'docs' as const },
      ].map(item => (
        <button key={item.page} onClick={() => openPage(item.page)}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-semibold transition-colors ${isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-50 text-slate-700'}`}>
          <item.icon className="w-3.5 h-3.5 shrink-0 opacity-60" />
          {item.label}
          <ChevronRight className="w-3 h-3 ml-auto opacity-40" />
        </button>
      ))}
      <div className={`border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <button onClick={() => { setMenuOpen(false); onSignOut(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-semibold transition-colors text-rose-500 ${isDark ? 'hover:bg-rose-500/10' : 'hover:bg-rose-50'}`}>
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          Sign Out
        </button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      {/* ── Trigger button ── */}
      <div ref={menuRef} className="relative">
        <button
          ref={triggerRef}
          onClick={() => menuOpen ? setMenuOpen(false) : openMenu()}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-all ${
            menuOpen
              ? isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-300'
              : isDark ? 'bg-slate-900/60 border-slate-800 hover:bg-slate-800' : 'bg-white border-slate-200 hover:bg-slate-50'
          }`}
        >
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-black shrink-0 ${isAdmin ? 'bg-rose-500/15 text-rose-500' : 'bg-blue-500/10 text-blue-600'}`}>
            {initials}
          </div>
          <span className={`hidden sm:block text-[11px] font-semibold max-w-[120px] truncate ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
            {profile.name || currentUser.username}
          </span>
          <span className={`hidden sm:block text-[8px] font-black px-1.5 py-0.5 rounded-full ${isAdmin ? 'bg-rose-500/10 text-rose-500' : 'bg-blue-500/10 text-blue-600'}`}>
            {isAdmin ? 'Admin' : 'Researcher'}
          </span>
          <ChevronDown className={`w-3 h-3 transition-transform shrink-0 ${menuOpen ? 'rotate-180' : ''} ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
        </button>
      </div>

      {/* ── Portal menu (escapes header stacking context) ── */}
      {menuPortal}

      {/* ── Settings full-page overlay (portaled to body) ── */}
      {page === 'settings' && createPortal(
        <div className={`fixed inset-0 flex flex-col ${isDark ? 'bg-[#080e18]' : 'bg-slate-50'}`} style={{ zIndex: 99998 }}>
          <PageHeader title="Settings" subtitle={isAdmin ? 'Profile · Users · Admin' : 'Profile'} />
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">

              {/* My Account */}
              <section>
                <h2 className={`text-[11px] font-black uppercase tracking-widest mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>My Account</h2>
                <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800 bg-[#0d1424]' : 'border-slate-200 bg-white'}`}>
                  {/* Identity */}
                  <div className={`px-5 py-4 flex items-center gap-4 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-[16px] font-black ${isAdmin ? 'bg-rose-500/15 text-rose-500' : 'bg-blue-500/10 text-blue-600'}`}>{initials}</div>
                    <div>
                      <p className={`text-[13px] font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{profile.name || 'No display name'}</p>
                      <p className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{currentUser.username}</p>
                      <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${isAdmin ? 'bg-rose-500/10 border-rose-500/30 text-rose-500' : 'bg-blue-500/10 border-blue-500/20 text-blue-600'}`}>
                        <ShieldCheck className="w-2.5 h-2.5" />{isAdmin ? 'Admin' : 'Researcher'}
                      </span>
                    </div>
                  </div>
                  {/* Edit fields */}
                  <div className="px-5 py-4 space-y-4">
                    {[{ field: 'name', label: 'Display Name', ph: 'Full name' }, { field: 'institution', label: 'Institution', ph: 'e.g. UAB SPARC' }].map(f => (
                      <div key={f.field}>
                        <label className={`text-[10px] font-bold uppercase tracking-wider block mb-1.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{f.label}</label>
                        <input value={profile[f.field] || ''} onChange={e => handleProfileChange(f.field, e.target.value)} placeholder={f.ph}
                          className={`w-full px-3 py-2 rounded-xl border text-[13px] outline-none transition-colors ${isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-600 focus:border-blue-500' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white'}`} />
                      </div>
                    ))}
                    <button onClick={handleSaveProfile} disabled={profileSaving}
                      className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[12px] font-black uppercase tracking-wider transition-all ${profileSaved ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600' : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40'}`}>
                      {profileSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : profileSaved ? <><CheckCircle2 className="w-3.5 h-3.5" />Saved</> : <><Save className="w-3.5 h-3.5" />Save Profile</>}
                    </button>
                  </div>
                </div>
              </section>

              {/* User Management — admin only */}
              {isAdmin && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-[11px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      User Management {adminUsers.length > 0 && <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>{adminUsers.length} users</span>}
                    </h2>
                    <button onClick={fetchAdminUsers} disabled={adminUsersLoading}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${isDark ? 'bg-rose-600/15 text-rose-400 hover:bg-rose-600/25 border border-rose-500/20' : 'bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200'} disabled:opacity-40`}>
                      {adminUsersLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      {adminUsers.length === 0 ? 'Load Users' : 'Refresh'}
                    </button>
                  </div>

                  {adminUsersError && (
                    <div className={`flex items-center gap-2 p-3 rounded-xl mb-3 text-rose-500 text-[12px] ${isDark ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-rose-50 border border-rose-200'}`}>
                      <AlertCircle className="w-4 h-4 shrink-0" />{adminUsersError}
                    </div>
                  )}

                  {!adminUsersLoading && adminUsers.length === 0 && !adminUsersError && (
                    <div className={`rounded-2xl border px-6 py-10 text-center ${isDark ? 'border-slate-800 bg-[#0d1424]' : 'border-slate-200 bg-white'}`}>
                      <Users className={`w-8 h-8 mx-auto mb-2 ${isDark ? 'text-slate-700' : 'text-slate-300'}`} />
                      <p className={`text-[13px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Click <strong>Load Users</strong> to see all registered accounts</p>
                    </div>
                  )}

                  {adminUsers.length > 0 && (
                    <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                      {adminUsers.map((u, idx) => (
                        <div key={u.id} className={`px-5 py-3.5 flex items-center gap-3 ${idx > 0 ? `border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}` : ''} ${isDark ? 'bg-[#0d1424]' : 'bg-white'}`}>
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black shrink-0 ${u.role === 'admin' ? 'bg-rose-500/15 text-rose-500' : 'bg-blue-500/10 text-blue-600'}`}>
                            {(u.name || u.email).slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`text-[12px] font-bold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{u.name || <span className="opacity-40">No name</span>}</p>
                              {!u.confirmed && <span className={`text-[8px] font-black px-1 py-0.5 rounded ${isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>⏳ unconfirmed</span>}
                            </div>
                            <p className={`text-[11px] truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{u.email}</p>
                            {u.institution && <p className={`text-[10px] truncate ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{u.institution}</p>}
                            <p className={`text-[9px] mt-0.5 ${isDark ? 'text-slate-700' : 'text-slate-300'}`}>Joined {new Date(u.created_at).toLocaleDateString()}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <button onClick={() => handleRoleToggle(u.id, u.role)} disabled={roleUpdating === u.id} title="Click to toggle role"
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black border transition-all disabled:opacity-40 ${u.role === 'admin' ? isDark ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20' : 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100' : isDark ? 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20' : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100'}`}>
                              {roleUpdating === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                              {u.role === 'admin' ? 'Admin' : 'Researcher'}
                            </button>
                            {deleteConfirm === u.id ? (
                              <div className="flex gap-1.5">
                                <button onClick={() => handleDeleteUser(u.id)} disabled={deleting === u.id}
                                  className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">
                                  {deleting === u.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Confirm'}
                                </button>
                                <button onClick={() => setDeleteConfirm(null)}
                                  className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${isDark ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setDeleteConfirm(u.id)} title="Remove user"
                                className={`p-1 rounded-lg transition-colors ${isDark ? 'text-slate-700 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-300 hover:text-rose-500 hover:bg-rose-50'}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Documentation full-page overlay (portaled to body) ── */}
      {page === 'docs' && createPortal(
        <div className={`fixed inset-0 flex flex-col ${isDark ? 'bg-[#080e18]' : 'bg-slate-50'}`} style={{ zIndex: 99998 }}>
          <PageHeader title="Documentation" subtitle="DiseaseToTarget" />
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-6 py-8 space-y-3">
              {DOC_ITEMS.map(sec => {
                const isOpen = openDocs.includes(sec.key);
                return (
                  <div key={sec.key} className={`rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800 bg-[#0d1424]' : 'border-slate-200 bg-white'}`}>
                    <button onClick={() => setOpenDocs(p => isOpen ? p.filter(k => k !== sec.key) : [...p, sec.key])}
                      className={`w-full px-5 py-4 flex items-center justify-between text-left transition-colors ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{sec.icon}</span>
                        <span className={`text-[13px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{sec.title}</span>
                      </div>
                      <ChevronDown className={`w-4 h-4 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''} ${isDark ? 'text-slate-600' : 'text-slate-400'}`} />
                    </button>
                    {isOpen && (
                      <div className={`px-5 pb-5 pt-1 text-[12px] leading-relaxed border-t ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-600'}`}>
                        <Markdown>{sec.content}</Markdown>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// =============================================================================
// AssessmentView — per-gene evidence cards using ranked-list data + clinical/lit
// =============================================================================
const ASSESS_CHEMBL_COLORS: Record<string, string> = {
  'Clinically Validated':    '#16a34a',
  'In Clinical Development':  '#2563eb',
  'Preclinical Only':         '#9333ea',
  'No Drug Data Found':       '#6b7280',
};

const ScoreChip = ({ val, label, color, isDark }: { val: number; label: string; color: string; isDark: boolean }) => (
  <div className={`flex flex-col items-center px-2.5 py-2 rounded-xl border ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
    <span className={`text-[15px] font-black ${color}`}>{val.toFixed(2)}</span>
    <span className={`text-[8px] font-bold uppercase tracking-widest mt-0.5 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{label}</span>
    <div className={`mt-1 w-full h-1 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
      <div className={`h-full rounded-full ${color.replace('text-','bg-')}`} style={{ width: `${Math.min(1, val) * 100}%` }} />
    </div>
  </div>
);

const PhaseBar = ({ phase, isDark }: { phase: string; isDark: boolean }) => {
  const order = ['EARLY_PHASE1','PHASE1','PHASE2','PHASE3','PHASE4'];
  const idx = order.indexOf(phase ?? '');
  const labels = ['Early Ph1','Phase 1','Phase 2','Phase 3','Phase 4'];
  return (
    <div className="flex items-center gap-1 mt-1">
      {order.map((p, i) => (
        <div key={p} className={`flex-1 h-2 rounded-full transition-all ${
          i <= idx ? (i >= 3 ? 'bg-emerald-500' : i >= 2 ? 'bg-blue-500' : 'bg-slate-400')
                   : isDark ? 'bg-slate-800' : 'bg-slate-200'
        }`} title={labels[i]} />
      ))}
    </div>
  );
};

async function buildAssessDocx(genes: GeneAssessmentData[], diseaseName: string, narrative: string) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, BorderStyle, ShadingType } = await import('docx');
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const mkCell = (text: string, bold = false, shaded = false, w = 2340) =>
    new TableCell({
      borders, width: { size: w, type: WidthType.DXA },
      shading: shaded ? { fill: 'F1F5F9', type: ShadingType.CLEAR } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })],
    });

  const children: any[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Target Assessment Report', bold: true, size: 36 })] }),
    new Paragraph({ children: [new TextRun({ text: `Disease: ${diseaseName}  |  Generated: ${new Date().toLocaleDateString()}`, size: 20, color: '6B7280' })] }),
    new Paragraph({ children: [] }),
  ];

  for (const g of genes) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `${g.symbol} — ${g.name}`, bold: true, size: 28 })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: g.foundInRankedList ? 'Source: Ranked target list' : 'Source: Custom gene (clinical + literature only)', size: 18, color: '6B7280' })] }));
    children.push(new Paragraph({ children: [] }));

    if (g.foundInRankedList) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Evidence Scores (GET Framework)', bold: true, size: 22 })] }));
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [2340, 2340, 2340, 2340],
        rows: [
          new TableRow({ children: [mkCell('GET Score', true, true), mkCell('Genetic (G)', true, true), mkCell('Expression (E)', true, true), mkCell('Target (T)', true, true)] }),
          new TableRow({ children: [mkCell(g.getScore.toFixed(3)), mkCell(g.geneticScore.toFixed(3)), mkCell(g.expressionScore.toFixed(3)), mkCell(g.targetScore.toFixed(3))] }),
        ],
      }));
      children.push(new Paragraph({ children: [] }));

      if (g.tauTissue > 0 || g.tauSingleCell > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: `Tissue Specificity — Tau (bulk): ${g.tauTissue.toFixed(3)}  |  Tau (single-cell): ${g.tauSingleCell.toFixed(3)}  |  Expression: ${g.combinedExpression.toFixed(3)}`, size: 20 })] }));
      }

      const topBimodal = Object.entries(g.bimodalityScores)
        .filter(([k]) => !k.startsWith('_'))
        .sort(([, a], [, b]) => b - a).slice(0, 5)
        .map(([tissue, score]) => `${tissue} (${score.toFixed(2)})`).join(', ');
      if (topBimodal) {
        children.push(new Paragraph({ children: [new TextRun({ text: `Top Bimodal Tissues: ${topBimodal}`, size: 20 })] }));
      }

      if (g.pathways.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: `Key Pathways: ${g.pathways.slice(0, 5).map(p => p.label).join(', ')}`, size: 20 })] }));
      }
      children.push(new Paragraph({ children: [] }));
    }

    const dd = g.drillDown;
    children.push(new Paragraph({ children: [new TextRun({ text: 'Clinical Trials (ClinicalTrials.gov)', bold: true, size: 22 })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `${dd.trial_count ?? 0} trials  |  Max Phase: ${dd.max_phase ?? 'N/A'}  |  Active: ${dd.active_trial_present ? 'Yes' : 'No'}`, size: 20 })] }));
    if (dd.top_drugs?.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Top drugs in trials: ${dd.top_drugs.slice(0, 5).map(d => d.name).join(', ')}`, size: 20 })] }));
    }
    children.push(new Paragraph({ children: [] }));

    children.push(new Paragraph({ children: [new TextRun({ text: 'Literature (PubMed + Europe PMC)', bold: true, size: 22 })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `PubMed: ${g.pubmed.total} total, ${g.pubmed.recent} last 3 years  |  Europe PMC: ${dd.paper_count ?? 0} (${dd.recent_paper_count ?? 0} recent)`, size: 20 })] }));
    if (g.pubTatorScore > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: `PubTator velocity score: ${g.pubTatorScore.toFixed(3)}  |  ${g.pubTatorTotalPapers} total papers, ${g.pubTatorRecentPapers} recent`, size: 20 })] }));
    }
    if (g.pubmed.topPapers.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Top papers:', bold: true, size: 20 })] }));
      g.pubmed.topPapers.slice(0, 3).forEach(p => {
        children.push(new Paragraph({ children: [new TextRun({ text: `• ${p.title} (PMID: ${p.id})`, size: 18 })] }));
      });
    }
    children.push(new Paragraph({ children: [] }));
  }

  if (narrative) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'AI Trade-off Analysis', bold: true, size: 28 })] }),
      new Paragraph({ children: [new TextRun({ text: narrative, size: 20 })] }),
    );
  }

  return new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }] });
}

const AssessmentView = ({ genes, data, loading, diseaseName, theme, onClose }: {
  genes: string[];
  data: GeneAssessmentData[];
  loading: Record<string, boolean>;
  diseaseName: string;
  theme: Theme;
  onClose: () => void;
}) => {
  const isDark = theme === 'dark';
  const [narrative, setNarrative] = React.useState('');
  const [narrativeLoading, setNarrativeLoading] = React.useState(false);
  const [dlLoading, setDlLoading] = React.useState(false);

  const ready = data.filter(d => !loading[d.symbol]);
  const allDone = genes.length > 0 && genes.every(g => !loading[g] && data.find(d => d.symbol === g));

  const runNarrative = async () => {
    if (ready.length === 0) return;
    setNarrativeLoading(true);
    try {
      const ctx = ready.map(g => {
        const topBio = Object.entries(g.bimodalityScores).filter(([k]) => !k.startsWith('_')).sort(([,a],[,b])=>b-a).slice(0,3).map(([t,s])=>`${t}(${s.toFixed(2)})`).join(', ');
        return `Gene: ${g.symbol} (${g.name})
Source: ${g.foundInRankedList ? 'Ranked target list' : 'Custom gene'}
${g.foundInRankedList ? `GET Score: ${g.getScore.toFixed(3)} | Genetic: ${g.geneticScore.toFixed(3)} | Expression: ${g.expressionScore.toFixed(3)} | Target: ${g.targetScore.toFixed(3)}
Literature Score: ${g.literatureScore.toFixed(3)} | PubTator velocity: ${g.pubTatorScore.toFixed(3)}
Tau (tissue): ${g.tauTissue.toFixed(3)} | Tau (single-cell): ${g.tauSingleCell.toFixed(3)}
Top bimodal tissues: ${topBio || '—'}
Pathways: ${g.pathways.slice(0,5).map(p=>p.label).join(', ')||'—'}` : ''}
Clinical Trials: ${g.drillDown.trial_count??0} total | Max phase: ${g.drillDown.max_phase??'N/A'} | Active: ${g.drillDown.active_trial_present?'yes':'no'}
Top trial drugs: ${g.drillDown.top_drugs?.slice(0,3).map(d=>d.name).join(', ')||'—'}
PubMed: ${g.pubmed.total} total, ${g.pubmed.recent} recent (3y) | Europe PMC: ${g.drillDown.paper_count??0}`.trim();
      }).join('\n\n---\n\n');

      const prompt = `You are a drug discovery scientist evaluating therapeutic target candidates for ${diseaseName}.

Evidence data for ${ready.length} gene(s):

${ctx}

Write a critical, evidence-based Target Assessment Report covering:
1. **Clinical Validation** — what does the trial landscape reveal? Early-stage, mature, or untapped?
2. **Literature Signal** — is research momentum growing or established? Any velocity insights?
${ready.some(g=>g.foundInRankedList) ? `3. **Genetic & Expression Evidence** — strength of disease association and tissue risk
4. **Tissue Specificity** — bimodality and tau scores; off-target concerns?` : ''}
${ready.length > 1 ? `5. **Comparative Trade-offs** — which target offers the better risk/benefit profile and why?
6. **Recommendation** — prioritize one for a new drug program with justification.` : ''}

Be specific, cite the numbers. Do not fabricate. ~400 words.`;

      const resp = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
      const data = await resp.json();
      setNarrative(data.text ?? '');
    } catch (e: any) {
      setNarrative(`Error: ${e.message}`);
    } finally { setNarrativeLoading(false); }
  };

  const downloadReport = async () => {
    if (data.length === 0) return;
    setDlLoading(true);
    try {
      const { Packer } = await import('docx');
      const doc = await buildAssessDocx(data, diseaseName, narrative);
      const buffer = await Packer.toBuffer(doc);
      await saveBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        `Assessment_${genes.join('_')}_${diseaseName.replace(/\s+/g,'_').slice(0,30)}.docx`);
    } catch (e: any) { logDev('DOCX export failed:', e); }
    finally { setDlLoading(false); }
  };

  return (
    <div className={`h-full flex flex-col rounded-2xl border overflow-hidden shadow-xl ${isDark ? 'bg-[#0b111c]/95 border-slate-800/80' : 'bg-white/95 border-slate-200'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 px-5 py-3.5 border-b flex-shrink-0 ${isDark ? 'bg-[#0b111c] border-slate-800' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-xl flex-shrink-0 ${isDark ? 'bg-blue-600/10' : 'bg-blue-50'}`}>
            <Microscope className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
          </div>
          <div className="min-w-0">
            <p className={`text-[9px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Target Assessment</p>
            <p className={`text-[13px] font-bold truncate ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{diseaseName || 'Evidence Report'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {allDone && (
            <>
              <button onClick={runNarrative} disabled={narrativeLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all ${isDark ? 'bg-purple-600/15 text-purple-400 hover:bg-purple-600/25 border border-purple-500/20' : 'bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200'} disabled:opacity-40`}>
                {narrativeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}AI Trade-off
              </button>
              <button onClick={downloadReport} disabled={dlLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all ${isDark ? 'bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200'} disabled:opacity-40`}>
                {dlLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}Download Report
              </button>
            </>
          )}
          <button onClick={onClose} className={`p-1.5 rounded-lg flex-shrink-0 transition-colors ${isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Gene Cards */}
        <div className={`grid gap-4 ${genes.length >= 3 ? 'grid-cols-3' : genes.length === 2 ? 'grid-cols-2' : 'grid-cols-1 max-w-xl mx-auto w-full'}`}>
          {genes.map(sym => {
            const g = data.find(d => d.symbol === sym);
            if (loading[sym] || !g) return (
              <div key={sym} className={`rounded-2xl border p-6 flex flex-col items-center justify-center gap-3 min-h-48 ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
                <Loader2 className={`w-6 h-6 animate-spin ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                <p className={`text-[11px] font-bold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Loading {sym}…</p>
                <p className={`text-[9px] ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>ClinicalTrials.gov · PubMed</p>
              </div>
            );

            // Top bimodal tissues from bimodalityScores
            const bioTissues = Object.entries(g.bimodalityScores)
              .filter(([k]) => !k.startsWith('_') && typeof g.bimodalityScores[k] === 'number')
              .sort(([,a],[,b]) => b - a).slice(0, 6);

            return (
              <div key={sym} className={`rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800 bg-[#0d1424]' : 'border-slate-200 bg-white'}`}>
                {/* Gene header */}
                <div className={`px-4 py-3 border-b ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={`text-[16px] font-black font-mono ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>{g.symbol}</h3>
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full border ${
                      g.foundInRankedList
                        ? isDark ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : isDark ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-600'
                    }`}>{g.foundInRankedList ? '✓ Ranked' : 'Custom'}</span>
                  </div>
                  <p className={`text-[11px] font-semibold mt-0.5 truncate ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{g.name}</p>
                </div>

                <div className="px-4 py-3 space-y-4">
                  {/* GET Scores — only for ranked genes */}
                  {g.foundInRankedList && (
                    <div>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>GET Evidence Scores</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <ScoreChip val={g.getScore} label="GET" color="text-purple-600" isDark={isDark} />
                        <ScoreChip val={g.geneticScore} label="Genetic" color="text-blue-600" isDark={isDark} />
                        <ScoreChip val={g.expressionScore} label="Expression" color="text-emerald-600" isDark={isDark} />
                        <ScoreChip val={g.targetScore} label="Target" color="text-amber-600" isDark={isDark} />
                      </div>
                      {g.pubTatorScore > 0 && (
                        <div className={`mt-1.5 flex items-center gap-3 px-3 py-1.5 rounded-xl ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                          <div>
                            <span className={`text-[9px] font-black ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>PubTator Velocity</span>
                            <p className={`text-[13px] font-black ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>{g.pubTatorScore.toFixed(3)}</p>
                          </div>
                          <div>
                            <span className={`text-[9px] font-black ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Papers</span>
                            <p className={`text-[13px] font-black ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{g.pubTatorTotalPapers}</p>
                          </div>
                          <div>
                            <span className={`text-[9px] font-black ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Recent 3y</span>
                            <p className={`text-[13px] font-black ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{g.pubTatorRecentPapers}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tissue Specificity — only for ranked genes */}
                  {g.foundInRankedList && (g.tauTissue > 0 || bioTissues.length > 0) && (
                    <div>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Tissue Specificity</p>
                      <div className="grid grid-cols-3 gap-1.5 mb-2">
                        {[
                          { label: 'Tau (bulk)', val: g.tauTissue },
                          { label: 'Tau (scRNA)', val: g.tauSingleCell },
                          { label: 'Expression', val: g.combinedExpression },
                        ].map(s => (
                          <div key={s.label} className={`rounded-xl border px-2 py-1.5 text-center ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
                            <p className={`text-[13px] font-black ${s.val > 0.6 ? 'text-emerald-500' : s.val > 0.3 ? 'text-amber-500' : isDark ? 'text-slate-400' : 'text-slate-500'}`}>{s.val.toFixed(2)}</p>
                            <p className={`text-[8px] font-bold ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{s.label}</p>
                          </div>
                        ))}
                      </div>
                      {bioTissues.length > 0 && (
                        <div className="space-y-1">
                          {bioTissues.map(([tissue, score]) => (
                            <div key={tissue} className="flex items-center gap-2">
                              <span className={`text-[9px] truncate w-24 flex-shrink-0 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tissue}</span>
                              <div className={`flex-1 h-1.5 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                                <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.min(100, score * 100)}%` }} />
                              </div>
                              <span className={`text-[8px] font-mono w-8 text-right flex-shrink-0 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{score.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clinical Trials */}
                  <div>
                    <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Clinical Trials</p>
                    <div className={`rounded-xl border p-3 space-y-2 ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                          {g.drillDown.trial_count ?? 0} trials
                          {g.drillDown.active_trial_present && <span className="ml-2 text-[9px] text-emerald-500 font-black">● Active</span>}
                        </span>
                        <span className={`text-[10px] font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                          Max: {(g.drillDown.max_phase ?? 'N/A').replace(/_/g,' ').replace('PHASE','Ph')}
                        </span>
                      </div>
                      <PhaseBar phase={g.drillDown.max_phase ?? ''} isDark={isDark} />
                      {g.drillDown.top_drugs && g.drillDown.top_drugs.length > 0 && (
                        <p className={`text-[9px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          Drugs in trials: {g.drillDown.top_drugs.slice(0,3).map(d=>d.name).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Literature */}
                  <div>
                    <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Literature</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { label: 'PubMed', value: g.pubmed.total, sub: `${g.pubmed.recent} last 3y` },
                        { label: 'Europe PMC', value: g.drillDown.paper_count ?? 0, sub: `${g.drillDown.recent_paper_count ?? 0} recent` },
                      ].map(s => (
                        <div key={s.label} className={`rounded-xl border px-3 py-2 ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
                          <p className={`text-[15px] font-black ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{s.value.toLocaleString()}</p>
                          <p className={`text-[9px] font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{s.label}</p>
                          <p className={`text-[8px] ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{s.sub}</p>
                        </div>
                      ))}
                    </div>
                    {g.pubmed.topPapers.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {g.pubmed.topPapers.slice(0,2).map(p => (
                          <a key={p.id} href={`https://pubmed.ncbi.nlm.nih.gov/${p.id}`} target="_blank" rel="noopener noreferrer"
                            className={`flex items-start gap-1.5 text-[9px] leading-relaxed hover:underline ${isDark ? 'text-blue-400/70' : 'text-blue-600/70'}`}>
                            <ExternalLink className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">{p.title}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Druggability — ChEMBL (always fetched) */}
                  {g.chembl && (
                    <div>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Druggability (ChEMBL)</p>
                      {g.chembl.error ? (
                        <p className={`text-[10px] italic ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{g.chembl.error}</p>
                      ) : (
                        <div className={`rounded-xl border p-3 space-y-2 ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black text-white" style={{ backgroundColor: ASSESS_CHEMBL_COLORS[g.chembl.label] || '#6b7280' }}>{g.chembl.label}</span>
                            <span className={`text-[10px] font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Score {g.chembl.druggabilityScore.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {([['AB','Antibody',g.chembl.modalities.antibody],['SM','Small Mol',g.chembl.modalities.smallMolecule],['PR','PROTAC',g.chembl.modalities.protac]] as const).map(([k,label,active]) => (
                              <span key={k} className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${active ? (isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-700') : (isDark ? 'bg-slate-800 text-slate-600' : 'bg-slate-100 text-slate-400')}`}>{active ? '✓' : '✗'} {label}</span>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <div>
                              <span className={`text-[8px] font-black uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Best IC50</span>
                              <p className={`text-[12px] font-black ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{g.chembl.bestCompound?.ic50Nm != null ? `${g.chembl.bestCompound.ic50Nm.toFixed(1)} nM` : '—'}</p>
                            </div>
                            <div>
                              <span className={`text-[8px] font-black uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Compounds</span>
                              <p className={`text-[12px] font-black ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{g.chembl.totalCompounds.toLocaleString()}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Pathways — ranked only */}
                  {g.foundInRankedList && g.pathways.length > 0 && (
                    <div>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Pathways</p>
                      <div className="flex flex-wrap gap-1">
                        {g.pathways.slice(0,6).map(p => (
                          <span key={p.id} className={`text-[8px] px-2 py-0.5 rounded-full border ${isDark ? 'border-slate-700 bg-slate-800 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{p.label}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* AI Narrative */}
        {(narrative || narrativeLoading) && (
          <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-purple-800/40 bg-purple-900/10' : 'border-purple-200 bg-purple-50/50'}`}>
            <div className={`px-5 py-3 border-b flex items-center gap-2 ${isDark ? 'border-purple-800/30' : 'border-purple-200'}`}>
              <Sparkles className={`w-4 h-4 ${isDark ? 'text-purple-400' : 'text-purple-600'}`} />
              <p className={`text-[11px] font-black uppercase tracking-widest ${isDark ? 'text-purple-400' : 'text-purple-700'}`}>AI Trade-off Analysis — {diseaseName}</p>
            </div>
            <div className="px-5 py-4">
              {narrativeLoading
                ? <div className="flex items-center gap-3"><Loader2 className="w-4 h-4 animate-spin text-purple-500" /><span className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Generating…</span></div>
                : <div className="prose prose-sm dark:prose-invert max-w-none"><Markdown>{narrative}</Markdown></div>
              }
            </div>
          </div>
        )}

        {!narrative && !narrativeLoading && allDone && (
          <div className={`rounded-2xl border px-6 py-8 text-center ${isDark ? 'border-slate-800 bg-slate-900/20' : 'border-slate-200 bg-slate-50'}`}>
            <Sparkles className={`w-8 h-8 mx-auto mb-3 ${isDark ? 'text-slate-700' : 'text-slate-300'}`} />
            <p className={`text-[13px] font-bold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Ready for AI Analysis</p>
            <p className={`text-[11px] mb-4 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>Click "AI Trade-off" for a critical comparison of these targets</p>
            <button onClick={runNarrative} className="px-5 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black uppercase tracking-wider hover:bg-purple-700 transition-colors flex items-center gap-2 mx-auto">
              <Sparkles className="w-3.5 h-3.5" />Generate AI Report
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// AssessPanelContent — proper sub-component so hooks are valid
// =============================================================================
const AssessPanelContent = ({ isDark, targets, onAssessRun }: {
  isDark: boolean;
  targets: Target[];
  onAssessRun?: (genes: string[]) => void;
}) => {
  const [assessChecked, setAssessChecked] = React.useState<string[]>([]);
  const [assessCustom, setAssessCustom]   = React.useState('');

  const toggleCheck = (sym: string) => {
    setAssessChecked(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : prev.length < 3 ? [...prev, sym] : prev
    );
  };

  const runAssess = () => {
    const extra = assessCustom.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
    const combined = [...new Set([...assessChecked, ...extra])].slice(0, 3);
    if (combined.length === 0) return;
    onAssessRun?.(combined);
  };

  const top20 = targets.slice(0, 20);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="p-3 space-y-3 flex-shrink-0">
        <p className={`text-[10px] leading-relaxed ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
          Select up to 3 targets for a deep evidence assessment, or type any gene name below.
        </p>

        {/* Ranked target checkboxes */}
        {top20.length > 0 ? (
          <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            <div className={`px-3 py-1.5 ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
              <p className={`text-[9px] uppercase tracking-widest font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>From Ranked List</p>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {top20.map(t => {
                const checked = assessChecked.includes(t.symbol);
                const disabled = !checked && assessChecked.length >= 3;
                return (
                  <button key={t.symbol} onClick={() => !disabled && toggleCheck(t.symbol)} disabled={disabled}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors border-b last:border-0 text-left ${
                      isDark ? 'border-slate-800' : 'border-slate-100'
                    } ${checked ? (isDark ? 'bg-blue-600/10' : 'bg-blue-50') : (isDark ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50')} ${disabled ? 'opacity-30' : ''}`}>
                    <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      checked ? 'bg-blue-600 border-blue-600' : (isDark ? 'border-slate-600' : 'border-slate-300')
                    }`}>
                      {checked && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className={`text-[11px] font-bold font-mono ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>{t.symbol}</span>
                    <span className={`text-[9px] truncate flex-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{t.name}</span>
                    <span className={`text-[9px] font-mono font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{(t.getScore ?? 0).toFixed(2)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={`text-center py-4 rounded-xl border ${isDark ? 'border-slate-800 text-slate-600' : 'border-slate-200 text-slate-400'}`}>
            <p className="text-[10px]">Search a disease first to load targets</p>
          </div>
        )}

        {/* Manual gene input */}
        <div>
          <label className={`text-[9px] font-black uppercase tracking-widest block mb-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            Add any gene (not in list)
          </label>
          <input value={assessCustom} onChange={e => setAssessCustom(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runAssess()}
            placeholder="e.g. CLU, BIN1, SORL1"
            className={`w-full px-3 py-2 rounded-lg border text-[11px] font-mono outline-none transition-colors ${
              isDark ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-600 focus:border-blue-500'
                     : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500'
            }`} />
        </div>

        {assessChecked.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {assessChecked.map(sym => (
              <span key={sym} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-600/15 text-blue-500 text-[10px] font-bold">
                {sym}
                <button onClick={() => toggleCheck(sym)} className="hover:text-red-400">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <button onClick={runAssess}
          disabled={assessChecked.length === 0 && !assessCustom.trim()}
          className={`w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
            assessChecked.length === 0 && !assessCustom.trim()
              ? 'opacity-30 cursor-not-allowed bg-blue-600 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20'
          }`}>
          <Microscope className="w-3.5 h-3.5" />
          Run Assessment
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// CohortFilterSidebar
// =============================================================================
const CohortFilterSidebar = ({ theme, targets, activeDisease, onScoreRangesChange, onRankRangesChange, visibleCols, onVisibleColsChange, visibleBioTissues, onVisibleBioTissuesChange, currentUser, globalWeights, onWeightsSave, onAssessRun, activeNav: activeNavProp, onActiveNavChange }: {
  theme: Theme;
  targets: Target[];
  activeDisease?: { id: string; name: string } | null;
  onScoreRangesChange?: (ranges: Record<string, [number, number]>) => void;
  onRankRangesChange?: (ranges: Record<string, [number, number]>) => void;
  visibleCols?: string[];
  onVisibleColsChange?: (cols: string[]) => void;
  visibleBioTissues?: string[];
  onVisibleBioTissuesChange?: (tissues: string[]) => void;
  currentUser?: UserSession | null;
  globalWeights?: { genetic: number; expression: number; target: number };
  onWeightsSave?: (w: { genetic: number; expression: number; target: number }) => Promise<{ ok: boolean; error?: string }>;
  onAssessRun?: (genes: string[]) => void;
  activeNav?: string;
  onActiveNavChange?: (nav: string) => void;
}) => {
  const isDark = theme === 'dark';

  // ── nav state ────────────────────────────────────────────────────────────
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeNavLocal, setActiveNavLocal] = useState<string>('cohort');
  const activeNav    = activeNavProp    ?? activeNavLocal;
  const setActiveNav = onActiveNavChange ?? setActiveNavLocal;

  // ── filters panel ────────────────────────────────────────────────────────
  const [openSections, setOpenSections] = useState<string[]>(['age', 'stage', 'subtype', 'gender']);
  const [selected, setSelected] = useState<Record<CohortFilterKey, string[]>>({
    age: [], stage: [], subtype: [], gender: [],
  });
  const [scoreRanges, setScoreRanges] = useState<Record<string, [number, number]>>(
    Object.fromEntries(SCORE_SLIDERS.map(s => [s.key, [0, 1]])) as Record<string, [number, number]>
  );

  // ── rankings panel ───────────────────────────────────────────────────────
  const [rankRanges, setRankRanges] = useState<Record<string, [number, number]>>({
    rwr: [0, 1], winner: [0, 1],
  });

  // ── GET formula studio (admin) ────────────────────────────────────────────
  const [draftWeights, setDraftWeights] = React.useState(() => globalWeights ?? { genetic: 0.45, expression: 0.25, target: 0.30 });
  const [weightSaving, setWeightSaving] = React.useState(false);
  const [weightMsg,    setWeightMsg]    = React.useState<{ ok: boolean; text: string } | null>(null);

  // Keep draft in sync if server weights arrive after mount
  React.useEffect(() => {
    if (globalWeights) setDraftWeights(globalWeights);
  }, [globalWeights?.genetic, globalWeights?.expression, globalWeights?.target]);

  const weightSum = +(draftWeights.genetic + draftWeights.expression + draftWeights.target).toFixed(3);

  const handleWeightChange = (key: 'genetic' | 'expression' | 'target', raw: number) => {
    const val = Math.round(raw * 100) / 100;
    setDraftWeights(prev => ({ ...prev, [key]: val }));
  };

  const handleWeightSave = async () => {
    if (!onWeightsSave) return;
    if (Math.abs(weightSum - 1.0) > 0.005) {
      setWeightMsg({ ok: false, text: `Weights must sum to 1.00 (currently ${weightSum.toFixed(2)})` });
      return;
    }
    setWeightSaving(true);
    setWeightMsg(null);
    const result = await onWeightsSave(draftWeights);
    setWeightSaving(false);
    setWeightMsg(result.ok ? { ok: true, text: 'Saved — formula updated globally' } : { ok: false, text: result.error ?? 'Save failed' });
    setTimeout(() => setWeightMsg(null), 3500);
  };

  // notify parent whenever score/rank ranges change so displayTargets can filter
  useEffect(() => { onScoreRangesChange?.(scoreRanges); }, [scoreRanges]);
  useEffect(() => { onRankRangesChange?.(rankRanges); }, [rankRanges]);

  // ── CSV cohort upload ────────────────────────────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvFileName, setCsvFileName]       = useState('');
  const [csvColumns, setCsvColumns]         = useState<string[]>([]);
  const [csvGeneData, setCsvGeneData]       = useState<Record<string, Record<string, number>>>({});
  const [selectedCohortCol, setSelectedCohortCol] = useState('');
  const [csvError, setCsvError]             = useState('');

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError('');
    if (!file.name.endsWith('.csv')) { setCsvError('Please upload a .csv file'); return; }
    if (file.size > 10 * 1024 * 1024) { setCsvError('File too large. Max 10 MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { setCsvError('CSV must have a header and at least one data row'); return; }
      const headers = lines[0].split(',').map(h => h.trim());
      if (headers[0].toLowerCase() !== 'gene_symbol') { setCsvError('First column must be named gene_symbol'); return; }
      const cohortCols = headers.slice(1);
      if (cohortCols.length === 0) { setCsvError('CSV must have at least one cohort column'); return; }
      const geneData: Record<string, Record<string, number>> = {};
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',').map(c => c.trim());
        const gene = cells[0]?.toUpperCase();
        if (!gene) continue;
        geneData[gene] = {};
        cohortCols.forEach((col, idx) => {
          const val = parseFloat(cells[idx + 1]);
          geneData[gene][col] = isNaN(val) ? 0 : val;
        });
      }
      setCsvFileName(file.name);
      setCsvColumns(cohortCols);
      setCsvGeneData(geneData);
      setSelectedCohortCol(cohortCols[0]);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── helpers ──────────────────────────────────────────────────────────────
  const toggleCheckbox = (group: CohortFilterKey, value: string) =>
    setSelected(prev => ({
      ...prev,
      [group]: prev[group].includes(value) ? prev[group].filter(v => v !== value) : [...prev[group], value],
    }));

  const toggleSection = (key: string) =>
    setOpenSections(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const totalActive = Object.values(selected).flat().length;


  // ── panel content ────────────────────────────────────────────────────────
  const panelConfig: Record<string, { icon: React.ElementType; title: string; sub: string }> = {
    workspace: { icon: Home,             title: 'Workspace',  sub: 'Overview'       },
    targets:   { icon: List,             title: 'Targets',    sub: 'Gene list'      },
    cohort:    { icon: Users,            title: 'Cohort',     sub: 'Cohort data'    },
    rankings:  { icon: BarChart3,         title: 'Rankings',   sub: 'Score ranges'   },
  };
  const pc = panelConfig[activeNav] ?? panelConfig['cohort'];
  const PanelIcon = pc.icon;

  const DOC_SECTIONS = [
    {
      key: 'about',
      title: 'About DiseaseToTarget',
      content: `DiseaseToTarget (DTT) is an AI-powered therapeutic target discovery platform. It retrieves disease-associated genes from Open Targets, scores them using a multi-factor GET formula, and ranks them by druggability evidence.`,
    },
    {
      key: 'get',
      title: 'How GET Score Works',
      content: `GET = G × ${globalWeights.genetic} + E × ${globalWeights.expression} + T × ${globalWeights.target}\n\n• **G** — Genetic score (Open Targets association evidence)\n• **E** — Expression score (tissue expression selectivity)\n• **T** — Target score (tractability + clinical trial signal)\n\nA velocity bonus (×0.15) rewards fast-rising literature genes.`,
    },
    {
      key: 'csv',
      title: 'Cohort CSV Format',
      content: `Upload a patient cohort CSV to replace the generic E score with your own expression data.\n\n**Required format:**\n\`\`\`\ngene_symbol,early_stage,late_stage,APOE4_pos\nAPOE,12.4,8.2,15.6\nTREM2,3.2,9.8,4.1\nBACE1,8.7,6.1,9.2\n\`\`\`\n\n• Column 1 must be **gene_symbol** (approved symbols, e.g. APOE not ENSG IDs)\n• Remaining columns = cohort names with numeric expression values (TPM/FPKM)\n• UTF-8 encoding • Max 10 MB • .csv only\n\nUpload via the **terminal chat** by typing: *upload cohort CSV*`,
    },
    {
      key: 'scores',
      title: 'Score Reference',
      content: `| Score | Range | Meaning |\n|---|---|---|\n| G Score | 0–1 | Genetic association strength |\n| E Score | 0–1 | Expression selectivity |\n| T Score | 0–1 | Target tractability |\n| GET | 0–1 | Combined priority score |\n| RWR | 0–1 | Network propagation rank |\n| WINNER | 0–1 | Network-based prioritization |\n| Literature | 0–1 | Publication evidence |\n| Overall | 0–1 | Aggregate rank |`,
    },
    {
      key: 'sources',
      title: 'Data Sources',
      content: `• **Open Targets** — Gene-disease associations, expression, tractability\n• **PubTator / PubMed** — Literature mining\n• **STRING DB** — Protein interaction networks\n• **ClinicalTrials.gov** — Trial signal scoring\n• **Enrichr** — Pathway enrichment`,
    },
  ];

  return (
    <div className={`flex shrink-0 h-full rounded-xl overflow-hidden border shadow-lg shadow-slate-950/5 transition-all duration-300 ${isDark ? 'bg-[#0b111c]/95 border-slate-800/80' : 'bg-white border-slate-200'}`}>

      {/* ── Icon rail ─────────────────────────────────────────────────────── */}
      <div className={`flex flex-col items-center py-3 gap-0.5 w-[52px] border-r flex-shrink-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
        {LEFT_NAV_ITEMS.map(item => {
          const active = activeNav === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => { setActiveNav(item.id); if (!isExpanded) setIsExpanded(true); }}
              title={item.label}
              className={`w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-all gap-0.5 group ${
                active
                  ? isDark ? 'bg-blue-600/15 text-blue-400' : 'bg-blue-50 text-blue-600'
                  : isDark ? 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/60' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className={`text-[7px] font-bold uppercase tracking-wide leading-none ${active ? (isDark ? 'text-blue-400' : 'text-blue-600') : (isDark ? 'text-slate-600 group-hover:text-slate-400' : 'text-slate-400 group-hover:text-slate-500')}`}>
                {item.label.slice(0, 4)}
              </span>
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => setIsExpanded(p => !p)}
          title={isExpanded ? 'Collapse' : 'Expand'}
          className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all mb-1 ${isDark ? 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/60' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'}`}
        >
          {isExpanded ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── Expanded panel ────────────────────────────────────────────────── */}
      <div className={`flex flex-col overflow-hidden transition-all duration-300 ${isExpanded ? 'w-56' : 'w-0 opacity-0 pointer-events-none'}`}>

        {/* Panel header */}
        <div className={`px-3 py-2.5 border-b flex items-center justify-between flex-shrink-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${isDark ? 'bg-blue-600/10' : 'bg-blue-50'}`}>
              <PanelIcon className={`w-3.5 h-3.5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            </div>
            <div>
              <div className={`text-[9px] font-black uppercase tracking-widest leading-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{pc.sub}</div>
              <div className={`text-[12px] font-bold leading-tight ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{pc.title}</div>
            </div>
          </div>
          {activeNav === 'cohort' && totalActive > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[9px] font-black">{totalActive}</span>
          )}
        </div>

        {/* ── FILTERS panel ─────────────────────────────────────────────── */}
        {activeNav === 'cohort' && (
          <>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {/* Cohort checkbox filters */}
              {COHORT_FILTER_GROUPS.map(group => {
                const isOpen = openSections.includes(group.key);
                const count  = selected[group.key].length;
                return (
                  <div key={group.key} className={`rounded-lg border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                    <button
                      onClick={() => toggleSection(group.key)}
                      className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors ${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{group.label}</span>
                        {count > 0 && <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[8px] font-black flex items-center justify-center">{count}</span>}
                      </div>
                      {isOpen ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
                    </button>
                    {isOpen && (
                      <div className={`px-3 pb-2 pt-1 space-y-1.5 border-t ${isDark ? 'border-slate-800 bg-slate-900/20' : 'border-slate-100 bg-slate-50/40'}`}>
                        {group.options.map(opt => {
                          const checked = selected[group.key].includes(opt);
                          return (
                            <label key={opt} onClick={() => toggleCheckbox(group.key as CohortFilterKey, opt)} className="flex items-center gap-2 cursor-pointer group">
                              <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all flex-shrink-0 ${checked ? 'bg-blue-600 border-blue-600' : isDark ? 'border-slate-600 hover:border-blue-500' : 'border-slate-300 hover:border-blue-400'}`}>
                                {checked && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                              </div>
                              <span className={`text-[11px] font-medium select-none transition-colors ${checked ? (isDark ? 'text-blue-400' : 'text-blue-600') : (isDark ? 'text-slate-400 group-hover:text-slate-200' : 'text-slate-600 group-hover:text-slate-800')}`}>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* CSV cohort upload */}
              <div className={`rounded-lg border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <div className={`px-3 py-2 flex items-center justify-between ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                  <span className={`text-[11px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>Cohort CSV</span>
                  {csvFileName && <span className={`text-[8px] truncate max-w-[80px] ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{csvFileName}</span>}
                </div>
                <div className={`px-3 py-2.5 space-y-2 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                  <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                  <button
                    onClick={() => csvInputRef.current?.click()}
                    className={`w-full py-1.5 rounded-md text-[10px] font-bold flex items-center justify-center gap-1.5 border transition-colors ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                  >
                    <FileText className="w-3 h-3" /> {csvFileName ? 'Replace CSV' : 'Upload CSV'}
                  </button>
                  {csvError && <p className="text-[9px] text-rose-500 font-medium">{csvError}</p>}
                  {csvColumns.length > 0 && (
                    <div>
                      <label className={`text-[9px] font-bold uppercase tracking-wider block mb-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Active Cohort</label>
                      <select
                        value={selectedCohortCol}
                        onChange={e => setSelectedCohortCol(e.target.value)}
                        className={`w-full px-2 py-1.5 rounded-md border text-[10px] font-bold outline-none ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'}`}
                      >
                        {csvColumns.map(col => <option key={col} value={col}>{col}</option>)}
                      </select>
                      <p className={`text-[9px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        {Object.keys(csvGeneData).length} genes loaded · {csvColumns.length} cohorts
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Score range sliders */}
              <div className={`rounded-lg border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <div className={`px-3 py-2 flex items-center justify-between ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                  <span className={`text-[11px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>Score Ranges</span>
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>0 – 1</span>
                </div>
                <div className={`px-3 py-2 space-y-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  {SCORE_SLIDERS.map(s => (
                    <DualSlider
                      key={s.key}
                      label={s.label}
                      values={scoreRanges[s.key] as [number, number]}
                      onChange={v => setScoreRanges(prev => ({ ...prev, [s.key]: v }))}
                      accent={s.accent}
                      isDark={isDark}
                    />
                  ))}
                </div>
              </div>

              {/* Table column visibility */}
              {onVisibleColsChange && (
                <div className={`rounded-lg border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <div className={`px-3 py-2 flex items-center justify-between ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                    <span className={`text-[11px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>Table Columns</span>
                    <button
                      onClick={() => onVisibleColsChange(TABLE_COLUMNS.filter(c => c.defaultOn).map(c => c.key))}
                      className={`text-[8px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}
                    >Reset</button>
                  </div>
                  <div className={`px-3 py-2 border-t grid grid-cols-2 gap-x-2 gap-y-1.5 ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                    {TABLE_COLUMNS.map(col => {
                      const checked = visibleCols?.includes(col.key) ?? col.defaultOn;
                      return (
                        <label
                          key={col.key}
                          className="flex items-center gap-1.5 cursor-pointer group"
                          onClick={() => {
                            const current = visibleCols ?? TABLE_COLUMNS.filter(c => c.defaultOn).map(c => c.key);
                            onVisibleColsChange(
                              checked ? current.filter(k => k !== col.key) : [...current, col.key]
                            );
                          }}
                        >
                          <div
                            className="w-3.5 h-3.5 rounded flex items-center justify-center border flex-shrink-0 transition-all"
                            style={{ background: checked ? col.accent : 'transparent', borderColor: checked ? col.accent : isDark ? '#475569' : '#cbd5e1' }}
                          >
                            {checked && <svg className="w-2 h-2 text-white" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <span className={`text-[10px] font-medium select-none ${checked ? (isDark ? 'text-white' : 'text-slate-800') : (isDark ? 'text-slate-500' : 'text-slate-400')}`}>{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

              {/* Bimodality tissue selector */}
              {onVisibleBioTissuesChange && (
                <div className={`rounded-lg border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <div className={`px-3 py-2 flex items-center justify-between ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                    <span className={`text-[11px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>Bimodality Tissues</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onVisibleBioTissuesChange(BIMODALITY_TISSUES.slice())}
                        className={`text-[8px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}
                      >All</button>
                      <button
                        onClick={() => onVisibleBioTissuesChange([])}
                        className={`text-[8px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}
                      >None</button>
                    </div>
                  </div>
                  <div className={`px-3 py-2 border-t grid grid-cols-2 gap-x-2 gap-y-1.5 ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                    {BIMODALITY_TISSUES.map(tissue => {
                      const checked = visibleBioTissues?.includes(tissue) ?? false;
                      return (
                        <label
                          key={tissue}
                          className="flex items-center gap-1.5 cursor-pointer group"
                          onClick={() => {
                            const current = visibleBioTissues ?? [];
                            onVisibleBioTissuesChange(
                              checked ? current.filter(t => t !== tissue) : [...current, tissue]
                            );
                          }}
                        >
                          <div
                            className="w-3.5 h-3.5 rounded flex items-center justify-center border flex-shrink-0 transition-all"
                            style={{ background: checked ? '#a855f7' : 'transparent', borderColor: checked ? '#a855f7' : isDark ? '#475569' : '#cbd5e1' }}
                          >
                            {checked && <svg className="w-2 h-2 text-white" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <span className={`text-[9px] font-medium select-none leading-tight ${checked ? (isDark ? 'text-white' : 'text-slate-800') : (isDark ? 'text-slate-500' : 'text-slate-400')}`}>{bioTissueLabel(tissue)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

            {totalActive > 0 && (
              <div className={`p-2 border-t flex-shrink-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                <button
                  onClick={() => setSelected({ age: [], stage: [], subtype: [], gender: [] })}
                  className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-colors ${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  Clear All ({totalActive})
                </button>
              </div>
            )}
          </>
        )}

        {/* ── RANKINGS panel ────────────────────────────────────────────── */}
        {activeNav === 'rankings' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-4">

            {/* ── ADMIN VIEW: GET Formula Studio ──────────────────────── */}
            {currentUser?.role === 'admin' && (<>
              {/* Header card */}
              <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-amber-500/30 bg-amber-500/5' : 'border-amber-200 bg-amber-50/60'}`}>
                <div className={`px-3 py-2.5 flex items-center justify-between ${isDark ? 'bg-amber-500/10' : 'bg-amber-100/60'}`}>
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span className={`text-[11px] font-bold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>GET Formula Weights</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[8px] font-black uppercase tracking-wider">Admin</span>
                </div>

                <div className="p-3 space-y-3">
                  <p className={`text-[9px] leading-relaxed ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    Adjust sliders so the total equals 100%, then click <strong>Save Global</strong>.
                  </p>

                  {/* Sliders */}
                  {(['genetic', 'expression', 'target'] as const).map((key) => {
                    const labels = {
                      genetic:    { short: 'G', full: 'Genetic',    accent: 'accent-blue-500',    text: 'text-blue-500'    },
                      expression: { short: 'E', full: 'Expression', accent: 'accent-emerald-500', text: 'text-emerald-500' },
                      target:     { short: 'T', full: 'Target',     accent: 'accent-amber-500',   text: 'text-amber-500'  },
                    };
                    const lbl = labels[key];
                    const pct = Math.round(draftWeights[key] * 100);
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] font-black ${lbl.text}`}>{lbl.short}</span>
                            <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{lbl.full}</span>
                          </div>
                          <span className={`text-[13px] font-black tabular-nums ${isDark ? 'text-white' : 'text-slate-900'}`}>{pct}%</span>
                        </div>
                        <input
                          type="range" min={0} max={1} step={0.01}
                          value={draftWeights[key]}
                          onChange={e => handleWeightChange(key, parseFloat(e.target.value))}
                          className={`w-full h-2 cursor-pointer rounded-full ${lbl.accent}`}
                        />
                      </div>
                    );
                  })}

                  {/* Sum indicator */}
                  <div className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${
                    Math.abs(weightSum - 1.0) > 0.005
                      ? 'bg-rose-500/10 border border-rose-500/30'
                      : isDark ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-emerald-50 border border-emerald-200'
                  }`}>
                    <span className={`text-[10px] font-black ${Math.abs(weightSum - 1.0) > 0.005 ? 'text-rose-500' : 'text-emerald-600'}`}>
                      {Math.abs(weightSum - 1.0) > 0.005 ? `⚠ Sum: ${(weightSum * 100).toFixed(0)}% — must be 100%` : `✓ Sum: 100%`}
                    </span>
                    <button
                      onClick={() => setDraftWeights({ genetic: 0.45, expression: 0.25, target: 0.30 })}
                      className={`text-[9px] font-bold px-2 py-0.5 rounded transition-colors ${isDark ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}
                    >Reset</button>
                  </div>

                  {/* Prominent Save Global button */}
                  <button
                    onClick={handleWeightSave}
                    disabled={weightSaving || Math.abs(weightSum - 1.0) > 0.005}
                    className="w-full py-2.5 rounded-xl font-black text-[12px] uppercase tracking-wider flex items-center justify-center gap-2 transition-all bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {weightSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {weightSaving ? 'Saving…' : 'Save Global'}
                  </button>

                  {weightMsg && (
                    <p className={`text-[10px] font-bold text-center ${weightMsg.ok ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {weightMsg.ok ? '✓ ' : '⚠ '}{weightMsg.text}
                    </p>
                  )}
                </div>
              </div>
            </>)}

            {/* ── RESEARCHER VIEW: Network score range filters ─────────── */}
            {currentUser?.role !== 'admin' && (<>
              <p className={`text-[10px] leading-relaxed ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                Filter the gene list by network-based ranking scores. Drag both handles to set a min–max range.
              </p>
              <div className={`p-3 rounded-xl border space-y-2 ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-violet-500" />
                  <span className={`text-[11px] font-bold uppercase tracking-wide ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>RWR Score</span>
                </div>
                <p className={`text-[9px] leading-relaxed ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  Random Walk with Restart — measures proximity to seed genes in the protein interaction network.
                </p>
                <DualSlider label="RWR Score" values={rankRanges.rwr as [number, number]} onChange={v => setRankRanges(p => ({ ...p, rwr: v }))} accent="#8b5cf6" isDark={isDark} />
              </div>
              <div className={`p-3 rounded-xl border space-y-2 ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />
                  <span className={`text-[11px] font-bold uppercase tracking-wide ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>WINNER Score</span>
                </div>
                <p className={`text-[9px] leading-relaxed ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  Network-based prioritization (Nguyen et al. 2022). Combines network topology with disease seed strength.
                </p>
                <DualSlider label="WINNER Score" values={rankRanges.winner as [number, number]} onChange={v => setRankRanges(p => ({ ...p, winner: v }))} accent="#06b6d4" isDark={isDark} />
              </div>
              <button
                onClick={() => setRankRanges({ rwr: [0, 1], winner: [0, 1] })}
                className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-colors ${isDark ? 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
              >
                Reset Ranges
              </button>
            </>)}

          </div>
        )}

        {/* ── ASSESS panel ──────────────────────────────────────────────── */}
        {activeNav === 'assess' && (
          <AssessPanelContent isDark={isDark} targets={targets} onAssessRun={onAssessRun} />
        )}

        {/* ── WORKSPACE panel ───────────────────────────────────────────── */}
        {activeNav === 'workspace' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Active disease */}
            <div className={`rounded-xl border p-3 ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
              <p className={`text-[9px] uppercase tracking-widest font-bold mb-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Active Disease</p>
              {activeDisease ? (
                <p className={`text-[11px] font-bold leading-snug ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{activeDisease.name}</p>
              ) : (
                <p className={`text-[10px] italic ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>No disease selected</p>
              )}
            </div>

            {/* Session stats */}
            {targets.length > 0 && (() => {
              const avg = (arr: number[]) => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 0;
              const gs  = avg(targets.map(t => t.geneticScore   ?? 0));
              const es  = avg(targets.map(t => t.combinedExpression ?? 0));
              const ts  = avg(targets.map(t => t.targetScore    ?? 0));
              const gets = avg(targets.map(t => t.overallScore  ?? 0));
              const withWinner = targets.filter(t => (t as any).winnerScore > 0).length;
              const rows = [
                { label: 'Genes loaded',    value: targets.length, color: 'text-emerald-500' },
                { label: 'Avg G score',     value: gs,             color: 'text-blue-500'    },
                { label: 'Avg E score',     value: es,             color: 'text-purple-500'  },
                { label: 'Avg T score',     value: ts,             color: 'text-orange-500'  },
                { label: 'Avg GET score',   value: gets,           color: 'text-rose-500'    },
                { label: 'With WINNER',     value: withWinner,     color: 'text-cyan-500'    },
              ];
              return (
                <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                  <div className={`px-3 py-1.5 ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                    <p className={`text-[9px] uppercase tracking-widest font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Session Stats</p>
                  </div>
                  <div className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}`}>
                    {rows.map(r => (
                      <div key={r.label} className="flex items-center justify-between px-3 py-1.5">
                        <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{r.label}</span>
                        <span className={`text-[11px] font-bold tabular-nums ${r.color}`}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {targets.length === 0 && (
              <p className={`text-[10px] text-center italic mt-6 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                Search for a disease to populate workspace stats.
              </p>
            )}
          </div>
        )}

        {/* ── TARGETS panel ─────────────────────────────────────────────── */}
        {activeNav === 'targets' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <p className={`text-[9px] uppercase tracking-widest font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              Top Targets by GET Score
            </p>
            {targets.length === 0 && (
              <p className={`text-[10px] italic text-center mt-6 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                No targets loaded yet. Run a disease search first.
              </p>
            )}
            {[...targets]
              .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
              .slice(0, 15)
              .map((t, i) => {
                const score = +(t.overallScore ?? 0).toFixed(2);
                const pct   = Math.round(score * 100);
                return (
                  <div key={t.id} className={`rounded-lg border p-2 ${isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-100 bg-white'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[9px] font-bold w-4 text-right ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>{i + 1}</span>
                      <span className={`text-[11px] font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{t.symbol}</span>
                      <span className={`ml-auto text-[10px] font-bold tabular-nums ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>{score}</span>
                    </div>
                    <div className={`h-1 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-rose-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex gap-1 mt-1">
                      {[
                        { label: 'G', val: t.geneticScore,        color: 'bg-blue-500'   },
                        { label: 'E', val: t.combinedExpression,  color: 'bg-purple-500' },
                        { label: 'T', val: t.targetScore,         color: 'bg-orange-500' },
                      ].map(b => (
                        <span key={b.label} className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold text-white ${b.color}`}>
                          {b.label} {+(b.val ?? 0).toFixed(1)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* ── SETTINGS panel ────────────────────────────────────────────── */}
      </div>
    </div>
  );
};

  const Breadcrumbs = ({
  activeDisease, 
  focusSymbol, 
  focusSubPage,
  onNavigate, 
  theme
}: { 
  activeDisease?: DiseaseInfo | null; 
  focusSymbol?: string | null; 
  focusSubPage?: 'main' | 'literature' | 'clinical' | null;
  onNavigate: (level: 'home' | 'disease' | 'target' | 'subpage') => void;
  theme: Theme;
}) => {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${theme === 'dark' ? 'bg-[#0b111c]/80 border-slate-800/70' : 'bg-slate-50 border-slate-200'}`}>
      <nav className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest overflow-x-auto custom-scrollbar-x h-8">
        <button 
          onClick={() => onNavigate('home')}
          className={`flex items-center gap-1.5 transition-all px-2.5 py-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 whitespace-nowrap ${!activeDisease ? 'text-blue-600 bg-white shadow-sm dark:bg-blue-950/30' : 'text-slate-400 hover:text-blue-500'}`}
        >
          <Home className="w-3.5 h-3.5" />
          Home
        </button>
        
        {activeDisease && (
          <>
            <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-700 shrink-0" />
            <button 
              onClick={() => onNavigate('disease')}
              className={`flex items-center gap-1.5 transition-all px-2.5 py-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 whitespace-nowrap ${activeDisease && !focusSymbol ? 'text-blue-600 bg-white shadow-sm dark:bg-blue-950/30' : 'text-slate-400 hover:text-blue-500'}`}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              {activeDisease.name}
            </button>
          </>
        )}

        {focusSymbol && (
          <>
            <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-700 shrink-0" />
            <button 
              onClick={() => onNavigate('target')}
              className={`flex items-center gap-1.5 transition-all px-2.5 py-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 whitespace-nowrap ${focusSymbol && focusSubPage === 'main' ? 'text-blue-600 bg-white shadow-sm dark:bg-blue-950/30' : 'text-slate-400 hover:text-blue-500'}`}
            >
              <Atom className="w-3.5 h-3.5" />
              {focusSymbol}
            </button>
          </>
        )}

        {focusSymbol && focusSubPage === 'literature' && (
          <>
            <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-700 shrink-0" />
            <div className="flex items-center gap-1.5 text-blue-600 bg-white shadow-sm dark:bg-blue-950/30 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
              <BookOpen className="w-3.5 h-3.5" />
              Literature Intelligence
            </div>
          </>
        )}
      </nav>
      <div className={`hidden lg:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-slate-400' : 'text-slate-800'}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Agent ready
      </div>
    </div>
  );
};

const TargetDetailView = ({ 
  target, 
  theme,
  diseaseName,
  subPage = 'main',
  onToggleUsefulness,
  onNavigateSubPage,
  onSave,
  onBack,
  onLoadAiSummary,
  aiSummaryLoading,
  onShowScoreInfo
}: { 
  target: Target; 
  theme: Theme; 
  diseaseName: string;
  subPage?: 'main' | 'literature' | 'clinical';
  onToggleUsefulness: (symbol: string, source: string, status: 'useful' | 'not-useful' | 'pinned' | null) => void;
  onNavigateSubPage: (page: 'main' | 'literature' | 'clinical') => void;
  onSave?: () => void;
  onBack: () => void;
  onLoadAiSummary: (symbol: string) => void;
  aiSummaryLoading: boolean;
  onShowScoreInfo?: (type: 'genetic' | 'expression' | 'target' | 'overall' | 'literature' | 'get_score' | 'priority' | 'rp_score' | 'winner_score') => void;
}) => {

  if (subPage === 'literature') {
    return (
      <div className="h-full flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
        <div className={`p-6 border-b flex items-center justify-between ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-100'}`}>
          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => onNavigateSubPage('main')}
              className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-neutral-400" />
            </button>
            <div className="space-y-1">
              <h3 className="text-2xl font-black text-purple-600 dark:text-purple-400 tracking-tighter flex items-center gap-2">
                <BookOpen className="w-6 h-6" /> Literature Intelligence: {target.symbol}
              </h3>
              <p className="text-[10px] font-bold uppercase text-neutral-400 tracking-widest">Scientific publication trends and evidence mapping</p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto space-y-10">
            {target.drillDown ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                    <span className="text-[10px] font-bold text-neutral-400 uppercase block mb-1">Literature Count</span>
                    <span className="text-3xl font-black text-purple-600">{target.drillDown.total_signals || 0}</span>
                  </div>
                  <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                    <span className="text-[10px] font-bold text-neutral-400 uppercase block mb-1">Recent (2024-25)</span>
                    <span className="text-3xl font-black text-purple-600">{target.drillDown.recent_signals || 0}</span>
                  </div>
                  <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                    <span className="text-[10px] font-bold text-neutral-400 uppercase block mb-1">Velocity (2y)</span>
                    <span className="text-2xl font-black text-purple-600">{target.drillDown.signal_velocity || '0%'}</span>
                  </div>
                </div>

                <div className="space-y-6">
                  <h4 className="text-[12px] font-bold uppercase text-neutral-500 tracking-widest border-b pb-2">Publication Intelligence</h4>
                  <LiteratureStats 
                    symbol={target.symbol} 
                    diseaseName={diseaseName} 
                    theme={theme} 
                    currentStatus={target.usefulness?.['literature']}
                    onToggle={onToggleUsefulness}
                    onSave={onSave}
                  />
                </div>

                <div className="space-y-6">
                  <h4 className="text-[12px] font-bold uppercase text-neutral-500 tracking-widest border-b pb-2">Europe PMC Analytics</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-[10px] font-bold text-neutral-400 uppercase">Total Papers</span>
                        <Globe2 className="w-4 h-4 text-indigo-500" />
                      </div>
                      <div className="text-3xl font-black text-indigo-600">{target.drillDown.paper_count.toLocaleString()}</div>
                    </div>
                    <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-[10px] font-bold text-neutral-400 uppercase">Velocity (3y)</span>
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div className="text-3xl font-black text-emerald-600">{target.drillDown.epmc_velocity || '0%'}</div>
                    </div>
                  </div>
                  {target.drillDown.epmc_top_paper && (
                    <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                      <span className="text-[10px] font-bold text-neutral-400 uppercase block mb-2">Latest Europe PMC Discovery</span>
                      <p className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200 leading-relaxed mb-2">
                        {target.drillDown.epmc_top_paper}
                      </p>
                      <div className="flex items-center gap-4 text-[10px] font-bold text-neutral-500 uppercase">
                        <span className="flex items-center gap-1"><Book className="w-3 h-3" /> {target.drillDown.epmc_journal}</span>
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {target.drillDown.epmc_year}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-10 space-y-4">
                  <h4 className="text-[12px] font-bold uppercase text-neutral-500 tracking-widest">Global Evidence Repositories</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <a 
                      href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(target.symbol)}+${encodeURIComponent(diseaseName)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600"><FileText className="w-5 h-5" /></div>
                        <div className="text-left">
                          <span className="text-[11px] font-black text-neutral-800 dark:text-neutral-200 block">PubMed / MEDLINE</span>
                          <span className="text-[9px] font-bold text-neutral-400 uppercase">NIH National Library</span>
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-neutral-300 group-hover:text-purple-500 transition-colors" />
                    </a>
                    <a 
                      href={`https://europepmc.org/search?query=${encodeURIComponent(target.symbol)}+AND+${encodeURIComponent(diseaseName)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600"><Globe2 className="w-5 h-5" /></div>
                        <div className="text-left">
                          <span className="text-[11px] font-black text-neutral-800 dark:text-neutral-200 block">Europe PMC</span>
                          <span className="text-[9px] font-bold text-neutral-400 uppercase">EMBL-EBI Open Access</span>
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-neutral-300 group-hover:text-indigo-500 transition-colors" />
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-20 text-center">
                <Loader2 className="w-10 h-10 animate-spin text-purple-500 mb-4" />
                <p className="text-sm font-bold text-neutral-500 uppercase tracking-widest">Mapping Scientific Evidence...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (subPage === 'clinical') {
    return (
      <div className="h-full flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
        <div className={`p-6 border-b flex items-center justify-between ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-100'}`}>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => onNavigateSubPage('main')}
              className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-neutral-400" />
            </button>
            <div className="space-y-1">
              <h3 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tighter flex items-center gap-2">
                <Activity className="w-6 h-6" /> Clinical Trial Intelligence: {target.symbol}
              </h3>
              <p className="text-[10px] font-bold uppercase text-neutral-400 tracking-widest">Deep insights from ClinicalTrials.gov and AI synthesis</p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto space-y-10">
            {target.drillDown ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                    <span className="text-[10px] font-bold text-neutral-400 uppercase block mb-1">Total Trials</span>
                    <span className="text-3xl font-black text-emerald-600">{target.drillDown.trial_count || 0}</span>
                  </div>
                  <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                    <span className="text-[10px] font-bold text-neutral-400 uppercase block mb-1">Max Phase</span>
                    <span className="text-3xl font-black text-emerald-600">{target.drillDown.max_phase || 'N/A'}</span>
                  </div>
                  <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                    <span className="text-[10px] font-bold text-neutral-400 uppercase block mb-1">Interventional</span>
                    <span className="text-3xl font-black text-emerald-600">{target.drillDown.interventional_count || 0}</span>
                  </div>
                  <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                    <span className="text-[10px] font-bold text-neutral-400 uppercase block mb-1">Active Trials</span>
                    <span className="text-3xl font-black text-emerald-600">{target.drillDown.active_trial_present ? 'YES' : 'NO'}</span>
                  </div>
                </div>

                {target.drillDown.clinical_summary && (
                  <div className={`p-8 rounded-3xl border border-dashed ${theme === 'dark' ? 'bg-blue-900/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <ShieldCheck className="w-6 h-6 text-blue-500" />
                      <h4 className="text-[12px] font-bold uppercase text-blue-600 tracking-widest">AI Clinical Synthesis</h4>
                    </div>
                    <p className={`text-lg leading-relaxed font-medium italic ${theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'}`}>
                      "{target.drillDown.clinical_summary}"
                    </p>
                  </div>
                )}

                {target.clinical_flags && target.clinical_flags.length > 0 && (
                  <div className={`p-8 rounded-3xl border ${theme === 'dark' ? 'bg-rose-900/10 border-rose-500/30' : 'bg-rose-50 border-rose-200'}`}>
                    <div className="flex items-center gap-3 mb-6">
                      <Flag className="w-6 h-6 text-rose-500" />
                      <h4 className="text-[12px] font-bold uppercase text-rose-600 tracking-widest">Clinical Strategic Flags</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {target.clinical_flags.map((flag, i) => (
                        <div key={i} className={`flex items-start gap-3 p-4 rounded-2xl ${theme === 'dark' ? 'bg-rose-950/40 border border-rose-900/50' : 'bg-white border border-rose-100 shadow-sm'}`}>
                          <div className="mt-1 p-1 rounded-full bg-rose-500/10"><AlertCircle className="w-3.5 h-3.5 text-rose-600" /></div>
                          <span className={`text-[13px] font-bold leading-tight ${theme === 'dark' ? 'text-rose-200' : 'text-rose-900'}`}>{flag}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-6">
                    <h4 className="text-[12px] font-bold uppercase text-neutral-500 tracking-widest border-b pb-2 flex items-center gap-2">
                      <Stethoscope className="w-4 h-4" /> Top Conditions
                    </h4>
                    <div className="space-y-3">
                      {target.drillDown.top_conditions?.map((c, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-100 dark:border-neutral-800">
                          <span className="text-[11px] font-bold text-neutral-700 dark:text-neutral-300 line-clamp-1">{c.name}</span>
                          <span className="px-2 py-1 rounded-lg bg-blue-500/10 text-[10px] font-black text-blue-600">{c.count} Trials</span>
                        </div>
                      )) || <p className="text-[11px] text-neutral-400 italic">No condition data available</p>}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h4 className="text-[12px] font-bold uppercase text-neutral-500 tracking-widest border-b pb-2 flex items-center gap-2">
                      <Pill className="w-4 h-4" /> Top Investigational Drugs
                    </h4>
                    <div className="space-y-3">
                      {target.drillDown.top_drugs?.map((d, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-100 dark:border-neutral-800">
                          <span className="text-[11px] font-bold text-neutral-700 dark:text-neutral-300 line-clamp-1">{d.name}</span>
                          <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-[10px] font-black text-emerald-600">{d.count} Trials</span>
                        </div>
                      )) || <p className="text-[11px] text-neutral-400 italic">No drug data available</p>}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-6">
                    <h4 className="text-[12px] font-bold uppercase text-neutral-500 tracking-widest border-b pb-2 flex items-center gap-2">
                      <Layers className="w-4 h-4" /> Phase Breakdown
                    </h4>
                    <div className="space-y-2">
                      {Object.entries(target.drillDown.phase_breakdown || {}).map(([phase, count]) => (
                        <div key={phase} className="flex items-center gap-4">
                          <span className="text-[10px] font-bold text-neutral-400 uppercase w-24">{phase.replace('_', ' ')}</span>
                          <div className="flex-1 h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-emerald-500" 
                              style={{ width: `${(count / (target.drillDown?.trial_count || 1)) * 100}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-neutral-600 dark:text-neutral-400">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h4 className="text-[12px] font-bold uppercase text-neutral-500 tracking-widest border-b pb-2 flex items-center gap-2">
                      <Building2 className="w-4 h-4" /> Sponsor Breakdown
                    </h4>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(target.drillDown.sponsor_breakdown || {}).map(([sponsor, count]) => (
                        <div key={sponsor} className="px-4 py-2 rounded-2xl bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-100 dark:border-neutral-800 flex flex-col items-center min-w-[100px]">
                          <span className="text-[16px] font-black text-neutral-800 dark:text-neutral-200">{count}</span>
                          <span className="text-[9px] font-bold text-neutral-400 uppercase">{sponsor}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-10 space-y-4">
                  <h4 className="text-[12px] font-bold uppercase text-neutral-500 tracking-widest">External Clinical Registries</h4>
                  <a 
                    href={`https://clinicaltrials.gov/search?cond=${encodeURIComponent(diseaseName)}&term=${encodeURIComponent(target.symbol)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-6 rounded-3xl border-2 border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"><Activity className="w-6 h-6" /></div>
                      <div className="text-left">
                        <span className="text-[14px] font-black text-neutral-800 dark:text-neutral-200 block">ClinicalTrials.gov</span>
                        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">U.S. National Library of Medicine</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-emerald-600 font-bold text-[11px] uppercase tracking-tighter">
                      View Full Registry <ExternalLink className="w-4 h-4" />
                    </div>
                  </a>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-20 text-center">
                <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-4" />
                <p className="text-sm font-bold text-neutral-500 uppercase tracking-widest">Synthesizing Clinical Intelligence...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
      <div className={`p-6 border-b flex items-center justify-between ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-100'}`}>
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-neutral-400" />
          </button>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h3 className={`text-4xl font-black tracking-tighter ${theme === 'dark' ? 'text-blue-50' : 'text-blue-800'}`}>{target.symbol}</h3>
              <div className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] font-bold text-blue-600 uppercase">
                Overall Score: {target.overallScore.toFixed(4)}
              </div>
              {target.drillDown?.trial_count && target.drillDown.trial_count > 0 && (
                <div className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-600 uppercase flex items-center gap-1">
                  <Activity className="w-3 h-3" /> {target.drillDown.trial_count} Clinical Trials
                </div>
              )}
            </div>
            <p className={`text-[12px] font-bold uppercase tracking-wide ${theme === 'dark' ? 'text-neutral-500' : 'text-black'}`}>{target.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <UsefulnessControls
            symbol={target.symbol}
            source="overall"
            currentStatus={target.usefulness?.['overall']}
            onToggle={onToggleUsefulness}
            onSave={onSave}
            theme={theme}
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-[10px] font-bold uppercase text-neutral-500 dark:text-neutral-400 tracking-widest">Molecular Radar</h4>
              <span className="text-[9px] font-bold text-neutral-400 uppercase block mt-1">Source: Open Targets</span>
            </div>
            <UsefulnessControls 
              symbol={target.symbol} 
              source="radar" 
              currentStatus={target.usefulness?.['radar']} 
              onToggle={onToggleUsefulness} 
              onSave={onSave}
              theme={theme} 
            />
          </div>
          <div className={`p-10 rounded-3xl border shadow-inner flex items-center justify-center ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-neutral-50 border-neutral-200'}`}>
            <RadarChart target={target} theme={theme} />
          </div>
        </div>

        {target.drillDown ? (
          <div className="pt-10 border-t border-neutral-100 dark:border-neutral-800">
            <h4 className="text-[10px] font-bold uppercase text-neutral-500 dark:text-neutral-400 tracking-widest mb-6">Evidence summary</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

              {/* Literature Section */}
              <div 
                onClick={() => onNavigateSubPage('literature')}
                className={`p-6 rounded-2xl border cursor-pointer transition-all hover:ring-2 hover:ring-indigo-500/50 hover:shadow-lg ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20"><FileText className="w-4 h-4 text-indigo-500" /></div>
                    <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-wider">Literature</h4>
                  </div>
                  <div className="text-[9px] font-bold text-indigo-600 uppercase tracking-tighter">Click for Details</div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-end"><span className="text-[10px] font-bold text-neutral-400 uppercase">Literature Count</span><span className="text-xl font-black text-indigo-600">{target.drillDown.total_signals || 0}</span></div>
                  <div className="flex justify-between items-end"><span className="text-[10px] font-bold text-neutral-400 uppercase">Recent (24-25)</span><span className="text-lg font-bold text-indigo-500">{target.drillDown.recent_signals || 0}</span></div>
                  <div className="flex justify-between items-end"><span className="text-[10px] font-bold text-neutral-400 uppercase">Velocity (2y)</span><span className="text-[11px] font-mono font-bold text-indigo-600">{target.drillDown.signal_velocity || '0%'}</span></div>
                  <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
                    <span className="text-[9px] font-bold text-neutral-400 uppercase block mb-1">Latest Publication</span>
                    <p className="text-[10px] text-neutral-600 dark:text-neutral-400 line-clamp-1 italic">
                      {target.drillDown.top_papers?.[0]?.title || 'No recent publications found'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Clinical Trials Section */}
              <div 
                onClick={() => onNavigateSubPage('clinical')}
                className={`p-6 rounded-2xl border cursor-pointer transition-all hover:ring-2 hover:ring-emerald-500/50 hover:shadow-lg ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20"><Activity className="w-4 h-4 text-emerald-500" /></div>
                    <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-wider">Clinical Trials</h4>
                  </div>
                  <div className="text-[9px] font-bold text-emerald-600 uppercase tracking-tighter">Click for Details</div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-end"><span className="text-[10px] font-bold text-neutral-400 uppercase">Total Trials</span><span className="text-xl font-black text-emerald-600">{target.drillDown.trial_count || 0}</span></div>
                  <div className="flex justify-between items-end"><span className="text-[10px] font-bold text-neutral-400 uppercase">Max Phase</span><span className="text-lg font-bold text-emerald-500">{target.drillDown.max_phase || 'N/A'}</span></div>
                  <div className="flex justify-between items-end"><span className="text-[10px] font-bold text-neutral-400 uppercase">Interventional</span><span className="text-[11px] font-mono font-bold text-emerald-600">{target.drillDown.interventional_count || 0}</span></div>
                  <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center gap-2">
                    <span className="text-[9px] font-bold text-neutral-400 uppercase">Source: ClinicalTrials.gov</span>
                  </div>
                </div>
              </div>

              {/* Europe PMC Section */}
              <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20"><BookOpen className="w-4 h-4 text-purple-500" /></div>
                    <h4 className="text-[11px] font-bold uppercase text-neutral-500 tracking-wider">Europe PMC</h4>
                  </div>
                  {target.drillDown.epmc_velocity && (
                    <div className="px-2 py-0.5 rounded bg-purple-500/10 text-[9px] font-black text-purple-600 uppercase">
                      Velocity: {target.drillDown.epmc_velocity}
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-end"><span className="text-[10px] font-bold text-neutral-400 uppercase">Total Papers</span><span className="text-xl font-black text-purple-600">{target.drillDown.paper_count.toLocaleString()}</span></div>
                  <div className="flex justify-between items-end"><span className="text-[10px] font-bold text-neutral-400 uppercase">Recent (3y)</span><span className="text-lg font-bold text-purple-500">{target.drillDown.recent_paper_count.toLocaleString()}</span></div>
                  
                  <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
                    <span className="text-[9px] font-bold text-neutral-400 uppercase block mb-1">Latest Publication</span>
                    <p className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200 line-clamp-2 leading-tight mb-1">
                      {target.drillDown.epmc_top_paper || 'No recent publications found'}
                    </p>
                    <div className="flex items-center justify-between text-[9px] font-bold text-neutral-400 uppercase">
                      <span>{target.drillDown.epmc_journal || 'N/A'}</span>
                      <span>{target.drillDown.epmc_year || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Clinical Intelligence Summary */}
            {target.drillDown.clinical_summary ? (
              <div className={`mt-6 p-6 rounded-2xl border border-dashed ${theme === 'dark' ? 'bg-blue-900/5 border-blue-500/20' : 'bg-blue-50/50 border-blue-200'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-blue-500" />
                  <h5 className="text-[10px] font-bold uppercase text-blue-600 tracking-widest">Clinical Intelligence Summary</h5>
                </div>
                <p className={`text-[12px] leading-relaxed italic ${theme === 'dark' ? 'text-neutral-300' : 'text-neutral-700'}`}>
                  {target.drillDown.clinical_summary}
                </p>
              </div>
            ) : (
              <div className={`mt-6 p-6 rounded-2xl border border-dashed flex flex-col items-center justify-center gap-4 ${theme === 'dark' ? 'bg-blue-900/5 border-blue-500/20' : 'bg-blue-50/50 border-blue-200'}`}>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-500" />
                  <h5 className="text-[10px] font-bold uppercase text-blue-600 tracking-widest">Clinical Intelligence Summary</h5>
                </div>
                <button 
                  onClick={() => onLoadAiSummary(target.symbol)}
                  disabled={aiSummaryLoading}
                  className={`px-6 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-50`}
                >
                  {aiSummaryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Generate AI Clinical Insight
                </button>
                <p className="text-[9px] font-bold text-neutral-400 uppercase">Synthesize clinical trial data into professional insights</p>
              </div>
            )}

            {target.clinical_flags && target.clinical_flags.length > 0 && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-2">
                  <Flag className="w-4 h-4 text-rose-500" />
                  <h5 className="text-[10px] font-bold uppercase text-rose-600 tracking-widest">Strategic Flags</h5>
                </div>
                <div className="flex flex-wrap gap-2">
                  {target.clinical_flags.map((flag, i) => (
                    <div key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${theme === 'dark' ? 'bg-rose-950/20 border-rose-900/40 text-rose-300' : 'bg-rose-50 border-rose-100 text-rose-700'}`}>
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-[10px] font-bold leading-none">{flag}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical Pipeline Section */}
            <div className="pt-10 border-t border-neutral-100 dark:border-neutral-800">
              <DrugLandscape 
                targetId={target.id} 
                symbol={target.symbol} 
                theme={theme} 
                currentStatus={target.usefulness?.['clinical']}
                onToggle={onToggleUsefulness}
                onSave={onSave}
              />
            </div>

            {/* Target Summary (Moved to last) */}
            <div className={`mt-10 p-8 rounded-3xl border shadow-sm ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200'}`}>
              <h4 className="text-[10px] font-bold uppercase text-neutral-500 dark:text-neutral-400 tracking-widest mb-4">Target Summary</h4>
              <p className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'}`}>
                {target.name} ({target.symbol}) is a significant target in {diseaseName} research.
                With an overall evidence score of {target.overallScore.toFixed(4)}, it shows strong {target.geneticScore > 0.5 ? 'genetic' : 'molecular'} associations.
                Explore the deep evidence intelligence above for detailed publication insights.
              </p>
            </div>

            {/* ChEMBL Druggability (additive — fetched on demand from ChEMBL) */}
            <DruggabilityPanel geneSymbol={target.symbol} currentDisease={diseaseName} theme={theme} />
          </div>
        ) : (
          <div className="pt-10 border-t border-neutral-100 dark:border-neutral-800 flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
            <p className="text-[11px] font-bold uppercase text-neutral-500 tracking-widest">Synthesizing Deep Evidence...</p>
          </div>
        )}
      </div>
    </div>
  );
};

const App = () => {
  const [theme, setTheme] = useState<Theme>('light');

  // ── Auth state (Supabase) ────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const isAuthenticated = !!currentUser;

  // Fetch role from DB in the background and patch currentUser if it differs.
  // Called AFTER we already let the user in — never blocks the UI.
  const syncRole = async (userId: string) => {
    try {
      const profile = await fetchUserProfile(userId);
      if (profile?.role) {
        setCurrentUser(prev =>
          prev && prev.userId === userId ? { ...prev, role: profile.role as UserRole } : prev
        );
      }
    } catch { /* non-critical — user stays as 'user' */ }
  };

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      if (session?.user) {
        // ── Let the user in IMMEDIATELY with basic info ──
        // Role will be patched by syncRole() in the background.
        setCurrentUser({
          role:     'user',           // default; overwritten by syncRole
          username: session.user.email ?? session.user.id,
          userId:   session.user.id,
        });
        setAuthLoading(false);
        syncRole(session.user.id);   // fire-and-forget
      } else {
        setCurrentUser(null);
        setAuthLoading(false);
      }
    });

    // Safety net: unblock UI after 5 s if Supabase never fires
    const timeout = setTimeout(() => { if (mounted) setAuthLoading(false); }, 5000);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch { /* ignore sign-out errors */ }
    // Force clear state regardless of whether signOut succeeded
    setCurrentUser(null);
    setAuthLoading(false);
    localStorage.removeItem('dtt_session');
    localStorage.removeItem('pharm_user');
    // Clear persisted research state so the next user starts fresh
    try { sessionStorage.removeItem('dtt_research_state'); } catch { /* ignore */ }
  };

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sidebarNav, setSidebarNav] = useState<string>('cohort');
  const OT_PAGE_SIZE = 50;

  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Mapping Intelligence...");

  // ── Global weights (Supabase app_config) ────────────────────────────────
  const [globalWeights, setGlobalWeights] = useState<{ genetic: number; expression: number; target: number }>({ genetic: 0.45, expression: 0.25, target: 0.30 });

  useEffect(() => {
    fetchGlobalWeights().then(w => {
      if (!w) return;
      setGlobalWeights(w);
      setResearchState(prev => ({ ...prev, weights: { ...prev.weights, ...w } }));
    });
  }, []);

  const handleWeightsSave = async (w: { genetic: number; expression: number; target: number }): Promise<{ ok: boolean; error?: string }> => {
    const result = await saveGlobalWeights(w);
    if (!result.ok) return result;
    setGlobalWeights(w);
    setResearchState(prev => ({ ...prev, weights: { ...prev.weights, ...w } }));
    return { ok: true };
  };

  const [researchState, setResearchState] = useState<ResearchContext>({
    activeDisease: null,
    targets: [],
    enrichment: [],
    limit: OT_PAGE_SIZE,
    currentPage: 0,
    focusSymbol: null,
    filters: [],
    sorts: [],
    globalHiddenMetrics: [],
    weights: {
      genetic: 0.45,
      expression: 0.25,
      target: 0.30,
      velocity: 0.15
    },
    paperResults: [],
    pubtatorPage: 1
  });

  // ── Assess tab state ────────────────────────────────────────────────────────
  const [assessMode, setAssessMode]     = useState(false);
  const [assessGenes, setAssessGenes]   = useState<string[]>([]);
  const [assessData, setAssessData]     = useState<GeneAssessmentData[]>([]);
  const [assessLoading, setAssessLoading] = useState<Record<string, boolean>>({});

  const handleAssessRun = useCallback(async (genes: string[]) => {
    setAssessGenes(genes);
    setAssessData([]);
    setAssessLoading(Object.fromEntries(genes.map(g => [g, true])));
    setAssessMode(true);

    for (const sym of genes) {
      const existingTarget = researchState.targets.find(t => t.symbol.toUpperCase() === sym.toUpperCase());
      try {
        const result = await api.getGeneFullProfile(
          sym,
          researchState.activeDisease?.id || null,
          researchState.activeDisease?.name || '',
          existingTarget
        );
        setAssessData(prev => {
          const next = [...prev.filter(d => d.symbol !== sym), result];
          next.sort((a, b) => genes.indexOf(a.symbol) - genes.indexOf(b.symbol));
          return next;
        });
      } catch (e: any) {
        setAssessData(prev => [...prev, {
          symbol: sym, name: sym,
          overallScore: 0, geneticScore: 0, expressionScore: 0, targetScore: 0,
          getScore: 0, literatureScore: 0,
          pubTatorScore: 0, pubTatorVelocity: 0, pubTatorTotalPapers: 0, pubTatorRecentPapers: 0,
          tauTissue: 0, tauSingleCell: 0, combinedExpression: 0,
          bimodalityScores: {}, pathways: [],
          drillDown: { trial_count: 0, max_phase: 'N/A', active_trial_present: false, paper_count: 0, recent_paper_count: 0, latest_publication_date: 'N/A' },
          pubmed: { total: 0, recent: 0, topPapers: [] },
          foundInRankedList: false,
          error: e.message,
        }]);
      } finally {
        setAssessLoading(prev => ({ ...prev, [sym]: false }));
      }
    }
  }, [researchState.targets, researchState.activeDisease]);

  // ── Session persistence: restore researchState from sessionStorage after login ──
  useEffect(() => {
    if (!isAuthenticated) return;
    if (sessionRestoredRef.current) return;          // only run once per session
    if (researchState.activeDisease || researchState.targets.length > 0) {
      sessionRestoredRef.current = true;             // already have live data — skip restore
      return;
    }
    sessionRestoredRef.current = true;
    try {
      const raw = sessionStorage.getItem('dtt_research_state');
      if (!raw) return;
      const snap = JSON.parse(raw) as {
        activeDisease?: DiseaseInfo | null;
        targets?: Target[];
        currentPage?: number;
        weights?: GETWeights;
      };
      if (snap.activeDisease || (snap.targets && snap.targets.length > 0)) {
        setResearchState(prev => ({
          ...prev,
          activeDisease: snap.activeDisease ?? prev.activeDisease,
          targets:       snap.targets      ?? prev.targets,
          currentPage:   snap.currentPage  ?? prev.currentPage,
          weights:       snap.weights      ?? prev.weights,
        }));
      }
    } catch { /* corrupt snapshot — ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ── Session persistence: save researchState to sessionStorage whenever key fields change ──
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!researchState.activeDisease && researchState.targets.length === 0) return;
    try {
      // Strip drillDown — it's loaded on demand and can be large
      const lightTargets = researchState.targets.map(({ drillDown: _dd, ...rest }) => rest);
      sessionStorage.setItem('dtt_research_state', JSON.stringify({
        activeDisease: researchState.activeDisease,
        targets:       lightTargets,
        currentPage:   researchState.currentPage,
        weights:       researchState.weights,
      }));
    } catch { /* sessionStorage quota exceeded — ignore */ }
  }, [researchState.activeDisease, researchState.targets, researchState.currentPage, researchState.weights, isAuthenticated]);

  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: "DiseaseToTarget Ready. Targeting breakthroughs in Alzheimer's and other complex diseases.", timestamp: new Date() }]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [scoreRangeFilter, setScoreRangeFilter] = useState<Record<string, [number, number]>>({});
  const [rankRangeFilter, setRankRangeFilter]   = useState<Record<string, [number, number]>>({});
  const [visibleColumns, setVisibleColumns]     = useState<string[]>(
    TABLE_COLUMNS.filter(c => c.defaultOn).map(c => c.key)
  );
  const [tableSort, setTableSort] = useState<{key: string; dir: 'asc'|'desc'}|null>(null);
  const [enrichSourceFilter, setEnrichSourceFilter] = useState<'All' | 'KEGG' | 'Reactome' | 'WikiPathways'>('All');
  const [visibleBioTissues, setVisibleBioTissues] = useState<string[]>([]);  // selected tissues to show as columns
  const bimodalityCache = useRef<Record<string, Record<string, number>> | null>(null);
  const bimodalityLoading = useRef(false);
  const sessionRestoredRef = useRef(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [activeScoreInfo, setActiveScoreInfo] = useState<'genetic' | 'expression' | 'target' | 'overall' | 'literature' | 'get_score' | 'priority' | 'rp_score' | 'winner_score' | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [drillDownLoading, setDrillDownLoading] = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight; }, [messages]);
  const [isExporting, setIsExporting] = useState(false);
  const [allMetricsExportOpen, setAllMetricsExportOpen] = useState(false);
  const [allMetricsProgress, setAllMetricsProgress] = useState<{ done: number; total: number; stage: string; startedAt: number } | null>(null);
  const [focusSubPage, setFocusSubPage] = useState<'main' | 'literature' | 'clinical'>('main');

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const handleAddGeneFromPaper = async (gene: { symbol: string, mentions?: number, role?: string }, source: 'PAPER' | 'LIT' = 'PAPER') => {
    const newTarget: Target = {
      id: `${source.toLowerCase()}-${gene.symbol}-${Date.now()}`,
      symbol: gene.symbol,
      name: gene.role || 'Extracted from literature',
      overallScore: 0,
      geneticScore: 0,
      expressionScore: 0,
      targetScore: 0,
      pathways: [],
      source: source,
      drillDown: {
        paper_count: gene.mentions || 0,
        recent_paper_count: 0,
        latest_publication_date: new Date().toISOString().split('T')[0],
        total_signals: gene.mentions || 0,
        recent_signals: 0,
        signal_velocity: '0%',
        clinical_flags: []
      }
    };

    setResearchState(prev => {
      const exists = prev.targets.find(t => t.symbol === gene.symbol);
      if (exists) return prev;
      return { ...prev, targets: [newTarget, ...prev.targets] };
    });

    if (researchState.activeDisease) {
      try {
        const dd = await api.getDrillDownData(gene.symbol, researchState.activeDisease.name);
        setResearchState(prev => ({
          ...prev,
          targets: prev.targets.map(t => t.symbol === gene.symbol ? { ...t, drillDown: dd } : t)
        }));
      } catch (err) {
        logDev("Failed to fetch velocity for added gene:", err);
      }
    }
  };

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

  const handlePaperUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type === 'application/pdf');
    if (files.length === 0) return;

    setLoading(true);
    setLoadingMessage("Analyzing research papers...");
    const newResults: PaperAnalysis[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setLoadingMessage(`Processing ${file.name} (${i + 1}/${files.length})...`);

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const prompt = `You are a biomedical literature expert. Extract structured information from this research paper.
Return ONLY valid JSON.

{
  "title": "paper title or empty string",
  "genes": [
    { "symbol": "GENE1", "mentions": 5, "role": "role in study" }
  ],
  "diseases": ["disease name"],
  "chemicals": [
    { "name": "compound", "role": "inhibitor|activator|drug|biomarker" }
  ],
  "variants": ["rs429358", "p.Arg47His"],
  "study_type": "GWAS|RCT|Cohort|Case-Control|Animal Model|In Vitro|Meta-analysis|Single-cell|Other",
  "sample_size": 0,
  "species": ["human", "mouse"],
  "brain_regions": ["hippocampus"],
  "cell_types": ["astrocyte", "microglia"],
  "experimental_models": ["5xFAD mouse"],
  "drug_gene_relationships": [
    { "drug": "compound", "gene": "GENE1", "action": "inhibits|activates|targets" }
  ],
  "p_value": "p < 0.001",
  "fold_change": "2.3-fold increase",
  "odds_ratio": "OR 1.8 (95% CI 1.2-2.6)",
  "funding": ["NIH"],
  "industry_funded": false,
  "key_finding": "one sentence most important result",
  "conclusion": "2-3 sentence summary"
}`;

        const aiRes = await fetch('/api/ai/analyze-paper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType: 'application/pdf', prompt }),
        });
        const response = await aiRes.json();

        if (!response.text) throw new Error("No response from AI");
        const parsed = JSON.parse(response.text) as PaperAnalysis;
        newResults.push(parsed);
      }
      setResearchState(prev => ({ ...prev, paperResults: [...newResults, ...prev.paperResults] }));
      setViewMode('paper');
      setMessages(prev => [...prev, { role: 'assistant', content: `Successfully analyzed ${files.length} paper(s). Switched to PAPER view to show extracted intelligence.`, timestamp: new Date() }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error analyzing papers: ${err.message}`, timestamp: new Date() }]);
    } finally {
      setLoading(false);
      setLoadingMessage("Mapping Intelligence...");
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDrillDown = async (symbol: string) => {
    const target = researchState.targets.find(t => t.symbol === symbol);
    if (target && !target.drillDown) {
      setDrillDownLoading(symbol);
      const data = await api.getDrillDownData(symbol, researchState.activeDisease?.name || '');
      setResearchState(prev => ({
        ...prev,
        targets: prev.targets.map(t => t.symbol === symbol ? { ...t, drillDown: data } : t)
      }));
      setDrillDownLoading(null);
    }
  };

  const handleLoadAiSummary = async (symbol: string) => {
    const target = researchState.targets.find(t => t.symbol === symbol);
    if (target && target.drillDown && !target.drillDown.clinical_summary) {
      setAiSummaryLoading(symbol);
      try {
        const summary = await api.getAiSummary(symbol, researchState.activeDisease?.name || '', target.drillDown);
        setResearchState(prev => ({
          ...prev,
          targets: prev.targets.map(t => t.symbol === symbol ? { 
            ...t, 
            drillDown: { ...t.drillDown!, clinical_summary: summary } 
          } : t)
        }));
      } catch (e) {
        logDev("Failed to load AI summary", e);
      } finally {
        setAiSummaryLoading(null);
      }
    }
  };
  
  const toggleUsefulness = (symbol: string, source: string, status: 'useful' | 'not-useful' | 'pinned') => {
    setResearchState(prev => {
      const isGlobalTrash = status === 'not-useful' && source !== 'overall';
      const isCurrentlyGloballyHidden = prev.globalHiddenMetrics?.includes(source);

      let newGlobalHiddenMetrics = [...(prev.globalHiddenMetrics || [])];
      if (isGlobalTrash) {
        if (isCurrentlyGloballyHidden) {
          newGlobalHiddenMetrics = newGlobalHiddenMetrics.filter(m => m !== source);
        } else {
          newGlobalHiddenMetrics.push(source);
        }
      }

      return {
        ...prev,
        globalHiddenMetrics: newGlobalHiddenMetrics,
        targets: prev.targets.map(t => {
          // If it's a global trash toggle, update all targets to match the new global state
          if (isGlobalTrash) {
            const newUsefulness = { ...(t.usefulness || {}) };
            if (isCurrentlyGloballyHidden) {
              delete newUsefulness[source];
            } else {
              newUsefulness[source] = 'not-useful';
            }
            return { ...t, usefulness: newUsefulness };
          }

          // Otherwise, it's a local toggle (like 'overall' or pinning)
          if (t.symbol === symbol) {
            const currentStatus = t.usefulness?.[source];
            const newUsefulness = { ...(t.usefulness || {}) };
            
            if (source === 'overall' && status === 'not-useful') {
              // If we're trashing the overall gene row, mark all metrics as not-useful for this gene
              if (currentStatus === 'not-useful') {
                delete newUsefulness['overall'];
                delete newUsefulness['literature'];
                delete newUsefulness['discovery'];
              } else {
                newUsefulness['overall'] = 'not-useful';
                newUsefulness['literature'] = 'not-useful';
                newUsefulness['discovery'] = 'not-useful';
              }
            } else if (currentStatus === status) {
              delete newUsefulness[source];
            } else {
              newUsefulness[source] = status;
            }
            return { ...t, usefulness: newUsefulness };
          }
          return t;
        })
      };
    });
  };

  // All columns available for export (fixed + optional visible ones)
  const getExportRows = () => {
    const visibleCols = TABLE_COLUMNS.filter(c => visibleColumns.includes(c.key));
    const headers = ['Gene', 'Gene Name', ...visibleCols.map(c => c.label)];
    const rows = displayTargets.map(t => {
      const fixed = [t.symbol, t.name];
      const scores = visibleCols.map(c => {
        const v = (t as any)[c.key];
        return v !== undefined && v !== null ? (typeof v === 'number' ? v.toFixed(4) : String(v)) : '';
      });
      return [...fixed, ...scores];
    });
    return { headers, rows };
  };

  const exportToCsv = async () => {
    if (!displayTargets.length) { alert("No data to export."); return; }
    const { headers, rows } = getExportRows();
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    await saveBlob(blob, `Target_Prioritization_${(researchState.activeDisease?.name || 'Unknown').replace(/\s+/g, '_')}.csv`);
  };

  const exportAllMetricsCsv = async (selection: 'loaded' | 100 | 500) => {
    setAllMetricsExportOpen(false);
    if (!researchState.activeDisease) {
      alert("No disease loaded. Please search for a disease first.");
      return;
    }

    const startedAt = Date.now();
    const requestedTotal = selection === 'loaded' ? displayTargets.length : selection;
    const disease = researchState.activeDisease.name || 'Unknown';
    const efoId = researchState.activeDisease.id;
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const cell = (value: unknown) => value === undefined || value === null ? '' : String(value);
    const num = (value: unknown, digits = 4) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '';
    const bool = (value: unknown) => typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : '';
    const list = (values?: { name?: string; count?: number }[]) => values?.map(v => `${v.name}${v.count !== undefined ? ` (${v.count})` : ''}`).join('; ') ?? '';
    const json = (value: unknown) => value && typeof value === 'object' ? JSON.stringify(value) : '';
    const updateProgress = (done: number, total: number, stage: string) => {
      setAllMetricsProgress({ done, total, stage, startedAt });
    };

    setIsExporting(true);
    updateProgress(0, requestedTotal, 'Preparing gene list');

    try {
      let genes: Target[] = selection === 'loaded' ? [...displayTargets] : [...researchState.targets];
      const targetCount = Math.min(selection === 'loaded' ? genes.length : selection, 500);
      const seen = new Set(genes.map(t => t.symbol.toUpperCase()));

      if (selection !== 'loaded') {
        let page = Math.ceil(genes.length / OT_PAGE_SIZE);
        while (genes.length < targetCount) {
          updateProgress(Math.min(genes.length, targetCount), targetCount, 'Fetching Open Targets genes');
          const next = await api.getGenes(efoId, OT_PAGE_SIZE, page);
          if (!next.length) break;
          for (const g of next) {
            const symbol = g.symbol.toUpperCase();
            if (!seen.has(symbol)) {
              seen.add(symbol);
              genes.push(g);
            }
          }
          page++;
        }
        genes = genes.slice(0, targetCount);
      }

      if (!genes.length) {
        alert('No genes available for export.');
        return;
      }

      updateProgress(0, genes.length, 'Scoring Open Targets metrics');
      genes = calculatePriorityScores(genes.map(t => ({ ...t })), researchState.weights);

      updateProgress(0, genes.length, 'Fetching TAU tissue specificity');
      await api.enrichTau(genes).catch(() => undefined);

      updateProgress(0, genes.length, 'Loading bimodality metrics');
      let bimodalityLookup = bimodalityCache.current;
      if (!bimodalityLookup) {
        bimodalityLookup = await fetch('/bimodality.json').then(r => r.json()).catch(() => null);
        bimodalityCache.current = bimodalityLookup;
      }
      if (bimodalityLookup) {
        genes = genes.map(t => ({ ...t, bimodalityScores: t.bimodalityScores ?? bimodalityLookup?.[t.id] ?? {} }));
      }

      updateProgress(0, genes.length, 'Fetching pathway enrichment');
      const exportEnrichment = await api.getEnrichment(genes.map(g => g.symbol)).catch(() => researchState.enrichment);
      const enrichedByGene = (symbol: string) => {
        const upper = symbol.toUpperCase();
        return exportEnrichment
          .filter(e => e.genes.some(g => g.toUpperCase() === upper))
          .sort((a, b) => a.adjustedPValue - b.adjustedPValue);
      };

      const headers = [
        'Rank', 'Source', 'Target ID', 'Gene', 'Gene Name',
        'Open Targets Overall Score', 'GET Score', 'Genetic Score', 'Expression Score', 'Target Score', 'Literature Score', 'Priority Score', 'Final Score',
        'RP Score', 'WINNER Score', 'WINNER Raw Score',
        'PubTator Total Papers', 'PubTator Recent Papers', 'PubTator Velocity',
        'PubMed Total Signals', 'PubMed Recent Signals', 'PubMed Signal Velocity', 'PubMed Top Paper', 'PubMed Top Paper ID',
        'Europe PMC Total Papers', 'Europe PMC Recent Papers', 'Europe PMC Velocity', 'Europe PMC Latest Date', 'Europe PMC Top Paper', 'Europe PMC Journal', 'Europe PMC Year',
        'Clinical Trials Total', 'Clinical Trials Interventional', 'Clinical Trials Max Phase', 'Clinical Trials Active Present', 'Clinical Trials Global Total',
        'Clinical Phase Breakdown', 'Clinical Top Conditions', 'Clinical Top Drugs', 'Clinical Sponsor Breakdown', 'Clinical Flags',
        'OT Pathway 1', 'OT Pathway 2', 'OT Pathway 3', 'OT Pathway 4', 'OT Pathway 5',
        'Enriched Pathway 1', 'Enriched Pathway 1 Source', 'Enriched Pathway 1 Adjusted P',
        'Enriched Pathway 2', 'Enriched Pathway 2 Source', 'Enriched Pathway 2 Adjusted P',
        'Enriched Pathway 3', 'Enriched Pathway 3 Source', 'Enriched Pathway 3 Adjusted P',
        'Enriched Pathway 4', 'Enriched Pathway 4 Source', 'Enriched Pathway 4 Adjusted P',
        'Enriched Pathway 5', 'Enriched Pathway 5 Source', 'Enriched Pathway 5 Adjusted P',
        'TAU Tissue', 'TAU Single Cell', 'Bimodality Max Score', 'Bimodality Max Tissue',
        ...BIMODALITY_TISSUES.map(tissue => `Bimodality ${tissue}`),
        'ChEMBL Druggability Label', 'ChEMBL Druggability Score', 'ChEMBL Target ID', 'ChEMBL Error',
        'ChEMBL Small Molecule', 'ChEMBL Antibody', 'ChEMBL PROTAC', 'ChEMBL Modality Confidence',
        'ChEMBL Best Compound ID', 'ChEMBL Best IC50 nM', 'ChEMBL Best pChEMBL', 'ChEMBL Best Assay', 'ChEMBL Best Document Year',
        'ChEMBL Total Compounds', 'ChEMBL Target Max Phase', 'ChEMBL Target Drug Count',
        'ChEMBL Top Indication', 'ChEMBL Top Indication Max Phase', 'ChEMBL Top Indication Trials', 'ChEMBL All Indications',
      ];

      const rows: string[][] = [];
      const BATCH = 4;
      let done = 0;

      for (let i = 0; i < genes.length; i += BATCH) {
        const batch = genes.slice(i, i + BATCH);
        updateProgress(done, genes.length, 'Fetching drill-down and ChEMBL metrics');
        const batchResults = await Promise.all(batch.map(async (target) => {
          const [drillDown, chembl] = await Promise.all([
            target.drillDown ? Promise.resolve(target.drillDown) : api.getDrillDownData(target.symbol, disease).catch(() => undefined),
            getChEMBLDruggability(target.symbol).catch(() => null),
          ]);
          return { target: { ...target, drillDown }, drillDown, chembl };
        }));

        for (const { target, drillDown, chembl } of batchResults) {
          const enriched = enrichedByGene(target.symbol);
          const bimodality = target.bimodalityScores as Record<string, any> | undefined;
          const topPaper = drillDown?.top_papers?.[0];
          const indication = chembl?.drugIndications?.[0];
          const pathway = (idx: number) => cell(target.pathways?.[idx]?.label);
          const enrichedTriplet = (idx: number) => [
            cell(enriched[idx]?.term),
            cell(enriched[idx]?.source),
            enriched[idx] ? enriched[idx].adjustedPValue.toExponential(3) : '',
          ];

          rows.push([
            String(rows.length + 1), cell(target.source ?? 'OT'), cell(target.id), cell(target.symbol), cell(target.name),
            num(target.overallScore), num(target.getScore), num(target.geneticScore), num(target.combinedExpression ?? target.expressionScore), num(target.targetScore), num(target.literatureScore), num(target.priorityScore), num(target.finalScore),
            num(target.rpScore ?? researchState.rpScores?.[target.symbol]), num(target.winnerScore ?? researchState.winnerScores?.[target.symbol]), num(target.winnerRawScore ?? researchState.winnerRawScores?.[target.symbol]),
            cell(target.pubTatorTotalPapers), cell(target.pubTatorRecentPapers), num(target.pubTatorVelocity, 2),
            cell(drillDown?.total_signals), cell(drillDown?.recent_signals), cell(drillDown?.signal_velocity), cell(topPaper?.title), cell(topPaper?.id),
            cell(drillDown?.paper_count), cell(drillDown?.recent_paper_count), cell(drillDown?.epmc_velocity), cell(drillDown?.latest_publication_date), cell(drillDown?.epmc_top_paper), cell(drillDown?.epmc_journal), cell(drillDown?.epmc_year),
            cell(drillDown?.trial_count), cell(drillDown?.interventional_count), cell(drillDown?.max_phase), bool(drillDown?.active_trial_present), cell(drillDown?.total_trials_globally),
            json(drillDown?.phase_breakdown), list(drillDown?.top_conditions), list(drillDown?.top_drugs), json(drillDown?.sponsor_breakdown), (target.clinical_flags ?? drillDown?.clinical_flags ?? []).join('; '),
            pathway(0), pathway(1), pathway(2), pathway(3), pathway(4),
            ...enrichedTriplet(0), ...enrichedTriplet(1), ...enrichedTriplet(2), ...enrichedTriplet(3), ...enrichedTriplet(4),
            num(target.tauTissue), num(target.tauSingleCell), num(bimodality?._max_score), cell(bimodality?._max_tissue),
            ...BIMODALITY_TISSUES.map(tissue => num(bimodality?.[tissue])),
            cell(chembl?.label), num(chembl?.druggabilityScore, 3), cell(chembl?.targetChemblId), cell(chembl?.error),
            bool(chembl?.modalities.smallMolecule), bool(chembl?.modalities.antibody), bool(chembl?.modalities.protac), cell(chembl?.modalities.confidence),
            cell(chembl?.bestCompound?.moleculeChemblId), num(chembl?.bestCompound?.ic50Nm, 2), num(chembl?.bestCompound?.pchemblValue, 2), cell(chembl?.bestCompound?.assayDescription), cell(chembl?.bestCompound?.documentYear),
            cell(chembl?.totalCompounds), cell(chembl?.targetMaxPhase), cell(chembl?.targetDrugCount),
            cell(indication?.diseaseName), cell(indication?.maxPhase), indication?.clinicalTrialIds?.join('; ') ?? '', chembl?.drugIndications?.map(ind => `${ind.diseaseName} (phase ${ind.maxPhase})`).join('; ') ?? '',
          ]);
          done++;
        }

        updateProgress(done, genes.length, 'Fetching drill-down and ChEMBL metrics');
        if (i + BATCH < genes.length) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }

      updateProgress(done, genes.length, 'Preparing CSV file');
      const csv = [headers.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      await saveBlob(blob, `All_Metrics_${disease.replace(/\s+/g, '_')}_top${genes.length}.csv`);
    } catch (err) {
      logDev('All metrics export failed:', err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExporting(false);
      setAllMetricsProgress(null);
    }
  };
  const exportToDocx = async () => {
    if (!displayTargets.length) {
      alert("No data to export. Please search for a disease first.");
      return;
    }
    setIsExporting(true);
    try {
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType } = await import('docx');
      const diseaseName = researchState.activeDisease?.name || 'Unknown Disease';
      const { headers, rows } = getExportRows();

      // Column widths: Gene+Name get more space, scores share evenly
      const TOTAL_DXA = 9360; // US Letter content width (8.5" - 2" margins)
      const fixedW = Math.round(TOTAL_DXA * 0.18);
      const scoreW = Math.round((TOTAL_DXA - fixedW * 2) / Math.max(headers.length - 2, 1));
      const colWidths = [fixedW, fixedW, ...Array(headers.length - 2).fill(scoreW)];

      const headerBorder = { style: BorderStyle.SINGLE, size: 2, color: '2563EB' } as const;
      const cellBorder   = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } as const;
      const allBorders   = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

      const makeCell = (text: string, colIdx: number, isHeader = false) => new TableCell({
        width: { size: colWidths[colIdx] ?? scoreW, type: WidthType.DXA },
        borders: isHeader ? { top: headerBorder, bottom: headerBorder, left: headerBorder, right: headerBorder } : allBorders,
        shading: isHeader ? { fill: 'EFF6FF', type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text, bold: isHeader, size: isHeader ? 18 : 16, font: 'Arial' })],
        })],
      });

      const doc = new Document({
        sections: [{
          properties: {
            page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
          },
          children: [
            new Paragraph({
              children: [new TextRun({ text: `Target Prioritization Report: ${diseaseName}`, bold: true, size: 36, font: 'Arial' })],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString()} · Targets: ${rows.length} · Columns: ${headers.join(', ')}`, size: 18, color: '6B7280', font: 'Arial' })],
              spacing: { after: 400 },
            }),
            new Table({
              width: { size: TOTAL_DXA, type: WidthType.DXA },
              columnWidths: colWidths,
              rows: [
                new TableRow({ children: headers.map((h, i) => makeCell(h, i, true)), tableHeader: true }),
                ...rows.map(r => new TableRow({ children: r.map((cell, i) => makeCell(cell, i, false)) })),
              ],
            }),
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      await saveBlob(blob, `Target_Prioritization_${diseaseName.replace(/\s+/g, '_')}.docx`);
    } catch (err) {
      logDev("DOCX Export Error:", err);
      alert(`Export error: ${err}`);
    } finally {
      setIsExporting(false);
    }
  };

  const activeCancerType = useMemo(() => {
    if (!researchState.activeDisease) return null;
    return detectCancerType(researchState.activeDisease.name);
  }, [researchState.activeDisease]);
  
  const displayTargets = useMemo(() => {
    let result = researchState.targets.map(t => {
      const newUsefulness = { ...(t.usefulness || {}) };
      researchState.globalHiddenMetrics?.forEach(m => {
        newUsefulness[m] = 'not-useful';
      });
      return { ...t, usefulness: newUsefulness };
    });


    // Apply filters
    if (researchState.filters && researchState.filters.length > 0) {
      const fieldMapping: Record<string, string> = {
        'gene': 'symbol',
        'gene_name': 'name',
        'genetic_score': 'geneticScore',
        'literature_score': 'literatureScore',
        'get_score': 'getScore',
        'expression_score': 'combinedExpression',
        'target_score': 'targetScore',
        'overall_score': 'overallScore',
        'priority_score': 'priorityScore'
      };
      const phaseMap: Record<string, number> = { 'N/A': 0, 'EARLY_PHASE1': 1, 'PHASE1': 2, 'PHASE2': 3, 'PHASE3': 4, 'PHASE4': 5 };

      const drillDownFields = ['paper_count', 'recent_paper_count', 'latest_publication_date', 'total_signals', 'recent_signals', 'signal_velocity', 'clinical_flags'];

      result = result.filter(t => {
        return researchState.filters.every(f => {
          let val: any;
          const internalField = fieldMapping[f.field] || f.field;
          if (drillDownFields.includes(f.field)) {
            if (f.field === 'clinical_flags') {
              val = t.clinical_flags || [];
            } else {
              val = (t.drillDown as any)?.[f.field];
            }
            if (f.field === 'max_phase') val = phaseMap[val || 'N/A'];
            if (f.field === 'signal_velocity' && typeof val === 'string') val = parseFloat(val.replace('%', ''));
          } else {
            val = (t as any)[internalField];
          }
          
          if (val === undefined) return false;

          if (f.field === 'clinical_flags') {
            if (f.operator === 'contains') return val.includes(f.stringValue);
            if (f.operator === 'not_contains') return !val.includes(f.stringValue);
            return true;
          }

          if (f.field === 'latest_publication_date' && typeof val === 'string' && f.value) {
            const valYear = parseInt(val.substring(0, 4));
            if (!isNaN(valYear)) {
              if (f.operator === '>') return valYear > f.value;
              if (f.operator === '<') return valYear < f.value;
              if (f.operator === '>=') return valYear >= f.value;
              if (f.operator === '<=') return valYear <= f.value;
              if (f.operator === '=') return valYear === f.value;
              if (f.operator === '!=') return valYear !== f.value;
            }
          }

          const compareValue = f.boolValue !== undefined ? f.boolValue : (f.stringValue !== undefined ? f.stringValue : f.value);

          if (f.operator === '>') return val > compareValue;
          if (f.operator === '<') return val < compareValue;
          if (f.operator === '>=') return val >= compareValue;
          if (f.operator === '<=') return val <= compareValue;
          if (f.operator === '=') return val === compareValue;
          if (f.operator === '!=') return val !== compareValue;
          if (f.operator === 'between') return val >= (f.value || 0) && val <= (f.value2 || 0);
          return true;
        });
      });
    }

    // Apply sorts
    result.sort((a, b) => {
      // Primary sort: Pinned targets first
      const aPinned = Object.values(a.usefulness || {}).some(v => v === 'pinned');
      const bPinned = Object.values(b.usefulness || {}).some(v => v === 'pinned');
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      if (researchState.sorts && researchState.sorts.length > 0) {
        const fieldMapping: Record<string, string> = {
          'genetic_score': 'geneticScore',
          'literature_score': 'literatureScore',
          'get_score': 'getScore',
          'expression_score': 'combinedExpression',
          'target_score': 'targetScore',
          'overall_score': 'overallScore',
          'priority_score': 'priorityScore'
        };
        const phaseMap: Record<string, number> = { 'N/A': 0, 'EARLY_PHASE1': 1, 'PHASE1': 2, 'PHASE2': 3, 'PHASE3': 4, 'PHASE4': 5 };

        const drillDownFields = ['paper_count', 'recent_paper_count', 'latest_publication_date', 'total_signals', 'recent_signals', 'signal_velocity'];

        for (const s of researchState.sorts) {
          const internalField = fieldMapping[s.field] || s.field;
          let valA = (a as any)[internalField];
          let valB = (b as any)[internalField];
          if (drillDownFields.includes(s.field)) {
            valA = (a.drillDown as any)?.[s.field] || 0;
            valB = (b.drillDown as any)?.[s.field] || 0;
            if (s.field === 'signal_velocity') {
              valA = typeof valA === 'string' ? parseFloat(valA.replace('%', '')) : (valA || 0);
              valB = typeof valB === 'string' ? parseFloat(valB.replace('%', '')) : (valB || 0);
            }
          }
          if (valA !== valB) {
            if (typeof valA === 'number' && typeof valB === 'number') {
              return s.direction === 'desc' ? valB - valA : valA - valB;
            }
            // Fallback for strings
            const strA = String(valA);
            const strB = String(valB);
            return s.direction === 'desc' ? strB.localeCompare(strA) : strA.localeCompare(strB);
          }
        }
      }

      // Default fallback sort: overallScore desc
      return b.overallScore - a.overallScore;
    });

    // Apply column sort from table header clicks
    if (tableSort) {
      result = [...result].sort((a, b) => {
        let av: any, bv: any;
        if (tableSort.key === 'bimodality__max') {
          av = a.bimodalityScores?._max_score ?? -Infinity;
          bv = b.bimodalityScores?._max_score ?? -Infinity;
        } else if (tableSort.key.startsWith('bimodality__')) {
          const tissue = tableSort.key.slice('bimodality__'.length);
          av = a.bimodalityScores?.[tissue] ?? -Infinity;
          bv = b.bimodalityScores?.[tissue] ?? -Infinity;
        } else {
          av = (a as any)[tableSort.key] ?? -Infinity;
          bv = (b as any)[tableSort.key] ?? -Infinity;
        }
        if (typeof av === 'number' && typeof bv === 'number')
          return tableSort.dir === 'desc' ? bv - av : av - bv;
        return tableSort.dir === 'desc'
          ? String(bv).localeCompare(String(av))
          : String(av).localeCompare(String(bv));
      });
    }

    // Apply sidebar score range filters
    result = result.filter(t =>
      Object.entries(scoreRangeFilter).every(([key, [min, max]]) => {
        if (min === 0 && max === 1) return true;
        const val: number = (t as any)[key] ?? -1;
        return val >= min && val <= max;
      })
    );

    // Apply sidebar ranking range filters (rwr → rpScore, winner → winnerScore)
    const rankKeyMap: Record<string, string> = { rwr: 'rpScore', winner: 'winnerScore' };
    result = result.filter(t =>
      Object.entries(rankRangeFilter).every(([key, [min, max]]) => {
        if (min === 0 && max === 1) return true;
        const field = rankKeyMap[key] ?? key;
        const val: number = (t as any)[field] ?? -1;
        return val >= min && val <= max;
      })
    );

    return result;
  }, [researchState.targets, researchState.filters, researchState.sorts, scoreRangeFilter, rankRangeFilter, tableSort]);


  // Background TAU enrichment — runs after genes load, does NOT block initial render
  useEffect(() => {
    if (!researchState.targets.length) return;
    const targetsNeedingTau = researchState.targets.filter(t => t.tauTissue === undefined);
    if (!targetsNeedingTau.length) return;
    // Clone so mutations inside enrichTau land on the clones, then we flush them back
    const clones = researchState.targets.map(t => ({ ...t }));
    api.enrichTau(clones).then(() => {
      setResearchState(prev => ({
        ...prev,
        targets: prev.targets.map(t => {
          const enriched = clones.find(c => c.id === t.id);
          return enriched ? { ...t, tauTissue: enriched.tauTissue, tauSingleCell: enriched.tauSingleCell } : t;
        }),
      }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchState.targets.length]);

  // Lazy-load bimodality.json once, then patch targets — non-blocking
  useEffect(() => {
    if (!researchState.targets.length) return;
    if (bimodalityLoading.current) return;
    if (bimodalityCache.current) {
      // Already loaded — just patch any targets that don't have scores yet
      const lookup = bimodalityCache.current;
      setResearchState(prev => ({
        ...prev,
        targets: prev.targets.map(t =>
          t.bimodalityScores ? t : { ...t, bimodalityScores: lookup[t.id] ?? {} }
        ),
      }));
      return;
    }
    bimodalityLoading.current = true;
    fetch('/bimodality.json')
      .then(r => r.json())
      .then((lookup: Record<string, Record<string, number>>) => {
        bimodalityCache.current = lookup;
        bimodalityLoading.current = false;
        setResearchState(prev => ({
          ...prev,
          targets: prev.targets.map(t => ({
            ...t,
            bimodalityScores: lookup[t.id] ?? {},
          })),
        }));
      })
      .catch(() => { bimodalityLoading.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchState.targets.length]);


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

  const calculatePriorityScores = (targets: Target[], weights: GETWeights): Target[] => {
    return targets.map(t => {
      const g = t.geneticScore || 0;
      const e = t.combinedExpression || t.expressionScore || 0;
      const tr = t.targetScore || 0;

      // GET = wG·G + wE·E + wT·T  — uses admin-saved weights from Supabase
      const wG = weights.genetic   ?? 0.45;
      const wE = weights.expression ?? 0.25;
      const wT = weights.target     ?? 0.30;
      const getScore = (g * wG) + (e * wE) + (tr * wT);
      const overallScore = getScore;

      const clinical_flags: string[] = [];
      if (t.drillDown) {
        const dd = t.drillDown;
        const interventional = dd.interventional_count || 0;
        const total_trials_globally = dd.total_trials_globally || 0;
        const max_phase = dd.max_phase || 'N/A';

        if (t.geneticScore > 0.7 && interventional === 0) {
          clinical_flags.push("Strong genetic evidence but no interventional trials in this disease");
        }
        if (interventional === 0 && total_trials_globally > 10) {
          clinical_flags.push("Active clinical pipeline exists but not in this disease");
        }
        if (max_phase === 'PHASE4' || max_phase === 'PHASE3') {
          clinical_flags.push("Advanced clinical validation in this disease");
        }
        if (interventional > 0 && (max_phase === 'PHASE1' || max_phase === 'EARLY_PHASE1')) {
          clinical_flags.push("Clinical pursuit is early stage only");
        }
        if (t.targetScore === 1.0 && interventional === 0) {
          clinical_flags.push("Approved drug exists but no trials in this disease");
        }
      }

      return { ...t, getScore, overallScore, clinical_flags };
    });
  };

  // Re-score all loaded targets whenever the GET weights change (e.g. admin saves new weights,
  // or Supabase returns weights that differ from the defaults on mount).
  useEffect(() => {
    setResearchState(prev => {
      if (!prev.targets.length) return prev;
      return { ...prev, targets: calculatePriorityScores(prev.targets, prev.weights) };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchState.weights.genetic, researchState.weights.expression, researchState.weights.target]);

  const performRWR = async (genes: Target[], extraSymbols: string[] = []) => {
    if (genes.length === 0 && extraSymbols.length === 0) return genes;
    
    const top3Seeds = genes.length > 0 
      ? [...genes].sort((a, b) => (b.getScore || 0) - (a.getScore || 0)).slice(0, 3).map(g => g.symbol)
      : researchState.rwrSeeds || [];

    if (top3Seeds.length === 0) return genes;
    
    setResearchState(prev => ({ 
      ...prev, 
      rwrSeeds: top3Seeds, 
      rwrLoading: true, 
      rwrStatus: 'Fetching STRING network interactions...' 
    }));
    
    try {
      const allSymbols = Array.from(new Set([
        ...genes.map(g => g.symbol),
        ...extraSymbols,
        ...top3Seeds
      ]));

      const interactions = await api.getStringInteractions(allSymbols);
      
      if (interactions.length === 0) {
        setResearchState(prev => ({ ...prev, rwrLoading: false, rwrStatus: 'No STRING interactions found' }));
        return genes;
      }

      setResearchState(prev => ({ 
        ...prev, 
        rwrStatus: 'Running Random Walk with Restart...' 
      }));
      
      const rawScores = runRWR(allSymbols, interactions, top3Seeds);
      const winnerScoresMap = runWINNER(allSymbols, interactions);
      
      const maxRP = Math.max(...Object.values(rawScores), 1e-10);
      const normalizedScores: Record<string, number> = {};
      Object.entries(rawScores).forEach(([symbol, score]) => {
        normalizedScores[symbol] = score / maxRP;
      });

      const maxWinner = Math.max(...Object.values(winnerScoresMap), 1e-10);
      const normalizedWinner: Record<string, number> = {};
      Object.entries(winnerScoresMap).forEach(([symbol, score]) => {
        normalizedWinner[symbol] = score / maxWinner;
      });
      
      setResearchState(prev => {
        const updatedTargets = prev.targets.map(t => {
          const rp = normalizedScores[t.symbol];
          const winnerNorm = normalizedWinner[t.symbol] || 0;
          const winnerRaw = winnerScoresMap[t.symbol] || 0;
          const get = t.getScore || 0;
          
          if (rp === undefined && winnerNorm === 0) return t;

          const final = (get * 0.50) + ((rp || 0) * 0.25) + (winnerNorm * 0.25);
          return {
            ...t,
            rpScore: rp,
            winnerScore: winnerNorm,
            winnerRawScore: winnerRaw,
            finalScore: final,
            // overallScore kept as original OT score — prevents list re-sort when RWR completes
          };
        });

        return { 
          ...prev, 
          targets: updatedTargets,
          rpScores: { ...prev.rpScores, ...normalizedScores },
          winnerScores: { ...prev.winnerScores, ...normalizedWinner },
          winnerRawScores: { ...prev.winnerRawScores, ...winnerScoresMap },
          rwrLoading: false, 
          rwrStatus: 'Network analysis complete' 
        };
      });
      
      return genes;
    } catch (e) {
      logDev("RWR Pipeline failed:", e);
      setResearchState(prev => ({ ...prev, rwrLoading: false, rwrStatus: 'Network analysis failed' }));
      return genes;
    }
  };

  useEffect(() => {
    if (researchState.pubtatorResults && researchState.pubtatorResults.length > 0 && researchState.rwrSeeds?.length && !researchState.rwrLoading) {
      const litSymbols = researchState.pubtatorResults.map(r => r.gene);
      const unscored = litSymbols.filter(s => researchState.rpScores?.[s] === undefined);
      
      if (unscored.length > 0) {
        // Trigger network propagation including literature results
        performRWR(researchState.targets, litSymbols);
      }
    }
  }, [researchState.pubtatorResults, researchState.rwrSeeds, researchState.rpScores, researchState.rwrLoading]);

  const handleToolExecution = useCallback(async (name: string, args: any) => {
    setLoading(true);
    try {
      const fieldMapping: Record<string, string> = {
        'gene': 'symbol',
        'gene_name': 'name',
        'genetic_score': 'geneticScore',
        'literature_score': 'literatureScore',
        'get_score': 'getScore',
        'expression_score': 'combinedExpression',
        'target_score': 'targetScore',
        'overall_score': 'overallScore',
        'priority_score': 'priorityScore'
      };
      const phaseMap: Record<string, number> = { 'N/A': 0, 'EARLY_PHASE1': 1, 'PHASE1': 2, 'PHASE2': 3, 'PHASE3': 4, 'PHASE4': 5 };

      switch (name) {
        case 'search_diseases': {
          let opts = await api.searchDiseases(args.query);
          if (opts.length === 0) return `No records found for "${args.query}". Please try a more specific or standard clinical term.`;
          opts = opts.sort((a, b) => (b.score || 0) - (a.score || 0));
          const maxScore = opts[0]?.score || 1;
          const filteredOpts = opts.filter(o => (o.score || 0) / maxScore > 0.8).slice(0, 5);
          if (filteredOpts.length === 0 && opts.length > 0) filteredOpts.push(opts[0]);
          if (filteredOpts.length === 1) {
            const opt = filteredOpts[0];
            setLoadingMessage("Fetching top gene associations...");
            const genes = await api.getGenes(opt.id, OT_PAGE_SIZE, 0);
            
            const batchSize = 3;
            const updatedGenes = [...genes];
            for (let i = 0; i < updatedGenes.length; i += batchSize) {
              const batch = updatedGenes.slice(i, i + batchSize);
              const batchNum = Math.floor(i / batchSize) + 1;
              const totalBatches = Math.ceil(updatedGenes.length / batchSize);
              
              const messages = [
                "Analyzing clinical trial landscape...",
                "Calculating publication momentum...",
                "Building evidence profiles...",
                "Finalizing target intelligence...",
                "Synthesizing research data...",
                "Cross-referencing clinical signals...",
                "Evaluating therapeutic potential..."
              ];
              setLoadingMessage(`${messages[batchNum - 1] || "Processing evidence..."} (batch ${batchNum} of ${totalBatches})`);
              
              await Promise.all(batch.map(async (g, idx) => {
                const dd = await api.getDrillDownData(g.symbol, opt.name);
                updatedGenes[i + idx] = { ...g, drillDown: dd };
              }));

              if (i + batchSize < updatedGenes.length) {
                await new Promise(resolve => setTimeout(resolve, 800));
              }
            }
            
            setLoadingMessage("Ranking targets by composite evidence...");
            const finalGenes = calculatePriorityScores(updatedGenes, researchState.weights);

            // ── Show genes immediately — don't block on enrichment or literature ──
            setResearchState(prev => ({
              ...prev,
              targets: finalGenes,
              activeDisease: opt,
              focusSymbol: null,
              currentPage: 0,
            }));

            // Load enrichment + literature in parallel, update state when ready
            const [enr, litData] = await Promise.allSettled([
              api.getEnrichment(finalGenes.map(g => g.symbol)),
              api.getPubTatorLiterature(opt.name),
            ]);
            const resolvedEnr = enr.status === 'fulfilled' ? enr.value : [];
            const resolvedLit = litData.status === 'fulfilled' ? litData.value : { results: [], pool: [] };

            setResearchState(prev => ({
              ...prev,
              enrichment: resolvedEnr,
              pubtatorResults: resolvedLit.results,
              pubtatorGenePool: resolvedLit.pool,
              pubtatorPage: 1,
              isFetchingPubTator: false,
            }));

            // Trigger RWR extension asynchronously but track it
            performRWR(finalGenes, resolvedLit.results.map((r: any) => r.gene));

            return `Project set to ${opt.name}. Molecular evidence mapped with composite scoring. Network analysis initiated.`;
          }
          return { content: `I found several standard matches. Please refine your clinical focus:`, options: filteredOpts };
        }
        case 'get_genes': {
          setLoadingMessage("Fetching top gene associations...");
          const genes = await api.getGenes(args.id, OT_PAGE_SIZE, 0);
          
          const batchSize = 3;
          const updatedGenes = [...genes];
          for (let i = 0; i < updatedGenes.length; i += batchSize) {
            const batch = updatedGenes.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(updatedGenes.length / batchSize);
            
            const messages = [
              "Analyzing clinical trial landscape...",
              "Calculating publication momentum...",
              "Building evidence profiles...",
              "Finalizing target intelligence...",
              "Synthesizing research data...",
              "Cross-referencing clinical signals...",
              "Evaluating therapeutic potential..."
            ];
            setLoadingMessage(`${messages[batchNum - 1] || "Processing evidence..."} (batch ${batchNum} of ${totalBatches})`);
            
            await Promise.all(batch.map(async (g, idx) => {
              const dd = await api.getDrillDownData(g.symbol, args.name);
              updatedGenes[i + idx] = { ...g, drillDown: dd };
            }));

            if (i + batchSize < updatedGenes.length) {
              await new Promise(resolve => setTimeout(resolve, 800));
            }
          }
          
          setLoadingMessage("Ranking targets by composite evidence...");
          const finalGenes = calculatePriorityScores(updatedGenes, researchState.weights);

          // ── Show genes immediately — don't block on enrichment or literature ──
          setResearchState(prev => ({
            ...prev,
            targets: finalGenes,
            activeDisease: { id: args.id, name: args.name },
            focusSymbol: null,
            currentPage: 0,
          }));

          // Load enrichment + literature in parallel, update state when ready
          const [enr2, litData2] = await Promise.allSettled([
            api.getEnrichment(finalGenes.map(g => g.symbol)),
            api.getPubTatorLiterature(args.name),
          ]);
          const resolvedEnr2 = enr2.status === 'fulfilled' ? enr2.value : [];
          const resolvedLit2 = litData2.status === 'fulfilled' ? litData2.value : { results: [], pool: [] };

          setResearchState(prev => ({
            ...prev,
            enrichment: resolvedEnr2,
            pubtatorResults: resolvedLit2.results,
            pubtatorGenePool: resolvedLit2.pool,
            pubtatorPage: 1,
            isFetchingPubTator: false,
          }));

          // Trigger RWR extension
          performRWR(finalGenes, resolvedLit2.results.map((r: any) => r.gene));

          return `Target prioritization complete for ${args.name} with composite scoring. Network analysis initiated.`;
        }
        case 'get_target_list': {
          if (displayTargets.length === 0) return "Target list is currently empty or no genes match the current filters.";
          const list = displayTargets.slice(0, args.limit || 50).map(t => ({
            symbol: t.symbol,
            name: t.name,
            overall_score: t.overallScore.toFixed(3),
            get_score: t.getScore?.toFixed(3) || 'N/A',
            genetic_score: t.geneticScore.toFixed(3)
          }));
          return `Current target list (${list.length} genes shown):\n` + list.map(t => `- **${t.symbol}**: ${t.name} (GET: ${t.get_score}, Overall: ${t.overall_score})`).join('\n');
        }
        case 'get_target_details': {
          const symbol = args.symbol;
          let target = researchState.targets.find(t => t.symbol === symbol);
          if (!target) return `Target ${symbol} not found in current list.`;
          if (!target.drillDown) {
            const data = await api.getDrillDownData(symbol, researchState.activeDisease?.name || '');
            const updatedTargets = calculatePriorityScores(researchState.targets.map(t => t.symbol === symbol ? { ...t, drillDown: data } : t), researchState.weights);
            setResearchState(prev => ({
              ...prev,
              targets: updatedTargets
            }));
            target = updatedTargets.find(t => t.symbol === symbol)!;
          }
          return `### Detailed Evidence for ${symbol} (${target.name})\n` +
            `- **Priority Score**: ${target.priorityScore?.toFixed(4)}\n` +
            `- **Genetic Score**: ${target.geneticScore.toFixed(4)}\n` +
            `- **Clinical Flags**: ${target.clinical_flags?.join(', ') || 'None'}\n` +
            `- **Paper Count**: ${target.drillDown?.paper_count}\n` +
            `- **Recent Papers**: ${target.drillDown?.recent_paper_count}\n` +
            `- **Latest Publication**: ${target.drillDown?.latest_publication_date}\n\n`;
        }
        case 'get_active_filters': {
          const filters = researchState.filters.map(f => `${f.field} ${f.operator} ${f.boolValue !== undefined ? f.boolValue : (f.stringValue !== undefined ? f.stringValue : f.value)}`).join(', ');
          const sorts = researchState.sorts.map(s => `${s.field} (${s.direction})`).join(', ');
          return `Active Filters: ${filters || 'None'}\nActive Sorts: ${sorts || 'None'}\nTotal matching genes: ${displayTargets.length}`;
        }
        case 'apply_filters': {
          const drillDownFields = ['paper_count', 'recent_paper_count', 'latest_publication_date', 'total_signals', 'recent_signals', 'signal_velocity', 'clinical_flags'];
          const needsDrillDown = args.conditions.some((c: any) => 
            drillDownFields.includes(c.field)
          );
          if (needsDrillDown) {
            const targetsToFetch = researchState.targets.filter(t => !t.drillDown);
            if (targetsToFetch.length > 0) {
              const results = await Promise.all(targetsToFetch.map(t => api.getDrillDownData(t.symbol, researchState.activeDisease?.name || '')));
              const updatedTargets = calculatePriorityScores(researchState.targets.map(t => {
                const idx = targetsToFetch.findIndex(tf => tf.symbol === t.symbol);
                return idx >= 0 ? { ...t, drillDown: results[idx] } : t;
              }), researchState.weights);
              setResearchState(prev => ({ ...prev, targets: updatedTargets, filters: [...prev.filters, ...args.conditions] }));
            } else {
              setResearchState(prev => ({ ...prev, filters: [...prev.filters, ...args.conditions] }));
            }
          } else {
            setResearchState(prev => ({ ...prev, filters: [...prev.filters, ...args.conditions] }));
          }
          return `Applied ${args.conditions.length} new filter(s). Total active filters: ${researchState.filters.length + args.conditions.length}.`;
        }
        case 'remove_filters': {
          if (args.all) {
            setResearchState(prev => ({ ...prev, filters: [] }));
            return "All filters removed.";
          }
          const remaining = researchState.filters.filter(f => !args.fields.includes(f.field));
          setResearchState(prev => ({ ...prev, filters: remaining }));
          return `Removed filters for: ${args.fields.join(', ')}. ${remaining.length} filters remain.`;
        }
        case 'replace_filters': {
          const updated = researchState.filters.filter(f => f.field !== args.old_field);
          setResearchState(prev => ({ ...prev, filters: [...updated, args.new_condition] }));
          return `Replaced filter on ${args.old_field} with new condition on ${args.new_condition.field}.`;
        }
        case 'reset_target_list_view': {
          setResearchState(prev => ({ ...prev, filters: [], sorts: [] }));
          return "Target list view reset. All filters and sorts cleared.";
        }
        case 'preview_filter_effect': {
          // Simulate filtering
          const phaseMap: Record<string, number> = { 'N/A': 0, 'EARLY_PHASE1': 1, 'PHASE1': 2, 'PHASE2': 3, 'PHASE3': 4, 'PHASE4': 5 };
          const drillDownFields = ['paper_count', 'recent_paper_count', 'latest_publication_date', 'total_signals', 'recent_signals', 'signal_velocity', 'clinical_flags'];
          const tempFiltered = displayTargets.filter(t => {
            let val: any;
            const internalField = fieldMapping[args.condition.field] || args.condition.field;
            if (drillDownFields.includes(args.condition.field)) {
              if (args.condition.field === 'clinical_flags') {
                val = t.clinical_flags || [];
              } else {
                val = (t.drillDown as any)?.[args.condition.field];
              }
              if (args.condition.field === 'max_phase') val = phaseMap[val || 'N/A'];
              if (args.condition.field === 'signal_velocity' && typeof val === 'string') val = parseFloat(val.replace('%', ''));
            } else {
              val = (t as any)[internalField];
            }
            if (val === undefined) return false;

            if (args.condition.field === 'clinical_flags') {
              if (args.condition.operator === 'contains') return val.includes(args.condition.stringValue);
              if (args.condition.operator === 'not_contains') return !val.includes(args.condition.stringValue);
              return true;
            }

            const compareValue = args.condition.boolValue !== undefined ? args.condition.boolValue : (args.condition.stringValue !== undefined ? args.condition.stringValue : args.condition.value);
            if (args.condition.operator === '>') return val > compareValue;
            if (args.condition.operator === '<') return val < compareValue;
            if (args.condition.operator === '=') return val === compareValue;
            return true;
          });
          return `Preview: Applying this filter would change the result set from ${displayTargets.length} to ${tempFiltered.length} genes.`;
        }
        case 'filter_targets': {
          // Legacy support: now updates state
          const drillDownFields = ['paper_count', 'recent_paper_count', 'latest_publication_date', 'total_signals', 'recent_signals', 'signal_velocity', 'clinical_flags'];
          const needsDrillDown = args.conditions.some((c: any) => 
            drillDownFields.includes(c.field)
          );
          if (needsDrillDown) {
            const targetsToFetch = researchState.targets.filter(t => !t.drillDown);
            if (targetsToFetch.length > 0) {
              const results = await Promise.all(targetsToFetch.map(t => api.getDrillDownData(t.symbol, researchState.activeDisease?.name || '')));
              const updatedTargets = calculatePriorityScores(researchState.targets.map(t => {
                const idx = targetsToFetch.findIndex(tf => tf.symbol === t.symbol);
                return idx >= 0 ? { ...t, drillDown: results[idx] } : t;
              }), researchState.weights);
              setResearchState(prev => ({ ...prev, targets: updatedTargets, filters: args.conditions }));
            } else {
              setResearchState(prev => ({ ...prev, filters: args.conditions }));
            }
          } else {
            setResearchState(prev => ({ ...prev, filters: args.conditions }));
          }
          return `Filters updated. ${args.conditions.length} conditions active.`;
        }
        case 'sort_targets': {
          setResearchState(prev => ({ ...prev, sorts: args.sorts }));
          return `Sort order updated: ${args.sorts.map((s: any) => `${s.field} (${s.direction})`).join(', ')}.`;
        }
        case 'compare_targets': {
          const targets = researchState.targets.filter(t => args.symbols.includes(t.symbol));
          if (targets.length === 0) return "None of the specified genes were found in the current list.";
          let table = `| Metric | ${targets.map(t => t.symbol).join(' | ')} |\n| --- | ${targets.map(() => '---').join(' | ')} |\n`;
          const scoreMetrics = ['overall_score', 'get_score', 'genetic_score', 'literature_score', 'expression_score', 'target_score'];
          scoreMetrics.forEach(m => {
            const internalField = fieldMapping[m] || m;
            table += `| ${m.replace(/_/g, ' ')} | ${targets.map(t => (t as any)[internalField]?.toFixed(3) || 'N/A').join(' | ')} |\n`;
          });
          
          const evidenceMetrics = [
            { label: 'Literature Count', field: 'total_signals' },
            { label: 'Recent Signals', field: 'recent_signals' },
            { label: 'Velocity (2y)', field: 'signal_velocity' }
          ];
          
          evidenceMetrics.forEach(m => {
            table += `| ${m.label} | ${targets.map(t => {
              const val = (t.drillDown as any)?.[m.field];
              if (val === undefined) return 'N/A';
              if (typeof val === 'boolean') return val ? 'Yes' : 'No';
              return val;
            }).join(' | ')} |\n`;
          });
          
          return `### Target Comparison\n\n${table}`;
        }
        case 'summarize_targets': {
          let set = displayTargets;
          if (args.target_set === 'filtered') {
             set = displayTargets;
          } else if (args.target_set === 'top_literature') {
            set = [...set].sort((a, b) => (b.literatureScore || 0) - (a.literatureScore || 0)).slice(0, 5);
          } else if (args.target_set === 'high_overall_low_target') {
            set = set.filter(t => t.overallScore > 0.5 && t.targetScore < 0.3).slice(0, 5);
          }
          
          return `### Summary: ${args.target_set.replace(/_/g, ' ')}\n` + 
            set.map(t => {
              let info = `- **${t.symbol}**: ${t.name}\n  - GET Score: ${t.getScore?.toFixed(3) || 'N/A'}\n  - Overall: ${t.overallScore.toFixed(3)}\n  - Literature: ${t.literatureScore?.toFixed(3) || 'N/A'}`;
              if (t.drillDown) {
                info += `\n  - Literature Count: ${t.drillDown.total_signals} (Velocity: ${t.drillDown.signal_velocity})`;
              }
              return info;
            }).join('\n');
        }
        case 'explain_target': {
          const t = researchState.targets.find(t => t.symbol === args.symbol);
          if (!t) return `Target ${args.symbol} not found.`;
          const w = researchState.weights;
          return `### Why is ${t.symbol} ranked this way?\n` +
            `- **GET Score (${t.getScore?.toFixed(3) || 'N/A'})**: Composite score calculated as:\n` +
            `  - **Baseline**: (Genetic × ${w.genetic}) + (Expression × ${w.expression}) + (Target_New × ${w.target})\n` +
            `  - **Final**: (Baseline × ${1 - w.velocity}) + (Velocity_Norm × ${w.velocity})\n` +
            `- **Genetic Evidence (${t.geneticScore.toFixed(3)})**: Strength of association from GWAS/V2G data.\n` +
            `- **Expression Score (${(t.combinedExpression || t.expressionScore || 0).toFixed(3)})**: Relevance in disease tissues.\n` +
            `- **Targetability (${t.targetScore.toFixed(3)})**: Assessment of how "druggable" the protein is, now enhanced with clinical trial signals.`;
        }
        case 'rank_targets': {
          const drillDownFields = ['paper_count', 'recent_paper_count', 'latest_publication_date', 'total_signals', 'recent_signals', 'signal_velocity'];
          const ranked = [...researchState.targets].sort((a, b) => {
            let scoreA = 0, scoreB = 0;
            args.priorities.forEach((p: any) => {
              const internalField = fieldMapping[p.field] || p.field;
              const weight = p.weight || 1;
              let valA = (a as any)[internalField] || 0;
              let valB = (b as any)[internalField] || 0;
              if (drillDownFields.includes(p.field)) {
                valA = (a.drillDown as any)?.[p.field] || 0;
                valB = (b.drillDown as any)?.[p.field] || 0;
                if (p.field === 'signal_velocity') {
                  valA = typeof valA === 'string' ? parseFloat(valA.replace('%', '')) : (valA || 0);
                  valB = typeof valB === 'string' ? parseFloat(valB.replace('%', '')) : (valB || 0);
                }
              }
              scoreA += valA * weight;
              scoreB += valB * weight;
            });
            return scoreB - scoreA;
          });
          setResearchState(prev => ({ ...prev, targets: ranked }));
          return `Re-ranked targets based on priorities: ${args.priorities.map((p: any) => p.field).join(', ')}. Top 5: ${ranked.slice(0, 5).map(r => r.symbol).join(', ')}.`;
        }
        case 'suggest_filters': {
          return { content: `Based on your query "${args.query}", here are some suggested filters:`, filterOptions: [
            { label: 'High GET Score', scoreType: 'getScore', threshold: 0.6, operator: 'gt' as const },
            { label: 'Strong Genetic Support', scoreType: 'geneticScore', threshold: 0.7, operator: 'gt' as const }
          ]};
        }
        case 'update_view': { 
          setViewMode(args.mode); 
          setResearchState(p => ({ ...p, focusSymbol: null })); 
          return `Visualization focus shifted to ${args.mode}.`; 
        }
        case 'load_more': {
          if (!researchState.activeDisease) return "No active condition to load more data for.";
          const nextPage = researchState.currentPage + 1;
          setLoadingMessage(`Fetching next ${OT_PAGE_SIZE} gene associations...`);
          const newGenes = await api.getGenes(researchState.activeDisease.id, OT_PAGE_SIZE, nextPage);
          if (newGenes.length === 0) return "No more additional evidence found for this condition.";
          
          const batchSize = 3;
          const updatedNewGenes = [...newGenes];
          for (let i = 0; i < updatedNewGenes.length; i += batchSize) {
            const batch = updatedNewGenes.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(updatedNewGenes.length / batchSize);
            
            setLoadingMessage(`Analyzing clinical evidence for new targets... (batch ${batchNum} of ${totalBatches})`);
            
            await Promise.all(batch.map(async (g, idx) => {
              const dd = await api.getDrillDownData(g.symbol, researchState.activeDisease!.name);
              updatedNewGenes[i + idx] = { ...g, drillDown: dd };
            }));

            if (i + batchSize < updatedNewGenes.length) {
              await new Promise(resolve => setTimeout(resolve, 800));
            }
          }
          
          setLoadingMessage("Recalculating composite scores for all targets...");
          const allTargets = [...researchState.targets, ...updatedNewGenes];
          const finalTargets = calculatePriorityScores(allTargets, researchState.weights);
          
          const enr = await api.getEnrichment(finalTargets.map(g => g.symbol));
          setResearchState(prev => ({
            ...prev,
            targets: finalTargets,
            enrichment: enr,
            currentPage: nextPage
          }));
          
          // BUG FIX: Recalculate RP and WINNER for the new batch
          performRWR(finalTargets, researchState.pubtatorResults?.map(r => r.gene) || []);

          return `Loaded ${updatedNewGenes.length} more targets for ${researchState.activeDisease.name}.`;
        }
        default: return "Acknowledged.";
      }
    } catch (err) { return "Operation error."; } finally { setLoading(false); }
  }, [researchState.activeDisease, researchState.currentPage, researchState.targets]);

  const handleTerminalCommand = (input: string): string | null => {
    const cmd = input.toLowerCase().trim();
    
    if (cmd.startsWith('set weights ')) {
      const parts = cmd.replace('set weights ', '').split(' ');
      const newWeights = { ...researchState.weights };
      parts.forEach(p => {
        const [key, val] = p.split('=');
        const num = parseFloat(val);
        if (!isNaN(num)) {
          if (key === 'g') newWeights.genetic = num;
          if (key === 'e') newWeights.expression = num;
          if (key === 't') newWeights.target = num;
          if (key === 'v') newWeights.velocity = num;
        }
      });
      
      const updatedTargets = calculatePriorityScores(researchState.targets, newWeights);
      setResearchState(prev => ({ ...prev, weights: newWeights, targets: updatedTargets }));
      
      return `GET weights updated: Genetic ${(newWeights.genetic * 100).toFixed(0)}%, Expression ${(newWeights.expression * 100).toFixed(0)}%, Target ${(newWeights.target * 100).toFixed(0)}%. Recalculating scores for ${updatedTargets.length} genes...`;
    }
    
    if (cmd === 'weights reset') {
      const defaultWeights = { genetic: 0.45, expression: 0.25, target: 0.30, velocity: 0.15 };
      const updatedTargets = calculatePriorityScores(researchState.targets, defaultWeights);
      setResearchState(prev => ({ ...prev, weights: defaultWeights, targets: updatedTargets }));
      return "Weights reset to disease defaults. Recalculating scores...";
    }
    
    if (cmd.startsWith('weights preset ')) {
      const preset = cmd.replace('weights preset ', '');
      let weights = { genetic: 0.45, expression: 0.25, target: 0.30, velocity: 0.15 };
      if (preset === 'alzheimers') {
        weights = { genetic: 0.60, expression: 0.15, target: 0.25, velocity: 0.10 };
      } else if (preset === 'cancer') {
        weights = { genetic: 0.30, expression: 0.50, target: 0.20, velocity: 0.20 };
      }
      const updatedTargets = calculatePriorityScores(researchState.targets, weights);
      setResearchState(prev => ({ ...prev, weights, targets: updatedTargets }));
      return `Applied ${preset} preset. Recalculating scores...`;
    }
    
    if (cmd === 'explain weights') {
      const w = researchState.weights;
      return `### Current GET Weights\n` +
             `- **Genetic (G)**: ${(w.genetic * 100).toFixed(0)}% - Strength of association from GWAS/V2G data.\n` +
             `- **Expression (E)**: ${(w.expression * 100).toFixed(0)}% - Relevance of gene expression in disease tissues.\n` +
             `- **Target (T)**: ${(w.target * 100).toFixed(0)}% - Tractability and clinical trial signal.\n` +
             `- **Velocity (V)**: ${(w.velocity * 100).toFixed(0)}% - Momentum of recent publications.\n\n` +
             `Rationale: Defaults prioritize genetic evidence (45%) as the most reliable indicator of causal involvement, followed by targetability (30%) and expression (25%).`;
    }
    
    return null;
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault(); if (!chatInput.trim() || isChatting) return;
    
    const terminalResponse = handleTerminalCommand(chatInput);
    if (terminalResponse) {
      const userMsg: Message = { role: 'user', content: chatInput, timestamp: new Date() };
      const assistantMsg: Message = { role: 'assistant', content: terminalResponse, timestamp: new Date() };
      setMessages(prev => [...prev, userMsg, assistantMsg]);
      setChatInput("");
      return;
    }

    const userMsg: Message = { role: 'user', content: chatInput, timestamp: new Date() };
    const currentMessages = [...messages, userMsg];
    setMessages(currentMessages); setChatInput(""); setIsChatting(true);
    
    try {
      const tools = [
        { name: 'search_diseases', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] } },
        { name: 'get_genes', parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, name: { type: Type.STRING } }, required: ['id', 'name'] } },
        { name: 'load_more', parameters: { type: Type.OBJECT, properties: {}, required: [] } },
        { name: 'update_view', parameters: { type: Type.OBJECT, properties: { mode: { type: Type.STRING, enum: ['list', 'enrichment', 'raw', 'pubtator'] } }, required: ['mode'] } },
        { name: 'get_target_list', parameters: { type: Type.OBJECT, properties: { limit: { type: Type.NUMBER } } } },
        { name: 'get_active_filters', parameters: { type: Type.OBJECT, properties: {} } },
        { name: 'apply_filters', parameters: { type: Type.OBJECT, properties: { conditions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { field: { type: Type.STRING }, operator: { type: Type.STRING, enum: ['>', '<', '>=', '<=', '=', '!=', 'between', 'contains', 'not_contains'] }, value: { type: Type.NUMBER }, value2: { type: Type.NUMBER }, boolValue: { type: Type.BOOLEAN }, stringValue: { type: Type.STRING } }, required: ['field', 'operator'] } }, logic: { type: Type.STRING, enum: ['AND', 'OR'] } }, required: ['conditions'] } },
        { name: 'remove_filters', parameters: { type: Type.OBJECT, properties: { fields: { type: Type.ARRAY, items: { type: Type.STRING } }, all: { type: Type.BOOLEAN } } } },
        { name: 'replace_filters', parameters: { type: Type.OBJECT, properties: { old_field: { type: Type.STRING }, new_condition: { type: Type.OBJECT, properties: { field: { type: Type.STRING }, operator: { type: Type.STRING }, value: { type: Type.NUMBER }, boolValue: { type: Type.BOOLEAN }, stringValue: { type: Type.STRING } } } }, required: ['old_field', 'new_condition'] } },
        { name: 'reset_target_list_view', parameters: { type: Type.OBJECT, properties: {} } },
        { name: 'preview_filter_effect', parameters: { type: Type.OBJECT, properties: { condition: { type: Type.OBJECT, properties: { field: { type: Type.STRING }, operator: { type: Type.STRING }, value: { type: Type.NUMBER } } } }, required: ['condition'] } },
        { name: 'filter_targets', parameters: { type: Type.OBJECT, properties: { conditions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { field: { type: Type.STRING }, operator: { type: Type.STRING, enum: ['>', '<', '>=', '<=', '=', '!=', 'between', 'contains', 'not_contains'] }, value: { type: Type.NUMBER }, value2: { type: Type.NUMBER }, boolValue: { type: Type.BOOLEAN }, stringValue: { type: Type.STRING } }, required: ['field', 'operator'] } }, logic: { type: Type.STRING, enum: ['AND', 'OR'] } }, required: ['conditions'] } },
        { name: 'sort_targets', parameters: { type: Type.OBJECT, properties: { sorts: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { field: { type: Type.STRING }, direction: { type: Type.STRING, enum: ['asc', 'desc'] } }, required: ['field', 'direction'] } } }, required: ['sorts'] } },
        { name: 'compare_targets', parameters: { type: Type.OBJECT, properties: { symbols: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['symbols'] } },
        { name: 'summarize_targets', parameters: { type: Type.OBJECT, properties: { target_set: { type: Type.STRING, enum: ['current', 'filtered', 'top_literature', 'high_overall_low_target'] } }, required: ['target_set'] } },
        { name: 'explain_target', parameters: { type: Type.OBJECT, properties: { symbol: { type: Type.STRING } }, required: ['symbol'] } },
        { name: 'get_target_details', parameters: { type: Type.OBJECT, properties: { symbol: { type: Type.STRING } }, required: ['symbol'] } },
        { name: 'suggest_filters', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ['query'] } },
        { name: 'rank_targets', parameters: { type: Type.OBJECT, properties: { priorities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { field: { type: Type.STRING }, weight: { type: Type.NUMBER } }, required: ['field'] } } }, required: ['priorities'] } }
      ];

      const systemInstruction = `You are the DiseaseToTarget AI Assistant, an intelligent terminal for Target List exploration and literature discovery.

      Core Capabilities:
      - You operate on a Target List of genes associated with a disease.
      - You use MCP-style tools to filter, sort, compare, and explain targets.
      - You interpret natural-language requests into precise tool calls.
      - You manage a persistent filter state for the Target List.

      Filter State Management:
      - Maintain active filters across the session.
      - Use 'get_active_filters' to see what's currently applied.
      - Use 'apply_filters' to add new conditions to the existing set.
      - Use 'remove_filters' to clear specific fields or all filters.
      - Use 'replace_filters' to update an existing condition.
      - Use 'reset_target_list_view' to clear all filters and sorts.
      - Use 'preview_filter_effect' to show impact before applying.
      
      Fields Available:
      - Gene Info: gene (symbol), gene_name (name).
      - Scores (0.0 - 1.0): overall_score, get_score (50% Genetic, 25% Exp, 25% Target), genetic_score, literature_score, expression_score, target_score.
      - Evidence Metrics: 
        - Literature: paper_count (Europe PMC count), recent_paper_count (Europe PMC 3y), total_signals (Literature Count), recent_signals (Recent signals), signal_velocity (Velocity percentage), latest_publication_date (string/date).
        - Clinical Flags (array of strings): clinical_flags. Use operator 'contains' or 'not_contains' with stringValue.
          Possible flags:
          - "Strong genetic evidence but no interventional trials in this disease"
          - "Active clinical pipeline exists but not in this disease"
          - "Advanced clinical validation in this disease"
          - "Clinical pursuit is early stage only"
          - "Approved drug exists but no trials in this disease"
      
      Interpretation Rules:
      - Comparison: "greater than", "above", "more than" (>= or >); "less than", "below" (<= or <); "equal to" (=); "not equal to" (!=).
      - Literature: "recent papers" -> recent_paper_count; "Europe PMC papers" -> paper_count; "literature papers" -> paper_count.
      - Top/Bottom: Use 'sort_targets' followed by 'get_target_list' with a limit.
      - AND/OR: Use the 'logic' parameter in 'apply_filters' or 'filter_targets'.
      - Date: For "after 2023", use field 'latest_publication_date', operator '>', value 2023.
      
      Behavior:
      - When you call a tool, acknowledge it: "Tool called: [name]".
      - Return the filtered target list based on the user's request.
      - Mention the interpreted filter conditions clearly.
      - If no rows match, explain why and suggest a relaxed filter.
      - Use Open Targets scores for ranking backbone and drill-down metrics for specific evidence.
      - Do not ask unnecessary clarification questions.
      - Always work in the context of the current Target List and its active filters.`;

      const callAI = async (messages: Message[]) => {
        const res = await fetch('/api/ai/gemini-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, systemInstruction, tools }),
        });
        const data = await res.json();
        // Surface server-side errors (missing key, Gemini API errors) instead of silently returning empty
        if (!res.ok) throw new Error(data.error || `AI request failed (${res.status})`);
        return { text: data.text as string | undefined, functionCalls: data.functionCalls as any[] | undefined };
      };

      let response = await callAI(currentMessages);

      if (response.functionCalls?.length) {
        let currentHistory = [...currentMessages];
        
        for (const fc of response.functionCalls) {
          // Add tool call message to history and UI
          const toolCallMsg: Message = { 
            role: 'assistant', 
            content: `Tool called: ${fc.name}`, 
            timestamp: new Date(),
            toolCall: fc.name
          };
          setMessages(prev => [...prev, toolCallMsg]);
          currentHistory.push(toolCallMsg);

          const res = await handleToolExecution(fc.name, fc.args);
          const toolResMsg: Message = { 
            role: 'assistant', 
            content: typeof res === 'string' ? res : res.content, 
            options: typeof res === 'string' ? undefined : res.options,
            filterOptions: typeof res === 'string' ? undefined : res.filterOptions,
            timestamp: new Date() 
          };
          currentHistory.push(toolResMsg);
          setMessages(prev => [...prev, toolResMsg]);
        }

        // Always do a second pass if tools were called to provide a natural response
        const secondResponse = await callAI(currentHistory);
        
        if (secondResponse.text) {
          setMessages(prev => [...prev, { role: 'assistant', content: secondResponse.text!, timestamp: new Date() }]);
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: response.text || "I received your message but couldn't generate a response. Please check that GEMINI_API_KEY is configured on the server.", timestamp: new Date() }]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${msg}`, timestamp: new Date() }]);
    } finally { 
      setIsChatting(false); 
    }
  };

  // While Supabase is checking the existing session, show a neutral loader
  if (authLoading) return (
    <div className={`h-screen flex flex-col items-center justify-center gap-4 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-neutral-50'}`}>
      <div className="p-4 bg-blue-600 rounded-2xl shadow-xl shadow-blue-600/30">
        <FlaskConical className="w-10 h-10 text-white" />
      </div>
      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
    </div>
  );

  if (!isAuthenticated) return <SignInPage theme={theme} toggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} />;

  return (
    <div className={`h-screen flex flex-col transition-colors duration-200 ai-native-bg ${theme === 'dark' ? 'bg-[#070b12] text-slate-200' : 'bg-[#eef3f8] text-slate-950'}`}>
      <header className={`px-4 md:px-6 py-2.5 flex items-center justify-between gap-3 border-b backdrop-blur-xl ${theme === 'dark' ? 'bg-[#070b12]/90 border-slate-800/80' : 'bg-white/95 border-slate-200'}`}>
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <div className="h-9 w-9 rounded-xl bg-slate-950 dark:bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-600/15">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-lg font-black tracking-tight">Disease<span className="text-blue-600 dark:text-blue-400">2</span>Target</h1>
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                AI native
              </span>
            </div>
            <p className="hidden md:block text-[11px] font-medium text-slate-500 dark:text-slate-400">Therapeutic target discovery and evidence ranking</p>
          </div>
        </div>
        <TabNavigation 
          viewMode={viewMode} 
          onViewModeChange={(mode) => {
            setViewMode(mode);
            setResearchState(p => ({ ...p, focusSymbol: null }));
          }} 
          theme={theme} 
        />
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            {theme === 'dark' ? <Sun className="w-4 h-4 text-slate-300" /> : <Moon className="w-4 h-4 text-slate-900" />}
          </button>
          {currentUser && (
            <ProfileDropdown
              currentUser={currentUser}
              theme={theme}
              onSignOut={handleSignOut}
              globalWeights={globalWeights}
            />
          )}
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden relative p-2 gap-2">
        <aside className={`order-2 border flex flex-col shrink-0 transition-all duration-300 rounded-xl overflow-hidden shadow-lg shadow-slate-950/5 ${isLeftSidebarOpen ? 'w-[340px]' : 'w-0 opacity-0 pointer-events-none'} ${theme === 'dark' ? 'bg-[#0b111c]/95 border-slate-800/80' : 'bg-white border-slate-200'}`}>
           <div className={`p-4 border-b flex items-center justify-between ${theme === 'dark' ? 'bg-[#0b111c] border-slate-800' : 'bg-white border-slate-200'}`}>
             <div className="flex items-center gap-3">
               <div className="h-8 w-8 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                 <MessageSquare className="w-4 h-4" />
               </div>
               <div>
                 <div className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-slate-400' : 'text-slate-700'}`}>Co-pilot</div>
                 <div className={`text-[12px] font-bold ${theme === 'dark' ? 'text-slate-100' : 'text-slate-950'}`}>Targets context</div>
               </div>
             </div>
             <button onClick={() => setIsLeftSidebarOpen(false)} className={`p-1.5 rounded-lg ${theme === 'dark' ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}><PanelRight className={`w-3.5 h-3.5 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-900'}`} /></button>
           </div>
           <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-5 space-y-6">
              {messages.filter(m => (m.content && m.content.trim().length > 0) || (m.options && m.options.length > 0) || (m.filterOptions && m.filterOptions.length > 0)).map((m, i) => (
                <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[88%] inline-block px-4 py-2.5 rounded-lg text-[13px] shadow-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : (theme === 'dark' ? 'bg-[#111827] border border-slate-800 text-slate-100' : 'bg-white text-slate-950 border border-slate-200 shadow-sm')}`}>
                    <div className="markdown-body prose prose-sm prose-neutral dark:prose-invert max-w-none text-slate-950 dark:text-neutral-200">
                      <Markdown>{m.content}</Markdown>
                    </div>
                    {m.options && (
                      <div className="mt-3 space-y-2">
                        {m.options.map(o => (
                          <button key={o.id} onClick={() => handleToolExecution('get_genes', { id: o.id, name: o.name }).then(res => setMessages(prev => [...prev, { role: 'assistant', content: typeof res === 'string' ? res : res.content, timestamp: new Date() }]))} className="w-full p-3 rounded-lg bg-blue-600/10 border border-blue-600/20 text-left text-[11px] font-semibold uppercase text-blue-700 dark:text-blue-300 hover:bg-blue-600 hover:text-white transition-all shadow-sm">
                            {o.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {m.filterOptions && (
                      <div className="mt-3 grid grid-cols-1 gap-2">
                        {m.filterOptions.map((f, idx) => (
                          <button 
                            key={idx} 
                            onClick={() => handleToolExecution('apply_filter', f).then(res => setMessages(prev => [...prev, { role: 'assistant', content: typeof res === 'string' ? res : res.content, timestamp: new Date() }]))}
                            className="w-full p-3 rounded-lg bg-emerald-600/10 border border-emerald-600/20 text-left text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center justify-between"
                          >
                            <span>{f.label}</span>
                            <span className="opacity-60 font-mono">{f.operator === 'gt' ? '>' : '<'} {f.threshold}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isChatting && (<div className="flex items-center gap-2 text-blue-600 px-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="text-[10px] font-bold uppercase tracking-widest">Synthesizing...</span></div>)}
           </div>
           <form onSubmit={handleChat} className={`p-4 border-t ${theme === 'dark' ? 'bg-[#0b111c] border-slate-800' : 'bg-white border-slate-200'}`}>
             <div className="relative flex gap-2">
               <input 
                 type="file" 
                 ref={fileInputRef} 
                 onChange={handlePaperUpload} 
                 className="hidden" 
                 multiple 
                 accept=".pdf" 
               />
               <button 
                 type="button"
                 onClick={() => fileInputRef.current?.click()}
                 className={`p-3 rounded-xl border transition-all ${theme === 'dark' ? 'bg-[#111827] border-slate-800 text-slate-300 hover:text-white' : 'bg-white border-slate-300 text-slate-700 hover:text-slate-950 shadow-sm'}`}
                 title="Upload PDF Papers"
               >
                 <FileText className="w-5 h-5" />
               </button>
               <div className="relative flex-1">
                 <input 
                   type="text" 
                   value={chatInput} 
                   onChange={e=>setChatInput(e.target.value)} 
                   placeholder="ask or upload paper" 
                   className={`w-full p-3 pr-10 text-sm rounded-lg border outline-none ${theme === 'dark' ? 'bg-[#111827] border-slate-800 text-white placeholder-slate-500' : 'bg-white border-slate-300 text-slate-950 placeholder-slate-500 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10'}`} 
                 />
                 <button type="submit" className="absolute right-2 top-2 p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                   <Send className="w-4 h-4" />
                 </button>
               </div>
             </div>
           </form>
        </aside>
        <CohortFilterSidebar theme={theme} targets={researchState.targets} activeDisease={researchState.activeDisease} onScoreRangesChange={setScoreRangeFilter} onRankRangesChange={setRankRangeFilter} visibleCols={visibleColumns} onVisibleColsChange={setVisibleColumns} visibleBioTissues={visibleBioTissues} onVisibleBioTissuesChange={setVisibleBioTissues} currentUser={currentUser} globalWeights={globalWeights} onWeightsSave={handleWeightsSave} onAssessRun={handleAssessRun} activeNav={sidebarNav} onActiveNavChange={setSidebarNav} />
        {!isLeftSidebarOpen && (<button onClick={() => setIsLeftSidebarOpen(true)} className="absolute right-4 bottom-4 z-20 p-2.5 rounded-full bg-blue-600 text-white shadow-xl hover:scale-110 transition-transform"><MessageSquare className="w-5 h-5" /></button>)}
        <section className="order-1 flex-1 flex flex-col overflow-hidden relative min-w-0">
           <Breadcrumbs 
             activeDisease={researchState.activeDisease} 
             focusSymbol={researchState.focusSymbol}
             focusSubPage={focusSubPage}
             theme={theme}
             onNavigate={(level) => {
               if (level === 'home') {
                 setResearchState(p => ({ 
                   ...p, 
                   focusSymbol: null 
                 }));
                 setFocusSubPage('main');
                 setViewMode('list');
               } else if (level === 'disease') {
                 setResearchState(p => ({ ...p, focusSymbol: null }));
                 setFocusSubPage('main');
               } else if (level === 'target') {
                 setFocusSubPage('main');
               }
             }}
           />
           <div className={`flex-1 overflow-hidden relative ${theme === 'dark' ? 'bg-transparent text-neutral-200' : 'bg-transparent text-neutral-900'}`}>
              {loading && (<div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-[2px] z-50 flex flex-col items-center justify-center gap-4 rounded-xl"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /><p className="text-[11px] font-bold uppercase text-white tracking-widest">{loadingMessage}</p></div>)}
              
              {sidebarNav === 'assess' ? (
                assessMode ? (
                <AssessmentView
                  genes={assessGenes}
                  data={assessData}
                  loading={assessLoading}
                  diseaseName={researchState.activeDisease?.name || 'Unknown Disease'}
                  theme={theme}
                  onClose={() => setAssessMode(false)}
                />
                ) : (
                <div className="h-full flex flex-col items-center justify-center p-20 text-center animate-in zoom-in duration-500">
                  <div className={`p-6 rounded-3xl mb-8 ${theme === 'dark' ? 'bg-blue-500/10' : 'bg-blue-50'}`}>
                    <Microscope className={`w-14 h-14 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-500'}`} />
                  </div>
                  <h2 className={`text-2xl font-black mb-3 tracking-tight ${theme === 'dark' ? 'text-neutral-100' : 'text-slate-900'}`}>
                    Target Assessment
                  </h2>
                  <p className={`text-sm max-w-md leading-relaxed mb-8 ${theme === 'dark' ? 'text-neutral-400' : 'text-slate-600'}`}>
                    Select up to 3 genes from the panel on the left — choose from your ranked list or type any gene symbol — then click <strong>Run Assessment</strong> to get a full evidence report with drug modalities, clinical trial context, tissue expression, and AI-powered trade-off analysis.
                  </p>
                  <div className={`flex flex-col gap-3 text-left max-w-sm w-full px-6 py-5 rounded-2xl border ${theme === 'dark' ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-200'}`}>
                    {[
                      { icon: '🧬', text: 'GET scores: genetic, expression & target evidence' },
                      { icon: '💊', text: 'Drug modality: small molecule, antibody, gene therapy' },
                      { icon: '🏥', text: 'Clinical trials: phase, active studies, conditions' },
                      { icon: '📚', text: 'Literature: total papers, recent velocity, top hits' },
                      { icon: '🤖', text: 'AI narrative: trade-off analysis across all genes' },
                      { icon: '📄', text: 'Download full report as DOCX' },
                    ].map(({ icon, text }) => (
                      <div key={text} className="flex items-center gap-3">
                        <span className="text-base">{icon}</span>
                        <span className={`text-xs ${theme === 'dark' ? 'text-neutral-400' : 'text-slate-600'}`}>{text}</span>
                      </div>
                    ))}
                  </div>
                </div>
                )
              ) : researchState.focusSymbol ? (
                <div className={`h-full rounded-2xl border overflow-hidden shadow-xl shadow-slate-950/5 ${theme === 'dark' ? 'bg-[#0b111c]/95 border-slate-800/80' : 'bg-white/95 border-slate-200'}`}>
                  <TargetDetailView
                    target={researchState.targets.find(t => t.symbol === researchState.focusSymbol)!}
                    theme={theme}
                    diseaseName={researchState.activeDisease?.name || "Evidence"}
                    subPage={focusSubPage}
                    onToggleUsefulness={toggleUsefulness}
                    onNavigateSubPage={setFocusSubPage}
                    onSave={exportToDocx}
                    onBack={() => {
                      setResearchState(p => ({ ...p, focusSymbol: null }));
                      setFocusSubPage('main');
                    }}
                    onLoadAiSummary={handleLoadAiSummary}
                    aiSummaryLoading={aiSummaryLoading === researchState.focusSymbol}
                    onShowScoreInfo={setActiveScoreInfo}
                  />
                </div>
              ) : researchState.targets.length === 0 && !['raw', 'paper', 'pubtator'].includes(viewMode) ? (<div className="h-full flex flex-col items-center justify-center p-20 text-center animate-in zoom-in duration-500"><Search className="w-16 h-16 text-blue-500 mb-8 opacity-30" /><h2 className={`text-xl font-bold mb-2 tracking-tight ${theme === 'dark' ? 'text-neutral-200' : 'text-slate-950'}`}>System Ready for Research Focus</h2><p className={`text-sm max-w-sm leading-relaxed ${theme === 'dark' ? 'text-neutral-500' : 'text-slate-700'}`}>Search for a therapeutic area or disease in the terminal to begin multi-modal target discovery.</p></div>) : (viewMode === 'raw') && !activeCancerType ? (<div className="h-full flex flex-col items-center justify-center p-12 text-center"><div className="p-5 rounded-full bg-blue-50 dark:bg-blue-900/20 mb-6"><AlertCircle className="w-12 h-12 text-blue-600" /></div><h3 className="text-xl font-bold mb-2 text-neutral-800 dark:text-neutral-200">Optimized Context Required</h3><p className="text-sm max-w-md text-neutral-600 dark:text-neutral-500 leading-relaxed">Cohort analytics are currently specifically tuned for high-resolution TCGA (e.g. BRCA, KIRC, BLCA) studies.</p></div>) : (
                <div className={`h-full rounded-2xl border overflow-hidden shadow-xl shadow-slate-950/5 ${theme === 'dark' ? 'bg-[#0b111c]/95 border-slate-800/80' : 'bg-white/95 border-slate-200'}`}>
                  {viewMode === 'pubtator' && (
                    <PubTatorView
                      results={researchState.pubtatorResults?.map(r => {
                        const otTarget = researchState.targets.find(t => t.symbol.toUpperCase() === r.gene.toUpperCase());
                        return {
                          ...r,
                          rpScore: researchState.rpScores?.[r.gene],
                          winnerScore: researchState.winnerScores?.[r.gene],
                          winnerRawScore: researchState.winnerRawScores?.[r.gene],
                          otGeneticScore: otTarget?.geneticScore,
                          otExpressionScore: otTarget?.combinedExpression,
                          otTargetScore: otTarget?.targetScore,
                          otGetScore: otTarget?.getScore,
                        };
                      })}
                      isLoading={researchState.isFetchingPubTator}
                      theme={theme}
                      onAddGene={(g) => handleAddGeneFromPaper(g, 'LIT')}
                      onShowScoreInfo={setActiveScoreInfo}
                      onShowTooltip={setActiveTooltip}
                      activeTooltip={activeTooltip}
                      onLoadMore={handleLoadMoreLiterature}
                      visibleColumns={visibleColumns}
                    />
                  )}
                  {viewMode === 'paper' && (
                    <PaperExtractor 
                      theme={theme} 
                      onAddGene={(g) => handleAddGeneFromPaper(g, 'PAPER')} 
                      results={researchState.paperResults}
                    />
                  )}
                  {viewMode === 'list' && (
                    <div className="h-full flex flex-col">
                      <div className={`flex flex-col xl:flex-row xl:items-center justify-between gap-3 p-4 border-b ${theme === 'dark' ? 'bg-slate-950/20 border-slate-800' : 'bg-white border-slate-200'}`}>
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className={`text-[12px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-slate-100' : 'text-slate-950'}`}>Target prioritization matrix</h3>
                            <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400">{displayTargets.length} targets</span>
                          </div>
                          {(researchState.filters.length > 0 || activeCancerType) && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-[9px] font-bold uppercase tracking-tight ${theme === 'dark' ? 'text-slate-400' : 'text-slate-950'}`}>Active decision filters:</span>
                              <div className="flex flex-wrap gap-1.5">
                                {activeCancerType && (
                                  <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase ${theme === 'dark' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                                    Cohort = {activeCancerType} all patients
                                  </div>
                                )}
                                {researchState.filters.map((f, idx) => {
                                  let label = "";
                                  if (f.field === 'active_trial_present' && f.boolValue === true) label = "Active trials preferred";
                                  else if (f.field === 'clinical_score' && f.operator === '>' && f.value === 0) label = "Clinical score > 0";
                                  else {
                                    const field = f.field.replace(/_/g, ' ');
                                    const val = f.boolValue !== undefined ? (f.boolValue ? 'YES' : 'NO') : (f.stringValue !== undefined ? f.stringValue : (f.value2 !== undefined ? `${f.value}-${f.value2}` : f.value));
                                    label = `${field} ${f.operator} ${val}`;
                                  }
                                  return (
                                    <div key={idx} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                                      {label}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => {
                              setResearchState(prev => ({
                                ...prev,
                                globalHiddenMetrics: [],
                                targets: prev.targets.map(t => ({ ...t, usefulness: {} }))
                              }));
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all shadow-sm bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reset Metrics
                          </button>
                          <div className="relative">
                            <button 
                              onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                              disabled={isExporting || !researchState.targets.length}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all shadow-sm ${isExporting || !researchState.targets.length ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                            >
                              {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />}
                              Export
                              <ChevronDown className={`w-3 h-3 transition-transform ${isExportDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {isExportDropdownOpen && (
                              <div className="absolute right-0 mt-2 w-44 rounded-xl border bg-white dark:bg-[#171717] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in duration-200">
                                <button onClick={() => { exportToDocx(); setIsExportDropdownOpen(false); }} className="w-full px-4 py-3 text-left text-[11px] font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 flex items-center gap-3 border-b border-neutral-100 dark:border-neutral-800 transition-colors text-neutral-700 dark:text-neutral-300">
                                  <div className="p-1.5 rounded-md bg-blue-50 dark:bg-blue-900/20"><FileDown className="w-3.5 h-3.5 text-blue-500" /></div>
                                  <span>Download DOCX</span>
                                </button>
                                <button onClick={() => { exportToCsv(); setIsExportDropdownOpen(false); }} className="w-full px-4 py-3 text-left text-[11px] font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 flex items-center gap-3 border-b border-neutral-100 dark:border-neutral-800 transition-colors text-neutral-700 dark:text-neutral-300">
                                  <div className="p-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20"><FileDown className="w-3.5 h-3.5 text-emerald-500" /></div>
                                  <span>Download CSV (OT)</span>
                                </button>
                                <button onClick={() => { setAllMetricsExportOpen(true); setIsExportDropdownOpen(false); }} className="w-full px-4 py-3 text-left text-[11px] font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 flex items-center gap-3 transition-colors text-neutral-700 dark:text-neutral-300">
                                  <div className="p-1.5 rounded-md bg-orange-50 dark:bg-orange-900/20"><FileDown className="w-3.5 h-3.5 text-orange-500" /></div>
                                  <span>All Metrics CSV...</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* All metrics export - gene-count selector modal */}
                      {allMetricsExportOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setAllMetricsExportOpen(false)}>
                          <div onClick={e => e.stopPropagation()} className={`w-full max-w-md rounded-2xl border shadow-2xl p-6 ${theme === 'dark' ? 'bg-[#0d1424] border-slate-800' : 'bg-white border-slate-200'}`}>
                            <div className="flex items-center gap-2 mb-2">
                              <FlaskConical className="w-5 h-5 text-orange-500" />
                              <h3 className={`text-lg font-black ${theme === 'dark' ? 'text-slate-100' : 'text-slate-900'}`}>All Metrics CSV Export</h3>
                            </div>
                            <p className={`text-[12px] leading-relaxed mb-4 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                              Download Open Targets scores, drill-down literature and clinical metrics, TAU, bimodality, pathway enrichment, and ChEMBL druggability in one CSV. Larger exports make many real API calls and can take several minutes.
                            </p>
                            <div className="grid grid-cols-3 gap-2 mb-4">
                              <button onClick={() => exportAllMetricsCsv('loaded')}
                                className={`py-3 rounded-xl border text-[11px] font-bold transition-all ${theme === 'dark' ? 'border-slate-700 bg-slate-900/40 text-slate-300 hover:border-orange-500' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-orange-400'}`}>
                                Loaded ({displayTargets.length})
                              </button>
                              {[100, 500].map(n => (
                                <button key={n} onClick={() => exportAllMetricsCsv(n as 100 | 500)}
                                  className={`py-3 rounded-xl border text-[13px] font-black transition-all ${theme === 'dark' ? 'border-slate-700 bg-slate-900/40 text-slate-200 hover:border-orange-500 hover:bg-orange-600/15' : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-orange-400 hover:bg-orange-50'}`}>
                                  Top {n}
                                </button>
                              ))}
                            </div>
                            <p className={`text-[10px] mb-3 ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>
                              500 is the export limit. The progress window stays open while ClinicalTrials, PubMed, Europe PMC, and ChEMBL data are fetched.
                            </p>
                            <button onClick={() => setAllMetricsExportOpen(false)} className={`w-full py-2 rounded-xl text-[12px] font-bold ${theme === 'dark' ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* All metrics export - progress overlay */}
                      {allMetricsProgress && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                          <div className={`w-full max-w-sm rounded-2xl border shadow-2xl p-6 text-center ${theme === 'dark' ? 'bg-[#0d1424] border-slate-800' : 'bg-white border-slate-200'}`}>
                            <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
                            <p className={`text-[13px] font-bold mb-1 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>Building all-metrics CSV...</p>
                            <p className={`text-[11px] mb-2 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>{allMetricsProgress.stage}</p>
                            <p className={`text-[11px] mb-4 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-500'}`}>
                              {allMetricsProgress.done} / {allMetricsProgress.total} genes
                            </p>
                            <div className={`w-full h-2 rounded-full overflow-hidden ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`}>
                              <div className="h-full bg-orange-500 transition-all duration-300" style={{ width: `${allMetricsProgress.total ? (allMetricsProgress.done / allMetricsProgress.total) * 100 : 0}%` }} />
                            </div>
                            <p className={`text-[9px] mt-3 ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>
                              Elapsed: {Math.max(1, Math.round((Date.now() - allMetricsProgress.startedAt) / 1000))}s. Large exports can take several minutes.
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="flex-1 overflow-auto relative">
                        {/* col(key) helper — true if that column is toggled on; sortTh — clickable sort header */}
                        {(() => {
                          const col = (key: TableColKey) => visibleColumns.includes(key);
                          const sortTh = (key: string, label: React.ReactNode) => (
                            <button
                              onClick={() => setTableSort(prev => prev?.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' })}
                              className="flex items-center justify-center gap-1 hover:text-blue-500 transition-colors w-full"
                            >
                              {label}
                              <ArrowUpDown className={`w-2.5 h-2.5 shrink-0 ${tableSort?.key === key ? 'text-blue-500' : 'opacity-40'}`} />
                            </button>
                          );
                          return (
                        <table className="w-full min-w-[640px] text-left border-collapse">
                          <thead className={`sticky top-0 z-10 text-[10px] font-black uppercase tracking-widest border-b ${theme === 'dark' ? 'bg-[#111827] border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-950 shadow-sm'}`}>
                            <tr>
                              <th className="p-4 pl-4">Gene</th>
                              <th className="p-4 text-center">Flags</th>
                              <th className="p-4 hidden md:table-cell">Gene Name</th>
                              {col('geneticScore') && <th className="p-4 text-center relative"><div className="flex items-center justify-center gap-1.5">{sortTh('geneticScore', 'Genetic')}<button onMouseEnter={() => setActiveTooltip('genetic')} onMouseLeave={() => setActiveTooltip(null)} onClick={() => setActiveScoreInfo('genetic')} className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"><Info className="w-3 h-3 text-neutral-400" /></button></div>{activeTooltip === 'genetic' && (<div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-4 rounded-xl border bg-white dark:bg-[#1c1c1c] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 text-left normal-case tracking-normal"><h5 className="text-[12px] font-bold mb-1">Genetic Score</h5><p className="text-[11px] text-neutral-400 leading-relaxed">Max of genetic_association, somatic_mutation, and genetic_literature scores from Open Targets.</p></div>)}</th>}
                              {col('combinedExpression') && <th className="p-4 text-center relative"><div className="flex items-center justify-center gap-1.5">{sortTh('combinedExpression', 'Expression')}<button onMouseEnter={() => setActiveTooltip('expression')} onMouseLeave={() => setActiveTooltip(null)} onClick={() => setActiveScoreInfo('expression')} className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"><Info className="w-3 h-3 text-neutral-400" /></button></div>{activeTooltip === 'expression' && (<div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-4 rounded-xl border bg-white dark:bg-[#1c1c1c] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 text-left normal-case tracking-normal"><h5 className="text-[12px] font-bold mb-1">Expression Score</h5><p className="text-[11px] text-neutral-400 leading-relaxed">Combines expression strength and tissue selectivity from Open Targets RNA data.</p></div>)}</th>}
                              {col('targetScore') && <th className="p-4 text-center relative"><div className="flex items-center justify-center gap-1.5">{sortTh('targetScore', 'Target')}<button onMouseEnter={() => setActiveTooltip('target')} onMouseLeave={() => setActiveTooltip(null)} onClick={() => setActiveScoreInfo('target')} className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"><Info className="w-3 h-3 text-neutral-400" /></button></div>{activeTooltip === 'target' && (<div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-4 rounded-xl border bg-white dark:bg-[#1c1c1c] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 text-left normal-case tracking-normal"><h5 className="text-[12px] font-bold mb-1">Target Score</h5><p className="text-[11px] text-neutral-400 leading-relaxed">Druggability from Open Targets tractability: Approved Drug (1.0) → Unknown (0.10).</p></div>)}</th>}
                              {col('literatureScore') && <th className="p-4 text-center relative"><div className="flex items-center justify-center gap-1.5">{sortTh('literatureScore', 'Literature')}<button onMouseEnter={() => setActiveTooltip('literature')} onMouseLeave={() => setActiveTooltip(null)} onClick={() => setActiveScoreInfo('literature')} className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"><Info className="w-3 h-3 text-neutral-400" /></button></div>{activeTooltip === 'literature' && (<div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-4 rounded-xl border bg-white dark:bg-[#1c1c1c] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 text-left normal-case tracking-normal"><h5 className="text-[12px] font-bold mb-1">Literature Score</h5><p className="text-[11px] text-neutral-400 leading-relaxed">Literature datatype score from Open Targets / Europe PMC text mining.</p></div>)}</th>}
                              {col('getScore') && <th className="p-4 text-center relative"><div className="flex items-center justify-center gap-1.5">{sortTh('getScore', 'GET Score')}<button onMouseEnter={() => setActiveTooltip('get_score')} onMouseLeave={() => setActiveTooltip(null)} onClick={() => setActiveScoreInfo('get_score')} className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"><Info className="w-3 h-3 text-neutral-400" /></button></div>{activeTooltip === 'get_score' && (<div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-4 rounded-xl border bg-white dark:bg-[#1c1c1c] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 text-left normal-case tracking-normal"><h5 className="text-[12px] font-bold mb-1">GET Score</h5><p className="text-[11px] text-neutral-400 leading-relaxed">Composite: G×0.50 + E×0.25 + T×0.25 with velocity bonus.</p></div>)}</th>}
                              {col('tauTissue') && <th className="p-4 text-center whitespace-nowrap text-orange-500">{sortTh('tauTissue', 'TAU Tissue')}</th>}
                              {col('tauSingleCell') && <th className="p-4 text-center whitespace-nowrap text-red-500">{sortTh('tauSingleCell', 'TAU Cell')}</th>}
                              {/* Bimodality columns — Max always first, then per-tissue */}
                              {visibleBioTissues.length > 0 && (
                                <th className="p-4 text-center whitespace-nowrap text-purple-500 text-[9px] font-black uppercase tracking-wider relative">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {sortTh('bimodality__max', 'Max Bio')}
                                    <button
                                      onMouseEnter={() => setActiveTooltip('bimodality__max')}
                                      onMouseLeave={() => setActiveTooltip(null)}
                                      className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                                    >
                                      <Info className="w-3 h-3 text-purple-400" />
                                    </button>
                                  </div>
                                  {activeTooltip === 'bimodality__max' && (
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 p-4 rounded-xl border bg-white dark:bg-[#1c1c1c] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 text-left normal-case tracking-normal">
                                      <h5 className="text-[12px] font-bold mb-2 text-purple-500">Bimodality Score</h5>
                                      <p className="text-[11px] text-neutral-400 leading-relaxed mb-2">Measures how selectively a gene is ON vs OFF across cells in a tissue. Highest score across all 36 tissues.</p>
                                      <ol className="text-[10px] text-neutral-500 space-y-1 list-decimal list-inside">
                                        <li>Log1p-transform raw expression counts</li>
                                        <li>KMeans (k=2) splits cells into OFF / ON groups</li>
                                        <li>Separation = distance between group centers</li>
                                        <li>Balance = fraction in each group (50/50 = max)</li>
                                        <li className="font-semibold text-purple-400">Score = Separation × Balance</li>
                                        <li>Genes in &lt;10% of cells excluded per tissue</li>
                                      </ol>
                                    </div>
                                  )}
                                </th>
                              )}
                              {visibleBioTissues.map(tissue => (
                                <th key={tissue} className="p-4 text-center whitespace-nowrap text-purple-400 text-[9px] font-black uppercase tracking-wider relative">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {sortTh(`bimodality__${tissue}`, bioTissueLabel(tissue))}
                                    <button
                                      onMouseEnter={() => setActiveTooltip(`bimodality__${tissue}`)}
                                      onMouseLeave={() => setActiveTooltip(null)}
                                      className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                                    >
                                      <Info className="w-3 h-3 text-purple-400" />
                                    </button>
                                  </div>
                                  {activeTooltip === `bimodality__${tissue}` && (
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 p-4 rounded-xl border bg-white dark:bg-[#1c1c1c] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 text-left normal-case tracking-normal">
                                      <h5 className="text-[12px] font-bold mb-2 text-purple-500">Bimodality Score — {bioTissueLabel(tissue)}</h5>
                                      <p className="text-[11px] text-neutral-400 leading-relaxed mb-2">Measures how selectively a gene is ON vs OFF across cells in this tissue.</p>
                                      <ol className="text-[10px] text-neutral-500 space-y-1 list-decimal list-inside">
                                        <li>Log1p-transform raw expression counts</li>
                                        <li>KMeans (k=2) splits cells into OFF / ON groups</li>
                                        <li>Separation = distance between group centers</li>
                                        <li>Balance = fraction in each group (50/50 = max)</li>
                                        <li className="font-semibold text-purple-400">Score = Separation × Balance</li>
                                        <li>Genes in &lt;10% of cells excluded per tissue</li>
                                      </ol>
                                    </div>
                                  )}
                                </th>
                              ))}
                              {col('finalScore') && <th className="p-4 pr-8 text-right relative text-blue-600"><div className="flex items-center justify-end gap-1.5">{sortTh('finalScore', 'Final Score')}<button onMouseEnter={() => setActiveTooltip('overall')} onMouseLeave={() => setActiveTooltip(null)} onClick={() => setActiveScoreInfo('overall')} className="p-0.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"><Info className="w-3 h-3 text-blue-400" /></button></div>{activeTooltip === 'overall' && (<div className="absolute top-full right-0 mt-2 w-64 p-4 rounded-xl border bg-white dark:bg-[#1c1c1c] border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 text-left normal-case tracking-normal"><h5 className="text-[12px] font-bold mb-1">Final Score</h5><p className="text-[11px] text-neutral-400 leading-relaxed">(GET × 0.50) + (RP × 0.25) + (WINNER × 0.25)</p></div>)}</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                            {displayTargets.map(t => {
                              const isRowPinned = t.usefulness?.['overall'] === 'pinned';
                              const areAllMetricsHidden = t.usefulness?.['literature'] === 'not-useful' && 
                                                         t.usefulness?.['discovery'] === 'not-useful';

                              return (
                                <React.Fragment key={t.id}>
                                  <tr 
                                    onClick={()=>{
                                      setResearchState(p=>({...p, focusSymbol: t.symbol}));
                                      if (!t.drillDown) handleDrillDown(t.symbol);
                                    }} 
                                    className={`cursor-pointer transition-all hover:bg-blue-50/70 dark:hover:bg-slate-800/50 ${researchState.focusSymbol === t.symbol ? 'bg-blue-100/40 dark:bg-blue-950/20' : ''} ${isRowPinned ? 'ring-2 ring-inset ring-blue-500/50 bg-blue-50/30 dark:bg-blue-950/20' : ''}`}
                                  >
                                  <td className={`p-4 pl-4 font-bold text-[13px] ${theme === 'dark' ? 'text-blue-400' : 'text-blue-500'}`}>
                                    <div className="flex items-center gap-2 group">
                                      {t.symbol}
                                      {researchState.rwrSeeds?.includes(t.symbol) && <span className="px-1.5 py-0.5 rounded-full bg-indigo-500 text-white text-[8px] font-black uppercase tracking-tighter shadow-sm">SEED</span>}
                                      {t.source === 'PAPER' && <span className="px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[8px] font-black uppercase tracking-tighter">PAPER</span>}
                                      
                                      {t.source === 'LIT' && <span className="px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[8px] font-black uppercase tracking-tighter">LIT</span>}
                                      {drillDownLoading === t.symbol ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                                      ) : (
                                        <ZoomIn className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-blue-400" />
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-4 text-center">
                                    {t.clinical_flags && t.clinical_flags.length > 0 && (
                                      <div className="flex justify-center">
                                        <Flag className="w-3 h-3 text-rose-500 fill-rose-500/20" />
                                      </div>
                                    )}
                                  </td>
                                  <td className={`p-4 text-[12px] hidden md:table-cell ${theme === 'dark' ? 'text-neutral-400' : 'text-neutral-900'}`}>{t.name}</td>
                                  {col('geneticScore') && <td className={`p-4 text-center font-mono text-[11px] font-medium ${theme === 'dark' ? 'text-neutral-400' : 'text-slate-950'}`}>{t.geneticScore.toFixed(3)}</td>}
                                  {col('combinedExpression') && <td className={`p-4 text-center font-mono text-[11px] font-medium ${theme === 'dark' ? 'text-neutral-400' : 'text-slate-950'}`}>{t.combinedExpression?.toFixed(3)}</td>}
                                  {col('targetScore') && <td className={`p-4 text-center font-mono text-[11px] font-medium ${theme === 'dark' ? 'text-neutral-400' : 'text-slate-950'}`}>{t.targetScore.toFixed(3)}</td>}
                                  {col('literatureScore') && <td className={`p-4 text-center font-mono text-[11px] font-medium ${theme === 'dark' ? 'text-neutral-400' : 'text-slate-950'}`}>{t.literatureScore?.toFixed(3) ?? '—'}</td>}
                                  {col('getScore') && <td className={`p-4 text-center font-mono text-[11px] font-medium ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-700'}`}>{t.getScore?.toFixed(3)}</td>}
                                  {col('tauTissue') && <td className="p-4 text-center font-mono text-[11px]">{t.tauTissue !== undefined ? <ScoreBar value={t.tauTissue} color="bg-orange-400" theme={theme} /> : <span className="text-neutral-400 text-[10px]">—</span>}</td>}
                                  {col('tauSingleCell') && <td className="p-4 text-center font-mono text-[11px]">{t.tauSingleCell !== undefined ? <ScoreBar value={t.tauSingleCell} color="bg-red-400" theme={theme} /> : <span className="text-neutral-400 text-[10px]">—</span>}</td>}
                                  {visibleBioTissues.length > 0 && (
                                    <td className="p-4 text-center font-mono text-[11px]">
                                      {t.bimodalityScores?._max_score !== undefined
                                        ? <div className="flex flex-col items-center gap-0.5">
                                            <ScoreBar value={t.bimodalityScores._max_score} color="bg-purple-500" theme={theme} />
                                            <span className="text-[8px] text-purple-400">{bioTissueLabel(String(t.bimodalityScores._max_tissue ?? ''))}</span>
                                          </div>
                                        : <span className="text-neutral-400 text-[10px]">—</span>}
                                    </td>
                                  )}
                                  {visibleBioTissues.map(tissue => (
                                    <td key={tissue} className="p-4 text-center font-mono text-[11px]">
                                      {t.bimodalityScores?.[tissue] !== undefined
                                        ? <ScoreBar value={t.bimodalityScores[tissue]} color="bg-purple-400" theme={theme} />
                                        : <span className="text-neutral-400 text-[10px]">—</span>}
                                    </td>
                                  ))}
                                  {col('finalScore') && <td className="p-4 pr-8 text-right">{t.finalScore !== undefined ? <ScoreBar value={t.finalScore} color="bg-blue-600" theme={theme} /> : <span className="text-blue-600 font-bold text-[12px] font-mono">{t.overallScore.toFixed(4)}</span>}</td>}
                                </tr>
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                        </table>
                          ); // end IIFE return
                        })()} {/* end col() IIFE */}
                        {researchState.activeDisease && (
                          <div className="p-8 flex flex-col items-center gap-4 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/30 dark:bg-transparent">
                            {researchState.filters.length > 0 && (
                              <div className="flex flex-wrap justify-center gap-2 mb-2">
                                {researchState.filters.map((f, i) => (
                                  <div key={i} className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">
                                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                                      {f.field}: {f.operator} {f.boolValue !== undefined ? String(f.boolValue) : (f.stringValue !== undefined ? f.stringValue : f.value)}
                                    </span>
                                    <button 
                                      onClick={() => setResearchState(p => ({ ...p, filters: p.filters.filter((_, idx) => idx !== i) }))}
                                      className="p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full transition-colors"
                                    >
                                      <X className="w-3 h-3 text-blue-600" />
                                    </button>
                                  </div>
                                ))}
                                <button 
                                  onClick={() => setResearchState(p => ({ ...p, filters: [] }))}
                                  className="text-[10px] font-bold text-neutral-500 hover:text-blue-600 uppercase tracking-widest ml-2"
                                >
                                  Clear All
                                </button>
                              </div>
                            )}
                            <button onClick={() => handleToolExecution('load_more', {})} disabled={loading} className={`group px-10 py-4 rounded-2xl bg-blue-600 text-white text-[12px] font-bold uppercase tracking-widest hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-3 shadow-lg shadow-blue-600/25 disabled:opacity-50`}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />} Load More Analysis</button>
                            <p className="text-[10px] font-bold text-neutral-500 dark:text-neutral-500 uppercase tracking-tighter">Cohort Depth: {researchState.currentPage + 1} | Page Size: {OT_PAGE_SIZE} | Showing: {displayTargets.length}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {viewMode === 'enrichment' && (() => {
                    const SOURCE_META = {
                      KEGG:        { label: 'KEGG',        color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'    },
                      Reactome:    { label: 'Reactome',    color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
                      WikiPathways:{ label: 'WikiPathways', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
                    } as const;

                    const filteredEnrichment = enrichSourceFilter === 'All'
                      ? researchState.enrichment
                      : researchState.enrichment.filter(e => e.source === enrichSourceFilter);

                    const FILTER_TABS: ('All' | 'KEGG' | 'Reactome' | 'WikiPathways')[] = ['All', 'KEGG', 'Reactome', 'WikiPathways'];
                    const counts = {
                      All:          researchState.enrichment.length,
                      KEGG:         researchState.enrichment.filter(e => e.source === 'KEGG').length,
                      Reactome:     researchState.enrichment.filter(e => e.source === 'Reactome').length,
                      WikiPathways: researchState.enrichment.filter(e => e.source === 'WikiPathways').length,
                    };

                    return (
                      <div className="p-8 h-full overflow-auto space-y-6">
                        {/* Header */}
                        <div className={`flex flex-col gap-4 border-b pb-5 ${theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'}`}>
                          <div className="flex items-center justify-between">
                            <h4 className="text-[13px] font-bold uppercase text-neutral-700 dark:text-neutral-400 tracking-wider">Molecular Pathway Analytics</h4>
                            <span className="text-[11px] text-neutral-500">{filteredEnrichment.length} pathways</span>
                          </div>
                          {/* Source filter tabs */}
                          <div className="flex gap-2">
                            {FILTER_TABS.map(tab => (
                              <button
                                key={tab}
                                onClick={() => setEnrichSourceFilter(tab)}
                                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all border ${
                                  enrichSourceFilter === tab
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                    : theme === 'dark'
                                      ? 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200'
                                      : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                                }`}
                              >
                                {tab} <span className={`ml-1 text-[10px] ${enrichSourceFilter === tab ? 'opacity-80' : 'opacity-60'}`}>({counts[tab]})</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Pathway cards */}
                        <div className="grid grid-cols-1 gap-4">
                          {filteredEnrichment.map((e, i) => {
                            const cleanTerm = e.term.replace(/\s+R-HSA-\d+$/i, '').trim();
                            const rawScore = e.combinedScore;
                            // bar width: cap at max 500 for visual scale (Enrichr combined scores vary widely)
                            const barPct = Math.min(1, rawScore / 500);
                            const geneRatio = e.genes.length;
                            const adjP = e.adjustedPValue ?? e.pValue;
                            const sm = SOURCE_META[e.source] ?? SOURCE_META['KEGG'];
                            return (
                              <div key={`${e.source}-${i}`} className={`p-6 rounded-2xl border shadow-sm hover:shadow-md transition-shadow ${theme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200'}`}>
                                <div className="flex flex-col lg:flex-row justify-between gap-6">
                                  <div className="space-y-3 flex-1">
                                    {/* Pathway name + source badge */}
                                    <div className="flex items-start gap-2 flex-wrap">
                                      <span className={`text-[15px] font-bold tracking-tight ${theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'}`}>{cleanTerm}</span>
                                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 ${sm.color}`}>{sm.label}</span>
                                    </div>
                                    {/* FDR + gene ratio line */}
                                    <div className="flex items-center gap-4 flex-wrap">
                                      <span className="text-[10px] font-mono text-neutral-500">
                                        FDR: <span className={`font-bold ${adjP < 0.05 ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-400'}`}>{adjP.toExponential(2)}</span>
                                      </span>
                                      <span className="text-[10px] font-mono text-neutral-500">
                                        Genes: <span className="font-bold text-blue-600 dark:text-blue-400">{geneRatio} overlap</span>
                                      </span>
                                    </div>
                                    {/* Gene chips */}
                                    <div className="flex flex-wrap gap-1.5">
                                      {e.genes.slice(0, 15).map(g => (
                                        <span key={g} className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-colors ${theme === 'dark' ? 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-blue-400' : 'bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100'}`}>{g}</span>
                                      ))}
                                      {e.genes.length > 15 && <span className="px-2 py-1 text-[10px] text-neutral-400">+{e.genes.length - 15} more</span>}
                                    </div>
                                  </div>
                                  {/* Stats */}
                                  <div className="flex items-center gap-10 shrink-0">
                                    <div className="text-right">
                                      <div className="text-[10px] font-bold uppercase mb-1 text-neutral-500 tracking-wider">p-Value</div>
                                      <div className="text-sm font-mono font-bold text-blue-600">{e.pValue.toExponential(3)}</div>
                                    </div>
                                    <div className="w-40 space-y-2">
                                      <div className="flex justify-between items-end">
                                        <span className="text-[10px] font-bold uppercase text-neutral-500 tracking-wider">Score</span>
                                        <span className="text-[11px] font-bold font-mono text-blue-600">{rawScore.toFixed(1)}</span>
                                      </div>
                                      <div className={`h-2 rounded-full overflow-hidden ${theme === 'dark' ? 'bg-neutral-800' : 'bg-neutral-100 shadow-inner'}`}>
                                        <div className="h-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]" style={{width: `${barPct * 100}%`}} />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {filteredEnrichment.length === 0 && (
                            <div className="py-20 text-center text-neutral-400 text-[13px]">
                              No pathways found{enrichSourceFilter !== 'All' ? ` for ${enrichSourceFilter}` : ''}. Run an analysis first.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {viewMode === 'raw' && <RawDataView targets={displayTargets} theme={theme} cancerType={activeCancerType || 'BRCA'} />}
                </div>
              )}
           </div>
        </section>
      </main>

      {/* Score Information Drawer */}
      <div className={`fixed inset-y-0 right-0 w-96 bg-white dark:bg-[#0d0d0d] border-l border-neutral-200 dark:border-neutral-800 shadow-2xl z-[100] transition-transform duration-300 ease-in-out transform ${activeScoreInfo ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="h-full flex flex-col">
          <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20"><Info className="w-5 h-5 text-blue-600" /></div>
              <h2 className="text-lg font-bold tracking-tight text-black dark:text-white">Score Information</h2>
            </div>
            <button onClick={() => setActiveScoreInfo(null)} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"><X className="w-5 h-5 text-neutral-400" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-10">
            {activeScoreInfo === 'genetic' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-blue-600 tracking-widest">Genetic Score</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Description</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Max of genetic_association, somatic_mutation, and genetic_literature datatype scores from Open Targets. Reflects strength of evidence linking this gene to the disease through germline variants, somatic mutations, and genetics-informed literature.</p>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Integrated Datasets</h4>
                    <ul className="list-disc list-inside text-[13px] text-neutral-900 dark:text-neutral-400 space-y-1">
                      <li>Genome-wide association studies (GWAS)</li>
                      <li>Rare variant evidence</li>
                      <li>ClinVar annotations</li>
                      <li>Gene–phenotype databases</li>
                      <li>Open Targets Genetics portal data</li>
                    </ul>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Range</div>
                      <div className="text-lg font-bold text-blue-600">0.0 — 1.0</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Interpretation</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Higher score indicates stronger genetic evidence supporting disease association.</p>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Source</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed mb-4">Open Targets Platform</p>
                    <a href="https://platform-docs.opentargets.org/associations#interpreting-association-scores" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-[11px] font-bold uppercase hover:bg-blue-700 transition-all shadow-md">Learn more on Open Targets <ExternalLink className="w-3.5 h-3.5" /></a>
                  </div>
                </div>
              </section>
            )}

            {activeScoreInfo === 'expression' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-emerald-600 tracking-widest">Expression Score</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Description</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Calculated from Open Targets RNA expression data across all tissues. Combines expression strength (top 3 tissue average, log-normalized) and tissue selectivity (peak tissue vs mean). Higher score means strongly and selectively expressed.</p>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-neutral-800 dark:text-neutral-200 uppercase tracking-tighter">Derived From</h4>
                    <ul className="list-disc list-inside text-[13px] text-neutral-600 dark:text-neutral-400 space-y-1">
                      <li>Expression Atlas</li>
                      <li>Differential expression studies</li>
                      <li>Transcriptomic datasets</li>
                    </ul>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Range</div>
                      <div className="text-lg font-bold text-emerald-600">0.0 — 1.0</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Interpretation</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Higher score indicates stronger expression-based evidence supporting disease relevance.</p>
                  </div>
                  <div>
                    <a href="https://platform-docs.opentargets.org/associations#interpreting-association-scores" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-[11px] font-bold uppercase hover:bg-emerald-700 transition-all shadow-md">Learn more on Open Targets <ExternalLink className="w-3.5 h-3.5" /></a>
                  </div>
                </div>
              </section>
            )}

            {activeScoreInfo === 'target' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-amber-600 tracking-widest">Drug / Target Score</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Description</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Derived from Open Targets tractability assessment. Reflects how druggable this gene is: Approved Drug (1.0), Advanced Clinical (0.85), Phase 1 Clinical (0.70), Structure with Ligand (0.55), High-Quality Pocket (0.40), Druggable Family (0.25), Unknown (0.10).</p>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-neutral-800 dark:text-neutral-200 uppercase tracking-tighter">Derived From</h4>
                    <ul className="list-disc list-inside text-[13px] text-neutral-600 dark:text-neutral-400 space-y-1">
                      <li>ChEMBL</li>
                      <li>Drug–target relationship databases</li>
                      <li>Clinical pharmacology evidence</li>
                    </ul>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Range</div>
                      <div className="text-lg font-bold text-amber-600">0.0 — 1.0</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Interpretation</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Higher score indicates stronger drug-targeting evidence.</p>
                  </div>
                  <div>
                    <a href="https://platform-docs.opentargets.org/associations#interpreting-association-scores" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-[11px] font-bold uppercase hover:bg-amber-700 transition-all shadow-md">Learn more on Open Targets <ExternalLink className="w-3.5 h-3.5" /></a>
                  </div>
                </div>
              </section>
            )}

            {activeScoreInfo === 'overall' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-blue-600 tracking-widest">Final Score (GET + RP)</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Definition</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">The Final Score integrates the GET Score (Biological Evidence) with the RP Score (Network Propagation). It provides a holistic view of a target's potential.</p>
                  </div>
                  <div className="p-6 rounded-2xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800">
                    <h4 className="text-[12px] font-bold mb-3 text-blue-600 uppercase tracking-tighter">Calculation Formula</h4>
                    <div className="font-mono text-[13px] text-blue-700 dark:text-blue-400 space-y-2">
                      <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-blue-100 dark:border-blue-800/50">
                        Final = (GET × 0.60) + (RP × 0.40)
                      </div>
                      <div className="p-3 rounded-lg bg-white dark:bg-neutral-900 border border-blue-100 dark:border-blue-800/50">
                        GET = (Baseline × {(1 - researchState.weights.velocity).toFixed(2)}) + (V_norm × {researchState.weights.velocity.toFixed(2)})
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Interpretation</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Higher score indicates a more promising therapeutic target across multiple evidence dimensions and strategic network position.</p>
                  </div>
                </div>
              </section>
            )}

            {activeScoreInfo === 'rp_score' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-indigo-600 tracking-widest">RP Score Methodology</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Random Walk with Restart (RWR)</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">
                      The RP (Random Propagation) score measures the strength of connection between a gene and established disease "seeds" within the human interactome.
                    </p>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[11px] font-bold text-indigo-600 uppercase mb-2">1. Seed Selection</div>
                      <p className="text-[11px] text-neutral-500">The top 3 genes by medical association (GET Score) are used as starting points for the propagation signal.</p>
                    </div>
                    
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[11px] font-bold text-indigo-600 uppercase mb-2">2. Network Model</div>
                      <p className="text-[11px] text-neutral-500">We utilize STRING v12 human protein-protein interactions (score ≥ 0.400) to build the adjacency matrix.</p>
                    </div>
                    
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[11px] font-bold text-indigo-600 uppercase mb-2">3. Propagation Algorithm</div>
                      <p className="text-[11px] text-neutral-500">A virtual walker navigates the network, with a 15% probability of "restarting" at a seed gene in every step. This captures local neighborhood proximity.</p>
                    </div>
                    
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[11px] font-bold text-indigo-600 uppercase mb-2">4. Normalization</div>
                      <p className="text-[11px] text-neutral-500">Scores are max-normalized to a 0.0 - 1.0 range, where 1.0 represents the highest proximity to disease seeds.</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800">
                    <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Current Session Status</div>
                    <div className="text-sm font-bold text-indigo-600 flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5" />
                      {researchState.rwrStatus || 'Idle'}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeScoreInfo === 'winner_score' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-emerald-600 tracking-widest">WINNER Algorithm Methodology</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Weighted Iterative Graph Prioritization</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">
                      WINNER is a published gene prioritization algorithm (Nguyen T et al. 2022) that identifies critical nodes in biological networks based on weighted connectivity patterns.
                    </p>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[11px] font-bold text-emerald-600 uppercase mb-2">1. Initial Scoring</div>
                      <p className="text-[11px] text-neutral-500">Initial node importance is calculated as the ratio of the squared weighted degree to the simple degree: <span className="font-mono">WDeg² / Deg</span>. This rewards genes with many high-confidence interactions.</p>
                    </div>
                    
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[11px] font-bold text-emerald-600 uppercase mb-2">2. Network Propagation</div>
                      <p className="text-[11px] text-neutral-500">Scores are iteratively propagated across the STRING v12 network using a transition matrix <span className="font-mono">A</span>. In each of 100 iterations, scores are updated using a damping factor <span className="font-mono">σ=0.85</span>.</p>
                    </div>
                    
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[11px] font-bold text-emerald-600 uppercase mb-2">3. Raw Output</div>
                      <p className="text-[11px] text-neutral-500">Unlike RWR, WINNER scores are presented as raw values. Higher scores indicate greater centrality and impact within the disease-associated protein interactome.</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800">
                    <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Citation</div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 italic">
                      Nguyen T et al. "WINNER: a weighted iterative neighbor-based prioritization method for identifying key genes." Frontiers in Big Data, 2022.
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeScoreInfo === 'literature' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-purple-600 tracking-widest">Literature Support</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Description</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Literature datatype score from Open Targets. Reflects the volume and quality of published evidence associating this gene with the disease, sourced from Europe PMC text mining.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                      <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Range</div>
                      <div className="text-lg font-bold text-purple-600">0.0 — 1.0</div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Interpretation</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Higher score indicates extensive literature support for the target–disease association.</p>
                  </div>
                </div>
              </section>
            )}

            {activeScoreInfo === 'get_score' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-indigo-600 tracking-widest">GET Score Details</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Formula Components</h4>
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                        <div className="text-[11px] font-bold text-indigo-600 uppercase mb-2">1. Clinical Trial Signal (trial_signal)</div>
                        <div className="font-mono text-[12px] mb-2">trial_signal = 1 − e^(−interventional_count / 3)</div>
                        <p className="text-[11px] text-neutral-500">Models the diminishing returns of clinical trial counts. 3+ trials provide a strong signal (~0.63).</p>
                      </div>
                      <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                        <div className="text-[11px] font-bold text-indigo-600 uppercase mb-2">2. Enhanced Targetability (T_new)</div>
                        <div className="font-mono text-[12px] mb-2">T_new = (OT_Tractability × 0.65) + (trial_signal × 0.35)</div>
                        <p className="text-[11px] text-neutral-500">Combines theoretical druggability (Open Targets) with real-world clinical activity.</p>
                      </div>
                      <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                        <div className="text-[11px] font-bold text-indigo-600 uppercase mb-2">3. Baseline Priority (Baseline)</div>
                        <div className="font-mono text-[12px] mb-2">Baseline = (G × {researchState.weights.genetic}) + (E × {researchState.weights.expression}) + (T_new × {researchState.weights.target})</div>
                        <p className="text-[11px] text-neutral-500">Weighted sum of Genetic (G), Expression (E), and Enhanced Targetability (T_new).</p>
                      </div>
                      <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                        <div className="text-[11px] font-bold text-indigo-600 uppercase mb-2">4. Final GET Score</div>
                        <div className="font-mono text-[12px] mb-2">GET = (Baseline × {(1 - researchState.weights.velocity).toFixed(2)}) + (V_norm × {researchState.weights.velocity.toFixed(2)})</div>
                        <p className="text-[11px] text-neutral-500">Incorporates Signal Velocity (V_norm) to reward targets with high publication momentum.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeScoreInfo === 'priority' && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase text-rose-600 tracking-widest">Priority Score</h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Description</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Advanced prioritization combining biological evidence (GET Score) with real-world clinical and publication momentum. This score is designed to highlight targets that are not only biologically relevant but also have significant clinical research activity and recent publication growth.</p>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Calculation Formula</h4>
                    <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 font-mono text-[12px] text-rose-600 leading-relaxed">
                      Priority = (GET × 0.70) + (Interventional_Norm × 0.20) + (Velocity_Norm × 0.10)
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Components</h4>
                    <ul className="list-disc list-inside text-[13px] text-neutral-900 dark:text-neutral-400 space-y-2">
                      <li><span className="font-bold">GET Score (70%)</span>: The core biological priority score (Genetic + Expression + Targetability).</li>
                      <li><span className="font-bold">Interventional Count (20%)</span>: Normalized count of interventional clinical trials. Reflects therapeutic interest and feasibility.</li>
                      <li><span className="font-bold">Signal Velocity (10%)</span>: Normalized publication growth rate. Reflects current research momentum and "hotness" of the target.</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold mb-2 text-black dark:text-neutral-200 uppercase tracking-tighter">Normalization</h4>
                    <p className="text-[13px] text-neutral-900 dark:text-neutral-400 leading-relaxed">Clinical and velocity metrics are normalized against the maximum value in the current target list to ensure relative ranking accuracy.</p>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SignInPage = ({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) => {
  const [mode, setMode]           = useState<'signin' | 'signup'>('signin');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [info, setInfo]           = useState('');
  const [busy, setBusy]           = useState(false);

  const inputCls = `w-full p-4 rounded-xl border text-sm font-semibold outline-none transition-all ${
    theme === 'dark'
      ? 'bg-[#0a0a0a] border-neutral-800 text-white focus:border-blue-600'
      : 'bg-neutral-50 border-neutral-300 text-neutral-900 focus:border-blue-600 focus:bg-white'
  }`;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true); setError(''); setInfo('');

    // Race sign-in against a 10-second timeout so the button never freezes
    const signInPromise = supabase.auth.signInWithPassword({ email: email.trim(), password });
    const timeoutPromise = new Promise<{ error: Error }>(resolve =>
      setTimeout(() => resolve({ error: new Error('Connection timed out. Check your network and try again.') }), 10000)
    );

    const result = await Promise.race([signInPromise, timeoutPromise]);
    setBusy(false);

    if (result.error) {
      const msg = result.error.message;
      // Give friendlier messages for the two most common issues
      if (msg.toLowerCase().includes('email not confirmed')) {
        setError('Email not yet confirmed. Go to Supabase Dashboard → Authentication → Providers → Email → disable "Confirm email", then try again.');
      } else if (msg.toLowerCase().includes('invalid login') || msg.toLowerCase().includes('invalid credentials')) {
        setError('Wrong email or password. Try again.');
      } else {
        setError(msg);
      }
    }
    // On success onAuthStateChange fires in App and lets the user in immediately
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setBusy(true); setError(''); setInfo('');
    const { error: err } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setInfo('Account created! Check your email to confirm, then sign in.');
    setMode('signin');
    setPassword(''); setConfirm('');
  };

  return (
    <div className={`h-screen flex items-center justify-center p-6 ${theme === 'dark' ? 'bg-[#0a0a0a]' : 'bg-neutral-50'}`}>
      <div className={`w-full max-w-sm rounded-2xl border transition-all ${theme === 'dark' ? 'bg-[#171717] border-neutral-800 shadow-2xl' : 'bg-white border-neutral-200 shadow-2xl shadow-blue-900/10'}`}>

        {/* Header */}
        <div className="flex flex-col items-center gap-6 pt-10 pb-6 px-10 text-center">
          <div className="p-4 bg-blue-600 rounded-2xl shadow-xl shadow-blue-600/30 rotate-3 transition-transform hover:rotate-0">
            <FlaskConical className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className={`text-3xl font-black tracking-tight ${theme === 'light' ? 'text-neutral-900' : 'text-white'}`}>
              Disease<span className="text-blue-600">2</span>Target
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400 dark:text-neutral-500 mt-2">Discovery Portal</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className={`flex mx-10 mb-6 rounded-xl overflow-hidden border ${theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'}`}>
          {(['signin', 'signup'] as const).map(m => (
            <button
              key={m} onClick={() => { setMode(m); setError(''); setInfo(''); }}
              className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                mode === m
                  ? 'bg-blue-600 text-white'
                  : theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-700'
              }`}
            >{m === 'signin' ? 'Sign In' : 'Create Account'}</button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp} className="px-10 pb-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-neutral-500 ml-1 tracking-widest">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className={inputCls} placeholder="you@institution.edu" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-neutral-500 ml-1 tracking-widest">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} className={inputCls} placeholder="••••••••" />
          </div>
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-neutral-500 ml-1 tracking-widest">Confirm Password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className={inputCls} placeholder="••••••••" />
            </div>
          )}

          {error && <p className="text-[11px] font-bold text-rose-500 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}</p>}
          {info  && <p className="text-[11px] font-bold text-emerald-500 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />{info}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full mt-2 p-4 bg-blue-600 text-white rounded-xl font-bold uppercase text-[12px] tracking-widest shadow-xl shadow-blue-600/20 hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
            {busy ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : (mode === 'signin' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <div className="pb-8 flex justify-center">
          <button onClick={toggleTheme} className="p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors">
            {theme === 'dark' ? <Sun className="w-5 h-5 text-neutral-500" /> : <Moon className="w-5 h-5 text-neutral-600" />}
          </button>
        </div>
      </div>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<App />);
