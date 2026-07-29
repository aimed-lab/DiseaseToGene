// diseaseRegistry.ts ────────────────────────────────────────────────────────────
// Single source of truth for the disease-specific reference cohorts.
//
// Most evidence axes (genetic, safety, druggability, clinical, literature,
// annotation, tissue, patents) work for ANY disease with no configuration. Only
// EXPRESSION and DEPENDENCY need a per-cohort reference table (tumor-vs-normal
// expression; CRISPR dependency for the matching cell-line lineage). This module
// resolves a disease → that cohort config, replacing the old hardcoded /pancrea/
// gate that lived in both enrich paths.
//
// Self-contained (node builtins only) so it is safe in the server chain. Reads
// data/disease_registry.json — the shared config the .mjs build scripts read too.
// Add a cancer by editing that JSON + building its two reference tables.

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AxisRef {
  ref_file: string;          // file under data/, e.g. "expression_paad.json"
  source_label: string;      // provenance string stored on the evidence row
  xena_primary_site?: string;   // expression: Xena Toil _primary_site filter (e.g. "Pancreas")
  xena_tcga_disease?: string;   // expression: optional extra TCGA disease filter for sites with >1 project (e.g. "glioblastoma")
  depmap_lineage?: string;      // dependency: DepMap OncotreeLineage filter (e.g. "Pancreas", "CNS/Brain")
  linkedomics_cohort?: string;  // proteomics: LinkedOmics CPTAC cohort dir (e.g. "CPTAC-PDAC") for build_proteomics.mjs
}

export interface Cohort {
  key: string;               // short id used by the build scripts, e.g. "pdac"
  disease_name: string;
  mondo?: string;
  aliases: string[];         // lowercase substrings matched against the OT disease name
  expression?: AxisRef;
  dependency?: AxisRef;
  proteomics?: AxisRef;           // CPTAC tumor-vs-normal protein log2FC (built like expression)
  cbioportal_study?: string;      // informational; mutation axis resolves its own cohort via evidenceProviders
}

let _cohorts: Cohort[] | null = null;

function load(): Cohort[] {
  if (_cohorts) return _cohorts;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'disease_registry.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    _cohorts = Array.isArray(parsed?.cohorts) ? (parsed.cohorts as Cohort[]) : [];
  } catch {
    _cohorts = [];
  }
  return _cohorts;
}

export function allCohorts(): Cohort[] {
  return load();
}

export function cohortByKey(key: string): Cohort | null {
  const k = String(key || '').toLowerCase();
  return load().find(c => c.key.toLowerCase() === k) || null;
}

// Resolve a disease (by Open Targets name and/or MONDO id) to its cohort config.
// Returns null when no cohort is configured — the caller then skips the
// expression/dependency axis honestly rather than fabricating data.
export function resolveCohort(diseaseName?: string, diseaseId?: string): Cohort | null {
  const name = String(diseaseName || '').toLowerCase();
  const id = String(diseaseId || '').toUpperCase();
  for (const c of load()) {
    if (id && c.mondo && c.mondo.toUpperCase() === id) return c;
    if (name && c.aliases.some(a => name.includes(String(a).toLowerCase()))) return c;
  }
  return null;
}
