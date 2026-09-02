# The day boundary

**What decides which day the notebook is on, and what has to happen when that
changes.** Decisions: D62, amending D38.

Three subsystems already had their own answer to "has the day rolled?" — the
stream, the task list, and the sidebar — and a fourth was about to. This is the
one answer, and the names for its parts.

## What went wrong that made this necessary

**The day separator disappears when a day ends mid-line.** Not breaks —
disappears, silently. `renderer/src/editor/kinds/markdown/days.ts` says so
itself:

> A block widget has to sit on a line boundary. A day whose text does not end in
> a newline would put this mid-line, where CodeMirror is entitled to refuse it —
> **skip rather than argue.**

That is a renderer defending itself against an invariant the corpus does not
guarantee. It is the **second** place doing so: `branch` carries a clamp for the
same missing invariant, added after it ate a day's trailing newline and the date
break stopped rendering. **Defended in two places and enforced in none**, which
is the shape of a rule that has no owner.

The rule it needs is simple: **a day that has ended ends with a newline.** The
place to enforce it is where a day ends, and until now nothing knew where that
was.

## The three days

Three different questions were all called "today", which is how the confusion
gets in. They are named apart:

**`clockDay`** — what the calendar says right now, **in the reference zone**
(D38), never in local time. This is the one the interface means by "today": the
sidebar's marker, a due date's *in 3 days*, the title bar's label.

**`writingDay`** — the day the notebook is writing into. It advances to
`clockDay` only once you have stopped writing for long enough to have got up
from the desk. A passage typed at 00:30 while you are still going belongs to the
evening you are still in, and files under it.

**`openDay`** — a fact about one document: the day it currently has open. The
stream's is the day file it appends to; the task list's is the day whose working
set it is showing.

**The comparison that matters is `openDay < writingDay`.** That is a document
saying *I have a boundary to cross*, and it is a **level, not an edge** — a
comparison anyone can make whenever they like, rather than an event that has to
reach everyone exactly once and then be reset. Nothing has to be delivered,
consumed, acknowledged, or reset; a window that was closed when the day rolled
asks the same question on the way back in and gets the same answer.

## The zone is chosen, not detected (D63)

**`clockDay` is computed in a zone the person chose**, which is neither the
device's current zone nor a fixed offset.

D38 chose a fixed UTC−8 because local time "fails twice over": fly to Zurich and
today's file already exists under a different date, and two devices disagree
about which day a passage belongs to. Both are true, and both are failures of a
zone that **changes itself**. The word doing the damage was never *local*, it
was *automatic*. A zone that is chosen and then stays chosen has neither
failure, and is a better rule than a fixed offset because it is right for
somebody who moves.

**It is the notebook's, not the machine's**, and therefore lives in `config/`
rather than `.tephra/`. `.tephra/` is machine-local and never synced (D7, D52),
so a zone kept there would give every device its own and reinstate D38's second
failure exactly. The zone decides which date a passage is filed under; two
devices have to agree or one evening lands under two dates. `config/` is where
authored configuration already lives, for the same reason themes do (D41).

**A real zone, not an offset.** `America/Los_Angeles` survives a change to a
country's rules; `UTC−8` does not. D38 avoided real zones partly for DST — "no
hour is ever doubled or skipped" — which is true of hours and irrelevant to
dates: every instant maps to exactly one calendar date in any zone, including
zones that transition at midnight. A DST day is 23 or 25 hours long and is still
one day with one name, and the date is the only thing asked for here.

**Changing it is offered, never taken.** When the system's zone differs from the
notebook's, the interface says so and offers to change it — the tone of a format
note rather than a warning, because nothing is wrong: somebody is travelling.
Nothing detects and applies on its own, which is the whole of what makes this
safe.

**`writingDay` is monotonic, and the zone change is why.** Moving east pushes
`clockDay` forward, which costs one short day. Moving west pulls it *backwards*,
and a writing day that went back would file new passages into a day that already
holds later content — re-dating going forward, which is D9's corruption arriving
through the side door. So it never goes back: after a westward change it stays
where it is until the calendar catches up, at a cost of one long day.

**An absent setting means UTC−8**, so a corpus written under D38 behaves exactly
as it did until somebody chooses otherwise — a zone change applies going forward
and never retroactively, which D38 is right about. A new notebook is created
with the system's zone.

If a genuinely local label is ever wanted — *it is Tuesday evening where you
are* — that is a **fourth** thing, and it must never feed the other three.

## When the writing day advances

