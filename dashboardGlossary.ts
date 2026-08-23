// dashboardGlossary.ts ────────────────────────────────────────────────────────
// The single source of truth for what every dashboard term MEANS: definition, range,
// formula, data source, evidence level and the caveat needed to not misread it.
//
// Used two ways:
//   • glossaryPromptBlock() is injected into the AI co-pilot's system prompt, so the chat
//     can answer "what is LOEUF?", "what range is tau?", "where does the Drugs column come
//     from?", "what's the score formula?" from FACTS, not guesses.
//   • The same entries can back UI tooltips later (one definition, one place to maintain).
//
// Keep this honest and in sync with the harvest/scoring code — it is documentation of what
// the app actually computes, not marketing.

export interface GlossaryEntry {
  term: string;
  abbr?: string;                 // the abbreviation, if the term IS one (LOEUF, pLI, tau…)
  aliases?: string[];            // other ways a user might name it (column header, synonym)
  category: 'column' | 'axis' | 'metric' | 'abbreviation' | 'concept';
  definition: string;
  range?: string;                // valid/typical range and what the ends mean
  formula?: string;              // how it is computed, when there is one
  source: string;                // where the value comes from
  level?: 'fact' | 'prediction' | 'annotation';
  caveat?: string;               // the thing a reader needs to not misread it
}

