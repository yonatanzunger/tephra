# The TODO List

**Scope: managing a list of tasks.** Not the graveyard problem — those turned out to be interestingly distinct, and conflating them was costing the design. The graveyard is about *projects* dying by neglect, it goes back to Portal's "projects as concepts," and no flat item list has addressed it in any of three eras. It is real and high-value, and it is deferred to a project of its own that will likely learn from this one. What is pressing now is narrower and immediate: there is no good place to keep a task list.

This supersedes R15–R17 and R16a in `requirements.md`, which were derived from a thinner reading of the same history.

## What the record actually says

**Era 1, paper.** A two-page spread, one line per item, a status glyph in the left margin — a bare dot for not started, a slash for in progress, an X for done, a strikeout for cancelled, `>` for migrated forward. It worked well. The eye learned to skip X'd rows; the spread filling forced a migration that killed stale items by omission; few enough items carried dates that `DUE 5/4` in large letters stayed legible. It failed on three things: no way to attach links, no portability, and no way to represent a project that has its own milestones.

**Era 2, documents.** Nested bulleted lists, copied and trimmed each morning. Links and due dates became easy, and a status appeared that paper could not hold — *blocked awaiting something*, which needs prose. It failed on portability, and on something subtler: grouping was encoded in the **nesting**, so the list could be arranged by urgency *or* by subject but never both, and scanning two ways at once was exactly what was wanted.

**The finding that matters most is easy to miss.** Era 2's list grew far more than era 1's, and era 2 reviewed *daily* — far more often than era 1's page-turn. So the forced review was never what kept era 1's list short. Entry cost was: writing in the paper log felt like a commitment, and "yes I should do this" got typed much more freely. Review kills *stale* items; it does not prevent *accumulation*. Two problems, and the record only ever solved one of them by accident.

## The three interactions

Everything the user does with a TODO list falls into three motions, and they are not close in frequency. This list is the design's spine: a feature that serves none of the three is out, and their ordering decides what gets optimized.

1. **"What do I have to do?"** — read the live list, check items off, add, change status. Many times a day. This is the working view and it dominates.
2. **"Where is that doc I was working on three days ago?"** — recovering a link that passed through the list. Second most common, and historically *unserved*: era 1 had no links at all, era 2 had them but no way to find them again. This is a first-class view, not a convenience.
3. **"What was I working on on `<date>`?"** — genuinely rare. Worth supporting cheaply; not worth paying much for.

## Two mechanisms, two jobs

**The daily walk is not garbage collection.** Era 2's morning copy-and-trim was valuable *independent of list length* — it is how the list gets loaded into the head at the start of a day. Its output is attention; pruning is a side effect of having looked at everything. So it runs every day whether or not the list is too long, and its design target is "I now know what is on my plate," not "the list got shorter."

**Finitude is the other job, and it needs its own mechanism.** Era 1's spread capped the list by making the marginal item *not fit*. The digital translation is a **soft cap**: the working view holds N items and the rest are reachable but not in front of you — a second page, in effect. A hard cap would be infuriating within a week. A soft one still works, because an item you know you will not see is an item you think twice about writing.

**These two are coupled, and the coupling is load-bearing.** The cap works by degrading visibility. The success criterion below forbids ever forgetting an item that is on the list. Those directly conflict — unless the daily walk is what guarantees the whole list still gets seen. **The walk is what makes the cap safe.** Neither is optional if the other ships.

**But the walk must not also be what keeps the list intact.** It is offered and never compelled (T11), and a list whose *survival* depended on an optional habit would be a list that came apart the first week away from the desk. So the two jobs separate cleanly: **carrying the list forward is automatic and protects the data; walking it is offered and protects the attention.** Skipping the walk costs the day's grooming and nothing else — the list is still whole, still today's, and still there tomorrow.

## What an item is

Text, which may contain links. A status. An optional due date. A creation time and a last-modified time. Zero or more tags.

**Tags apply to the whole item and nothing smaller.** The item *is* the taggable span; there is no tagging a phrase inside one. This is compatible with, but not the same as, prose subject-tagging in the notebook — and it is a **separate namespace**, even though the same name will often appear in both because both are frequently about the same project. Merging them would fill the notebook's subject list with hundreds of dead week-long working tags within a year.

**Status is prose-carrying, not a pure enum.** *Blocked awaiting X* needs the X. Nothing else does. Items do not reference each other: cross-referencing is complicated and, by inspection of twenty years of lists, very low value.

## What it looks like

*A draft, written to be argued with. It is one view type with modes, not five screens — the counting rule in `scope.md` holds.*

### The list

**The era-1 spread, restored.** One item per line. A status glyph in a narrow left column — `·` not started, `/` in progress, `?` blocked, `×` done, `→` backlogged, and a struck-through line for *nevermind*. Then the text, with any links in it live and clickable. Tags sit at the right in small type. A due date rides in the line where era 1 drew it, and is the one thing allowed to be visually loud.

