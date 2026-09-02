# MT — the TODO list

**Design: `goal/todo.md` and `solution/todo.md`. Decisions: D55–D59.**

Six phases. The rule for every one of them is the rule MC ran under: **`npm test`,
`m0`, `m1`, `m2` and `m3` are green at the end of it.** A phase that cannot be
finished with the app running is too big and gets split.

**The ordering is forced by three things**, and only three:

- **Identity is a one-way door** (D56). Ids written from day one are cheap;
  retrofitting them onto a year of carried-forward lines is not. So the format
  comes before anything that would put lines in a file.
- **Interaction 1 dominates.** Reading the list, checking things off and adding
  to it is many-times-daily; everything else in `goal/todo.md` is at most daily.
  So the list surface comes before the walk, the pivots and the cap.
- **T12 cannot ship before T11.** The cap works by degrading visibility and the
  walk is what makes that safe. This is the design's own coupling and it is not
  negotiable.

Everything else is ordered for the shortest path to something usable, which is
the end of MT3.

---

## MT1 — Directory documents, and the stream's migration *(done)*

**D59, and nothing user-visible changes.** That is the marker of a good first
phase: it moves the spine onto its final footing and the app behaves identically.

**Done**, and verified by `npm run m1`, which migrates a notebook built in the
old layout and then opens it. What the phase actually taught:

- **`STREAM_ID` was in the code twice under two names**, once in `shared/` for
  the renderer and once as `STREAM_DIR` in `w/layout.ts` for main, and nothing
  said they had to agree. They did agree, by luck. There is a test now.
- **Three places knew the stream by name where they meant "belongs to a
  directory document"** — the corpus's listing, the sidebar's directory
  sections, and restore's document sweep. Each would have needed a second
  clause for todo and a third for whatever came after. All three now ask
  `documentRoot(rel) !== null`.
- **The one special case that survives is honest**: `Corpus.exists` still names
  the stream, because its directory is in `REQUIRED_DIRS` and therefore exists
  in an empty notebook. That is a fact about the notebook rather than a fact
  about ids, and it is stated as one.
- **Two harness faults, found by chasing a failure that was not there.** A
  scene set with `TEPHRA_SHOT` was quit by `captureAndQuit`'s timer in the
  middle of its run — the scene stopped mid-sentence with no error, which reads
  exactly like a hang and was chased as one. The timer now stands down when a
  scene is running, because `VERIFY done` is the only moment worth
  photographing then. And the verify window, being deliberately never shown,
  had Chromium's hidden-page timer throttling applied to it for its whole run;
  that is off in verification mode now, and left on in ordinary use where a
  backgrounded notebook has nothing to do.
- **The write-ahead log was the only real hazard.** A WAL record names its
  document by id, so unreplayed records would survive the rename addressed to a
  document that no longer existed — and those are by definition the edits that
  never reached a file. The migration refuses to run over a non-empty log and
  says how to empty one.

- `kindOf` answers for directories by extension, the way it already answers for
  files — one function over both, replacing the hardcoded `stream/` prefix test.
- Path composition generalises with it: `dayFile(date)` today hardcodes
  `STREAM_DIR`, and becomes a function of which directory document is asking.
- `DocumentId` for a multi-file document is its directory path. `STREAM_ID`
  stops being the literal `'stream'` and becomes the `.stream` directory at the
  root — which retires the `id === STREAM_ID` special cases in `Corpus` rather
  than adding a second set beside them.
- `stream/` → `notebook.stream/`, with a migration script. Day files are already
  `.md` and do not move.
- The sidebar's directory listings exclude kinded directories **generically**
  rather than by name, or a todo list arrives as several thousand documents.
- Fixtures and harnesses: `m0`–`m3` and `verify-git.ts` compose `stream/…` by
  hand in several places.

**Accepted cost:** restore cannot reach versions committed before the rename
(D59). Deliberate; there is nothing critical behind that seam.

**Does not do:** anything about todo.

## MT2 — The kind: format, ids, carry *(done)*

**Done**, and verified by 32 tests that draw nothing. What the phase settled
beyond what was planned:

- **The status glyphs are era 1's, in markdown's own checkbox slot** — `[ ]`,
  `[/]`, `[?]`, `[x]`, `[-]`, and `[>]` for backlog, which is literally the
  paper log's *migrated forward*. They render as task-list checkboxes where a
  renderer understands them and as legible text where it does not.
