# Build milestones

Where the code is, and what comes next. **The feature list this draws on is
`features.md`; the staging rationale is `components.md`.** This file only says
what has been built and in what order the rest arrives — it invents no scope.

Milestones are *slices*, not feature groups. Each one is a path through W, X and
Z that works end to end, because a layer built alone is a layer whose interface
has never been tested.

---

## M0 — the slice ✅

**Purpose: falsify the API shapes before building on them.** One path through
every layer, implemented naively, so that a wrong interface is discovered while
it is cheap to change.

Open today, type, autosave, quit, reopen and find everything where it was. It
does that, verified by `npm run m0`, which launches the app twice against one
notebook and reads the files on disk rather than the app's internals.

**In:** the notebook directory and atomic writes; the day-file format with
frontmatter spliced rather than serialised; markdown-aware span scanning;
Document with generation, batched replace and document-scoped undo; the
main/renderer split with a synchronous coordinate facade; CodeMirror with the
widget layer, vim as a setting, and rendered constructs that unrender under the
cursor; Pane with back/forward and explicit extend; position restored across a
restart; external edits adopted, and divergence surfaced rather than resolved.

**Out, and deliberately so:** everything below. `untag`, `removeAnchor`,
`branch` and non-date navigation targets throw rather than pretend.

**Known gaps inside M0's own scope:** the non-vim keymap is CodeMirror's
defaults rather than a designed one (D15 asks for designed, since it is what
mobile always runs), and typography is fixed rather than tunable (R1.3).

## MV — the visual system ✅

Brought forward ahead of M1, and the design's own words argue for it:
`components.md` names exactly two things expensive to change later, and one of
them is "the editing surface plus visual system, because they decide whether the
thing gets used at all." The earlier ordering had it near-last.

- ✅ A **theme system** — named parameter sets in `config/themes/`, active theme
  per device (D41). The four proof-sheet arrangements ship as built-ins, with
  live controls under View ▸ Typography (⌘⌥T) so the measure is settled by
  reading rather than by argument. Default is Aldine at 54ch
- The **annotation gutter reserved in every theme**, so marginal notes can
  arrive later without reflowing a line. This is the part that cannot wait —
  and R27/R28 raised its stakes: the margin is a second column of *text*, sized
  and toned to be read, not a faint aside. The proof sheets were corrected once
  already for exactly this
- ✅ **Per-script size adjustment**, Hebrew first (D41) — runtime `@font-face`
  with `unicode-range` and `size-adjust`, face and scale as theme parameters
- The **left nav**: sections as expandos, pins first (D10). Filesets arrive in
  M3, so it opens with dates, which are v1 anyway (R9)
- ✅ A **fixed frame** (D42): Reserved nav, a fixed measure with the slack to its
  right, and the capture stream as an overlay pinned to the right edge. Measured
  in the app at five widths, toggling both — nothing moves, nothing narrows
- ✅ Somewhere non-modal for **format anomalies** to surface — a quiet count in
  the titlebar opening a panel of what the degradation table did and why

**Accepted risk:** the corpus is not yet safe — no split, no WAL, no git. Fine
while testing against `./run.sh --scratch`, and not fine for real writing.

## M1 — the corpus becomes safe ✅

Everything that stands between "it writes files" and "it will not lose twenty
years of them." Nothing above this is worth building first. Safety in three time
bands: **seconds** (the WAL), **minutes** (file writes, done in M0), **forever**
(git).

### The order, and why it is not the obvious one

The obvious order starts with the split. This one starts with git, for two
reasons.

**The split is the only surgery in M1.** It changes how a day maps to files, and
a prefix-stability mistake manufactures divergence out of nothing. Doing the
dangerous thing before the safety net exists is backwards.

**And D34 says the library choice needs verifying before it is committed to** —
it flags library health as where its own analysis is least reliable. If
`isomorphic-git` is unmaintained or broken under Electron, that changes M1's
shape, and the time to find out is the first hour rather than after the split
and the WAL have been built on the assumption.

### The checklist

