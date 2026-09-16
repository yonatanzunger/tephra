# The Horizon and Dockets — Roadmap

**Design: `solution/horizon.md`. Requirements: `goal/horizon.md`. Decisions:
D68–D76.** Feature-level; the architectural design happens per phase, at the
keyboard.

**Build order: MH1 ✓ → MH3a ✓ → MH3b ✓ → MH2 ✓ → MH4 (part) → MH5 → MH4 (rest)
→ MH6.**

> **Rescheduled 2026-09-12, from living on it.** MH4's foundation is built — the
> unified view, the day's selection, selection and bulk verbs, the entrances —
> and its remaining piece is the annotation layer. **MH5 jumps ahead of it**,
> because use produced the want directly: *I want MH5 even more urgently than the
> rest of MH4.* Nothing in MH5 depends on the annotations, and the review flow it
> ships is what makes MH6's threshold real rather than guessed, so moving it
> earlier shortens the chain to the only phase that is currently blocked on data.
>
> Four things come before both, in this order: ~~the stale documents~~ ✓,
> ~~the screenshot harness~~ ✓, ~~the explicit list of instances~~ ✓ (D80), and
> then **MH5**. The remaining docket-backlog items and the rest of MH4 follow.
>
> **All three cleared 2026-09-13.** The documents were amended; the harness
> turned out not to be broken at all (note 54); and the instance list brought the
> **schedule panel** with it, which was not planned and is the larger half —
> D80.
>
> **And H8's narrowing is accepted rather than owed** — see the amendment in
> `goal/horizon.md`. The strip at frame level is dropped, not deferred. The numbers are
**identities, not sequence** — they are cited across the decisions and the notes,
and renumbering to restore the coincidence would break every reference to buy a
tidiness that would last until the next reorder. It was the numbers doubling as
an order that made this need saying at all.

Each phase is a slice that works end to end, and each has to pass one test: *is
it worth having if everything after it is cancelled?*

## What MH1 taught, and what it moved

MH1 went into daily use immediately, and two things came back that no amount of
design would have produced.

**The docket is a backlog manager first and a recurrence engine second.** The
house docket filled up with repair projects grouped by scale of work — none of
them recurring, each pulled off the list once and then acted on. That is D71's
premise arrived at from the other direction, and it changes what the next phase
is *for*: the payoff is *activate this and the work appears on my list*, not
*remind me when this comes round*.

**And the phase boundaries were in the wrong place**, which the drift makes
plain. What MH1 shipped against what it planned:

| planned for | actually shipped in MH1 |
|---|---|
| MH1 | the kind, the format, the surface, matters, tags, owner, the four un-backfillable fields |
| MH3 | trigger **authoring** and editing; recurrence **setup**, with an anchor |
| nowhere | notes on a matter; **sections**, with matters moved between them and reordered inside them (D75) |
| MH3 — still out | anything that **fires** |

(Read as *reordering the sections themselves* for a while, which they could not
do until 2026-09-13 — note 56. What shipped was reordering *within* a section.)

So MH1 absorbed the authoring half of MH3 and a feature that was in no phase at
all, and held the line exactly where it mattered. **The line it held is the one
worth learning from**: authoring is cheap, and firing is the substance.

**Two consequences for the plan.** The horizon and generation swap places, for
the reason under MH2; and what was MH3 splits in half, because after D76 its two
halves fail in opposite directions and want separate tests.

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

## MH1 — Docket files ✓ *(built 2026-09-10)*

**End condition, met:** dockets are a document type that can be viewed and
edited. A house, a set of speaking engagements or a list of blog post ideas goes
on one naturally, and can be worked as a group.

**Shipped:** the `docket` kind; the format (D72); the docket view and editing
surface; matters carrying a name, `when`, tags, an owner, a link, steps, prose
notes and the four un-backfillable fields; **sections** (D75), which divide a
docket for reading and carry the only arranging this kind has.

