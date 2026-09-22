# Milestones — what shipped, and what we might build next

**Tephra 1.0 works, and is in daily use, and use is now what drives it.** Since
the projects list replaced the plan, every change has come from living on it —
D91 to D93 are all reports from the notebook rather than items from a roadmap,
and two of them were bugs that only a real docket could have found.

Four weeks from the first commit
(2026-08-12) to v1 complete (2026-09-10), and a week after that on dockets, the
horizon, the service split and the editing surface. It has been the notebook
this design was written in since well before it was finished, which is where
most of the evidence below came from.

**This file was a checklist and is not one any more.** The ordered plan is
finished: every dependency in it has been met, and what remains is a set of
projects that are each worth having, none of which is *next* by dependency.
Choosing between them is now the work that used to be done by the order, and
that choice wants information that only use produces — so this file's job has
changed from *what comes next* to **what we might take on, and what each one is
waiting to learn.**

## Where everything lives

| | |
|---|---|
| `architecture.md` | The layering and the core objects — the *why* behind the structure. |
| `architecture-as-built.md` | The map: the layers as modules, a keystroke's path to the disk, which file holds each contract. |
| `features.md` | Every feature in one list, with the stage it belongs to. |
| `working-in-the-tree.md` | Running it, packaging it, the suites, and how to know what to test. |
| `parts/` | The detailed design of each piece, and the roadmap of each package — twenty-nine documents, including the two below. Each says at its head what it is and whether it is decided. |
| `parts/build-history.md` | How 1.0 got built, phase by phase — what each slice taught and what it moved. |
| `parts/feature-backlog.md` | The register of candidates that have *left* this list, and why. Promotion reasoning is the reusable part. |

## What shipped

| Phase | What it was | Landed |
|---|---|---|
| **M0** | One path through every layer, naively, to falsify the API shapes before anything was built on them | Aug |
| **MV** | The visual system — the typographic spine the whole app is judged against | Aug |
| **M1** | The corpus becomes safe: the WAL, the git repository underneath, crash and divergence paths | Aug |
| **M2** | A range becomes something you can act on — tags, marks, comments, branching | Aug |
| **MC** | Documents, kinds and windows: the refactor of the spine (D54) | Aug–Sep |
| **M3** | Navigation, filesets, the sidebar, and the file lifecycle | Sep |
| **MD1 · MD2** | The day boundary as one rule with three customers, and the notebook's own time zone | Sep |
| **MT** | The TODO list: capture, the walk, the tag pivot, more than one list | Sep |
| **ML** | The link directory — an interaction unserved in all three previous eras | Sep |
| **M4** | Retrieval: the query engine, the find walk, the results pane, and image paste | Sep |
| **M5** | *Dissolved into this list* on 2026-09-10 — the editing surface's remaining work is a project, not a milestone | — |
| **MH1 · MH3a · MH3b · MH2** | Dockets as a document kind, generation, the clock tick, and the horizon as its own object | 10–12 Sep |
| **MH4 (part)** | The day's selection, bulk acts on the list, reorient's entrances, the compact horizon | 12–13 Sep |
| **D80** | An explicit list of instances — and the schedule panel it brought with it, which was the larger half | 13 Sep |
| **D83 · D84** | `DocumentService` split into sixteen services across four tiers; `ipc.ts` 471 lines to 66 | 14 Sep |
| **MT8 · D85** | TODO items become structured records with a field-based format; `for:` replaces the matter tag | 15 Sep |
| **D86–D90** | One measure, with the code face's size solved so eighty columns fit it; smart quotes; the stale-edit guard; elided blocks; drafts; the Tasks row in the sidebar | 15–16 Sep |
| **D91, and two bugs** | A one-off matter finishes and is filed in an archive beside its docket; reconciliation on demand; **adoption**, without which a docket written from outside Tephra generated nothing at all | 16 Sep |
| **note 72 · D95** | Wrapped lines stop beginning with a space — CodeMirror's `break-spaces` moves one there whenever a word ends at the margin — and a paragraph opening with a quotation hangs it into the margin | 21–22 Sep |
| **D94, and a race** | A deleted row is not a decision, so the step offers the work again; and the day's **carry** taken under the mutation queue — two unlocked writes had it materialising twice, every item sharing an id with its copy | 18 Sep |
| **D92 · D93** | An event has an **extent** (`until:`) and stays on the horizon until it ends; a status step completes when its days pass, which is what lets an event finish and be filed; a matter's lone echoing step follows its rename; and a generated task gets a due date only where something is a clock | 18 Sep |

The reasoning behind each — what it taught, what it moved, which of its
predictions were wrong — is `parts/build-history.md`.

## How something leaves this list

