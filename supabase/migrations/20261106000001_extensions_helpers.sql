-- Vibuzz — extensions and shared helpers
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Immutable unaccent wrapper so it can be used in indexes and triggers.
create or replace function public.f_unaccent(p text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''));
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Supabase grants this by default; repeated here so the functions below always work.
grant usage on schema extensions to anon, authenticated, service_role;
