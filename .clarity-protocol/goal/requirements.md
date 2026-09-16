# Requirements

Derived from `problem.md` and `precedent.md`. The ordering is deliberate: the experience requirements come first because the historical record says they, not features, decide whether a system survives.

## R1 — Experience (the primary requirements)

1. **Typing keeps pace with 130 WPM sustained.** Keystroke-to-glyph latency is a hard requirement with a measurable threshold, not a quality goal. This is the single most testable expression of "a joy to write in."
2. **No state is ever at risk.** Scroll position, in-flight text, cursor location, and open view survive app switches, crashes, device changes and sync. Any moment where the user thinks "I should save this carefully" is a defect.
3. **Typography and rendering are tunable and excellent.** Font, size, measure, colour, spacing. Bad font rendering is named as a killer on its own.
4. **Desktop editing is vim-compatible**, and switches rapidly between **raw markdown** and **rendered markdown** (viewed and edited visually). 40 years of vim; deviations are actively irritating. Rendered *reading* is cheap; rendered *editing* is where the cost sits, and it can arrive per node type — inline constructs first, tables and equations last (Q1).
   - **Superseded by D67 (2026-09-09): vim is REMOVED.** Months of use answered the observation D15 left open — it stayed off, the native surface became better than the vim one, and nothing was missed. What survives of this requirement is that **the one keymap must be deliberately designed** — its inventory is `solution/parts/keymap.md` and its design is in the backlog, M5 having dissolved on 2026-09-10. What does not survive is vim as the reason for any choice.
   - **Amended by D15: vim is a switchable setting, and the non-vim surface is first-class rather than a fallback.** It is unusable over a soft keyboard, so it is permanently off on the phone; and on the desktop it feels subtly less fluid for reasons no instrument has found. **The non-vim keymap therefore needs its own deliberate design, in v1**, since it is what mobile always runs and possibly what the desktop runs too.
   - **This requirement's weight has changed and should not be cited at its old strength.** It once constrained the entire technology choice. Three independent findings now push the other way — vim is unusable on mobile, it feels worse on the desktop, and its only mature implementation has a correctness gap that forced two design constraints. Whether it stays on in daily use is an open observation for v1, not an assumption.
5. **The UX is the user's own.** The stated reason every existing notebook app was rejected: "the UX isn't *mine*." Personalization and fit are the reason to build rather than adopt, and a design that drifts toward someone else's conventions has failed on its own terms.

## R2 — The notebook

6. One continuous chronological stream. Additions range from a single sentence to twenty pages at a sitting. **Volume, measured from era 3: 40–50 thousand lines a month — roughly 2–3.5 MB monthly, 20–45 MB a year, and 0.4–0.9 GB over twenty years.** This is an architectural input, not trivia: it is why windowing is required from v1 and why a search index arrives in v2 rather than v3 (D23).
7. Prose, **equations**, **tables**, and **inline figures** — diagrams, scribbles, annotations. Markdown with TeX and table extensions is the named starting point.
8. **Automatic dating**, so passages carry their date whether or not the user stamped them.
9. **Bookmarks**, both short-lived and long-lived, with fast navigation to them.
10. **Full-text search.** Era 1's gap; now load-bearing rather than convenient, since a subject view *is* a filtered view.
10a. **A directory of every link in the corpus**, reverse-chronological by last appearance, searchable, each entry carrying enough surrounding text to recognise it and a reference back to where it was written. **Search's sibling: search finds text you remember writing, this finds documents you remember opening.** It arrived as a TODO feature — *"where is that doc I was working on Tuesday?"* is the second most common thing a task list is asked (`goal/todo.md`) — but the need is not specific to task lists and the machinery does not care which file a link was found in. Links from completed and abandoned work are kept, which is most of the value: the document you want is usually attached to something you already finished. **That is delivered by the corpus rather than by the index** (D60): the index is a cache of the corpus as it stands, and what keeps a finished item's links is that the item still exists — TODO items are never destroyed, only restatused (T2), and past day files keep every line that stood in them. A link whose text was genuinely deleted leaves the directory.
11. **Print a selected range.**

## R3 — Range operations

12. **Tag a range with a subject**, retrospectively and cheaply. Ranges may carry several subjects; subjects overlap freely.
13. **View everything tagged with a subject** as a coherent filtered view.
14. **Branch a range into its own file**, linked from its origin, and — the part that currently fails — **findable afterwards**.

> Requirements 11–14 are one gesture wearing four hats: *select a range, then do something with it*. Selection is the core interaction primitive of the app, and bookmarking is its degenerate case (a range of zero length).

## R4 — Lists

