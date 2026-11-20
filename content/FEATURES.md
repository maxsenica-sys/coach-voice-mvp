# Pindar feature inventory

Generated from `FEATURES.json` by `build_features_md.py`; do not edit by hand. Source: four code audits of main at bd23f75 (platform, recording, coach dashboard, athlete portal), deduplicated.

**144 features:** 142 shipped, 1 partial, 1 planned. **40** shipped features carry posts of their own; the other shipped ones are housekeeping or a facet of a marketed feature, and say which.

Status rules: shipped: a user can complete it end to end today. partial: it renders but a path is stubbed, broken or missing. planned: schema or comment only. Where the audits disagreed, the lower status won.

## Not shipped (do not market)

| Feature | Status | Why |
|---|---|---|
| `parent-session-monthly-auto-reports` Automatic parent session/monthly reports | planned | The flags exist (migration 006, saved by app/api/caretakers) but nothing sends to caretakers on share or monthly. notifySessionShared emails only the athlete, and there is no scheduled job. .claude/MEMORY.md line 546 confirms nothing sends. Also: The toggle only PATCHes athletes.auto_monthly_report (athletes/[id]/page.tsx:2326; api/athletes/[id]/route.ts). No sender found: no cron in vercel.json and no use of the flag in any email route Also: athletes/[id]/page.tsx PATCHes auto_monthly_report, which /api/athletes/[id] saves (migration 006). No cron, scheduler or sender reads auto_monthly_report or notify_monthly_reports anywhere, and vercel.json has no crons. Nothing is ever sent. |
| `caretaker-notify-prefs` Caretaker notification preferences | partial | /api/caretakers POST saves the session and monthly flags, but nothing sends session or monthly reports to caretakers (no consumer of notify_session_reports or notify_monthly_reports). The POST also drops notify_wellness_alerts, so it always takes the DB default true and that checkbox has no effect. Partly fixed 14 Nov 2026: the wellness-alert checkbox is now saved (lib/caretaker-prefs.ts). Session and monthly reports to caretakers are still not sent, so this stays partial. |

## Marketed features

| Feature | For | Pain removed | Competitor gap |
|---|---|---|---|
| `coach-invite-code-qr` Coach invite code and QR | coach | A coach adds a whole squad at training without typing anyone's email. | yes |
| `assistant-coach-invites` Invite assistant coaches by email | coach | Club staff can share the load without every coach seeing every child. | yes |
| `session-pdf` Printable session report PDF | coach | The coach gets a clean handout or record without copying and pasting. | no |
| `monthly-report-pdf` Monthly athlete report PDF | coach | The coach has a ready report for a parent meeting that doesn't leak the athlete's private notes. | yes |
| `quick-session-sheet` Three-step quick session recorder | coach | A coach can record session notes in seconds on a phone instead of writing them up. | yes |
| `record-first-choose-later` Record first, pick athlete after | coach | The coach doesn't lose the moment while hunting for a name. | yes |
| `mode-several-split` One recording split per athlete | coach | One talk replaces five separate recordings after a session. | yes |
| `mode-squad` Squad recording, one per member | coach | A whole team gets notes from one talk. | yes |
| `whisper-transcription` Automatic speech-to-text transcription | coach | No typing; long recordings avoid the 4.5MB serverless limit. | no |
| `review-summary-before-send` Review AI summary before sending | coach | The coach, not the child, is the first to read what the AI wrote. | yes |
| `last-time-you-said` 'Last time you said' card | coach | Session two starts with memory of session one. | yes |
| `pre-session-brief` Pre-session brief, 20 minutes out | coach | Walk into training knowing who's flat, hurt or confused. | yes |
| `seen-receipt` 'Seen by athlete' read receipt | coach | Coaches know whether feedback was read. | yes |
| `how-they-came-in` Morning check-in beside session | coach | Performance notes are read in light of readiness. | yes |
| `record-screen` Record online call to session | coach | Online sessions are captured without separate tools. | yes |
| `video-compare` Side-by-side video comparison | coach | Progress is visible a month apart. | no |
| `quiet-athletes-row` No session in two weeks | coach | Neglected athletes show up without the coach having to audit the roster. | yes |
| `coverage-insight` Least attention this month | coach | Coaches can see how their time is spread and who is getting left out. | yes |
| `roster-wellness-driver` Per-athlete wellness and driver | coach | Coaches spot struggling athletes from the roster and know why. | no |
| `calendar-month` Month calendar grid | coach | Planning and history live in one calendar. | no |
| `insight-recurring-cues` What you keep repeating | coach | Coaches notice cues that aren't landing because they keep repeating them. | yes |
| `insight-not-sure-signal` 'Not sure' reply signal | coach | Coaches learn when their feedback isn't understood. | yes |
| `multi-athlete-privacy` Group transcript and audio withheld | athlete | Children don't read or hear what the coach said about teammates. | yes |
| `ai-session-summary` AI summary of coach's talk | athlete | The athlete reads the coaching points in seconds instead of replaying several minutes of audio. | yes |
| `take-into-next-session` Take into next session | athlete | The athlete knows the one thing to work on next time without re-reading everything. | yes |
| `takeaway-reminder` Training-day takeaway reminder | athlete | The athlete is reminded of last session's instruction on the day it matters. | yes |
| `coach-recording-playback` Replay coach's voice (1:1 only) | athlete | The athlete can hear the coach's actual tone and words, not only a summary. | yes |
| `focus-card` Save takeaway as image | athlete | The athlete can keep the instruction as a wallpaper or story without exposing personal details. | yes |
| `training-rhythm` 12-week training rhythm bars | athlete | The athlete can see their training add up over time. | no |
| `two-tap-checkin` Two-tap daily readiness check-in | athlete | Replaces an 8–11 tap, five-slider form that teenagers abandon. | yes |
| `safeguarding-rls-gate` Child-safe data rules enforced | both | Coaches and clubs can trust the app with minors' data. | yes |
| `summary-grounding-guard` Grounded five-bullet summary cap | both | No invented advice or padded lists reach athletes. | yes |
| `video-annotator` Draw on video, timed strokes | both | Show exactly what's wrong instead of describing it. | no |
| `video-moments` Mark moments, attach to takeaway | both | Each takeaway has its video evidence beside it. | yes |
| `messaging-voice` Voice messages | coach | Coaches can talk instead of typing from the field. | no |
| `injury-body-map` Injury availability with body map | both | Everyone knows what a child can do today, without amateur medical notes. | no |
| `understanding-reply` One-tap 'did it land?' reply | both | The coach learns whether feedback was understood, and a shy teenager can say 'unclear' without writing a message. | yes |
| `body-map-soreness` Tap-to-mark body map | both | The athlete can say where it hurts without writing a description. | no |
| `athlete-clip-upload` Send coach a clip, get markup | both | The athlete can ask 'is my elbow dropping?' with video and get a visual answer. | yes |
| `wellness-alert-notify-parent` Wellness alert, notify parent | parent | Coaches can loop in a parent quickly when a child is struggling. | yes |

## Coach (83)

### Coach invite code and QR `coach-invite-code-qr`

**shipped**. Each coach has an invite code they can rename and show as a full-screen QR code. Scanning it opens sign-up with the athlete role and the code already filled in.

- **Pain removed:** A coach adds a whole squad at training without typing anyone's email.
- **Evidence:** app/api/coach-code/route.ts (GET, and PUT that is head-only, checks uniqueness, 4-32 chars). app/components/InviteQR.tsx encodes /signup?code=. app/signup/page.tsx reads ?code= and sets role=athlete. complete-signup links the athlete to the coach's roster.
- **Surfaces:** /dashboard (invite code, QR modal), /signup?code=, /dashboard (Home), /dashboard?tab=settings, Home onboarding, Add athlete sheet, Settings
- **Demo state:** Full-screen QR held up at practice
- **Competitor gap:** yes. Most team apps need emails typed in. Here a squad joins by scanning one QR code.

### Coach invites athlete by email `athlete-email-invite`

**shipped**. The coach adds an athlete by email. The athlete receives a branded 'Set your password' invite link, and the roster shows them as PENDING until they first log in.

- **Pain removed:** The coach can enrol athletes who aren't at training.
- **Evidence:** app/api/athletes/route.ts POST uses admin generateLink, then renderBrandedEmail and sendEmail. If email isn't configured, a warning returns and the coach can share the link manually. Email goes through Gmail SMTP or Resend (lib/notify.ts).
- **Surfaces:** /dashboard roster add athlete, /dashboard?tab=athletes (Add athlete sheet)
- **Demo state:** Roster row reading PENDING after the invite
- **Competitor gap:** no. Standard.
- **No posts of its own:** Covered by the coach-invite-code-qr posts: a facet of that feature rather than a post of its own.

### Invite assistant coaches by email `assistant-coach-invites`

**shipped**. The head coach invites up to 10 assistants by email and chooses which athletes each one can see. Invite links are single-use, expire after 7 days and only work for the invited email address. The head coach can edit, cancel or remove assistants.

- **Pain removed:** Club staff can share the load without every coach seeing every child.
- **Evidence:** app/components/CoachingStaff.tsx (on the dashboard). app/api/staff/route.ts handles GET, POST, PUT and DELETE, stores a hashed token and offers a copy-link fallback. app/api/staff/accept/route.ts and lib/staff-invite.ts acceptBlock (wrong-email, expired, own-roster, ...). app/staff/join/page.tsx. Migrations 034 and 035.
- **Surfaces:** /dashboard Coaching staff card, /staff/join?token=, /dashboard (Home), /dashboard?tab=settings, /staff/join
- **Demo state:** Settings, 'Invite an assistant' opened: an athlete picker and a 'Send invite' button
- **Competitor gap:** yes. Assistants see only the athletes they are given, not the whole roster.

### Parent/caretaker contacts per athlete `caretaker-contacts`

**shipped**. The head coach saves parents or guardians (name, email, relationship) for each athlete and can send them a confirmed, clearly labelled test email.

- **Pain removed:** Parent contacts live with the athlete, not in a separate spreadsheet.
- **Evidence:** app/api/caretakers/route.ts handles GET, POST and DELETE (head-only, roster-checked upsert). The CaretakerPanel in app/athletes/[id]/page.tsx sends the test through /api/email, which only sends to a saved caretaker.
- **Surfaces:** /athletes/[id] Caretakers panel, /athletes/[id]?tab=profile
- **Demo state:** Caretaker row with the 'Send test' confirm dialog
- **Competitor gap:** no. Contact storage is common.
- **No posts of its own:** Covered by the wellness-alert-notify-parent posts: a facet of that feature rather than a post of its own.

### Coach emailed on wellness drop `coach-wellness-alert-email`

**shipped**. When an athlete's check-in score or 7-day average drops past the alert threshold, the coach automatically gets an email with the metric scores and the athlete's note.

- **Pain removed:** The coach finds out about a struggling athlete without opening every check-in.
- **Evidence:** app/api/wellness/route.ts (around line 204) calls notifyWellnessAlert in lib/notify.ts, which uses computeWellnessAlert.
- **Surfaces:** Email to the coach, links to /athletes/[id], Coach email inbox, athlete home copy
- **Demo state:** '⚠️ Wellness alert , Sam' email with today's score and 7-day average tiles
- **Competitor gap:** no. Threshold alerts exist in athlete-monitoring tools.
- **No posts of its own:** Covered by the roster-wellness-driver posts: a facet of that feature rather than a post of its own.

### Printable session report PDF `session-pdf`

**shipped**. Opens a print-ready, branded A4 session report (summary, focus points, transcript unless withheld) and opens the browser's Print / Save as PDF dialog.

- **Pain removed:** The coach gets a clean handout or record without copying and pasting.
- **Evidence:** app/pdf/session/[id]/page.tsx calls window.print and respects transcript_withheld. Opened from app/athletes/[id]/page.tsx at line 1788.
- **Surfaces:** /pdf/session/[id]
- **Demo state:** A4 sheet with the PINDAR nameplate and CONFIDENTIAL footer
- **Competitor gap:** no. Export to PDF is common.

### Monthly athlete report PDF `monthly-report-pdf`

**shipped**. A printable monthly report of sessions and wellness check-ins. The coach picks which of the athlete's check-in notes to include; by default none print.

- **Pain removed:** The coach has a ready report for a parent meeting that doesn't leak the athlete's private notes.
- **Evidence:** app/pdf/monthly/[athleteId]/page.tsx has a per-note include toggle, 'N OF M INCLUDED', and window.print. Opened from app/athletes/[id]/page.tsx at line 1714. Print or save only: the app never emails it.
- **Surfaces:** /pdf/monthly/[athleteId], /athletes/[id] → /pdf/monthly/[athleteId]
- **Demo state:** Notes section with the '· will print / · not printed' toggles
- **Competitor gap:** yes. Reports where the athlete's notes are left out unless the coach adds each one.

### Three-step quick session recorder `quick-session-sheet`

**shipped**. A bottom sheet goes through three steps, 'Who and when', then 'Recording', then 'Before you send', with one main action at the foot of each step.

- **Pain removed:** A coach can record session notes in seconds on a phone instead of writing them up.
- **Evidence:** app/components/QuickSessionModal.tsx (phase 1/2/3), opened from app/dashboard/page.tsx:3206 and app/athletes/[id]/page.tsx:1244, saves via POST /api/sessions which inserts into sessions
- **Surfaces:** /dashboard, /athletes/[id] (Quick session sheet)
- **Demo state:** Step 3 'Before you send' with the transcript, the summary draft and the share checkbox
- **Competitor gap:** yes. Spoken notes become an athlete-ready summary, where most coaching apps rely on typed notes

### Record first, pick athlete after `record-first-choose-later`

**shipped**. Start recording works before any athlete is chosen; Save stays disabled until a target is picked on the review step.

- **Pain removed:** The coach doesn't lose the moment while hunting for a name.
- **Evidence:** QuickSessionModal.tsx hasTarget is required only by save(); the review step renders targetSection; once a target is chosen, the draft effect writes the summary after the fact
- **Surfaces:** Quick session sheet
- **Demo state:** Recording screen showing 'Choose who this is for when you stop.'
- **Competitor gap:** yes. Most recorders require choosing the context first

### No default athlete preselected `no-silent-misattribution`

**shipped**. Opened without a target, the sheet selects nobody rather than defaulting to the newest athlete.

- **Pain removed:** Sessions can't be silently filed under, or emailed to, the wrong child.
- **Evidence:** QuickSessionModal.tsx:53-60 useState(defaultAthleteId ?? '') with a comment explaining why the fallback was removed
- **Surfaces:** Quick session sheet
- **Demo state:** 'Session for' with no athlete chosen and the hint 'Choose now, or after you stop.'
- **Competitor gap:** no. A safety detail, not a headline feature
- **No posts of its own:** Covered by the record-first-choose-later posts: a facet of that feature rather than a post of its own.

### Live clock with mic-stall alert `live-clock-stall-detect`

**shipped**. An mm:ss clock based on wall time advances only while the mic track is live; if the mic dies, the clock turns red and says 'The microphone stopped'.

