-- ============================================================================
-- Content-centric storage: versioned, traceable disease→target ranking snapshots
-- Run once in Supabase → SQL Editor.
-- Access model: lab-wide read (any signed-in user), any signed-in user can save,
-- a snapshot can be deleted by its creator or an admin.
-- ============================================================================

create table if not exists public.target_ranking_snapshots (
  id            uuid primary key default gen_random_uuid(),
  disease_id    text        not null,
  disease_name  text        not null,
  version       int         not null default 1,
  created_at    timestamptz not null default now(),
  created_by    uuid        not null default auth.uid() references auth.users(id) on delete set null,
  label         text,                     -- optional human note ("v3 after weight change")
  weights       jsonb,                    -- GET weights used (G/E/T)
  gene_count    int,
  provenance    jsonb,                    -- sources, app version, retrieved date, generated_by
  targets       jsonb                     -- full ranked genes: scores + metrics + provenance
);

create index if not exists idx_trs_disease on public.target_ranking_snapshots (disease_id, version desc);
create index if not exists idx_trs_created on public.target_ranking_snapshots (created_at desc);

alter table public.target_ranking_snapshots enable row level security;

-- Any authenticated user can read all snapshots (shared lab content)
create policy "trs_read_all_authenticated"
  on public.target_ranking_snapshots for select
  to authenticated using (true);

-- Any authenticated user can insert, but only as themselves
create policy "trs_insert_own"
  on public.target_ranking_snapshots for insert
  to authenticated with check (created_by = auth.uid());

-- A snapshot can be deleted by its creator or an admin
create policy "trs_delete_owner_or_admin"
  on public.target_ranking_snapshots for delete
  to authenticated using (
    created_by = auth.uid()
    or exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
