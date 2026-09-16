# The Horizon and Dockets — Design

**Requirements: `goal/horizon.md` (H1–H15). Decisions: D68–D78.** Written to be
read on its own: the problem, how the parts combine to solve it, the experiences
that follow, and the architecture those experiences force. Rationale for the
requirements lives in `goal/horizon.md`; what is here is the thing to build.

## The problem

**Tephra's task list is entirely present-tense.** An item exists from the moment
it is written and is carried forward every day until it is resolved. There is no
way to say *this becomes my problem in November*, and no way to record a
commitment that is not yet work. So everything about the future lives in
somebody's head.

Three failures follow, all observed in months of daily use:

- **Recurring obligations are remembered by hand or not at all.** Air filters,
  car service, seasonal maintenance across two households.
- **Things needing weeks of run-up arrive with the run-up not done.** A talk, a
  trip, a spouse's birthday — each needs preparation that must *start* long
  before the date, and nothing turns the date into work at the right moment.
- **Legitimate but not-now tasks have nowhere to go.** They either clog the
  working list, which is meant to be short enough to think with, or fall off it
  and are silently lost.

And one thing that used to work has no equivalent today: in an earlier and
otherwise failed system, a plain spreadsheet of major commitments — dates,
locations, contacts — was **the one part that succeeded**, and it is gone.

## How the parts fit together

**Three surfaces and one flow, none of which is much use alone.** The loop is
what solves the problem, so it is worth seeing before the parts.

```
                          ┌───────── put down ◄──────────┐
                          │                              │
                          ▼                              │
   ┌──────────┐  generate   ┌───────────┐   reorient   ┌──┴───────────┐
   │  DOCKET  │────────────►│ TASK LIST │─────────────►│  THE DAY'S   │
   │ the      │             │ what's in │              │  SELECTION   │
   │ complete │             │ front of  │              │ what I chose │
   │ record   │  project    │ me now    │              └──────────────┘
   └──────────┘────────┐    └───────────┘                     ▲
                       ▼                                      │
                 ┌───────────┐                                │
                 │  HORIZON  │────────── reorient ────────────┘
                 │  what's   │
                 │  bearing  │
                 │  down     │
                 └───────────┘
```

**A docket is where a commitment is written down.** One per area of life — this
house, the other house, speaking engagements, blog posts you mean to write. It is
*complete*: everything true about that area is on it, including things dormant,
not started, or merely standing. Completeness is what earns the right to stop
carrying the area in your head.

**But a complete record nobody reads is a filing cabinet**, and this project's
own history is that written records fail by ceasing to be maintained rather than
by being wrong. So a docket does not wait to be consulted.

**Generation is the connective tissue.** When a matter's moment arrives, it puts
work on the task list by itself — automatically, at the day rollover, whether or
not anyone went looking. That is what makes this a working system rather than a
reference one.

**The horizon is how the record reaches you between those moments.** It takes
what is complete and mostly dormant and shows only the part that is *close* —
which is the only way a complete record can also be short enough to read. It
draws from dockets and the task list both, because what unites its contents is
distance, not kind.

**Reorient is where your head and the system are made to agree.** You look at
what is bearing down, walk what is live, and choose the day. Without it the other
three are surfaces you might or might not consult.

**And the loop closes** because what you decide is *not for now* goes back to a
docket with one keystroke, and the periodic review of that docket is where it is
regathered. Nothing leaves the system by falling out of it.

## The flows

Six, and each is an experience before it is a feature.

### 1. The compact horizon

**A few lines, always in view, wherever you are** — writing in the stream, in the
task list, reading a document. *Holiday today. ACM talk in 10 days. Quarterly
report due Thursday.* Never more than a handful of rows; usually short, and when
empty it takes no room. Following a row goes to whatever it is about.

**It holds anything bearing down, whatever its source** — matters inside their
run-up, and tasks whose due dates are near or already behind. It runs from a
little behind you to some distance ahead, because something overdue is as much a
thing to have in mind as something coming.

### 2. The full horizon

**Every major commitment across every docket, in date order.** Trips, talks,
birthdays, holidays, the months when the repainting happens. This is the
spreadsheet restored, and it is read-only.

**It is a list, not a grid, and that is deliberate.** A calendar answers *what am
I doing on Tuesday* and is full of meetings. This answers *what is coming*.