> **The cut line was argued and then overturned inside the phase**, which is
> worth leaving visible rather than tidying away. It said *everything else waits,
> including trigger editing and anything that generates or reminds*, and
> concluded: *the meeting does not need it and MH1 does not get better by
> carrying it.*
>
> The first half held and the second did not. Setting up a recurrence, editing a
> run-up and writing a note all came in, because the meeting needed to *say*
> "every ninety days, starting in October" and "the quote was 480", and a surface
> that cannot hold either sends the decision back to paper — which is the thing
> dockets exist to stop. **What it did not pull in is the part the argument was
> right about:** nothing generates and nothing fires.
>
> **One field came of it that no later phase could have added.** `every 90d` is
> not a schedule until you know ninety days from *what*, so the periodic form
> carries an **anchor**. Guessing it later from the matter's arrival date is
> wrong twice, because `adopt` re-stamps that date.

## MH3a — A docket that produces work ✓

**End condition:** you press **activate** on a repair and *"find a suitable
shop"* is on today's list; you finish that and *"have the car fixed"* appears.
**The docket stops being a filing cabinet.**

**In:** the **step** format (D76) — ids, completion stamps, the `T±N` and
`{step} + N` schedules, and the *task* and *status* kinds; the **removals**
(ranges, seasons, and `after` as a schedule); **activate** and **suspend**;
generation into the task list, keyed to `clockDay`, idempotent and unattended — a
background pass at midnight **and** the same pass at startup, since the app is
not running at midnight most nights; **provenance** on generated tasks, which
suspend withdraws by.

**Out:** reschedule steps and recurrence (MH3b); the horizon (MH2), so a
**status** step is authored here and inert until there is somewhere for it to
go — the same bargain MH1 made with triggers, which worked; the
document-template step, still the least-evidenced of the three kinds.

**The format change leads, and it is a one-way door.** Step ids are what
`{step} + N` points at, and every chain authored before they land is a migration
afterwards. It is **not a phase of its own**: a step you can author but which
never fires is what MH1 already has.

**Activation is the verb the backlog was missing.** Nothing today says *we are
doing this now* short of hand-typing a date, and steps that run forward from the
moment of activation are exactly what a multi-step repair needs. It also makes
*backlogged* a **derived** state — has it a critical date? — rather than a stored
one, which this project has learned to prefer: a status, once written into day
files, cannot be taken back out.

**Suspend is what makes activation safe**, and it is not symmetry for its own
sake. It withdraws pending tasks and horizon rows, clears the critical date, and
**leaves completed steps completed** — so a mis-press is undoable and a genuine
pause resumes rather than restarts. It is also why **step completion is stamped
on the step** rather than read off the generated item: the item can be edited
away, and suspend withdraws the items by definition.

## MH3b — A docket that keeps its own time ✓

**End condition:** the air filters change themselves. **Directly useful for
household management**, which was the old MH3's promise.

**In:** **reschedule** steps; interval recurrence, on calendar arithmetic so that
`every 1y` lands on a birthday without a rule grammar; completion flowing back
along the **authored antecedent** of a reschedule step; outstanding-instance
handling; clearing per-step completion when a new instance starts.

**Split from MH3a because the two halves now fail in opposite directions.** The
recorded hazard is *a month away from the desk must yield one air-filter task,
not thirty* — and D76 halves it: a matter that recurs from its own completion
cannot accumulate, because no completion means no reschedule means no next
instance. The overdue task simply sits there. What still needs the idempotence
machinery is a matter whose instances arrive whether or not anybody acted, which
is the birthday and not the filter. **Both need a test that forces the long
absence**, and they need different ones: the calendar kind accumulates, and the
completion-driven kind goes quiet.

*A path that fires once every few years is broken when it fires*, so neither test
waits for a holiday to produce the conditions.

**Open: the clamp rule.** *Every 1 month from 31 January* — February has no
31st. **Recommended: anchor-and-clamp** — occurrence *k* is the anchor plus *k*
units, clamped to the end of the month, so 31 Jan → 28 Feb → 31 Mar, and a
leap-day birthday returns to the 29th in leap years. The alternative computes
each occurrence from the previous one and **drifts permanently** after one short
month, which loses the intent. Days and weeks are unaffected; completion-driven
recurrence is unaffected, being one addition rather than a sequence.

