"""Turning a transcript into actions, ideas, notes and decisions.

Two backends implement one interface:

- `ClaudeBackend` -- the real one. Structured output against a pinned schema,
  so the result is valid JSON or an error, never prose to be regexed.
- `HeuristicBackend` -- deliberate, commitment-phrase matching with no network
  and no key. It exists so the pipeline's plumbing can be tested end to end in
  CI, and as an explicit `--backend heuristic` escape hatch.

The heuristic backend is never a silent fallback. If Claude fails, the note is
left unprocessed and the failure is reported: an unprocessed note is visible and
recoverable, whereas a note marked done with junk tasks under it is neither.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict

from . import prompt as prompt_module

MODEL = "claude-opus-5"


@dataclass
class Action:
    title: str
    context: str = ""
    owner: str = "me"
    owner_name: str = ""
    due_phrase: str = ""
    priority: str = "normal"
    topic: str = "unknown"


@dataclass
class Extraction:
    action_items: list = field(default_factory=list)
    ideas: list = field(default_factory=list)
    notes: list = field(default_factory=list)
    decisions: list = field(default_factory=list)

    def as_dict(self):
        return {
            "action_items": [asdict(a) for a in self.action_items],
            "ideas": list(self.ideas),
            "notes": list(self.notes),
            "decisions": list(self.decisions),
        }


class ExtractionError(RuntimeError):
    """Raised when a transcript could not be analysed. The note stays unprocessed."""


def _coerce(payload) -> Extraction:
    """Build an Extraction from raw JSON, dropping anything malformed.

    The schema makes this defensive layer nearly redundant. Nearly is the
    operative word: a title that is only whitespace passes every JSON schema
    ever written and is useless as a task.
    """
    actions = []
    for raw in payload.get("action_items") or []:
        title = (raw.get("title") or "").strip().rstrip(".")
        if not title:
            continue
        owner = raw.get("owner") if raw.get("owner") in ("me", "other") else "me"
        priority = raw.get("priority")
        if priority not in ("urgent", "high", "normal", "low"):
            priority = "normal"
        actions.append(Action(
            title=title,
            context=(raw.get("context") or "").strip(),
            owner=owner,
            owner_name=(raw.get("owner_name") or "").strip(),
            due_phrase=(raw.get("due_phrase") or "").strip(),
            priority=priority,
            topic=(raw.get("topic") or "unknown").strip() or "unknown",
        ))

    def strings(key):
        return [s.strip() for s in (payload.get(key) or []) if str(s).strip()]

    return Extraction(
        action_items=actions,
        ideas=strings("ideas"),
        notes=strings("notes"),
        decisions=strings("decisions"),
    )


class ClaudeBackend:
    """Structured extraction via the Anthropic Messages API."""

    name = "claude"

    def __init__(self, model=MODEL, api_key=None, client=None):
        self.model = model
        self._client = client
        self._api_key = api_key

    def _get_client(self):
        if self._client is None:
            try:
                import anthropic
            except ImportError as exc:  # pragma: no cover - environment issue
                raise ExtractionError(
                    "The anthropic package is not installed. Run install.sh, or "
                    "pass --backend heuristic to run without it."
                ) from exc
            self._client = (anthropic.Anthropic(api_key=self._api_key)
                            if self._api_key else anthropic.Anthropic())
        return self._client

    def extract(self, note_title, note_date, transcript, topics) -> Extraction:
        # Imported here, not at module scope, so the heuristic backend and the
        # test rigs run on a machine that has never installed it. _get_client
        # raises the friendly version of this error, so it goes first.
        client = self._get_client()
        import anthropic
        user_message = prompt_module.build_user_message(
            note_title, note_date, topics, transcript)
        try:
            response = client.messages.create(
                model=self.model,
                max_tokens=16000,
                thinking={"type": "adaptive"},
                system=[{
                    "type": "text",
                    "text": prompt_module.SYSTEM,
                    # The system prompt is frozen and the transcript is not, so
                    # the cacheable prefix ends exactly here.
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{"role": "user", "content": user_message}],
                output_config={
                    "format": {"type": "json_schema", "schema": prompt_module.SCHEMA}
                },
            )
        except anthropic.APIError as exc:
            raise ExtractionError(f"Claude request failed: {exc}") from exc

        if response.stop_reason == "refusal":
            raise ExtractionError("Claude declined to analyse this transcript.")

        try:
            text = next(b.text for b in response.content if b.type == "text")
        except StopIteration:
            raise ExtractionError("Claude returned no text block.")
        try:
            return _coerce(json.loads(text))
        except json.JSONDecodeError as exc:
            raise ExtractionError(f"Claude returned invalid JSON: {exc}") from exc


# --- Heuristic backend -------------------------------------------------------

# Phrases that mark a commitment by the speaker.
_COMMITMENT = re.compile(
    r"\b(?:i |we )?(?:need to|needs to|have to|has to|got to|gotta|must|"
    r"should|will|i'll|we'll|going to|gonna|remember to|don't forget to|"
    r"make sure (?:i|we) )\b",
    re.IGNORECASE,
)

# Phrases that mark a thought rather than a commitment. These win over the
# commitment list: "I think we should do X" is an idea, not a task.
_SPECULATION = re.compile(
    r"\b(?:i think|i reckon|maybe|perhaps|could be|might be|it'd be good|"
    r"would be good|good idea|wondering|considering|idea is|what if)\b",
    re.IGNORECASE,
)

_DECISION = re.compile(
    r"\b(?:we(?:'ve| have)? decided|we're going with|the call is|"
    r"settled on|agreed to|we'll stick with)\b",
    re.IGNORECASE,
)

_DUE_HINT = re.compile(
    r"\b(?:today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|"
    r"saturday|sunday|next week|this week|this weekend|next weekend|"
    r"before training|end of (?:the )?month|in \d+ (?:day|week)s?)\b",
    re.IGNORECASE,
)

_LEAD_IN = re.compile(
    r"^(?:and |also |so |then |oh |um |uh |yeah |okay |right )+", re.IGNORECASE)


class HeuristicBackend:
    """Commitment-phrase matching. No network, no key, no judgement."""

    name = "heuristic"

    def extract(self, note_title, note_date, transcript, topics) -> Extraction:
        actions, ideas, notes, decisions = [], [], [], []

        for sentence in _sentences(transcript):
            clean = _LEAD_IN.sub("", sentence).strip()
            if not clean:
                continue
            if _SPECULATION.search(clean):
                ideas.append(clean)
            elif _DECISION.search(clean):
                decisions.append(clean)
            elif _COMMITMENT.search(clean):
                due = _DUE_HINT.search(clean)
                actions.append(Action(
                    title=_to_title(clean),
                    context="",
                    owner="me",
                    due_phrase=due.group(0) if due else "",
                    priority="normal",
                    topic=_guess_topic(clean, topics),
                ))
            else:
                notes.append(clean)

        return Extraction(actions, ideas, notes, decisions)


def _sentences(text):
    """Split on sentence ends and blank lines -- never on a single newline.

    Obsidian notes are hard-wrapped. Treating every line break as a sentence
    boundary cut "ask him if he wants the Head of / Performance title" in half
    and produced a task titled "Ask him if he wants the Head of".
    """
    for block in re.split(r"\n\s*\n", text or ""):
        flowed = re.sub(r"\s*\n\s*", " ", block).strip()
        for chunk in re.split(r"(?<=[.!?])\s+", flowed):
            chunk = chunk.strip()
            if chunk:
                yield chunk


def _to_title(sentence: str) -> str:
    """Strip the commitment scaffolding so a verb starts the title."""
    title = _COMMITMENT.sub("", sentence, count=1).strip()
    title = re.sub(r"^(?:i|we)\s+", "", title, flags=re.IGNORECASE).strip()
    # "I also need to finish X" leaves "also finish X" once the pronoun and the
    # commitment phrase are gone. The adverb is scaffolding too.
    title = re.sub(r"^(?:also|then|just|still|really)\s+", "", title,
                   flags=re.IGNORECASE).strip()
    title = re.sub(r"\s+", " ", title).rstrip(".").strip()
    # Drop a time phrase only at the very start or end. In the middle it is
    # part of the task: "Message Kevin about Friday training" is not about
    # messaging Kevin on Friday, it is about Friday's training session.
    title = re.sub(r"^(?:" + _DUE_HINT.pattern + r")[,:]?\s+", "", title,
                   flags=re.IGNORECASE)
    title = re.sub(r"[,]?\s*(?:sometime\s+)?(?:" + _DUE_HINT.pattern + r")\.?$", "",
                   title, flags=re.IGNORECASE).strip().rstrip(",").strip()
    return (title[:1].upper() + title[1:]) if title else sentence


def _guess_topic(sentence: str, topics) -> str:
    lowered = sentence.lower()
    for name, hint in topics:
        for word in re.split(r"[,/]| and ", hint.lower()):
            word = word.strip()
            if len(word) > 3 and word in lowered:
                return name
    return "unknown"


def get_backend(name, **kwargs):
    if name == "heuristic":
        return HeuristicBackend()
    if name == "claude":
        return ClaudeBackend(**kwargs)
    raise ValueError(f"Unknown extraction backend: {name}")
