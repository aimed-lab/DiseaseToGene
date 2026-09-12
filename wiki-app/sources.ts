// wiki-app/sources.ts — what each evidence source is, and where its LIVE record lives.
//
// EVIDENCE.source_url is empty on every stored row (verified 12 Sep 2026 on #102), so the
// fact badge cannot show a stored link. What it can show is a link to the live source built
// from the gene symbol and the row's own value_json — labelled "live source, not stored", so
// nobody mistakes it for the record the harvest read. The stored row is the evidence; the
// link is a courtesy.
//
// Matching is by prefix of the stored `source` label, longest match first.

export interface SourceInfo {
  key: string;
  name: string;
  what: string;                       // one sentence: what this source can hold
  live: (ctx: { gene: string; vj: any; disease: string }) => string | null;
  liveKind: 'gene page' | 'query' | 'dataset';
}

const q = encodeURIComponent;

const SOURCES: Array<{ prefix: string } & SourceInfo> = [
  { prefix: 'UCSC Xena', key: 'xena', name: 'UCSC Xena (Toil TCGA + GTEx)', liveKind: 'dataset',
    what: 'Tumour-vs-normal mRNA expression: TCGA tumours against GTEx normals, uniformly re-processed (log2 TPM).',
    live: () => 'https://xenabrowser.net/datapages/?dataset=TcgaTargetGtex_rsem_gene_tpm&host=https%3A%2F%2Ftoil.xenahubs.net' },
  { prefix: 'CPTAC', key: 'cptac', name: 'CPTAC proteome (via LinkedOmics)', liveKind: 'dataset',
    what: 'Mass-spectrometry protein abundance in tumour vs normal-adjacent tissue.',
    live: () => 'https://www.linkedomics.org/data_download/CPTAC-PDAC/' },
  { prefix: 'DepMap', key: 'depmap', name: 'DepMap (Chronos gene effect)', liveKind: 'gene page',
    what: 'CRISPR knockout fitness effect across cancer cell lines; negative Chronos means the line needs the gene.',
    live: ({ gene }) => `https://depmap.org/portal/gene/${q(gene)}?tab=overview` },
  { prefix: 'gnomAD', key: 'gnomad', name: 'gnomAD v4 constraint', liveKind: 'gene page',
    what: 'Population loss-of-function constraint (pLI, LOEUF): how badly humans tolerate losing the gene.',
    live: ({ gene }) => `https://gnomad.broadinstitute.org/gene/${q(gene)}?dataset=gnomad_r4` },
  { prefix: 'GTEx', key: 'gtex', name: 'GTEx v8 tissue expression', liveKind: 'gene page',
    what: 'Median expression across 54 normal tissues; tau summarises how tissue-restricted a gene is.',
    live: ({ gene }) => `https://gtexportal.org/home/gene/${q(gene)}` },
  { prefix: 'cBioPortal', key: 'cbioportal', name: 'cBioPortal (TCGA PanCancer Atlas)', liveKind: 'query',
    what: 'Somatic mutation frequency in the disease cohort, with the dominant variants.',
    live: ({ gene, vj }) => `https://www.cbioportal.org/results/mutations?cancer_study_list=${q(String(vj?.study_id || 'paad_tcga_pan_can_atlas_2018'))}&gene_list=${q(gene)}` },
  { prefix: 'Open Targets (target drug trials', key: 'ot-trials', name: 'Open Targets — known drugs', liveKind: 'query',
    what: 'Drugs with a recorded trial against this target, scoped to this disease; phases from ChEMBL.',
    live: ({ gene }) => `https://platform.opentargets.org/search?q=${q(gene)}` },
  { prefix: 'Open Targets (drugAndClinicalCandidates', key: 'ot-druggability', name: 'Open Targets — tractability', liveKind: 'query',
    what: 'Developed compounds and modality tractability buckets for the target.',
    live: ({ gene }) => `https://platform.opentargets.org/search?q=${q(gene)}` },
  { prefix: 'Open Targets (target annotation', key: 'ot-annotation', name: 'Open Targets — target annotation', liveKind: 'query',
    what: 'Approved name, biotype, subcellular location class, pathways, paralogs. Not scored.',
    live: ({ gene }) => `https://platform.opentargets.org/search?q=${q(gene)}` },
  { prefix: 'Open Targets association', key: 'ot-association', name: 'Open Targets — association', liveKind: 'query',
    what: 'The overall disease–target association score that defined the candidate universe.',
    live: ({ gene }) => `https://platform.opentargets.org/search?q=${q(gene)}` },
  { prefix: 'Open Targets', key: 'ot', name: 'Open Targets Platform', liveKind: 'query',
    what: 'Open Targets Platform record for the target.',
    live: ({ gene }) => `https://platform.opentargets.org/search?q=${q(gene)}` },
  { prefix: 'Europe PMC (EPO patent', key: 'epmc-patents', name: 'Europe PMC — patents', liveKind: 'query',
    what: 'Patents in the EPO index that name the gene. Annotation only, not scored.',
    live: ({ gene }) => `https://europepmc.org/search?query=${q(`"${gene}" AND SRC:PAT`)}` },
  { prefix: 'Europe PMC', key: 'epmc', name: 'Europe PMC', liveKind: 'query',
    what: 'Papers mentioning the gene with the disease; the scored value is the share published in the last three years.',
    live: ({ gene, disease }) => `https://europepmc.org/search?query=${q(`"${gene}" AND "${disease}"`)}` },
  { prefix: 'PubMed', key: 'pubmed', name: 'PubMed', liveKind: 'query',
    what: 'PubMed paper counts for the gene with the disease. Annotation only, not scored.',
    live: ({ gene, disease }) => `https://pubmed.ncbi.nlm.nih.gov/?term=${q(`${gene} ${disease}`)}` },
  { prefix: 'STRING', key: 'string', name: 'STRING v12 + WINNER/RWR', liveKind: 'gene page',
    what: 'Protein–protein interaction network; WINNER scores network importance, RWR scores proximity to the top-ranked seeds.',
    live: ({ gene }) => `https://string-db.org/cgi/network?identifiers=${q(gene)}&species=9606` },
  { prefix: 'ClinicalTrials.gov', key: 'ctgov', name: 'ClinicalTrials.gov', liveKind: 'query',
    what: 'Registry record of a trial.',
    live: ({ gene }) => `https://clinicaltrials.gov/search?term=${q(gene)}` },
];

export function sourceInfo(sourceLabel: string | null | undefined): SourceInfo | null {
  const s = String(sourceLabel || '');
  let best: (typeof SOURCES)[number] | null = null;
  for (const c of SOURCES) if (s.startsWith(c.prefix) && (!best || c.prefix.length > best.prefix.length)) best = c;
  return best;
}

export const trialUrl = (nct: string) => /^NCT\d{8}$/i.test(nct) ? `https://clinicaltrials.gov/study/${nct.toUpperCase()}` : null;
export const pmidUrl = (id: string) => { const m = String(id).match(/(\d{5,9})/); return m ? `https://pubmed.ncbi.nlm.nih.gov/${m[1]}/` : null; };
export const commitUrl = (sha: string) => sha ? `https://github.com/aimed-lab/DiseaseToGene/commit/${sha}` : null;
export const scriptUrl = (script: string, sha: string) => { const p = String(script).split(/\s+/)[0]; return p && sha ? `https://github.com/aimed-lab/DiseaseToGene/blob/${sha}/${p}` : null; };