**Settled as built (2026-09-12).** Anchor-and-clamp was taken, and `every: 1m on
31` is how the intended day travels with the interval. Two things the plan above
had differently:

- **Reschedule steps did not survive** — D76 replaced them with the matter's own
  `start` / `every` / `after`, so *recur from completion* and *from which step's*
  are two fields rather than an authored construct.
- **The whole pass became a reconciliation** rather than recurrence firing —
  D77. The plan's framing, *what happens when an instance completes*, is
  event-shaped, and the paragraph above explaining that completion-driven
  recurrence "cannot accumulate" is exactly the reasoning that hides the
  opposite failure: it goes quiet instead. Asking *what should be true?* answers
  both halves with one rule, and it took two live bugs out with it (see MH3b in
  `milestones.md`).

## MH2 — The horizon ✓

**End condition:** the horizon exists, drawing on **both** its sources — matters
on dockets, and items coming due on the task list. Its **full view** is new,
dedicated, and **a location with a ⌘-number** (D74), expected to sit open in a
window of its own. Its **compact view is the existing due-soon band**, extended
in place.

**In:** the query and its shape; both sources; the full horizon view,
date-ordered, read-only; **the instance each row belongs to**, shown — two
recurrences can put rows in one window, and an unlabelled pair of them is worse
than either alone.

**Out:** generation, anything in the frame.

**It moved after generation, and the argument for going first survived the
move.** That argument was that the horizon must be built with both sources
present rather than one — the shape of failure `notes.md` records six times over.
Dockets exist now, so it holds either way; and it holds *better* here, because by
this point there are real generated tasks and real status steps waiting for
somewhere to appear, instead of an empty docket and a task list.

**What it would have added on its own is modest**, which is the other half of the
reason. Its second source already exists as the due-soon band, so going first
would have delivered *dated matters also appear in the band* — while generation
is what stops the docket being a filing cabinet, and backlog management is what
the thing is actually being used for.

**The computation is specified per schedule kind** (D76, and `notes/05 events
contd.md`): nothing for inactive matters; generated rows for fixed ones; for
interval ones an arithmetic sweep over instances, since each step's offset from
its instance is known and the instances are a sequence; and **next-occurrence
only** wherever a date depends on another step's completion, because a date that
has not been earned yet cannot be placed.

**Rows whose preconditions are unmet are not on the horizon at all.** A step with
a pending `{step} + N` has no date, and a horizon that guessed one would be
inventing a commitment.

**Reusing the band's space is the first cut, and it narrows H8 on purpose.** The
band lives inside the task surface, so *"present whatever you are doing"* becomes
*"present when you are in the task list"* until MH4 moves it. That is a real
weakening of what H8 promises — H8 is what the design says makes a skipped
reorient safe — and it is affordable for two reasons: the task view is where a
great deal of time is already spent, and the full horizon being a window left
open covers much of the rest. **Recorded so MH4 is not considered optional.**

**It ships the horizon's contents, not its ubiquity.** That is MH4's business,
and should not be considered done because MH2 looks like it delivered the compact
view.

**And this is where the spreadsheet is restored** — every major commitment across
every docket in one date-ordered list, which a single docket's view cannot give.

**Settled as built (2026-09-12).** The plan held, with one thing it did not
anticipate and one it left open:

- **The horizon is its own object** (D78). The plan describes it as *a query over
  everything dated*, which is right and which the first cut still got wrong by
  implementing it inside the docket module. Sources implement the horizon; the
  horizon is not assembled out of them.
- **How far ahead became a control**, which nothing above called for. The
  argument is the one this section already makes about noise — it just turns out
  that no single number serves both *the monthly bill is drowning everything* and
  *the birthday starts three months out*, and the reader is the only one who
  knows which is being asked.

