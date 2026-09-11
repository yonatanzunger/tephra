# The Horizon

**Scope: knowing what is coming, and having it arrive as work in time to do it.** This promotes R19, which held the events calendar to a pinned markdown file and set an explicit gate — *"the requirement asks for no date arithmetic, no reminders, no calendar view... anything beyond that must be earned by use."* The gate has now been opened and has returned a negative; the evidence is below.

**Not in scope: the project with its own milestones.** Refinishing the floors is not a recurring task or a dated event, and it arrived here only because the household case needs both. That is era 1's third failure and the graveyard problem, and it wants its own clarification (`notes.md`). The distinction that keeps them apart: **this design is the container; a project is a possible member shape.** Birthdays need the container and no projects.

## The vocabulary

Four things, and the names were chosen rather than defaulted.

- **A docket** — the document kind. A complete, durable set of standing commitments in one domain: a house, birthdays, holidays, speaking engagements.
- **A matter** — one thing on a docket. Deliberately indifferent between a task and an event, because half of them are each.
- **The horizon** — the view over every docket. The docket is everything; the horizon is its near end.
- **Reorient** — the flow that makes your picture of all this agree with the system's.

**"Schedule" and "event" were rejected for a specific reason**, not for taste: each burns a word needed one layer down. Every matter *has* a recurrence schedule, and "event" must stay available as an ordinary word — *the day the event happens*. A type name that forecloses vocabulary beneath it is a bad type name however well it reads. *(Also: **item** belongs to TODO and **entry** to filesets, which is why the inner noun is neither.)*

## What the record says

**Era 3's events spreadsheet is the one thing in era 3 that worked** (`precedent.md`) — major commitments only, each with a date or range, location, summary, contact, in Excel, with no ceremony. R19 was derived from it correctly and concluded that a plain table kept separate was the whole requirement.

**Two things have changed since, and both are evidence rather than argument.**

**The gate was opened and it failed.** R18 shipped months ago; pinned lists exist; a markdown table could have been made on any day since, and was not. Per this project's own discipline a gate that was never opened has not returned a negative — but this one *was*, and it did. What a plain file lacks is not storage. It does not order itself, does not retire what has passed, does not reach the task list, and **nothing ever shows it to you, so it does not get maintained.** The surfacing is the feature; the table is the cheap part. That is the same finding T9 recorded about due dates — era 2 stored them and missed them anyway.

**The spreadsheet was co-owned.** It ran alongside a full-time exec assistant and was *"a communication channel with someone who helped me plan and manage things."* So part of what made it work was that it was a surface two people looked at. That property is live today in a different form (H3) and was invisible in R19's derivation.

**And what is being missed is recorded plainly.** Household maintenance that recurs and is *"simply terrible at remembering."* Trips, talks and a wife's birthday, all needing weeks or months of run-up, and every one of which *"anything tied to remembering these, I've had to remember, and generate the corresponding TODO items for, by hand."*

## Three surfaces, and the third is the source

The delivery mechanisms are the two that already exist or nearly do — a **TODO item** and a **horizon row**. What was missing from the first reading of this problem is a third thing, and it is where the truth lives:

| | Holds | Bounded by | Turnover |
|---|---|---|---|
| **The TODO list** | what is in front of me now | today's selection (H9) | daily |
| **The horizon** | what is coming soon | a time window | continuous |
| **A docket** | everything true about one domain | nothing — it is complete | indefinite |

**Completeness is the property that distinguishes a docket**, and it is what earns the right to stop carrying a house in your head. The TODO list is emphatically not complete — its whole design is about what is in front of you — and the horizon is not either. A docket is, for its domain, and it therefore holds matters that are dormant, not yet started, or merely standing.

**A docket is not a tag pivot.** The pivot shows live items under a tag; a docket's contents are mostly not live and many will never become TODO items at all.

## A docket is edited as a group, sitting next to someone

**This is a first-class motion, not a file-management convenience.** *"We sit together looking at this list, decide which things to prioritize and act on, when to schedule them, who owns what."* Each grouping the user proposed — household matters per house, birthdays, holidays, speaking engagements — is a set that gets reasoned about and revised as a whole.

