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

**Known gaps inside M0's own scope:** the keymap is CodeMirror's defaults rather
than a designed one, and typography is fixed rather than tunable (R1.3).

*Read as history: M0 shipped vim as a setting, which is what D15 asked for at the
time. D67 removed it in 2026-09, so the first gap is now about the only keymap
there is; the second was closed by the theme work.*

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

**Accepted risk, at the time:** the corpus was not yet safe — no split, no WAL,
no git. Fine while testing against `./run.sh --scratch`, and not fine for real
writing. **Closed by M1**, immediately after.

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
- ✅ **Emphasis on ⌘B and ⌘I**, in the Edit menu — emphasis is editing, the same
  kind of act as cut and paste. Built from `RANGE_COMMANDS` like every other
  command, so the context menu shows it without a second list to maintain, and
  it is the first command in the set that needs only a CARET: with nothing
  selected it opens the markers and waits between them, which is how a person
  types a bold word they have not written yet. A TOGGLE, because the second
  press is somebody changing their mind and `****` reads as broken.

  **⌘I had to be taken back from CodeMirror**, whose default keymap binds it to
  `selectParentSyntax` — in a prose document, that selects a paragraph out from
  under you. Dropped by KEY rather than by identity, so a future CodeMirror that
  rebinds the same key to something else is caught too.
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
  - **A wrapped bullet hangs under its own text.** A second line running back to
    the page margin puts it under the marker, where it reads as a new item
    rather than as the rest of this one — the shape of a list lost at the point
    a reader most needs it. A negative `text-indent` against an equal
    `padding-left`, per line, because the width depends on the item: `- ` and
    `1. ` differ, and a nested item carries its own indentation as well.

    **Measured in pixels, in the face the line is actually set in.** `ch` is the
    width of a zero, and in a serif `- ` is narrower than that — near enough to
    look like an alignment somebody tried and failed at, which is worse than not
    trying. Measured on what is DISPLAYED rather than what is stored, since a
    bullet is wider than a hyphen.

    **The marker is drawn as `•` over the hyphen the file keeps**, and the space
    after it belongs to the marker rather than to the sentence. Leaving that
    space in the text made an item's text begin with a space, which renders — it
    still aligned, because the hang counted the space too, but nobody reading
    the DOM could tell that, and it cost a wrong measurement in a test before it
    cost anything else. Not revealed under the caret, unlike a heading's `##`: a
    `##` says what level you are editing and a `-` says nothing the bullet does
    not, so revealing it would only make the line twitch as the caret passed.

    A list also gets **two leading controls, because they are two questions**:
    how tight the lines of one item are, and how far apart two items sit.
  - **Code has typography of its own, and a parser.** Neither existed: the mono
    face was a constant in `index.css` — unreachable by any theme, the same
    shape as the panel colour — and a fenced block parsed as a single `CodeText`
    node whatever its info string said, so ```python was styled exactly as ```.

    A theme now authors `codeFace`, `codeSize` (a RATIO of the body size, since
    a monospaced face reads larger at the same nominal size and should stay a
    little smaller when the body moves), `codeLeading`, `codeMeasure` and
    `codeIndent`. `codeLanguages` from `@codemirror/language-data` makes a fence
    its language — one lazy dependency instead of ten hand-picked grammars.

    **A code block reaches its own measure, past the prose column.** Code is
    written to eighty columns and wrapping it at sixty destroys the one thing
    its layout carries: a wrapped Python line looks like an indent that is not
    there. It still wraps past that width, because a line you cannot see is a
    line you will forget to read.

    **Colour is restrained and comes from the theme's existing palette** —
    comments quiet and italic, keywords and strings on the accent at two
    strengths, everything else ink. It works on themes nobody has written yet
    and adds nothing to the six decisions a theme already asks for. A fuller
    syntax palette stays open.

    And paper takes the code face too. Screen and paper had two different
    monospaced stacks for the same code, which is the third time that exact
    disagreement has turned up — after the date formats and justification.
  - **A built-in cannot be deleted, and the button says so.** Seeding writes any
    built-in whose file is missing, so deleting one would delete it until the
    next launch and then quietly bring it back — a control that appears to work
    and does not. Duplicate it and edit the copy; the copy IS deletable.
  - **The menu bar is File / Edit / Insert / View / Window**, grouped by what an
    act does rather than by what it acts on. `Insert` holds everything that puts
    something INTO the text — a bookmark, a subject, a link, a note in the
    margin; the acts that make or print a FILE are in File, even though they
    start from a selection too. Emphasis is in Edit, because it is the same kind
    of act as cut and paste.

    **Most of the Window menu is the system's, and should be.** macOS adds Cycle
    Through Windows, the Move & Resize submenu and an entry per open window to
    whichever menu is registered as the Window menu; hand-rolling those would be
    worse versions of what the platform does, and they would stop matching every
    other application on the machine. What is ours is the two ways to get a
    window in the first place. Minimize keeps its item and loses ⌘M — a Window
    menu without Minimize is a broken macOS application, but that key is a daily
    hazard for someone who does not want it.

    **Four items are present and disabled**: New File, Save a Copy, Rename and
    Delete. They need a file lifecycle Tephra does not have yet, and a disabled
    item is a promise where an item that does nothing is a bug report — the same
    rule `built: false` already applies to commands. `Image…` is disabled for a
    different reason: it is R7, scheduled with retrieval in M4.

    **`Save a Copy`, not `Save As`.** Nothing here is ever unsaved, so "save it
    somewhere else" does not name an act this app has, and `Save As` would imply
    the original was in some sense not saved until you did it.
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