1. ✅ **Verify `isomorphic-git`.** init, add, commit, log, read a blob, checkout —
   in the real Electron main process, against a scratch repository. **The
   acceptance test is D34's: standard `git` must be able to read it.** A
   repository only Tephra can read defeats the entire reason git was chosen.
2. ✅ **The version tier.** Repository at the notebook root. Commits on ~5 min
   quiescence **or** every 30 min **or** session end (D32). `.tephra/` stays
   ignored — the bootstrap `.gitignore` already does this; `config/` is
   committed, because a theme somebody crafted is authored work (D41).
3. ✅ **History as its own X object.** Document stops owning durable history;
   `Document.undo` and `rewindTo` stay volatile and session-scoped (D32).
   **v1 scope: browse and copy out** — list commits, view a file at a version,
   lift text by hand. It is the smallest thing that makes the history real, and
   it never writes, so it cannot itself lose anything.
   `History.restore(version, doc, span?)` lands in **M2**, where spans already
   exist as a first-class idea.
4. ✅ **Day-file split at 1 MB.** Prefix-stable, at the last paragraph boundary at
   or before the threshold; parts coalesce into one date span above the storage
   layer (D20), so the split stays invisible to the API. **With a forced test
   using a synthetic oversized day** — at ~100 KB a day this will essentially
   never fire on its own, and a path that fires once every few years is broken
   when it fires.
5. ✅ **The WAL.** Changes since the last file write, batched at ~50 ms, at the
   `.tephra/wal` path already reserved in `layout.ts`. Closes the seconds-wide
   window that the file tier leaves open.
6. ✅ **The purge procedure.** Documented, not a button (T10, D36) —
   `purge-procedure.md`. Every command in it was run against a scratch notebook
   carrying the target text in both a day file and a version reason.
7. ✅ **`npm run m1`.** The acceptance run: four real launches, one deliberate
   crash, 18 assertions made against the files and the git repository on disk
   rather than against the app's account of itself.

### Two choices made up front

**Commit messages quote the first line of what changed.** Chosen for recall —
finding a lost paragraph a year later is the job, and a timestamp does not help
with it.

> **This makes the purge procedure larger, and item 6 must say so.** Deleted text
> now lives in the repository forever (D32 already established that). With
> content in commit messages it lives in **two** places per commit, so a purge
> is a rewrite of messages as well as blobs. Better known while writing the
> procedure than discovered while running it.

**Restore is read-only in v1.** See item 3.

## M2 — range operations ✅

Select a range, then do something with it. Requirements 11–14 are one gesture
wearing four hats — six, since R27 and R28 joined — and selection is the core
interaction primitive.

### The order, and what blocks what

**The gesture comes first, and it is not an operation.** Six features each
inventing their own affordance is six chances to be inconsistent, so the command
set is defined ONCE and rendered three ways: the menu bar with accelerators
(primary), the keyboard, and a context menu on the selection. One definition, or
the two menus disagree the first time either gains an item.

**Items 5 and 6 are blocked on Q8 and Q9** — where a comment's body lives, and
whether an imported document stays pristine, which largely follows from it. They
are answered *after* the marker machinery exists, so the question is concrete
rather than theoretical. The phone study already narrowed them: **"apart" was
rejected**, so whatever keeps an imported document pristine cannot do it by
putting the commentary somewhere else to look at.

### The checklist

1. ✅ **The gesture.** One command set, three ways in. Proven end to end by wiring
   **bookmark** through it — the degenerate range, a point, and the least that
   can go wrong while exercising the whole marker-writing path.
2. ✅ **Tag a range with a subject; untag.** The same machinery over real ranges.
   Subjects overlap freely (R12). Written as interval arithmetic rather than as
   four cases — merge, extend, split, trim are one code path, so alternation
   holds by construction — and `tagBody` returns a body rather than a batch of
   edits, because an insertion's position depends on text the deletions remove.