> **Built 2026-09-12 (MH2, D78), and one thing this section did not anticipate.**
> *How far ahead* had to become a control rather than a constant. The noise risk
> named under **Risks** below arrives through the lookahead: a monthly bill put
> seven of nine rows in a six-month window and drowned the two things that needed
> thinking about — while shortening the window loses the birthday whose
> preparation starts in three months, which is the case this view exists for.
> Both are right at different moments, and only the reader knows which moment it
> is. A month · three months · a year, shortest first.

### 3. Working a docket

**Open `House` and see everything true about the house:** the recurring
maintenance, the broken oven, the repaint pencilled for spring. Add a matter,
edit one, tag it, give it an owner, give it a date or a season or nothing at all.

**Frequently done by two people at one screen, talking.** That is a real
constraint on the view: it is read from ordinary sitting distance by someone who
is not driving the keyboard, so it has to be legible without leaning in.

### 4. Reviewing a docket

**The periodic session, and the mechanism the whole design rests on.** You go
down the entire docket. For each matter: promote it — give it a date, generate
its work now, start its document — or leave it, or pass on it. At the end it
tells you what moved to the graveyard since last time.

**It is a long list worked in one sitting**, so the gestures must be cheap and
batched rather than one dialog per row. The daily walk already established that
shape and this follows it.

### 5. Putting something down

**From the task list, one keystroke says *not now*** and the item leaves the
working list for the miscellaneous docket. **Zero decisions** — no picker, no
"which docket does this belong to". If you happen to know it belongs on `House`,
you can say so; you are never asked.

This is the one gesture where friction would be fatal, because the alternative to
a cheap *not now* is leaving the item on the list, which is the accumulation this
design exists to stop.

### 6. Reorient

**Offered when the day rolls over, invocable whenever the state has got away from
you.** Three movements, in order:

1. **What's coming** — the horizon, first, because it is context for everything
   after it. Whether a task matters today depends on what is ten days out.
2. **What's live** — the existing walk down the task list.
3. **What's today** — choose from what you have just looked at. This is the
   output: a short set you have decided you are actually doing.

**Its cost is proportional to what has changed, not to what exists.** After a day
it is a few gestures; after three weeks the middle is long and the choosing is a
real reduction. **Dockets are not walked here** — they are reviewed on their own
rhythm — but reorient reports when one has gone stale: *"household — not reviewed
since June."*

### The horizon is its own object, which several things implement

**Added 2026-09-12 (D78), because the first build of it got this backwards.** The
two flows above read as *views over dockets that also happen to read the task
list*, and implemented that way they typecheck, pass their tests, and quietly
make one source the owner of the abstraction — so the second source is a special
case and the third is a rewrite.

**What the horizon owns:** what a row is, what window it spans, what order rows
come in, and the three kinds of pressure a row can be (`coming up`, `to do`,
`due`). **What a source owns:** translating its own world into that vocabulary. A
docket's contribution is the only part no other source could supply — how a
matter's steps and instances turn into dates, which is `dueOn`, interval
arithmetic and the anchor rule. The task list's is its due dates. H7's deferred
ICS feed is a third, and costs a function rather than a redesign.

**Sources must be disjoint, and that is a source's own job to enforce.** A docket
step that has already generated a task item belongs to the task list's source and
not the docket's, or one commitment is counted twice — once as *coming* and once
as *here*. Only the docket knows what it generated.

**And the horizon is computed, never stored**, so it is the one kind of derived
state D77's reconciler does not apply to: there is no persisted copy to drift.

## What the flows demand, and what that forces

**The compact horizon is present everywhere**, so it belongs to the **frame**
rather than to any document surface: it cannot depend on which document is open.
It must also recompute cheaply, at every day rollover and whenever a date
changes.

**The full horizon spans dockets and the task list**, so it is **a query, not a
document**. Nothing is authored in it, and it settles nothing about whether
filtered views can be edited.

**It is a location, not a panel** (D74) — the second one, after the link
directory. D66's test is whether following a row means you are done with the
list, and here it does not *because the list is usually left open in a window of
its own*: it gets a `NavTarget` and a ⌘-number beside ⌘0 and ⌘1. That is also
what carries most of the compact strip's job in practice, long before the strip
reaches the frame.

