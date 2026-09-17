-- ============================================================================
-- harvest_jobs — a harvest requested from the app, run by the RC cloud VM (Supabase / Postgres)
--
-- Run once in the Supabase SQL editor. The browser never touches this table: an admin
-- clicks "Queue harvest" → the server (service-role key) inserts a row → the VM's queue
-- worker (scripts/harvestQueue.ts, service-role key, outbound HTTPS only) claims it, runs
-- deploy/rc-cloud-harvest/bin/harvest.sh, and writes progress and the result back. The
-- server reads the table for the admin panel. One job runs at a time; the claim is an
-- atomic UPDATE ... WHERE status = 'queued'.
-- ============================================================================

create table if not exists public.harvest_jobs (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  requested_by   uuid        references auth.users(id) on delete set null,
  requested_email text,
  disease        text        not null check (char_length(disease) between 2 and 200),
  gene_count     integer     not null default 6000 check (gene_count between 100 and 20000),
  options        jsonb       not null default '{}'::jsonb,       -- { axes?: [], skip?: [], no_kg?: bool }
  status         text        not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  claimed_by     text,                                            -- worker host
  started_at     timestamptz,
  finished_at    timestamptz,
  snapshot_id    integer,                                         -- the snapshot the run created
  commit         text,                                            -- git commit of the checkout that ran
  progress       text,                                            -- "enrich clinical (9/12)" — updated while running
  log_tail       text,                                            -- last ~40 lines of the run log, updated while running
  summary        text,                                            -- runs/<id>.summary.txt when finished
  audit_status   text        check (audit_status in ('passed', 'failed', 'skipped')),
  error          text
);

create index if not exists idx_harvest_jobs_status  on public.harvest_jobs (status, created_at);
create index if not exists idx_harvest_jobs_created on public.harvest_jobs (created_at desc);

-- One worker row per VM: the admin panel shows whether anyone is listening.
create table if not exists public.harvest_workers (
  host        text        primary key,
  last_seen   timestamptz not null default now(),
  commit      text,
  running_job uuid        references public.harvest_jobs(id) on delete set null,
  note        text
);

alter table public.harvest_jobs    enable row level security;
alter table public.harvest_workers enable row level security;
-- No policies on purpose: only the service role (server + VM worker) reads or writes.
