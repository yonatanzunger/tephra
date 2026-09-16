# MT — the TODO list

**Design: `goal/todo.md` and `solution/parts/todo.md`. Decisions: D55–D59.**

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
link scanner (`solution/parts/link-roadmap.md`). What the phase settled:

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

**It also delivers ML1, the shared link scanner** (`solution/parts/link-roadmap.md`,
D61). A row is a table cell rather than CodeMirror, so rendering a live link in
one means finding links in a string — and without the shared scanner that is the
codebase's third link regex. Counted there, built here.

**Does not do:** the walk, the cap, the overflow rule, the pivots. The list is
the whole list, in order, and that is already useful.

**Usable from here.** MT1–MT3 is interaction 1 complete.

## MT4 — Capture from elsewhere *(done)*

**Done**, and verified by `npm run m3`. One gesture — `Task…`, ⌘⇧T — with two
behaviours, and the difference is **whether the prose IS the task**:

- **With a selection**, those words become the item and *stay where they are*,
  wrapped in a link to it. A journal that loses a sentence to make a task out of
  it has been gutted to fill a list, so `branch`'s move-it-out shape is the
  wrong model here even though the link-left-behind is the right one.
- **From a bare caret**, the line is offered in a prompt — prefilled and
  selected, so Return takes it and typing replaces it. **Nothing is written
  back**: if the words were retyped they are not the words on the page, and
  linking them would point at something that does not say what it points to.
  That is also the keyboard-first quick-add, which turned out to be the same
  gesture rather than a second one.

`tephra:todo/<id>` joins the reference vocabulary (D56) and follows to the list.
Landing on the exact line is worth having and is not this milestone's.

**The typist's assistant that was the third bullet here shipped early**, in the
round of feedback after MT3 — a notation nobody can discover is a notation
nobody uses.

**Depended on MD1** (`solution/parts/day-boundary.md`): capture writes into the stream
from outside it, and without the boundary in place it would be a fourth caller
learning the day rules by hand.


**T13, and the guard against the success criterion's first failure mode.**

- From the stream mid-sentence: the selection or the line becomes an item and
  leaves a link behind, the way `branch` already does.
- A quick-add from anywhere, keyboard-first, text and nothing else.
- `#` and date entry as a typist's assistant that produces character-for-
  character what the typed path produces (T16).

## MT4a — Arranging the list by tag *(done)*

**Not planned, and asked for from use** — "I'm already feeling the gap" — which
is the signal this roadmap is supposed to move for. It takes **half of T8 out of
MT6** and leaves the other half there, and the seam between them turned out to
be sharp enough to be worth naming.

**The pivot over today's set is a VIEW, not a query.** Every live item is in the
day already open (T7), so grouping by tag is a function of what is on screen: no
index, no second file read, and **no change above the renderer at all** — the
grouping is in `shared/kinds/todo.ts` because it is a fact about a list of items
rather than about drawing one, which is also what makes it testable with no DOM.
What stays in MT6 is the half that *is* a query: recently-resolved items from
earlier days, which reaches into files today's segment does not contain and
wants the index MT5 builds.

**An item appears under every tag it carries, not under its first.** The
question a tag view answers is "what is outstanding on the house", and an item
tagged `#house #urgent` is outstanding on the house whichever tag was typed
first. So the rows outnumber the items — that is not a defect being tolerated,
it is what "this item is in two places" looks like when it is drawn. It costs
nothing to keep consistent: every verb already round-trips through main and the
list re-reads, so checking an item off in one group moves it in the other
without anything being told to.

- **Alphabetical, and creation order within a group.** The list's governing
  promise is that it is a place you know your way around, so a pivot has to be
  as predictable as the order it replaces. Sorted by size or by recency, the
  headings would move under the reader as items came and went.
- **The untagged group is last and is never omitted.** A view that silently
  dropped untagged items would lose tasks, which is the one thing this list
  cannot do.
