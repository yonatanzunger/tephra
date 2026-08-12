# Stakeholders

A single-user tool, so the interesting structure is not *who* but *which mode* — the same person has genuinely conflicting needs at different moments, and most design tensions here are between two of these personas rather than between two people.

## The writer (mid-thought)

**Type:** aligned · **Engagement:** direct

Wants to start writing *now*, without deciding where it goes. Types at 130 WPM and thinks by writing, so any friction — latency, a routing decision, a save prompt — degrades the thought itself, not just the experience of recording it.

**Needs:** instant availability on whichever device is at hand; zero-decision capture; typing that keeps pace; no fear of losing anything.
**Unhappy when:** asked "which notebook?", made to wait, made to manage state.

## The reader (months later)

**Type:** aligned · **Engagement:** direct

Looking for something half-remembered: a passage about a subject, a decision made around some date, a flagged insight. This persona did not exist meaningfully in era 1 — the corpus was small enough to scan — and grows steadily more important as the archive does.

**Needs:** search, subject views, bookmarks, automatic dating, the ability to find a branched document.
**Unhappy when:** something is known to be in there and cannot be found. **In direct tension with the writer**, who will not pay any up-front cost — tagging, filing, titling — to serve them. Every organizational feature must therefore be retrospective and cheap, or it will not be used.

## The maintainer

**Type:** aligned · **Engagement:** direct

Builds and maintains this alone, in evenings, alongside a full slate of other work. Decades-old macOS experience, slight Android experience.

**Needs:** a scope that can be finished; a technology choice that doesn't require becoming an expert in two native platforms; boring, debuggable storage.
**Unhappy when:** the project becomes a rich-text-editor engineering effort — the most plausible way this fails.

## The departer

**Type:** aligned · **Engagement:** indirect

The version of the user who, some years out, decides this isn't the tool for them — or who simply wants to read a note on a machine that doesn't have it installed. Represents everything already written.

**Needs:** plain, durable, self-explanatory files; no format that requires this tool to interpret.
**Unhappy when:** the archive is hostage to a running program. **In tension with the writer**, since the richest editing experiences tend to want their own document model.

## People written about

**Type:** aligned · **Engagement:** indirect

Contacts in the events calendar, colleagues discussed in notes, people whose details are recorded in passing. They have no idea this exists.

**Concerns:** their information sits in whatever storage this ends up using. A self-hosted or third-party backend is a disclosure decision made on their behalf, which is worth being deliberate about even for a personal tool.

## Non-stakeholders, explicitly

No adversarial stakeholder is worth modelling: no network service exposed to strangers, no multi-user surface, no untrusted hardware. If storage becomes a hosted service, that changes and the analysis should be redone — the operator of that service becomes a stakeholder, and so does anyone who breaches it.
