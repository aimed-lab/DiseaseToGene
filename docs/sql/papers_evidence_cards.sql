-- ============================================================================
-- Content-centric storage: papers + extracted evidence cards
-- Run once in Supabase → SQL Editor.
--
-- Two-table design:
--   papers         — one row per ingested paper        (Group A: identity & provenance)
--   evidence_cards — one row per gene/drug/mutation fact (Groups B–E: linking keys,
--                    therapeutic content, evidence/outcome, each with a source quote)
--
-- Access model mirrors target_ranking_snapshots: lab-wide read (any signed-in
-- user), any signed-in user can insert, creator-or-admin can delete.
-- ============================================================================

-- ── papers ──────────────────────────────────────────────────────────────────
create table if not exists public.papers (
  id             uuid primary key default gen_random_uuid(),
  title          text        not null,
  authors        text[],
  journal        text,
  year           int,
  doi            text,
  url            text,
  study_type     text,                     -- RCT | GWAS | Cohort | In Vitro | ...
  sample_size    int,
  key_finding    text,
  conclusion     text,
  raw_extraction jsonb,                     -- full AI extraction JSON (audit / re-use)
  audit_status   text        not null default 'AI-extracted',  -- AI-extracted | human-verified
  created_at     timestamptz not null default now(),
  created_by     uuid        not null default auth.uid() references auth.users(id) on delete set null
);

create index if not exists idx_papers_created on public.papers (created_at desc);

-- ── evidence_cards ────────────────────────────────────────────────────────────
create table if not exists public.evidence_cards (
  id               uuid primary key default gen_random_uuid(),
  paper_id         uuid references public.papers(id) on delete cascade,
  -- Group B — linking keys (how the app highlights / joins)
  gene_symbol      text        not null,
  disease          text,
  mutation         text,                    -- e.g. "G12D"
  -- Group C — therapeutic content
  drug             text,
  drug_action      text,                    -- inhibits | activates | targets
  mechanism        text,                    -- mechanism of action
  modality         text,                    -- oral small molecule | antibody | ...
  trial_phase      text,                    -- Phase 1 | Phase 3 | Approved | ...
  trial_ids        text[],                  -- NCT ids
  -- Group D — evidence / outcome
  primary_endpoint text,                    -- e.g. "Overall survival"
  efficacy_result  text,                    -- e.g. "6.7 -> 13.2 months"
  effect_size      text,                    -- e.g. "HR 0.40 (60% lower death risk)"
  approval_status  text,                    -- e.g. "seeking FDA approval"
  key_finding      text,
  -- Provenance
  source_quote     text,                    -- exact sentence the fact came from
  audit_status     text        not null default 'AI-extracted',
  created_at       timestamptz not null default now(),
  created_by       uuid        not null default auth.uid() references auth.users(id) on delete set null
);

create index if not exists idx_ec_gene         on public.evidence_cards (gene_symbol);
create index if not exists idx_ec_gene_disease on public.evidence_cards (gene_symbol, disease);
create index if not exists idx_ec_paper        on public.evidence_cards (paper_id);

-- ── Row-level security ────────────────────────────────────────────────────────
alter table public.papers         enable row level security;
alter table public.evidence_cards enable row level security;

-- Any authenticated user can read all (shared lab content)
create policy "papers_read_all_authenticated"
  on public.papers for select to authenticated using (true);
create policy "ec_read_all_authenticated"
  on public.evidence_cards for select to authenticated using (true);

-- Any authenticated user can insert, but only as themselves
create policy "papers_insert_own"
  on public.papers for insert to authenticated with check (created_by = auth.uid());
create policy "ec_insert_own"
  on public.evidence_cards for insert to authenticated with check (created_by = auth.uid());

-- Update audit status (e.g. promote to human-verified): creator or admin
create policy "papers_update_owner_or_admin"
  on public.papers for update to authenticated using (
    created_by = auth.uid()
    or exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'admin')
  );
create policy "ec_update_owner_or_admin"
  on public.evidence_cards for update to authenticated using (
    created_by = auth.uid()
    or exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Delete: creator or admin
create policy "papers_delete_owner_or_admin"
  on public.papers for delete to authenticated using (
    created_by = auth.uid()
    or exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'admin')
  );
create policy "ec_delete_owner_or_admin"
  on public.evidence_cards for delete to authenticated using (
    created_by = auth.uid()
    or exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'admin')
  );