**Working a docket is a genuine editing surface read by two people**, so the
docket needs **its own view, shipping with the format rather than after it**.
That is what frees the file to be structured (D72): the raw file is not the
shared artifact, so legibility is a requirement on the *view*.

**Reviewing a docket walks a long list in one sitting**, so gestures are staged
and batched. And the review must **record that it happened** — so staleness can
be reported — and **what it passed over** — so demotion has a criterion.

**Putting something down costs zero decisions**, so a default destination must
exist without being named: hence a **distinguished miscellaneous docket** at the
notebook root. And backlogging must be a **move that preserves identity**, so the
item's history stays continuous and references to it still resolve.

**Reorient must be nearly free when nothing has changed**, so everything defaults
to unchanged. Its output — the day's selection — is **per-day state that must not
survive into tomorrow**, since a *today* mark that persists is a decision from a
day that has ended.

**Work must appear whether or not anyone reorients**, so generation is
**automatic and hooked to the day rollover**, not to any surface. A skipped
reorient must cost the day's attention and never the data.

### Therefore a matter holds

| | |
|---|---|
| **name** | free text |
| **when** | nothing, a date, a range, or a recurrence rule |
| **triggers** | zero or more: *at this offset, do this* |
| **tags, owner, link** | optional |
| **bookkeeping** | id, arrived-on, decline count, occurrence pointer |

**Three kinds of matter**, distinguished only by what is in `when`:

- **Recurring** — *change the air filters*. Has a rule; generates on schedule.
- **Dated** — *the ACM talk, Nov 12*. Has a date or a range. A "season" is a
  range written coarsely, not a separate thing.
- **Standing** — *the oven is broken*, *repaint the house*. Has **no** date, and
  giving it one is the point of the review. Everything in the miscellaneous
  docket is this kind, and it is most of what a household docket holds.

**A trigger is *how far ahead* and *what happens*.** `-14d → a task`. `-60d → a
document from the trip template`. Run-up lives here, and the offsets are
per-matter because prep time ranges from days for a filter to months for a
birthday that wants a plan written first.

### And therefore the format

**A structured file with an editing UI from the first milestone** (D72).
Everything above fits in a line of markdown, as a task does, **except triggers** —
a small structured list. Forcing those flat would mean spelling one trip as five
sibling matters sharing a date, trading a format problem for a data-integrity
one.

**Within that, one discriminator governs the remaining choice, and it is not
readability: whitespace-significance.** Merges are line-based and hand-editing
must degrade gracefully, so a format in which one bad indent restructures the
document is worse here than one whose records are flat independent blocks. That
argues against nested YAML and toward a block-per-matter form. Deliberately open;
it is small and better settled against real code.

**What does not change:** the file stays plain, durable and readable without
Tephra, and its type is declared by its containing directory rather than
inferred, which is what keeps merges safe.

