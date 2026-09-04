-- 020_backfill_athlete_status.sql
--
-- athletes.status and activated_at had never been written since the app was
-- built — /api/athlete/activate only ever set first_login_at. So the status
-- column read 'invited' for all 8 athletes, including several using the portal
-- weekly, while the API derived a different answer from first_login_at and the
-- dashboard stat derived a third from athlete_user_id.
--
-- first_login_at ("has actually opened their portal") is the honest signal.
-- lib/athlete-status.ts is now the single place that definition lives, and the
-- activate route writes all three fields together going forward.

update public.athletes
set status = 'active',
    activated_at = coalesce(activated_at, first_login_at)
where first_login_at is not null
  and status is distinct from 'active';