> **Both reasons fell on 2026-09-01** (D55–D58), one day later. The kind *is*
> still text — an item is a line, tags and dates are inline markers, history is
> per day — so it extends `SegmentedDocument` keyed by `DateKey` like the stream,
> and the record-shaped prediction it was deferred on was simply wrong. And the
> evidence gate turned out never to have been exercised: the plain checkbox
> stand-in was never really used, so it had returned nothing rather than a "no."
>
> **What was right here is the part about R16.** The reason to build it is not
> checkboxes, and storing due dates again would not fix era 2's failure. Working
> the requirement properly (`goal/todo.md`) went further in the same direction:
> even *urgency ranking* is not the core — the three interactions a list actually
> serves are, and the second of them (finding a link from three days ago) had
> never been served in any era and is not a TODO feature at all (R10a, D57).

## The file lifecycle *(done)*

**Done**, and verified by `npm run m3`. The four File-menu items — **New File**,
**Save a Copy**, **Rename**, **Delete** — plus the same acts reached from the
sidebar, where a person is already looking at the list of documents: rename in
place, and a context menu that makes a file or deletes one.

**The expensive part is shared, and it is why these are one piece rather than
four.** A fileset links to a document by relative path, so renaming a file
breaks every section that points at it and deleting one leaves entries dangling.
This is D13's *update references* step — the one that is present and empty in
`branch`, with a note saying sections are the finite set it must rewrite and
that they arrive in M3. They have arrived.

Two rules already decided that this has to honour:
- **A new file is a real file from the first keystroke** (`notes/untitled.md`),
  not an unsaved buffer. Tephra has no unsaved state, and adding one would make
  the newest document the only losable thing in the app.
- **A reference that cannot be resolved dangles VISIBLY** (D7). So delete may
  turn out to need no reference rewriting at all — the panel already renders a
  missing entry as "not found" — while rename certainly does.

Both held. Delete rewrites nothing and the entry says "not found"; rename
rewrites through `Filesets.retarget`, which grew two things while this was
built:

- **It rewrites the line where it stands.** It had been `unpin` then `pin`,
  which produces the same set in a different order — so renaming a document
  would have quietly moved it to the bottom of every section naming it. The
  order of a curated list is the part somebody chose (D53).
- **A section is NAMED, not linked**, so the same rename has two shapes to
  rewrite: `_index` says `tephra:section/house` where a note says
  `../notes/x.md`. Handling only the second was enough until sections could be
  renamed at all.

**The sidebar's own distinction**, which the menu bar never has to make: a row
is either a LINE somebody wrote or the bare fact that a document is in a
directory, and the two look identical. Only a written one has a label to edit or
a line to unpin — offering either on a derived row was a control that silently
did nothing, which `SectionRow.pinned` now prevents. The rule the panel states
once: **you edit the name where the name is written.** For a listed entry that
is the label in the section; for a derived row there is no line and the label IS
the filename, so the same typing renames the document.