Order is creation order, oldest first, because that is what the paper log did and what interaction 1 wants: the list is a place you know your way around, and re-sorting it under you destroys that.

**Within a day, finished items stay where they are, greyed** — exactly as X'd rows stayed on the page. Checking something off should leave a mark you can see, and the eye learns to skip the marks in about a week. **The next morning's walk clears them.** So the working view accumulates evidence of a day's work and resets each morning, which is era 1's spread with a daily migration instead of a fill-driven one.

**Above the list, a band of what is due soon.** Items with impending dates, lifted out and ordered by urgency, so that the eye never hunts for them (T9). This is a *band*, not a mode: it is always there, it is usually short, and when it is empty it takes no room.

**Below the fold, the overflow.** The working view holds about a screen. Past that there is a rule, a count — *14 more* — and the rest. Nothing is hidden and nothing is one click away from being lost; what the boundary does is make the marginal item feel marginal. **Crossing it is the signal, not the enforcement.**

### The morning walk

**The one ritual, and the thing that makes the cap safe.** The day's list is already there when you arrive: the first touch of a new day carries yesterday's live items forward without being asked. What the walk adds is not the list — it is that you have *looked* at all of it.

Opening Tephra on a new day offers the walk — offers, not compels; it is a prominent affordance, not a modal, and skipping it costs nothing but the day's grooming.

The walk presents every live item in order, one at a time or in a tight column, and asks nothing harder than *still?* Everything defaults to unchanged, so a walk where nothing has moved costs one gesture. What changes, changes here: status, backlog, cancel, a nudge to the due date.

**At the end, if you are over the line, it says so:** *you are carrying 41; the page holds 28.* That is the only moment the cap speaks, because it is the only moment you have the context to act on it — you have just finished looking at all forty-one.

**Backlogged items are not in the walk**, or the walk would grow without bound. They come back when their tag does: touch an item tagged `house`, and tomorrow's walk offers the backlogged `house` items once. *(Provisional — see Q3a.)*

### Finding a link

**Every link that has ever passed through the list, newest first.** A row per link: where it goes, the item text it appeared in, the item's current status, and when it was last seen. Searchable by any of it. This is a mode of the TODO surface reached in one gesture, and it is the answer to *"where is that doc I was working on Tuesday"* — which has never been served in any era and is the second most common thing the list is asked (T10).

Links from cancelled and completed items stay. That is most of the point: the doc you were reading last week is usually attached to something you already finished.

### Looking back, and looking sideways

**By tag.** A short list of tags — only the ones with live items, which is a much smaller set than every tag ever used — and picking one shows those items plus anything recently resolved under it. Grouping is a *pivot*, never the list's arrangement, which is what era 2 got wrong: nesting could express urgency or subject but never both at once.

**By date.** A scrub back to any day, showing the working view as it stood. Rare, deliberately cheap, and no more than that.

### Getting things onto it

**From wherever the thought happens, without leaving it.** Mid-sentence in the stream, a gesture turns the selection — or just the line — into an item, leaving a link behind in the prose the way branching already does. A quick-add from anywhere, keyboard-first, that takes text and nothing else. On the phone, share-to.

**No dialog, no required fields, no tag prompt.** Status is *not started*, ctime is now. Capture only has to be fast enough that the thought does not get carried in the head instead (T13) — but it should not force the organizing to happen later either, which is what the notation below is for.

### Saying it in the line

**One notation, typed or assisted.** A tag is `#house` inline, or `#'house deal'` when it has spaces. A due date is `DUE 2026-09-14` — or `DUE TODAY`, `DUE FRIDAY`, `DUE 9/14`, **resolved to an absolute date the moment it is recognised**, because a literal `DUE TODAY` sitting in a file would quietly mean something different every morning. Anything typed by hand into the file resolves the same way the next time it is read, accepting that a hand-written relative date is ambiguous about which "today" it meant; the alternative is a date whose meaning drifts, which is worse.

**The UI is a typist's assistant, not a second input path.** Pressing `#` opens tag capture: it completes against tags that currently have live items — the short set from T6, which is exactly what makes completion useful — return commits, and escape removes what the mode inserted, so a mistaken `#` costs nothing. Dates work the same way. **What the assisted path produces is character-for-character what you would have typed**, which is why capture from a bare quick-add box, from the stream, or from the phone's share sheet all reach the same place with no second parser.

**The markers stay in the line.** They render as chips and are read as structure, but they are not consumed into a sidecar: the file is what it appears to be, hand-editing works, and the truth has one home (R26, D20). One consequence worth carrying into the architecture: **a TODO tag is a *point* marker, not the paired start/end a prose tag needs** — the item is the span, so there is nothing to delimit.