3. ✅ **Branch a range into its own file.** ONE X operation — create → update
   references → delete, **in that order**, because the ordering is the only
   safety mechanism available without a cross-object transaction (D13). The
   reference-updating step is present and empty, and says so: sections are the
   finite set a branch must rewrite and they arrive in M3, but its POSITION in
   the sequence is the part worth fixing now. The link left behind renders as its
   own words and opens the file, since it is v1's only path back. Finding a
   branched file independently is still v2.
4. ✅ **Print a range.** Spike B's division held: the web layer renders markdown
   to HTML and the shell contributes a window. It renders from the editor's OWN
   parser rather than a second markdown library, so paper and screen cannot
   disagree about what is bold. Math goes to MathML rather than KaTeX's HTML,
   because a print document has to be self-contained and KaTeX's output needs a
   stylesheet and sixty font files. Shown as a PDF in Chromium's viewer, which
   restores the preview the spike found missing beside the native panel.
5. ✅ **Settle Q8 and Q9.** Both closed by **D47** — Q8 answered (inline, visible
   markdown body), Q9 dissolved (the pristine artifact is the original file, not
   the conversion). **They no longer block 6 and 7.**
6. ✅ **Comment on a range, rendered in the reserved margin** (R27). MV reserved
   the space; this fills it, and because the gutter is padding rather than a
   track, notes arrive without moving a line. Mostly reuse, as predicted:
   `partnerRemovals()`, `ProseMap.carve()` and the mark all applied unchanged.
   **The open question inside this item closed rather than being settled by
   experiment** — the body is not in the buffer at all (D47), so there is no
   revealing to choose between, and it is edited where it is rendered.
7. ✅ **Import clipboard text to annotate** (R28). Per D47 the original is stored
   untouched and a copy is annotated — so there is no import-shaped object in
   the system and every gesture works on it unchanged. **Rich content is
   converted to markdown** rather than flattened, in the renderer, where
   Chromium's parser already is; ⌘V converts too, since a pasted article whose
   structure has been discarded is not the same words. `.docx` follows;
   `.pdf` is v2.
8. ✅ **`History.restore`**, deferred here from M1. Whole documents only, and it
   truncates the undo stack (`history-api.ts`). A restore is written as the
   present and committed at once, so it is itself a version and **nothing is
   rewritten** — which is what makes the way back from a bad restore another
   restore. A day that did not exist at that version is removed rather than
   emptied.
9. ✅ **`npm run m2`.** The acceptance run: six real launches, every assertion
   made against the files on disk or against what the running renderer reported
   seeing. It exists because `npm test` could not have caught this milestone's
   worst three faults — a segment cache race, growth handing the editor raw
   bytes, and a span mislabelled by a fallthrough default were all invisible to
   the unit and integration suites and all obvious the moment a window was open.


## MC — documents, kinds and windows ✅

**Inserted into M3, and its own milestone** (D54, `document-roadmap.md`): the
Document API grows kinds, the `Corpus` becomes X's file system, and windows
become views of documents. M3's remaining bullets all open or write documents,
so they resume on top of it rather than being built twice.

Seven phases plus two the work itself asked for, all verified by `npm run m3`
and the suites below it. What changed, in one line each:

- **MC1–MC2** — kinds, and the `Corpus`: a document table with scoped borrowing,
  an LRU that never evicts what is dirty or watched, and the write tiers made
  corpus-wide rather than one document's.
- **MC3** — `SegmentedDocument` as the base every kind stands on, the index moved
  INSIDE the floor (it scans bytes, which is what it is for), and the invariant
  stack asserted by `layering.test.ts` instead of remembered.
- **MC4** — the fileset kind, so a pin is a `replace` on a span: undoable,
  journalled, versioned, and visible to a window with the same file open — four
  things D53 claimed and none of which were true while pinning wrote files.
- **MC5** — the renderer learns about kinds. One handle per document, a pane that
  crosses documents, and a surface chosen by kind. `Reference{kind:'file'}`
  resolves for the first time.
- **MC5½** — *(unplanned)* the surface became a whole VIEW rather than a
  configured editor: `bind.ts` and everything CodeMirror moved under the markdown
  kind, and the registry answers with a component. **A boolean varies a view; a
  file replaces one.**