**Deferred within M3, deliberately.** Section reordering and deletion — which
need `tephra:builtin/*` sentinels so the built-in sections can be positioned
among the curated ones — and a `Pin to…` chooser, for which
`DocumentService.documents()` already exists. Also **making the sidebar
focusable**, which is what would finally put a key on a fileset's undo: ⌘Z goes
to the focused document, and while the editor is the only focusable surface, the
stream is the honest answer (MC4).

## The order, and why it is that order

Three milestones are open at once — the task list, the link directory and the
day boundary — and only three dependencies between them are real. The rest is a
judgement about what is worth having soonest.

**MD1 → MT4 → MD2 → MT4a → MT5a → MT5b → ML2+ML3 → MT6 → MT7 → MS1 → MS2 →
MS3 → MS4 → R7.**
*(All complete. M5 dissolved into the backlog on 2026-09-10, so **the ordered
plan is finished** — everything left is wanted-on-demand and freely
reorderable.)*

**MT5c and M6 are not in that line**; they are in the backlog below, which is a
different kind of thing from a deferral — see there.

*MT7 — more than one list, in two shapes — was also asked for from use. It sits
after MT5b for a real reason: `tephra:todo/<id>` resolves without a list name
because ids are unique across the corpus, which costs nothing to claim with one
list and has to be true with several. It reverses D55's "no lightweight second
form"; the amendment is recorded on that decision.*

*MT4a was not in this plan.* It arrived from use — "I'm already feeling the gap"
— and cost nothing to insert because it depends on nothing: the tag pivot over
today's set is a regrouping of what is already on screen, so it took half of T8
out of MT6 without touching anything MT5 stands on.

The dependencies, which are not negotiable:

- **MD1 before MT4 and MT5.** MT4's capture writes into the stream from
  elsewhere, and would otherwise be a fourth caller learning the day rules by
  hand — which is how the boundary came to be defended twice and enforced
  nowhere. MT5's walk is *offered when the carry happens*, so it has no trigger
  of its own by design.
- **Inside MT5: walk, then tag index, then cap.** The cap cannot ship before the
  walk (T11, T12) — that coupling is the goal document's, not a preference.

The judgements, which are:

- **MD1 first** because it is the only user-visible defect on the board, it
  unblocks the two milestones after it, and it gets more expensive with every
  caller that learns the day rules by hand first.
- **MT4 next** because the list is in daily use and capture is what guards the
  success criterion's first failure — a task that never reaches the list, so the
  head goes on carrying it.
- **MT5 has a clock on it.** A list that accumulates every day with no walk and
  no cap is era 2, which is the thing the design exists to improve on; every
  week without it is a week the central mechanism goes untested by use.
- **ML2+ML3 fifth, and this is the weakest link in the chain.** The link
  directory serves an interaction unserved in all three eras and ML3 is also
  M4's spine — but the task list has evidence behind it from daily use and the
  directory does not yet. If it should come sooner, the clean slot is after MT4,
  where MD2 and ML2 are interchangeable "away from the list" work.

## MD1 — the day boundary ✅

**Design: `solution/day-boundary.md`. Decisions: D62, D63, amending D38.**

**Its own milestone because it is one rule with three customers**, and because
it is currently defended in two places and enforced in none — which is how the
day separator came to vanish, silently, whenever a day ended mid-line.

`DayClock` in main owns `clockDay` and `writingDay` and publishes both;
documents hold `openDay` and cross a boundary when `openDay < writingDay`. A
level rather than an edge, seeded from the corpus rather than kept in memory, so
it is right after a close, a crash or a week away.

- `DayClock`: the two dates, the idle rule, the seed read from the corpus, and
  `writingDay` monotonic — which is what makes two devices converge as well as
  what stops a zone change re-dating going forward (D62)
- Terminating a day — the newline, outside anybody's undo stack
- The stream: a new day file when there is something to write. The empty today
  needs nothing — `Segment.disposable` already removes a day nobody wrote in
- The task list: carry against `writingDay`, and record that a walk is offered
- **Not** deleting the `days.ts` skip or the `branch` clamp: the first is how a
  deliberate cross-midnight join renders, and the second guards a different
  cause. The plan was wrong about both; see `day-boundary.md`

**The zone stays UTC−8 here**, exactly as it is now: MD1 does not touch
`shared/dates.ts`'s signature. That is what keeps the bug fix and the unblocking
from waiting on a wide refactor.