**Wanted-on-demand, not deferred.** Nothing below is waiting on a dependency;
each is waiting to be *chosen*, and may be reordered freely against anything
else here. That is a different thing from the deferrals recorded elsewhere: a
deferral says *the design has no answer yet* and says so — Q3a's backlog
resurfacing is the standing example — while these have answers and no demand.

**The test is `goal/scope.md`'s: what does having this here beat?** And the
evidence that answers it comes from living on the product, not from argument.
That rule has been working rather than failing: several candidates left the
backlog *during* v1, each promoted by use or by a specific recorded failure —
the explicit list of instances arrived one day after it entered, because a
role-playing game's irregular session dates made an interval a lie.

## The projects

Each of these is solid enough to build and short of something needed to build it
*well*. The missing thing is named, because that is what makes it a project
rather than a hesitation.

### Reorientation: the annotation layer

*MH4's remainder. `parts/horizon-roadmap.md` under MH4; H11.*

The reorient pass and its entrances exist. What remains is **how the flow shows
on screen what might require attention** — annotations on the surfaces already
in front of you, so reorienting is reading rather than answering a sequence of
questions, and the verbs stay on the rows.

**Waiting on:** a list of what actually earns an annotation, which use has not
yet produced. Three questions are open and none can be answered from the records
as they stand: what earns one, how it is drawn against D42's rule that nothing
moves under you unbidden, and whether an annotation is computed at the moment of
looking or recorded by the pass — which is D77's question again and probably has
D77's answer.

### The docket review flow

*MH5. `parts/horizon-roadmap.md`; H2, T14.*

The backlog becomes the distinguished **miscellaneous** docket; `move` preserves
identity; the review session exists, and decline counts begin accruing.
**Docket staleness reporting belongs to this phase** (moved here 2026-09-16): a
marked review matter is only worth seeding when there is a review to complete
it, and *not reviewed since June* has nothing to read until one has been.

**Waiting on:** a real backlog to review. Deferred 2026-09-16 for exactly that
reason — there is no crisp backlog in the notebook today, so the flow would be
designed against a fixture and judged against nothing.

### The graveyard

*MH6. `parts/horizon-roadmap.md`; H3.*

Matters passed over enough times move to the graveyard automatically, and the
next review reports what moved — **automatic migration between dockets**, which
is the plainest way to say what it is. The resurrection rate becomes visible,
which is the only evidence that the threshold is right. The graveyard is exempt from staleness
reporting, or the mechanism built to prevent neglect nags about the one place
where neglect is the point.

**Half of it is now built, by something else.** D91's archive is the same
motion with a different trigger — finished rather than passed over — so
demotion arrives as a second caller of a mechanism that exists, with two
differences to keep in view: the graveyard may use `moveTo`'s recreation, since
nothing about a never-started matter is worth preserving byte-for-byte, and it
must be exempt from staleness reporting.

**Waiting on:** MH5's decline counts. Decline count is un-backfillable and only
accrues once the review exists, so shipping these together would mean choosing
the demotion threshold against **zero data** — which is the position the soft cap
has been stuck in since MT5c, and the reason it is still unbuilt. This builds the
instrument, not the answer: the graveyard *problem* — threads going quiet — is a
separate and unstarted clarification.

### Filesets as collections

*R20–R22. The index format and the nav role shipped in v1; this is the rest.*

What a fileset is for beyond being a list in the sidebar: summaries that are
kept, opening a collection en masse, snapshots taken of what it points at.

**Waiting on:** nothing external — the specific failures are already recorded
(summaries not kept, en-masse opening painful, snapshots not taken). This is the
largest project here that could start today.

### Models and agents — the door, and the conversation

*Notes: `parts/agent-api.md`. Raised 2026-09-16, from two wants that arrived in
the same week.*

**Two wants that look like one feature and are not.** Converting a page of prose
into docket matters is a *transformation of the corpus*: a model does work on the
notebook and leaves, and what it needs is an API. Wanting to think about
yesterday's notes with a model that knows you is a *conversation anchored in the
corpus*, and what it needs is a **place**. Building one thing for both is how
this becomes a chat sidebar nobody opens.

**The door is smaller than it looks.** The operations already exist — thirty-three
docket operations, twenty-four list operations, plus nav, search and comments,
all validated and all going through the services that own the lock. What is
missing is a caller outside the renderer, which is the shape D83 already left
behind: a service declares which door it answers, and this is a third one. The
test to build against is the user's own: **a model must be able to operate the
notebook without reading the codebase** — which means the door offers operations
and owns the serialisation, rather than a document explaining the file format to
machines.

**The place may already exist too, and this is the surprising part.** A comment
carries an `author`, an **assignee** (`→ **Name**`), append-only replies, and a
byline rule that preserves unknown tokens so it can grow without a format break.
So *select a passage, address a comment to a model, and the reply lands in the
thread as a message* needs no new kind and no new surface. The anchor decides
what is disclosed; the exchange is durable and findable like everything else.
And Tephra need not talk to a service at all: a question addressed to a model is
text in a file, which a local agent can read and answer through the same door.