- **Pain removed:** The coach is never talking to a phone that has stopped listening.
- **Evidence:** QuickSessionModal.tsx:114-204 checks recSecs/recStalled every 250ms against MediaRecorder.state and track readyState; role=alert message at :1301
- **Surfaces:** Quick session sheet, recording step
- **Demo state:** Red '02:14' with 'Recording stopped' alert
- **Competitor gap:** yes. Few recorders detect a stall and say so in words
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### Specific microphone error messages `mic-error-diagnosis`

**shipped**. Distinguishes a denied permission, no mic found, mic in use by another app, and unknown errors, each with its own fix.

- **Pain removed:** Coaches aren't sent to browser settings to fix the wrong problem.
- **Evidence:** QuickSessionModal.tsx:294-312 maps NotAllowedError, NotFoundError and NotReadableError to separate messages
- **Surfaces:** Quick session sheet
- **Demo state:** 'Another app is using the microphone. Close it and try again.'
- **Competitor gap:** no. Polish
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### Backdate sessions, never future `session-date-backdate`

**shipped**. A date picker defaults to today, shows 'Today'/'Yesterday' labels and blocks future dates on both client and server.

- **Pain removed:** Yesterday's training logged over breakfast lands on the right day.
- **Evidence:** QuickSessionModal.tsx sessionDate max=today and save() checks; app/api/sessions/route.ts:171-183 rejects future dates; the session_date column is used for list order
- **Surfaces:** Quick session sheet steps 1 and 3
- **Demo state:** Date field reading 'Yesterday'
- **Competitor gap:** no. Common
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### Optional session title `session-title`

**shipped**. A free-text title (e.g. 'Serve receive') is saved as session_name; squad saves are prefixed with '[Squad name]'.

- **Pain removed:** Sessions are findable by topic.
- **Evidence:** QuickSessionModal.tsx sessionName; route.ts inserts session_name; squad path builds `[${group.name}] ...`
- **Surfaces:** Quick session sheet, session page heading
- **Demo state:** Session page H1 'SERVE RECEIVE'
- **Competitor gap:** no. Common
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### In person / Online tag `delivery-in-person-online`

**shipped**. A one-tap radio (default In person) records how the session was delivered and shows it on the session page eyebrow.

- **Pain removed:** Remote and in-person work can be told apart.
- **Evidence:** QuickSessionModal.tsx:1144 radiogroup; route.ts parseDelivery writes delivery (migration 036); sessions/[id]/page.tsx:1035 shows DELIVERY_LABEL
- **Surfaces:** Quick session sheet, /sessions/[id]
- **Demo state:** Eyebrow 'Recorded session · Online'
- **Competitor gap:** no. Minor metadata
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### One-athlete recording `mode-one-athlete`

**shipped**. Saves one session for one athlete, using an AthletePicker with search and squad filter.

- **Pain removed:** Fast one-to-one feedback.
- **Evidence:** QuickSessionModal.tsx mode 'athlete' sends one POST /api/sessions with athlete_id; route.ts checks the athlete is on the coach's roster before insert
- **Surfaces:** Quick session sheet
- **Demo state:** Picker with one athlete selected
- **Competitor gap:** no. Baseline
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### One recording split per athlete `mode-several-split`

**shipped**. Talk about 2-5 named athletes in one recording; AI splits it into a separate editable summary and takeaway card per athlete, and each athlete gets their own session containing only their card.

- **Pain removed:** One talk replaces five separate recordings after a session.
- **Evidence:** QuickSessionModal.tsx 'several' mode calls draftSplit → POST /api/sessions/split-summary (name eligibility, guardSummary, reasons); saveEach posts one row per athlete with a shared_recording_id uuid; route.ts never regenerates when that id is set
- **Surfaces:** Quick session sheet ('Several' tab)
- **Demo state:** Three name-headed cards, one reading 'Kai's name wasn't heard in the recording, so nothing was drafted'
- **Competitor gap:** yes. Per-athlete splitting of one voice note is unusual

### Explained empty split cards `split-empty-reasons`

**shipped**. An empty card says why: name not heard, ambiguous shared first name, nothing specific, or the draft named another athlete.

- **Pain removed:** The coach knows whether the draft failed or simply had nothing for that athlete.
- **Evidence:** QuickSessionModal.tsx SPLIT_REASON_TEXT; lib/split-summary.ts splitEligibility/assembleSplit; 'Split again' button
- **Surfaces:** Quick session sheet, Several review
- **Demo state:** Card: 'Another athlete here is also called Sam…'
- **Competitor gap:** yes. Transparent AI gaps
- **No posts of its own:** Covered by the mode-several-split posts: a facet of that feature rather than a post of its own.

### Squad recording, one per member `mode-squad`

**shipped**. One recording saves a session for every squad member; the server writes each member's summary at save time, personalised only if their first name was said unambiguously.

- **Pain removed:** A whole team gets notes from one talk.
- **Evidence:** QuickSessionModal.tsx group branch saveEach(group.member_ids) with group_id; route.ts validates group_id against the coach's groups and calls makeQuickSummary with rosterFirstNames → mayPersonalise. Caveat: the coach does NOT preview squad summaries (no draft shown in review for group mode)
- **Surfaces:** Quick session sheet ('Squad N' tab)
- **Demo state:** 'Session will be saved for: Ana Ruiz, Ben Cole, …' and 'Save for 12 Athletes'
- **Competitor gap:** yes. Per-member personalised summaries from one team talk

### Per-athlete partial-failure retry `partial-save-retry`

**shipped**. For squad/several saves, failures are reported by name ('Saved for 9 of 12. Failed for: …') and a retry posts only the missing athletes.

- **Pain removed:** No duplicate sessions and no silent failures.
- **Evidence:** QuickSessionModal.tsx saveEach + savedIdsRef; lib/recording-sync.ts narrowAfterPartialSave
- **Surfaces:** Quick session sheet, pending panel
- **Demo state:** Error line naming the two athletes that failed
- **Competitor gap:** no. Reliability detail
- **No posts of its own:** Covered by the mode-several-split posts: a facet of that feature rather than a post of its own.

### Automatic speech-to-text transcription `whisper-transcription`

**shipped**. On Stop & Transcribe, audio uploads straight to storage by signed URL and OpenAI Whisper transcribes it; an inline upload is the fallback.

- **Pain removed:** No typing; long recordings avoid the 4.5MB serverless limit.
- **Evidence:** QuickSessionModal.tsx stopAndTranscribe → /api/sessions/audio-upload-url then /api/transcribe (whisper-1, verbose_json, auth required, path must be coach/{uid}/)
- **Surfaces:** Quick session sheet
- **Demo state:** 'Transcribing audio…' status
- **Competitor gap:** no. Transcription is common

### Athlete names and sport vocabulary `name-sport-priming`

**shipped**. Whisper is primed with the first names of only the athletes being recorded, plus sport jargon, so names and terms come back spelled right.

- **Pain removed:** Fewer mangled names ('Anna' for 'Ana') and misheard jargon.
- **Evidence:** QuickSessionModal.tsx rosterForPrompt sends the 'roster' field; app/api/transcribe/route.ts builds the prompt from roster names, sport and getSportTerminologyHint; the profile sport is used as a fallback
- **Surfaces:** Transcription
- **Demo state:** Transcript correctly spelling 'Siobhan' and 'libero'
- **Competitor gap:** yes. Roster-aware transcription
- **No posts of its own:** Covered by the whisper-transcription posts: a facet of that feature rather than a post of its own.

### Silence and low-confidence warning `transcript-quality-warning`

**shipped**. Whisper's own no-speech and confidence scores produce a ⚠ warning above the transcript in review.

- **Pain removed:** A silent or half-heard recording doesn't quietly become a summary sent to a child.
- **Evidence:** app/api/transcribe/route.ts assessTranscript returns qualityReason; QuickSessionModal.tsx transcriptWarning shown at :1373
- **Surfaces:** Quick session sheet review
- **Demo state:** ⚠ banner over a short transcript
- **Competitor gap:** yes. Rarely surfaced
- **No posts of its own:** Covered by the whisper-transcription posts: a facet of that feature rather than a post of its own.

### Type or edit the transcript `manual-transcript-edit`

**shipped**. 'Skip , type transcript manually' opens review with an empty box, and any Whisper transcript can be edited before save.

- **Pain removed:** A coach without a mic, or with a mis-heard word, can still save.
- **Evidence:** QuickSessionModal.tsx Skip button sets step 'review'; the textarea qs-transcript is the value saved. Caveat: a typed transcript gets no preview draft in one-athlete mode (the draft effect needs heardText); the server then generates the summary at save
- **Surfaces:** Quick session sheet
- **Demo state:** Empty transcript box 'Type or paste transcript here…'
- **Competitor gap:** no. Common
- **No posts of its own:** Covered by the review-summary-before-send posts: a facet of that feature rather than a post of its own.

### Review AI summary before sending `review-summary-before-send`

**shipped**. For one athlete, an AI summary (marked 'Draft') and a 'Take into next session' line with a character limit appear after stopping; both are editable and nothing sends until Save.

- **Pain removed:** The coach, not the child, is the first to read what the AI wrote.
- **Evidence:** QuickSessionModal.tsx draftSummary → POST /api/sessions/summary (writes nothing, checks the athlete is on the roster); save sends summary/next, which route.ts uses verbatim. Caveats: if the coach clears both fields, the server regenerates a summary they never saw; squad mode has no preview
- **Surfaces:** Quick session sheet review
- **Demo state:** Summary textarea with 'Draft' pill and 'This is the line your athlete reads first.'
- **Competitor gap:** yes. Human-in-the-loop AI feedback for minors

### Inappropriate-content sharing block `content-safety-gate`

**shipped**. Sexual, hateful or threatening content gets no summary, unticks Share, and the server refuses to share it, whether at save, when shared later, or when a shared session is edited.

- **Pain removed:** Harmful text can't reach a 13-18-year-old.
- **Evidence:** lib/content-gate.ts (OpenAI moderation plus a keyword backstop) runs in makeQuickSummary, split-summary, POST /api/sessions (422 when shared) and, from 14 Nov 2026, PATCH /api/sessions/[id]: sharing a saved session later checks everything the athlete would read, and editing a shared session checks the new text (shareGateCheck, tested in tools/prompt-rig.mjs).
- **Surfaces:** Quick session sheet, save API
- **Demo state:** Review message 'This recording can't be summarised or shared with an athlete.'
- **Competitor gap:** yes. Built-in safeguarding for minors
- **No posts of its own:** Safety rail, not a selling point: marketing that children's content is filtered invites people to test it, and the filter is a backstop, not a guarantee.

### Share with athlete toggle `share-default-on`

