"""What a destination for extracted content has to provide.

There is one sink today. The seam exists because the obvious next additions --
a Google Calendar event for anything that is really an appointment, a reminder
service, a completion sync writing ticks back into Obsidian -- are all the same
shape: "given a note and an extracted item, decide whether it is yours, and if
so record it somewhere". Adding one should mean writing a class here and naming
it in the config, not touching the pipeline.
"""

from __future__ import annotations


class Sink:
    name = "sink"

    def prepare(self, config, dry_run=False):
        """Called once per run, before any note is processed."""

    def known_refs(self):
        """Refs this sink can already see in its own destination.

        The pipeline uses these as the authoritative duplicate check, so a lost
        state file cannot cause a second copy of everything.
        """
        return {}

    def accepts(self, note, action):
        return True

    def emit(self, note, action, context):
        """Create the thing. Return a record dict, or None if nothing was made."""
        raise NotImplementedError