`writingDay` advances to `clockDay` when the calendar has moved on **and** there
has been no writing for long enough that the person has plainly stopped. Not a
timeout to be tuned: the question being asked is *are they still mid-thought*,
and the answer only has to be right about somebody who has got up and walked
away. Thirty minutes is generous in the direction that costs nothing — waiting
too long only means the boundary lands later, while acting too early cuts a
sentence in half.

**It is stateful, and that is unavoidable.** It cannot be a function of
`(lastWrite, now)` alone: writing at 00:15 having been up since yesterday, the
date of the last write says Tuesday when the answer is still Monday. It advances
only when idle, so it depends on what it was.

**So its seed comes from the corpus, not from memory.** The app being closed
overnight is the ordinary case, not the exception, and there is nothing in
memory to carry across it. On startup the clock reads the newest day that has
content and when it was last written, applies the same rule, and is correct
after a close, a crash, a sleeping laptop, or a week away. In-memory while
running; the corpus is the authority on the way in.

## One owner

**`DayClock`, in main.** It holds the notebook's zone and both dates. It is the
only place that can answer the question: it sees every edit — `DocumentService.edit` is on the path of every keystroke, so
*when did writing last happen* is a field rather than a protocol — and it holds
the set of windows, so *across all windows* is already its question.

It publishes `clockDay` and `writingDay`. **The renderer consumes both and
computes neither**: a frontend working out its own idea of the date while main
files by another is the same disagreement in a new place.

What main does at a boundary is the infrastructural half — terminate the day
that ended — and it does that *before* it publishes, so no window sees a
half-crossed boundary and three windows cannot race to do it.

## What each subsystem does with it

Each acts at the moment that suits it. Forcing one moment would be wrong for
two of the three.

**The notebook**, on `openDay < writingDay` with a window open, whether or not
anybody has typed: terminate the day that ended — a newline if it does not end
with one — and show the break. Two things follow from this and are decided
rather than discovered:

- **It is a write caused by opening the app.** Yesterday's file is modified
  because time passed and you launched. That is what terminating a day *means*,
  and it must not be mistaken for divergence.
- **The break needs a day below it to be a seam**, so today is materialised as
  an empty segment. `days.ts` already assumes this — *"an empty today is where
  you are about to write, and the seam above it is what says so"* — but an empty
  segment with no file currently counts as dirty and gets written, which would
  put a file on disk for every day the app is opened and nothing is written.
  **An empty day stays in memory until something lands in it.**

**The stream** starts a new day file when `openDay < writingDay` and there is
something to write. Not before: a day file is created by writing in it.

**The task list** carries when the list is fetched and `openDay < writingDay`,
which is what it already does — the carry materialises today from the most
recent day that has one (D55). What changes is only which date it is carrying
*to*. At the same moment it records that a walk can be offered (T11), which is
the walk's trigger and the reason it does not need one of its own.

## The terminating newline

It goes through `replace()` like every other write, so it is journalled and
recoverable. **It is not in anybody's undo stack**: a day terminator you can undo
into a mid-line day is a control with no meaning, and the boundary is not an
edit somebody made.

## What this lets us delete

The `days.ts` skip and the `branch` clamp. Both are compensation for the
invariant this establishes, and both are the kind of defence that hides a
failure rather than preventing it — which is why the separator went missing for
a day before anybody noticed it was gone.

## Two devices converge, and monotonicity is why

Sync is v2, but the answer falls out of a property already needed for another
reason, so it is worth recording now rather than rediscovering.

**`writingDay` never goes backwards**, and its seed is the newest day in the
corpus that has content. Put those together and two devices deciding a boundary
independently converge rather than oscillate: whichever crosses first writes day
N+1, and the other — seeing N+1 in the corpus the next time it seeds — moves
forward to meet it and cannot move back. Text the second device wrote before it
learned about N+1 stays in day N, which is a true statement about when it was
written, and from that point both are on the same day.

Without monotonicity the same pair would flap: each device pulling the other's
day back to its own, and passages landing in whichever day happened to be
current on whichever machine. **The property that stops a westward flight from
re-dating going forward is the same property that makes two machines agree.**

The cost, stated: a device whose clock is fast pulls everyone forward with it,
by at most a day. That is the price of a monotonic clock and it is the right one
— a day too early is a boundary in an odd place, while going back is corruption.

## Accepted, not solved

- **A day that never ends.** Write continuously for forty hours and the boundary
  never fires: one file, dated Monday, holding Wednesday's writing. The 1 MB
  part-split bounds the file and not the date. Judged not worth a rule.
- **A fast clock on one device** pulls the others forward by up to a day, which
  is monotonicity's price and cheaper than what it buys.