## MD2 — the notebook's own zone ✅

**Done.** What building it taught, beyond the plan:

- **The zone's whole surface was one function.** `dateKeyAt` is the only thing
  that needs to know where you are — a weekday, a day's distance from another
  and a day's name are all properties of a calendar date. The feared wide
  refactor of `shared/dates.ts` was four call sites.
- **`Etc/GMT+8` is UTC−8 exactly**, year-round and with no DST rule, so an unset
  notebook keeps D38's behaviour while every date in the app takes one
  zone-aware path. No dual code path for offsets and zones.
- **Settings live in `w/`**, beside the themes, because files are W's — caught
  by the layering test, which was right.
- **A write time in the future does not hold the day open.** Clock skew, or a
  file synced from a machine that is ahead, otherwise reads as "somebody is
  writing right now" for as long as the skew lasts.
- **The day-rolled announcement was the last edge left in an edge-free design.**
  It fired on the tick rather than on the writing day differing from what was
  announced, so a seed landing after a boundary had passed crossed it silently
  and told nobody. The seed moving the day IS a boundary — it is the moment an
  app that was closed notices — and it is announced like any other now.


**Decision: D63.**

- The zone as chosen configuration in `config/`, and the affordance that offers
  a change when the system's zone disagrees — offered, never applied
- `shared/dates.ts` taking a zone rather than a module constant, with main
  publishing it beside the two dates so neither side computes its own

**Nothing depends on this**, which is why it is split out: it is the travelling
feature rather than the correctness fix, and it is wide-but-shallow work that
would otherwise hold up MT4.

## MT — the TODO list *(done. MT5c is in the backlog.)*

**Roadmap: `solution/todo-roadmap.md`. Design: `goal/todo.md`,
`solution/todo.md`. Decisions: D55–D59.**

Six phases, and the ordering is forced by identity being a one-way door, by
interaction 1 dominating everything else the list is asked, and by the soft cap
being unable to ship before the walk that makes it safe. Usable at the end of
MT3.

**It arrives earlier than planned.** M3 deferred todo on the strength of
`file-documents.md`'s prediction that it would be record-shaped and therefore an
expensive first test of the four-artifact shape. D55 reverses that: an item is a
line, history is per day, and the kind inherits `SegmentedDocument` whole. What
it does test first is the *surface* — it is the first thing in Tephra shown as
something other than running text.

**R10a, the link directory, is not part of it** (D57) and can land anywhere.

## ML — the link directory *(done)*

**Roadmap: `solution/link-roadmap.md`. Requirement: R10a. Decisions: D57, D60,
D61.**

*"Where is that document I was looking at on Tuesday?"* — search's sibling, and
the half no era has ever served. Three phases: one shared link scanner, the
index, and the pane.

**It is the first instance of D9's filtered-view mechanism**, built against the
tractable query — finite, unranked, in memory — where M4's search is none of
those things. And it takes the read-only fork of D9's open question, so the
mechanism gets built without settling whether a filtered view is editable.

**Orthogonal to MT**, which is why it interleaves rather than queuing: the two
share exactly one piece of code (ML1, which ships inside MT3 because MT3's rows
need it). Scheduled after MT3 on urgency alone — the list is what is needed
first, and this lands while MT4–MT6 are still ahead.

## M4 — retrieval

**Roadmap: `solution/search-roadmap.md`. Requirement: R10. Decisions: D9 (as
amended), D65, D66.**

Marked ◆ in `features.md` as arguable, and settled as **the last things built in
v1**: in scope, after the core works.

*"I know I wrote that down"* — era 1's recorded failure, and the half ML does not
serve. **One query engine in four phases** (MS1–MS4): predicates that either
narrow from the index or filter by reading text, streaming pull-based out of a
cancellable cursor, rendered two ways — a walk for ⌘F within one document, a
results pane for ⌘⇧F across the corpus.

**D9's three query shapes turned out to be one query and two renderings**, and
the third thing that had been sharing the name — the composite document — is
descoped from v1, which is what leaves D9's editability question closed rather
than forcing it.

- The query engine, the grammar, and the two surfaces (MS1–MS4) — **done**
- Image paste writing a file and inserting a link (R7) — **done**; here by
  schedule, not by kinship, and written up in `solution/image-notes.md`. It
  found that *inline image rendering*, listed as v1 since `features.md` was
  written, had never once worked: there was no route from the renderer to the
  corpus, so every `<img>` in the app pointed at the bundle.