**And it needs no sharing model.** The requirement is two people in one room reading one screen, not two people with accounts. That is a **legibility** requirement on the view — readable at conversational distance, navigable while talking — and in this project legibility requirements are hard requirements. The single-user constraint in `requirements.md` stands untouched, and *"who owns what"* is a column, not an identity.

## What reorient actually is

**The walk was scoped to one document, and its job is scoped to a whole situation.** `goal/todo.md` had already found half of this — the walk is not garbage collection, its output is attention — but it kept the scope at the task list. The correction: reorient is *"refresh my own mental state, and ensure that the TODO list, horizon view, and my own cognitive state all align."*

**That inverts this design.** Reorient is not one flow among several; it is what every other mechanism here feeds. The horizon exists to have something to show at reorient. The ramp-up window exists so the right things are in it. Dockets exist so nothing is missing from what it can reach.

### It has an output, and that is what separates it from the walk

The walk wrote only what you changed; its product was attention and nothing else. Reorient ends with an artifact — **the day's selection**, the short set you have decided to actually do. So it is not review, it is **selection**: it starts from everything live and ends with something shorter.

**This is derived, not invented.** In era 3, under a tool that offered nothing for it, the user spontaneously *"created a special 'today' section and moved various items into it, essentially deciding how I was going to structure my day right there and then... a really useful attention-focusing mechanism during busy periods."* A practice adopted without a feature to prompt it is the strongest evidence this project recognises.

**Volition and imposition are different surfaces, and this is the cut that matters.** *"X is due in three days"* is a status you need to be aware of; *"I have decided I am doing X today"* is a gesture you performed. An earlier draft merged them into one band with two kinds of member distinguished by a mark — which is the shape MT5a rejected, a region meaning two things depending on what put something there. They separate cleanly, and the cut is not taxonomy: **a due date approaching has more in common with a talk approaching than with anything you chose.** Both are the world bearing down, and both belong on the horizon.

**Which makes T9 stronger rather than merely tidier.** A due-soon band above the task list only fires when you are already looking at the task list — and the way a deadline gets missed is by not looking. The compact horizon is present in the ordinary working view whatever you are doing, so a date arriving reaches you while you are writing. That is the guarantee T9 asked for, delivered by a surface that also carries talks, trips and holidays.

*This also corrects something the first pass got wrong.* Treating due-soon as **advice at the moment of choosing** was rejected on the grounds that a date arriving on Wednesday would then never be seen unless somebody chose to reorient on Wednesday. The objection held only while the horizon was reorient-only. With an always-present strip it dissolves: the strip is lapse-proof, and reorient is where it informs a decision.

**A selection, never a relocation.** Era 3 achieved this by moving items into a section, and this design cannot: `goal/todo.md` forbids re-arranging the list, because era 2's nesting could express urgency or subject but never both. The band is where the selection shows; the list underneath is untouched, in creation order, exactly where you know your way around it.

### The three movements

Same flow for the daily pass and for the *"I've been away and I'm overwhelmed"* pass — **its cost is proportional to what has changed, not to what exists**, which is the walk's defaults-to-unchanged principle extended. After a day it is a few gestures; after three weeks the middle is long and the selection is a real reduction.

1. **What's coming** — the horizon: everything bearing down, whatever its source. *First*, because it is context for the selection: whether a task matters today depends on whether there is a talk in ten days and a report due Thursday. Read the list first and discover those afterward, and the choosing has to be redone.
2. **What's live** — the walk, exactly as MT5a built it. Every item, defaults to unchanged, drop staged. The long movement.
3. **What's today** — choose from what you have just looked at. The output.

**Dockets are not walked.** A docket is complete and mostly dormant, and stepping through hundreds of standing matters daily is absurd; its real rhythm is two people sitting down with it occasionally. Reorient sees the *projections*, not the contents — which is H1 holding. But it surfaces **docket staleness** in one line — *"household — not reviewed since June"* — because a complete record nobody opens is not protective, and that is the graveyard risk arriving inside the mechanism built to prevent it.

