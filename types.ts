export interface PubTatorResult {
  gene: string;
  totalPapers: number;
  recentPapers: number;
  velocity: number;
  topPaper: string;
  journal: string;
  year: string;
  pmid: string;
  rpScore?: number;
  winnerScore?: number;
  winnerRawScore?: number;
}

export interface LiteratureGeneMetrics {
  gene: string;
  totalPapers: number;
  recentPapers: number;
  velocity: string;
  topPaper: string;
  journal: string;
  year: string;
}

export interface Pathway {
  id: string;
  label: string;
}

export interface DrillDownData {
  paper_count: number;
  recent_paper_count: number;
  latest_publication_date: string;
  epmc_velocity?: string;
  epmc_top_paper?: string;
  epmc_journal?: string;
  epmc_year?: string;
  total_signals?: number;
  recent_signals?: number;
  signal_velocity?: string;
  top_papers?: { title: string; id: string }[];
  trial_count?: number;
  max_phase?: string;
  active_trial_present?: boolean;
  interventional_count?: number;
  phase_breakdown?: Record<string, number>;
  top_conditions?: { name: string; count: number }[];
  top_drugs?: { name: string; count: number }[];
  sponsor_breakdown?: Record<string, number>;
  clinical_summary?: string;
  clinical_flags?: string[];
  total_trials_globally?: number;
}

export interface Target {
  id: string;
  symbol: string;
  name: string;
  overallScore: number;
  getScore?: number;
  geneticScore: number;
  expressionScore: number;
  literatureScore?: number;
  rpScore?: number;
  winnerScore?: number;
  winnerRawScore?: number;
  finalScore?: number;
  baselineExpression?: number; 
  combinedExpression?: number; 
  targetScore: number; 
  priorityScore?: number;
  pathways: Pathway[];
  drillDown?: DrillDownData;
  clinical_flags?: string[];
  usefulness?: Record<string, 'useful' | 'not-useful' | 'pinned'>;
  source?: 'OT' | 'LIT' | 'PAPER';
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  value?: number;
  delta?: number;
  normalizedDelta?: number;
}

export interface DrugInfo {
  name: string;
  id: string;
  phase: number;
  mechanism: string;
  status: string;
}

export interface DiseaseInfo {
  id: string;
  name: string;
  score?: number;
}

export interface EnrichmentResult {
  term: string;
  pValue: number;
  combinedScore: number;
  genes: string[];
}

export interface PubMedStats {
  total: number;
  recent: number;
  topPapers: { title: string; id: string; }[];
  searchLink: string;
  primarySearchLink: string;
}

export interface ClinicalSample {
  sampleid: string;
  sample_type?: string;
  _primary_disease?: string;
  age_at_initial_pathologic_diagnosis?: string;
  gender?: string;
  vital_status: string;
  ajcc_pathologic_tumor_stage?: string;
  race?: string;
  os_time?: string;
  os?: string; // Overall survival indicator (0=High/Alive, 1=Low/Dead)
}

export interface ExpressionRow {
  sampleid?: string;
  gene_symbol: string;
  value: string;
}

export type Theme = 'dark' | 'light';
export type ViewMode = 'list' | 'enrichment' | 'raw' | 'pubtator' | 'paper';

export interface FilterCondition {
  field: string;
  operator: string;
  value?: number;
  value2?: number;
  boolValue?: boolean;
  stringValue?: string;
}

export interface SortCondition {
  field: string;
  direction: 'asc' | 'desc';
}

export interface GETWeights {
  genetic: number;
  expression: number;
  target: number;
  velocity: number;
}

export interface GeneResult {
  symbol: string;
  mentions: number;
  role: string;
}

export interface ChemicalResult {
  name: string;
  role: string;
}

export interface DrugGeneRelationship {
  drug: string;
  gene: string;
  action: string;
}

export interface PaperAnalysis {
  title: string;
  genes: GeneResult[];
  diseases: string[];
  chemicals: ChemicalResult[];
  variants: string[];
  study_type: string;
  sample_size: number;
  species: string[];
  brain_regions: string[];
  cell_types: string[];
  experimental_models: string[];
  drug_gene_relationships: DrugGeneRelationship[];
  p_value: string;
  fold_change: string;
  odds_ratio: string;
  funding: string[];
  industry_funded: boolean;
  key_finding: string;
  conclusion: string;
}

export interface ResearchContext {
  activeDisease: DiseaseInfo | null;
  targets: Target[];
  enrichment: EnrichmentResult[];
  limit: number;
  currentPage: number;
  focusSymbol: string | null;
  filters: FilterCondition[];
  sorts: SortCondition[];
  globalHiddenMetrics?: string[];
  weights: GETWeights;
  pubtatorResults?: PubTatorResult[];
  pubtatorGenePool?: string[];
  pubtatorPage: number;
  isFetchingPubTator?: boolean;
  paperResults: PaperAnalysis[];
  rpScores?: Record<string, number>;
  winnerScores?: Record<string, number>;
  winnerRawScores?: Record<string, number>;
  rwrSeeds?: string[];
  rwrStatus?: string;
  rwrLoading?: boolean;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  options?: DiseaseInfo[];
  filterOptions?: { label: string; scoreType: string; threshold: number; operator: 'gt' | 'lt' }[];
  toolCall?: string;
}