**Four policies this wants decided before it is built**, each from something
that has already happened: provenance is a field and not a convention (D79's
precedent, the snippets question as the failure); acceptance is a gesture, so
proposals land somewhere you promote them from; **amend, not only append**, since
the real work in the first conversion was reconciling against what the docket
already said; and disclosure is scoped and recorded — the mirror of D69, which
settled what may be *written* to a service and never had to ask what may leave.

**Waiting on:** which operations use actually demands. The first conversion was
done by hand on purpose and produced the list in `parts/agent-api.md`; a few
more will say which six of the fifty-seven carry the traffic. Nothing about the
conversation half is blocked by the door, but it is cheaper after it.

### The editing surface: the keymap and the visual system

*D67, R1.3, R1.4 as superseded. `parts/keymap.md`.*

Grouped because they are the same kind of work on the same surface: what a key
does and what a line looks like are both answers to *is this pleasant to write
in*, and doing one without the other means looking at the surface twice.

The keymap's inventory is done and kept true by `tests/unit/keymap.test.ts` —
fifty-nine inherited bindings from five sources that do not know about each
other. What remains is deciding what they *should* do. R1.5 is the standard:
*a design that drifts toward someone else's conventions has failed on its own
terms*, and inheriting a code editor's defaults is exactly that drift. The ones
most worth fixing first: ⌘↑/⌘↓/⌘Home/⌘End, which mean *the loaded window* in a
twenty-year stream; ⌘⇧K deleting a line beside ⌘K for Link; the emacs layer and
multiple cursors; and Escape, which belongs to two things at once.

The visual system's *tunable* half is built and has had several passes. What
"excellent" wants next is a judgement that needs road miles: the measure at very
wide windows, the vertical rhythm around block widgets, heading scale in a long
day, how the printed page differs from the screen.

**Waiting on:** the road miles, and a sitting where the whole surface is judged
at once rather than a key at a time.

### Rendered editing of inline constructs

*R1.4, Q1. In the backlog since `features.md` was written; settled there
2026-09-09.*

Emphasis, links and inline math edited **as they are drawn**, rather than the
line under the caret showing its markdown. D16's reveal is correct and this is
an addition to it, not a replacement.

**Waiting on:** the raw form actually being in the way. The plain version has
been in daily use for months without a complaint, which is the promotion rule's
answer for now.

### Snippets — summaries of what got done

*Asked for from use 2026-09-08. Needs design before it needs code.*

Read the task list and the notebook over a day or a week and produce a summary
of what was accomplished. MT6 already built the query it stands on — `itemsNow()`
knows what every item became and on which day — and `proseIn` already gives a
range of the stream to printing.

**Waiting on four decisions, none obvious:** where it is written (a generated
summary in the stream is text nobody wrote, filed under a date, in a corpus
whose premise is that it holds what you actually put there — a `snippets/`
document keeps the stream honest, and this is the decision the feature turns on);
what *accomplished* means; whether it is generated or written, since a summary
you edit is a document and one regenerated on a schedule is a view; and what
triggers it.

### The shreddable notebook

*M6. `parts/shreddable-notebook.md`; D46.*

A second notebook, opened by the same app, whose storage makes deletion real:
per-file encryption with destroyable keys, no history, no WAL, no sync. Its own
theme, so the two are never mistaken for each other.

**Waiting on nothing but the decision to want it.** It touches only the bottom
of the storage layer plus a config file and a theme, so nothing above it changes
and nothing else waits on it — and it defers cleanly against `goal/scope.md`'s
rule, since the notebook is a new directory whose files will not exist until it
does. **No coverage obligation is incurred by waiting.**

## Small items, ready when wanted

Each of these is an afternoon, and each was asked for from use.