- **A blocked reason is a trailing `— …` clause, read only on a blocked item.**
  Otherwise "call the surveyor — the one from Tuesday" acquires a reason it does
  not have and loses half its text. The cost is an edge case on hand-editing,
  which flow 9 already accepts.
- **Item spans are relative to the item's TEXT, not to its line.** The first
  cut reported line offsets and every verb then had to reconstruct where the
  text began — arithmetic that was wrong before it was written down. Text-
  relative makes `untag` a slice; `ScannedItem.textFrom` is the one place the
  conversion to body offsets lives, for the row that will draw chips (MT3).
- **`tagItem`, not `tag`.** `SegmentedDocument` already has `tag(span,
  subject)` for prose, and T5 says the two namespaces are separate. The
  collision was a compile error, and it was the right one: overriding would have
  claimed the two are one act.
- **`resolveDue` is on the write path and cannot be part of the parse.**
  Resolution needs to know what day it is, and a parse that took the day would
  report the 11th on Tuesday and the 18th the following Tuesday from a file
  that never changed — the drift T16 forbids, moved out of the file and into
  the reader where nothing can see it.
- **`.todo.md` as a single-file kind is retired.** A todo list is a `.todo`
  directory (D59) and there is no lightweight second form, so a lone
  `.todo.md` is an ordinary note whose name happens to say todo.

**The one-way door, and it is testable with no UI at all** — which is the point
of doing it here. A todo file opens in the markdown surface meanwhile, because
`surfaceFor` falls back to it, which is R26 working as designed.

- `shared/kinds/todo.ts` — the parse, shared by main and the renderer for the
  reason `shared/fileset.ts` and `shared/prose.ts` are: the assisted and typed
  entry paths in T16 must be incapable of disagreeing. Item line, status glyph,
  `#tag` and `#'multi word'`, `DUE <date>` with relative forms resolved to
  absolute on recognition, and the trailing item marker.
- `item` joins the `MARKER` alternation in `markers.ts`. That is the whole
  change to the shared scanner; the todo parse splits the marker's fields.
- `TodoDocument extends SegmentedDocument` — `load`, `keys`, and nothing else,
  because everything else is inherited.
- `carry()` — materialise today from the most recent day that has a file.
  Automatic, idempotent, and **not the walk's** (D55, revised). Skipping three
  days produces today from Monday, once.
- Verbs: `add`, `setStatus`, `setDue`, `tag`, `untag`, `edit` — each one
  `replace()`, each stamping mtime.
- Ids: eight base-36 characters. **Minted against the document until the index
  exists** (MT5), which is what eight characters are for — the unchecked window
  is safe on its own, and the check makes it certain later.

**Does not do:** any surface, any capture, any index.

## MT3 — The list *(done)*

**Done**, and verified by `npm run m3`. It also delivered **ML1**, the shared
link scanner (`solution/link-roadmap.md`). What the phase settled:

- **The surface reads ITEMS, not text.** `SurfaceProps` hands over a
  `DocumentWindow`, and the todo surface uses it for one thing: `onChanged` as
  the signal to re-read. The items themselves come from main already parsed,
  and every verb goes back the same way. Reading a window's prose and
  reconstructing rows from it would have been a second parser in the renderer,
  which is the failure the shared grammar exists to prevent.
- **Tags and the due date are lifted out of the PROSE and left in the LINE.**
  The row reads like a sentence with chips beside it; the file still says
  `#house` and `DUE 2026-09-14` where a person typed them (T16). `tagSpans` and
  `dueSpan` are what make that one operation rather than a second parse.
- **One channel, named verbs.** The wire is a `TodoCommand` union and the
  preload is where it stops being one, so a caller writes
  `todo.setStatus(list, id, 'done')` — the document's own vocabulary — and never
  composes a command object.
- **The distinguished list is `tasks.todo`**, not `main.todo`. A directory
  document is titled by its name (D59), so naming it for what it holds means
  the title falls out instead of being special-cased.
- **A bug the tests could not see and a screenshot could.** `parseDayFile`
  answers for every directory document now, so the corpus index was handing a
  task list's day to `StreamDocument.scan` — and the sidebar's Timeline showed
  today twice, once per document with a file for it. The root check was
  identified during MT1 and not written; looking at the picture is what found
  it. `dateOf` asks now.

### What using it changed, on the first day

Four things came back from actually working the list, and three were design
errors rather than bugs:

- **Flush left, not centred.** Prose is centred in a reading measure because
  that is how a column of text is read; a list is scanned down a left edge, and
  centring puts the thing the eye returns to in a different place on every
  window width. It still takes a measure, as a maximum on the left.
- **⌘1 opens a window of its own.** A person works with the list BESIDE what
  they are writing, not instead of it — so navigating the current window takes
  away the thing they were looking at. `Windows.reveal` focuses the window that
  already has it and opens one when none does; only main can answer that, since
  only main holds the set (MC6).
- **A click ADVANCES the status; it does not jump to done.** A checkbox over
  six states could reach two, so the gesture committed you to the wrong one of
  those two about as often as the right one. Click now steps *not started → in
  progress → done*, and the other three are on a right-click menu, where an act
  outside the daily rhythm belongs. Blocked asks why, because a block without
  the thing it is waiting on is the one status that says nothing.
- **The add field was a ~20-character box**, because it sat outside the flex
  row and `flex: 1` had nothing to act on. Typing a task into a slot narrower
  than the task is the thing this list exists to stop being.

**And the typist's assistant came forward from MT4**, because the notation is
not discoverable and a list you cannot tag without knowing the syntax is a list
you do not tag. Typing `#` completes against the tags that have live items;
`#` and `due` buttons reach the same thing by pointing. **Both write through
`resolveDue`, the same function the file is written through**, so what the
assistant produces is character-for-character what typing would have produced —
which is T16 made literal rather than merely intended.

**A pleasant find:** the live tag set (T6) needs no index. It is exactly the
tags on today's live items, and those are already on screen.

### And a second day of it

- **⌘0 and ⌘1 are the same act.** One navigated the current window and the
  other opened a new one, which was an accident of the order they were built
  in. Both now mean *there should be a window with this in it, in front* —
  matched by which DOCUMENT a window is on, not by which place inside it, so a
  window that has scrolled is still the window with the notebook in it.
- **The whole row is the target.** An item with no words had nothing to click:
  the text was a button, so an empty one collapsed to nothing and there was no
  way back into the line short of editing the file. It now says *Nothing
  written yet* and the row edits.