### What is invented here rather than derived

Three things above go past the evidence and should be treated as proposals: **splitting the carry from the walk** (era 2 did both at once, by hand, every morning — copying the list *was* reading it; making the copy happen whether or not you look is a change to the ritual rather than a restatement of it); **the due-soon band rather than a separate urgency mode**; and **backlog resurfacing on tag activity**, which is Q3a's most promising candidate and nothing more.

## The flows, and what they force

*Nine motions. Each is written as how it should feel, then what it obliges the API to be able to do — the bridge to `solution/todo.md`.*

**1. Capture from elsewhere.** Mid-sentence in the stream, from a quick-add box, or from the phone's share sheet. It should feel like the thought left your head and went somewhere safe, with no context switch and nothing to dismiss.
**Forces:** create-an-item from a single string, callable from outside the TODO surface, with no other required argument — and the tag/date parse shared between renderer and main, as `shared/fileset.ts` and `shared/prose.ts` already are, so the assisted and typed paths cannot disagree.

**2. Working the list.** Read, check off, retag, edit a line, add. Many times a day. It should feel like a page you know your way around: order never shifts under you, checking off is one keystroke and leaves a visible mark. **Editing a row is one gesture that commits once** — text, tags and due date change together and are saved together — rather than the row being a live text field that writes on every keystroke.
**Forces:** cheap single-item status mutation; stable item identity for the length of a session; ordering by ctime rather than by anything derived. The commit-once row edit is load-bearing for more than it looks: it is what makes every write to an item a single edit, which is in turn what lets mtime be stamped exactly without the app writing into text somebody is in the middle of typing.

**3. The morning walk.** Offered on the first open of a day. Fast, rhythmic, defaults to unchanged, ends with a count.
**Forces:** less than it did when it also had to produce the list. "The day's working set" is a real persisted thing, distinct from "all live items," and it survives closing the app — but it is materialised by the day's first touch, not by the walk. Skipping days must be handled: opening on Thursday having last opened on Monday produces Thursday's set from Monday's, once. Walking twice in a day is idempotent for free, because the walk writes only what you change.

**4. Pivot by tag.** Pick from a short list; see live items and recently resolved ones under it.
**Forces:** the index answers *which tags have live items* and *items by tag* without loading the whole corpus. T6 exists for this and for completion in flow 1.

**5. The due-soon band.** Always present, usually short, gone when empty. Never hunted for.
**Forces:** a cheap *items with due dates inside a window* query, and re-evaluation when the day rolls over while the app is open.

**6. Finding a link.** A search box and a reverse-chronological list; the answer in about two seconds.
**Forces:** a **differently shaped index** from the tag one — link → items, carrying each link's last appearance and a back-reference — populated from item text, and retaining links from completed and cancelled items indefinitely.

**7. Scrubbing to a past day.** Rare, read-only, cheap.
**Forces:** reconstructing a past working set. **This is the flow that constrains the wire format** (T2): if flow 3's designated set is persisted per day, this is nearly free and the daily-file representation falls out; if it is not, something has to snapshot.

**8. Putting something down.** Backlogging an item should feel like relief, not like abandonment — which requires believing it will come back.
**Forces:** whatever Q3a settles on. If it is resurfacing on tag activity, the index must also track *tag recency*, and the walk must have a slot for offering items it did not otherwise carry.

**9. Editing the file by hand.** Rare — rare enough that it earns no design effort beyond not being broken — and it must simply work.
**Forces:** lenient parse, precise serialize, untouched lines round-tripped byte-for-byte — the discipline `notes.md` already carries, applied to a format that now has three kinds of inline marker in it. **One rule has to be stated rather than left emergent:** a line with no id marker is adopted on the next read and given one, which is how a hand-written item joins the list at all — and therefore a line whose marker is lost to a retype or a paste silently becomes a *new* item, with today's ctime and no history behind it. That is the one place in this app where hand-editing can lose something invisibly. It is accepted, because the alternative is refusing to adopt unmarked lines, which breaks the flow this requirement exists for.

## Requirements

**T1. One TODO type, many instances, one distinguished list.** TODO is a file type, so a notebook may hold several; one at the top level is *the* TODO list, exactly as one stream is *the* notebook.

**T2. Logically one ever-growing ordered list.** Items are never destroyed, only restatused. How this is stored is an implementation detail and deliberately unfixed — daily files that copy forward, one long file, or something else. The user-perceived model is the requirement; the wire format is not.

**T2a. An item can be taken off the list outright**, distinct from *nevermind*. Nevermind is a decision about a task and stays visible as one; this is for a line that was never a task — a mis-hit *Add*, a row of garbage — and it leaves no mark, because there is nothing to have a view about. **It does not breach T2**: what goes is the line from the day the item is live in, and every earlier day keeps its copy, since those days are the record of what those days looked like. An item deleted the day it was made is gone entirely, which is exactly the case it exists for.