## MH4 — Reorientation

**End condition:** the walk is replaced by the broader reorient motion — three
movements, the day's selection — and the compact horizon moves into the frame.
Daily operation gets significantly easier.

**In:** the three movements; the day's selection, stored per day and not
surviving the carry; the compact horizon relocated out of the task surface;
**the three-way offer when a generated task is put down** (D79).

**Docket staleness reporting moved to MH5 (2026-09-16),** where its settled
design now sits. It was in MH4 because H11 says reorient reports staleness; it
belongs in MH5 because the review is what makes *last reviewed* a fact — the
report has nothing to read until the flow that writes it exists, and MH5 is now
the phase that ships it.

**Settled in advance (2026-09-12), by discussing the experience before building
it:**

- ~~**Staleness is a matter, not a computation.**~~ *Moved to MH5, 2026-09-16 —
  the claim stands unchanged, the phase it lands in does not. See MH5.*
- **The stalled chain needs no mechanism of its own.** It is a stall of a TODO
  item, not of a docket, and reorient already sees the live list. What it did
  need was D79, which is built.
- **The day's selection is a per-day MARK, and an item appears in both places.**
  Not a status and not a tag — both carry forward, and the selection must not.
  Recorded from use: keeping a separate *today* list means either syncing two
  lists or losing the tagging, which is what earlier eras did badly.
- **Movement 3 is never mandatory**, and the *today* section is the topmost one
  in the task list, marked so it reads as its own region. A differently-coloured
  *section* is fine exactly where a differently-coloured *row* was not: MT5a
  objected to a region with mixed membership told apart by a mark, and this
  region means one thing.
- **Its appearing pushes the list down, and that is allowed.** D42 is about
  things moving under you unbidden; this reflow is caused by your own gesture.

### The annotation layer — what the phrase names

**Written down 2026-09-16, because it was being cited and never defined.** The
roadmap has said since 2026-09-12 that the annotation layer is *what remains of
MH4*, and `features.md` says the same, with nothing anywhere saying what it is.
What it names, from the discussion it came out of:

> **The annotation layer is how the reorientation flow shows, on screen, what
> might require attention.**

That is a claim about the *experience* of reorienting rather than about any new
state. The pass itself is a computation over what the notebook already knows —
which dates have gone by, which generated tasks were put down, which items have
not moved, which docket has not been reviewed. What the layer adds is where a
person *meets* that: annotations on the surfaces already in front of them — the
task list, the docket, the horizon — rather than a sequence that stops them and
asks. Reorienting is then **reading**, and the verbs stay where they already
are, on the rows themselves.

**Why this is the piece that was left.** Everything else in MH4 is a mechanism
with an obvious end condition: the selection is stored or it is not, the
horizon is in the frame or it is not. This one is a rendering question with the
whole flow's usefulness resting on it, and it is the half that use will judge —
which is the argument that put MH5 in front of it (see the note at the top).

**Undesigned, and deliberately so until there is something to annotate.** Three
questions are open and none of them can be answered from the records as they
stand: *what earns an annotation* (a list, not a feeling); *how one is drawn*,
against D42's rule that nothing moves under you unbidden and the marks the
surfaces already carry; and *whether an annotation is computed at the moment of
looking or recorded by the pass* — which is the same question D77 answers for
every other piece of derived state, and probably has the same answer.

**Mostly assembly.** Movement 2 is the existing walk unchanged, movement 1 is
MH2's query at a small limit, and movement 3 is small and new.

**This is where the band migration lands**, and where H8's promise — that the
strip is present whatever you are doing, which is what makes a skipped reorient
safe — finally holds.

~~**Staleness has a second job after D76: the stalled chain.**~~ *Superseded
2026-09-12.* A matter whose first step was never completed generates nothing
further while still looking active — but that is a stall of a **TODO item**, not
of a docket, and it turned out to be a live bug rather than a reporting gap
(D79). The engine no longer wedges, and reorient sees the live list already.

## MH5 — The backlog becomes a pair of dockets