- **A row does not repeat the tag its heading already said**, and does show the
  others — which is exactly the information a duplicated row is carrying.
- **The choice is not persisted**, and that is a decision rather than an
  omission. The theme's selection lives in `UiState` because it is soft state
  known to be worth keeping; this is not known to be worth a mechanism yet, and
  the list window tends to stay open all day, so a reset costs one click on the
  rare morning. If that proves wrong it goes where the theme's selection already
  is, rather than into a second place soft state lives.
- **A completed tag is a finished tag, and the list has to close.** Matching is
  by prefix and a completed word is a prefix of itself, so the list went on
  offering `term` over a line that already said `#term`. An open list takes
  Return as *accept the suggestion*, so the consequence was that **Return could
  not commit an item ending in a tag at all** — the one gesture the assistant
  exists to make faster was the one it blocked. Reported as "enter should work
  like tab", and the truth was that Return already did what Tab did; what was
  missing was anything ever putting the list away. Taking a completion now
  dismisses it, which is the rule Escape already followed, and typing again is
  how you ask for it back.
- **A focused control keeps its own keys.** "Type anywhere to add an item"
  (MT3) swallowed the space that activates a button, so the first control ever
  put on this surface both looked broken and started an item with a space in
  it. The rule now stops at anything clickable.

**Does not do:** the resolved tail, filtering to one tag, or adding into a group
with its tag prefilled. The first is MT6's; the other two are cheap and nobody
has asked.

## MT5a — The walk *(done)*

**Done**, and verified by `npm run m3`. The design was settled in conversation
and shrank twice on the way, which is the part worth recording.

**What the walk turned out to be: the mode in which deleting is cheap.** Era 2's
ritual was copying yesterday's list by hand and crossing swathes of it out — and
the observation that started this milestone is that *deleting there never felt
like abandonment the way it did mid-afternoon*. The frame around the act was
different. That is not a preference, it is a mechanism, and a mode that supplies
the frame does work no amount of "make delete easier" could. Everything else in
the design is in service of it.