## M5 — the editing surface finished *(dissolved into the backlog, 2026-09-10)*

**All three of its items were reconsidered after months of use, and none of them
survived as scheduled work.** That is the promotion rule doing its job on a
milestone rather than on a feature: M5 was written when the surface was new and
the answers were guesses.

- **Vim: removed** rather than designed around (D67). It stayed off for months,
  the native surface became better than the vim one, and nothing was missed.
- **The keymap and the visual system: backlog**, grouped — see below. The
  keymap's *inventory* is done (`solution/keymap.md`); its design is not.
- **Rendered editing of inline constructs: backlog.** Already ◆ *v1 or v2*, and
  raw-under-the-caret has been the daily experience for months without complaint.

**Which means v1 is complete.** Everything the ordered plan held is built.

## The backlog — built when we decide we want them

**Not deferred, and not scheduled: wanted-on-demand.** These are whole features
that v1 could ship without and that nothing else waits on. They are here rather
than in the ordered plan because their position is not a judgement anybody has
made yet — each moves to the front the day it is actually wanted, and may be
reordered freely against anything else on this page.

That is a different thing from the deferrals recorded elsewhere. **Q3a's backlog
resurfacing is deferred because the design has no answer yet** and says so;
these have answers and no demand.

### Rendered editing of inline constructs (R1.4, Q1)

**Moved here from M5 on 2026-09-09**, having been marked ◆ *v1 or v2* since
`features.md` was written. Q1 asked whether one surface could be vim-compatible
*and* render figures, equations and tables inline; Spike 01 answered yes and D16
built it — for *reading*. Editing **in** the rendered form is the other half, and
R1.4's own ordering puts inline constructs first, tables and equations last.

**What it would be:** emphasis, links and inline math edited as they are drawn,
rather than the line under the caret showing its markdown. That reveal is D16's
model and is *correct* — it is what the m4 image scene asserts — so this is an
addition to it and not a replacement.

**Why it is here rather than scheduled:** the plain version has been in daily use
for months and has not once been complained about, which is the promotion rule's
answer. It moves to the front the day the raw form is actually in the way.

### The editing surface's refinements — the keymap and the visual system

**Grouped on 2026-09-10, because they are the same kind of work on the same
surface** and would be judged together: what a key does and what a line looks
like are both answers to *is this pleasant to write in*, and doing one without
the other means looking at the surface twice.

**The keymap.** *(D67, R1.4 as superseded, `solution/keymap.md`.)* The inventory
is done and is kept true by `tests/unit/keymap.test.ts`: fifty-nine inherited
bindings from five sources that do not know about each other, three of them dead
under menu accelerators. What remains is deciding what they *should* do, and the
inventory lists the open ones. R1.5 is the standard they answer to — *"a design
that drifts toward someone else's conventions has failed on its own terms"* — and
inheriting a code editor's defaults is exactly that drift.

The ones most worth fixing first, from the inventory:

- **⌘↑ / ⌘↓ / ⌘Home / ⌘End go to "the document" start and end**, which in a
  windowed twenty-year stream is *the loaded window*. A key that says beginning
  and means somewhere arbitrary is worse than one that is not bound.
- **⌘⇧K deletes a line**, live and undocumented, next to ⌘K for Link.
- **The emacs layer** (`Ctrl-k`, `Ctrl-o`, `Ctrl-t`, `Ctrl-v`) and **multiple
  cursors** (`⌘⌥↑`/`⌘⌥↓`), both inherited from a code editor.
- **Escape** belongs to `simplifySelection` and to the find bar at once.

**The visual system.** *(R1.3.)* The *tunable* half is built and has had several
passes: four themes, the panel, authored theme files with machine-local selection
(D41), and font, size, measure, spacing and colour all live. What "excellent"
wants next is a judgement that needs road miles rather than a list written now.
Candidates worth watching for, none of them chosen: the measure at very wide
windows; the vertical rhythm around block widgets, which is where the spacing
work stopped; heading scale in a long day; how the printed page differs from the
screen; whether a light theme wants a different measure from a dark one.

### MT5c — the soft cap on the working view (T12)

