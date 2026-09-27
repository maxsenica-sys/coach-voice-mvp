-- A minimal stand-in for what Supabase provides before any migration runs:
-- the API roles, auth.users and auth.uid()/auth.role()/auth.jwt() reading the
-- request claims the way PostgREST sets them, and the storage schema's shape.
-- Used only by tools/rls-rig.mjs. Never applied to a real project.
-- Minimal Supabase stand-in for testing migrations and RLS locally.
do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator login noinherit; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz, created_at timestamptz default now(), last_sign_in_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create or replace function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
create or replace function storage.extension(name text) returns text language sql immutable as $$ select split_part(name, '.', 2) $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to authenticated, service_role;
create publication supabase_realtime;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