- **MC6** — `AppWindow`: the session is a SET of windows, restored where they
  were, with the File menu that makes a second one reachable.
- **MC6½** — *(unplanned)* files from outside the notebook open read-only, with a
  badge that states the constraint and IS the import gesture.
- **MC7** — restore through the Corpus. A version is corpus-wide, so a restore is
  too; every document goes back through the open one, so a restore cannot be
  undone by a buffer that outlived it.

## M3 — navigation and filesets ✅

**Done**, and verified by `npm run m3`: printing, the sidebar, curated sections,
pinning, opening a document that is not the stream, windows across a quit, a
file from outside the notebook, and theme management. What remains under this
heading is deliberately deferred rather than unfinished — see the two notes
after the list.

- ✅ **Print the whole document**, on `Cmd+P` where every other application puts
  it. For an ordinary document that is all of it; **for the stream it cannot
  be** — "the whole document" is twenty years of days — so it needs a chooser,
  and a date range is the natural axis since dates are how the stream is
  organised (D8). Deferred here rather than built with M2.4 because it is a
  navigation question wearing a printing hat: the same range-of-days idea the
  nav needs. The accelerator was freed in M2 so the habit never forms wrong —
  printing a range is `Cmd+Shift+P`.
- ✅ **Section/fileset index format, and the left nav of expandos** (D10). The
  format is `shared/fileset.ts`, read by both processes because a fileset is a
  document and the renderer meets one in the editor.
- ✅ **The default section, holding the pins, always present.** Named `Pinned`
  for what it holds rather than for its category — the top level orders the
  groups, and this is a group.
- ✅ **Jump to a bookmark, a file, a URL, an external document by OS intent.**
  The file case was the one that had never worked: it needed documents other
  than the stream (MC5) *and* the discovery that a link resolves relative to the
  document it is written in, without which every correct relative link reported
  itself as missing.
- ✅ **Pinned lists, which are markdown files rather than features** (R18, R19).
  A fileset IS the list, so there is nothing else to build. **An events calendar
  is a markdown file somebody keeps** and needs nothing from the app beyond
  being findable, which the directory sections below now make true.
- ✅ **A section per directory**, so a document that arrives — imported,
  branched, or dropped in by hand — can be found without anyone pinning it.
  Derived from what is on disk rather than written, and curated by the same
  `_index.fileset.md` rule as everywhere else: the order orders, it does not
  gate.
- ✅ **`Now`**, the one row that is not a set of places: the end of the stream,
  where the next sentence goes. Not a fileset entry, because it is not a date —
  pinning today's date would be wrong tomorrow.