> **Settled against real code, 2026-09-10 (MH1). Recorded as D75.** The open question above was
> decided as a block per matter: a heading, `key: value` lines, an indented
> trigger list, prose, and the bookkeeping marker last. Nothing is
> whitespace-significant and every unknown key survives a round trip.
>
> **And sections were added, because reading a long docket demanded them.** A
> docket is divided by ordinary markdown headings — *periodic maintenance*,
> *need to do*, *major projects* — with its matters nested one level under them.
> The rule that separates a section from a matter is **content, not depth**: a
> heading with nothing under it is a section, a heading with anything under it is
> a matter. Depth was the obvious rule and it was the wrong one, because dockets
> written before sections existed have their matters at `##`, and a
> depth-based rule would have read every one of them as an empty section and
> silently lost a house. Content cannot fail that way: every matter this app has
> ever written has `when:` under its heading.
>
> The cost, stated: **a section cannot carry a description**, since prose under a
> heading is what a note looks like. Sections are for grouping, which is what
> they were for.
>
> **The trigger line is superseded by D76** (2026-09-11), which replaces triggers
> with **steps**. A step is a line in the same indented list, and it gains two
> things the trigger line did not have: an **id**, because `{step} + 90d`
> references have to point at something that survives a step being inserted above
> them (D56's rule, a level down), and a **completion stamp**, because a
> dependency cannot fire without knowing whether its antecedent is done and that
> answer has to outlive both the generated item and a suspension. Its schedule is
> either `T±N` or `{id} + N`, and its kind is one of *task*, *status* or
> *reschedule* — the `effect` field the MH1 format already carried, with the
> third value being what recurrence-since-completion turns into.
>
> **Arranging is a person's act and never the machine's.** Nothing sorts itself;
> a matter can be moved between sections or nudged up and down inside one, and a
> nudge stops at the section edge rather than reclassifying by one keypress. The
> earlier claim that a docket is in *creation order and nothing else* was
> borrowed from `goal/todo.md`'s ban on rearranging a task list — a rule about a
> list that turns over daily, where nesting could express urgency *or* subject
> but never both. A docket turns over never, and grouping is how two people find
> their way around one. **Removing a section heading keeps every matter under
> it**, which is the property that makes the gesture safe to offer.

## The rules that govern behaviour

**A one-off finishes, and its docket has an archive** (D91, added 2026-09-16
from use). Finishing is read from the steps rather than declared: a `task` whose
task steps are all done is done, an `event` also has to have happened, and
anything recurring never finishes because it advances. The stamp is `done:` on
the matter, written by the pass and taken off by it when a step is reopened.

The finished matter stays where it is for the rest of the day and the next pass
moves it to `docket-archive/<same name>.docket.md` — an ordinary docket, so the
way back is an ordinary move. Two consequences worth stating with the rules:
the archive is **outside every clause that generates**, so a filed matter cannot
put work on the list; and it is **outside the horizon**, because a finished
matter's date is a fact about the past and the horizon answers *what is coming*.

**Why the delay is a day and not a moment.** D42's rule is that nothing moves
under you unbidden, and a matter that vanishes as its last step is ticked is the
clearest possible case of it. A matter that is gone when you come back tomorrow
is tidying, which is the same distinction the *today* section's reflow rests on.


**Generation is idempotent, and that is the load-bearing rule.** It produces what
*should be live now* — never one item per day missed, and never a second copy of
something it already made. Without it a month away from the desk yields thirty
air-filter tasks.

**The mechanism is deliberately left open; the property is not.** It can be
derived — H13 puts provenance on every generated item and the corpus index
already reads every file, so *does a task for this matter and this occurrence
exist?* is answerable without storing anything — or it can be recorded on the
matter. Deriving keeps one copy of the truth and survives someone hand-editing a
day file; recording is cheaper to read. Settle it at the keyboard.

**Everything is keyed to `clockDay`**, not `writingDay`: *three days before the
talk* does not depend on when anybody was typing (D62 gives both dates for a
reason, and this is the case that wants the calendar one).

**It runs unattended, and therefore must also catch up.** The intended shape is a
background pass at midnight with no user-visible moment at all — and the app is
not running at midnight most nights, so the same pass must run at startup and
produce the same answer. That is idempotence-over-elapsed-time arriving from a
second direction, and it is why the away-for-a-month test is the real one.

**The recurrence is on the matter; the work it generates is not.** The air filter
is one durable matter with a history; each occurrence mints a **fresh,
independent** task that can be edited, deferred, retagged or dropped without
touching the recurrence.

**Completion flows backward.** Because occurrences are independent, a matter
cannot recover *when did this last happen* from a task's history — so one
generated task per occurrence is designated as the one whose completion advances
the matter's clock. **The designation is explicit and authored**, not inferred
from trigger order: a matter with a document at −60d and tasks at −14d and −2d
has to say which one closing means *this happened*. The same link tells the matter whether an occurrence is still
outstanding, which is what stops an uncompleted task from either duplicating
every cycle or silently ending the recurrence.

**Review is a session, not a drip.** Deferral is only safe because a whole set
gets opened deliberately and gone through; that is what keeps the miscellaneous
docket from being a place things go to be forgotten.

**Demotion to the graveyard is automatic and reported.** Silent demotion would be
neglect with better filing; requiring a decision would mean it never happens and
the miscellaneous docket clogs. Automatic action plus a visible report is the
same split the task list already uses for its daily carry.

## Construction

**A docket is the todo document with the segmentation removed** — *forced*.
`DocumentKind` gains `'docket'`; `keys()` returns `ONLY_SEGMENT`, the arrangement
`markdown` and `fileset` already use. Everything below `load` and `keys` is
inherited: edits, undo, spans, the journal, the WAL, windows, divergence,
versioning, restore. **It is structurally simpler than the kind it is modelled
on.**

**The verbs are the task list's, one shorter and one longer** — *forced*. `add`,
`edit`, `setWhen`, `tag`/`untag`, `matters(filter)` — each a `replace()` on one
line. The new one is `move(id, toDocket)`, a delete plus an append in which the
matter **keeps its id**.

**`backlog` stays a status, and changes meaning** — *corrected 2026-09-10; an
earlier draft had it leaving `TodoStatus`, and that would have been a corruption
path.* `[>]` is written into day files, past day files are never rewritten, and
the parser is strict: *a bracket we do not know is not an item*. Dropping the
glyph would make every historical backlogged line stop parsing as an item at all,
which costs three things — `tephra:todo/<id>` would stop resolving for exactly
the items D71 promises to keep continuous; the history scrub would render those
days as plain text; and **`unusedItemId` mints against `CorpusIndex.itemIds()`,
so their ids would leave the taken set and a new item could collide with a real
historical one.**

**What actually changes is what `[>]` means: transferred to a docket.** Which is
what the glyph already said — the notation was chosen because `>` is *migrated
forward* — so this is the same mark with a real destination behind it at last.
Two consequences:

- **It becomes a resolved state.** `isLive` already excludes it, correctly and
  unchanged. What flips is `resolvedByTag`, which today skips it with *"backlogged
  is not resolved — it is waiting, and it has its own drawer."* It is not waiting
  any more; it has gone somewhere, and that is resolution.
- **`CorpusIndex.backlog()` retires rather than changing.** The drawer was a
  query over items in a waiting status; the docket is a document you open. The
  status stays; the query it fed does not.

**Which makes MH5's migration much smaller than it looked**: no file is
rewritten, no glyph changes, and only *live* backlogged items need moving into
the miscellaneous docket.

**The horizon is its own API, and deliberately not the search engine** — *decided,
D73*. Behind the API it is a scan: dockets are small — a few hundred matters over
a lifetime — and every *live* task is in today's file by construction, so the
horizon reads the dockets plus one day file. An index would arrive years before
the problem it solves.

**It is two queries interleaved, not one**: *items on the task list coming due*,
and *matters on dockets coming up*. Both are date-ordered projections, and
neither is a text search — so they share nothing useful with D65's engine beyond
the word *query*. An API in front of them is what lets the implementation be a
scan today and a persisted artifact later without anything above noticing.

**Reorient is mostly assembly** — *proposed*. Movement 2 is the existing walk
unchanged, movement 1 is the horizon query at a small limit, and movement 3
writes the selection into the day's frontmatter beside the flags the walk already
keeps there.

### Considered and found unnecessary

Recorded so they are not re-proposed: a **season type** (a range written
coarsely); a **ramp-up window field** (the earliest trigger); an **"outstanding"
state** (the occurrence pointer gives it, and *last-happened* too); a **horizon
index**; a **generation scheduler** (the day rollover already runs); and
**compact and full horizon as two views** (one query, two limits).

## What must exist from the first day

**Four pieces of data cannot be added later**, whatever the build order, though
every mechanism *over* them can wait.

- **Matter ids.** Expensive to retrofit onto a year of lines.
- **The occurrence pointer**, or completion-relative recurrence has no way to
  know when anything last happened.
- **The decline count.** The graveyard mechanism may ship late; the count may
  not, or every matter looks equally fresh the day demotion arrives.
- **The date a matter arrived on its docket.** A move is a delete plus an append
  and records no date of its own — and without this the **resurrection rate**,
  the one measurement that says whether the graveyard tier does anything, cannot
  be computed or reconstructed.

## Risks

**The second non-text surface.** The task list was the first, and it found what
the document layer assumed about prose. This one will find what the task surface
assumed about lists.

**The miscellaneous docket is bounded by nothing.** Every other docket is bounded
by its subject; this one collects whatever did not fit, and migration *out* of it
concentrates exactly the residue that never found a home. The graveyard is the
mitigation and the resurrection rate is the instrument.

**Two numbers with no evidence behind them** — the decline threshold and the
default run-up. Same class as the task list's soft cap, still unbuilt precisely
because nobody could justify its number, and they deserve the same suspicion
rather than confident small values.

**Legibility at conversational distance has no instrument.** Every other visual
judgement in this project was settled by looking at a screenshot or at a real
phone. This one is settled by two people at one screen with neither leaning in,
which no harness can see — so it is judged in use, over a table, and iterated.
