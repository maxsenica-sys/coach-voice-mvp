-- 026_soreness_detail.sql
--
-- Where it hurts, and how much — asked only when there is something to ask about.
--
-- ── The scale problem, stated before the columns ──────────────────────────
--
-- `wellness_checkins.soreness` runs **5 = no soreness**. Every wellness metric
-- in this app runs that way, on purpose, so that 5 is always the good end of
-- every question on a form a thirteen-year-old fills in daily. That decision
-- is load-bearing and is not being revisited here: it already caused one
-- production incident when an `inverted` flag was added on top of it and the
-- safeguarding alert ran backwards for weeks.
--
-- `soreness_score` is a **different scale on purpose**: 0-10, more is worse.
-- That is the Numeric Rating Scale every physiotherapist and every athlete
-- already knows, and 4 is its conventional cutoff between mild and moderate
-- pain — which is why the body map appears at 4 and not at some number this
-- app invented.
--
-- Two scales in one form would normally be a design smell. They are safe here
-- because they are attached to different questions and never averaged
-- together: `soreness` is one of five daily wellness metrics and feeds the
-- caretaker alert; `soreness_score` is a pain rating that exists only when the
-- athlete has said they are sore. **Nothing computes across them.** If a
-- future change ever wants to, it must reconcile the directions first.
--
-- ── Why areas is an array of region ids ──────────────────────────────────
--
-- Free text would invite a child to describe a symptom, which is a medical
-- conversation this product must not host. A fixed vocabulary of body regions
-- — the same ids the injury table uses — keeps it to "where", which is the
-- part a coach can actually act on.

alter table public.wellness_checkins
  -- 0-10 Numeric Rating Scale, more is worse. Null when the athlete answered
  -- "no soreness today", which is the common case and must stay one tap.
  add column if not exists soreness_score smallint
    check (soreness_score is null or (soreness_score between 0 and 10)),
  -- Region ids from lib/body-map.ts. Null or empty when nothing was selected;
  -- only ever populated when soreness_score cleared the body-map threshold.
  add column if not exists soreness_areas text[];

comment on column public.wellness_checkins.soreness_score is
  '0-10 Numeric Rating Scale where MORE IS WORSE. Deliberately the opposite direction to the `soreness` column, which is one of the five daily wellness metrics and runs 5 = no soreness. They are attached to different questions and must never be averaged together.';

comment on column public.wellness_checkins.soreness_areas is
  'Body regions the athlete tapped, using the region ids in lib/body-map.ts — the same vocabulary as injuries.body_area. A fixed vocabulary rather than free text, so the app never invites a child to describe a symptom.';
