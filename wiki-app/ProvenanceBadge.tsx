// wiki-app/ProvenanceBadge.tsx — the two layers of provenance, on one line, on every fact.
//
//   fact badge     where the number came from: source · live link · retrieved · generated_by · audit
//   lineage badge  what was done to it: run id · script · commit — and whether that record was
//                  RECORDED by the harvest or RECONSTRUCTED by a person afterwards
//
// The distinction is never hidden: a reconstructed run is amber and says so; a recorded one is
// green. A row with no run at all says "no lineage" rather than showing nothing.
import React from 'react';
import { ExternalLink, GitCommit, Clock, ShieldQuestion, ShieldCheck, Bot, User, FileSearch } from 'lucide-react';
import { wikiUrl, wikiSlug } from '../nav';
import { WLink } from './WLink';
import { sourceInfo } from './sources';
import type { LineageRun, LineageRecord } from './content';
import type { WikiEvidenceRow } from './wikiApi';

export interface ProvenanceBadgeProps {
  row: WikiEvidenceRow;
  run: LineageRun | null;
  lineage: LineageRecord | null;
  disease: string;
  snapshot: number;
  isDark: boolean;
  compact?: boolean;
}

const fmtDate = (s?: string | null) => (s ? String(s).replace('T', ' ').slice(0, 16) : null);

export function ProvenanceBadge({ row, run, lineage, disease, snapshot, isDark, compact }: ProvenanceBadgeProps) {
  const info = sourceInfo(row.source);
  const live = info?.live({ gene: row.gene_symbol, vj: row.value_json, disease }) ?? null;
  const chip = `inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-4 border ${isDark ? 'border-white/10 bg-white/[0.04] text-neutral-300' : 'border-black/10 bg-black/[0.03] text-neutral-700'}`;
  const kindChip = lineage?.kind === 'recorded'
    ? `${chip} ${isDark ? 'border-emerald-500/40 text-emerald-300' : 'border-emerald-600/40 text-emerald-800'}`
    : `${chip} ${isDark ? 'border-amber-500/40 text-amber-300' : 'border-amber-600/40 text-amber-800'}`;
  const audit = row.audit_status || 'not_audited';
  const AuditIcon = audit === 'human_verified' || audit === 'ai_verified' ? ShieldCheck : ShieldQuestion;
  const GenIcon = row.generated_by === 'agent' ? Bot : row.generated_by === 'human' ? User : FileSearch;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* fact badge */}
      <WLink to={wikiUrl.entity(disease, snapshot, 'source', wikiSlug(row.source))} className={`${chip} hover:underline`} title={info?.what || row.source}>
        {info?.name || row.source}
      </WLink>
      {live && (
        <a href={live} target="_blank" rel="noreferrer" className={`${chip} hover:underline`} title={`Live ${info?.liveKind || 'link'} at the source today — NOT the stored record the harvest read`}>
          <ExternalLink className="w-3 h-3" /> live{compact ? '' : ` · ${info?.liveKind}`}
        </a>
      )}
      {row.retrieved_at && (
        <span className={chip} title="EVIDENCE.retrieved_at — when this row was written by the harvest">
          <Clock className="w-3 h-3" /> {fmtDate(row.retrieved_at)}
        </span>
      )}
      {!compact && (
        <span className={chip} title={`generated_by: ${row.generated_by || '—'} · audit_status: ${audit}`}>
          <GenIcon className="w-3 h-3" /> {row.generated_by || '—'} <span className="opacity-50">·</span> <AuditIcon className="w-3 h-3" /> {audit.replace(/_/g, ' ')}
        </span>
      )}
      {/* lineage badge */}
      {run ? (
        <WLink to={wikiUrl.entity(disease, snapshot, 'run', run.id)} className={`${kindChip} hover:underline`}
          title={`${lineage?.kind === 'recorded' ? 'Lineage recorded by the harvest' : `Lineage reconstructed after the fact from ${lineage?.path || 'the repo'}`}${run.confidence ? ` · confidence ${run.confidence}` : ''}\n${run.script} @ ${run.commit}`}>
          <GitCommit className="w-3 h-3" /> {run.id}{run.commit ? <span className="font-mono opacity-80">@{run.commit.slice(0, 7)}</span> : null}
          {!compact && <span className="opacity-70">· {lineage?.kind === 'recorded' ? 'recorded' : 'reconstructed'}{run.confidence && run.confidence !== 'high' ? ` · ${run.confidence}` : ''}</span>}
        </WLink>
      ) : (
        <span className={`${chip} ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`} title="No run record for this evidence type in the snapshot's provenance or in wiki/lineage/">no lineage</span>
      )}
    </div>
  );
}