### The docket review is what Q3a was looking for

**And it is a session, not a drip.** Q3a offered three candidate resurfacing mechanisms — an expiry, a rotating sample inside the daily walk, and resurfacing on tag activity — and all three model a trickle. Use says otherwise: *"an organized way to regularly pull items from this to the fore,"* *"we should be regularly regathering."* A periodic review of a whole set, deliberate, sometimes performed with another person. That ritual was designed here for an unrelated reason and turns out to be the same mechanism.

**One rule has to hold, or the project's founding insight is lost.** *The backlog is regathered **from**, never routed **into**.* Deciding at three in the afternoon that a task is not-now must cost one keystroke and **zero decisions** — *"which container does this go in?"* is precisely the friction Portal's Space-inference machinery existed to answer, and deleting it is why this project exists. **Backlog is the inbox; the docket review is where filing happens**, because that is the moment when routing is cheap. Naming a docket at the moment of backlogging stays available for when the answer is already known; it is never required.

### The backlog *is* a docket, and so is the overall-todo file

**One kind, with one distinguished instance at the root** — the pattern this project already uses three times: one stream is *the* notebook, the `.todo` directory at the root is *the* list, `sections/_index.fileset.md` is *the* top-level section list. **The miscellaneous docket is the fourth instance.**

The count goes from four kinds to two. Daily todo, overall todo (D55's *"blog posts you mean to write"*), backlog-as-status and docket become **daily todo and docket** — because a backlog of blog post ideas and a backlog of house repairs turn out to be the same object: a standing set requiring periodic review and a decision about what to surface. Two consequences arrive free: **`backlog` stops being a status and becomes a move**, with the item keeping its id so its history stays continuous and `tephra:todo/<id>` still resolves; and **docket staleness already guards it**, with no new mechanism.

**Its domain is provenance, not topic**, and that is the honest way to state it. "Miscellaneous" is not a subject, so H2's completeness claim means something different here: complete about *everything deferred and not yet filed*. That is still a well-defined set and still the thing that protects against loss.

### And the miscellaneous docket has one problem the topical ones do not

**Every topical docket is bounded by its domain; this one is bounded by nothing.** There are only so many things true about a house, which is what makes that docket reviewable in a sitting. Misc accumulates every deferred task from ordinary life with no organizing principle, and reviewing a long undifferentiated list is era 2 — the review that does not happen.

**And it concentrates the worst residue.** Items migrate *out* into topical dockets, so what remains is what never found a home: *"yeah, sometime."* Q3a's own warning was that *"someday, I suppose is the graveyard with a comfortable place to live"* — and a docket is a *nicer* comfortable place to live. **The review is a real improvement only if it happens, and length is what stops it.**

### The graveyard is a second root docket, and it is an instrument

**Tiered cold storage.** A matter that sits in the miscellaneous docket long enough, being declined repeatedly, **moves to the graveyard**. Not destroyed, still findable, still able to come back — merely somewhere it is not expected to. Decline count is the criterion, and Q3a already established the data exists by construction: *"declining is an edit and every edit is dated."*

**It does not solve the graveyard problem and must not be described as doing so.** What it does is make the problem literal, and that is worth more than it sounds, because **it is what makes deferring the real question legitimate.** The standing rule is *data cannot be backfilled; mechanisms can be deferred* — safe only when what is deferred is a mechanism over data already recorded. Today nothing records what dies: an abandoned thread simply stops appearing in day files. So *"not enough information to tackle it yet"* is currently a permanent condition, because the information is not accruing. **The graveyard makes it accrue.**

**Demotion is automatic and reported, never silent and never asked for.** Silent demotion is death by neglect with better filing, and the problem's own success statement is *die by decision, not by neglect*. But requiring a decision means it will not happen, and the miscellaneous docket clogs again. This is H10's split one level down: **automatic protects the record; the review says what happened** — *"nine moved to the graveyard since June"* — objectable in one gesture.

**The graveyard is exempt from staleness reporting** (H11), or the mechanism built to prevent neglect will nag about the one place where neglect is the point. It stays browsable and searchable.

**What it should record is more important than what it holds**, because its job is measurement. The one number that says whether this tier does anything is the **resurrection rate**: if nothing ever comes back out, the graveyard is deletion with extra steps, and that is a finding; if things come back often, the demotion rule is too aggressive. A move out is dated exactly like a move in, so this costs nothing.

**The name is deliberate.** `notes.md` records that *"someday, I suppose is the graveyard with a comfortable place to live"* — naming it the graveyard is what removes the comfort.

**Two tiers, and the tiering does not generalize.** A third tier must delete a concept before it is allowed to exist. Note the pattern this establishes: **root dockets are defined by process** — deferred-and-unfiled, given-up-on — **while named dockets are defined by topic.**

## The tension, and the one thing that reconciles it

A docket must be **complete**, or something falls out of it and dies unseen. The horizon must be **short**, or it stops being read and you are blind anyway. Those pull directly against each other, and this is the same shape as T11 against T12.

**The reconciler is the ramp-up window, and that is why it is the real invention here.** It is not a reminder setting; it is the per-matter parameter deciding what reaches the horizon *at all*, and it is what lets a complete record project onto a readable surface. A talk wants two weeks. A wife's birthday wants a few months, because the output is *"sitting down and creating a doc just to figure out the plan."* An air filter wants a few days. A global setting cannot express that, so **the window is authored per matter**.

This also settles a category the first reading dismissed. *"The most important thing is that during that window, I'm aware that a talk is approaching and am thinking about it during downtime."* That is an **awareness state**, not a task, and the TODO list cannot express it — an item is a thing to do. So "a reminder with no TODO" is real, not for holidays but for the run-up itself.

## Requirements

**H1. One source, three projections.** A docket is the durable record; **TODO items, horizon rows and documents** are projections of it. Nothing is authored twice, and no projection is the place where something is remembered.

**The document projection closes a case filed early as unrelated.** Promotion produces *"some combination of documents (if I'm managing a complex project), TODO items, horizon view items"* — which is also the trip template (*"I literally do have a doc template for the details of a trip"*) and the birthday, whose output is *"sitting down and creating a doc just to figure out the plan."* A matter may instantiate a document from a template, and templates are therefore not a separate feature.

**H2. A docket is complete about its domain**, and holds matters that are dormant, standing, or not yet live. This is what distinguishes it from the working list and the windowed horizon.

**H3. A docket is edited as a group.** Reasoning about the set is a first-class motion, performed beside another person reading the same screen. Legibility at conversational distance is a requirement on this view, not polish. **No sharing model, no accounts, no multi-user anything** — the constraint in `requirements.md` is untouched.

**H4. Every matter carries a ramp-up window**, authored per matter, which decides when it becomes live. This is what reconciles H2 with H8.

> **Amended 2026-09-11 (D76), by MH1 in daily use.** This said the need was evidenced and the shape was not, and the shape was wrong. *Ramp-up* names one case — preparation ahead of a known date — and the first case real use produced was the opposite: a repair with **no date at all**, whose steps run *forward* from the moment somebody decides to start it. What a matter carries is an ordered list of **steps**, each either `T±N` from its critical date or `{step} + N` after another step completes. The window is then derived rather than authored: a matter becomes live at the earliest of its steps.

**H5. Matters generate TODO items** — templated text with substitution from the occurrence, tags, and a due date — and may instantiate **a document from a template**. Generation is **automatic, on the day boundary, and never contingent on reorient** (H10).

**H6. A matter may generate awareness with no task.** The run-up state is a thing to be in, which no TODO item can express. *(D76: this is a step of the **status** kind, beside the **task** kind and the **reschedule** kind.)*

**H7. Recurrence covers one-off, an explicit list, a pointer to an ICS file, and *N days after the last time it actually happened*.** Calendar-rule recurrence — Hebrew dates, third Thursday of November — is wanted later and not now.

> **Amended 2026-09-11 (D76).** *N days after it last happened* is **not a kind of schedule** — it is a **reschedule step**, `{change the filter} + 90d`. It was the only recurrence here whose meaning depended on an event rather than a calendar, and as a step it becomes a case of the dependency mechanism that step chaining needs anyway. What remains a schedule is: **none**, a **fixed** critical date, or an **interval** periodicity. Intervals are calendar arithmetic on a date, so `every 1y` lands on the same day each year and covers a birthday without a rule grammar; the rule grammar this requirement defers stays deferred.

**H7b. A matter need not have a date at all.** Three kinds, and the household case produced all three at once:

- **Recurring** — the air filter. Has a rule, generates on schedule.
- **Dated** — the talk, the birthday. Has a date and a ramp-up window.
- **Standing** — the broken oven, repainting the house. Has **no** date, and giving it one is the *point of the review*. It is true about the domain indefinitely, which is exactly what H2 asks a docket to hold, so it fits the container without stretching it.

~~**And a standing matter may be scheduled to a season rather than a date**~~ — *"during which months will we be driving these"* — ~~because a major project is committed to a period long before it has a day~~.

> **Withdrawn 2026-09-11 (D76).** Built in MH1 (`2026-03..2026-05` and day ranges both) and then found to be a premature optimisation. The case it was imagined for is *a major project that spreads over months* — and such a project is not qualitatively different from anything else on a docket. It is a matter with **steps** spread out, which the step list says better than a fuzzy date did. Removed rather than left unused (D66).

**H7a. The matter recurs; the tasks it generates do not.** The air filter is one durable matter with identity and history, and each occurrence mints a **fresh, independent** TODO item that can be edited, retagged, deferred or dropped without touching the recurrence. Two things follow, and neither is optional:

- **Completion flows backward.** Because occurrences are independent, "N days since it last happened" cannot be recovered from an item's own history — the matter has to be told. One generated item per occurrence is designated as the one whose completion advances the clock. *(D76: the designation is the **antecedent of the reschedule step**, which is authored rather than inferred — exactly what Qa demanded. And completion is stamped on the **step**, not read off the generated item, because the item can be edited away and because suspension has to preserve the answer after withdrawing the items. It is cleared when a reschedule starts a new instance, or the second filter change would be born already done.)*
- **A matter knows whether it has an occurrence outstanding.** Otherwise a filter task never completed either generates a duplicate every cycle or silently stops recurring — accumulation or a graveyard, and both are failures this project is named against. An outstanding occurrence is shown as overdue rather than reissued.

**H8. The compact horizon is always present** in the ordinary working view, short by construction, and holds **everything bearing down, whatever its source** — matters inside their ramp-up window, holidays and trips, and TODO items whose due dates are approaching or already past. It runs from a little behind you to some distance ahead, because something overdue is as much a thing to have in mind as something coming.

**This is what satisfies T9**, and it satisfies it better than a band above the task list would, because the way a deadline is missed is by not looking at the list. **It is also what makes a skipped reorient safe:** generation being automatic protects the data, but the awareness H6 exists for would otherwise be one line in a long list and never reach anyone's head. Exactly as the walk is what makes the soft cap safe, this is what makes an optional ritual affordable.

**H9. One band above the task list, holding the day's selection, and nothing else.** Purely volitional — only what you chose at reorient is in it, and nothing ever arrives automatically, because imposed things go to the horizon (H8). It is a **selection, never a relocation**: the list beneath stays in creation order.

**H10. Generation is automatic; reorient is offered.** A skipped reorient costs the day's attention and never the data. This is the carry/walk split, repeated because the cost of getting it wrong is higher here.

**H11. Reorient spans the whole situation** — the horizon, the live list, and the day's selection, in that order — and is invocable on demand as well as offered at the day boundary. It supersedes T11, which was the same flow scoped to one document. It reports docket staleness and does not walk docket contents.

**H12. Dated rows may be read from an ICS file kept in the notebook.** A file, not a service: holidays belong on the calendar and appear here as rows. **Tephra never writes to an external calendar** — trips are entered there by hand, which is deliberately preferred over the feature bloat of an integration.

**H13. A generated item records what generated it.** Provenance cannot be backfilled: without it, no later mechanism can ever tell a generated line from a typed one. Same class of hazard as item ids and R15's timestamps, and therefore the part that must ship first even if the rest waits. **H7a makes it doubly earned** — the link is also the channel completion travels back along, so it is read in both directions and is load-bearing rather than diagnostic.

**H14. Matters carry an optional link to one document and an optional owner.** Both derived from experience rather than from analysis.

**H15. Dockets are plain, legible, hand-editable files** (R26, carried), and remain sensible to a reader who does not have Tephra.

## Success

**"I know what is coming, nothing that arrives is a surprise, and I am carrying none of it in my head."**

Two failure modes, pulling opposite ways — the same structure as `goal/todo.md`'s, and the reason that document's tension was the substance of its problem:

- **Blindness** — something arrives that should have been seen coming. Guarded by H2 (the record is complete), H5 (it fires whether or not anyone looks) and H8 (it is visible without a ritual).
- **Noise** — the horizon fills, stops being read, and blindness returns through the front door. Guarded by H4, the only mechanism here that can shorten the horizon without shortening the record.

A design that optimizes either alone fails.

## What is invented rather than derived

Two things go past the evidence and should be argued with. **The ramp-up window as a per-matter parameter** — the need for run-up is well evidenced; that this is its shape is not. And **the docket as a document kind of its own** rather than a mode of something existing, which Qb accepted deliberately and which sets a precedent for the next candidate.

*Reorient's centrality and the day's selection have left this list*: the first on the user's account of what the flow is for, the second on era 3's spontaneous practice.

## Open

**Qa. RESOLVED — the matter recurs, its tasks do not.** See H7a. **The designated occurrence is explicitly authored**, not inferred from trigger order: a matter with a document at −60d and tasks at −14d and −2d has to say which one closing means *this happened*.

**Two things are left open, and they are adjacent rather than the same** (MH3):

- **Drop on any generated occurrence** means either *skip this one* or *this never happened and is still owed*. MT5a rejected exactly this shape once — a control whose meaning depends on invisible state — so the two have to be told apart rather than merged.
- **Drop on the DESIGNATED occurrence** additionally decides what happens to *when did this last happen*. Dropping the thing the clock reads from is the sharper case, and it has no answer yet.

> **Narrowed 2026-09-11 (D76).** The second question stops being global. There is
> no designated *occurrence* any more — there is the **antecedent of a reschedule
> step**, which is authored explicitly, so the question becomes *what does
> dropping the antecedent of a reschedule do?* Three answers are now sayable
> where none were before: the step stays owed and the matter does not recur until
> it is done; the reschedule fires anyway from the drop; or the matter suspends.
> **Still open, but local** — about one step rather than about the whole shape of
> recurrence.
>
> **And a third question arrives with suspension.** *Suspend* withdraws pending
> tasks and horizon rows, so it needs to find what a matter generated — which is
> MH3's provenance requirement, now load-bearing rather than nice to have.

**Qb. RESOLVED — four types, and the increment is paid for rather than waived.** *"If you have three of something, you'll end up with N"* — true, and the counting rule survives that as long as the number stays a constraint rather than a defence. What is added is exactly one type: **the docket, a document kind with its own UX**, as TODO is. **The horizon is not a second addition** — it is a *query over everything dated*, spanning dockets and the task list both, which is D9's filtered-view pattern and precisely the shape the link directory already took corpus-wide. And reorient spans types, so it is a flow rather than a type. **Three becomes four, not five**, and the next candidate must make the same argument this one did: why it cannot be a mode of something existing. `scope.md` is amended when this ships, not before — it describes what is built.

**Qc. RESOLVED — a structured file, with an editing UI from the first milestone.** Everything a matter carries fits in a line of markdown *except* triggers, and forcing those flat would mean spelling one trip as five sibling matters that have to be edited together.

**The constraint that made this look hard was misstated, and the correction is the whole resolution.** An earlier draft had the raw file being what two people read together, and therefore needing to be legible *aloud*. They are looking at **one screen**, so legibility is a requirement on **the docket view** — which is why that view is not deferred past the first milestone, and why the file is free to be structured.

What still binds: lenient parse, precise serialize, untouched lines round-tripped byte-for-byte, plain and readable without Tephra (R26), and type declared by containing directory. **Within that, one discriminator dominates the remaining choice — whitespace-significance.** Merges are line-based and hand-editing must degrade gracefully, so a format where one bad indent restructures the document is worse here than one whose records are flat independent blocks. That argues against nested YAML and for a block-per-matter form. Not yet decided, and small.

**Qd. RESOLVED** — the three movements above, and the volition/imposition cut in H8 and H9. **The selection carries no order**: it is too short for one to matter in practice. So nothing in this design is hand-ordered, and everything remains creation order or derived.

**Qf. Does a due date want a lead time of its own?** H4 gives every matter an authored ramp-up window, on the argument that prep time varies from days to months. Due dates now feed the same surface, so the question transfers. **The working answer is no** — the horizon's lookahead is a property of the horizon, per-matter windows exist because a birthday needs months and an air filter needs days, and task deadlines are typically short-fuse. Era 1 also records that the number of dated tasks was "surprisingly small." A second parameter on `DUE` would complicate the one notation `goal/todo.md` was careful to keep single, so this needs a specific failure before it moves.

**Qe. Where the day's selection is stored.** Not designed here, but the precedent is strong and worth naming so it is not re-derived: `walked` and `carriedFrom` live in the day's own frontmatter, on the argument that they are metadata about that precise day and not text anybody typed. A selection made by clicking is the same kind of thing — and it must not survive the carry, because a `today` mark that persists is a decision from a day that has ended.

## Decisions and requirements this revisits

- **R19 is promoted**, against the evidence its own gate demanded. What it got right survives: the full horizon is a plain date-ordered list, not a calendar view.
- **T11 is superseded by H11.** Same ritual, wrong scope.
- **T9 is satisfied by H8, not superseded.** Its requirement was always *"order by urgency so the eye never has to scan,"* and what changes is only where that happens: the compact horizon rather than a band above the task list. The relocation is an improvement — a band on the list cannot help someone who is not looking at the list, which is how a deadline is actually missed.
- **T12 and MT5c — the soft cap — are deferred, and the deferral is free.** `milestones.md` already establishes why: the cap's promise existed only because a cap degrades visibility, so with no cap there is nothing unsafe, only a longer list. What is new is that **reorient is now the evidence source** — a daily selection is a much better instrument for what the working view should hold than a number chosen in advance.
- **The single-user constraint is confirmed, and cheaply.** Two people, one screen. Recorded because the question was live and the answer forecloses a large branch.
- **T4's `backlog` status is REINTERPRETED, not superseded** *(corrected 2026-09-10)*. An earlier draft had it leaving the status set; it cannot, because `[>]` is written into day files, past day files are never rewritten, and an unknown bracket is not an item — so the glyph disappearing would stop historical backlogged lines parsing, break `tephra:todo/<id>` for exactly the items D71 keeps continuous, and drop their ids out of the set new ids are minted against. What changes is the meaning: **`[>]` is now *transferred to a docket***, which is what the notation always said, and it counts as **resolved** rather than waiting. No regression on visibility: backlogged items were already excluded from the walk, *"or the walk would grow without bound."*
- **D55's overall-todo file is subsumed by the docket.** Its population — *"the blog posts you mean to write"* — is a standing set wanting periodic review and selective promotion, which is a docket's definition. Two kinds where there were four.
- **`goal/todo.md`'s ban on items referencing each other is narrowly breached** by H7's completion-relative recurrence and by *"schedule the SA-512 maintenance after the normal service."* The ban rests on twenty years of evidence that general cross-reference is low value; what is needed is only *completion of X advances Y*, which does not reopen the general case.
- **`scope.md`'s counting rule goes to four** — see Qb, and amend when built.
