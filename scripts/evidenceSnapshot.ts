// scripts/evidenceSnapshot.ts ─────────────────────────────────────────────────
// The evidence snapshot: freeze what the eight upstream APIs said, once, so every
// downstream analysis replays the SAME evidence offline instead of re-fetching it.
//
// Why this exists (and why it is the critical path for v3):
//
//   • The evidence behind the published numbers was never persisted. The service
//     caches in memory only (modalityFitService.ts) and the benchmark wrote tiers,
//     never the evidence those tiers were derived from. Re-deriving a claim meant
//     another ~3.5 h of network — against upstream data that had since moved.
//
//   • Each Phase-B configuration (per-gate ablation, counterfactual goal, L3) is
//     another full pass. Twenty hours of fetching, and — worse — each configuration
//     would see slightly different upstream data, which makes an ablation TABLE
//     internally inconsistent: the rows would differ by evidence as well as by gate.
//
// One gather, one file, every later analysis deterministic and in seconds.
//
// FORMAT: JSONL, one gene per line, appended as the gather proceeds. Not one big
// JSON array — a 3.5 h run that dies at gene 300 must not lose 300 genes of network.
// `--resume` picks up from what is already on disk.
//
// The manifest is written beside it: rule version, git SHA, source URLs, retrieval
// window, and a SHA-256 per gene plus one over the whole file. Redistribution note:
// this stores DERIVED counts and descriptors, not upstream records; DoGSite /
// ProteinsPlus is academic-use, which is why the manifest names it explicitly.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RULE_VERSION } from '../modalityConstants.js';
import { gatherModalityEvidence, type ModalityEvidence } from '../modalityFitService.js';

export const DEFAULT_SNAPSHOT = path.join(process.cwd(), 'deliverables', 'evidence_snapshot.jsonl');
const manifestPathFor = (p: string) => p.replace(/\.jsonl?$/i, '') + '_manifest.json';

/** The upstream services gatherModalityEvidence reads. Named here so the manifest
 *  states provenance and licence rather than leaving a reader to grep for URLs. */
export const EVIDENCE_SOURCES = [
  { name: 'Open Targets Platform', use: 'tractability buckets, known drugs', endpoint: 'https://api.platform.opentargets.org/api/v4/graphql', licence: 'CC0 1.0' },
  { name: 'UniProtKB', use: 'localization, topology, sequence, active sites, Ubl conjugation', endpoint: 'https://rest.uniprot.org/uniprotkb/search', licence: 'CC BY 4.0' },
  { name: 'ProteinsPlus / DoGSiteScorer', use: 'pocket descriptors', endpoint: 'https://proteins.plus/api/v2', licence: 'ACADEMIC USE — not redistributed; derived descriptors only' },
  { name: 'Human Protein Atlas', use: 'surface / secreted corroboration', endpoint: 'https://www.proteinatlas.org/api/search_download.php', licence: 'CC BY-SA 3.0' },
  { name: 'ChEMBL', use: 'measured bioactivity counts', endpoint: 'https://www.ebi.ac.uk/chembl/api/data', licence: 'CC BY-SA 3.0' },
  { name: 'STRING', use: 'high-confidence interaction partner count (score >= 700)', endpoint: 'https://string-db.org/api/json/interaction_partners', licence: 'CC BY 4.0' },
  { name: 'Ensembl REST', use: 'canonical-transcript exon count', endpoint: 'https://rest.ensembl.org/lookup/symbol/homo_sapiens', licence: 'Apache 2.0 / no restriction' },
  { name: 'RCSB PDB / AlphaFold DB', use: 'structure selection for pocket detection', endpoint: 'https://files.rcsb.org and https://alphafold.ebi.ac.uk/api/prediction', licence: 'CC0 1.0 / CC BY 4.0' },
] as const;

export interface SnapshotRow {
  gene: string;
  gatheredAt: string;
  ok: boolean;
  error?: string;
  ev: ModalityEvidence | null;
}

// ── Provenance ───────────────────────────────────────────────────────────────
// A number in the paper has to be traceable to the rules that produced it. The rule
// version alone is a promise; the SHA is the proof. `dirty` is recorded rather than
// suppressed — a run made against uncommitted edits is reproducible only by whoever
// had that working tree, and the output should say so out loud.
export interface Provenance {
  ruleVersion: string;
  gitSha: string | null;
  gitDirty: boolean;
  node: string;
  generatedAt: string;
}
const git = (...args: string[]): string | null => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
export function provenance(): Provenance {
  const status = git('status', '--porcelain');
  return {
    ruleVersion: RULE_VERSION,
    gitSha: git('rev-parse', 'HEAD'),
    gitDirty: status == null ? false : status.length > 0,
    node: process.version,
    generatedAt: new Date().toISOString(),
  };
}

/** Stable stringify — key order must not change a hash, or the manifest detects
 *  serialisation noise as evidence drift and every hash comparison is worthless. */