- **The list is set in the notebook's own type.** It had a hard-coded 15px,
  which made it quietly a different app from the notebook beside it — and made
  the theme panel's sliders lie about what they controlled. `typography.ts`
  already said this ("a kind that draws something other than running text still
  renders inside the same page", D41); the surface just was not listening. It
  takes the theme's LIST metrics, which exist for exactly this.
- **The status is drawn, not typed.** A character in a box takes the text's
  face and its own idea of where the middle is, so six of them lined up six
  ways. They are strokes on a 16-unit grid now — same weight at every size,
  sitting where they are put. The vocabulary is still era 1's; it is only drawn.
- **`<button>` does not inherit a font**, which is why the mark stayed one size
  while the theme's size slider moved: every `em` in its box was measuring the
  browser's 13px default rather than the text beside it.
- **The carry runs on a rollover, not only on an open.** The carry is the first
  touch of a day, and opening the list is a touch — but a window left open
  overnight is never opened again, so it went on showing yesterday's set and
  writing to yesterday's file. Main already announces the rollover for the
  stream's sake; the list listens now.
- **Completion reads the LIVE caret, not the render's.** A controlled input
  keeps its selection where it was when the value is set from code, so after
  Tab wrote a tag the render-time caret still pointed inside the fragment — and
  a second Tab completed it again: `#t` → `#tephra` → `#tephraephra`. The first
  fix, moving the caret after render, was not enough on its own: nothing
  re-rendered before the next keystroke, so the stale position was still what
  the handler read.
- **The options run down the page**, because up and down are what move through
  them. A row navigated with the arrow keys asks the hand and the eye to
  disagree about which way the list goes.
- **A row's padding is asymmetric, and in `em`.** Symmetric padding leaves the
  words looking high: a line box carries its leading above and below the ink,
  and an eye judges where a line sits by its x-height band rather than by the
  box around its descenders. The ink is set a shade below the middle, which is
  where it reads as centred.
- **And the mark is centred on the WORDS, not on the line box**, which is a
  different place and the reason it needs a constant rather than arithmetic
  alone. A line box is symmetric about the em box; a line of type is not, since
  descenders reach further down than the letters they hang from. Centring the
  mark geometrically therefore puts it low, and it rides up to meet the cap
  line instead. Both this and the row's rhythm are measured in `m3`, because a
  number nobody can see drifting is exactly the kind that drifts.
- **An item can be deleted outright**, which T2 does not cover and does not
  forbid. What is cut is the line from the day the item is live in; every
  earlier day keeps its copy, because those days are the record of what those
  days looked like. *Nevermind* remains the status for a task you decided
  against — this is for a line that was never a task, and it leaves no mark
  because there is nothing to have a view about.

**The first entry in `SURFACES`, and the first thing in Tephra shown as
something other than running text.** The unknowns of this whole milestone are
here rather than in the storage, so it gets a phase to itself.

- Rows: status glyph in a narrow left column, text with live links, tags at the
  right, the due date allowed to be loud.
- Creation order, oldest first, and it never re-sorts under you.
- Check off in one keystroke; finished items stay, greyed, until the next carry.
- **The row edit commits once** — text, tags and date together, one `replace()`.
  This is load-bearing for D56's mtime rule, not merely a UI preference.
- The due-soon band (T9): always present, usually short, absent when empty.

**It also delivers ML1, the shared link scanner** (`solution/link-roadmap.md`,
D61). A row is a table cell rather than CodeMirror, so rendering a live link in
one means finding links in a string — and without the shared scanner that is the
codebase's third link regex. Counted there, built here.

**Does not do:** the walk, the cap, the overflow rule, the pivots. The list is
the whole list, in order, and that is already useful.

**Usable from here.** MT1–MT3 is interaction 1 complete.

## MT4 — Capture from elsewhere

**T13, and the guard against the success criterion's first failure mode.**

- From the stream mid-sentence: the selection or the line becomes an item and
  leaves a link behind, the way `branch` already does.
- A quick-add from anywhere, keyboard-first, text and nothing else.
- `#` and date entry as a typist's assistant that produces character-for-
  character what the typed path produces (T16).

## MT5 — The walk, the tag index, and then the cap

**Depends on MD** (`solution/day-boundary.md`): the walk is offered when the
carry happens, which is when `openDay < writingDay`. It needs no trigger of its
own, and building one before the boundary existed would have been a third
subsystem learning the day rules by hand.


**In that order, because the cap depends on the walk** and the walk's completion
list wants the index.

- The walk: every live item, defaults to unchanged, one gesture when nothing has
  moved. Offered on the first open of a day, never modal.
- The tag index (T6): which tags have live items, which do not. This is what
  makes MT4's completion useful, and it is where id minting starts being
  checked (MT2).
- **Then** the soft cap (T12): the count at the end of the walk, and the
  overflow rule below the fold. Nothing hidden, nothing one click from lost.

## MT6 — The pivots and the drawer

- Tag pivot (T8) — live items and recently resolved ones together. Cheaper than
  `scope.md` feared: every live item is in today's file, so the live half is a
  filter over **one segment** and writes back as an ordinary edit. Only the
  resolved tail reaches into other days, and it can be read-only.
- Scrub to a past day (T7's flow 7) — read-only, and nearly free: it is opening
  a file.
- The backlog drawer (T14) — reachable and counted. **Resurfacing is deferred**
  (Q3a), and until it lands T14 is knowingly unmet.

---

## ML — the link directory, which is not part of this

**D57: it is a corpus capability, not a TODO feature**, and it has its own
roadmap in `solution/link-roadmap.md`. It shares exactly one piece of code with
this milestone — the link scanner, which MT3 delivers as ML1 — and nothing else:
D57 already made the TODO link mode a filter over a corpus-wide index rather
than something built here.

**It lands after MT3**, on urgency rather than on any structural driver. The
list is what is needed first; the directory arrives while MT4–MT6 are still
ahead, so anything that wants it has it.

## What is deliberately not here

- **Backlog resurfacing** (Q3a). Deferred to a milestone of its own, to be
  answered from use. Safe to defer because copy-forward already records every
  input such a mechanism could want.
- **Per-item history.** It falls out of the storage (D56) and nobody asked for
  it. Worth a view eventually; worth building nothing for now.
- **The graveyard problem.** Explicitly out of scope in `goal/todo.md` — it is
  about projects dying by neglect, not about items, and it gets its own project.
- **Mobile.** v2b, behind sync. The task now is confirming nothing here
  forecloses it, not designing it.
- **Bounding `SegmentedDocument`'s whole-history methods.** Noticed here, but
  it is the stream's problem more than todo's, and it is a change to the spine.
  Recorded in `document-roadmap.md`.
