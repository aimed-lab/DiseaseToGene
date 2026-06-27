-- ============================================================================
-- Content-centric storage: per-gene content store (the "harvest" target)
-- Run once in Supabase → SQL Editor.
--
-- One row per (disease, gene) holding the FULL evidence profile harvested from
-- every source — Open Targets scores, ClinicalTrials.gov, PubMed/EuropePMC/
-- PubTator, ChEMBL druggability, cBioPortal mutations — each with provenance.
--
-- Unlike target_ranking_snapshots (a frozen, versioned photograph of a ranking),
-- this table is a LIVING store: the harvest upserts on (disease_id, gene_symbol),
-- so re-running refreshes each gene's row (new updated_at) instead of duplicating.
--
-- Access model mirrors the other content tables: lab-wide read, any signed-in
-- user can insert/refresh (shared content), creator-or-admin can delete.
-- ============================================================================

create table if not exists public.gene_content (
  id            uuid        primary key default gen_random_uuid(),
  disease_id    text        not null,          -- linking key (OT/EFO disease id)
  disease_name  text,
  gene_symbol   text        not null,          -- linking key
  rank          int,                           -- position in the ranking
  get_scores    jsonb,                         -- G / E / T / GET + components   (Open Targets)
  clinical      jsonb,                         -- trials, max phase, active       (ClinicalTrials.gov)
  literature    jsonb,                         -- PubMed / EuropePMC / PubTator
  chembl        jsonb,                         -- druggability, IC50, drugs       (ChEMBL)
  mutations     jsonb,                         -- frequency, hotspots             (cBioPortal)
  provenance    jsonb,                         -- each source + retrieved date
  updated_at    timestamptz not null default now(),
  updated_by    uuid        default auth.uid() references auth.users(id) on delete set null,
  unique (disease_id, gene_symbol)             -- upsert key: re-harvest refreshes, never duplicates
);

create index if not exists idx_gc_disease_rank on public.gene_content (disease_id, rank);
create index if not exists idx_gc_gene         on public.gene_content (gene_symbol);
create index if not exists idx_gc_updated      on public.gene_content (updated_at desc);

alter table public.gene_content enable row level security;

-- Any authenticated user can read all (shared lab content)
create policy "gc_read_all_authenticated"
  on public.gene_content for select
  to authenticated using (true);

-- Any authenticated user can insert, stamped as themselves
create policy "gc_insert_own"
  on public.gene_content for insert
  to authenticated with check (updated_by = auth.uid());

-- Any authenticated user can refresh shared content (upsert → update path),
-- but must stamp themselves as the updater
create policy "gc_update_authenticated"
  on public.gene_content for update
  to authenticated using (true) with check (updated_by = auth.uid());

-- Delete: last updater or an admin
create policy "gc_delete_owner_or_admin"
  on public.gene_content for delete
  to authenticated using (
    updated_by = auth.uid()
    or exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'admin')
  );
