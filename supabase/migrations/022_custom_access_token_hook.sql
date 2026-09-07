-- 022 — Put the user's role into the access token itself.
--
-- Why: every cold start on /dashboard or /athlete ran two blocking Supabase
-- calls in middleware before a single byte of HTML was sent —
-- `auth.getUser()` and then a `profiles` lookup for the role. Measured on this
-- project over 24h: /auth/v1/user averaged 280ms (p95 838ms) and
-- /rest/v1/profiles averaged 501ms (p95 1088ms). Sequentially that is ~780ms
-- typical and ~1.9s at p95 of pure black screen, because the boot shell that
-- is supposed to cover the wait lives *inside* the HTML that has not been sent.
--
-- With the role carried as a claim, the middleware reads it straight out of the
-- verified token and makes no network call at all.
--
-- ── This function does nothing until the hook is enabled ───────────────────
-- Supabase Dashboard → Authentication → Hooks → Custom Access Token →
-- select `public.custom_access_token_hook`. Until then it is inert, and the
-- middleware keeps using its `profiles` fallback. That is deliberate: applying
-- this migration cannot change behaviour on its own.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
-- Runs as supabase_auth_admin, which is not the signed-in user, so the
-- `profiles` RLS policies do not apply here. The function is therefore pinned
-- to a fixed search_path and reads exactly one column of one row by primary
-- key — it must never grow into something that could leak another user's data
-- into a token.
security definer
set search_path = public
as $$
declare
  claims jsonb;
  user_role text;
begin
  select role into user_role
  from public.profiles
  where id = (event->>'user_id')::uuid;

  claims := coalesce(event->'claims', '{}'::jsonb);

  -- A profile row may not exist yet during signup. Emit null rather than
  -- failing: a token with no role is what the middleware's fallback expects,
  -- and refusing to mint a token here would break sign-up entirely.
  if user_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  else
    claims := jsonb_set(claims, '{user_role}', 'null'::jsonb);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- The Auth service calls this as supabase_auth_admin; nobody else should be
-- able to invoke it or read through it.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select on table public.profiles to supabase_auth_admin;

-- supabase_auth_admin bypasses RLS as the table owner's delegate, so an
-- explicit policy is not what grants it access — but leaving one documented
-- makes the intent visible to the next person reading pg_policies.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles: auth admin can read for token hook'
  ) then
    create policy "profiles: auth admin can read for token hook"
      on public.profiles
      as permissive
      for select
      to supabase_auth_admin
      using (true);
  end if;
end
$$;
