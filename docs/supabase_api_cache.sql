-- Optional API response cache for Disease2Target server routes.
-- The Express server uses SUPABASE_SERVICE_ROLE_KEY, so this table does not
-- need browser/client access.

create table if not exists public.external_api_cache (
  cache_key text primary key,
  response jsonb not null,
  status integer not null default 200,
  content_type text not null default 'application/json',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_api_cache_expires_at_idx
  on public.external_api_cache (expires_at);

create or replace function public.set_external_api_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists external_api_cache_updated_at
  on public.external_api_cache;

create trigger external_api_cache_updated_at
before update on public.external_api_cache
for each row
execute function public.set_external_api_cache_updated_at();

alter table public.external_api_cache enable row level security;
