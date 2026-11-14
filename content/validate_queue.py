#!/usr/bin/env python3
"""
content/validate_queue.py: checks the Pindar content queue and prints every failure.

    python3 content/validate_queue.py
    python3 content/validate_queue.py --part rows.json   # check a slice's rows only

Exit code 0 when clean, 1 when anything fails. Reads, beside this file:
    FEATURES.json        the inventory (only `shipped` features may produce posts;
                         a shipped feature with `content_exclusion` gets none, and
                         is exempt from the three-post minimum)
    CONTENT_QUEUE.csv    one row per post, the headers below exactly
    CONTENT_QUEUE.json   the same rows, for the renderer

Every rule from the brief is checked, plus the ones that keep the two queue
files honest with each other. A marketing line describing something the code
does not do is a defect, which is why a row's feature must exist and be shipped.
"""

import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

HEADERS = [
    'post_id', 'feature_id', 'angle_name', 'user_type', 'format', 'hook', 'old_way', 'cost',
    'mechanic', 'change', 'ask', 'caption', 'hashtags', 'voiceover_script',
    'pose_1', 'pose_2', 'pose_3', 'pose_4', 'pose_5', 'ui_card',
]

POSES = {
    # Coach
    'coach-phone-talking', 'coach-phone-showing', 'coach-watching', 'coach-pointing',
    'coach-head-in-hands', 'coach-kneeling', 'coach-thumbs-up', 'coach-walking',
    'coach-phone-ear', 'coach-clipboard',
    # Athlete A
    'athlete-listening', 'athlete-nodding', 'athlete-confused', 'athlete-spiking',
    'athlete-receiving', 'athlete-reading-phone', 'athlete-thumbs-up', 'athlete-sitting',
    # Athlete B
    'athlete-b-beside', 'athlete-b-group', 'athlete-b-jumping', 'athlete-b-blocking',
    'athlete-b-reading-phone', 'athlete-b-celebrating',
}
UI_CARDS = {
    'ui-recording', 'ui-transcript', 'ui-athlete-list', 'ui-calendar-week',
    'ui-video-thumb', 'ui-understood-tick',
}
FORMATS = {'carousel', 'still', 'reel'}
USER_TYPES = {'coach', 'athlete', 'both', 'parent'}

WORD_LIMITS = {'hook': 9, 'old_way': 9, 'cost': 14, 'mechanic': 14, 'change': 14, 'ask': 7}
VOICEOVER_MIN, VOICEOVER_MAX = 25, 50
HASHTAGS_EXACT = 5
MIN_ROWS = 90
MIN_PER_FEATURE = 3

EM_DASH = '—'

# Australian spelling: the common American forms that slip into copy.
US_SPELLINGS = [
    r'\bcolor', r'\bfavorite', r'\borganiz', r'\banalyz', r'\bcenter\b', r'\bbehavior',
    r'\bpracticing\b', r'\brealiz', r'\brecogniz', r'\bprioritiz', r'\bpersonaliz',
    r'\bcustomiz', r'\bsummariz', r'\boptimiz', r'\bminimiz', r'\bmaximiz', r'\bcatalog\b',
    r'\bjudgment', r'\bcanceled', r'\btraveled', r'\bmom\b', r'\bmoms\b', r'\bdefense\b',
    r'\boffense\b', r'\blicense\b',
]


def words(s):
    return len(s.split())


