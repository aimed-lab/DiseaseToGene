-- ============================================================================
-- feedback — in-app feedback from users, reviewed by admins (Supabase / Postgres)
--
-- Run once in the Supabase SQL editor. The app talks to this table only through
-- the server (service-role key): POST /api/feedback (any signed-in user, own row)
-- and GET/PATCH /api/admin/feedback (admins). RLS is enabled with a read-own
-- policy so a user can list their own submissions from the client if we ever
-- want that; the service role bypasses RLS for the admin side.
-- ============================================================================

create table if not exists public.feedback (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid        references auth.users(id) on delete set null,
  email         text,                                   -- copied at submit time so it survives account deletion
  category      text        not null check (category in ('bug', 'data', 'feature', 'other')),
  message       text        not null check (char_length(message) between 1 and 4000),
  context       jsonb       not null default '{}'::jsonb,   -- { url, view, disease, snapshot_id, model, user_agent } — captured by the client, shown to the user
  status        text        not null default 'new' check (status in ('new', 'seen', 'done')),
  admin_note    text,                                   -- private to admins
  reviewed_by   uuid        references auth.users(id) on delete set null,
  reviewed_at   timestamptz
);

create index if not exists idx_feedback_created on public.feedback (created_at desc);
create index if not exists idx_feedback_status  on public.feedback (status, created_at desc);
create index if not exists idx_feedback_user    on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

-- A signed-in user may read their own feedback. Writes go through the server.
create policy "feedback_read_own"
  on public.feedback for select
  to authenticated using (user_id = auth.uid());