| Item | Competes with | What it is |
|---|---|---|
| **Docket: a default matter type** | Picking the shape every time | Asked from use 2026-09-12. A docket is named for a domain and its matters are usually one shape — an `events` docket is one-off events, a maintenance one is recurring tasks. A setting at the docket level, so the *Add matter* drop-down opens on the right answer instead of the first one. |
| **Docket: sort by next instance** | The manual order | Asked from use 2026-09-12. The manual order is what sections and dragging are for (D75), and it is the right default; *soonest first* is a second reading of the same docket, and a docket long enough to need sections is long enough to want it. A view toggle rather than a reordering, since the stored order is a thing somebody arranged. |
| **Docket: a task shows its LAST ACTION, not its start** | *started 10 Sep*, which ages badly | **Proposed 2026-09-13**, from the same observation that split a task's date from an event's (D80 amended). *Started 10 Sep* answers *when did this begin* — useful on the first day and reproachful on the thirtieth, when the question has become *where is this up to*. **Derivable with no new state**: the latest `done` among the matter's steps, falling back to the start date, which is the same shape as the staleness signal MH4's annotations need and should share its definition. Pairs with **completion dates shown on the individual steps**, which is what makes the docket answer *where is this up to* rather than merely implying it. |
| **…and the tension it introduces** | — | **The slug stops being a rendering of `start`.** Everywhere else display and storage already differ — the horizon shows a step's date while the matter holds `start`, the due-soon strip says *in 3 days* while the file says a date — but this is the first case where **the control edits a different field from the one displayed beside it**: you click *last worked 12 Sep* and the panel that opens has no 12 Sep in it. The likely fix is that the panel carries the last-action date as read-only context, so the click lands somewhere that explains what was clicked. Worth deciding **before** building, because the failure is a non-sequitur rather than a bug and would be reported as *confusing* rather than as *wrong*. |
| **MT5c — the soft cap on the working view** (T12) | An unbounded list | **The number is the whole of what is missing.** Both `goal/todo.md` and `parts/todo.md` flag it as the requirement with the least evidence behind it, and the walk — which runs daily — is what produces that evidence: it ends with a count. **Waiting is free**: T11 carried the *every live item seen daily* promise on its own, so with no cap there is no promise to keep and nothing about the list is unsafe in the meantime; it is simply longer than it might be. |

## Candidates — decided about when the time comes

**A list of things to decide about, not a plan.** Each is admitted or dropped
deliberately against `goal/scope.md`'s test. What has already left this list,
and why, is `parts/feature-backlog.md`.

| Candidate | Competes with | What would promote it |
|---|---|---|
| **Backlog resurfacing** (T14, Q3a) | Cancelling outright, or a list nobody rereads | The mechanism is undecided, which is the whole of Q3a. Everything else in the TODO design is settled. |
| **Editable filtered views** | Read-only views, jump to source to edit | Measured friction of the jump. Still the most demanding thing in the design — and **narrowed by D9's 2026-09-08 amendment**: the only thing the question was ever about is the *composite document*, since the results panel and the find walk are read-only by nature and answered what it was invented for. So the evidence bar is now specific: wanting to edit matching passages *as one piece of prose*. |
| **Real search: ranking, stemming, synonyms** | v1's literal phrase matching | A phrase search failing on real recall tasks — the half-remembered thing not found. **Ranking cannot come first**: a scan cannot stream in rank order, so this arrives with the index below (D65 as amended). |
| **A text index** | Scanning | Scans ceasing to be instant (D7, D23 puts it at v2). Not to be confused with the **corpus index** (D52), which shipped in v1 and is a throwaway cache of a scan. |
| **Regex search** | Reading the file in another tool | A pattern you cannot express as a phrase. Cheap by design — one more leaf that never gains an index bound (D65) — so this is a small addition whenever it is wanted. |
| **History browser** | `git log` and `git show` in a terminal | The repository accumulates from v1 (D32), so the data is there from day one and only the affordance is missing. Promoted by the first time something is destroyed and noticed late — or by the terminal path proving too slow to reach for |
| **Footnotes as their own annotation kind** (D50) | Writing a footnote by hand, or using a comment for one | The first time a printed page wants notes at the foot AND commentary in the margin at the same time — the policy already expresses it, and only the kind is missing. Encoding is the open part: GFM `[^1]` is readable by every other renderer (R26) and needs a parser extension `@lezer/markdown`'s GFM does not include, where a marker pair would be consistent with comments (D47) and less legible in the raw file. |
| **URL snapshotting** (R22) | Saving a PDF by hand | Links found dead when it mattered. |
| **Browser extension** (R23) | Copy and paste | Frequency — the friction only counts if capture is frequent enough to matter. |
| **docx and other export** | Copy and paste into another program | An actual occasion where the markdown was not enough. |
| **ICS import** (H12) | Typing the holiday in | Deliberately deferred and *not* decided against, so D66's *a decision not to use something is a decision to remove it* does not apply: the `ics` variant stays in `When` as its placeholder. Now the cheaper half of D80's explicit instance list, which is the same shape read from a file. |
| **Calendar-rule recurrence** | An interval that approximates it | *The third Thursday of November*, *the Wednesday after Easter*, Hebrew dates. Wanted later by `goal/horizon.md`'s own account and explicitly out of D76: interval periodicity on calendar arithmetic covers most of it. |

## After v1

`parts/components.md` has the reasoning; in short: **v2a** is sync alone, **v2b**
is Android, **v3** promotes what earned it. The order matters — sync must land
first because the phone needs a corpus for any judgement about it to mean
anything, and the two risks should not arrive together.