- ✅ **Themes gain colour, and the chrome gets designed.** The first two parts
  had quietly already happened: a theme authors six palette colours, and there
  are four on disk including a real dark one (`night`). What was left was that
  the chrome had never been DESIGNED — the editor had typographic care and the
  furniture around it did not, which is the contrast a reader actually sees.

  The pass, and what each part was fixing:

  - **The chrome is a surface, not a tint of the page.** `--surface-panel` and
    `--border-strong` are derived from the authored paper and ink, so every
    theme gets them at once and a dark theme gets a lighter panel without
    anyone writing it twice.
  - **Hierarchy in the title bar.** Everything in it was 12px at one weight, so
    the loudest element was whichever happened to have a background — the
    Sections toggle — and the subject of the window was the quietest thing in
    its own title bar. The location leads now, marked with the accent; the
    controls recede; a pressed toggle says "on" in the accent instead of
    carrying a permanent grey fill.
  - **The accent is a language, at two strengths.** Hover and active are the
    same tint; a grey hover on a grey panel says only "something happened".
  - **One date convention.** The bar wrote `2026-08-31` while the panel and the
    footer beside it wrote `29 Aug` — the same app, the same moment, two ways
    of saying a date. `dayLabel` in `shared/dates.ts` is now the only one, and
    it adds the year exactly when the year is not the current one.
  - **The title follows the CARET, not the location.** They disagree the moment
    you scroll back: the location stays `today` while you read into last week,
    and the bar went on claiming today with the footer correctly saying
    otherwise, two feet away.
  - **Scrollbars are themed** — on the dark ground the default was a bright
    white bar down the edge of the page, the most visible element on screen and
    belonging to none of it.
  - **A stale line removed**: the panel said "Filesets and pinned sections are
    next" while filesets and pinned sections were listed directly above it.
  - **Theme management is a panel, not a typography sheet.** It was
    `View ▸ Typography…`: the wrong menu, a name for one of the things it held
    rather than for the thing itself, and — worst — it could reach the type and
    nothing else. The palette needed a text editor, and the chrome's own ground
    could not be changed at all, because it was mixed in code. **A control panel
    that reaches half of what it names is worse than none: it teaches you the
    other half is not adjustable.** It is `Settings…` on `⌘,` now, and it holds
    the name, the note, all seven colours, the tag depth and lightness with the
    eight hues shown live beneath them, the face, and Duplicate and Delete.
  - **`panel` is an authored colour** (`ThemePalette`), so the sidebar's ground
    is a decision somebody makes rather than paper mixed toward ink by a
    constant. The four built-ins each choose their own, and the strong edge is
    mixed from the panel rather than the paper, so a chosen panel takes its own
    border with it.
  - **Derived ONCE, when a theme is read** — not on every paint. A file written
    before the field existed is given a panel from its own paper and ink at
    parse time, so everything downstream sees an ordinary colour and needs to
    know nothing: the painter, the swatch, and any duplicate made from it. An
    "empty means derive it later" would have had to be understood by all three
    forever, and a duplicate would have carried a blank field, to save writing
    six characters once.
  - **And seeding tops up a key a file never had an opinion about.** Seeding is
    non-destructive by rule — finding your edit silently restored teaches you
    never to trust the directory again — but a file written before `panel`
    existed does not DISAGREE about it. Filling in an absent key adds what its
    author never chose and never touches what they did; without it, every
    notebook that ran an older Tephra keeps the derived grey for a value the
    built-in now chooses deliberately, which is the whole complaint.
  - **The chrome has its own text colour** (`panelInk`), because the ink is
    chosen against the PAPER. A panel much darker than the page — which is the
    whole reason `panel` is authorable — leaves the sidebar's words set in a
    colour picked for a surface they are no longer on, and the darker the panel
    the worse it gets, until the chrome is unreadable while the text beside it
    is perfect. One authored colour, with the heading, body and quiet tiers
    mixed from it TOWARD the panel, so all three hold their relationship to
    each other and to whatever ground they are on.
  - **A newline continues a paragraph, and the spacing says so.** Four knobs
    had grown around one confusion: whether the editor shows a RAW markdown file
    or a RENDERED one. `leading` and a gap-per-source-line were editor-model
    quantities; a paragraph's trailing space and a blank line's height were
    markdown-model ones, and for blank-separated paragraphs the last two added
    into a single visible gap, so neither number meant anything alone.

    **The ambiguity had already produced a defect.** Print runs the text through
    a markdown parser, so three consecutive lines became one `<p>` whose
    newlines HTML collapses to spaces: on screen they were three lines, on paper
    one flowing paragraph. The question had been answered twice, differently, by
    two halves of the app.

    Settled toward markdown. Consecutive lines are one paragraph, spaced by
    `leading` and nothing else; the blank line IS the gap between paragraphs and
    is the only control for it. Two knobs, one job each, and paper now agrees
    with the screen about structure. Each built-in's gap was set to what its two
    numbers used to sum to, so the model got simpler and nothing moved.

  - **Justified or ragged, as a switch.** There is no right answer: a justified
    column is the book page this app takes its margins from, ragged right is
    easier on a screen and never opens a river of white down a paragraph, and
    which wins depends on the measure, the face and the reader — all three
    already theirs to set. Hyphenation travels with justification rather than
    being a second switch, because unhyphenated justified text at a reading
    measure is what gives justification its bad name.

    **Paper follows it**, which is the one thing paper takes from the theme.
    Print does not inherit a theme by design — its colour, measure and margins
    belong to the medium — but justification is a preference about how a column
    is set rather than a property of paper, and a screen flush on both edges
    beside paper running ragged would be one document arriving two ways.

    A wrapped line's LAST row stays ragged, which is correct for the last line
    of a block and unavoidable here: forcing it would stretch every short
    line-per-thought line across the full measure. So this pays off most on
    imported markdown with real paragraphs, and does little on a day written a
    thought per line.

    **What this cannot do is REFLOW.** Each source line is its own block in the
    editing surface, so the words still break where they were typed rather than
    at the measure. Structure follows markdown; wrapping waits for the rendered
    editing surface (M5), which is where "raw or rendered" stops being a
    question at all.
  - **A built-in cannot be deleted, and the button says so.** Seeding writes any
    built-in whose file is missing, so deleting one would delete it until the
    next launch and then quietly bring it back — a control that appears to work
    and does not. Duplicate it and edit the copy; the copy IS deletable.
  - **The menus grouped by what an act does to your notebook** — go somewhere,
    another view, bring something in, put something out, close — which is the
    only grouping a reader can predict. It was an accumulation until MC6 gave
    the File menu enough commands for the arrangement to matter.
