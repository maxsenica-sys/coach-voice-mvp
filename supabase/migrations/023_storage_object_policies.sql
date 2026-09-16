-- 023 — Say out loud who may touch which object, and stop saying "anyone".
--
-- Three separate problems, all in storage.objects, none of which any rig could
-- see: verify:safeguard reads source files, and these live in the database.
--
-- 1. messages-media had NO policy at all.
--
--    RLS is enabled on storage.objects, so "no policy" means "denied". Both
--    message composers upload straight from the browser as the signed-in user
--    (MessagingPanel.tsx and app/athlete/page.tsx), so every image, video and
--    voice message in the product failed at the upload call with a row-level
--    security error. The feature could not work at all.
--
--    The paths are now `${auth.uid()}/${athlete_id}/${ts}.${ext}` on both
--    sides — the athlete side used to write `athlete/${athlete_id}/…`, a
--    prefix scoped to nobody, which is why one policy could not previously
--    have covered both. SELECT is granted alongside INSERT because minting a
--    signed URL requires read permission on the object.
--
-- 2. athlete-photos let every authenticated user read every object in it.
--
--    `coach_read_athlete_photo` was `USING (bucket_id = 'athlete-photos')`
--    for the `authenticated` role — no ownership term at all. Any signed-in
--    user, including any athlete, could read any child's photo given its path.
--    Nothing in the app needs that: both call sites go through the service
--    role (app/api/athletes/[id]/route.ts mints a signed URL, and
--    app/api/athletes/[id]/photo/route.ts mints a signed *upload* URL), and a
--    signed URL does not consult these policies. The grant was pure excess.
--
-- 3. training-plans policies referenced a bucket that does not exist.
--
--    No such bucket in storage.buckets, and no reference to it anywhere in
--    app/ or lib/. Dead policy for a dead feature — the sort of thing that
--    looks like coverage in a policy listing and is not.

-- ── messages-media: your own folder, nobody else's ─────────────────────────

drop policy if exists "messages_media_insert_own" on storage.objects;
create policy "messages_media_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'messages-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "messages_media_read_own" on storage.objects;
create policy "messages_media_read_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'messages-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── athlete-photos: the service role only ─────────────────────────────────
--
-- Dropping these removes direct client access entirely. Both routes that touch
-- this bucket use the admin client, so nothing in the app loses anything.

drop policy if exists "coach_read_athlete_photo" on storage.objects;
drop policy if exists "coach_upload_athlete_photo" on storage.objects;

-- ── training-plans: delete the policies for the bucket that never was ──────

drop policy if exists "authenticated_read_training_plan" on storage.objects;
drop policy if exists "coach_upload_training_plan" on storage.objects;

-- ── A ceiling on what a phone can push into the video bucket ──────────────
--
-- The only enforced limit lived in a FormData branch of
-- app/api/sessions/[id]/videos/route.ts that has no caller; the signed-upload
-- path that actually runs had none, in the route, the minter or the client.
-- An iPhone shooting 4K60 produces roughly 400MB a minute, so a long clip
-- could push multiple gigabytes before anything objected. 500MB matches the
-- number the dead branch always intended to enforce.
update storage.buckets set file_size_limit = 524288000 where id = 'session-videos';
update storage.buckets set file_size_limit =  52428800 where id = 'messages-media';
update storage.buckets set file_size_limit =  10485760 where id = 'athlete-photos';
