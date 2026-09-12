/// <reference types="vite/client" />
// wiki-app/content.ts — the Markdown layer of the provenance wiki.
//
// Everything under wiki/**/*.md is bundled at build time (import.meta.glob, raw), so the
// narrative layer needs no server and no runtime file access. It is versioned by APP COMMIT
// (NARRATIVE_COMMIT below), while the data layer is versioned by SNAPSHOT ID — every page
// shows both, so a reader always knows which layer a sentence came from.
//
// Three kinds of file live there:
//   wiki/docs/<slug>.md          authored pages — methodology, provenance, how to read
//   wiki/diseases/<slug>.md      a disease's narrative, matched by `mondo` front-matter
//   wiki/lineage/<snapshot>.md   a RECONSTRUCTED lineage record for an old snapshot; used
//                                only when the snapshot's own provenance has no runs[]
//
// Rule (docs/PLAN_Provenance_Wiki_and_Autonomous_Agent.md §0.5): reader-facing Markdown lives
// under wiki/ only. docs/ is internal and is never globbed here.
import YAML from 'yaml';
import { wikiSlug } from '../nav';

declare const __GIT_COMMIT__: string;
export const NARRATIVE_COMMIT: string = typeof __GIT_COMMIT__ === 'string' ? __GIT_COMMIT__ : 'dev';

const RAW = import.meta.glob('../wiki/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export type WikiDocKind = 'doc' | 'disease' | 'lineage' | 'other';
export interface WikiDoc {
  path: string;                 // repo path, e.g. wiki/docs/methodology.md
  kind: WikiDocKind;
  slug: string;                 // file name without extension
  title: string;                // front.title, else first H1, else slug
  front: Record<string, any>;   // YAML front-matter (may be empty)
  body: string;                 // Markdown after the front-matter
}

function parseFrontMatter(raw: string): { front: Record<string, any>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { front: {}, body: raw };
  let front: any = {};
  try { front = YAML.parse(m[1]) ?? {}; } catch (e) { front = { _parse_error: String((e as any)?.message || e) }; }
  return { front: typeof front === 'object' && front ? front : {}, body: raw.slice(m[0].length) };
}

function kindOf(path: string): WikiDocKind {
  if (/^wiki\/docs\//.test(path)) return 'doc';
  if (/^wiki\/diseases\//.test(path)) return 'disease';
  if (/^wiki\/lineage\//.test(path)) return 'lineage';
  return 'other';
}

const DOCS: WikiDoc[] = Object.entries(RAW).map(([p, raw]) => {
  const path = p.replace(/^(\.\.\/)+/, '');
  const { front, body } = parseFrontMatter(raw);
  const slug = path.replace(/^.*\//, '').replace(/\.md$/i, '');
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return { path, kind: kindOf(path), slug, title: String(front.title || h1 || slug), front, body };
});

export const allDocs = (): WikiDoc[] => DOCS;

// Authored pages, in front-matter `order` then title.
export function authoredDocs(): WikiDoc[] {
  return DOCS.filter(d => d.kind === 'doc').sort((a, b) => (Number(a.front.order ?? 999) - Number(b.front.order ?? 999)) || a.title.localeCompare(b.title));
}
export const docBySlug = (slug: string): WikiDoc | null => DOCS.find(d => d.kind === 'doc' && d.slug === slug) ?? null;

// A disease narrative is matched by MONDO id first, then by the slug of the disease name.
export function diseaseNarrative(diseaseName: string | null | undefined, diseaseId?: string | null): WikiDoc | null {
  const id = String(diseaseId || '').toUpperCase();
  const slug = wikiSlug(diseaseName || '');
  return DOCS.find(d => d.kind === 'disease' && (id && String(d.front.mondo || '').toUpperCase() === id))
      ?? DOCS.find(d => d.kind === 'disease' && (d.slug === slug || wikiSlug(String(d.front.disease_name || '')) === slug))
      ?? null;
}

// ── Lineage ───────────────────────────────────────────────────────────────────
// One run = one script invocation that produced one axis of one snapshot. The record answers
// "what did we do to the source to get this number": script, commit, parameters, source
// version, when. The fact badge on a row answers the other question (where it came from).
export type LineageConfidence = 'high' | 'medium' | 'low';
export interface LineageRun {
  id: string;
  axis: string;
  evidence_type: string | null;
  script: string;
  commit: string;
  commit_note?: string;
  ran_at: string;
  source: string;
  source_version?: string;
  params?: Record<string, any>;
  confidence?: LineageConfidence;
  note?: string;
}
export interface LineageRecord {
  snapshot: number;
  // 'recorded'      — written by the harvest itself into snapshot.provenance.runs (the store)
  // 'reconstructed' — written by a person after the fact, from git history (wiki/lineage/<id>.md)
  kind: 'recorded' | 'reconstructed';
  runs: LineageRun[];
  path?: string;               // the repo file, when reconstructed
  reconstructed_on?: string;
  reconstructed_by?: string;
  reconstructed_from?: string;
  body?: string;               // the file's Markdown explanation, when reconstructed
}

const normaliseRun = (r: any, i: number): LineageRun => ({
  id: String(r?.id || `run-${i + 1}`),
  axis: String(r?.axis || r?.evidence_type || '?'),
  evidence_type: r?.evidence_type == null ? null : String(r.evidence_type),
  script: String(r?.script || ''),
  commit: String(r?.commit || ''),
  commit_note: r?.commit_note ? String(r.commit_note) : undefined,
  ran_at: String(r?.ran_at || r?.fetched_at || ''),
  source: String(r?.source || ''),
  source_version: r?.source_version ? String(r.source_version) : undefined,
  params: r?.params && typeof r.params === 'object' ? r.params : undefined,
  confidence: (['high', 'medium', 'low'] as const).includes(r?.confidence) ? r.confidence : undefined,
  note: r?.note ? String(r.note) : undefined,
});

export function lineageFile(snapshot: number): LineageRecord | null {
  const d = DOCS.find(x => x.kind === 'lineage' && Number(x.front.snapshot) === snapshot);
  if (!d || !Array.isArray(d.front.runs)) return null;
  return {
    snapshot, kind: 'reconstructed', runs: d.front.runs.map(normaliseRun), path: d.path,
    reconstructed_on: d.front.reconstructed_on ? String(d.front.reconstructed_on) : undefined,
    reconstructed_by: d.front.reconstructed_by ? String(d.front.reconstructed_by) : undefined,
    reconstructed_from: d.front.reconstructed_from ? String(d.front.reconstructed_from) : undefined,
    body: d.body,
  };
}

// Oracle first, file second. The store's own record always wins; the file is the backfill
// path for snapshots harvested before enrich wrote runs[] by construction.
export function resolveLineage(snapshot: number, provenance: any): LineageRecord | null {
  const runs = provenance && Array.isArray(provenance.runs) ? provenance.runs : null;
  if (runs && runs.length) return { snapshot, kind: 'recorded', runs: runs.map(normaliseRun) };
  return lineageFile(snapshot);
}

export const runForEvidenceType = (lineage: LineageRecord | null, evidenceType: string): LineageRun | null =>
  lineage?.runs.find(r => r.evidence_type === evidenceType) ?? null;
export const runById = (lineage: LineageRecord | null, id: string): LineageRun | null =>
  lineage?.runs.find(r => r.id === id) ?? null;