**shipped**. A checkbox, ticked by default, decides whether the athlete sees the session; the label changes per mode (in Several mode, 'Share each athlete's own summary with them').

- **Pain removed:** Recorded sessions actually reach athletes, while private notes stay possible.
- **Evidence:** QuickSessionModal.tsx shareWithAthlete=true by default; route.ts stores shared_with_athlete and sets calendar visible_to_athlete
- **Surfaces:** Quick session sheet, /sessions/[id], /athletes/[id]
- **Demo state:** Ticked 'Share transcript & summary with athlete'
- **Competitor gap:** no. Common
- **No posts of its own:** Covered by the review-summary-before-send posts: a facet of that feature rather than a post of its own.

### Re-record discards everything `re-record`

**shipped**. '← Re-record' throws away the audio, the queued copy, the transcript, the drafts and the split ids, and returns to setup.

- **Pain removed:** A fluffed take doesn't leak its summary into the next save.
- **Evidence:** QuickSessionModal.tsx:1336-1368 deleteRecording and full state reset
- **Surfaces:** Quick session sheet review
- **Demo state:** Re-record button beside the Transcript label
- **Competitor gap:** no. Basic
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### Recordings survive bad signal `offline-recording-queue`

**shipped**. Audio is written to IndexedDB the moment recording stops; a session that failed to save is retried automatically when back online, resuming from upload or transcript.

- **Pain removed:** No signal in the sports hall no longer means lost words.
- **Evidence:** lib/recording-queue.ts (put/patch/delete, stages); lib/recording-sync.ts syncRecording; the PendingRecordings drain runs on mount and on the 'online' event. Rows the coach pressed Save on (ready) complete end to end. GAP: a recording never saved at review (closed sheet, or offline at stop so the transcript was empty and Save disabled) shows 'Recorded, not saved yet' with only Discard and no way to reopen or save it; it is auto-deleted after 14 days (ABANDONED_TTL_MS). Closing the sheet mid-recording discards the audio with no confirmation (queued only at stop) Shipped 14 Nov 2026: an unsaved recording can be finished from On this phone (FinishRecordingSheet, lib/recording-finish.ts); the 14-day auto-delete is gone.
- **Surfaces:** Record modal, PendingRecordings, athlete check-in, Quick session sheet, /dashboard 'On this phone' panel
- **Demo state:** Save error '…the recording is saved on this phone and will send when you are back online.'
- **Competitor gap:** yes. Offline-durable voice capture is rare in web apps
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### 'On this phone' pending panel `pending-recordings-panel`

**shipped**. The dashboard lists waiting recordings by name and age with a status, the last error, Discard (with confirmation) and 'Try again now'; it is hidden when the queue is empty.

- **Pain removed:** The coach can see what hasn't sent instead of trusting a silent queue.
- **Evidence:** app/components/PendingRecordings.tsx rendered at dashboard/page.tsx:1951; window.confirm on Discard; drainingRef prevents double posts
- **Surfaces:** /dashboard, /dashboard (Home)
- **Demo state:** '2 waiting' card with 'Waiting to send' and a red error line
- **Competitor gap:** yes. Visible offline queue
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### Replay your original recording `audio-playback-coach`

**shipped**. The session page streams the saved voice recording on demand, says when the codec can't play on the device, and offers a download link.

- **Pain removed:** A mis-heard transcript can be checked against the real audio.
- **Evidence:** route.ts stores audio_path/audio_mime (path ownership checked); detail route signs the session-audio URL; app/components/SessionAudioPlayer.tsx uses preload none, canPlayType check and /api/sessions/[id]/audio-url
- **Surfaces:** /sessions/[id] Recording band
- **Demo state:** Recording band 'Streams on demand , nothing downloads until you press play.'
- **Competitor gap:** yes. The coach's voice is kept with the notes
- **No posts of its own:** Covered by the whisper-transcription posts: a facet of that feature rather than a post of its own.

### 'Last time you said' card `last-time-you-said`

**shipped**. Before recording one athlete, shows their latest takeaway, its date, and whether they replied 'Got it', 'Working on it' or 'not clear'.

- **Pain removed:** Session two starts with memory of session one.
- **Evidence:** QuickSessionModal.tsx:230-238 fetch /api/athletes/[id]/last-focus (newest of the last 10 sessions that has a focus point); card at :1193 and a 'Last time' line during recording. One-athlete mode only
- **Surfaces:** Quick session sheet steps 1-2
- **Demo state:** Card: 'Keep elbows high on the set' · '12 Nov. They said it was not clear , worth covering again.'
- **Competitor gap:** yes. Closes the feedback loop at record time

### Pre-session brief, 20 minutes out `pre-session-brief`

**shipped**. From 20 minutes before a timed calendar session until 10 minutes after it starts, Home shows each athlete's readiness or 'Not checked in', sore areas, open injuries and last takeaway with its reply; it refreshes every minute.

- **Pain removed:** Walk into training knowing who's flat, hurt or confused.
- **Evidence:** app/components/PreSessionBrief.tsx UpcomingBrief at dashboard/page.tsx:2042 and a 'Brief' button sheet at :2161; /api/coach/brief; lib/pre-session.ts BRIEF_LEAD_MINUTES=20, GRACE=10, orderBrief puts not-checked-in first
- **Surfaces:** /dashboard Home card, Today 'Brief' sheet, /dashboard (Home)
- **Demo state:** Card '3 of 8 not checked in' with flagged rows on top
- **Competitor gap:** yes. Readiness, injuries and the last takeaway in one view

### Save receipt toast `save-receipt`

**shipped**. After saving, Home shows a receipt such as 'Shared with Mia' or 'Saved for 12 athletes · 12 shared', linking to the session if there is one.

- **Pain removed:** Confirms what the server actually wrote.
- **Evidence:** dashboard/page.tsx:3213-3246 compares the session list before and after the refetch
- **Surfaces:** /dashboard
- **Demo state:** Toast 'Shared with Mia'
- **Competitor gap:** no. Polish
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### 'Seen by athlete' read receipt `seen-receipt`

**shipped**. Under a shared session the coach sees 'Seen by Mia · time' or 'Not opened yet', based on the athlete's actual opens.

- **Pain removed:** Coaches know whether feedback was read.
- **Evidence:** detail route records the access (recordAccess) only for athlete viewers; /api/sessions/[id]/seen for portal views; AccessLog.tsx SessionSeen hides itself if logging is unavailable
- **Surfaces:** /sessions/[id] header
- **Demo state:** 'Seen by Mia · Tue 18:04'
- **Competitor gap:** yes. Read receipts on feedback

### Morning check-in beside session `how-they-came-in`

**shipped**. Shows the athlete's energy, sleep and soreness from that day's check-in next to the session (mood and stress excluded); nothing appears if they didn't check in.

- **Pain removed:** Performance notes are read in light of readiness.
- **Evidence:** detail route loadSessionCheckin (coach-only, scope.can.wellness); page.tsx CHECKIN_METRICS Copy note: the athlete is asked only Flat, OK or Good plus soreness; the energy and sleep values are derived from that answer, so never market sleep, mood or stress tracking.
- **Surfaces:** /sessions/[id]
- **Demo state:** Three tiles, 'Energy 2 · Low'
- **Competitor gap:** yes. Wellness joined to session notes

### 'Take into next session' points `focus-points-edit`

**shipped**. The coach adds or removes numbered takeaways (up to 20, 200 characters each); the athlete sees them, plus a shareable FocusCard image of the first one.

- **Pain removed:** Forward actions are explicit and editable.
- **Evidence:** page.tsx setFocusPoints/addFocus → PATCH focus_points (normalised server-side); FocusCard for athletes
- **Surfaces:** /sessions/[id]
- **Demo state:** Amber-numbered list with an Add input
- **Competitor gap:** no. Common
- **No posts of its own:** Covered by the take-into-next-session posts: a facet of that feature rather than a post of its own.

### Add videos to a session `add-video`

**shipped**. Pick one clip or several at once from the phone's library (500MB each, with preflight warnings). They upload one after another, each with its own percentage and time left, and more can be added while one is still uploading. A clip whose connection drops is retried, and one that reached storage is finished on Retry or the next visit without being sent again.

- **Pain removed:** Video feedback is attached to the right session, a whole practice of clips in one go, and a dropped signal does not lose one.
- **Evidence:** app/components/VideoUploader.tsx (input multiple, sequential queue, 'Add more' while busy, Retry and Dismiss per clip) on app/sessions/[id]/page.tsx and app/athletes/[id]/page.tsx; lib/video-queue.ts (retry rules, pending list, queue summary); lib/video-upload.ts → /api/sessions/[id]/videos(upload-url), whose POST answers a repeat with the existing row (migration 039). tools/video-rig.mjs V10–V13.
- **Surfaces:** /sessions/[id] Video section, /athletes/[id] session card
- **Demo state:** 'Uploading 2 of 5' with one clip at 42% · ~1min left, two waiting, and 'Add more'
- **Competitor gap:** no. Common
- **No posts of its own:** Covered by the video-annotator posts: a facet of that feature rather than a post of its own.

### Record online call to session `record-screen`

**shipped**. On desktop, records a shared browser tab with its audio plus the coach's mic into the session as video, uploading long calls in parts; a consent checkbox (everyone told, parent agreed for under-18s) is required first.

- **Pain removed:** Online sessions are captured without separate tools.
- **Evidence:** app/components/ScreenRecorder.tsx (consent phase, parts, failed parts kept as downloads); shown only when canRecordScreen()
- **Surfaces:** /sessions/[id] (desktop only)
- **Demo state:** Consent dialog with the under-18 checkbox
- **Competitor gap:** yes. Built-in call capture with consent gate

### Side-by-side video comparison `video-compare`

**shipped**. Play any two of an athlete's videos on one clock, with an adjustable offset to line up the key frame and a playback speed control.

- **Pain removed:** Progress is visible a month apart.
- **Evidence:** app/components/VideoCompare.tsx (master A, B follows offset, resync, speed); page.tsx Compare section from /api/athletes/[id]/videos
- **Surfaces:** /sessions/[id] Compare
- **Demo state:** Two stacked videos with an offset nudge
- **Competitor gap:** no. Exists in dedicated video apps

### Edit session after saving `session-edit-after-save`

**shipped**. After saving, the coach can edit notes, takeaways, share state, images and videos; the summary, title, transcript and date cannot be edited in the UI.

- **Pain removed:** Partial: fixes are limited to the add-on fields.
- **Evidence:** PATCH /api/sessions/[id] accepts summary/session_name/title, but no client sends them (grep); there is no UI to edit the transcript or date Shipped 14 Nov 2026: title, date and summary edit from the session page (SessionManage, lib/session-edit.ts).
- **Surfaces:** /sessions/[id]
- **Demo state:** n/a
- **Competitor gap:** no. Gap
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### Delete a session `session-delete`

**shipped**. Not available; a saved session cannot be deleted or reassigned from the app.

- **Pain removed:** n/a
- **Evidence:** No DELETE handler in app/api/sessions/[id]/route.ts; comments in QuickSessionModal.tsx:57,155 and lib/recording-sync.ts:21 say sessions are not deletable Shipped 14 Nov 2026: DELETE /api/sessions/[id] with a confirm dialog; files another row still uses are kept, athlete clips detached, athlete notes kept (migration 037).
- **Surfaces:** none
- **Demo state:** Do not demo
- **Competitor gap:** no. Missing
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### Scrollable day strip on Home `home-day-wheel`

**shipped**. Shows a day strip covering 8 weeks back and 8 weeks forward. It opens centred on today, has a Today pill, and marks days with session or other events.

- **Pain removed:** Coaches can see what they did and what is booked without opening the calendar.
- **Evidence:** app/components/DayWheel.tsx (DAYS_BACK/FORWARD=56). dashboard/page.tsx refreshHomeEvents fetches /api/calendar?mode=personal for each month, and a month that fails to load keeps its old events and shows a Retry banner.
- **Surfaces:** /dashboard (Home)
- **Demo state:** Strip centred on a lit Today cell, with session dots on the days before it
- **Competitor gap:** no. Most coaching apps have a week or agenda strip.
- **No posts of its own:** Covered by the calendar-month posts: a facet of that feature rather than a post of its own.

### Tap a day for events `home-day-panel`

**shipped**. Tapping a day drops a panel over the page listing that day's events with athlete initials, title and time. Recorded sessions open the session page.

- **Pain removed:** Coaches can check a day without leaving Home, and the record button stays visible.
- **Evidence:** DayWheel.tsx overlay panel: a Link to /sessions/{session_id} only when session_id exists, otherwise a plain row. dashboard/page.tsx measures dayOverlayH so the panel stops above the Record button.
- **Surfaces:** /dashboard (Home)
- **Demo state:** Panel open on a day with 2 athlete sessions and 1 personal reminder
- **Competitor gap:** no. Day-detail views are standard.
- **No posts of its own:** Covered by the calendar-month posts: a facet of that feature rather than a post of its own.

### No session in two weeks `quiet-athletes-row`

**shipped**. A single Home row shows up to 3 faces and a count of athletes with no session in 14 days. It opens the Athletes tab with the Inactive filter on.

- **Pain removed:** Neglected athletes show up without the coach having to audit the roster.
- **Evidence:** dashboard/page.tsx quietAthletes (from inactiveIds). lib/attention.ts isQuiet: QUIET_AFTER_DAYS=14, and never-recorded athletes only after a 7-day grace. The data is counted server-side by app/api/athletes/coverage/route.ts over all sessions, with no 50-row cap. The row is hidden until the coverage read succeeds.
- **Surfaces:** /dashboard (Home)
- **Demo state:** Ember row: 3 overlapping monograms, '4 athletes · no session in two weeks · See who ›'
- **Competitor gap:** yes. Typical coaching apps do not flag athletes who have gone without coach attention.

### Sessions this week and spark `scoreboard-sessions-week`

**shipped**. A large number shows sessions recorded this calendar week, above a bar chart of up to 12 weeks with a weekly average.

- **Pain removed:** Coaches see their coaching volume trend at a glance.
- **Evidence:** dashboard/page.tsx uses buildSpine and completeSpineWeeks from lib/training-spine.ts over the newest 50 sessions (/api/sessions/all). It shows '50+' and trims weeks the 50-session window only partly covers. The tile opens the Sessions tab.
- **Surfaces:** /dashboard (Home)
- **Demo state:** '7 SESSIONS THIS WEEK' with 12 bars, the current week lit, 'Avg 5 / wk'
- **Competitor gap:** no. Activity counters are common, though this one counts coaching sessions rather than athlete workouts.
- **No posts of its own:** Covered by the coverage-insight posts: a facet of that feature rather than a post of its own.

### Athletes and active count `scoreboard-athletes-active`

**shipped**. A Home tile shows the roster size and how many athletes have actually opened the app.

- **Pain removed:** Coaches can tell who has really joined, not just who was invited.
- **Evidence:** dashboard/page.tsx activeCount() from lib/athlete-status.ts counts athletes with first_login_at set, which is written by /api/athlete/activate, /api/join and /api/complete-signup.
- **Surfaces:** /dashboard (Home)
- **Demo state:** '12 ATHLETES · 9 active'
- **Competitor gap:** no. Standard roster stat.
- **No posts of its own:** Covered by the quiet-athletes-row posts: a facet of that feature rather than a post of its own.

### Roster wellness average `scoreboard-roster-wellness`

**shipped**. Shows the average of each athlete's latest wellness score from the last 14 days (out of 5) and how many athletes checked in.

- **Pain removed:** Coaches get one read on how the squad is feeling without comparing individual children.
- **Evidence:** dashboard/page.tsx fetches /api/wellness?days=14 (coach roster branch in app/api/wellness/route.ts, scoped by coach) and averages overallWellnessScore per athlete.
- **Surfaces:** /dashboard (Home)
- **Demo state:** '3.8/5 WELLNESS', a 5-segment meter, '8 checked in · 14d'
- **Competitor gap:** no. Wellness dashboards exist in athlete-monitoring tools such as TeamBuildr and Bridge.
- **No posts of its own:** Covered by the roster-wellness-driver posts: a facet of that feature rather than a post of its own.

### Latest sessions list `home-latest`

**shipped**. Lists the 3 newest sessions with athlete, title, Online flag, Shared/Draft chip and time since. Each row opens the session.

- **Pain removed:** Coaches can get back to what they just recorded quickly.
- **Evidence:** dashboard/page.tsx shows recentSessions = homeSessions.slice(0,3) via sessionRow with Link /sessions/{id}. The empty state offers 'Record your first session'.
- **Surfaces:** /dashboard (Home)
- **Demo state:** Three rows, one marked Draft in amber
- **Competitor gap:** no. Recent-activity lists are standard.
- **No posts of its own:** Covered by the seen-receipt posts: a facet of that feature rather than a post of its own.

### Today's events list `home-today`

**shipped**. Lists today's calendar events by time and type. Session events that have an athlete get a Brief button.

- **Pain removed:** Coaches can see today's agenda and prep from one place.
- **Evidence:** dashboard/page.tsx todayEvents is built from personal-mode calendar events, and the Brief button calls setBriefEvent to open PreSessionBrief. Rows without an athlete link to '#'.
- **Surfaces:** /dashboard (Home)
- **Demo state:** 'TODAY · 3 events' with 4:30pm Speed drills [Brief]
- **Competitor gap:** no. Agenda views are common.
- **No posts of its own:** Home screen furniture.

### Least attention this month `coverage-insight`

**shipped**. A closed row on Home says how many athletes are in the lowest group ('2 with no sessions'). Opening it groups every athlete by how many sessions they had in the last 30 days (none, 1, 2, 3–4, 5+), least attention first, with each name linking to the profile.

- **Pain removed:** Coaches can see how their time is spread and who is getting left out.
- **Evidence:** app/components/CoverageInsight.tsx calls /api/coach/insights?scope=coverage, which uses lib/insights.ts coverageRows and coverageGroups. Shown only to head coaches with 2 or more athletes. Name tooltips show sessions and word count.
- **Surfaces:** /dashboard (Home)
- **Demo state:** 'No sessions: Leo, Mia · 1 session: Sam · 5+ sessions: Ava, Zoe'
- **Competitor gap:** yes. Typical tools have no fairness view of how coaching attention is spread across a roster.

### One-tap record from anywhere `record-entry-points`

**shipped**. Opens the session recorder from Home, the mobile middle button, the sidebar, a roster row (athlete preselected), a squad (squad preselected), an athlete profile, or the /dashboard?record=1 shortcut.

- **Pain removed:** Coaches can start capturing feedback straight after training with no navigation.
- **Evidence:** dashboard/page.tsx openRecorder(athleteId?, groupId?) and the wantsRecord effect open QuickSessionModal. athletes/[id]/page.tsx opens setShowQuickSession. The recorder itself is outside this area.
- **Surfaces:** /dashboard, /athletes/[id]
- **Demo state:** Floodlit 'Record a session · Tap to start' bar with VU meter
- **Competitor gap:** yes. Voice-first session capture is not the core of typical coaching apps.
- **No posts of its own:** Covered by the quick-session-sheet posts: a facet of that feature rather than a post of its own.

### First-run setup checklist `onboarding-steps`

**shipped**. Until the first session is recorded, Home shows 3 steps above the scoreboard: set an invite code (inline; once saved, the step shows the code with Copy and Show QR code), add the first athlete, and record the first session.

- **Pain removed:** New coaches get started without needing a guide.
- **Evidence:** dashboard/page.tsx shows it when athletes.length===0 and the user is not an assistant. Only the code step ever ticks (stepNum(false,2/3) is hardcoded), so progress shows at most '1 of 3'. The card disappears once an athlete exists. Partial: steps two and three never tick, so it reads 1 of 3 for ever. Shipped 14 Nov 2026: steps tick from real state (lib/onboarding.ts) and the card stays until the first session.
- **Surfaces:** /dashboard (Home, empty roster)
- **Demo state:** 'Three steps to start. 1 of 3 done' with the code saved, Copy and Show QR code
- **Competitor gap:** no. Onboarding checklists are common.
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### Active and Pending roster split `roster-status`

**shipped**. Splits the roster into Active (has opened the app) and Pending (invited, not arrived) sections; a pending row shows its invite date. The counts are on the filter cells above the list.

- **Pain removed:** Coaches know who still needs chasing to join.
- **Evidence:** app/api/athletes/route.ts status comes from athleteStatus(first_login_at) in lib/athlete-status.ts. dashboard/page.tsx renders the activeList and pendingList sections.
- **Surfaces:** /dashboard?tab=athletes, /athlete (silent), coach roster
- **Demo state:** 'ACTIVE' section above 'PENDING · Invited, not yet arrived'
- **Competitor gap:** no. Invite status is common.
- **No posts of its own:** Roster housekeeping.

### Inactive athletes filter `roster-inactive-filter`

**shipped**. An Inactive filter chip with a count lists athletes with no session in 14 days (or never recorded after 7 days on the roster), next to All, Active and Pending.

- **Pain removed:** Coaches can pull up everyone overdue for attention in one tap.
- **Evidence:** dashboard/page.tsx athleteFilter 'INACTIVE' uses inactiveIds from coverage and isQuiet. The count is hidden until coverage loads, and a failed read says so.
- **Surfaces:** /dashboard?tab=athletes
- **Demo state:** Filter chips 'All 12 · Active 9 · Pending 3 · Inactive 4' with Inactive selected
- **Competitor gap:** yes. Filtering the roster by days since coach contact is rare.
- **No posts of its own:** Roster housekeeping.

### Roster name/email search `roster-search`

**shipped**. Filters the roster by word-start name matching (accent- and case-insensitive) or email. The search is kept for the browser session.

- **Pain removed:** Finding one athlete in a large roster is fast.
- **Evidence:** lib/athlete-filter.ts matchesName. dashboard/page.tsx stores the query in sessionStorage 'cv:roster-q'.
- **Surfaces:** /dashboard?tab=athletes
- **Demo state:** 'so gr' finds Sophie Grabovac
- **Competitor gap:** no. Standard.
- **No posts of its own:** Roster housekeeping.

### Sort roster by recency `roster-sort`

**shipped**. Sorts the roster by Name A–Z, Most recent session, or Least recent session (never-coached athletes first). The choice is remembered on the device.

- **Pain removed:** Coaches can work through whoever has gone longest without coaching.
- **Evidence:** lib/athlete-filter.ts sortRoster and ROSTER_SORT_LABELS. dashboard/page.tsx uses a select stored in localStorage 'pindar_roster_sort', with last-session dates from coverage.
- **Surfaces:** /dashboard?tab=athletes
- **Demo state:** Sort set to 'Least recent' with 'No sessions yet' athletes on top
- **Competitor gap:** no. Sorting is common, though sorting by last coach session is less so.
- **No posts of its own:** Roster housekeeping.

### Per-athlete wellness and driver `roster-wellness-driver`

**shipped**. Each roster row shows the latest wellness score (14 days) as a coloured dot and number under the initials. Below 3.5 the row also gets a tinted 'Low check-in' line naming what pulled the score down, e.g. a sore area.

- **Pain removed:** Coaches spot struggling athletes from the roster and know why.
- **Evidence:** dashboard/page.tsx wellnessByAthlete from /api/wellness?days=14, with overallWellnessScore and wellnessDriver from lib/wellness-config.ts using regionLabel.
- **Surfaces:** /dashboard?tab=athletes
- **Demo state:** Row with 2.6 under the initials and a tinted line 'Low check-in · Sore: Left hamstring'
- **Competitor gap:** no. Wellness monitoring tools show scores; an inline plain-language reason is a minor differentiator.

### Last session, count, days since `roster-last-session`

**shipped**. Each row has one line with the last session date, days since it, a QUIET tag past 14 days, and the total session count.

- **Pain removed:** Every athlete's coaching history is visible at a glance and accurate beyond 50 sessions.
- **Evidence:** dashboard/page.tsx coverageByAthlete from /api/athletes/coverage (counts all sessions server-side, with no cap). Until coverage loads it falls back to the 50 newest sessions.
- **Surfaces:** /dashboard?tab=athletes
- **Demo state:** 'Last session 2 Nov · 12d ago · 18 sessions'; another row '24d ago · QUIET' in ember
- **Competitor gap:** no. Last-activity columns are common.
- **No posts of its own:** Covered by the quiet-athletes-row posts: a facet of that feature rather than a post of its own.

### Roster row quick actions `roster-quick-actions`

**shipped**. Each row has a Record button for that athlete and a More button. More shows their email and buttons to message them (with the unread count), open their calendar, or remove them (head only). An unread message is a dot on the name and on More.

- **Pain removed:** Common per-athlete jobs happen straight from the list.
- **Evidence:** dashboard/page.tsx row buttons call openRecorder(a.id), setMsgPreselectedId+setTab('messages'), and showCalendarFor('athlete'). Delete opens a confirmation.
- **Surfaces:** /dashboard?tab=athletes
- **Demo state:** Row with mic and More; More open showing the email, Message · 2 unread, Calendar and Remove
- **Competitor gap:** no. Standard.
- **No posts of its own:** Roster housekeeping.

### Permanently remove athlete `athlete-hard-delete`

**shipped**. After a confirmation, permanently deletes the athlete with all their sessions, videos, audio, notes, events, check-ins, messages and caretakers, including stored files.

- **Pain removed:** Coaches can fully honour a family's request to delete a child's data.
- **Evidence:** dashboard/page.tsx confirmDelete POSTs /api/athletes/[id]/hard-delete (head only, coach_id check), which removes storage objects and rows in order.
- **Surfaces:** /dashboard?tab=athletes
- **Demo state:** Dialog 'Remove athlete? This will permanently delete Mia Lee and all their sessions…'
- **Competitor gap:** no. Deletion is expected.
- **No posts of its own:** Admin action, not a selling point.

### Athlete joined live toast `join-toast`

**shipped**. Meant to pop a live 'X accepted your invite' toast when an invited athlete activates.

- **Pain removed:** Would tell coaches the moment someone joins.
- **Evidence:** dashboard/page.tsx subscribes to Realtime athletes UPDATE where athlete_user_id goes from null to set. No code path ever does that: the invite sets athlete_user_id at insert, /api/join and /api/complete-signup insert with it already set, and migration 033 blocks client changes. Activation writes first_login_at instead. Realtime publication setup is also not in the migrations. In practice the toast never fires. Shipped 14 Nov 2026: Home compares the active roster with the set last seen on this device (lib/athlete-joined.ts) on load, focus and every 60s, and toasts newly active athletes once.
- **Surfaces:** /dashboard
- **Demo state:** Toast 'Alex Johnson accepted your invite · View'
- **Competitor gap:** no. Join notifications are common.
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### Create and manage squads `squads-manage`

**shipped**. The head coach creates squads with a name, colour and description, bulk-adds athletes with tick-all and search, removes members, and deletes squads. A partial failure keeps the failed athletes ticked so they can be retried.

- **Pain removed:** Coaches can organise athletes into training groups.
- **Evidence:** dashboard/page.tsx createGroup, SquadAdder, addMembersToGroup (Promise.allSettled, 'Added 2 of 3') and removeMemberFromGroup call /api/groups and /api/groups/[id]/members (head only, roster-checked).
- **Surfaces:** /dashboard?tab=groups (via the Athletes/Squads switch on mobile)
- **Demo state:** 'U18 Sprint · 8 athletes' expanded with a 'Tick all 5 / Add 3 to U18 Sprint' list
- **Competitor gap:** no. Groups are standard.
- **No posts of its own:** Covered by the mode-squad posts: a facet of that feature rather than a post of its own.

### One recording for a squad `squad-record`

**shipped**. The Record button on a squad opens the recorder preselected to that squad, so one talk is saved for every member.

- **Pain removed:** Coaches don't record the same team talk once per athlete.
- **Evidence:** dashboard/page.tsx openRecorder(undefined, g.id) opens QuickSessionModal with defaultGroupId. The squad split and save logic is outside this area. The receipt reports 'Saved for N athletes'.
- **Surfaces:** /dashboard?tab=groups
- **Demo state:** Squad card with a floodlit [Record] button
- **Competitor gap:** yes. Turning one spoken talk into per-athlete records is uncommon.
- **No posts of its own:** Covered by the mode-squad posts: a facet of that feature rather than a post of its own.

### All sessions list and search `sessions-tab`

**shipped**. Lists all sessions newest first, with athlete, title, date, Online flag and Shared/Draft chip; the summary is on the session the row opens. Coaches can search titles, summaries and transcripts, filter by athlete, and load older pages.

- **Pain removed:** Coaches can find a past session by what was said in it.
- **Evidence:** dashboard/page.tsx fetchAllSessions and loadOlderSessions call /api/sessions/all (limit/offset, ilike on session_name, title, summary and transcript; assistants cannot search transcripts).
- **Surfaces:** /dashboard?tab=sessions
- **Demo state:** Search 'follow-through' returning 3 sessions with 'Load older'
- **Competitor gap:** yes. Full-text search of spoken coaching transcripts is not typical.
- **No posts of its own:** Covered by the last-time-you-said posts: a facet of that feature rather than a post of its own.

### Month calendar grid `calendar-month`

**shipped**. A month grid with session and other markers. Selecting a day lists its events; recorded sessions link to the session, and coaches can add or delete events.

- **Pain removed:** Planning and history live in one calendar.
- **Evidence:** app/components/Calendar.tsx (month owned by the host, lib/calendar-month.ts). dashboard/page.tsx fetchCalendar guards against stale responses and shows an error state.
- **Surfaces:** In-app calendar, Home week wheel, /dashboard?tab=calendar, /athletes/[id]?tab=calendar
- **Demo state:** November grid with marked days and the selected day's list
- **Competitor gap:** no. Standard.

### Personal, athlete and squad calendars `calendar-targets`

**shipped**. Coaches switch between My calendar, any athlete's calendar or any squad's calendar. Squad events are created once per member.

- **Pain removed:** One place to schedule for yourself, one athlete or a whole squad.
- **Evidence:** dashboard/page.tsx showCalendarFor and pickCalendar (an AthletePicker on mobile). app/api/calendar/route.ts GET has mode=personal, group_id and athlete_id branches. POST for a group inserts one row per member.
- **Surfaces:** /dashboard?tab=calendar
- **Demo state:** 'Showing: U18 Sprint · Event is added for all 8 athletes in this squad'
- **Competitor gap:** no. Team and individual calendars are common.
- **No posts of its own:** Covered by the calendar-month posts: a facet of that feature rather than a post of its own.

### Add typed calendar events `calendar-add-event`

**shipped**. Adds an event with a title, a type (session, homework, goal, reminder or other), an optional time and notes. It can also be copied to the coach's own calendar.

- **Pain removed:** Coaches can assign homework, goals and reminders as well as sessions.
- **Evidence:** dashboard/page.tsx saveEvent POSTs /api/calendar, with a second POST when 'Also add to my personal calendar' is ticked. The route validates validTypes. Events reach the athlete because visible_to_athlete defaults to true (migration 018).
- **Surfaces:** /dashboard?tab=calendar
- **Demo state:** 'Add Event , Mia's Calendar' modal with Homework selected and 'Also add to my personal calendar' ticked
- **Competitor gap:** no. Common.
- **No posts of its own:** Covered by the calendar-month posts: a facet of that feature rather than a post of its own.

### Unread counts and read receipts `messaging-unread`

**shipped**. Shows unread badges in the nav, ticker and roster rows, and 'Read' under coach messages the athlete has opened.

- **Pain removed:** No athlete message goes unnoticed.
- **Evidence:** /api/messages/unread returns counts per athlete. The read_at PATCH and GET mark messages read. dashboard/page.tsx totalUnreadAll drives the badges.
- **Surfaces:** /dashboard (all tabs)
- **Demo state:** Nav Messages badge '3', with an ember dot on Mia's roster row
- **Competitor gap:** no. Standard.
- **No posts of its own:** Covered by the messaging-voice posts: a facet of that feature rather than a post of its own.

### Coach profile and sport `coach-profile`

**shipped**. View and edit name, login email and sport (wheel picker). Saving closes the form and updates the header and cache.

- **Pain removed:** Coaches control how they appear in reports and emails.
- **Evidence:** dashboard/page.tsx SettingsTab saveProfile PATCHes /api/coach-profile. An email change calls admin.updateUserById.
- **Surfaces:** /dashboard?tab=settings
- **Demo state:** Read view: Name, Email, 'Sport: Tennis' with Edit profile
- **Competitor gap:** no. Standard.
- **No posts of its own:** Account housekeeping.

### Switch athlete from profile `athlete-switcher`

**shipped**. Tapping the athlete's name in the profile header opens a searchable, squad-filterable picker that jumps to another athlete and keeps the current tab.

- **Pain removed:** Coaches can go down a squad after training without returning to the roster.
- **Evidence:** app/components/AthleteSwitcher.tsx. athletes/[id]/page.tsx switchTo calls router.replace with ?tab kept.
- **Surfaces:** /athletes/[id]
- **Demo state:** Sheet over the profile listing the squad, with the current athlete marked
- **Competitor gap:** no. Convenience feature.
- **No posts of its own:** Navigation.

### Sessions with you and spine `profile-scoreboard`

**shipped**. Shows the total number of sessions with this athlete, a 12-week bar chart, how many this week, and a warning past a gap ('Last session 19 days ago'). Also shows a shared/private split.

- **Pain removed:** Coaches see their history with this athlete at a glance.
- **Evidence:** athletes/[id]/page.tsx buildSpine(sessions) with SPINE_GAP_DAYS and spineGap, using all sessions from /api/sessions?athlete_id.
- **Surfaces:** /athletes/[id] (Overview)
- **Demo state:** '24 SESSIONS WITH YOU' with bars and 'Last session 19 days ago' in ember
- **Competitor gap:** no. Activity history is common.
- **No posts of its own:** Covered by the last-time-you-said posts: a facet of that feature rather than a post of its own.

### Wellness snapshot per metric `profile-wellness-snapshot`

**shipped**. Shows the latest overall score with a 7-check-in bar chart, a bar for each metric, a 'Low:' line in plain words, and 'Needs attention' when an alert is active.

- **Pain removed:** Coaches know how this athlete is arriving today.
- **Evidence:** athletes/[id]/page.tsx fetches /api/wellness?athlete_id&days=14 (which returns the alert). Uses WELLNESS_METRICS and wellnessDriver. A failed read is shown as distinct from 'no check-ins'.
- **Surfaces:** /athletes/[id] (Overview, header chip)
- **Demo state:** '2.4/5 · Needs attention' with 'Low: sleep, sore right calf'
- **Competitor gap:** no. Wellness monitoring tools do this.
- **No posts of its own:** Covered by the roster-wellness-driver posts: a facet of that feature rather than a post of its own.

### 30-day wellness trend graph `wellness-history`

**shipped**. A line chart of each wellness metric over 30 days with check-in history.

- **Pain removed:** Coaches can see trends rather than single bad days.
- **Evidence:** app/components/WellnessGraph.tsx fetches /api/wellness?athlete_id&days=30 and draws a pixel-true SVG.
- **Surfaces:** /athletes/[id]?tab=wellness
- **Demo state:** 30-day lines for sleep, energy, mood and soreness
- **Competitor gap:** no. Common in monitoring tools.
- **No posts of its own:** Covered by the roster-wellness-driver posts: a facet of that feature rather than a post of its own.

### Session history with replies `profile-session-history`

**shipped**. Lists all sessions with the summary and the athlete's reply chip (e.g. Got it, Working on it, Not sure) or a Private chip. Expanding a session shows the audio, AI summary and full transcript, plus share/unshare, open, PDF and video upload.

- **Pain removed:** Coaches see each session alongside how the athlete took it.
- **Evidence:** athletes/[id]/page.tsx uses /api/sessions?athlete_id (no cap), responseOption(athlete_response), toggleShare (PATCH /api/sessions/[id]), SessionAudioPlayer and VideoAnnotator.
- **Surfaces:** /athletes/[id] (Overview, Sessions)
- **Demo state:** Session card expanded with 'AI Summary', a reply chip 'Not sure', and a Share toggle
- **Competitor gap:** yes. Athlete comprehension replies attached to each coaching session are rare.
- **No posts of its own:** Covered by the last-time-you-said posts: a facet of that feature rather than a post of its own.

### Private coach notes `coach-notes`

**shipped**. Free-text dated notes per athlete with a list view.

- **Pain removed:** Coaches keep observations and plans next to the athlete.
- **Evidence:** athletes/[id]/page.tsx saveNote and loadNotes call /api/notes GET and POST (scope-checked). An error state is distinct from 'No notes yet'.
- **Surfaces:** /athletes/[id]?tab=notes
- **Demo state:** A note card dated 12 Nov
- **Competitor gap:** no. Standard.
- **No posts of its own:** Private notes are table stakes in every competitor.

### Athlete profile, metrics, photo `athlete-profile-fields`

**shipped**. Edit sport, position, free-text height, goals, sport metrics as key/value pairs, custom fields and a photo. The saved values are shown back read-only.

- **Pain removed:** Coaches keep one record of each athlete's details and benchmarks.
- **Evidence:** athletes/[id]/page.tsx saveProfile and uploadPhoto call PATCH /api/athletes/[id] (allowed fields list) and /api/athletes/[id]/photo with a signed upload. Head only (the tab is hidden for assistants).
- **Surfaces:** /athletes/[id]?tab=profile
- **Demo state:** Read view: 'Tennis · Baseliner · 172cm', Metrics '40m sprint 5.2s'
- **Competitor gap:** no. Standard.
- **No posts of its own:** Record-keeping fields.

### What you keep repeating `insight-recurring-cues`

**shipped**. Lists up to 5 short phrases (3 words max) the coach said in 3 or more of the last 8 weeks' sessions with this athlete, with counts and links to the sessions. Roster names are ignored.

- **Pain removed:** Coaches notice cues that aren't landing because they keep repeating them.
- **Evidence:** app/components/CoachInsights.tsx calls /api/coach/insights?athlete_id (head only, roster-checked), which uses lib/insights.ts recurringThemes over transcripts and summaries. Only phrases and counts leave the server.
- **Surfaces:** /athletes/[id] (Overview)
- **Demo state:** '"follow through" , you've mentioned it in 5 of the last 7 sessions'
- **Competitor gap:** yes. Typical coaching apps do not analyse coach speech for repeated cues.

### 'Not sure' reply signal `insight-not-sure-signal`

**shipped**. Counts Got it, Working on it and Not sure replies and unanswered takeaways. Flags when 2 or more of the last 5 replies were 'not sure' ('maybe rephrase') and links to those sessions.

- **Pain removed:** Coaches learn when their feedback isn't understood.
- **Evidence:** lib/insights.ts replySignal (NOT_SURE_FLAG_AT=2, LOOKBACK=5). Athletes answer via /api/sessions/[id]/respond from app/athlete/page.tsx. Shown in CoachInsights.tsx.
- **Surfaces:** /athletes/[id] (Overview)
- **Demo state:** 'Mia said "not sure" to 2 of their last 5 takeaways , maybe rephrase.'
- **Competitor gap:** yes. A feedback-comprehension signal is novel.

### Athlete access activity log `access-log`

**shipped**. Shows the last 20 times the athlete opened shared sessions or other content, with times. Coaches' own views are not logged.

- **Pain removed:** Coaches know whether feedback was actually read.
- **Evidence:** app/components/AccessLog.tsx calls /api/coach/access-log (roster-scoped). Writes come from /api/sessions/[id]/detail and /seen via lib/access-log.ts recordAccess (migration 030). Head only. Also: lib/access-log.ts. Migration 030. app/api/sessions/[id]/detail (session_opened) and /seen (summary_viewed, called from app/athlete/page.tsx). app/api/coach/access-log. app/components/AccessLog.tsx. Disclosure at app/athlete/page.tsx line 2051. The video_viewed, audio_played and report_viewed kinds are defined but no client records them. Shipped for session opens and summary views. The video_viewed, audio_played and report_viewed kinds are defined but nothing records them.
- **Surfaces:** /athletes/[id] Activity, /sessions/[id] 'Seen by', /athletes/[id] (Overview)
- **Demo state:** 'Opened "Serve mechanics" · Fri 4:12pm'
- **Competitor gap:** yes. Per-item read audit trails are uncommon in coaching apps.
- **No posts of its own:** Covered by the seen-receipt posts: a facet of that feature rather than a post of its own.

### Athlete calendar and upcoming `athlete-calendar-tab`

**shipped**. Shows this athlete's month calendar, upcoming booked sessions for the next 2 months with check-in status, and a jump to the month of their most recent session.

- **Pain removed:** Coaches don't misread an empty month as 'no sessions'.
- **Evidence:** athletes/[id]/page.tsx fetches /api/calendar?athlete_id&month, keeps a separate 2-month upcoming window, and has the 'Jump to their most recent session →' button.
- **Surfaces:** /athletes/[id]?tab=calendar
- **Demo state:** 'Mia's calendar · 24 sessions recorded · most recent 2 Nov 2026' with the upcoming list
- **Competitor gap:** no. Common.
- **No posts of its own:** Covered by the calendar-month posts: a facet of that feature rather than a post of its own.

### Message from athlete profile `profile-message-link`

**shipped**. The Message button on the profile opens Messages with this athlete's thread preselected.

- **Pain removed:** Coaches go from reviewing an athlete straight to contacting them.
- **Evidence:** athletes/[id]/page.tsx links to /dashboard?tab=messages&athlete={id}. dashboard/page.tsx reads urlAthlete into msgPreselectedId.
- **Surfaces:** /athletes/[id] → /dashboard?tab=messages
- **Demo state:** Thread open on Mia
- **Competitor gap:** no. Standard.
- **No posts of its own:** Covered by the messaging-voice posts: a facet of that feature rather than a post of its own.

### Voice messages `messaging-voice`

**shipped**. The coach records a voice note in the browser, previews it and sends it into the athlete's thread, where the athlete plays it. Athletes can attach audio files but have no in-app voice recorder.

- **Pain removed:** Coaches can talk instead of typing from the field.
- **Evidence:** MessagingPanel.tsx records with MediaRecorder (SUPPORTED_RECORDING_TYPES), uploads to the messages-media bucket, then POSTs msg_type 'audio'. A failed upload keeps the recording. Athlete side: no recorder in the portal composer; athletes play coach voice notes and attach files.
- **Surfaces:** /dashboard?tab=messages, /athlete Messages
- **Demo state:** Recorded clip preview with Send and Discard
- **Competitor gap:** no. Voice notes are common in chat apps and in some coaching apps (e.g. CoachNow).


## Athlete (26)

### Athlete joins coach by code `athlete-join-by-code`

**shipped**. An athlete who signed up without a code types one into the athlete portal and goes onto that coach's roster as active straight away.

- **Pain removed:** An athlete who registered before getting the code can still link to the coach without starting over.
- **Evidence:** app/athlete/page.tsx (around line 1291) POSTs to /api/join. app/api/join/route.ts checks the athlete role, looks up the coach by invite_code, rejects duplicates and inserts an athletes row with activationFields. Sign-up shows an 'unlinked code' state if the code fails.
- **Surfaces:** /athlete (unlinked state), /signup, /signup?code=…, /athlete (join card)
- **Demo state:** 'Your account isn't linked to a coach yet' with the code field
- **Competitor gap:** no. Common pattern.
- **No posts of its own:** Covered by the coach-invite-code-qr posts: a facet of that feature rather than a post of its own.

### Athletes told about new assistant `assistant-access-notice`

**shipped**. When an assistant gets access to an athlete, a message from the head coach appears in that athlete's thread saying who the assistant is and what they can see.

- **Pain removed:** A teen athlete isn't surprised to find a new adult reading their sessions and check-ins.
- **Evidence:** lib/staff-notice.ts noticeAssignedAthletes inserts the messages. It is called from app/api/staff/route.ts (on assignment) and app/api/staff/accept/route.ts. The wording is lib/staff-invite.ts assignedNoticeText.
- **Surfaces:** Athlete messages thread, /athlete Messages
- **Demo state:** Thread message: '<Name> is an assistant coach on <Head>'s team… can now see your sessions'
- **Competitor gap:** yes. Telling the athlete when someone new gets access is rare in coaching apps.
- **No posts of its own:** Covered by the assistant-coach-invites posts: a facet of that feature rather than a post of its own.

### Athlete weekly digest in-app `athlete-weekly-digest`

**shipped**. An in-app look back at the week: what the coach shared, takeaways, the athlete's replies, check-in days and changes to availability. No streaks or scores.

- **Pain removed:** Athletes see the whole week at a glance without scrolling through every session.
- **Evidence:** app/components/AthleteDigest.tsx and lib/digest.ts buildDigest/isDigestDay, rendered in app/athlete/page.tsx. In-app only: no email or push (lib/push.ts header).
- **Surfaces:** /athlete, /athlete Today
- **Demo state:** Digest card: week range, takeaways, 'checked in on 4 days'
- **Competitor gap:** yes. A no-streak, no-score weekly recap aimed at teen wellbeing.
- **No posts of its own:** Covered by the training-rhythm posts: a facet of that feature rather than a post of its own.

### Shared feedback called a 'nod' `nod-naming`

**shipped**. Shared session feedback is called a 'nod' everywhere the athlete sees it: 'Nods from your coach', 'Max gave you a nod', 'Read your nod'.

- **Pain removed:** Feedback reads as encouragement, not a report card.
- **Evidence:** app/athlete/page.tsx lines 1867 and 2040. app/sessions/[id]/page.tsx line 988. lib/notify.ts notifySessionShared. lib/push.ts line 109.
- **Surfaces:** /athlete, /sessions/[id], email, push
- **Demo state:** 'Nods from your coach' section header on the athlete home
- **Competitor gap:** yes. A distinctive, warm name for feedback.
- **No posts of its own:** Brand vocabulary, used inside posts rather than as one.

### Group transcript and audio withheld `multi-athlete-privacy`

**shipped**. For squad and several-athlete recordings, the athlete gets only their own summary; the transcript and audio are never sent to their device.

- **Pain removed:** Children don't read or hear what the coach said about teammates.
- **Evidence:** detail route nulls the transcript/audio when group_id or shared_recording_id is set; audio-url route returns 403; /api/athlete/sessions list omits transcript; migration 033 narrows RLS. UI caveat: the portal's 'View full transcript' says 'No transcript was saved' for several-mode sessions
- **Surfaces:** /sessions/[id], /athlete, /athlete Sessions tab
- **Demo state:** Portal note 'This was a squad session. Your summary above is yours…'
- **Competitor gap:** yes. Safeguarding for youth groups

### First-login welcome screen `first-login-welcome`

**shipped**. On first visit, a linked athlete sees a three-step explainer (check in daily, view your sessions, message your coach) before reaching the portal.

- **Pain removed:** A new teenage user learns what the app is for in one screen.
- **Evidence:** app/athlete/page.tsx: shown when hasOnboarded===false, there are no sessions, athleteId is set and no join just happened. Dismissal is stored in localStorage cv_onboarded_<uid>.
- **Surfaces:** /athlete
- **Demo state:** 'Welcome to Pindar, Mia.' with three cards and a 'Let's go →' button
- **Competitor gap:** no. Common onboarding pattern.
- **No posts of its own:** First-run furniture.

### Nods from your coach feed `nods-feed`

**shipped**. Home shows the newest shared session as a featured card marked NEWEST, then the two before it as rows; the Sessions tab lists every shared session as an expandable card.

- **Pain removed:** The athlete has one place for the coach's feedback instead of hunting through texts and voice memos.
- **Evidence:** app/athlete/page.tsx (home section titled 'Nods from your coach'; Sessions tab list) ← GET /api/athlete/sessions (app/api/athlete/sessions/route.ts: service role, the caller's athlete rows, shared_with_athlete=true, fixed column list with no transcript) ← sessions table written by POST /api/sessions.
- **Surfaces:** /athlete (Today and Sessions tabs)
- **Demo state:** Home card with the NEWEST badge, title, bullet summary and a 'Read session →' footer
- **Competitor gap:** yes. Feedback comes from the coach's spoken recording, rewritten for the athlete, rather than a typed note or a raw file.
- **No posts of its own:** Covered by the ai-session-summary posts: a facet of that feature rather than a post of its own.

### AI summary of coach's talk `ai-session-summary`

**shipped**. Each shared session shows at most five bullet points summarising what the coach said in the recording, written for the athlete.

- **Pain removed:** The athlete reads the coaching points in seconds instead of replaying several minutes of audio.
- **Evidence:** lib/quick-summary.ts + lib/summary-prompt.ts (gpt-4o-mini, capped at 5 bullets, guardSummary drops anything the coach did not say, body/weight comments stripped, content gate) called from app/api/sessions/route.ts, or the coach's edited draft is used as sent. Rendered in app/athlete/page.tsx (home bullets, 'Coach Summary' in the Sessions tab) and on app/sessions/[id]/page.tsx under 'Session summary'.
- **Surfaces:** /athlete, /sessions/[id]
- **Demo state:** Session page 'Session summary' with 3 bullets
- **Competitor gap:** yes. A voice recording becomes an athlete-safe summary with guardrails; most team apps only carry typed notes.

### Take into next session `take-into-next-session`

**shipped**. Shows the coach's one forward-looking instruction, extracted from the recording or typed by the coach, as the highlighted 'Take into next session' line.

- **Pain removed:** The athlete knows the one thing to work on next time without re-reading everything.
- **Evidence:** focus_points[0] (NEXT: line, at most MAX_NEXT_LENGTH) saved in app/api/sessions/route.ts. Home .ah-take block in app/athlete/page.tsx; numbered list on app/sessions/[id]/page.tsx (the coach can add or remove points there).
- **Surfaces:** /athlete home card, /sessions/[id]
- **Demo state:** Ember-edged box 'TAKE INTO NEXT SESSION , Keep your elbow high on the follow-through'
- **Competitor gap:** yes. The single next action is pulled automatically from what the coach said.

### Training-day takeaway reminder `takeaway-reminder`

**shipped**. On a day the coach has planned a session, the latest takeaway (from an earlier day) is pinned at the top of Home as 'Today: remember ,' with the training time and the reply chips.

- **Pain removed:** The athlete is reminded of last session's instruction on the day it matters.
- **Evidence:** lib/digest.ts trainingToday and takeawayPlacement (returns 'top' when trainsToday and the takeaway is older than today). app/components/TakeawayReminder.tsx. Calendar data comes from GET /api/calendar. This is in-app only; there is no push or email.
- **Surfaces:** /athlete Today
- **Demo state:** 'TODAY: REMEMBER , Training at 4:30pm today' card with the takeaway
- **Competitor gap:** yes. Ties the last feedback to the next scheduled session automatically.

### Replay coach's voice (1:1 only) `coach-recording-playback`

**shipped**. For an individual shared session, the athlete can stream the coach's original audio recording.

- **Pain removed:** The athlete can hear the coach's actual tone and words, not only a summary.
- **Evidence:** app/components/SessionAudioPlayer.tsx (Play recording, preload none, iOS WebM fallback to a download link) → GET app/api/sessions/[id]/audio-url/route.ts (1h signed URL from the private session-audio bucket; for athletes only when shared_with_athlete and no group_id or shared_recording_id). The detail route also returns audio_url, used on app/sessions/[id]/page.tsx. DEFECT: in the Sessions tab, app/athlete/page.tsx renders the player whenever audio_path is set, and /api/athlete/sessions returns audio_path for squad rows too. On squad sessions the button is shown, the route returns 403, and the athlete sees 'You do not have access to that.' The home card also shows an 'Audio' badge on squad sessions. Also: detail route sets athleteMayHearIt = !group_id && !sharedRecording; audio-url route gives athletes access for shared, non-multi recordings; app/athlete/page.tsx:2157 SessionAudioPlayer. GAP: the portal shows an 'Audio' badge and player for every row with audio_path, including squad/several sessions, where playback then fails with 'Forbidden' Shipped for 1:1 sessions, end to end. Defect outside the claim: the portal also shows an Audio badge on squad and several-athlete sessions, which then fails with Forbidden. Fixed 14 Nov 2026: the portal shows the Audio badge only on recordings the athlete may hear (lib/athlete-recording.ts).
- **Surfaces:** /sessions/[id], /athlete portal, /athlete Sessions tab (inline)
- **Demo state:** Recording band with a round play button labelled 'PLAY RECORDING'
- **Competitor gap:** yes. The athlete gets the coach's own voice alongside a written summary.

### Full transcript (1:1 only) `transcript-view`

**shipped**. On individual sessions, the athlete can expand 'View full transcript' and read the coach's words verbatim.

- **Pain removed:** The athlete can check exactly what was said without listening again.
- **Evidence:** app/athlete/page.tsx loadTranscript → GET app/api/sessions/[id]/detail/route.ts (the transcript is null for an athlete on group_id or shared_recording_id rows). app/sessions/[id]/page.tsx 'Full transcript' with word count. Caveat: on a 'several athletes' shared recording, the Sessions tab still offers 'View full transcript' and then shows 'No transcript was saved for this session.', which is misleading.
- **Surfaces:** /athlete Sessions tab, /sessions/[id]
- **Demo state:** Expanded transcript panel
- **Competitor gap:** no. Transcripts are common in voice-note tools.
- **No posts of its own:** Covered by the coach-recording-playback posts: a facet of that feature rather than a post of its own.

### Save takeaway as image `focus-card`

**shipped**. Turns the session's first takeaway into a branded 1080×1350 PNG showing only the sentence, the date and the wordmark, and opens the phone's share sheet or downloads it.

- **Pain removed:** The athlete can keep the instruction as a wallpaper or story without exposing personal details.
- **Evidence:** app/components/FocusCard.tsx (canvas render, navigator.share with files, download fallback 'focus.png') rendered only for !isCoach in app/sessions/[id]/page.tsx when focus_points exist. Client-only; no server.
- **Surfaces:** /sessions/[id] ('Save this as an image')
- **Demo state:** Generated card image with the takeaway sentence
- **Competitor gap:** yes. A shareable artefact for minors that deliberately carries no identifying data.

### 12-week training rhythm bars `training-rhythm`

**shipped**. Under the check-in card, bars show shared sessions per week over 12 weeks, with this week highlighted, once there are at least 3 sessions.

- **Pain removed:** The athlete can see their training add up over time.
- **Evidence:** lib/training-spine.ts buildSpine, SPINE_MIN_SESSIONS, SPINE_WEEKS. app/athlete/page.tsx .ah-spine.
- **Surfaces:** /athlete Today
- **Demo state:** Bar strip captioned 'Training rhythm · 9 sessions over 12 weeks · 1 this week'
- **Competitor gap:** no. Activity charts are common, though this one deliberately has no streaks.

### Two-tap daily readiness check-in `two-tap-checkin`

**shipped**. The athlete picks Flat, OK or Good, leaves 'Nothing sore' (the default) or switches to 'Something's sore', and taps Done. Each day's answer is one row and can be redone.

- **Pain removed:** Replaces an 8–11 tap, five-slider form that teenagers abandon.
- **Evidence:** app/components/CheckIn.tsx → POST app/api/wellness/route.ts (upsert on athlete_id,check_date using the phone's date). lib/readiness.ts maps Flat/OK/Good to 2/3/4 for energy, mood and stress; soreness comes from the marked areas; sleep_q is left NULL. NOTE: the current form does NOT ask about energy, mood, sleep or stress separately. Those are derived (or null for sleep) and only legacy rows contain real five-metric answers. Do not market it as tracking sleep, mood or stress.
- **Surfaces:** /athlete 'Check in' tab, Home card
- **Demo state:** Three-way control with OK selected, 'Nothing sore' pressed, and a DONE button
- **Competitor gap:** yes. Much lighter than the multi-question wellness forms in AMS tools (TeamBuildr, Smartabase).

### Your 14-day check-in strip `checkin-history`

**shipped**. Shows the athlete's own last 14 days as coloured cells plus one plain sentence, for example the biggest drop in energy, sleep or soreness on legacy rows, or 'You checked in on N of the last 14 days'.

- **Pain removed:** The athlete gets something back for checking in.
- **Evidence:** app/athlete/page.tsx WellnessHistory ← GET /api/wellness?athlete_id&days=21 (RLS limits it to the athlete's own rows). Mood and stress are deliberately never put into words for the athlete.
- **Surfaces:** /athlete Check in tab ('Trends →' from Home)
- **Demo state:** 14 coloured cells with today ringed, 'You checked in on 9 of the last 14 days.'
- **Competitor gap:** no. Personal trend views are common.
- **No posts of its own:** Covered by the two-tap-checkin posts: a facet of that feature rather than a post of its own.

### Check-in saved without signal `offline-checkin-queue`

**shipped**. If the check-in POST fails because the phone is offline, the answer is stored on the phone (IndexedDB) and sent automatically when signal returns. Answers older than the server's one-day window are dropped with a visible note.

- **Pain removed:** A check-in made at the side of a pitch with no signal is not lost.
- **Evidence:** lib/checkin-queue.ts (putCheckin, drainCheckins, sendability, classifyResponse). app/components/CheckIn.tsx ('Saved on this phone. It'll send when you have signal.', drains on mount and on 'online'). app/athlete/page.tsx drains on load. Caveat: public/sw.js never caches HTML, so the portal cannot be opened offline. The queue covers losing signal while the page is open, not offline launch. It does nothing in private mode.
- **Surfaces:** /athlete Check in tab
- **Demo state:** 'Checked in.' with the note 'Saved on this phone. It'll send when you have signal.'
- **Competitor gap:** yes. Few wellness apps handle loss of signal mid-submit.
- **No posts of its own:** Reliability rail. Marketing "works with no signal" invites the recording case, which is partial.

### See your injury availability `availability-view`

**shipped**. Home shows, read-only, any open injury the coach logged: the body area, status (Out = not training this, Modified = training with changes) and expected return date.

- **Pain removed:** The athlete does not find out from a team sheet that they have been marked unavailable.
- **Evidence:** GET app/api/injuries/route.ts (the athlete may read only their own; writes are coach-only, enforced by the route and the migration 025 RLS). app/athlete/page.tsx 'Your availability' with 'Your coach set this. Talk to them if it does not match how you feel.' lib/injury.ts statuses.
- **Surfaces:** /athlete Today
- **Demo state:** 'Your availability , Left ankle [Training, with changes] · Your coach has you back around Fri 10 Oct.'
- **Competitor gap:** yes. Shows the injury record to the minor it describes, who cannot clear themselves to play.
- **No posts of its own:** Covered by the injury-body-map posts: a facet of that feature rather than a post of its own.

### Calendar: coach plus personal events `athlete-calendar`

**shipped**. A month calendar shows the coach's shared events and sessions plus the athlete's own reminders and goals, which they can add (title, type, time, notes) and delete.

- **Pain removed:** The athlete has training and personal plans in one place.
- **Evidence:** app/components/Calendar.tsx (role athlete; an event can be deleted only by the role that created it). app/athlete/page.tsx saveCalendarEvent and deleteCalEvent → app/api/calendar/route.ts (athlete GET returns coach events with visible_to_athlete plus their own; POST verifies athlete_user_id; DELETE by creator only). Coach GET branches filter created_by_role='coach', so coaches never see athletes' personal events, matching the on-screen copy.
- **Surfaces:** /athlete Calendar tab
- **Demo state:** Month grid with a coach session marked 'From coach' and a 'My event' reminder
- **Competitor gap:** no. Team calendars are standard.
- **No posts of its own:** Covered by the calendar-month posts: a facet of that feature rather than a post of its own.

### 'Coach gave you a nod' alerts `nod-notification`

**shipped**. When a session is shared, the athlete gets an email 'Max gave you a nod' with up to 200 characters of their summary, and a push titled 'Max gave you a nod'.

- **Pain removed:** The athlete knows new feedback is waiting.
- **Evidence:** Email: lib/notify.ts notifySessionShared, called from POST app/api/sessions/route.ts when shared at save and from PATCH app/api/sessions/[id]/route.ts on the first share. Push: lib/push.ts notifyPushSessionShared is called ONLY from POST /api/sessions, so a session shared later via the toggle sends email but no push. Push also requires VAPID configuration and opt-in. Also: route.ts POST calls notifySessionShared (lib/notify.ts:212) to athletes.email only. GAPS: caretakers are NOT emailed; sharing later via the toggle (PATCH) sends nothing, because the calendar row already exists → outcome 'existed' → no notify Also: route.ts after(() => notifyPushSessionShared); lib/push.ts returns early if pushConfig() is missing. Only on the save path; PATCH share does not push Partial: email and push fire when a session is shared at save. Sharing it later from the toggle sends neither, because the calendar event already exists (syncSessionCalendarEvent returns existed, app/api/sessions/[id]/route.ts:118). Shipped 14 Nov 2026: a later share now notifies once too (sessions.first_shared_at, migration 037; the PATCH route claims it with a conditional update and only that request sends the email and push).
- **Surfaces:** Email, Device push, lock screen
- **Demo state:** Email heading 'Max gave you a nod' with a 'Read your nod' button
- **Competitor gap:** no. Share notifications are standard.
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### Private typed notes `private-notes-typed`

**shipped**. The athlete writes, edits and deletes (with confirmation) private notes, either general or attached to a session, and can filter them by session. Coaches cannot read them.

- **Pain removed:** The athlete has a personal training journal next to the coach's feedback.
- **Evidence:** app/athlete/page.tsx saveNote, updateNote, deleteNote and NoteCard → app/api/athlete-notes/route.ts (filters on athlete_user_id) → the athlete_notes RLS policy 'owner full access' (supabase/migrations/017). No coach code reads athlete_notes.
- **Surfaces:** /athlete Notes tab (desktop tab, reached on mobile from the Home 'Add a private note' button), the session card in the Sessions tab
- **Demo state:** 'Your notes are 100% private , coaches cannot see them.' with a note card
- **Competitor gap:** no. Journals exist in training apps.
- **No posts of its own:** Table stakes.

### Voice-to-text private notes `voice-private-notes`

**shipped**. The athlete taps 'Voice note', speaks, and the recording is transcribed into a private text note tagged as Voice. The audio itself is not kept.

- **Pain removed:** Reflecting after training without typing on a phone.
- **Evidence:** app/athlete/page.tsx startNoteRecording (MediaRecorder with SUPPORTED_RECORDING_TYPES, mp4 first) → POST /api/transcribe (Whisper) → POST /api/athlete-notes note_type 'voice'. Errors are shown for a denied microphone, no microphone, or empty audio.
- **Surfaces:** /athlete Notes tab
- **Demo state:** Note card with a '🎙️ Voice' badge
- **Competitor gap:** no. Dictation is common.
- **No posts of its own:** Athlete-only journalling; real, but off the coach-athlete story the 30 days tell. Candidate for a later run.

### What athletes cannot see `privacy-boundaries`

**shipped**. Withholds on the server: unshared sessions, unshared videos, coach drawings on the athlete's clips until sent back, squad and multi-athlete transcripts and audio, the coach-only 'How they came in' wellness panel, and clip file names. Push payloads name only the sender.

- **Pain removed:** Coach-private material and teammates' information do not reach a teenager's phone.
- **Evidence:** app/api/athlete/sessions/route.ts (shared only, no transcript column). app/api/sessions/[id]/detail/route.ts (transcript and audio rules; checkin null for athletes). lib/video-clip.ts athleteMayViewVideo and athleteSeesAnnotations. app/api/share/clip/[videoId]/route.ts (file_name null for athletes). lib/push.ts (payload keys title, url, tag only). Respond and seen routes return 404 for unshared sessions. Caveats as noted: the squad audio button is broken, and generic squad summaries can include names.
- **Surfaces:** All athlete surfaces
- **Demo state:** Squad session showing a summary but no transcript, with an explanation
- **Competitor gap:** yes. Built specifically for 13–18 year olds.
- **No posts of its own:** Covered by multi-athlete-privacy and safeguarding-rls-gate posts.

### Deep links to portal tabs `push-deep-link-tabs`

**shipped**. /athlete?tab=messages (and sessions, calendar, notes, wellness) opens that tab directly, which is used by push notification taps.

- **Pain removed:** Tapping a notification lands on the right screen.
- **Evidence:** app/athlete/page.tsx useState initialiser reads ?tab=. lib/push.ts url '/athlete?tab=messages'.
- **Surfaces:** /athlete?tab=…
- **Demo state:** Messages tab opened from a notification
- **Competitor gap:** no. Standard.
- **No posts of its own:** Navigation.

### Two-step sign out `safe-signout`

**shipped**. 'Out' asks 'Sign out of Pindar?' (Stay / Sign out), and signing out also stops push to that phone.

- **Pain removed:** No accidental logouts from a stray tap.
- **Evidence:** app/athlete/page.tsx confirmOut and logout → forgetPushOnSignOut (lib/push-client.ts), clearCachedProfile.
- **Surfaces:** /athlete header
- **Demo state:** Confirmation strip under the header
- **Competitor gap:** no. Minor UX detail.
- **No posts of its own:** Housekeeping.

### Daily motivational quote `daily-quote`

**shipped**. Shows a rotating quote at the top of the athlete's Calendar tab.

- **Pain removed:** A small daily touch of motivation.
- **Evidence:** app/athlete/page.tsx getDailyQuote('athlete') from lib/quotes.ts.
- **Surfaces:** /athlete Calendar tab
- **Demo state:** Quote strip above the calendar
- **Competitor gap:** no. Cosmetic.
- **No posts of its own:** Decoration; a post about it would undersell the product.


## Coach and athlete (32)

### Coach or athlete guided sign-up `signup-role-onboarding`

**shipped**. Sign-up in several steps: pick coach or athlete, enter name, sport (wheel picker), level and goals, with optional email confirmation.

- **Pain removed:** Each account starts with a profile that fits its role, and nobody has to set it up later.
- **Evidence:** app/signup/page.tsx uses supabase.auth.signUp with metadata. Confirmation returns through app/auth/callback/route.ts (next=/signup?finish=1). app/api/complete-signup/route.ts writes the profile and generates the coach invite_code.
- **Surfaces:** /signup, /signup/confirm
- **Demo state:** Role step with the two cards, Coach and Athlete
- **Competitor gap:** no. Standard onboarding.
- **No posts of its own:** Account housekeeping: sign-up is expected of any app, not a reason to choose one.

### Sign in and password reset `signin-password-reset`

**shipped**. Sign in with email and password. 'Forgot password' sends an emailed link that opens /reset to set a new password.

- **Pain removed:** A user who forgets their password gets back in without contacting the coach or support.
- **Evidence:** app/page.tsx: signInWithPassword and resetPasswordForEmail (redirect /auth/callback?next=/reset). app/auth/callback/route.ts exchanges the PKCE code and blocks open redirects. app/reset/page.tsx calls updateUser({password}) and shows a 'link didn't work' state.
- **Surfaces:** /, /reset, /auth/callback
- **Demo state:** Reset link sent: 'check your inbox' confirmation
- **Competitor gap:** no. Table stakes.
- **No posts of its own:** Account housekeeping.

### Scoped access and transcript withholding `assistant-scope-transcript-withholding`

**shipped**. Athletes never receive raw transcripts or audio of squad or multi-athlete recordings, only their own summary. Assistants don't get transcripts that cover athletes they weren't assigned. The data is withheld by the server, not just hidden in the page.

- **Pain removed:** A coach's remark about one child doesn't reach other children or unassigned staff.
- **Evidence:** app/api/sessions/[id]/detail/route.ts nulls transcript and audio for group or shared recordings and sets transcript_withheld. app/api/sessions/route.ts recordingsWithheld. The withheld notice shows in app/athletes/[id]/page.tsx, app/sessions/[id]/page.tsx and app/pdf/session. lib/coach-scope.ts.
- **Surfaces:** /sessions/[id], /athletes/[id], /pdf/session/[id], save API
- **Demo state:** 'The full transcript is not shown: this recording is about athletes who have not been given to you.'
- **Competitor gap:** yes. Few apps handle what a group recording reveals about each child.
- **No posts of its own:** Covered by the assistant-coach-invites posts: a facet of that feature rather than a post of its own.

### Child-safe data rules enforced `safeguarding-rls-gate`

**shipped**. Database row-level security plus server-side role and roster checks on every route. A safeguarding scanner runs as a build gate. (The content gate on recordings is a separate feature: content-safety-gate.)

- **Pain removed:** Coaches and clubs can trust the app with minors' data.
- **Evidence:** supabase/migrations 001, 017, 033 (security_integrity) and 034/035. tools/safeguard-check.mjs rules SG1-SG11. lib/content-gate.ts (OpenAI moderation plus a fixed word list that always runs). Caretaker and email routes check roster ownership.
- **Surfaces:** Cross-cutting
- **Demo state:** Hard to show on screen. Use a 'built for 13-18 year olds' trust panel
- **Competitor gap:** yes. Explicit safeguarding for minors with build-time enforcement is rare.

### Email notifications for key events `email-notifications`

**shipped**. Branded emails go out for: session shared (a 'nod'), new message (sent once per unread backlog, not per message), calendar event added (with a check-in request variant), and invites. Replies go to the coach's own inbox.

- **Pain removed:** Athletes who don't open the app every day still learn something is waiting.
- **Evidence:** lib/notify.ts sends through Gmail SMTP or Resend. Callers: app/api/sessions, sessions/[id], messages, calendar, athletes, staff. Needs GMAIL_* or RESEND_API_KEY to be set.
- **Surfaces:** Email inbox, links to /athlete and /dashboard
- **Demo state:** 'Coach Max gave you a nod' email with a 'Read your nod' button
- **Competitor gap:** no. Common, though batching messages into one email per unread backlog is thoughtful.
- **No posts of its own:** Plumbing behind other features; each notification is marketed with the feature that sends it.

### Privacy-safe push notifications `push-notifications`

**shipped**. Opt-in web push for new messages and shared sessions. The lock screen shows only who it is from (e.g. 'Max gave you a nod'), never message content, scores or summaries.

- **Pain removed:** A notification on a teen's lock screen never shows private content to a parent or teammate holding the phone.
- **Evidence:** lib/push.ts (closed list of kinds, title-only payload). lib/push-client.ts and app/api/push/subscribe handle subscribing and unsubscribing. public/sw.js handles push and notificationclick. app/components/PushOptIn.tsx on the dashboard and athlete page includes iOS 'Add to Home Screen' guidance. Needs VAPID env keys.
- **Surfaces:** /dashboard and /athlete opt-in card, lock screen, /dashboard?tab=settings
- **Demo state:** Lock screen showing 'Max gave you a nod' with no other content
- **Competitor gap:** yes. Content-free lock-screen notifications designed for minors.
- **No posts of its own:** Plumbing behind other features; also depends on VAPID set-up and per-device opt-in.

### Timestamped annotated clip link `clip-share-link`

**shipped**. Copies a link to a session video at the current timecode, with the coach's drawings. Only the owning coach or that athlete can open it.

- **Pain removed:** The coach points an athlete to the exact moment in a video in one link.
- **Evidence:** app/components/VideoAnnotator.tsx copyShareLink builds /share/clip/[videoId]?session&t. app/share/clip/[videoId]/page.tsx. app/api/share/clip/[videoId]/route.ts returns 401 when signed out and checks coach or athlete access.
- **Surfaces:** /share/clip/[videoId]
- **Demo state:** Clip paused at the timecode with the drawing overlay
- **Competitor gap:** no. Video tools offer timestamp links, but these links are private to coach and athlete.
- **No posts of its own:** Covered by the video-moments posts: a facet of that feature rather than a post of its own.

### Installable home-screen app `pwa-install`

**shipped**. Installs to the home screen as 'Pindar' and runs full screen, with maskable icons and iOS launch images.

- **Pain removed:** Feels like a native app with no app store download.
- **Evidence:** app/manifest.ts (standalone, icons). public/sw.js registered in app/layout.tsx. public/splash. There is no beforeinstallprompt button; only the iOS Add-to-Home-Screen text inside PushOptIn.
- **Surfaces:** Browser install, home screen
- **Demo state:** Pindar laurel icon on an iPhone home screen
- **Competitor gap:** no. PWAs are common.
- **No posts of its own:** Distribution detail. Worth a line in a bio, not a post.

### Safe automatic app updates `auto-update`

**shipped**. An installed app checks the deployed version every 10 minutes and on return. It reloads to the new version only at a safe moment, never while recording or while there is typed text.

- **Pain removed:** No stale installs, and no lost work from a forced reload.
- **Evidence:** app/components/UpdateWatcher.tsx (mounted in app/layout.tsx) with lib/app-update.ts (BUSY_SELECTOR, updateDecision). The version comes from app/manifest.ts pindar_version.
- **Surfaces:** Global (invisible)
- **Demo state:** Not visual. State it as a benefit line
- **Competitor gap:** no. An internal reliability feature.
- **No posts of its own:** Internal: fixes our own deploy problem, not a coach problem.

### iOS reinstall-for-new-icon nudge `reinstall-nudge`

**shipped**. A one-time card asks iPhone users who installed the app under its old name (CoachVoice) to reinstall it to get the new Pindar icon, after checking nothing is still waiting to upload.

- **Pain removed:** Old installs get the current branding because iOS never refreshes home-screen icons itself.
- **Evidence:** app/components/ReinstallNudge.tsx and lib/reinstall-nudge.ts (iOS only, pre-rename installs, 3-day snooze). Used on /dashboard and /athlete.
- **Surfaces:** /dashboard, /athlete, /dashboard (Home), /athlete Today (iOS standalone only)
- **Demo state:** Not marketing-relevant (migration chore)
- **Competitor gap:** no. Internal migration aid.
- **No posts of its own:** Internal: migration aid for the rename.

### 'Voice becomes the wreath' opening `opening-animation`

**shipped**. The branded launch animation: voice bars fly up into a laurel wreath, then 'Pindar' and 'Hear it. Own it.' appear. It plays before the app loads and respects reduced motion.

- **Pain removed:** The cold start is no longer a blank screen and it shows the brand.
- **Evidence:** lib/opening.ts, app/layout.tsx boot shell CSS, app/components/OpeningMark.tsx and IntroSequence.tsx on '/'. Plays on first visit and again after 30 minutes away.
- **Surfaces:** App launch, /
- **Demo state:** Mid-frame: bars turning into laurel leaves
- **Competitor gap:** no. Brand polish, not a capability.
- **No posts of its own:** Brand moment, not a feature with a pain behind it.

### Grounded five-bullet summary cap `summary-grounding-guard`

**shipped**. Summaries are capped at 5 bullets, and any bullet or takeaway the coach didn't actually say is removed in code.

- **Pain removed:** No invented advice or padded lists reach athletes.
- **Evidence:** lib/summary-guard.ts guardSummary/capBullets (GROUNDING_RATIO 0.6) used in lib/quick-summary.ts and split-summary route; capBullets applied again on save in route.ts:308
- **Surfaces:** All summaries
- **Demo state:** Empty draft: 'No summary drafted: nothing in this recording matched a coaching point you made.'
- **Competitor gap:** yes. Enforced grounding, not just prompting

### Dedicated session page `session-page`

**shipped**. /sessions/[id] shows a dateline masthead, title, athlete, a Shared/Private chip, the summary as bullets, and the transcript collapsed at the bottom with a word count.

- **Pain removed:** A session is a place to revisit, not an accordion row.
- **Evidence:** app/sessions/[id]/page.tsx reads one request from /api/sessions/[id]/detail; serves both roles; back goes to the previous in-app page
- **Surfaces:** /sessions/[id]
- **Demo state:** Masthead '14 / Fri Nov' with ember bullets
- **Competitor gap:** no. Expected
- **No posts of its own:** Covered by the ai-session-summary posts: a facet of that feature rather than a post of its own.

### Coach notes on a session `session-notes`

**shipped**. Add or edit free-text notes (saves on Save or blur, Cancel discards); NOTE: these are shown to the athlete as 'Notes from your coach' when the session is shared.

- **Pain removed:** Context lives with the session.
- **Evidence:** page.tsx saveNotes → PATCH coach_notes (10k cap); the detail route returns coach_notes to athlete viewers; the section renders for the athlete if notes exist Partial: the coach sees these as "Your notes", but they are shown to the athlete on a shared session. A coach could write something private and not know the athlete reads it. Shipped 14 Nov 2026: the coach side now reads "Notes for {name}" and says who sees them; private notes are pointed to the profile.
- **Surfaces:** /sessions/[id]
- **Demo state:** 'Your notes' with an Edit notes button
- **Competitor gap:** no. Not private notes , do not market as private
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### Attach images to session `session-images`

**shipped**. Upload whiteboard shots or diagrams, remove them with a confirmation; the athlete sees them on shared sessions.

- **Pain removed:** Visuals sit with the feedback.
- **Evidence:** page.tsx uploadImage → signed URL from /api/sessions/[id]/attachments, then POST; DELETE with confirm(); images only
- **Surfaces:** /sessions/[id]
- **Demo state:** Empty state 'Add a whiteboard shot, a still from video, or a drill diagram.'
- **Competitor gap:** no. Common
- **No posts of its own:** Covered by the ai-session-summary posts: a facet of that feature rather than a post of its own.

### Draw on video, timed strokes `video-annotator`

**shipped**. Pause and draw on a video in 5 colours and 4 widths; each stroke appears at its timestamp and is permanent or fades after 2, 4 or 8 seconds; undo and clear; saved and shown to the athlete.

- **Pain removed:** Show exactly what's wrong instead of describing it.
- **Evidence:** app/components/VideoAnnotator.tsx; page.tsx saveVideoAnnotations → PATCH /api/sessions/[id]/videos annotations; read-only for athletes
- **Surfaces:** /sessions/[id], athlete clip inbox, /athlete Sessions tab
- **Demo state:** Paused frame with an ember arrow and the 'DRAWING' badge
- **Competitor gap:** no. Telestration exists in video tools

### Mark moments, attach to takeaway `video-moments`

**shipped**. The coach marks start and end (or ±N seconds around now) with a label and attaches it to a takeaway; the athlete sees a 'Watch the moment' button that plays only that range with the drawings.

- **Pain removed:** Each takeaway has its video evidence beside it.
- **Evidence:** page.tsx ClipMarker → POST /api/sessions/[id]/clips (validateClipRange); MomentPlayer with VideoAnnotator start/endTime; delete with confirm; athleteMayViewVideo filter
- **Surfaces:** /sessions/[id]
- **Demo state:** Takeaway row with 'Watch the moment 0:12–0:18'
- **Competitor gap:** yes. Clips tied to action items

### Sessions ordered by session date `session-sort-order`

**shipped**. Session lists sort newest first by the day the session happened (backdated ones slot in place), then by creation time; the coach's all-sessions list is paged 50 at a time.

- **Pain removed:** The timeline reads correctly.
- **Evidence:** route.ts GET, /api/sessions/all (range, limit≤100) and /api/athlete/sessions all order by session_date desc, then created_at desc
- **Surfaces:** /athletes/[id], /dashboard Sessions, /athlete
- **Demo state:** A session backdated to last Tuesday listed under Tuesday
- **Competitor gap:** no. Basic
- **No posts of its own:** Correctness detail.

### Honest empty states `empty-states`

**shipped**. Explicit copy instead of blanks: 'No athletes yet , add one first', 'No squads yet' (tab disabled, not hidden), 'No summary was generated for this session', image and video prompts, the brief's 'No athletes are on this session'.

- **Pain removed:** Users always know why something is missing.
- **Evidence:** QuickSessionModal.tsx:943-991; sessions/[id]/page.tsx:1140,1469,1569; PreSessionBrief.tsx:228
- **Surfaces:** Recorder, session page, brief
- **Demo state:** Squad tab shown dashed and disabled with 'No squads yet' hint
- **Competitor gap:** no. Polish
- **No posts of its own:** Correctness detail.

### Athlete emailed on new event `calendar-event-email`

**shipped**. When a coach adds an event to an athlete or squad calendar, each athlete gets an email naming the event, date and notes.

- **Pain removed:** Athletes learn about new homework or sessions without opening the app.
- **Evidence:** app/api/calendar/route.ts calls notifyCalendarEventCreated (lib/notify.ts) for the single-athlete and group branches. It depends on Gmail or Resend being configured and fails silently otherwise.
- **Surfaces:** Athlete inbox
- **Demo state:** Email 'Coach Jo added Speed drills to your calendar'
- **Competitor gap:** no. Event notifications are standard.
- **No posts of its own:** Covered by the calendar-month posts: a facet of that feature rather than a post of its own.

### Ask for pre-session check-in `checkin-requested`

**shipped**. When booking an upcoming session on an athlete's profile, the coach can ask the athlete to check in on the day. The athlete gets a 'Check in before your session' email, and the coach sees 'Checked in · feeling 4/5 · soreness 3/10' or 'not completed yet'.

- **Pain removed:** Coaches know how an athlete's body is before they start.
- **Evidence:** athletes/[id]/page.tsx addUpcomingSession sends checkin_requested to /api/calendar, which only sets it for a single-athlete session event. The email copy is in lib/notify.ts. Status is read from /api/wellness for that date. Not offered in the dashboard Calendar's add-event modal.
- **Surfaces:** Pre-session brief, /athletes/[id]?tab=calendar, Athlete email, /athlete Today and Check in, coach /athletes/[id], dashboard brief
- **Demo state:** Upcoming list: 'Thu 14 Nov · 16:30 · Coaching session , Check-in asked for · not completed yet'
- **Competitor gap:** yes. Tying a readiness check-in to a specific booked session is uncommon.
- **No posts of its own:** Covered by the pre-session-brief posts: a facet of that feature rather than a post of its own.

### Event RSVP `event-rsvp`

**shipped**. Would let athletes answer yes, no or maybe to coach events.

- **Pain removed:** Would tell coaches who is attending.
- **Evidence:** migration 006 has calendar_events.rsvp_enabled and event_rsvps, and app/api/rsvp/route.ts exists. No UI ever sets rsvp_enabled, the calendar GET does not select it, and nothing calls GET /api/rsvp (noted in migration 025). The athlete RSVP list never appears. Also: The UI exists in app/athlete/page.tsx (rsvpEvents filtered on e.rsvp_enabled) and POST app/api/rsvp/route.ts exists, but nothing ever writes rsvp_enabled. GET /api/calendar's baseSelect does not even return rsvp_enabled, so the list is always empty and never renders, and GET /api/rsvp has no coach-side caller. supabase/migrations/025_readiness_checkin.sql says the check-in replaced this 'half-built RSVP feature'. Do not market. Shipped 14 Nov 2026: coaches ask for RSVP when adding an event, athletes answer Going or Can't make it, coaches see names and counts (migration 038, lib/rsvp.ts).
- **Surfaces:** none reachable
- **Demo state:** n/a
- **Competitor gap:** no. RSVP is standard in TeamSnap and similar apps; this one is missing, not a differentiator.
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### Coach–athlete direct messages `messaging-text`

**shipped**. One-to-one threads per athlete with search, per-conversation drafts, live updates and date dividers.

- **Pain removed:** Coaching communication stays off personal phone numbers.
- **Evidence:** app/components/MessagingPanel.tsx calls /api/messages GET, POST and PATCH and uses Supabase Realtime channels. Realtime setup is not in the repo's migrations; threads still load on open.
- **Surfaces:** /dashboard?tab=messages, /athlete Messages tab
- **Demo state:** Thread with Mia showing a 'Read' receipt under the coach's last message
- **Competitor gap:** no. In-app messaging is standard.
- **No posts of its own:** Covered by the messaging-voice posts: a facet of that feature rather than a post of its own.

### Photo, video, audio attachments `messaging-media`

**shipped**. Send images, videos or audio files in a thread. They play inline from signed URLs.

- **Pain removed:** Coaches can share technique clips and photos in context.
- **Evidence:** MessagingPanel.tsx file input accept='image/*,video/*,audio/*' and uploadMedia. /api/messages signs media_path on read (migration 024). Generic files such as PDFs are NOT supported.
- **Surfaces:** /dashboard?tab=messages, /athlete Messages (paperclip)
- **Demo state:** Inline video bubble from the coach
- **Competitor gap:** no. Common.
- **No posts of its own:** Covered by the messaging-voice posts: a facet of that feature rather than a post of its own.

### Injury availability with body map `injury-body-map`

**shipped**. The coach records an injury by tapping a body-map region and sets availability (Out, Modified or Cleared, with a confirmation for Cleared). Cleared injuries can be reopened. The athlete sees the same information read-only.

- **Pain removed:** Everyone knows what a child can do today, without amateur medical notes.
- **Evidence:** app/components/InjuryPanel.tsx with BodyMap calls /api/injuries GET, POST and PATCH (migration 025). Availability statuses come from lib/injury.ts, and there is no diagnosis field by design.
- **Surfaces:** /athletes/[id] (Overview)
- **Demo state:** 'Left knee · Modified since 3 Nov' with the body map highlighted
- **Competitor gap:** no. Injury tracking exists in team platforms, though most are clinical rather than availability-only.

### Share note with athlete `coach-note-share`

**shipped**. A 'Share with athlete' checkbox on coach notes.

- **Pain removed:** Would let a written note reach the athlete.
- **Evidence:** /api/notes saves shared_with_athlete and the coach sees a Shared chip. The athlete portal's 'My Notes' reads /api/athlete-notes (the athlete's own notes), and nothing on the athlete side reads the coach notes table. Shared notes never reach the athlete. Shipped 14 Nov 2026: GET /api/athlete/coach-notes reads shared notes under RLS and the athlete portal shows them under My Notes, "From your coach"; sharing a note runs the content gate.
- **Surfaces:** /athletes/[id]?tab=notes
- **Demo state:** n/a , do not market
- **Competitor gap:** no. Not functional.
- **No posts of its own:** Shipped 14 Nov 2026, after the queue was written. Candidate for month-two posts.

### One-tap 'did it land?' reply `understanding-reply`

**shipped**. The athlete answers the takeaway with Got it, Working on it, or Not sure what you mean, can tap again to undo, and the coach sees the answer on several screens.

- **Pain removed:** The coach learns whether feedback was understood, and a shy teenager can say 'unclear' without writing a message.
- **Evidence:** lib/session-response.ts (labels and coachLabels). app/athlete/page.tsx respondToSession (optimistic, shown on the newest session's home card). app/components/TakeawayReminder.tsx. app/sessions/[id]/page.tsx 'Tell your coach' section (any session). POST app/api/sessions/[id]/respond/route.ts writes sessions.athlete_response and athlete_responded_at after checking ownership and that the session is shared. The coach reads it in app/sessions/[id]/page.tsx 'What they said back', app/athletes/[id]/page.tsx session chips, app/components/PreSessionBrief.tsx, QuickSessionModal last-focus line and CoachInsights. The coach gets no notification when an answer arrives.
- **Surfaces:** /sessions/[id], /athlete, /sessions/[id] (athlete), /athletes/[id], dashboard pre-session brief, recorder (coach)
- **Demo state:** Three full-width chips with 'Not sure what you mean' selected, and the coach's badge 'Not clear to them , worth a word before the next session.'
- **Competitor gap:** yes. A structured comprehension check on coaching feedback is uncommon; most apps offer likes or free-text comments.

### Told coach sees opens `seen-transparency`

**shipped**. Opening a session is logged for the coach, and the athlete is told so on screen.

- **Pain removed:** The coach knows feedback reached the athlete, and the athlete is not surprised to learn they were tracked.
- **Evidence:** app/athlete/page.tsx openSessionToggle → POST app/api/sessions/[id]/seen/route.ts (kind summary_viewed). The detail route records session_opened via after(). lib/access-log.ts dedupes within 10 minutes. Copy: 'Your coach can see when you've opened a session…'. The coach sees SessionSeen on /sessions/[id] and AccessLog on /athletes/[id] (head only).
- **Surfaces:** /athlete Sessions tab, coach /sessions/[id], /athletes/[id]
- **Demo state:** Coach session header showing 'Mia opened this 2h ago'
- **Competitor gap:** no. Read receipts are common; telling the athlete openly is the differentiator.
- **No posts of its own:** Covered by the seen-receipt posts: a facet of that feature rather than a post of its own.

### Tap-to-mark body map `body-map-soreness`

**shipped**. Behind 'Something's sore', a front and back silhouette lets the athlete tap each sore region, with left and right sides. The coach sees the region names.

- **Pain removed:** The athlete can say where it hurts without writing a description.
- **Evidence:** app/components/BodyMap.tsx and lib/body-map.ts (a fixed region vocabulary of 31 base regions × L/R; isBodyRegion validated on the server). Stored in wellness_checkins.sore_areas. Shown back as 'Sore: Left hamstring…' on the athlete home and in the coach's PreSessionBrief.
- **Surfaces:** /athlete Check in tab
- **Demo state:** Back view with the left hamstring and lower back highlighted, 'Marked: …'
- **Competitor gap:** no. Body maps exist in AMS tools; this one is a lightweight version for minors.

### Injury follow-up in check-in `injury-followup`

**shipped**. Only when an injury is open on file, the check-in asks 'How is your [area] today? Anything changed?' as an optional field of up to 500 characters that goes to the coaching team only.

- **Pain removed:** The coach gets injury progress without adding a daily question for everyone.
- **Evidence:** app/components/CheckIn.tsx (openInjuries prop, injury_update) → app/api/wellness/route.ts stores injury_update → the coach sees it in app/components/WellnessGraph.tsx. Copy: 'Only your coaching team sees this'.
- **Surfaces:** /athlete Check in tab
- **Demo state:** Text box under 'How is your left ankle today?'
- **Competitor gap:** no. Injury notes exist elsewhere; making the question conditional is the nuance.
- **No posts of its own:** Covered by the body-map-soreness posts: a facet of that feature rather than a post of its own.

### Message alerts: email and push `message-notifications`

**shipped**. When the coach messages, the athlete gets an email (debounced per unread backlog) and, if they opted in, a push titled 'New message from Max' that opens /athlete?tab=messages.

- **Pain removed:** The athlete does not miss a coach message.
- **Evidence:** lib/notify.ts notifyNewMessage (only if athletes.email is set). lib/push.ts buildPushPayload 'message-to-athlete' (title only, never content). public/sw.js push and notificationclick handlers. app/components/PushOptIn.tsx on the athlete Messages tab (renders nothing unless VAPID keys are configured; iOS requires Home Screen install and 16.4+). Whether the deployment has VAPID keys could not be verified from code.
- **Surfaces:** Email, Lock screen and email, opt-in card on /athlete Messages
- **Demo state:** Opt-in card 'Get a notification when your coach messages you … never what they wrote.'
- **Competitor gap:** no. Standard, apart from the content-free payload.
- **No posts of its own:** Covered by the messaging-voice posts: a facet of that feature rather than a post of its own.

### Send coach a clip, get markup `athlete-clip-upload`

**shipped**. The athlete uploads a clip of up to 60 seconds, either general or about one session, with an optional question. The coach is told in the thread, draws on it and 'sends it back', and the athlete then sees the coach's drawings with the status 'Coach marked it up'.

- **Pain removed:** The athlete can ask 'is my elbow dropping?' with video and get a visual answer.
- **Evidence:** app/components/AthleteClipUpload.tsx (duration checked in the browser, signed PUT) → app/api/athlete/clips/upload-url and POST app/api/athlete/clips/route.ts (verifies athlete_user_id and the 60s limit, inserts session_videos with uploaded_by_role 'athlete', posts a thread message 'Mia sent you a clip…' plus email). The coach marks it up on app/sessions/[id]/page.tsx ('Send back to …'). The athlete GET returns annotations only when shared_with_athlete is true (athleteSeesAnnotations).
- **Surfaces:** /sessions/[id], /athlete Sessions tab ('Clips for your coach', and 'Show your coach' inside each session)
- **Demo state:** 'My clips (2)' with one row showing 'Coach marked it up', expanded with drawings
- **Competitor gap:** yes. A two-way video question-and-answer loop for youth athletes, inside the coach's feedback tool.


## Parent (3)

### Automatic parent session/monthly reports `parent-session-monthly-auto-reports`

**planned**. Caretaker form toggles labelled 'Notify on session reports' and 'Notify on monthly reports'.

- **Pain removed:** Would keep parents updated without the coach doing anything.
- **Evidence:** The flags exist (migration 006, saved by app/api/caretakers) but nothing sends to caretakers on share or monthly. notifySessionShared emails only the athlete, and there is no scheduled job. .claude/MEMORY.md line 546 confirms nothing sends. Also: The toggle only PATCHes athletes.auto_monthly_report (athletes/[id]/page.tsx:2326; api/athletes/[id]/route.ts). No sender found: no cron in vercel.json and no use of the flag in any email route Also: athletes/[id]/page.tsx PATCHes auto_monthly_report, which /api/athletes/[id] saves (migration 006). No cron, scheduler or sender reads auto_monthly_report or notify_monthly_reports anywhere, and vercel.json has no crons. Nothing is ever sent.
- **Surfaces:** /athletes/[id] Caretakers form (toggles only), /athletes/[id] Caretakers, /athletes/[id]?tab=profile (Caretakers)
- **Demo state:** Do not demo
- **Competitor gap:** no. Not built. Do not market.

### Wellness alert, notify parent `wellness-alert-notify-parent`

**shipped**. When today's score or the 7-day average is low, the head coach can email a wellness update to a saved caretaker (or any typed address). The button then shows a receipt to prevent double sends.

- **Pain removed:** Coaches can loop in a parent quickly when a child is struggling.
- **Evidence:** athletes/[id]/page.tsx sendWellnessAlert POSTs /api/wellness/alert (head only, roster-checked, recomputes the alert, buildWellnessAlertHtml). Requires email to be configured. Coaches are also auto-emailed on alerts via notifyWellnessAlert. Also: app/api/wellness/alert/route.ts uses buildWellnessAlertHtml with audience 'parent' and no notes. The UI in app/athletes/[id]/page.tsx (around lines 886-1960) offers a caretaker picker or a typed email. Sending works end to end. Bug: POST /api/caretakers ignores notify_wellness_alerts, so the 'Show in notify parent list' checkbox is never saved. Shipped: the send works end to end. Defect beside it: the "Show in notify parent list" checkbox is never saved (POST /api/caretakers drops notify_wellness_alerts).
- **Surfaces:** /athletes/[id] wellness alert card, /athletes/[id]?tab=wellness
- **Demo state:** Red 'Wellness alert' card with a caretaker picker and '✓ Sent to mum@…'
- **Competitor gap:** yes. A coach-controlled parent escalation built on wellness data is uncommon.

### Caretaker notification preferences `caretaker-notify-prefs`

**partial**. Checkboxes for 'Notify on session reports', 'Notify on monthly reports' and 'Show in wellness alert list'.

- **Pain removed:** Would let parents choose what they receive.
- **Evidence:** /api/caretakers POST saves the session and monthly flags, but nothing sends session or monthly reports to caretakers (no consumer of notify_session_reports or notify_monthly_reports). The POST also drops notify_wellness_alerts, so it always takes the DB default true and that checkbox has no effect. Partly fixed 14 Nov 2026: the wellness-alert checkbox is now saved (lib/caretaker-prefs.ts). Session and monthly reports to caretakers are still not sent, so this stays partial.
- **Surfaces:** /athletes/[id]?tab=profile
- **Demo state:** n/a , do not market
- **Competitor gap:** no. Not functional.