**T3. Every item carries text, status, ctime, mtime, optional due date, and zero or more tags.** ctime and mtime are true timestamps, **stored in the item** rather than inferred from which day files it appears in, and are recorded from the first day and never backfilled — backfilled timestamps make every item look equally fresh, which destroys every staleness mechanism at once. ctime is written once and never changes, so it costs nothing to maintain. **mtime is stamped by the operations that write the line** — a status change, a tag, a due date, a committed row edit — and by nothing else, so keeping it exact never means writing into text somebody is typing in.

**T4. Status is an open set** including at least *not started*, *in progress*, *blocked* (with prose), *done*, *nevermind*, and *backlog*. The era-1 glyph vocabulary is the starting point, not a constraint.

**T5. Tags are per-item, in a namespace separate from prose subjects.**

**T6. The index distinguishes tags that have live items from tags that do not.** The live set is dramatically smaller and is what the interface offers by default; the full set stays reachable.

**T7. The default view is the day's working set in creation order** — the era-1 spread. **The set is carried forward automatically at the day's first touch**, not by any ritual that can be skipped. It holds those carried items plus anything added since, including ones finished today, which stay visible and greyed until the next day's carry leaves them behind.

**T8. Pivot by tag,** showing live items and recently resolved ones together.

**T9. Pivot by urgency.** Surface impending due dates so the eye never has to scan for them. Era 2 stored due dates and still missed them; ordering by them, not storing them, is the requirement. (This is the surviving core of R16.)

**T10. A link directory.** Every link that has appeared in the list, reverse-chronological by last appearance, searchable, each with the context it appeared in and a link back to its item. This serves interaction 2 and is therefore core.

**T11. A daily walk** that presents the whole live list, runs regardless of length, and exists to load the list into the head. It is offered, never compelled. **It reviews the day's working set rather than producing it** — the carry is automatic (T7), so a skipped walk costs the day's grooming and never the list's integrity. What the walk guarantees is that every live item is *seen* at least daily, whatever T12 does to the view. That guarantee is the reason T12 cannot ship without it.

**T12. A soft cap on the working view.** Items past it remain reachable and are never hidden. The cap is announced at the end of the walk and nowhere else — that is the only moment with enough context to act on it.

**T13. Capture from wherever a task is noticed** — in particular from the stream mid-sentence, without leaving what is being written. Several UI gestures over one API.

**T16. One notation for tags and dates, typed or assisted.** `#tag` / `#'multi word tag'` and `DUE <date>`, written inline and left in the line. Relative dates resolve to absolute on recognition. The assisted entry path produces exactly the text the typed path would, so there is one parser and one truth; the file is never a rendering of structure held elsewhere.

**T14. A backlog that is not a graveyard.** "Someday, I suppose" is the graveyard with a comfortable place to live, and the project's own problem statement credits era 1 and 2's *lack* of one for keeping them honest. It goes in anyway, because the need is real — but it is not finished until something resurfaces what is in it.

> **Staged (Q3a).** The status and a reachable, counted drawer ship with everything else; the resurfacing mechanism waits for a later milestone and for evidence from use. The deferral is safe because every input such a mechanism could want is already recorded by copy-forward. **Until it lands, this requirement is knowingly unmet** — worth stating plainly, since a backlog nobody rereads is the failure the whole project is named against.

**T15. Seen through the TODO experience, never edited as raw text in normal use** — while remaining a legible, hand-editable plain file (R26, carried).

## Success

**"I never had to mentally track a task that wasn't on the list, and I never forgot a task that was."**

That decomposes into exactly two failure modes, and they pull in opposite directions:

- **Capture failure** — a task doesn't make it onto the list, so the head keeps carrying it. Guarded by T13; the enemy is friction at the moment of noticing.
- **Surfacing failure** — a task is on the list and stops being visible. Guarded by T11; the enemy is T12, which is deliberately making things less visible.

A design that optimizes either alone will fail the criterion. That tension is the substance of the problem.

## Decisions this revisits

- **D3** (three view types) **survives.** TODO is one of the three; tag and urgency pivots are views of it, not new types.
- **D4** (v1 runs a plain checkbox file so promotion answers a recorded failure) **is superseded.** The stand-in was never really used — notes went into Tephra the way they went into M365 — so no failure was recorded against it. The evidence that replaces it is the twenty-year record above, which is stronger than anything a few weeks of a checkbox file would have produced.
- **D6** (markdown until promotion; YAML reopenable then) **is now open**, and is an implementation detail to be settled in the architecture rather than a requirement.
- **R17** (TODO groupings are not subjects; do not unify without evidence) **is confirmed, with the evidence.** The tag set turns over on a timescale of about a week; prose subjects are retrospective and permanent. Same mechanism, different lifetime, separate namespaces.
