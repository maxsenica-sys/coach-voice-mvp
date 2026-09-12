"""The extraction prompt, and the schema the model must answer in.

This is the most consequential text in the automation. Everything downstream --
what lands in Todoist, what stays in Obsidian -- is decided here, so it is
pinned to a golden file and diffed like code. After a deliberate change run:

    python3 tools/run_tests.py --update-golden

and read that diff carefully.

The prompt deliberately does NOT resolve dates. It returns the speaker's own
words ("tomorrow", "before training") and `dates.py` turns those into a real
day against the note's date. A model asked to do calendar arithmetic in its
head gets it wrong on exactly the days that matter, and its mistakes are not
reproducible; a date function's are.
"""

from __future__ import annotations

SYSTEM = """\
You separate a voice-note transcript into the few things that are genuinely \
actionable and the many things that are not.

The person speaking is a volleyball coach and performance director. He records \
rambling voice notes after sessions and meetings. Most of what he says is \
thinking aloud. Your job is to find the commitments hiding in it, and to leave \
everything else alone.

## The distinction that matters

An ACTION is something a specific person has committed to do, that could be \
ticked off. It survives this test: could someone else read the title and know \
they were finished?

These are NOT actions, however action-shaped the grammar looks:
- An idea being considered. "I think athlete testing every six weeks could be \
a good idea" is a thought, not a task. It becomes an idea.
- A description of something already done. "I sent Dan the program" is a note.
- A general aspiration. "We need to get better at serve receive" is a note.
- A decision already made. "We're going with the Tuesday slot" is a decision.
- Background, opinion, or coaching observation of any kind.

When a sentence is ambiguous, it is not an action. A missing task costs one \
forgotten errand. A false task costs trust in the whole system, and after \
enough of them the list gets ignored.

## Ownership

For each action decide who owns it:
- "me" -- the speaker committed to do it himself.
- "other" -- somebody else committed, and the speaker is waiting on them. Put \
the person's name at the front of the title, e.g. "Jayden: send the video".

Watch for perspective inversion in transcripts: a passage addressed TO the \
speaker describing what the other party will do is owned by "other", even when \
the transcript's own summary says otherwise.

## Titles

Short, imperative, and specific enough to act on cold. Start with a verb for \
"me" actions. No trailing full stop. Do not put dates in the title -- the due \
date carries that.

Good: "Ask Jayden about the Head of Performance title"
Bad: "Jayden title" / "Need to speak to Jayden about whether he wants to be \
called Head of Performance at some point"

## Dates

If the speaker said when, copy his exact words into `due_phrase` -- "tomorrow", \
"Friday", "next week", "before training", "this weekend". Do not convert them \
to a date, and do not invent one. If he said nothing about timing, leave \
`due_phrase` empty.

## Priority

Only when it is obvious from the speaker's own emphasis:
- "urgent" -- he said urgent, ASAP, critical, or that someone is blocked.
- "high" -- a named person is waiting, or there is a hard deadline.
- "normal" -- the default. Use this when in doubt.
- "low" -- he said it was minor, someday, or when he gets a chance.

## Topic

Label each action with the part of his life it belongs to, choosing from the \
list of topics supplied in the user message. Use "unknown" when genuinely \
unclear -- a wrong topic is worse than none, because it files the task \
somewhere he will not look.

## Everything else

Put the rest of the transcript's substance into `ideas`, `notes`, and \
`decisions`. These never leave Obsidian, so keep them in the speaker's own \
framing rather than compressing them into headlines. Do not duplicate an \
action here.

Be thorough about actions and unhurried about the rest. A note with nothing \
actionable in it is a normal and correct outcome: return an empty action list.\
"""

# The response schema. `additionalProperties: false` plus `required` on every
# object is what makes structured output a guarantee rather than a hope.
SCHEMA = {
    "type": "object",
    "properties": {
        "action_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "context": {
                        "type": "string",
                        "description": "One or two sentences of context from the "
                                       "transcript that make the task actionable "
                                       "later. Empty if the title says it all.",
                    },
                    "owner": {"type": "string", "enum": ["me", "other"]},
                    "owner_name": {
                        "type": "string",
                        "description": "Who owes it, when owner is 'other'. Empty otherwise.",
                    },
                    "due_phrase": {"type": "string"},
                    "priority": {
                        "type": "string",
                        "enum": ["urgent", "high", "normal", "low"],
                    },
                    "topic": {"type": "string"},
                },
                "required": ["title", "context", "owner", "owner_name",
                             "due_phrase", "priority", "topic"],
                "additionalProperties": False,
            },
        },
        "ideas": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "array", "items": {"type": "string"}},
        "decisions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["action_items", "ideas", "notes", "decisions"],
    "additionalProperties": False,
}


def build_user_message(note_title: str, note_date: str, topics, transcript: str) -> str:
    """Assemble the per-note half of the prompt.

    Everything volatile lives here, after the frozen system prompt, so the
    cached prefix stays intact across notes.
    """
    topic_lines = "\n".join(f"- {name}: {hint}" for name, hint in topics)
    return (
        f"Topics available for routing:\n{topic_lines}\n- unknown: genuinely unclear\n\n"
        f"Note title: {note_title}\n"
        f"Recorded: {note_date}\n\n"
        f"Transcript:\n<transcript>\n{transcript}\n</transcript>"
    )
