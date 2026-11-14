#!/usr/bin/env python3
"""
content/build_plan.py: lays CONTENT_QUEUE.json onto the 30-day posting plan.

    python3 content/build_plan.py

Three slots a day, each a fixed format (the brief): morning carousel, midday
still, evening reel. The week's theme picks which features are in play; within
a week, features rotate so no day repeats one. Rows not placed stay in the
queue as the backlog the trial reels and month two draw from.
Writes POSTING_PLAN.csv.
"""
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
WEEKS = [
    ('Week 1: the notes problem', range(1, 8), [
        'quick-session-sheet', 'whisper-transcription', 'review-summary-before-send', 'summary-grounding-guard',
        'ai-session-summary', 'coach-recording-playback', 'take-into-next-session', 'last-time-you-said']),
    ('Week 2: many athletes at once', range(8, 15), [
        'mode-several-split', 'mode-squad', 'record-first-choose-later', 'multi-athlete-privacy',
        'assistant-coach-invites', 'coach-invite-code-qr', 'pre-session-brief', 'how-they-came-in']),
    ('Week 3: tracking and video', range(15, 22), [
        'coverage-insight', 'quiet-athletes-row', 'calendar-month', 'video-annotator', 'video-moments',
        'video-compare', 'record-screen', 'messaging-voice', 'athlete-clip-upload', 'insight-recurring-cues',
        'roster-wellness-driver', 'injury-body-map', 'session-pdf']),
    ('Week 4: the athlete side, and parents', range(22, 31), [
        'understanding-reply', 'insight-not-sure-signal', 'seen-receipt', 'takeaway-reminder', 'two-tap-checkin',
        'body-map-soreness', 'focus-card', 'training-rhythm', 'wellness-alert-notify-parent',
        'monthly-report-pdf', 'safeguarding-rls-gate']),
]
SLOTS = [('morning', 'carousel'), ('midday', 'still'), ('evening', 'reel')]

# The brief's sharpest angle, posted hardest: once in each of weeks 1 to 3 so
# it is seeded early, then a slot every day of week 4, which it leads.
PINNED = 'understanding-reply'
PIN_DAYS = [3, 10, 17] + list(range(22, 31))


def main():
    with open(os.path.join(HERE, 'CONTENT_QUEUE.json'), encoding='utf-8') as f:
        rows = json.load(f)
    used = set()
    plan = []
    taken = {}  # (day, format) -> row, for the pinned angle
    pinned_rows = [r for r in rows if r['feature_id'] == PINNED]
    for i, day in enumerate(PIN_DAYS):
        # Rotate the format the pin takes so it is not always the same slot.
        for k in range(len(SLOTS)):
            fmt = SLOTS[(i + k) % len(SLOTS)][1]
            row = next((r for r in pinned_rows if r['format'] == fmt and r['post_id'] not in used), None)
            if row:
                taken[(day, fmt)] = row
                used.add(row['post_id'])
                break
    for theme, days, feats in WEEKS:
        # Lead the week with its first feature, then rotate.
        pools = {fmt: [r for fid in feats if fid != PINNED for r in rows if r['feature_id'] == fid and r['format'] == fmt]
                 for _, fmt in SLOTS}
        cursor = {fmt: 0 for _, fmt in SLOTS}
        for day in days:
            today = {r['feature_id'] for (d, _), r in taken.items() if d == day}
            for slot, fmt in SLOTS:
                if (day, fmt) in taken:
                    pick = taken[(day, fmt)]
                    plan.append({'day': day, 'week': theme, 'slot': slot, 'format': fmt, 'post_id': pick['post_id'],
                                 'feature_id': pick['feature_id'], 'user_type': pick['user_type'], 'hook': pick['hook']})
                    continue
                pool = [r for r in pools[fmt] if r['post_id'] not in used]
                # Rotate through features; skip one already posted today.
                order = sorted(pool, key=lambda r: (feats.index(r['feature_id']) - cursor[fmt]) % len(feats))
                pick = next((r for r in order if r['feature_id'] not in today), None)
                if pick is None:
                    # The week's own pool ran dry for this format: borrow the
                    # next unused row of this format from any week, still one
                    # feature per day.
                    pick = next((r for r in rows if r['format'] == fmt and r['post_id'] not in used
                                 and r['feature_id'] not in today), None)
                if pick is None:
                    raise SystemExit(f'day {day} {slot}: no {fmt} left')
                used.add(pick['post_id'])
                today.add(pick['feature_id'])
                cursor[fmt] = (feats.index(pick['feature_id']) + 1) % len(feats) if pick['feature_id'] in feats else cursor[fmt]
                plan.append({'day': day, 'week': theme, 'slot': slot, 'format': fmt, 'post_id': pick['post_id'],
                             'feature_id': pick['feature_id'], 'user_type': pick['user_type'], 'hook': pick['hook']})
    backlog = [r for r in rows if r['post_id'] not in used]
    for r in backlog:
        plan.append({'day': '', 'week': 'Backlog: trial reels and month two', 'slot': '', 'format': r['format'],
                     'post_id': r['post_id'], 'feature_id': r['feature_id'], 'user_type': r['user_type'], 'hook': r['hook']})
    with open(os.path.join(HERE, 'POSTING_PLAN.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(plan[0].keys()))
        w.writeheader()
        w.writerows(plan)
    placed = len(used)
    print(f'POSTING_PLAN.csv: {placed} posts over 30 days, {len(backlog)} in the backlog')


if __name__ == '__main__':
    main()