function canonical(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export const hashEvidence = (ev: any) => createHash('sha256').update(canonical(ev)).digest('hex');

// ── Writing ──────────────────────────────────────────────────────────────────

export class SnapshotWriter {
  private fd: number;
  private readonly rows: { gene: string; sha256: string; ok: boolean; gatheredAt: string }[] = [];
  readonly startedAt = new Date().toISOString();

  constructor(readonly file: string = DEFAULT_SNAPSHOT, append = false) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (append) {
      // Carry forward what a previous, interrupted run already gathered, so the
      // manifest describes the whole file rather than only this session's slice.
      for (const line of (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n')) {
        if (!line.trim()) continue;
        try {
          const r: SnapshotRow = JSON.parse(line);
          this.rows.push({ gene: r.gene, sha256: r.ok ? hashEvidence(r.ev) : '', ok: r.ok, gatheredAt: r.gatheredAt });
        } catch { /* half-written final line from a killed run */ }
      }
    }
    this.fd = fs.openSync(file, append ? 'a' : 'w');
  }

  write(row: SnapshotRow): void {
    // One line, flushed per gene: a killed run keeps everything gathered so far.
    fs.writeSync(this.fd, JSON.stringify(row) + '\n');
    this.rows.push({ gene: row.gene, sha256: row.ok ? hashEvidence(row.ev) : '', ok: row.ok, gatheredAt: row.gatheredAt });
  }

  /** Close and write the manifest. `extra` carries run-specific facts (gold-set
   *  version, gene selection) that belong with the evidence, not beside it. */
  finalise(extra: Record<string, unknown> = {}): string {
    fs.closeSync(this.fd);
    const bytes = fs.readFileSync(this.file);
    const manifest = {
      ...provenance(),
      snapshot: path.basename(this.file),
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      genes: this.rows.length,
      resolved: this.rows.filter(r => r.ok).length,
      failed: this.rows.filter(r => !r.ok).map(r => r.gene),
      fileSha256: createHash('sha256').update(bytes).digest('hex'),
      fileBytes: bytes.length,
      sources: EVIDENCE_SOURCES,
      redistribution: 'Derived counts and descriptors only. No upstream records are redistributed. '
        + 'DoGSiteScorer / ProteinsPlus is academic-use; pocket descriptors here are derived values, not its output records.',
      perGene: this.rows,
      ...extra,
    };
    const dest = manifestPathFor(this.file);
    fs.writeFileSync(dest, JSON.stringify(manifest, null, 2));
    return dest;
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

export function loadSnapshot(file: string = DEFAULT_SNAPSHOT): Map<string, ModalityEvidence> {
  if (!fs.existsSync(file)) {
    throw new Error(`No evidence snapshot at ${file}. Produce one with: npx tsx --env-file=.env scripts/modalityGoldsetBenchmark.ts`);
  }
  const out = new Map<string, ModalityEvidence>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row: SnapshotRow = JSON.parse(line);
    if (row.ok && row.ev) out.set(row.gene.toUpperCase(), row.ev);
  }
  return out;
}

/** Genes already on disk — what `--resume` skips. Unlike loadSnapshot this counts
 *  failed rows too: a gene that failed was attempted, and a resume that retried
 *  every failure would never converge on a flaky upstream. */
export function snapshotGenes(file: string = DEFAULT_SNAPSHOT): Set<string> {
  const seen = new Set<string>();
  if (!fs.existsSync(file)) return seen;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { seen.add((JSON.parse(line) as SnapshotRow).gene.toUpperCase()); } catch { /* half-written final line */ }
  }
  return seen;
}

/**
 * The one call every analysis script should use to obtain evidence.
 *
 * Networked by default; snapshot-backed when `--from-snapshot` is passed. A
 * snapshot-backed source is a pure lookup: it never falls back to the network,
 * because a silent fallback would make a "deterministic replay" quietly partly
 * live, and the difference would show up later as an unexplained number.
 */
export function evidenceSource(argv: string[] = process.argv): {
  fromSnapshot: boolean;
  file: string;
  get: (gene: string) => Promise<ModalityEvidence>;
  genes: string[] | null;
} {
  const i = argv.indexOf('--from-snapshot');
  const flagged = i >= 0;
  const next = flagged ? argv[i + 1] : undefined;
  const file = next && !next.startsWith('--') ? path.resolve(next) : DEFAULT_SNAPSHOT;
  if (!flagged) {
    return { fromSnapshot: false, file, genes: null, get: (gene) => gatherModalityEvidence(gene) };
  }
  const snap = loadSnapshot(file);
  return {
    fromSnapshot: true, file, genes: [...snap.keys()].sort(),
    get: async (gene: string) => {
      const ev = snap.get((gene || '').toUpperCase());
      if (!ev) throw new Error(`${gene} is not in the snapshot ${path.basename(file)}`);
      return ev;
    },
  };
}