**End condition:** the TODO backlog is reimplemented as the distinguished
**miscellaneous** docket, the docket **review flow** exists, and decline counts
begin accruing.

**In:** root dockets; `move`, preserving identity; `[>]` reinterpreted as
*transferred* and counted as resolved; the review session; **docket staleness
reporting** (moved here from MH4, 2026-09-16); migration of the **live**
backlogged items and of MT7's overall-todo files; `CorpusIndex.backlog()`
retired.

**Smaller than it was, and its centre has shifted.** Once activation exists
(MH3a), the migration is the easy part — no file is rewritten and no glyph
changes, and only items *currently* sitting in `[>]` need a home. What remains
substantial is **the review flow**, which is the only thing that makes decline
counts accrue, which is the only thing that gives MH6 a threshold instead of a
guess.

**Out:** the graveyard, deliberately — see MH6.

**Settled in advance, and arrived here from MH4 (2026-09-16):**

- **Staleness is a matter, not a computation.** Every docket carries one marked
  matter — a **recurring task to review this docket**, completion-driven. H11
  already says *"not reviewed since June"*, not *not edited*, and those differ
  exactly when it matters: a docket you add to weekly is still unreviewed if you
  never go through the standing matters giving them dates. Three things then come
  free — *since last time* for the demotion report is the step's completion
  stamp; the graveyard's exemption is *has none* rather than a special case; and
  cadence is authored per docket, which the misc docket's own length risk asks
  for. A real, visible, seeded matter rather than an implicit property, so it can
  be edited, suspended, or declined outright — but **marked**, the way `after`
  marks the clock step, so *when was this last reviewed* is answerable without
  matching on a name.

**Why it moved.** Nothing about the claim changed; what changed is which phase
can act on it. A marked review matter is only worth seeding when there is a
review to complete it, and the report *not reviewed since June* has nothing to
read until one has been. MH5 is the phase that ships the flow, so the matter,
the mark, and the report ship with it — and MH4's remaining piece stops
carrying a dependency on a flow that comes after it.

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

- **ICS import** (H12) — **deliberately deferred, to be revisited.** Needed for
  holidays in the full horizon, and holidays are the weakest need in this design.
  The `ics` variant stays in `When` as the placeholder for it: unlike ranges and
  seasons it was not decided against, merely not reached, so D66's *a decision
  not to use something is a decision to remove it* does not apply to it.
- **Calendar-rule recurrence** — *the third Thursday of November*, *the Wednesday
  after Easter*, Hebrew dates. Wanted later by `goal/horizon.md`'s own account,
  and explicitly out of D76: interval periodicity on calendar arithmetic covers
  the birthday case without any of this.
- **The document-template step** — see MH3a.

## Documents that go stale when this ships

> **Cleared 2026-09-12**, all four. Kept below as the record of what was amended
> and why, since the list itself was right about every one of them — and the one
> marked *already stale* had been so for four phases, which is three too many.

- ~~**`goal/scope.md`**~~ ✓ — four types now, the docket among them, and the
  horizon explicitly **not** a fifth: it is a query, and since MH4 not even a view
  of its own. The *one syntax family* claim is recorded as **bought** rather than
  merely true (D72).
- ~~**`solution/features.md`**~~ ✓ — the events-calendar row now records that
  **R19 was promoted against the evidence its own gate demanded**, and what it
  asked for arrived as three things, none of them a calendar. A *Dockets and the
  horizon* table was added beside it.
- ~~**`solution/architecture-as-built.md`**~~ ✓ — a fourth kind, a fourth
  contract (`horizon-api.ts`), a reconciler, and **one fewer location**, which is
  the change a map is most likely to get wrong by omission.
- ~~**`goal/todo.md`**~~ ✓ (two of three) — **T9** is satisfied by the horizon
  rather than by a pivot on this list, and **T11** is superseded by reorient,
  with the tint's narrowing recorded. **T4's status set is still open**: it
  shortens in MH5, not before, so the amendment waits for the change.
