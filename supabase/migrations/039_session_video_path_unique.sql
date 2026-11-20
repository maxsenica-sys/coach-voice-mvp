-- 039_session_video_path_unique.sql
--
-- One row per uploaded video file.
--
-- Max, 2026-11-20: "Video load also failed". A clip reached storage and the
-- request that records it never reached the server, so nothing appeared. The
-- fix retries that request (lib/video-queue.ts), and a retry may follow an
-- attempt that did get through and only lost its answer. The routes look for
-- an existing row first, but two requests that arrive together both find
-- none. This index is what makes the second one fail instead of inserting:
-- the route then answers with the row the first one made. Without it a retry
-- could give a session the same clip twice, and send a coach two messages
-- about one athlete clip.
--
-- Every path is minted per upload (user/session/timestamp, or the athlete's
-- clip folder), so no two rows legitimately share one. Production had no
-- duplicates when this was written.

create unique index if not exists session_videos_storage_path_key
  on public.session_videos (storage_path);