export const GLOSSARY: GlossaryEntry[] = [
  // ── scores / ranking ──
  { term: 'Score', category: 'column', aliases: ['overall score', 'composite'],
    definition: 'The funnel composite that ranks targets — a weighted arithmetic mean of the externally-normalised evidence axes, minus bounded risk penalties.',
    range: '0–1; higher = stronger overall target profile.', source: 'Disease2Target funnel engine', level: 'prediction',
    caveat: 'A ranking aid, not a probability. Composed of the axes below; no single axis decides it.' },
  { term: 'GET score', abbr: 'GET', category: 'metric', aliases: ['get_score', 'open targets association'],
    definition: 'Open Targets overall gene–disease association used for eligibility.',
    range: '0–1.', formula: 'Aggregate of all Open Targets datatypes (genetic, somatic, literature, clinical…).', source: 'Open Targets', level: 'fact',
    caveat: 'Used for eligibility only, never scored — it double-counts the somatic-mutation axis. NOT the same number as the Target List GET composite below, despite sharing the name.' },
  // The browser-side namesake. It exists (api.ts computes it on every target the
  // Target List loads) and users see it, so the reference has to name it — otherwise
  // "what is the GET score?" has two true answers and no way to tell them apart.
  { term: 'Target List GET composite', abbr: 'GET (Target List)', category: 'metric',
    aliases: ['get composite', 'target list get', 'getscore', 'GET weights'],
    definition: 'D2T’s own weighted blend of the three GET axes, computed in the browser for each target as it loads. A DIFFERENT number from the stored GET score, which is the Open Targets association.',
    range: '0–1.', formula: 'genetic × 0.50 + expression × 0.25 + target × 0.25 (api.ts). Re-weighted live when the user changes the GET weights.',
    source: 'Disease2Target, computed client-side', level: 'prediction',
    caveat: 'Exists only in the loaded Target List — it is never written to a snapshot, so it will not match the GET score shown on the Ranking Board or in a dossier.' },
  { term: 'Rank', category: 'column', definition: 'The target’s position in this snapshot after scoring.', range: '1 = top.', source: 'Disease2Target', level: 'fact' },

  // ── genetic / mutation ──
  { term: 'Genetic association', abbr: 'G1', category: 'axis', aliases: ['genetic_score'],
    definition: 'Germline/genetic link between the gene and the disease.', range: '0–1.', source: 'Open Targets genetic_association datatype', level: 'fact',
    caveat: 'Near zero for pure somatic drivers (e.g. KRAS) — that is honest, not missing.' },
  { term: 'Mutation frequency', category: 'metric', aliases: ['frequency', 'mutated %'],
    definition: 'Fraction of the tumour cohort with a somatic mutation in this gene.',
    range: '0–1 (shown as %).', formula: 'mutated_samples / total_samples in the cohort.', source: 'cBioPortal (TCGA PanCancer cohort)', level: 'fact' },
  { term: 'Dominant variant', category: 'metric', definition: 'The most frequent specific amino-acid change seen (e.g. KRAS G12D).', source: 'cBioPortal', level: 'fact' },

  // ── expression ──
  { term: 'log2FC', abbr: 'log2FC', category: 'metric', aliases: ['tumour vs normal', 'fold change', 'expression'],
    definition: 'Log2 fold-change of tumour vs normal-tissue expression. Positive = over-expressed, negative = under-expressed.',
    formula: 'log2(median tumour) − log2(median normal), on log2(TPM+0.001).', source: 'UCSC Xena Toil — TCGA tumour vs GTEx normal', level: 'fact',
    caveat: 'Genes not expressed in normal tissue sit at the pseudocount floor (−9.966), so a large log2FC there is a denominator artifact — those are flagged low-confidence and capped.' },

  // ── dependency ──
  { term: 'Chronos', abbr: 'Chronos', category: 'metric', aliases: ['dependency', 'CRISPR dependency'],
    definition: 'CRISPR gene-effect score — how much cancer cell lines need the gene to survive.',
    range: 'Typically −3 to +1. More negative = more essential; around −1 is a strong dependency; ~0 = not needed.', source: 'DepMap (Chronos, pancreas lineage)', level: 'fact' },
  { term: 'Dependent cell lines', category: 'metric', aliases: ['frac_dependent'],
    definition: 'Share of tested cell lines that depend on the gene.', range: '0–100%.', source: 'DepMap', level: 'fact' },
  { term: 'Common-essential', abbr: 'E', category: 'metric', aliases: ['pan-essential', 'E marker', 'housekeeping'],
    definition: 'The gene is essential across most cell lines, not selectively in the tumour.',
    range: 'yes / no (shown as an “E” chip).', source: 'Open Targets depMapEssentiality', level: 'fact',
    caveat: 'Critical: a strong Chronos on a common-essential gene is housekeeping, NOT tumour selectivity. Filter these out with the “Not pan-essential” chip.' },

  // ── safety ──
  { term: 'LOEUF', abbr: 'LOEUF', category: 'abbreviation', aliases: ['loss-of-function o/e upper', 'constraint'],
    definition: 'Loss-of-function Observed/Expected Upper bound Fraction — how intolerant the gene is to being knocked out.',
    range: '~0–2. LOW = intolerant to loss-of-function = a safety flag (drugging it may harm healthy cells); high = tolerant.', source: 'gnomAD v4 API', level: 'fact',
    caveat: 'A bounded risk penalty in the score, never a hard gate. Values above ~2 are artifacts and are dropped.' },
  { term: 'pLI', abbr: 'pLI', category: 'abbreviation', definition: 'Probability of being loss-of-function intolerant.',
    range: '0–1; near 1 = very intolerant.', source: 'gnomAD v4', level: 'fact' },
  { term: 'oe_lof / lof_z / mis_z', category: 'metric',
    definition: 'Fuller gnomAD constraint: observed/expected LoF, and the LoF and missense Z-scores (higher Z = more constrained).', source: 'gnomAD v4 API', level: 'fact' },
  { term: 'Safety liabilities', category: 'metric',
    definition: 'Recorded adverse events / organ-system effects associated with the target.', source: 'Open Targets safetyLiabilities', level: 'fact',
    caveat: 'Real recorded events — a stronger “why not to pursue” than inferring safety from a genetic proxy alone.' },

  // ── tissue ──
  { term: 'Tissue specificity', abbr: 'tau', category: 'column', aliases: ['tau', 'tissue tau'],
    definition: 'Yanai tissue-specificity index — is the gene restricted to a few tissues, or expressed everywhere?',
    range: '0–1. 0 = expressed evenly everywhere (a safety concern — drugging it hits every tissue); 1 = restricted to one or a few tissues (a cleaner target). ≥0.6 shown in green.',
    formula: 'tau = Σ(1 − xᵢ/x_max) / (n−1) over n tissues, on log2(TPM+1).', source: 'GTEx v8 median TPM by tissue', level: 'fact' },

  // ── druggability ──
  { term: 'Druggability', category: 'axis', aliases: ['status', 'label'],
    definition: 'Whether/how the target can be drugged. Labels: Clinically Validated, In Clinical Development, Preclinical Only, No Drug Data Found.',
    source: 'Open Targets (drugAndClinicalCandidates + tractability)', level: 'fact',
    caveat: 'The developed-drug count is a fact but is NEVER gated on — that would reward crowded targets and delete novel ones.' },
  { term: 'Developed drugs', category: 'column', aliases: ['drugs', 'n_drugs'],
    definition: 'Number of drugs (any indication) developed against this target.', range: '0+.', source: 'Open Targets', level: 'fact' },
  { term: 'Tractable modalities', category: 'column', aliases: ['tractable'],
    definition: 'How many modality types (small molecule, antibody, PROTAC, other) are ASSESSED as feasible against the target.',
    range: '0–4.', source: 'Open Targets tractability', level: 'prediction',
    caveat: 'The only druggability signal safe to gate on. Powers the “Novel & tractable” chip (no drug, no trial, but ≥1 tractable modality).' },
  { term: 'Modality', category: 'concept', aliases: ['SM', 'AB', 'PR', 'OC', 'ADC'],
    definition: 'The kind of molecule: SM = small molecule, AB = antibody, ADC = antibody-drug conjugate, PR = PROTAC/degrader, OC = other/clinical precedence.',
    source: 'Open Targets', level: 'fact',
    caveat: 'Antibodies/ADCs only reach surface or secreted proteins; an intracellular target needs a small molecule or degrader.' },
  { term: 'Chemical probes / TEP', abbr: 'TEP', category: 'metric',
    definition: 'Tool compounds (chemical probes) and Target Enabling Packages — reagents/assays that exist to work on the target experimentally.', source: 'Open Targets', level: 'fact' },

  // ── clinical ──
  { term: 'Drugs in disease trials', category: 'column', aliases: ['trials', 'n_disease_trials', 'clinical'],
    definition: 'Drugs hitting this target that have at least one registered trial IN THIS DISEASE.',
    source: 'Open Targets target→drug→trial graph (disease-scoped)', level: 'fact',
    caveat: 'Replaces a ClinicalTrials.gov free-text search that had no gene field (it scored renin 234 “trials” for pancreatic). 0 = no clinical precedent yet — a neutral novelty signal, not a negative.' },
  { term: 'Max phase in disease', category: 'metric', aliases: ['P1/P2/P3', 'phase'],
    definition: 'Highest trial phase reached by those disease trials (1–4).', range: 'Phase 1–4.', source: 'Open Targets clinicalReports.trialPhase', level: 'fact',
    caveat: 'Read per-trial in THIS disease — never the drug’s global approval. Dasatinib is approved for leukaemia but only Phase 2 in pancreatic.' },
  { term: 'Stopped trials', category: 'metric', aliases: ['n_stopped_trials', 'why stopped'],
    definition: 'Trials that were halted, with the reason (e.g. toxicity vs business).', source: 'Open Targets trialWhyStopped / trialStopReasonCategories', level: 'fact',
    caveat: 'A trial stopped for toxicity is a very different signal from one dropped for business reasons — open the dossier to see which.' },

  // ── literature ──
  { term: 'Publications', category: 'column', aliases: ['papers', 'n_publications', 'paper_count'],
    definition: 'Count of papers co-mentioning the gene and disease.', range: '0+.', source: 'Europe PMC', level: 'fact' },
  { term: 'Velocity', category: 'column', aliases: ['momentum', 'recent share'],
    definition: 'Share of the target’s disease papers published in the last ~3 years — research momentum.',
    range: '0–100%.', formula: 'recent_papers / total_papers.', source: 'Europe PMC', level: 'annotation',
    caveat: 'Attention, not biological strength. Below ~5 papers the ratio is unstable and left unscored (low-confidence).' },
  { term: 'Europe PMC vs PubMed', abbr: 'EPMC', category: 'concept',
    definition: 'Europe PMC (full-text) is the single SCORING source for the literature axis; PubMed is kept as a precise per-paper annotation only.',
    source: 'Europe PMC / PubMed', level: 'fact',
    caveat: 'PubMed is rate-limited and ~20× smaller, so its velocity sits on a tiny denominator — it is shown but never scored.' },

  // ── patents ──
  { term: 'Patents', category: 'column', aliases: ['n_patents', 'gene_patents'],
    definition: 'Number of patents naming the gene — how commercially worked the target is.', range: '0+.', source: 'Europe PMC EPO patent index', level: 'annotation',
    caveat: 'Context ONLY, never scored. A high count means a crowded, already-owned area; rewarding it would bias against the novel targets we most want.' },

  // ── annotation / identity ──
  { term: 'Target class', category: 'column', aliases: ['class'],
    definition: 'Protein family (e.g. kinase, GPCR, ion channel).', source: 'Open Targets targetClass', level: 'fact',
    caveat: 'Family largely decides which modality is even possible.' },
  { term: 'Function', category: 'metric',
    definition: 'What the protein does — its biological role.', source: 'Open Targets (UniProt functionDescriptions)', level: 'fact' },
  { term: 'Subcellular location', category: 'metric', aliases: ['surface_or_secreted', 'antibody-reachable'],
    definition: 'Where the protein sits (surface, secreted, nuclear, cytosolic…).', source: 'Open Targets subcellularLocations', level: 'fact',
    caveat: 'Only surface/secreted proteins are reachable by antibodies or ADCs — the “Antibody-reachable” chip filters on this.' },
  { term: 'UniProt / Ensembl id', category: 'metric',
    definition: 'Cross-reference identifiers linking the entry to UniProt/PDB (protein) and Ensembl (gene).', source: 'Open Targets', level: 'fact' },
  { term: 'Paralogs', category: 'metric',
    definition: 'Close gene relatives that can compensate for loss.', source: 'Open Targets homologues', level: 'fact',
    caveat: 'A close paralog is a common reason a real target shows a weak knockout phenotype.' },

  // ── quality / concepts ──
  { term: 'Evidence completeness', category: 'column', aliases: ['completeness', 'evidence bar', 'axes'],
    definition: 'How many of the 9 evidence axes have real data for this gene.', range: '0–9 (bar: green ≥7, amber ≥4, red below).', source: 'Disease2Target', level: 'fact',
    caveat: 'Sparse ≠ weak. A gene missing an axis was not necessarily assessed and rejected — it may simply not have been harvested.' },
  { term: 'Fact / Prediction / Annotation', category: 'concept',
    definition: 'Every attribute is tagged: FACT = a record of what happened (a drug exists, a trial ran); PREDICTION = a forward-looking assessment (tractability, druggable pocket); ANNOTATION = context that must never drive a score (patents, momentum).',
    source: 'Disease2Target data model', level: 'fact' },
  { term: 'Three-state / not-fetched', category: 'concept',
    definition: 'A value is one of: real value, genuinely-none, or NOT-FETCHED. “Not fetched” is never shown as a zero.',
    source: 'Disease2Target data model', level: 'fact',
    caveat: 'Collapsing “not fetched” into “zero” is what previously produced ~336 druggability false negatives.' },
  { term: 'Legacy vs v2', category: 'concept', aliases: ['legacy chip'],
    definition: 'A “legacy” gene has evidence written before the 2026-07 fixes, where a column meant something different (druggability was a ChEMBL bioactivity count, clinical was a text-match).',
    source: 'Disease2Target', level: 'annotation',
    caveat: 'Legacy values are demoted, excluded from headline counters, and labelled — never shown as current numbers. Re-enrich to refresh them.' },
  { term: 'Novel & tractable', category: 'concept',
    definition: 'The discovery query: no developed drug AND no disease trial, but ≥1 tractable modality — a druggable handle no one has pursued yet.',
    source: 'Disease2Target dashboard filter' },
  { term: 'ROC-AUC', abbr: 'ROC-AUC', category: 'abbreviation',
    definition: 'Benchmark grade — how well the funnel ranks known drug targets to the top.',
    range: '0.5 = chance, 1.0 = perfect. Snapshot #84 scored 0.739 (honest, leakage-safe).', source: 'Disease2Target benchmark', level: 'fact' },
  { term: 'EFO / MONDO', category: 'abbreviation',
    definition: 'Disease ontology identifiers (e.g. pancreatic adenocarcinoma = MONDO_0006047) used to scope evidence to the disease and its descendants.', source: 'Open Targets / MONDO', level: 'fact' },
];

// Compact one-line-per-term reference for the AI system prompt. Deterministic, ~single line
// each, so the co-pilot answers term/range/formula/source questions from facts, not guesses.
export function glossaryPromptBlock(): string {
  const line = (e: GlossaryEntry) => {
    const name = e.term + (e.abbr && e.abbr !== e.term ? ` (${e.abbr})` : '');
    const bits = [e.definition];
    if (e.range) bits.push(`Range: ${e.range}`);
    if (e.formula) bits.push(`Formula: ${e.formula}`);
    bits.push(`Source: ${e.source}`);
    if (e.level) bits.push(`Level: ${e.level}`);
    if (e.caveat) bits.push(`Caveat: ${e.caveat}`);
    return `- ${name}: ${bits.join(' · ')}`;
  };
  return GLOSSARY.map(line).join('\n');
}