15–17, 16a. **Superseded by `goal/todo.md`**, which holds the TODO requirements as T1–T16. A closer reading of the twenty-year record (`notes/03 the todo feature.md`) changed enough to warrant a document rather than four bullets: the three interactions a list actually serves, the daily walk as a *priming* ritual rather than a review, the soft cap as a separate mechanism from it, and a link directory as a first-class view. The core of R16 survives as T9 (order by urgency, do not merely store due dates); R16a's forced review survives as T11; R17 survives as T5, now with the evidence it asked for.
18. **Pinned lists** — recurring editable artifacts, reachable in one gesture from the top-level view.
19. **An events calendar** of major commitments: a date or date range, location, short summary, contact person, optional link to notes. Complements Google Calendar; does not replace it. **In v1 this is not a feature — it is one pinned list file (R18).** Its precedent is era 3's Excel sheet, which worked precisely because it was a plain table kept separate with no ceremony; the requirement asks for no date arithmetic, no reminders, no calendar view. **If R18 exists, R19 is already satisfied.** Anything beyond that must be earned by use.
    - **Promoted 2026-09-10, and superseded by `goal/horizon.md`**, which holds it as H1–H15. The gate above was opened rather than merely set: R18 shipped, a pinned table could have been made on any day since, and it was not — so the negative this requirement asked for was actually returned. What a plain file lacks is not storage but surfacing, which is the same finding T9 recorded about due dates. What R19 got right survives untouched: the full horizon is a plain date-ordered list of major commitments, **not** a calendar view, and Tephra still never writes to Google Calendar (H12).

## R5 — Document collections (filesets)

20. A bundle of URLs and documents living in one directory with a master file giving each entry a **short title**, the **URL and/or file link**, and a **summary** — autogenerated by default, human-editable, never clobbered by regeneration.
21. Browse, **open individually or en masse**, edit, and add to easily.
22. **Snapshot a URL** — one action downloads the page into the bundle and links it.
23. **A browser extension** to add the current page to a fileset. (Wanted; sequencing open.)

## R6 — Platforms and storage

24. **Mac and Android both first-class** for reading, searching and writing. "Hard to think of functionalities I wouldn't want" on the phone — but see the note below.
25. **Full function offline.** The steady state is continuous and invisible: edits autosave and propagate to the remote as soon as possible, asynchronously, never interrupting typing. During a disconnect they accumulate locally and go up at the first opportunity. **Explicit resync is acceptable as the degraded mode on reconnection, not as the everyday experience** (D5).
26. **Plain, generic, durable formats.** The files must remain comprehensible and usable if this tool is abandoned.

> **Desktop and mobile need not share a UI stack.** The contract between them is the file format, which R26 already requires be plain and durable. Two purpose-built apps sharing no code is a legitimate architecture, and it lets each optimise for genuinely different problems — vim and screen area on one side, touch and a small screen on the other (Q4, Q5).

> **On mobile parity.** Era 3's mobile failure was that it was *barely functional*, not that it lacked features. The requirement is therefore that mobile be **excellent at what it does**, not that it match the desktop feature for feature — and R1.4 (vim) is desktop-only by nature. Screen size and input device make the desktop preferable for serious work; the phone must be genuinely good, not a viewer.

## R7 — Commentary and imported text

*Added after the visual studies. The margin was drawn as an aesthetic
inheritance from the Aldine page; seeing it rendered made clear it is a
requirement, and one that arrives with a second use case attached.*

27. **Attach a comment to a range of text, shown in the margin beside it.**
    Several comments may bear on the same passage, and a comment is itself
    editable text, not a fixed annotation. **The margin is a second column of
    text, not an ornament** — sized and toned to be read, and reserved at all
    times so that the arrival of a comment never reflows the passage it is
    about.
28. **Import an external document — clipboard, `.docx`, `.pdf` — into the
    format, in order to comment on it.** The imported text is the base column;
    the reader's commentary accumulates in the margin. This is a distinct
    inbound path: the text being annotated was not written here and never will
    be.

> **Why this is a requirement and not a decoration.** The stated lineage is
> medieval marginalia and, behind it, the Talmudic page — base text surrounded
> by generations of commentary, where the argument in the margin is as much the
> document as the text it surrounds. The modern working tools largely lost this:
> comments became transient review artifacts, attached to a draft and discarded
> on acceptance. The requirement is the opposite — **commentary is durable
> content**, and R26 (plain, durable formats) applies to it exactly as it does
> to the base text.

> ~~**What is not yet decided.**~~ **Both settled by D47** (2026-08): a comment's
> body lives **inline in the document**, not in a sidecar (Q8 answered); and an
> imported base text is **kept pristine in `attachments/` while a copy is
> annotated** (Q9 dissolved — the question's own text contained its answer).
> D11 forced the part it always forced: anchoring is by identity, never by
> stored offsets.

## Constraints

- **Single builder**, alongside a full slate of other projects. macOS experience is decades old; Android experience is slight. **Platform scaffolding is the project's real risk**, and it concentrates precisely in the rich-editor surface.
- **Two devices, both trusted**, single user. No multi-tenancy, no sharing model.
- Notes contain **other people's information** — contacts, discussions about people — which bears on where storage lives.
- **Storage is undecided** and deliberately held open (`open-questions.md`).

## What would make a solution unacceptable

- Perceptible typing latency.
- Losing anything, ever — including position and in-flight text.
- A mobile experience that is merely tolerable.
- Files that can't be read without the tool.
- A UX that follows someone else's conventions rather than the user's.