def main(argv):
    failures = []
    part = None
    if len(argv) >= 2 and argv[0] == '--part':
        part = argv[1]

    def fail(where, msg):
        failures.append(f'{where}: {msg}')

    # ── inventory ────────────────────────────────────────────────────────
    try:
        with open(os.path.join(HERE, 'FEATURES.json'), encoding='utf-8') as f:
            features = json.load(f)
    except Exception as e:  # noqa: BLE001 — every failure is reported, none hidden
        print(f'FAIL  FEATURES.json could not be read: {e}')
        return 1
    if isinstance(features, dict):
        features = features.get('features', [])
    by_id = {}
    for feat in features:
        fid = feat.get('id')
        if not fid:
            fail('FEATURES.json', f'a feature has no id: {feat.get("name")!r}')
            continue
        if fid in by_id:
            fail('FEATURES.json', f'duplicate feature id {fid}')
        by_id[fid] = feat
        if feat.get('status') not in {'shipped', 'partial', 'planned'}:
            fail(f'FEATURES.json {fid}', f'status {feat.get("status")!r} is not shipped/partial/planned')
        if feat.get('user_type') not in USER_TYPES:
            fail(f'FEATURES.json {fid}', f'user_type {feat.get("user_type")!r}')
        if not feat.get('status_evidence'):
            fail(f'FEATURES.json {fid}', 'no status_evidence')
        if feat.get('content_exclusion') and feat.get('status') != 'shipped':
            fail(f'FEATURES.json {fid}', 'content_exclusion only applies to a shipped feature')
    shipped = {fid for fid, feat in by_id.items() if feat.get('status') == 'shipped'}
    excluded = {fid for fid in shipped if by_id[fid].get('content_exclusion')}
    marketed = shipped - excluded

    # ── CSV ──────────────────────────────────────────────────────────────
    if part:
        with open(part, encoding='utf-8') as f:
            rows = [{h: str(r.get(h, '')) for h in HEADERS} for r in json.load(f)]
        got_headers = HEADERS
    else:
        csv_path = os.path.join(HERE, 'CONTENT_QUEUE.csv')
        try:
            with open(csv_path, encoding='utf-8', newline='') as f:
                reader = csv.DictReader(f)
                got_headers = reader.fieldnames or []
                rows = list(reader)
        except Exception as e:  # noqa: BLE001
            print(f'FAIL  CONTENT_QUEUE.csv could not be read: {e}')
            return 1
    if got_headers != HEADERS:
        fail('CONTENT_QUEUE.csv', f'headers are not exactly the spec.\n      got:  {",".join(got_headers)}\n      want: {",".join(HEADERS)}')

    seen_ids = set()
    per_feature = {}
    for i, row in enumerate(rows, start=2):  # line 1 is the header
        pid = row.get('post_id') or f'line {i}'
        where = f'CSV {pid}'
        if row.get('post_id') in seen_ids:
            fail(where, 'duplicate post_id')
        seen_ids.add(row.get('post_id'))

        fid = (row.get('feature_id') or '').strip()
        if not fid:
            fail(where, 'no feature_id')
        elif ',' in fid or ' ' in fid or ';' in fid:
            fail(where, f'feature_id {fid!r} names more than one feature (one feature per post)')
        elif fid not in by_id:
            fail(where, f'feature_id {fid!r} is not in FEATURES.json')
        elif fid not in shipped:
            fail(where, f'feature_id {fid!r} is {by_id[fid].get("status")}, not shipped: it cannot be marketed')
        elif fid in excluded:
            fail(where, f'feature_id {fid!r} is excluded from content: {by_id[fid]["content_exclusion"]}')
        per_feature[fid] = per_feature.get(fid, 0) + 1

        if row.get('format') not in FORMATS:
            fail(where, f'format {row.get("format")!r} is not carousel/still/reel')
        if row.get('user_type') not in USER_TYPES:
            fail(where, f'user_type {row.get("user_type")!r}')

        for field, limit in WORD_LIMITS.items():
            value = (row.get(field) or '').strip()
            if not value:
                fail(where, f'{field} is empty')
            elif words(value) > limit:
                fail(where, f'{field} is {words(value)} words, max {limit}: {value!r}')

        tags = (row.get('hashtags') or '').split()
        if len(tags) != HASHTAGS_EXACT:
            fail(where, f'hashtags has {len(tags)}, needs exactly {HASHTAGS_EXACT}')
        for t in tags:
            if not re.fullmatch(r'#[A-Za-z0-9_]+', t):
                fail(where, f'hashtag {t!r} is not a single #word')

        vo = (row.get('voiceover_script') or '').strip()
        n = words(vo)
        if n < VOICEOVER_MIN or n > VOICEOVER_MAX:
            fail(where, f'voiceover_script is {n} words, needs {VOICEOVER_MIN} to {VOICEOVER_MAX}')
        if '?' in vo:
            fail(where, 'voiceover_script asks a question (no rhetorical questions)')

        if not (row.get('caption') or '').strip():
            fail(where, 'caption is empty')

        for k in ('pose_1', 'pose_2', 'pose_3', 'pose_4', 'pose_5'):
            if row.get(k) not in POSES:
                fail(where, f'{k} {row.get(k)!r} is not in the pose library')
        if row.get('ui_card') not in UI_CARDS:
            fail(where, f'ui_card {row.get("ui_card")!r} is not in the UI card library')

        for field in HEADERS:
            value = row.get(field) or ''
            if EM_DASH in value:
                fail(where, f'{field} contains an em dash')
            low = value.lower()
            for pattern in US_SPELLINGS:
                if field in ('post_id', 'feature_id', 'angle_name') or field.startswith('pose_') or field == 'ui_card':
                    continue
                if re.search(pattern, low):
                    fail(where, f'{field} uses American spelling ({pattern.strip(chr(92) + "b")}): {value!r}')

    if part:
        for msg in failures:
            print(f'FAIL  {msg}')
        print(f'part: {len(rows)} rows, {len(failures)} failure(s).')
        return 1 if failures else 0

    if len(rows) < MIN_ROWS:
        fail('CONTENT_QUEUE.csv', f'{len(rows)} rows, needs {MIN_ROWS} or more')
    for fid in sorted(marketed):
        if per_feature.get(fid, 0) < MIN_PER_FEATURE:
            fail('CONTENT_QUEUE.csv', f'shipped feature {fid} has {per_feature.get(fid, 0)} rows, needs at least {MIN_PER_FEATURE}')

    # ── JSON mirrors the CSV ─────────────────────────────────────────────
    try:
        with open(os.path.join(HERE, 'CONTENT_QUEUE.json'), encoding='utf-8') as f:
            jrows = json.load(f)
        if isinstance(jrows, dict):
            jrows = jrows.get('posts', [])
        if len(jrows) != len(rows):
            fail('CONTENT_QUEUE.json', f'{len(jrows)} rows, the CSV has {len(rows)}')
        for crow, jrow in zip(rows, jrows):
            for h in HEADERS:
                if str(jrow.get(h, '')) != (crow.get(h) or ''):
                    fail(f'JSON {crow.get("post_id")}', f'{h} differs from the CSV')
                    break
    except Exception as e:  # noqa: BLE001
        fail('CONTENT_QUEUE.json', f'could not be read: {e}')

    # ── report ───────────────────────────────────────────────────────────
    status_counts = {}
    for feat in by_id.values():
        status_counts[feat.get('status')] = status_counts.get(feat.get('status'), 0) + 1
    print(f'features: {len(by_id)} ({", ".join(f"{k} {v}" for k, v in sorted(status_counts.items()))}); '
          f'{len(marketed)} shipped features marketed, {len(excluded)} excluded with a reason')
    print(f'queue:    {len(rows)} rows across {len([f for f in per_feature if f in marketed])} marketed features')
    if failures:
        for msg in failures:
            print(f'FAIL  {msg}')
        print(f'\n{len(failures)} failure(s).')
        return 1
    print('\nclean: 0 failures.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
