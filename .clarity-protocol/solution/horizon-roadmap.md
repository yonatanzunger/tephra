# The Horizon and Dockets — Roadmap

**Design: `solution/horizon.md`. Requirements: `goal/horizon.md`. Decisions:
D68–D72.** Feature-level; the architectural design happens per phase, at the
keyboard.

Six phases. **Usable at the end of MH1**, and directly useful for household
management at the end of MH3. Each phase is a slice that works end to end, and
each has to pass one test: *is it worth having if everything after it is
cancelled?*

## What is already shipped that this changes

**This is not purely additive.** Three things in daily use are superseded, and
each is a migration rather than a build:

| shipped | becomes | phase |
|---|---|---|
| the due-soon band above the task list | rows on the compact horizon | MH2, in place; relocated MH4 |
| overall-todo files (MT7) | dockets | MH5 |
| the backlog **drawer** (`CorpusIndex.backlog()`) | the miscellaneous docket | MH5 |

**The `backlog` STATUS is not superseded — it is reinterpreted, and nothing on
disk changes.** `[>]` stays in the glyph table and in `TodoStatus`, because past
day files hold those lines forever and the parser treats an unknown bracket as
*not an item*: dropping the glyph would stop historical backlogged lines parsing
at all, which would break `tephra:todo/<id>` for exactly the items D71 promises
to keep continuous and — worse — drop their ids out of the set `unusedItemId`
mints against. What changes is the *meaning*: `[>]` becomes **transferred to a
docket**, which is what the notation always said, and it counts as **resolved**
rather than waiting. One line of `resolvedByTag` inverts; no file is rewritten.

**The band is the one to be careful with.** It is used every morning, so the
horizon must be good enough to replace it *before* it comes out. The staging
below keeps it exactly where it is until MH4, and overlap is the honest plan
rather than a simultaneous switch.

## MH1 — Docket files

**End condition:** dockets are a document type that can be viewed and edited. A
house, a set of speaking engagements or a list of blog post ideas goes on one
naturally, and can be worked as a group.

**In:** the `docket` kind; the format (D72); the docket view and editing surface;
matters carrying `when` as a date, a range, or nothing.

**The cut line, set by the forcing event.** There is a household planning
conversation in a few days, and it is what MH1 exists to serve — so what is in is
what a conversation needs: a docket file, a view legible to someone not driving
the keyboard, add and edit, tags, an owner, `when` as a date or a range or
nothing, and the four un-backfillable fields. **Everything else waits**, including
trigger *editing* (MH3) and anything that generates or reminds. With a deadline
the temptation is to reach for MH3; the meeting does not need it and MH1 does not
get better by carrying it.

**Out:** the horizon, generation, recurrence, the review flow, the root dockets.

**This is the phase that serves a planning conversation**, which is why it leads.
Open `House`, see everything true about the house, edit it together. Generation
and the horizon are what make the decisions from such a meeting *stick*; the
meeting itself needs this and nothing after it.

**It is deliberately a filing cabinet, for one phase.** A dated matter sits here
and does nothing — no horizon row, no generated task — until MH2 and MH3. That
shapes what a real use of it tests: **whether this is a good surface to think
with alongside another person**, not whether it helps anybody remember. The
second question is not answerable yet, and a disappointing answer to it would
mean nothing.

**The whole record is defined here even though most of it is unused.** The four
un-backfillable fields — **id, arrived-on, decline count, occurrence pointer** —
go in at the moment the first docket file is written. The mechanisms over them
arrive in MH3 and MH5; the fields cannot.

**Triggers: representation now, editing in MH3.** A trigger is *not*
un-backfillable — a matter that gains one later loses nothing — but D72's whole
justification for a structured format **is** triggers, so a format that cannot
hold them would force a migration in MH3. Design the representation here and
build its editing there. The format is committed once; the UI follows the need.

**This is the largest phase, and it is first deliberately.** An earlier draft led
with the horizon precisely because a new document kind is a big first slice. A
real planning session is worth the trade, but the trade is real.

## MH2 — The horizon

**End condition:** the horizon exists, drawing on **both** its sources — matters
on dockets, and items coming due on the task list. Its **full view** is new,
dedicated, and **a location with a ⌘-number** (D74), expected to sit open in a
window of its own. Its **compact view is the existing due-soon band**, extended
in place.

**Reusing the band's space is the first cut, and it narrows H8 on purpose.** The
band lives inside the task surface, so *"present whatever you are doing"* becomes
*"present when you are in the task list"* until MH4 moves it. That is a real
weakening of what H8 promises — H8 is what the design says makes a skipped
reorient safe — and it is affordable here for two reasons: the task view is where
a great deal of time is already spent, and the full horizon being a window left
open covers much of the rest. **Recorded so MH4 is not considered optional.**