**The `todo` kind was here, and went back to the backlog.** It was added as a
cheap test of the four-artifacts shape — a kind ought to be *adding files* after
MC5½ — and reading the record back, that framing was wrong twice.

**It is a v3 promotion, gated on evidence nobody has collected.** v1 runs the
plain-file stand-in deliberately, so that promotion answers a recorded failure
(D4, D6, `feature-backlog.md`): items lost, deadlines missed, scanning cost. And
the reason to build it at all is R16 — *ranking by urgency so the eye never has
to scan* — not checkboxes. Era 2 HAD due dates, hand-drawn; they failed by
scale, which storing them again would not fix.

**And it would not have been a cheap test of the shape.** `file-documents.md`
already predicts todo as **record-shaped** — "an edit is a field, and history is
per item" — which is precisely the case the four artifacts do not cover: no
character spans, no `SegmentedDocument`, history per item rather than per
segment. A genuinely interesting test, and a milestone rather than a bullet.

Whatever tests the shape first should be a kind that is still TEXT.

**Deferred within M3, deliberately.** Section reordering and deletion — which
need `tephra:builtin/*` sentinels so the built-in sections can be positioned
among the curated ones — and a `Pin to…` chooser, for which
`DocumentService.documents()` already exists. Also **making the sidebar
focusable**, which is what would finally put a key on a fileset's undo: ⌘Z goes
to the focused document, and while the editor is the only focusable surface, the
stream is the honest answer (MC4).

## M4 — retrieval

Marked ◆ in `features.md` as arguable, and settled as **the last things built in
v1**: in scope, after the core works.

- Literal substring search over the corpus
- Filtered views by tag and by date range — one mechanism, three query shapes
- Image paste writing a file and inserting a link (R7)

## M5 — the editing surface finished

- A non-vim keymap, deliberately designed rather than inherited (D15)
- Typography and the visual system, tunable (R1.3)
- Rendered editing of inline constructs (◆ in `features.md`)

## M6 — the shreddable notebook

**Design: `shreddable-notebook.md`. Decision: D46.** A second notebook, opened by
the same app, whose storage makes deletion real: per-file encryption with
destroyable keys, no history, no WAL, no sync.

- Multi-notebook: read `tephra.json`, choose storage from it
- The encrypting `Notebook` wrapper at the bottom of W, and a null `Repository`
- Key hierarchy — Secure Enclave master, per-file data keys, rotate on shred
- Opaque object names and the encrypted index
- The shred operation, and `tephra export`
- **Explicit `<!--tephra:split-->`**, which also serves the primary notebook
- Its own theme, so the two notebooks are never mistaken for each other
- The three verification tests, including restore-from-backup