**The number is the whole of what is missing.** Both `goal/todo.md` and
`solution/todo.md` flag it as the requirement with the least evidence behind it,
and the walk — which now runs daily — is what produces that evidence: it ends
with a count. The binding constraint was only ever that the cap cannot ship
before the walk (T11 makes it safe), and the walk shipped in MT5a.

**And the walk is what makes waiting free.** T11 carried its promise — every
live item *seen* daily — solely because a cap degrades visibility. With no cap
there is no promise to keep, so nothing about the list is unsafe in the
meantime; it is simply longer than it might be.

### Snippets — daily and weekly summaries of what got done

**Asked for from use (2026-09-08), and it needs design before it needs code.**
The idea: read the task list and the notebook over a day or a week and produce a
summary of what was accomplished, written somewhere durable.

**What is already here that it would stand on.** MT6 built the one query this
wants — `itemsNow()` knows what every item became and on which day, so *what was
finished between Monday and Friday* is a filter over it. The stream's prose for
a range is `proseIn`, which printing already uses.

**What has to be decided, and none of it is obvious:**

- **Where it is written.** The notebook is the tempting answer and is the one to
  be careful about: a generated summary in the stream is text nobody wrote,
  filed under a date, in a corpus whose whole premise is that it holds what you
  actually put there (R26, D9). A `snippets/` document, or a fileset, keeps the
  stream honest. This is the decision the feature turns on.
- **What "accomplished" means.** Items that reached *done* is the cheap answer
  and probably the wrong one on its own — the notebook is where the work is
  described, and a list of task titles is a poor account of a week.
- **Whether it is generated or written.** A summary you edit is a document; one
  regenerated on a schedule is a view. If it is a document, the second run has
  to reconcile with what you changed, which is a real problem and the reason
  this is not small.
- **What triggers it.** The day boundary already announces itself (D62) and
  would serve — but a thing that writes to the corpus on a timer is a different
  kind of thing from one you ask for.

**Recorded rather than scheduled**, per this section's rule: it is wanted, it is
not yet designed, and nothing waits on it.

### M6 — the shreddable notebook

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

**It was already placed last by choice rather than by dependency**, and this is
that observation taken to its conclusion. It touches only the bottom of W plus a
config file and a theme, so nothing above it changes and nothing else waits on
it.

**Checked against the deferral rule** (`goal/scope.md`: *data cannot be
backfilled; mechanisms can be deferred*): it defers cleanly. The notebook is a
new directory with its own storage, so it needs nothing recorded in the primary
corpus beforehand, and the one format addition — the explicit split marker —
applies to files that will not exist until it does. **No coverage obligation is
incurred by waiting.**

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

## Running the suites, and keeping them fast

`npm test` is 576 tests in **12 seconds**; `m0`–`m3` are **3.5 minutes** of real
Electron across 35 launches. They were nine minutes and six respectively, and
what fixed each is worth writing down because both will happen again.

**`npm test`: a fixture that started a service and never stopped it.** One file
took 61 seconds of wall clock for half a second of CPU — it set a 60-second file
tier deliberately (so the tier could not rescue what the WAL was being tested
for), typed, and closed the notebook without stopping the service. The tier's
timer then held the process open for its whole interval after the tests had
passed. **A test that starts a service is a process that has to stop it**, which
is what the app does on quit (D32).

**The acceptance suites: waiting a fixed time instead of waiting for a fact.**
Every scene opened with a flat 1.8-second settle — a guess about the slowest
machine, paid on every machine, and still wrong on a slower one. `until()` polls
for the window being ready instead. That is a minute across the four suites, and
it is also why scenes used to fail under load: a fixed wait that is too short
does not slow down, it lies.

**Both suites report where their time goes.** `TEPHRA_TIMING=1 npm run m3`
prints seconds per scene, slowest first. A harness that cannot say what it spent
gets slower by accident, which is exactly what happened here.

**And every date a fixture writes is relative** (`dayFrom` in the harnesses). A
due date spelled `2026-09-14` is a different number of days away tomorrow than
today, so a literal passes on the day it was written and fails every day after.
Two checks did exactly that and were caught by the calendar rolling over
mid-session.

## How to know what to test

Test M0's list above. Anything in M1 and beyond is absent, and absence is not a
bug. The one thing worth re-checking after every milestone is the acceptance
run — `npm run m0` — because it asserts the property the whole project rests
on: that nothing written is ever lost.