**In:** the query and its shape; both sources; the full horizon view,
date-ordered, read-only.

**Out:** generation, anything in the frame.

**Leading with dockets removed a gap rather than deferring one.** Built the other
way round, the query would have shipped with a single source and been untested as
the multi-source thing it claims to be — the shape of failure `notes.md` records
six times over. Here both sources exist on the first day it does.

**It ships the horizon's contents, not its ubiquity.** H8 requires the strip to
be present in the ordinary working view whatever you are doing, and keeping it as
the band inside the task surface does not satisfy that. **That is MH4's
business**, and should not be considered done because MH2 looks like it delivered
the compact view.

**And this is where the spreadsheet is restored** — every major commitment across
every docket in one date-ordered list, which a single docket's view cannot give.

## MH3 — Run-ups and recurrence

**End condition:** a docket can trigger both tasks and horizon items, and
recurrence works. **The system is directly usable for household management.**

**In:** triggers (*offset → effect*); generation keyed to `clockDay`, idempotent
and unattended — a background pass at midnight **and** the same pass at startup,
since the app is not running at midnight most nights; provenance on generated
tasks; recurrence rules; completion flowing back along an **explicitly
designated** occurrence; outstanding-occurrence handling.

**Out:** the document-template trigger — the least-evidenced of the three
projections, since the trip template is instantiated by hand today. Park it at
the end of this phase or drop it until wanted.

**Merged deliberately.** An earlier draft split fixed-date generation from
recurrence. They are one mechanism differing only in what `when` holds, and the
boundary fell in the middle of it.

**The hazard to test explicitly:** a month away from the desk must yield one
air-filter task, not thirty. *A path that fires once every few years is broken
when it fires*, so this needs a test that forces the long absence rather than
waiting for a holiday to produce one.

## MH4 — Reorientation

**End condition:** the walk is replaced by the broader reorient motion — three
movements, the day's selection — and the compact horizon moves into the frame.
Daily operation gets significantly easier.

**In:** the three movements; the day's selection, stored per day and not
surviving the carry; the compact horizon relocated out of the task surface;
docket staleness reporting.

**Mostly assembly.** Movement 2 is the existing walk unchanged, movement 1 is
MH1's query at a small limit, and movement 3 is small and new.

**This is where the band migration lands**, and where H8's promise — that the
strip is present whatever you are doing, which is what makes a skipped reorient
safe — finally holds.

## MH5 — The backlog becomes a pair of dockets

**End condition:** the TODO backlog is reimplemented as the distinguished
**miscellaneous** docket, the docket **review flow** exists, and decline counts
begin accruing.

**In:** root dockets; `move`, preserving identity; `[>]` reinterpreted as
*transferred* and counted as resolved; the review session; migration of the
**live** backlogged items and of MT7's overall-todo files; `CorpusIndex.backlog()`
retired.

**The migration is smaller than it sounds.** No file is rewritten and no glyph
changes — only items *currently* sitting in `[>]` need a home on the
miscellaneous docket, and history is left exactly as it is.

**Out:** the graveyard, deliberately — see MH6.

**Why the review comes before the graveyard.** Decline count is un-backfillable
and only accrues once the review exists. Shipping them together would mean
choosing the demotion threshold against **zero data**, which is the position the
soft cap has been stuck in since MT5c and the reason it is still unbuilt. One
phase of real counts is worth more than any argument about the number.

## MH6 — The graveyard

**End condition:** matters passed over enough times move to the graveyard
automatically, and the next review reports what moved.

**In:** demotion; the report; the graveyard exempt from staleness nagging; the
**resurrection rate** made visible.

**The threshold is chosen against MH5's real decline counts**, not guessed.

**This builds the instrument, not the answer.** The graveyard *problem* — threads
going quiet — is a separate and unstarted clarification (`notes.md`). What MH6
provides is the data that clarification will need and which nothing records
today.

## Not scheduled

- **ICS import** (H12) — needed for holidays in the full horizon, and holidays
  are the weakest need in this design. Small, standalone, whenever.
- **Calendar-rule recurrence** — Hebrew dates, the third Thursday of November.
  Wanted later by `goal/horizon.md`'s own account.
- **The document-template trigger** — see MH3.

## Documents that go stale when this ships

- **`goal/scope.md`** — the counting rule goes to four types, and the "one syntax
  family" claim is bought out by D72. Amend when MH2 lands, not before; it
  describes what is built.
- **`solution/features.md`** — the events-calendar row reads *"✓ v1 (a pinned
  markdown file — no feature, per the requirement)"*, which stops being true.
- **`solution/architecture-as-built.md`** — a new kind, a new surface, a new
  query source.
- **`goal/todo.md`** — T9 satisfied elsewhere (MH4), T11 superseded (MH4), T4's
  status set shortened (MH5).