**Placed last by choice, not by dependency.** It touches only the bottom of W
plus a config file and a theme, so nothing above it changes and nothing else in
the plan waits on it — it could move earlier or later, or slip past v2, at no
cost to anything else.

**Checked against the deferral rule** (`goal/scope.md`: *data cannot be
backfilled; mechanisms can be deferred*): this defers cleanly. The notebook is a
new directory with its own storage, so it needs nothing recorded in the primary
corpus beforehand, and the one format addition — the explicit split marker —
applies to files that will not exist until it does. **No coverage obligation
falls on M0–M5.**

**The interim policy is unchanged:** material that must be genuinely deletable
goes to paper or the typewriter until this exists. M6 does not open a gap; it
closes one that is open today.

---

**Done, immediately after MV:** the mobile proof sheet (Q10), judged on a Pixel 9.
20px and ~35ch, the Aldine face and palette carrying over unchanged, commentary
as a marker with an open-all control, controls at the bottom — and the keyboard
behaving: the caret slides and nothing hides behind it. Original note: The
frame decision D42 is desktop-only by construction, and the mobile questions —
what replaces the margin, capture or reading, and what the keyboard does to both
— are recorded now so they keep their edge while MV is built.

## After v1

`components.md` has the reasoning; in short: **v2a** is sync alone, **v2b** is
Android, **v3** promotes what earned it. The order matters — sync must land
first because the phone needs a corpus for any judgement about it to mean
anything, and the two risks should not arrive together.

## Finding your way around the code

`architecture-as-built.md` is the map: the W/X/Z layers as modules, a diagram of
how a keystroke reaches the disk, and a table saying which file holds each
contract between the layers.

## Running it

`app/run.sh` is the wrapper, and `app/Tephra.command` is the same thing made
double-clickable from Finder.

```
./run.sh              the real notebook at ~/Tephra
./run.sh --scratch    a throwaway notebook, for testing
./run.sh --root PATH  a specific one
./run.sh --dev        renderer HMR; a dev-only exception to D17
```

It rebuilds when anything under `src/` is newer than the built main process, so
"did I remember to build?" stops being a question. It also unsets
`ELECTRON_RUN_AS_NODE`, which is set in some shells and makes `require('electron')`
return a path string — the app then dies at startup with an error naming none of
that, and it has cost an afternoon once already.

```
npm run test:full     typecheck, unit and integration, then m0–m3
npm run install:app   package, then replace /Applications/Tephra.app
```

**Not `npm run install`.** A script called `install` is an npm LIFECYCLE hook: it
would run on every `npm install`, so adding a dependency would package the app
and overwrite the one in /Applications. The colon is what keeps it a command you
ask for.

`install:app` refuses while Tephra is running — replacing a running bundle works
until the app reaches for a resource that moved, and then dies somewhere
unrelated — and it REMOVES the old bundle rather than copying over it, since
`cp -R` onto an existing `.app` copies *into* it and leaves stale resources
inside a signed bundle. `--force` is there for when you know better.

**Packaging exists**: `npm run package` builds `dist/Tephra-darwin-arm64/Tephra.app`
with `@electron/packager` — a `.app` and nothing else, because one person on one
machine needs no installer, no auto-update and no DMG.

Ad-hoc signed, which on Apple Silicon is required rather than optional: arm64
macOS refuses to execute a binary whose signature does not match its bundle, and
packaging invalidates the one Electron ships with. Developer ID and notarization
are still deliberately not done — they matter only for apps other people
download.

**The icon is a placeholder.** The wiring is what matters: dropping a different
`design/icon/Tephra.icns` at that path is the whole of replacing it.

`run.sh` and `Tephra.command` remain for development; the packaged app is for
use. The `CFBundleName` patch in `run.sh` is now only needed by the dev path,
since a real bundle carries its own name.

## How to know what to test

Test M0's list above. Anything in M1 and beyond is absent, and absence is not a
bug. The one thing worth re-checking after every milestone is the acceptance
run — `npm run m0` — because it asserts the property the whole project rests
on: that nothing written is ever lost.