**And in Tephra the feeling is literally true.** Dropping during a walk cuts the
line from today's file; yesterday's and every earlier day keep their copy
untouched (MT3's rule for delete). On paper, crossing something out was the last
time you saw it. Here the record of what yesterday looked like is unharmed, so
the walk is not only a psychologically safer moment to delete but a genuinely
safer one.

**No second surface, and no new interaction.** The first design was a walk mode
with a moving highlight stepping down the list — a new surface and a new
gesture. What replaced it is the list you already know with a temporary state on
it, which satisfies T11's "prominent affordance, not a modal" more literally
than a walk mode ever could: **the offer IS the list looking different.**

**Exactly one control is added, and it is the destructive one.** An intermediate
draft staged both fates and made the status glyph a staged binary inside the
pass. That was the worst idea in it: a control that changes meaning depending on
invisible state is how a UI becomes surprising. Marking done already has a
control, it is reversible in a click, and it stays exactly where it is on every
other day. Deleting is the one act that wants looking at before it happens, so
it is the one that is staged.

- **The marks are a SELECTION, not an edit**, which is what lets the pass be
  abandoned with nothing undone. Ordinary editing stays live and immediate
  throughout; *Cancel* clears the selection and nobody expects clearing a
  selection to undo their typing. That framing is what stopped the two
  mechanisms from competing, and it is why the button is not called Revert.
- **Finishing is "I have looked", which sometimes also deletes.** A walk that
  drops nothing is the common one and still has to record the review, so an
  *Apply* that applied nothing would have been nonsense. It reads **Finish**,
  and **Finish, dropping 6** when anything is staged — the count appears exactly
  when there is something to be careful about, which guards a stray click better
  than distance does.
- **The way in is at the top and the way out is at the bottom**, which is both
  the direction you read a list in and a guarantee that finishing is never the
  same target you just clicked to start.
- **The staged rows preview the outcome** rather than going generically grey.
  Staging exists so you can look at what is about to happen; down a list of
  eight, *which four are going* has to be answerable at a glance.
- **`walked` and `carriedFrom` live in the day's own frontmatter**, because they
  are metadata about that precise day. They travel with the corpus, so a second
  device is looking at a day that has or has not been walked rather than at its
  own opinion of one — which `.tephra/` could not have given.
- **The drops are one write and therefore one undo step**, for the reason the
  carry is. **The `walked` bit is not in that step**: it is not text somebody
  typed, and it is kept where the title and the source are kept and written the
  way they are. Undoing the drops brings the lines back and leaves the day
  marked reviewed, which is true — you did review it — and the pass is always
  re-enterable.
- **Cool, not warm.** Built on a token and looked at both ways: a warm ochre
  disappears into the cream page and reads as slightly aged paper rather than as
  a state. The slate is the only cool thing in the app, which is the point.

### Three the list got wrong, reported in one sitting

None findable except by using it — a list you cannot scroll needs more items
than a fixture has, and the other two are about where a caret lands.

- **Typing started an item and then ate the first character.** The field
  selected everything on open, which is right when the text is an *offer* — a
  row being edited, a captured sentence (MT4) — and wrong when it is the
  character you just typed. Selecting all is now the default and the caller says
  otherwise, because the caller is the one that knows which of the two it has.
- **The list did not scroll.** `.frame-reading` is a flex column that does not
  scroll, because the editor carries CodeMirror's own scroller inside it and
  nothing had ever asked. **A surface scrolls itself**; the link directory had
  the same hole and was fixed with it.
- **In the tag view there was no way to add to a group.** There is one per
  group now, and it opens the row *inside* that group with the tag already
  written and the caret in front of it — so typing produces `buy paint #house`
  in one gesture. A field that appeared at the foot of the page after *add to
  house* would be answering a different question from the one asked.

### And ⌘K reached nothing in a task row

**Reported from use, and the fix was not to fake an editor.** Putting links into
tasks is half the reason the link directory exists (ML), and the gesture has to
be the notebook's gesture. But a row is edited in an `<input>`, and the todo
surface honestly reports **no editor handle** — MT3 chose that deliberately: "a
surface that is not text has no selection to wrap, and the honest answer there
is a null handle and greyed menu items rather than a cast that would be a lie"
(D54). So the command reached nothing, the menu item was greyed, and the
accelerator was dead with it.

MT3's answer was right and its premise was too narrow: **a surface that is not
CodeMirror can still hold text.** `EditorHandle` is the wrong shape to ask a
one-line field for — emphasis toggling, scroll-track marks and revealing a
buffer position are all about a document view and mean nothing there. What a
range command actually uses is *is anything selected* and *put this around it*,
which is now `TextTarget`, and which `EditorHandle` satisfies structurally. The
command takes whichever target is present and branches on nothing.

- **A dialog opened from a row is not leaving the row.** The prompt takes the
  focus, and the row's blur handler committed and unmounted it — so the answer
  had nothing left to write into. Blur into a `.prompt` no longer commits, which
  is the same rule that already exempted the row's own controls.
- **The field's value is read through a ref, not closed over.** The target is
  registered once; one holding the first render's value would splice the link
  into whatever the row said before you started typing.
- **⌘B and ⌘I work in a row too**, the same three cases as the notebook's —
  markers outside the selection is the state the first press leaves and
  therefore the one the second press has to recognise. Building it turned the
  field's caret memory into a *range* memory, because a first press that
  collapsed the selection to a caret left the second press nothing to recognise:
  `⌘B ⌘B` produced `**survey******` instead of taking the emphasis off.

### And a rail row was showing its markup

**Reported from a screenshot.** The due-soon rail drew `Review [bio
draft](https://docs.google.com/…)` — the raw line, URL and all, wrapped over
four lines of a narrow gutter.

**It cannot make the link live, and that is the right answer rather than a
limitation.** A rail row is itself a button that scrolls to the item; an anchor
inside a button is invalid markup and a second thing to hit, and the rail's job
is recognising that something is due, not going somewhere. So it shows what the
line *says* — the label, without the target — and following it stays the row's
job. `flattenLinks` joins the shared scanner (ML1) beside `scanLinks`, because
it is a fact about the link grammar and it has two callers already: the rail,
and the row menu's label, which was showing the same markup for the same
reason.

### A defect older than the walk, found by building it

**A hand-written line was losing the day it was written on.** Flow 9's line has
no identity marker; the carry copied it verbatim and `adopt` then minted an id
*in today's file*, so an item that first appeared on Monday claimed a ctime of
Tuesday — D56's "the first day this line appears", quietly wrong for every list
that had ever been hand-edited. The carry now adopts the source day before
reading it, which makes the copy a copy. It is also what lets the walk answer
"which of today's items are yesterday's" at all: the question is an intersection
of ids, and anonymous lines have none.

**Does not do:** the tag index, the cap.

## MT5b — The tag index *(done)*

**Done**, and verified by `npm run m3`. **Half of what this milestone was
planned to be had already been delivered by accident**: MT3 found that the live
tag set needs no index at all — it is the tags on today's items, which are
already on screen — and MT4a came to depend on that. So T6's *offer the live
ones by default* was finished before this started, and what was left is the
sentence after it: **the full set stays reachable.**

- **The corpus answers `todoTags()`: every tag ever put on a task.** A tag whose
  last item was finished in March is in no list on screen, and that is exactly
  the one an index is needed for. *Dormant* is then a subtraction done where
  both halves are known, rather than a third thing to store.
- **And `itemIds()`: every id in the corpus**, which is what D56 always wanted.
  `solution/parts/todo.md` said ids "must be unique across the corpus for
  `tephra:todo/<id>` to resolve without a list name"; MT2 shipped eight base-36
  characters, which is wide enough on its own, and left the check for here.
  Minting is checked against the whole corpus now, which is what makes it
  certain rather than merely likely.
- **Per-tag recency is deliberately absent.** It belongs to Q3a's backlog
  resurfacing, deferred by decision.

**The scan asks the KIND, not the text.** `- [ ] buy paint #house` is a markdown
task list wherever it appears, and `#house` is a tag only inside a task list —
TODO tags are their own namespace (T5), so reading them out of prose would
invent tags nobody wrote. `scanSpans` is left generic for the same reason; the
index branches on `kindOf(file) === 'todo'` and runs the shared grammar.

**Existing caches rebuilt themselves, with no migration code.** `isPayload`
already documented the rule — "a shape it does not recognise is a cache it
throws away, rescanned on the spot" — so requiring the new `items` field is the
whole of the migration.

### What the building found

- **A thunk that is called eagerly is a set.** `adopt` runs on every carry and
  mints on almost none of them, and answering "what ids are taken" means
  sweeping the corpus. The first cut passed a thunk *and then awaited it at the
  top of `adopt`* — so every list fetch paid for a sweep to answer a question
  nobody asked. It resolves on the first mint now, and a test asserts the corpus
  is not asked when nothing is minted.
- **`verify()` built its comparison payload by hand**, so it did not know about
  the new field and reported every file as drifted. Caught by the test that
  exists for exactly that.
- **Two MT3 checks asserted the old rule**, that completion offers live tags
  "and only those". That is deliberately no longer true, and they were updated
  rather than worked around. One of them was fragile in a way worth recording:
  it tied `picked` to `afterTab`, which are two *different* completion lists —
  one matching `#`, one matching `#te` typed later — and only ever passed
  because both happened to hold a single entry.

## MT5c — The soft cap *(in the backlog)*

**Moved out of the ordered plan on 2026-09-08**, to the backlog in
`solution/milestones.md`: a whole feature that v1 can ship without, that nothing
waits on, and whose position is a decision nobody has had to make yet. It comes
forward the day the list is long enough to want it.

The reasoning is unchanged and is recorded there: the number is the only thing
missing, the walk is what produces the evidence for it, and the walk is also
what makes waiting free — T11's promise existed to make a cap safe, so with no
cap there is no promise to keep.

## MT6 — The pivots and the drawer *(done)*

**Done**, and verified by `npm run m3`. Three views over **one question the
corpus can answer and today's list cannot**: what became of the items that
stopped being carried.

**MT5b left status out of the index on purpose, and MT6 put it back** — which is
the shape of the milestone in one sentence. MT5b's question was *which tags
exist*, and status is a fact about today that today's items already answer, so
storing it would have been storing what nobody needed. All three of these ask
about status *somewhere other than today*, which is the half no list on screen
can see.

- **`itemsNow()` — the newest instance, by id.** A carry copies an item forward
  verbatim (D56), so one id appears in as many days as it survived, each holding
  that day's status. The newest is what the item IS, which is the rule
  `tephra:todo/<id>` already resolves by — and the inverse of `tephra:mark`,
  which answers with the first. The day comes from the file's PATH, exactly, so
  it needs no zone and D63 has no opinion to have.
- **The resolved tail (T8), within three days — built, and SUPPRESSED from use
  on 2026-09-10.** `SHOW_RESOLVED` in `Todo.tsx` is one word and it is `false`.
  It read as more list rather than as context, and a list whose foot fills with
  things needing no attention is a list you stop scanning. The three-day window
  below narrowed it and did not fix it.

  **Suppressed rather than removed, because the idea may be wanted again.**
  Everything behind the flag stands: `CorpusIndex.resolvedByTag` (six integration
  tests of its own), the `todo.resolved()` bridge, the fetch beside the list, the
  `Resolved` component and its styling. m3 asserts the *absence* now, because a
  flag nobody verifies is a flag that comes back on by accident — and the window
  rule is still checked in the query behind it, so it cannot rot while the view
  is off.

  **A constant and not a setting, deliberately.** A setting promises that
  somebody wants both answers on different days; this is one answer waiting to
  see whether the other was better. If it turns out to be wanted sometimes, that
  is when it becomes a control — `listView` (MT4a) is the precedent for how that
  goes.

  What it was: what was finished under a tag on an earlier day.
  Not what was finished *today* — that is carried, greyed and on screen (T7),
  and showing it underneath as well would be showing it twice. Not backlogged
  items either: put down is not finished with, and it has its own place.

  **The window was missing from the first cut and was reported the same week.**
  T8 asks for "recently resolved" and what shipped was *resolved* — every task
  ever finished under a tag, forever, which on a year-old list buries the live
  items under a wall of history. A window rather than a count, and the reason is
  the user's: these are FULLY resolved items, so there is no picking one up
  again and no tag that needs reminding what was last done under it months ago.
  The tail is a reminder of recent work; anything older is a question for the
  scrub, which is the history view and answers it exactly.
- **The drawer (T14), counted on the outside.** A backlogged item is not carried
  forward (D55), so it sits in the day it was put down and nothing else on the
  page would show it — which is exactly the graveyard `goal/todo.md` warns
  about. So the count is visible without opening it. **T14 stays knowingly
  unmet** until something *resurfaces* what is in there, which is Q3a.
- **Scrubbing (T7's flow 7), nearly free.** A past working set is not
  reconstructed, it is a file — the property flow 7 was said to constrain the
  format for, and D55 paid for it. One step at a time through the days that
  EXIST rather than a date picker over days that mostly do not, and one way back
  to today.
- **A day that has gone past is READ.** Editing one would be re-dating through
  the side door (D9), so the verbs are *absent* rather than greyed: a control
  that refuses is a control you learn to distrust. The status mark is drawn
  instead of being a button.

### What the building found

- **A cast waiting to throw.** The resolved rows first rendered through
  `prose(item as unknown as TodoItem)` — and `prose` reads `tagSpans`, which a
  resolved item does not carry. It typechecked because the cast said it would.
  The line as written is what those rows want anyway.
- **JSX text does not process escape sequences**, and three of them went in as
  `\u2039`, `\u203a`, `\u00b7`. The same characters inside `{'…'}` are string
  literals and are fine — which is why the drawer's caret rendered and the
  scrub's arrows did not. It reads identically in the source and differs
  entirely on screen; the scene caught it because it clicks by label.


## Four from use, before MT7 *(done)*

- **Print printed the notebook, whatever was on screen.** ⌘P asked the stream
  for its extent unconditionally, so printing from a note printed the notebook —
  a command that reads as *print this* and did not. Only the stream has days to
  choose between, which is why only the stream is asked which ones. The fix
  turned up a type saying the wrong thing: `PrintJob.segment: DateKey` was
  really *which directory relative links resolve from*, which has an answer for
  a day and none for a note. It is a `base` now, and only the two kinds of thing
  that can answer it may.
- **Notes under an item** (D56 amended). Indented continuation lines; nothing in
  them parsed; carried with the item. Recorded on the decision.
- **The list's arrangement is sticky.** MT4a left it unpersisted on purpose and
  named where it would go if that was wrong — "where the theme's selection
  already is, rather than into a second place soft state lives". It was wrong:
  the window stays open all day, so the reset is rare, and a rare surprise is
  worse than a frequent one because you have stopped expecting it.
- **And then the notes cost every row its height.** An element holding an
  invisible control still holds its height, so an item with no note paid for one
  anyway — on a list of twenty that is a page of space between the words, and it
  was reported the same day it shipped. An item with no notes renders **no
  element at all** now, and the affordance on the ones that do is out of the
  flow: a control that appears by growing the block would push the next task
  down as the pointer crossed it, which is the reflow D42 rules out. The way in
  moved to the row's menu, where the acts outside the daily rhythm already live
  (MT3) — and which is the one place that costs the list nothing.
- **A fourth went to the backlog**: snippets, daily and weekly summaries of what
  got done. It needs design before it needs code, and the design turns on where
  a generated summary is allowed to live.

### What the building found

- **An unclosed brace that compiled.** Splicing two functions in after the row's
  `</li>` left `Row` unterminated — so `Notes` and `NoteField` became functions
  *nested inside it*, after its `return`, and a stray `}` further down closed
  it. Perfectly legal JavaScript, dead code, zero type errors. Only reading the
  braces found it; nothing else would have, because the row still rendered.
- **The verbs needed no change at all**, which is the part of the format worth
  keeping: every one of them replaces the item's LINE and nothing else, so notes
  survive a status change, a re-tag and a re-dating without being told to. Only
  two spans had to grow — `end`, so deleting an item takes its notes, and a new
  `blockTo`, so rewriting the notes does not leave the old ones sitting after
  the new.

## MT7 — More than one list: daily and overall todo files *(done)*

**Done**, and verified by `npm run m3`. It reverses D55's "no lightweight second
form"; the amendment is recorded on that decision, along with the reason the
clause was right when it was written and is not now.

**Two shapes, one format.** A `<name>.todo` **directory** is a daily list —
carried, walked, with a working set that turns over. A single
`<name>.todo.md` is an **overall** list: the blog posts you mean to write, which
does not turn over, so the carry has nothing to carry and *today's working set*
is a meaningful idea for the first and a meaningless one for the second.

**`.todo.md`, and the conventions turn out to be one rather than two.** `.todo`
names the kind and `.md` says *this particular thing is a markdown file* —
which is already how `tasks.todo/2026/09/2026-09-08.md` reads. Every prose file
in the corpus ends in `.md`, which is load-bearing for R26/D20: a task list is
exactly the thing you want to read on GitHub or in a phone markdown app, and MT2
chose the `[ ]`/`[x]` glyphs so it would render as checkboxes there. It also
keeps `documentRoot(rel)` answering from the path string, which MT1 deliberately
moved three call sites onto.

**Almost none of it had to be built**, which was the whole bet:

- **An overall list is an ordinary document.** Found in the sidebar, clicked,
  opened in the main window, and drawn by the todo surface because `surfaceFor`
  already routes by kind. No navigation, no sidebar work, nothing.
- **What differs is `keys()`** — `[ONLY_SEGMENT]`, which markdown and fileset
  already answer. The verbs were already key-parameterised.
- **The surface asks the DAYS, not the name.** A list whose keys include the one
  segment has no walk and no scrub, because both are about a list that turns
  over. The surface knows nothing about `.todo` versus `.todo.md`.
- **`todoList()` returns a constant.** It used to return whichever root-level
  `.todo` came first, which with two lists means one silently wins — so
  `tasks.todo` is named the way `notebook.stream` is, and ⌘1 and ⌘⇧T go there.
- **`New Task List…` is the same act as `New File`** with a different kind. A
  daily list is not made this way and could not be: a directory document has no
  single file to create, and its first carry is what brings it into being (D59).

### What the building found

**A day and the one segment naming two segments over one file.** The service
asks every list to work in the writing DAY and does not know the shape — which
is right. But an overall list's `load` ignores the key, so a verb given a date
wrote to the correct FILE under a segment named for a day, and the next read
under `content` loaded a *second* segment from that same file and found it
empty. **The item was on disk and not on screen**, with no error anywhere.

The document normalises the key now, which is where it belongs: the caller
should not have to know the shape, and that was the design's own claim. What
hid it was a test that called `add` with `ONLY_SEGMENT` — testing a call the app
never makes. The test passes a day now, and there is one asserting that any day
and the one segment name the same thing here.


---

## ML — the link directory, which is not part of this

**D57: it is a corpus capability, not a TODO feature**, and it has its own
roadmap in `solution/parts/link-roadmap.md`. It shares exactly one piece of code with
this milestone — the link scanner, which MT3 delivers as ML1 — and nothing else:
D57 already made the TODO link mode a filter over a corpus-wide index rather
than something built here.

**It lands after MT3**, on urgency rather than on any structural driver. The
list is what is needed first; the directory arrives while MT4–MT6 are still
ahead, so anything that wants it has it.

## MT8 — an item is a record, and `for:` says what it is for *(done, D85)*

**Asked from use 2026-09-14**, from a complaint about the by-tag view and a
question that turned out to be underneath it.

### What was actually wrong

A docket-generated item carried **two** tags, the matter and the docket, so it
appeared in the by-tag view twice — and on a real notebook (`~/Tephra`,
2026-09-15) that was 13 items drawn as **18 rows**, with all five `lima` items
doubled. Every hand-typed item carried one tag and appeared once, so the
duplication was entirely the generator's.

**The matter was not a facet; it was context.** *Find the right team* means
nothing without the matter it belongs to — it could be defeating a supervillain
or building an outhouse, and both can be active at once. What the item needs is
what was on screen when the step was written: docket, section, matter. That is
provenance, not vocabulary, and putting it in the tag space is what made it
noise: **tags are the words you think in; the docket path is structure.**

And a matter cannot be a useful grouping anyway. A matter may hold dozens of
steps, but **more than a handful active at once is a sign the matter is badly
organised** — so a matter group is destined to be one or two items, which is a
label wearing a grouping's clothes.

### The three steps

1. **The record and the format** (D85). `text` becomes the sentence; `tags`,
   `due`, `owner`, `for`, `reason`, `moved`, `notes` are fields; the file holds
   them as field lines under the checkbox. `spellItem` writes, a lenient
   `parseItem` reads both the field form and the quick form.
   - **The gate is the round-trip**, one way: structure → string → structure is
     the identity, proven over generated records and over every day file in the
     developer notebook.
   - **No behaviour change.** Same information, new shape — which is what makes
     the round-trip the whole test.
   - Deletes `tagSpans`, `dueSpan`, `ownerSpan`, `movedSpan`, `withoutMarks`,
     and the marker arithmetic in every verb that changes one.

2. **`for:`, and the matter tag goes.** The generator composes a record rather
   than joining a string, and fills `for` with the context — matter, and the
   section when it adds something. The row draws it trailing and muted beside the
   text, not in the chip cluster. **Reconciliation repairs it** (D77): the docket
   owns the truth, the step knows its item, and a rename or a move makes the
   annotation stale today with nothing to fix it.
   - **The rule that keeps repair safe: the sentence is yours, the markers are
     the docket's.** A pass may rewrite the fields of a generated item and must
     never touch its text.
   - The original complaint dies here: a generated item has **one** tag, so it
     appears once, and the by-tag view needs no home-tag rule at all.

3. **The panel**, over the record — the docket's matter panel one kind over.
   Quick entry stays: the add row accepts the full grammar and translates
   immediately into fields, because jotting a task somewhere without the list's
   UI is the case that matters more later, not less.

### The migration is a disposable script

Not a button. `migrate-items.mjs`: for each task list, for each day, **read and
write** — which is the whole of it, because leniency already parses the old form.
It saves a version first (D32's `saveVersionNamed`, so the way back is a
restore), it is idempotent, and it reports counts per day. Deleted once the
notebook is converted; its one real transform — a matter-named tag becoming
`for:` — belongs to reconciliation, where it goes on being exercised.

### What building it taught

- **The line was load-bearing in a place nobody had listed.** There were no wire
  verbs for `due`, `tag`, `untag` or `owner` — the row changed them by rewriting
  the item's *text*, because the line was authoritative. Once the text held only
  the sentence, setting a field still worked (the entry grammar reads `DUE
  friday`) and **clearing one silently stopped working**, because omission must
  not mean deletion or editing a sentence would drop every field. Four verbs, and
  the gestures that use them: a tag comes off at its chip, a date and an owner at
  the row's menu.
- **The tests could not have caught that**, and did not: they call
  `doc.setDue(id, null)` directly, so there was no channel to notice was missing.
  The acceptance suite could have, and now does — seven checks that drive the
  chip and the menu from outside.
- **`Tasks.make(record)` beside `Tasks.add(string)`.** The reconciler knows every
  field for certain, so composing a string for the entry grammar to take apart
  again was two chances to be wrong.
- **The screenshot was the only instrument that saw the last two faults**, which
  is the third time this project has recorded that. The annotation was rendered
  at `.8em` of 20px prose — nearly as loud as the task's own words — and giving it
  `white-space: nowrap` to stop the row wrapping made the *sentence* break
  mid-phrase instead (*Approve Paola's / proposal*), which is exactly the wrong
  thing to protect. It is `--row-note`, like the owner beside it, and it yields
  first.
- **And the geometry checks earned their keep**: `font: inherit` on the new chip
  button set it to the prose size, caught by the check that measures a tag
  against a due date, which share one size on purpose.
- **A section earns its place by distinguishing something**, so it is in the
  annotation only when the docket has more than one. Written after a real
  notebook read *House Bootstrap / Initiate Remodel* on every row — where that
  docket does have a second section (Travel), so the rule holds and simply does
  not shorten this notebook.

### Measured on the real notebook

Migrated a copy of `~/Tephra` (200 items, one `--write`), opened it, and looked:
`LIMA` is **one group of 5** where it had been `Initiate Remodel` (2) +
`Transfer utilities` (3) + `lima` (5) — ten rows for five items. Reconciliation
converted the generated items in place, in two rounds, with no separate migration
code for it.

### What is NOT in MT8

- **A home tag for hand-typed items.** "First tag wins" was the other candidate
  and step 2 makes it unnecessary for generated items. Left until a hand-typed
  item with two tags actually annoys somebody.
- **Grouping by `for:`.** Possible later and cheap, because the value is in the
  file — but the matter is not a grouping worth having, which is the finding
  above.
- **Making `for:` a link.** `AgendaService.matterFor` already answers it; a
  clickable annotation is a separate, small pleasure.

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
