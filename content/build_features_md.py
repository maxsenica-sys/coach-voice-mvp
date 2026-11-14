#!/usr/bin/env python3
"""
content/build_features_md.py: writes FEATURES.md from FEATURES.json.

    python3 content/build_features_md.py

FEATURES.json is the source; edit it, then run this. Never edit FEATURES.md by
hand, or the two drift.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TITLE = {'coach': 'Coach', 'athlete': 'Athlete', 'both': 'Coach and athlete', 'parent': 'Parent'}


def cell(s):
    return str(s).replace('|', '/').replace('\n', ' ')


def main():
    with open(os.path.join(HERE, 'FEATURES.json'), encoding='utf-8') as f:
        doc = json.load(f)
    feats = doc['features']
    counts = {k: sum(1 for f in feats if f['status'] == k) for k in ('shipped', 'partial', 'planned')}
    marketed = [f for f in feats if f['status'] == 'shipped' and not f.get('content_exclusion')]
    out = [
        '# Pindar feature inventory', '',
        f'Generated from `FEATURES.json` by `build_features_md.py`; do not edit by hand. Source: {doc.get("source", "")}.', '',
        f'**{len(feats)} features:** {counts["shipped"]} shipped, {counts["partial"]} partial, {counts["planned"]} planned. '
        f'**{len(marketed)}** shipped features carry posts of their own; the other shipped ones are housekeeping or a facet '
        'of a marketed feature, and say which.', '',
        f'Status rules: {doc.get("status_rules", "")} Where the audits disagreed, the lower status won.', '',
        '## Not shipped (do not market)', '', '| Feature | Status | Why |', '|---|---|---|',
    ]
    for f in feats:
        if f['status'] != 'shipped':
            out.append(f'| `{f["id"]}` {cell(f["name"])} | {f["status"]} | {cell(f["status_evidence"])} |')
    out += ['', '## Marketed features', '', '| Feature | For | Pain removed | Competitor gap |', '|---|---|---|---|']
    for f in marketed:
        out.append(f'| `{f["id"]}` {cell(f["name"])} | {f["user_type"]} | {cell(f["pain_removed"])} | {"yes" if f.get("competitor_gap") else "no"} |')
    for group in ('coach', 'athlete', 'both', 'parent'):
        members = [f for f in feats if f['user_type'] == group]
        if not members:
            continue
        out += ['', f'## {TITLE[group]} ({len(members)})', '']
        for f in members:
            surfaces = f.get('surfaces') or []
            if isinstance(surfaces, str):
                surfaces = [surfaces]
            out += [
                f'### {f["name"]} `{f["id"]}`', '',
                f'**{f["status"]}**. {f["what_it_does"]}', '',
                f'- **Pain removed:** {f["pain_removed"]}',
                f'- **Evidence:** {f["status_evidence"]}',
                f'- **Surfaces:** {", ".join(surfaces)}',
                f'- **Demo state:** {f.get("demo_state", "")}',
                f'- **Competitor gap:** {"yes" if f.get("competitor_gap") else "no"}. {f.get("competitor_gap_why", "")}',
            ]
            if f.get('content_exclusion'):
                out.append(f'- **No posts of its own:** {f["content_exclusion"]}')
            out.append('')
    with open(os.path.join(HERE, 'FEATURES.md'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(out).replace('—', ','))
    print(f'FEATURES.md: {len(feats)} features')


if __name__ == '__main__':
    main()
