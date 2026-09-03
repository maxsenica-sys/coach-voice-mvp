-- 016_drop_unused_objects.sql
--
-- Removes schema that no code has ever referenced.
--
-- Verified empty before dropping (2026-09-03):
--   training_plans            0 rows
--   storage bucket 'training-plans'  0 objects
--   sessions.transcript_raw   0 non-null values
--
-- Both were created live on 2026-08-29 alongside the wellness-alert work and
-- never wired to anything. Keeping them meant the schema advertised features the
-- app does not have. The full recreate SQL is preserved below so this is
-- reversible if training plans come back as a real feature.
--
-- ─── To restore training_plans ────────────────────────────────────────────────
-- create table public.training_plans (
--   id           uuid primary key default gen_random_uuid(),
--   coach_id     uuid not null references auth.users(id),
--   athlete_id   uuid not null references public.athletes(id),
--   title        text not null,
--   storage_path text not null,
--   file_name    text,
--   mime_type    text,
--   file_size    bigint,
--   created_at   timestamptz default now()
-- );
-- alter table public.training_plans enable row level security;
-- create policy "training_plans: coach manages own" on public.training_plans
--   for all using (coach_id = (select auth.uid()))
--   with check (coach_id = (select auth.uid()));
-- create policy "training_plans: athlete views own" on public.training_plans
--   for select using (athlete_id in (
--     select id from public.athletes where athlete_user_id = (select auth.uid())
--   ));
-- insert into storage.buckets (id, name, public) values ('training-plans','training-plans',false);
-- ──────────────────────────────────────────────────────────────────────────────

drop table if exists public.training_plans;

alter table public.sessions drop column if exists transcript_raw;

-- The 'training-plans' bucket was removed via the Storage API, not here —
-- Postgres blocks direct DELETEs on storage.buckets (storage.protect_delete).
--   curl -X DELETE "$SUPABASE_URL/storage/v1/bucket/training-plans" \
--        -H "Authorization: Bearer $SERVICE_ROLE_KEY"
